#!/usr/bin/env node
// mac 发射契约验收（第十五轮：原版 asar 真实调用对齐）。
// 用法：node test/mac-launch-contract.mjs [helper.app]
//   缺省 helper = packages/desktop/resources/cua-helper（官方 staging 副本）。
// 覆盖：
//   A. 一次性 token 文件：`.tokens/.broker-token-<pid>-<16hex>`、目录 0700、
//      文件 0600、内容即 token、唯一名重试语义。
//   B. 原版 Uxe 参数序：--socket → --token-file → --presentation-token-file →
//      --version → --expected-app-bundle-path → --exit-log → --launcher-pid。
//   C. E2E：以原版完整参数向量直启 helper（产品配方 launcher），authenticate
//      用 token 过 / 错 token 拒 / broker_info 认领成功。
import { spawn, execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { connect } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const packageRoot = new URL("..", import.meta.url).pathname;
const helperApp =
  process.argv[2] ??
  resolve(packageRoot, "../zcode-cua-helper/dist-cua-helper/ZCode Computer Use.app");
const mod = await import("../broker/server/helper-launcher.js");

// —— A. token 文件格式 ——
const home = join(tmpdir(), `cua-launch-${Date.now()}`);
mkdirSync(home, { recursive: true });
const socketPath = join(home, "broker.sock");
const token = randomBytes(32).toString("hex");
const tokenFile = await mod.writeOneShotHelperTokenFile({ socketPath, token });
const tokensDir = dirname(tokenFile);
assert.equal(tokensDir, join(home, ".tokens"), "token dir is <socketDir>/.tokens");
assert.equal(statSync(tokensDir).mode & 0o777, 0o700, "tokens dir mode 0700");
assert.match(tokenFile, /\.broker-token-\d+-[0-9a-f]{16}$/, "token filename shape");
assert.equal(statSync(tokenFile).mode & 0o777, 0o600, "token file mode 0600");
assert.equal(readFileSync(tokenFile, "utf8"), token, "content is token");
console.log("A. token file: dir 0700 / file 0600 / name shape OK");

// —— B. 原版参数序 ——
const argsDeadline = String(Date.now() + 30000);
const cancelDir = join(home, ".launch-cancel");
mkdirSync(cancelDir, { recursive: true });
const cancelSentinel = join(
  cancelDir,
  `.broker-launch-cancel-${randomUUID()}.sentinel`,
);
const args = mod.JC({
  appPath: helperApp,
  socketPath,
  tokenFile,
  presentationTokenFile: "/tmp/presentation-token",
  version: "3.11.2",
  expectedAppBundlePath: helperApp,
  brokerLaunchGuard: {
    deadlineEpochMs: Number(argsDeadline),
    cancelFilePath: cancelSentinel,
  },
  exitLogPath: `${socketPath}.exit.log`,
  ghostCursorOverlay: true,
  pipMode: true,
}, process.pid);
const expectedPrefix = [
  "-n", "-g", helperApp, "--args",
  "--socket", socketPath,
  "--token-file", tokenFile,
  "--presentation-token-file", "/tmp/presentation-token",
  "--version", "3.11.2",
  "--expected-app-bundle-path", helperApp,
  "--broker-launch-deadline-epoch-ms", argsDeadline,
  "--broker-launch-cancel-file", cancelSentinel,
  "--exit-log", `${socketPath}.exit.log`,
  "--launcher-pid", String(process.pid),
  "--ghost-cursor-overlay",
  "--pip-mode",
];
assert.deepEqual(args, expectedPrefix);
console.log("B. arg vector matches original Uxe order");

// —— C. 原版向量 E2E ——
// E2E 段（C/C2/F）需要：① 可执行 helper（官方 staging 或自建产物）；
// ② 产品 launcher 祖先（ZCode 签名进程）——CI runner 没有，设
// MAC_LAUNCH_CONTRACT_E2E=0 时只跑离线段（A/B），供 CI 锁发射契约形状。
// 全新 checkout 无官方 staging 资产时自动降级为离线段（与 CI 的 E2E=0 等效）。
const runE2E =
  process.env.MAC_LAUNCH_CONTRACT_E2E !== "0" && existsSync(join(helperApp, "Contents", "MacOS", "ZCode Computer Use"));
const launcherPid = (() => {
  let pid = process.pid;
  for (let i = 0; i < 16; i += 1) {
    const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const ppid = Number.parseInt(out, 10);
    if (!Number.isInteger(ppid) || ppid <= 1) break;
    pid = ppid;
  }
  return pid;
})();
const exe = join(helperApp, "Contents", "MacOS", "ZCode Computer Use");
if (runE2E) {
assert.ok(existsSync(exe), "helper executable exists");
const exitLogPath = `${socketPath}.exit.log`;
const presentationToken = randomBytes(32).toString("hex");
const presentationTokenFile = join(home, ".tokens", "presentation-token");
writeFileSync(presentationTokenFile, presentationToken, { mode: 0o600 });
const child = spawn(
  exe,
  [
    "--socket", socketPath,
    "--token-file", tokenFile,
    "--presentation-token-file", presentationTokenFile,
    "--version", "3.11.2",
    "--expected-app-bundle-path", helperApp,
    "--exit-log", exitLogPath,
    "--launcher-pid", String(launcherPid),
    "--ghost-cursor-overlay",
    "--pip-mode",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let stdout = "";
child.stdout.on("data", (d) => (stdout += d));
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
assert.ok(ready, `helper ready (stderr tail: ${stdout.slice(-200)})`);
const exchange = (requests) =>
  new Promise((res, rej) => {
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
    setTimeout(() => (sock.destroy(), rej(new Error("exchange timeout"))), 10000);
  });
const replies = await exchange([
  { id: 1, method: "authenticate", params: { token } },
  { id: 2, method: "broker_info", params: {} },
]);
assert.equal(replies[0].ok, true, "token authenticate passes");
assert.equal(replies[1].ok, true, "broker_info claim with token passes");
const bad = await exchange([{ id: 3, method: "authenticate", params: { token: "wrong" } }]);
assert.equal(bad[0].ok, false, "wrong token rejected");
assert.equal(bad[0].error?.code, "not_authorized");
// callBrokerMethod 的 token 通路（同一条存活连接面上验证）
const broker = await import("../broker/index.js");
// 用只读方法（screen_capture_status）：ping 不在 READ_ONLY 集，会触发 controller
// 租约仲裁——测试进程树外的生产 helper 持全局租约时必 busy，属环境噪声。
const pinged = await broker.callBrokerMethod({
  socketPath,
  method: "screen_capture_status",
  token,
  timeoutMs: 3000,
});
assert.ok(pinged === "unknown" || typeof pinged === "string", "callBrokerMethod with token works");
let rejected = false;
try {
  await broker.callBrokerMethod({
    socketPath,
    method: "screen_capture_status",
    token: "wrong-token",
    timeoutMs: 3000,
  });
} catch (error) {
  rejected = /auth/i.test(error?.message ?? "");
}
assert.ok(rejected, "callBrokerMethod with wrong token rejected as auth error");
// F. presentation 角色：PiP 方法须 presentation 权限，工具角色不可越权
const pipExchange = (requests) => exchange(requests);
const presReplies = await pipExchange([
  { id: 1, method: "authenticate", params: { token: presentationToken } },
  { id: 2, method: "pip_session_handshake", params: {} },
]);
assert.equal(presReplies[0].ok, true, "presentation token authenticate passes");
assert.equal(presReplies[0].result?.role, "presentation", "role is presentation");
assert.notEqual(
  presReplies[1].error?.message ?? "",
  "PiP session methods require presentation authority",
  "presentation role passes the pip authority gate",
);
const toolRolePip = await pipExchange([
  { id: 1, method: "authenticate", params: { token } },
  { id: 2, method: "pip_session_handshake", params: {} },
]);
assert.equal(toolRolePip[1].ok, false, "tool role cannot invoke pip methods");
assert.match(toolRolePip[1].error?.message ?? "", /presentation authority/);
// SIGTERM 触发优雅 drain；无 AX 授权的 adhoc 产物上 post-drain mouseUp 会失败，
// 按原版语义 refuse unsafe shutdown（不退出，两侧代码一致）→ 测试用 SIGKILL 兜底。
  // H. runtime 消费层 token 端到端（node_repl 宿主的实际入口）：
  // createComputerUseRuntime 从 env 读 socket/token → brokerExchange 自动
  // authenticate → 只读方法成功；错 token 时 authenticate 被拒。
  const runtime = await import("../runtime.js");
  const rt = runtime.createComputerUseRuntime({
    brokerSocketPath: socketPath,
    env: { DRORA_CUA_PERMISSION_BROKER_TOKEN: token },
  });
  const status = await rt.execute({ toolName: "screen_capture_status", arguments: {} });
  // adhoc 产物无屏幕录制授权时真实值为 "denied"；断言点在"认证通过并拿到 broker 真值"
  assert.ok(
    ["granted", "denied", "unknown", "not-determined"].includes(status),
    `runtime execute with token returns broker status (got ${JSON.stringify(status)})`,
  );
  const rtBad = runtime.createComputerUseRuntime({
    brokerSocketPath: socketPath,
    env: { DRORA_CUA_PERMISSION_BROKER_TOKEN: "wrong" },
  });
  await assert.rejects(
    () => rtBad.execute({ toolName: "screen_capture_status", arguments: {} }),
    (error) => /auth/i.test(error?.message ?? ""),
    "runtime execute with wrong token auth-rejected",
  );
  console.log("H. runtime consumer layer: token env → authenticate → broker result OK");
  child.kill();
  setTimeout(() => { try { child.kill(9); } catch {} }, 2000);
child.stdout.destroy();
child.stderr.destroy();
await new Promise((r) => setTimeout(r, 300));
console.log("C. full original vector E2E: ready / token auth / broker_info / bad-token rejected");
console.log("C2. callBrokerMethod token passthrough (screen_capture_status): ok / wrong-token auth-rejected");
console.log("F. presentation role: pip gate passes with presentation token / tool role rejected");
console.log(existsSync(exitLogPath) ? "   exit-log file written" : "   exit-log not yet flushed (non-fatal)");

// —— G. 真实 LaunchServices 发射（生产路径，opt-in：MAC_LAUNCH_CONTRACT_OPEN=1）——
// 前序段落都是直连可执行文件 spawn；生产实际走 `/usr/bin/open` 经 LaunchServices：
// 不继承测试进程 env（token 只能靠文件交付）、stdout 不可见（ready 只能靠 socket 探测）。
// 本段以原版 q9 白名单环境发起真实 open，验证 token 文件交付 + LS 接单 + 认领 + 终止。
if (process.env.MAC_LAUNCH_CONTRACT_OPEN === "1" && runE2E) {
  const openSocketPath = join(home, "open-broker.sock");
  const openToken = randomBytes(32).toString("hex");
  const openTokenFile = await mod.writeOneShotHelperTokenFile({
    socketPath: openSocketPath,
    token: openToken,
  });
  // launcher = 进程树顶端最近的桌面主进程（dev.zcode.app/8A5X4JJ39T，与场景二同配方）
  const openArgs = mod.JC(
    {
      appPath: helperApp,
      socketPath: openSocketPath,
      tokenFile: openTokenFile,
      exitLogPath: `${openSocketPath}.exit.log`,
    },
    launcherPid,
  );
  // q9 白名单环境（证明 helper 不依赖测试进程的任何其它 env）
  const openEnv = {};
  for (const key of ["HOME", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME", "SHELL", "TERM", "LANG"]) {
    if (process.env[key]) openEnv[key] = process.env[key];
  }
  openEnv.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
  const { execFileSync: efs } = await import("node:child_process");
  efs("/usr/bin/open", openArgs, { env: openEnv, timeout: 10000 });
  // stdout 不可见：轮询 socket connect + token authenticate 直到 ready
  let lastErr = null;
  const pollAuth = async () => {
    try {
      const replies = await new Promise((res, rej) => {
        const sock = connect(openSocketPath);
        let buf = "";
        const out = [];
        sock.on("error", (e) => (sock.destroy(), rej(e)));
        sock.on("connect", () => {
          sock.write(JSON.stringify({ id: 1, method: "authenticate", params: { token: openToken } }) + "\n");
          sock.write(JSON.stringify({ id: 2, method: "broker_info", params: {} }) + "\n");
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
        setTimeout(() => (sock.destroy(), rej(new Error("open poll timeout"))), 3000);
      });
      return replies;
    } catch (error) {
      lastErr = error?.message ?? String(error);
      return null;
    }
  };
  let openReplies = null;
  const openDeadline = Date.now() + 25000;
  while (Date.now() < openDeadline) {
    openReplies = await pollAuth();
    if (openReplies && openReplies[0]?.ok === true) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  if (openReplies?.[0]?.ok !== true) {
    console.log("DIAG lastErr:", lastErr);
    console.log("DIAG exit-log:", readFileSync(`${openSocketPath}.exit.log`, "utf8").slice(-800));
  }
  assert.ok(openReplies?.[0]?.ok === true, "LS launch: token file delivered, authenticate passes");
  assert.equal(openReplies[1]?.result?.bundle_id, "dev.zcode.cua-helper", "LS launch broker_info claims");
  const helperPid = openReplies[1].result.pid;
  console.log(`G. real LaunchServices open: LS accepted args, token file delivered (helper pid=${helperPid})`);
  process.kill(helperPid);
  setTimeout(() => { try { process.kill(helperPid, 9); } catch {} }, 2000);
  await new Promise((r) => setTimeout(r, 500));
}
} // end runE2E



// —— D. services 侧 agent env 分支：host 带 token → env 注入 token 键 ——
// 直接验证 buildCuaProductHelperAgentEnv 对"带 token 的 host"注入
// DRORA_CUA_PERMISSION_BROKER_TOKEN（最小 fake host，走 transport 分支）。
// services dist 依赖 tsconfig 路径映射，plain node 多数不可加载；可加载则验证 D 段。
const services = await import(resolve(
  packageRoot,
  "../../services/dist/node.js",
)).catch(() => null);
if (services?.buildCuaProductHelperAgentEnv) {
  const fakeHost = {
    running: true,
    socketPath,
    pluginAuthority: "authority-x",
    token,
    presentationToken: randomBytes(32).toString("hex"),
    async start() {
      return { socketPath, pluginAuthority: "authority-x", token };
    },
    async checkHealth() {
      return { ok: true };
    },
  };
  const env = await services.buildCuaProductHelperAgentEnv(fakeHost);
  assert.equal(env.DRORA_CUA_PERMISSION_BROKER_TOKEN, token, "agent env carries token");
  console.log("D. agent spawn env carries DRORA_CUA_PERMISSION_BROKER_TOKEN");
} else {
  console.log("D. services dist 未构建，跳过（agent env 分支由 typecheck+人工覆盖）");
}

rmSync(home, { recursive: true, force: true });
console.log("\nmac 发射契约验收通过 ✓");
