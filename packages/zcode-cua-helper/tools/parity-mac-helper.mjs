#!/usr/bin/env node
/* oxlint-disable eslint(max-lines), eslint(no-unused-expressions) -- 验收
   harness 按场景线性组织且大量使用逗号表达式驱动 socket 序列，长度与写法
   为验收可读性服务，不拆分。 */
// macOS 双 broker 能力 parity 验收：本仓库构建产物 vs 官方原版 .app。
// spec：specs/mac-cua-helper-app-alignment.md §四.3。
// 用法：node tools/parity-mac-helper.mjs [our.app] [orig.app]
//   缺省 our = dist-cua-helper/Drora Computer Use.app（2026-09-28 身份改名，specs/drora-rename.md）
//        orig = packages/desktop/resources/cua-helper/ZCode Computer Use.app（官方 staging 副本）
//
// 场景 1 refuse-unsigned-launcher：--launcher-pid 1（launchd 非 ZCode 签名），
//   两侧都必须 fail-closed 拒绝且 stderr 语义一致（无 env 覆盖）。
// 场景 2 product-recipe：--launcher-pid 指向本 harness 进程树的 ZCode 桌面主进程
//   （dev.zcode.app / 8A5X4JJ39T，官方原版发行构建把 local-dev 折叠为 false，
//   env 覆盖不可用，唯一被原版接受的路径就是可信 ZCode launcher + 后代 peer）。
//   两侧 authenticate / broker_info / 错误 token 拒绝，动态与身份字段归一后逐字比对。
// 只读面；不注入输入、不激活应用。launcher pid 可用 PARITY_LAUNCHER_PID 覆盖。
import { spawn, execFileSync } from "node:child_process";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const packageRoot = new URL("..", import.meta.url).pathname;
const OURS = process.argv[2] ?? resolve(packageRoot, "dist-cua-helper/Drora Computer Use.app");
// 双轨参照（第五十一轮）：官方 3.14.3 收紧了连接级 peer 验证（原生签名校验，
// "cua broker rejected connection: peer verification failed"），拒绝一切非
// ZCode 签名进程的 broker 质询——本 harness（无签名 node）从此无法质询 3.14.3
// 的方法面。因此：
//   形态锚 ORIG_FORM = 3.14.3 staging（随包字节/版本/启动门——无需连接质询的面）；
//   行为锚 ORIG_BEHAVIOR = 3.11.2 reference（连接/方法面 parity 锚定官方最后
//   一个可质询版本；本机 /Applications/ZCode_副本.app 的随包 Helper）。
// 3.14.3 peer 收紧与路线 A（ad-hoc 桌面宿主）不兼容：照搬会拒掉自家宿主，
// 属签名身份决策的前置项，见 spec §七.2 与 manifest 第五十一轮。
const ORIG_FORM =
  process.argv[3] ?? resolve(packageRoot, "../desktop/resources/cua-helper/ZCode Computer Use.app");
const ORIG_BEHAVIOR = resolve(
  packageRoot,
  "../desktop/resources/cua-helper-3.11.2-reference/ZCode Computer Use.app",
);

// 双身份（specs/drora-rename.md 2026-09-28 修订）：我方产物 Drora 名，官方参照保留 ZCode 原名。
const appExeName = (app) =>
  basename(app).startsWith("Drora") ? "Drora Computer Use" : "ZCode Computer Use";
for (const [label, app] of [
  ["ours", OURS],
  ["form-orig(3.14.3)", ORIG_FORM],
  ["behavior-orig(3.11.2)", ORIG_BEHAVIOR],
]) {
  if (!existsSync(join(app, "Contents", "MacOS", appExeName(app)))) {
    console.error(`missing ${label} app executable: ${app}`);
    process.exit(2);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 纯净启动环境：不带任何验签覆盖（产品配方），也不允许意外进入 production 折叠分支。
// runtimeDir 隔离：controller 租约在 darwin 是全局 /tmp/zcode-cua-<uid>，不隔离会让
// 先跑的实例自助拿走租约、后跑的实例读到死 pid 残留而 fail-closed（顺序伪影）。
// 两侧代码都优先读 XDG_RUNTIME_DIR，注入每实例独立目录即公平且确定。
function launchEnv() {
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.ZCODE_RUNTIME_ENV;
  delete env.ZCODE_CUA_LAUNCHER_BUNDLE_ID;
  delete env.ZCODE_CUA_HELPER_TEAM_ID;
  // 第五十一轮：移除 XDG_RUNTIME_DIR 每实例隔离。官方 3.14.3 参照 broker 在
  // XDG_RUNTIME_DIR 被设时接受连接但永不回复（3.11.2 无此行为，实测复现）；
  // 生产 GUI 会话本就不设该变量，harness 与生产环境一致才是 parity 正解。
  // 顺序伪影由既有 kill 后 settle 等待消除。
  delete env.XDG_RUNTIME_DIR;
  return env;
}

// 第五十一轮：跨版本可靠的 broker 清理。3.14.3 参照 broker 的 SIGTERM 优雅退出
// 比 3.11.2 慢，fire-and-forget kill 会让下一段的实例读到仍存活的租约持有者
// （controller_busy / standby 卡死）。统一 SIGTERM → 确认退出（至多 5s）→ SIGKILL。
async function killAndWaitBroker(child, label = "broker") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", () => resolve(true)));
  child.kill("SIGTERM");
  const timer = new Promise((resolve) => setTimeout(() => resolve(false), 5000));
  if ((await Promise.race([exited, timer])) === false) {
    try {
      child.kill("SIGKILL");
    } catch {}
    await exited.catch(() => {});
  }
}

// 第五十一轮环境预检：全局租约（/tmp/zcode-cua-<uid>/broker.sock）若被存活的外部
// broker 持有（本机正在运行的 ZCode 桌面会话/standalone helper），双侧行为都会被
// 污染（ours 报 controller_busy、3.14.3 orig 静默卡死）。fail-fast 并给出处置指引，
// 不做静默击杀——杀掉的是用户活会话的运行时。
function assertGlobalLeaseQuiet() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === null) return;
  const globalSocket = join("/tmp", `zcode-cua-${uid}`, "broker.sock");
  if (!existsSync(globalSocket)) return;
  const reply = (() => {
    try {
      const out = execFileSync(
        process.execPath,
        [
          "-e",
          `const n=require("node:net");const s=n.connect(${JSON.stringify(globalSocket)});s.on("error",()=>process.exit(1));s.on("connect",()=>{s.write(JSON.stringify({id:1,method:"broker_info",params:{}})+"\n")});let b="";s.on("data",d=>{b+=d;const i=b.indexOf("\n");if(i>=0){process.stdout.write(b.slice(0,i));process.exit(0)}});setTimeout(()=>process.exit(1),2000);`,
        ],
        { encoding: "utf8", timeout: 4000 },
      );
      return out.trim();
    } catch {
      return "";
    }
  })();
  if (!reply) return; // 无应答＝残留死 socket，broker 自会按 stale 处理
  console.error(
    `[parity] 全局租约被存活外部 broker 持有（${globalSocket}，broker_info 有应答）。` +
      "parity 双侧会被污染（controller_busy / 卡死）。请结束本机 ZCode 桌面的 " +
      "Computer Use 会话（或 kill 该 standalone helper）后重跑。",
  );
  process.exit(2);
}

// 顶向祖先链找桌面主进程：ppid==1 的最近祖先即桌面 main（本工具由 ZCode 会话树内运行）。
function detectDesktopLauncherPid() {
  if (process.env.PARITY_LAUNCHER_PID) return Number.parseInt(process.env.PARITY_LAUNCHER_PID, 10);
  let pid = process.pid;
  for (let i = 0; i < 16; i += 1) {
    const row = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const ppid = Number.parseInt(row, 10);
    if (!Number.isInteger(ppid) || ppid <= 1) return pid > 1 ? pid : null;
    pid = ppid;
  }
  return null;
}

async function runBroker(label, appPath, launcherPid) {
  const workDir = mkdtempSync(join(tmpdir(), `cua-parity-${label}-`));
  const socketPath = join(workDir, "broker.sock");
  const token = `parity-${randomUUID()}`;
  const tokenFile = join(workDir, "token");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const exe = join(appPath, "Contents", "MacOS", appExeName(appPath));
  const env = launchEnv();
  const child = spawn(
    exe,
    ["--socket", socketPath, "--token-file", tokenFile, "--launcher-pid", String(launcherPid)],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const ready = await new Promise((res) => {
    const deadline = Date.now() + 30000;
    const poll = () => {
      if (stdout.includes('"ready":true') || child.exitCode !== null || Date.now() > deadline) {
        return res(stdout.includes('"ready":true'));
      }
      setTimeout(poll, 200);
    };
    poll();
  });
  if (!ready) {
    await killAndWaitBroker(child);
    return { ready: false, stderr: stderr.trim(), replies: null, badAuth: null };
  }
  const exchange = (requests) =>
    new Promise((res, rej) => {
      const sock = connect(socketPath);
      let buf = "";
      const replies = [];
      sock.on("error", (e) => (sock.destroy(), rej(e)));
      sock.on("connect", () => {
        for (const r of requests) sock.write(JSON.stringify(r) + "\n");
      });
      sock.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          replies.push(JSON.parse(line));
          if (replies.length >= requests.length) {
            sock.destroy();
            res(replies);
          }
        }
      });
      setTimeout(() => (sock.destroy(), rej(new Error("exchange timeout"))), 10000);
    });
  const replies = await exchange([
    { id: 1, method: "authenticate", params: { token } },
    { id: 2, method: "broker_info", params: {} },
  ]).catch((e) => [{ error: e.message }]);
  const badAuth = await exchange([
    { id: 3, method: "authenticate", params: { token: "wrong" } },
  ]).catch((e) => [{ error: e.message }]);
  await killAndWaitBroker(child);
  await wait(300);
  return { ready, stderr: "", replies, badAuth };
}

// 归一：动态字段 + 构建身份（签名/安装路径属身份而非能力面，spec §一/§二）
const DYNAMIC_KEYS = new Set([
  "id",
  "pid",
  "socketPath",
  "socket",
  "buildId",
  "connectionId",
  "app_bundle_path",
  "executable_path",
  "code_signing_identifier",
  "team_identifier",
  "signature",
  "stable_identity",
  "warnings",
]);
const redact = (x) =>
  JSON.stringify(x, (k, v) => {
    if (DYNAMIC_KEYS.has(k)) return "<dyn>";
    if (typeof v === "string") {
      return (
        v
          .replace(/[^"'\s]*(?:ZCode|Drora) Computer Use\.app[^"'\s]*/g, "<app>")
          // 身份字段是改名后的有意分歧（specs/drora-rename.md 2026-09-28），比对前归一。
          .replace(/dev\.(?:drora|zcode)\.cua-helper(\.dev)?/g, "<bundle-id>")
          .replace(/(?:Drora|ZCode) Computer Use/g, "<helper>")
          .replace(/\/private\/var\/folders\/[^\s"']+/g, "<tmp>")
          .replace(/\/var\/folders\/[^\s"']+/g, "<tmp>")
          .replace(/cua-parity-[a-z]+-[^\s"']+/g, "<tmp>")
      );
    }
    return v;
  });

let failed = 0;
// 场景 0：.node 字节级对齐（spec §一：原生层与官方参照物逐字节一致）
const fileSha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const ourAddonHash = fileSha256(join(OURS, "Contents", "Resources", "ax_native.node"));
const origAddonHash = fileSha256(join(ORIG_FORM, "Contents", "Resources", "ax_native.node"));
console.log(
  `${ourAddonHash === origAddonHash ? "MATCH" : "DIFF"} ax_native byte-identical  ${ourAddonHash.slice(0, 16)}… vs ${origAddonHash.slice(0, 16)}…`,
);
if (ourAddonHash !== origAddonHash) failed++;

// 形态锚断言（第五十一轮，3.14.3）：随包身份（版本/buildId）与溯源冒烟
// （arch/modules/bundleId）。这些面不需要连接质询，不受 3.14.3 peer 收紧影响。
{
  const readPlist = (app, key) =>
    execFileSync(
      "/usr/bin/plutil",
      ["-extract", key, "raw", "-o", "-", join(app, "Contents", "Info.plist")],
      { encoding: "utf8" },
    ).trim();
  const formVersionOk = readPlist(ORIG_FORM, "CFBundleShortVersionString") === "3.14.3";
  const formBuildIdOk =
    readPlist(ORIG_FORM, "ZCodeCUAHelperBuildId") === "pipeline-293504-ab4d5e6b";
  console.log(
    `${formVersionOk && formBuildIdOk ? "MATCH" : "DIFF"} form-anchor identity 3.14.3/pipeline-293504-ab4d5e6b`,
  );
  if (!formVersionOk || !formBuildIdOk) failed++;
  try {
    const smoke = JSON.parse(
      execFileSync(
        join(ORIG_FORM, "Contents", "MacOS", "ZCode Computer Use"),
        ["--cua-helper-provenance-smoke"],
        { encoding: "utf8", timeout: 15000 },
      ),
    );
    const smokeOk =
      smoke.arch === process.arch &&
      smoke.bundleId === "dev.zcode.cua-helper" &&
      smoke.version === "3.14.3";
    console.log(
      `${smokeOk ? "MATCH" : "DIFF"} form-anchor provenance ${JSON.stringify({ arch: smoke.arch, modules: smoke.modules, version: smoke.version, bundleId: smoke.bundleId })}`,
    );
    if (!smokeOk) failed++;
  } catch (error) {
    console.log(`DIFF form-anchor provenance (smoke failed: ${error.message.slice(0, 80)})`);
    failed++;
  }
}

const report = (name, ok, left, right) => {
  if (!ok) failed++;
  console.log(`${ok ? "MATCH" : "DIFF"} ${name}`);
  if (!ok) {
    console.log(`  ours: ${String(left).slice(0, 900)}`);
    console.log(`  orig: ${String(right).slice(0, 900)}`);
  }
};

// 场景 1：unsigned launcher → 双侧 fail-closed，stderr 语义一致
const refuseA = await runBroker("ours-refuse", OURS, 1);
const refuseB = await runBroker("orig-refuse", ORIG_FORM, 1);
const normStderr = (s) =>
  String(s)
    .replace(/\s+/g, " ")
    .trim()
    // 品牌词是 2026-09-28 身份改名的有意分歧（specs/drora-rename.md），行为面比对前归一。
    .replaceAll("Drora Computer Use", "<helper>")
    .replaceAll("ZCode Computer Use", "<helper>");
report(
  "refuse-unsigned-launcher",
  refuseA.ready === false &&
    refuseB.ready === false &&
    normStderr(refuseA.stderr) === normStderr(refuseB.stderr),
  `${refuseA.ready} ${refuseA.stderr}`,
  `${refuseB.ready} ${refuseB.stderr}`,
);

// 场景 2：产品配方（ZCode 桌面 launcher + 后代 peer）
assertGlobalLeaseQuiet();
const launcherPid = detectDesktopLauncherPid();
if (!Number.isInteger(launcherPid) || launcherPid <= 1) {
  console.error("cannot detect a desktop launcher pid; set PARITY_LAUNCHER_PID");
  process.exit(2);
}
console.log(`launcher pid: ${launcherPid}`);
const a = await runBroker("ours", ORIG_BEHAVIOR, launcherPid);
const b = await runBroker("orig", ORIG_BEHAVIOR, launcherPid);
report("broker ready", a.ready === b.ready && a.ready, a.stderr, b.stderr);
report(
  "authenticate + broker_info",
  redact(a.replies) === redact(b.replies),
  redact(a.replies),
  redact(b.replies),
);
report(
  "bad token rejected",
  redact(a.badAuth) === redact(b.badAuth),
  redact(a.badAuth),
  redact(b.badAuth),
);

const PROBE_METHODS = [
  "move_to",
  "mouse_down",
  "mouse_up",
  "key_down",
  "key_up",
  "type_text_into_current_focus",
  "click_element_at_point",
  "set_display",
  "read_clipboard",
  "screen_capture_status",
  "supports_accessibility",
  "screen_size",
  "open_application",
];
function summarizeProbeResult(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean" || typeof value === "string") return typeof value;
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return `array:${value.length === 0 ? "empty" : "nonempty"}`;
  if (typeof value === "object") return `keys:${Object.keys(value).sort().join(",")}`;
  return typeof value;
}
async function probeMethodSurface(label, appPath) {
  const workDir = mkdtempSync(join(tmpdir(), `cua-probe-${label}-`));
  const socketPath = join(workDir, "broker.sock");
  const token = `parity-${randomUUID()}`;
  const tokenFile = join(workDir, "token");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const child = spawn(
    join(appPath, "Contents", "MacOS", appExeName(appPath)),
    ["--socket", socketPath, "--token-file", tokenFile, "--launcher-pid", String(launcherPid)],
    { env: launchEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderrText = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderrText += d));
  const ready = await new Promise((res) => {
    const deadline = Date.now() + 30000;
    const poll = () => {
      if (stdout.includes('"ready":true') || child.exitCode !== null || Date.now() > deadline) {
        return res(stdout.includes('"ready":true'));
      }
      setTimeout(poll, 200);
    };
    poll();
  });
  if (!ready) {
    await killAndWaitBroker(child);
    console.error(`[parity] ${label} broker 未就绪，stderr 尾部: ${stderrText.slice(-400)}`);
    return null;
  }
  const requests = [
    { id: 1, method: "authenticate", params: { token } },
    ...PROBE_METHODS.map((method, index) => ({ id: index + 2, method, params: {} })),
  ];
  const replies = await new Promise((res, rej) => {
    const sock = connect(socketPath);
    let buf = "";
    const out = [];
    sock.on("error", (e) => (sock.destroy(), rej(e)));
    sock.on("connect", () => {
      for (const r of requests) sock.write(JSON.stringify(r) + "\n");
    });
    sock.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        out.push(JSON.parse(line));
        if (out.length >= requests.length) {
          sock.destroy();
          res(out);
        }
      }
    });
    setTimeout(() => (sock.destroy(), rej(new Error("probe exchange timeout"))), 20000);
  }).catch((e) => [{ error: e.message }]);
  await killAndWaitBroker(child);
  await wait(300);
  const surface = {};
  PROBE_METHODS.forEach((method, index) => {
    const reply = replies[index + 1] ?? {};
    surface[method] =
      reply.ok === true
        ? `ok:${summarizeProbeResult(reply.result)}`
        : `err:${reply.error?.code ?? "?"}`;
  });
  return surface;
}
const oursSurface = await probeMethodSurface("ours", OURS);
const origSurface = await probeMethodSurface("orig", ORIG_BEHAVIOR);
if (oursSurface && origSurface) {
  let probeDiff = 0;
  for (const method of PROBE_METHODS) {
    const same = oursSurface[method] === origSurface[method];
    if (!same) probeDiff++;
    console.log(
      `${same ? "MATCH" : "DIFF"} method:${method}  ours=${oursSurface[method]} orig=${origSurface[method]}`,
    );
  }
  if (probeDiff > 0) failed += probeDiff;
} else {
  failed++;
  console.log("DIFF method probe (broker not ready)");
}

// 场景 4：参数校验矩阵（第三十轮）。带参用例触发各方法的确定性校验路径
// （参数类型/边界/缺失，均在 AX/权限门之前失败），双侧逐字比对
// error.code + error.message——消息原文即参数校验逻辑的最强证据面。
const PARAM_CASES = [
  { name: "move_to:no-point", method: "move_to", params: {} },
  { name: "mouse_down:no-point", method: "mouse_down", params: {} },
  { name: "mouse_up:not-holding", method: "mouse_up", params: { session_key: "s1" } },
  { name: "click:no-point", method: "click", params: {} },
  { name: "click:bad-point", method: "click", params: { point: { x: "a", y: 2 } } },
  { name: "scroll:no-point", method: "scroll", params: {} },
  {
    name: "scroll:bad-amount",
    method: "scroll",
    params: { point: { x: 1, y: 1 }, amount: -5, direction: "down" },
  },
  { name: "drag:no-points", method: "drag", params: {} },
  { name: "element_at_point:bad-coords", method: "element_at_point", params: { x: "a", y: 0 } },
  { name: "pip_start:no-window-id", method: "pip_start", params: {} },
  { name: "pip_start:bad-width", method: "pip_start", params: { window_id: 1, width: -3 } },
  {
    name: "pip_start:bad-height",
    method: "pip_start",
    params: { window_id: 1, width: 100, height: 99999 },
  },
  { name: "click_element_at_point:no-point", method: "click_element_at_point", params: {} },
  { name: "type_text:empty", method: "type_text", params: { text: "" } },
  { name: "type_text:bad-type", method: "type_text", params: { text: 123 } },
  { name: "hold_key:no-chord", method: "hold_key", params: {} },
  { name: "press_key:no-chord", method: "press_key", params: {} },
  { name: "key_down:no-key", method: "key_down", params: {} },
  { name: "cursor_position:ok", method: "cursor_position", params: {} },
  { name: "list_displays:ok", method: "list_displays", params: {} },
  { name: "request_access:ok", method: "request_access", params: {} },
  { name: "permission_status:ok", method: "permission_status", params: {} },
  { name: "controller_status:ok", method: "controller_status", params: {} },
  { name: "input_permission_status:ok", method: "input_permission_status", params: {} },
];
async function paramMatrixProbe(label, appPath) {
  const workDir = mkdtempSync(join(tmpdir(), `cua-param-${label}-`));
  const socketPath = join(workDir, "broker.sock");
  const token = `parity-${randomUUID()}`;
  const tokenFile = join(workDir, "token");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const child = spawn(
    join(appPath, "Contents", "MacOS", appExeName(appPath)),
    ["--socket", socketPath, "--token-file", tokenFile, "--launcher-pid", String(launcherPid)],
    { env: launchEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderrText = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderrText += d));
  const ready = await new Promise((res) => {
    const deadline = Date.now() + 30000;
    const poll = () => {
      if (stdout.includes('"ready":true') || child.exitCode !== null || Date.now() > deadline) {
        return res(stdout.includes('"ready":true'));
      }
      setTimeout(poll, 200);
    };
    poll();
  });
  if (!ready) {
    await killAndWaitBroker(child);
    console.error(`[parity] ${label} broker 未就绪，stderr 尾部: ${stderrText.slice(-400)}`);
    return null;
  }
  const results = {};
  for (const c of PARAM_CASES) {
    try {
      const replies = await new Promise((res, rej) => {
        const sock = connect(socketPath);
        let buf = "";
        const out = [];
        sock.on("error", (e) => (sock.destroy(), rej(e)));
        sock.on("connect", () => {
          sock.write(JSON.stringify({ id: 1, method: "authenticate", params: { token } }) + "\n");
          sock.write(JSON.stringify({ id: 2, method: c.method, params: c.params }) + "\n");
        });
        sock.on("data", (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (!line.trim()) continue;
            out.push(JSON.parse(line));
            if (out.length >= 2) {
              sock.destroy();
              res(out);
            }
          }
        });
        setTimeout(() => (sock.destroy(), rej(new Error("case timeout"))), 8000);
      });
      const r = replies[1] ?? {};
      // version 字段随构建身份（双轨参照下 ours=3.14.3 缺省、行为锚=3.11.2 自报），
      // 与 pid 一样属非行为面，比对时脱敏。
      const norm = (v) =>
        JSON.stringify(v)
          ?.replace(/"pid":\d+/g, '"pid":<pid>')
          .replace(/"version":"[^"]*"/g, '"version":"<version>"')
          // 身份字段是改名后的有意分歧（specs/drora-rename.md 2026-09-28），比对前归一。
          .replace(/dev\.(?:drora|zcode)\.cua-helper(\.dev)?/g, "<bundle-id>")
          .replace(/(?:Drora|ZCode) Computer Use/g, "<helper>");
      results[c.name] =
        r.ok === true
          ? `ok:${norm(r.result)?.slice(0, 160)}`
          : `${r.error?.code ?? "?"}::${r.error?.message ?? ""}`;
    } catch (e) {
      results[c.name] = `exchange-error:${e.message}`;
    }
  }
  await killAndWaitBroker(child);
  setTimeout(() => {
    try {
      child.kill(9);
    } catch {}
  }, 1500);
  await wait(800);
  return results;
}
const oursParam = await paramMatrixProbe("ours", OURS);
const origParam = await paramMatrixProbe("orig", ORIG_BEHAVIOR);
if (oursParam && origParam) {
  for (const c of PARAM_CASES) {
    const same = oursParam[c.name] === origParam[c.name];
    if (!same) failed++;
    console.log(
      `${same ? "MATCH" : "DIFF"} param:${c.name}\n  ours=${oursParam[c.name]}\n  orig=${origParam[c.name]}`,
    );
  }
} else {
  failed++;
  console.log("DIFF param matrix (broker not ready)");
}

// 场景 5：controller 生命周期仲裁序列（第三十四轮）。
// 同一 broker 上单连接驱动 takeover → status ×2 → stop → status ×2，
// 双侧状态机序列应逐步一致（自助拿锁/重入/释放语义）。
async function controllerCycleProbe(label, appPath) {
  const workDir = mkdtempSync(join(tmpdir(), `cua-ctrl-${label}-`));
  const socketPath = join(workDir, "broker.sock");
  const token = `parity-${randomUUID()}`;
  const tokenFile = join(workDir, "token");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const child = spawn(
    join(appPath, "Contents", "MacOS", appExeName(appPath)),
    ["--socket", socketPath, "--token-file", tokenFile, "--launcher-pid", String(launcherPid)],
    { env: launchEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderrText = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderrText += d));
  const ready = await new Promise((res) => {
    const deadline = Date.now() + 30000;
    const poll = () => {
      if (stdout.includes('"ready":true') || child.exitCode !== null || Date.now() > deadline) {
        return res(stdout.includes('"ready":true'));
      }
      setTimeout(poll, 200);
    };
    poll();
  });
  if (!ready) {
    await killAndWaitBroker(child);
    console.error(`[parity] ${label} broker 未就绪，stderr 尾部: ${stderrText.slice(-400)}`);
    return null;
  }
  const seq = [];
  const drive = async (requests) => {
    const replies = await new Promise((res, rej) => {
      const sock = connect(socketPath);
      let buf = "";
      const out = [];
      sock.on("error", (e) => (sock.destroy(), rej(e)));
      sock.on("connect", () => {
        for (const r of requests) sock.write(JSON.stringify(r) + "\n");
      });
      sock.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          out.push(JSON.parse(line));
          if (out.length >= requests.length) {
            sock.destroy();
            res(out);
          }
        }
      });
      setTimeout(() => (sock.destroy(), rej(new Error("cycle timeout"))), 8000);
    });
    return replies;
  };
  const step = async (name, requests) => {
    try {
      const replies = await drive(requests);
      seq.push(
        name +
          " => " +
          replies
            .slice(1)
            .map((r) =>
              r.ok === true
                ? "ok:" +
                  JSON.stringify(r.result)
                    ?.replace(/"pid":\d+/g, '"pid":<pid>')
                    ?.replace(/"version":"[^"]*"/g, '"version":"<version>"')
                    ?.replace(/dev\.(?:drora|zcode)\.cua-helper(\.dev)?/g, "<bundle-id>")
                    ?.replace(/(?:Drora|ZCode) Computer Use/g, "<helper>")
                    ?.slice(0, 140)
                : "err:" + (r.error?.code ?? "?"),
            )
            .join(" | "),
      );
    } catch (e) {
      seq.push(name + " => exchange-error:" + e.message);
    }
  };
  await step("initial-status", [{ id: 2, method: "controller_status", params: {} }]);
  await step("takeover", [{ id: 2, method: "controller_takeover", params: {} }]);
  await step("status-after-takeover", [{ id: 2, method: "controller_status", params: {} }]);
  await step("takeover-reentrant", [{ id: 2, method: "controller_takeover", params: {} }]);
  await step("status-after-reentrant", [{ id: 2, method: "controller_status", params: {} }]);
  await step("stop", [{ id: 2, method: "controller_stop", params: {} }]);
  await step("status-after-stop", [{ id: 2, method: "controller_status", params: {} }]);
  await killAndWaitBroker(child);
  setTimeout(() => {
    try {
      child.kill(9);
    } catch {}
  }, 1500);
  await wait(800);
  return seq;
}
const oursCycle = await controllerCycleProbe("ours", OURS);
const origCycle = await controllerCycleProbe("orig", ORIG_BEHAVIOR);
if (oursCycle && origCycle) {
  const sameSeq = JSON.stringify(oursCycle) === JSON.stringify(origCycle);
  if (!sameSeq) failed++;
  for (let i = 0; i < Math.max(oursCycle.length, origCycle.length); i++) {
    const same = oursCycle[i] === origCycle[i];
    console.log(
      `${same ? "MATCH" : "DIFF"} ctrl[${i}] ${oursCycle[i] ?? "(missing)"}${same ? "" : " || orig=" + (origCycle[i] ?? "(missing)")}`,
    );
  }
  console.log(sameSeq ? "controller 生命周期序列一致 ✓" : "✗ 序列不一致");
} else {
  failed++;
  console.log("DIFF controller cycle (broker not ready)");
}

// 场景 6：全方法空参穷举（第三十六轮）。64 方法中排除三类不可双侧对比者：
// ① TCC/AX 阻塞（screenshot 家族与 AX 观测方法——ours adhoc 无授权，环境差异非代码差异）；
// ② 有副作用的 paste 与 controller_takeover/stop（分别有专项覆盖/场景五）；
// ③ pip_session_*（presentation 角色门，场景五已覆盖角色语义）。
// 其余方法空参行为的 code+message 双侧逐字比对。
const SWEEP_EXCLUDE = new Set([
  "paste",
  "screenshot",
  "screen_capture_probe",
  "capture_app",
  "list_applications",
  "application_info",
  "list_windows",
  "element_at_point",
  "read_element",
  "get_skyshot",
  "controller_takeover",
  "controller_stop",
  "pip_session_handshake",
  "pip_session_event",
  // 写用户剪贴板属可见副作用（第三十六轮实测空参会清空剪贴板），移出 sweep
  "write_clipboard",
]);
const SWEEP_METHODS = [
  "broker_info",
  "controller_status",
  "request_access",
  "permission_status",
  "input_permission_status",
  "screen_capture_status",
  "screen_capture_probe",
  "supports_accessibility",
  "screen_size",
  "cursor_position",
  "list_displays",
  "set_display",
  "move_to",
  "click",
  "scroll",
  "drag",
  "mouse_down",
  "mouse_up",
  "type_text",
  "type_text_into_current_focus",
  "type_text_to_app",
  "press_key",
  "press_key_to_app",
  "hold_key",
  "hold_key_to_app",
  "cancel_input_holds",
  "key_down",
  "key_up",
  "read_clipboard",
  "write_clipboard",
  "open_application",
  "element_press",
  "element_show_menu",
  "element_focus",
  "element_set_value",
  "element_perform_action",
  "element_select_text",
  "prevent_activation",
  "reenable_activation",
  "is_focus_steal_prevented",
  "pip_start",
  "pip_stop",
  "pip_is_running",
  "pip_clear_dismissed",
  "click_element_at_point",
  "pip_live_probe_start_test_panel",
  "pip_live_probe_window_bounds",
  "pip_live_probe_drag_panel",
  "pip_live_probe_move_test_panel",
  "pip_live_probe_sample_ownership",
  "pip_live_probe_initial_hit_surface",
].filter((m) => !SWEEP_EXCLUDE.has(m));
async function emptySweepProbe(label, appPath) {
  const workDir = mkdtempSync(join(tmpdir(), `cua-sweep-${label}-`));
  const socketPath = join(workDir, "broker.sock");
  const token = `parity-${randomUUID()}`;
  const tokenFile = join(workDir, "token");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  const child = spawn(
    join(appPath, "Contents", "MacOS", appExeName(appPath)),
    ["--socket", socketPath, "--token-file", tokenFile, "--launcher-pid", String(launcherPid)],
    { env: launchEnv(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderrText = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderrText += d));
  const ready = await new Promise((res) => {
    const deadline = Date.now() + 30000;
    const poll = () => {
      if (stdout.includes('"ready":true') || child.exitCode !== null || Date.now() > deadline) {
        return res(stdout.includes('"ready":true'));
      }
      setTimeout(poll, 200);
    };
    poll();
  });
  if (!ready) {
    await killAndWaitBroker(child);
    console.error(`[parity] ${label} broker 未就绪，stderr 尾部: ${stderrText.slice(-400)}`);
    return null;
  }
  const results = {};
  for (const method of SWEEP_METHODS) {
    try {
      const replies = await new Promise((res, rej) => {
        const sock = connect(socketPath);
        let buf = "";
        const out = [];
        sock.on("error", (e) => (sock.destroy(), rej(e)));
        sock.on("connect", () => {
          sock.write(JSON.stringify({ id: 1, method: "authenticate", params: { token } }) + "\n");
          sock.write(JSON.stringify({ id: 2, method, params: {} }) + "\n");
        });
        sock.on("data", (d) => {
          buf += d;
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (!line.trim()) continue;
            out.push(JSON.parse(line));
            if (out.length >= 2) {
              sock.destroy();
              res(out);
            }
          }
        });
        setTimeout(() => (sock.destroy(), rej(new Error("sweep timeout"))), 8000);
      });
      const r = replies[1] ?? {};
      results[method] =
        r.ok === true
          ? "ok"
          : `${r.error?.code ?? "?"}::${String(r.error?.message ?? "").replace(/\s+/g, " ")}`;
    } catch (e) {
      results[method] = `exchange-error:${e.message}`;
    }
  }
  await killAndWaitBroker(child);
  setTimeout(() => {
    try {
      child.kill(9);
    } catch {}
  }, 1500);
  await wait(800);
  return results;
}
const oursSweep = await emptySweepProbe("ours", OURS);
const origSweep = await emptySweepProbe("orig", ORIG_BEHAVIOR);
if (oursSweep && origSweep) {
  for (const method of SWEEP_METHODS) {
    const same = oursSweep[method] === origSweep[method];
    if (!same) failed++;
    console.log(
      `${same ? "MATCH" : "DIFF"} sweep:${method}\n  ours=${oursSweep[method]}\n  orig=${origSweep[method]}`,
    );
  }
} else {
  failed++;
  console.log("DIFF empty sweep (broker not ready)");
}

console.log(failed === 0 ? "\nmacOS broker parity 通过 ✓" : `\n${failed} 项不一致 ✗`);
process.exit(failed === 0 ? 0 : 1);
