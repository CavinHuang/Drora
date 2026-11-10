#!/usr/bin/env node
// mac 发射契约验收（R10 认证模型换代版，2026-11-10）。
// 用法：node test/mac-launch-contract.mjs [helper.app]
//   缺省 helper = packages/zcode-cua-helper/dist-cua-helper 自建产物。
// 官方 0.6.5 契约（SEA 逐字证据）：producer 零 token（token 族 0 出现）、
// LS 发射向量 buildHelperOpenArgs 无 token 参数、helper 无 token 门、
// authenticate=身份声明（client_type/workspace/session），presentation 角色
// 由 peerVerdict+peerPresentationEligible 门复核。
// 覆盖：
//   A. token 链退役（导出移除 + 向量零 token 旗）；
//   B. 官方参数序：--socket → --version → --expected-app-bundle-path →（变体旗）→
//      guard(deadline/cancel) → --exit-log → --launcher-pid →（逃生旗）→ --ghost-cursor-overlay → --pip-mode；
//   C. E2E：完整向量直启 helper（双 dev 逃生旗走 same-uid peer 路径），
//      authenticate 身份过 / token 参数被忽略 / broker_info 认领成功；
//   C2. callBrokerMethod 免 token 通路；
//   F. presentation 角色：same-uid 逃生 + launcher 世系过 / tool 角色不可越权；
//   H. runtime 消费层免 token env → broker 真值；
//   G. 真实 LaunchServices 发射（opt-in MAC_LAUNCH_CONTRACT_OPEN=1，免 token 轮询）；
//   D. services 侧 agent env：不再携带 broker token 键。
import { spawn, execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const packageRoot = new URL("..", import.meta.url).pathname;
const helperApp =
  process.argv[2] ??
  resolve(packageRoot, "../zcode-cua-helper/dist-cua-helper/Drora Computer Use.app");
const mod = await import("../broker/server/helper-launcher.js");

const home = join(tmpdir(), `cua-launch-${Date.now()}`);
mkdirSync(home, { recursive: true });
const socketPath = join(home, "broker.sock");
const exitLogPath = `${socketPath}.exit.log`;

// —— A. token 链退役（负契约）——
assert.equal(typeof mod.writeOneShotHelperTokenFile, "undefined", "one-shot token writer retired");
const probeArgs = mod.JC(
  { appPath: helperApp, socketPath, version: "3.17.2" },
  process.pid,
);
assert.ok(!probeArgs.includes("--token-file") && !probeArgs.includes("--presentation-token-file"),
  "launch vector carries no token flags");
console.log("A. token 链退役：writer 移除 / 向量零 token 旗 OK");

// —— B. 官方参数序（R10 后 JC 实序）——
const argsDeadline = String(Date.now() + 30000);
const cancelDir = join(home, ".launch-cancel");
mkdirSync(cancelDir, { recursive: true });
const cancelSentinel = join(cancelDir, `.broker-launch-cancel-${randomUUID()}.sentinel`);
const args = mod.JC(
  {
    appPath: helperApp,
    socketPath,
    version: "3.17.2",
    expectedAppBundlePath: helperApp,
    brokerLaunchGuard: { deadlineEpochMs: Number(argsDeadline), cancelFilePath: cancelSentinel },
    exitLogPath,
    allowUnsignedLauncherLocalDev: true,
    allowExternalBrokerClientLocalDev: true,
    ghostCursorOverlay: true,
    pipMode: true,
  },
  process.pid,
);
const expectedVector = [
  "-n", "-g", helperApp, "--args",
  "--socket", socketPath,
  "--version", "3.17.2",
  "--expected-app-bundle-path", helperApp,
  "--broker-launch-deadline-epoch-ms", argsDeadline,
  "--broker-launch-cancel-file", cancelSentinel,
  "--exit-log", exitLogPath,
  "--launcher-pid", String(process.pid),
  "--allow-unsigned-launcher-local-dev",
  "--allow-external-broker-client-local-dev",
  "--ghost-cursor-overlay",
  "--pip-mode",
];
assert.deepEqual(args, expectedVector);
console.log("B. arg vector matches official 0.6.5 order (token-free)");

// —— C. E2E（官方向量直启；需可执行 helper，CI 可 MAC_LAUNCH_CONTRACT_E2E=0 跳过）——
const runE2E =
  process.env.MAC_LAUNCH_CONTRACT_E2E !== "0" &&
  existsSync(join(helperApp, "Contents", "MacOS", "Drora Computer Use"));
const exe = join(helperApp, "Contents", "MacOS", "Drora Computer Use");
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
if (runE2E) {
  assert.ok(existsSync(exe), "helper executable exists");
  // 同源新向量的裸 args 直启（官方门序：无 --launcher-pid → launcher 门整体跳过；
  // 双逃生旗（路线 A 折叠 allow=true 的产物）使 unsigned 测试进程按 same-uid
  // peer 逃生接入，presentation 走官方「双逃生并开」短路）。
  const child = spawn(
    exe,
    [
      "--socket", socketPath,
      "--version", "3.17.2",
      "--expected-app-bundle-path", helperApp,
      "--exit-log", exitLogPath,
      "--allow-unsigned-launcher-local-dev",
      "--allow-external-broker-client-local-dev",
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
  assert.ok(ready, `helper ready (stdout tail: ${stdout.slice(-300)})`);
  // C. 身份声明过认领；token 参数被官方语义忽略（带伪 token 仍 ok）。
  const replies = await exchange([
    { id: 1, method: "authenticate", params: { client_type: "zcode_cua_mcp" } },
    { id: 2, method: "broker_info", params: {} },
  ]);
  assert.equal(replies[0].ok, true, "identity authenticate passes");
  assert.equal(replies[1].ok, true, "broker_info claim passes");
  assert.equal(replies[1].result?.bundle_id, "dev.drora.cua-helper", "broker_info identity");
  const bogusToken = await exchange([
    { id: 3, method: "authenticate", params: { client_type: "zcode_cua_mcp", token: "bogus-token-ignored" } },
  ]);
  assert.equal(bogusToken[0].ok, true, "token param ignored per official 0.6.5");
  console.log("C. E2E: identity authenticate / broker_info claim / token param ignored OK");

  // C2. callBrokerMethod 免 token 通路（只读方法，不触 controller 仲裁）。
  const broker = await import("../broker/index.js");
  const pinged = await broker.callBrokerMethod({
    socketPath,
    method: "screen_capture_status",
    timeoutMs: 3000,
  });
  assert.ok(typeof pinged === "string", `callBrokerMethod token-free works (got ${JSON.stringify(pinged)})`);
  console.log("C2. callBrokerMethod token-free passthrough OK");

  // F. presentation 角色：same-uid 逃生 verdict + launcher 世系（本测试进程直系）→ 过；
  // tool 角色调用 pip 会话方法 → presentation authority 拒。
  const presReplies = await exchange([
    { id: 1, method: "authenticate", params: { client_type: "zcode_cua_mcp", role: "presentation" } },
    { id: 2, method: "pip_session_handshake", params: {} },
  ]);
  assert.equal(presReplies[0].ok, true, "presentation role authenticate passes (escape+lineage)");
  assert.equal(presReplies[0].result?.role, "presentation", "role is presentation");
  assert.notEqual(
    presReplies[1].error?.message ?? "",
    "PiP session methods require presentation authority",
    "presentation role passes the pip authority gate",
  );
  const toolRolePip = await exchange([
    { id: 1, method: "authenticate", params: { client_type: "zcode_cua_mcp" } },
    { id: 2, method: "pip_session_handshake", params: {} },
  ]);
  assert.equal(toolRolePip[1].ok, false, "tool role cannot invoke pip methods");
  assert.match(toolRolePip[1].error?.message ?? "", /presentation authority/);
  console.log("F. presentation role: escape+lineage pass / tool role rejected OK");

  // H. runtime 消费层：免 token env → authenticate → broker 真值。
  const runtime = await import("../runtime.js");
  const rt = runtime.createComputerUseRuntime({
    brokerSocketPath: socketPath,
    env: {},
  });
  const status = await rt.execute({ toolName: "screen_capture_status", arguments: {} });
  assert.ok(
    ["granted", "denied", "unknown", "not-determined"].includes(status),
    `runtime execute token-free returns broker status (got ${JSON.stringify(status)})`,
  );
  console.log("H. runtime consumer layer: token-free env → broker result OK");

  // G. 真实 LaunchServices 发射（opt-in；免 token，身份轮询认领）。
  if (process.env.MAC_LAUNCH_CONTRACT_OPEN === "1") {
    const openSocketPath = join(home, "open-broker.sock");
    const openArgs = mod.JC(
      {
        appPath: helperApp,
        socketPath: openSocketPath,
        exitLogPath: `${openSocketPath}.exit.log`,
        allowUnsignedLauncherLocalDev: true,
        allowExternalBrokerClientLocalDev: true,
      },
      process.pid,
    );
    const openEnv = {};
    for (const key of ["HOME", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME", "SHELL", "TERM", "LANG"]) {
      if (process.env[key]) openEnv[key] = process.env[key];
    }
    openEnv.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
    const { execFileSync: efs } = await import("node:child_process");
    efs("/usr/bin/open", openArgs, { env: openEnv, timeout: 10000 });
    let openReplies = null;
    let lastErr = null;
    const ask = (sockPath) =>
      new Promise((res, rej) => {
        const sock = connect(sockPath);
        let buf = "";
        const out = [];
        sock.on("error", (e) => (sock.destroy(), rej(e)));
        sock.on("connect", () => {
          sock.write(JSON.stringify({ id: 1, method: "authenticate", params: { client_type: "zcode_cua_mcp" } }) + "\n");
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
    const openDeadline = Date.now() + 25000;
    while (Date.now() < openDeadline) {
      try {
        openReplies = await ask(openSocketPath);
        if (openReplies?.[0]?.ok === true) break;
      } catch (error) {
        lastErr = error?.message ?? String(error);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (openReplies?.[0]?.ok !== true) {
      console.log("DIAG lastErr:", lastErr);
      const logP = `${openSocketPath}.exit.log`;
      if (existsSync(logP)) console.log("DIAG exit-log:", readFileSync(logP, "utf8").slice(-800));
    }
    assert.ok(openReplies?.[0]?.ok === true, "LS launch: identity authenticate passes");
    assert.equal(openReplies[1]?.result?.bundle_id, "dev.drora.cua-helper", "LS launch broker_info claims");
    const helperPid = openReplies[1].result.pid;
    console.log(`G. real LaunchServices open: token-free claim (helper pid=${helperPid})`);
    process.kill(helperPid);
    setTimeout(() => { try { process.kill(helperPid, 9); } catch {} }, 2000);
    await new Promise((r) => setTimeout(r, 500));
  }

  child.kill();
  setTimeout(() => { try { child.kill(9); } catch {} }, 2000);
  child.stdout.destroy();
  child.stderr.destroy();
  await new Promise((r) => setTimeout(r, 300));
  console.log(existsSync(exitLogPath) ? "   exit-log file written" : "   exit-log not yet flushed (non-fatal)");
} // end runE2E

// —— D. services 侧 agent env：token 键退役（fake host 走 transport 分支）——
const services = await import(resolve(packageRoot, "../../services/dist/node.js")).catch(() => null);
if (services?.buildCuaProductHelperAgentEnv) {
  const fakeHost = {
    running: true,
    socketPath,
    pluginAuthority: "authority-x",
    async start() {
      return { socketPath, pluginAuthority: "authority-x" };
    },
    async checkHealth() {
      return { ok: true };
    },
  };
  const env = await services.buildCuaProductHelperAgentEnv(fakeHost);
  assert.equal(env.DRORA_CUA_PERMISSION_BROKER_TOKEN, undefined, "agent env carries no broker token");
  assert.equal(env.ZCODE_CUA_PERMISSION_BROKER_TOKEN, undefined, "agent env carries no ZCODE broker token either");
  assert.equal(env.ZCODE_CUA_PERMISSION_BROKER_SOCKET, socketPath, "agent env carries socket (ZCODE_ face)");
  console.log("D. agent spawn env: token-free / socket ZCODE_ face OK");
} else {
  console.log("D. services dist 未构建，跳过（agent env 分支由 typecheck+人工覆盖）");
}

rmSync(home, { recursive: true, force: true });
console.log("\nmac 发射契约验收通过 ✓（R10 认证模型换代版）");
