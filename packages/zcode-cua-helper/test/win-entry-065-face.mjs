#!/usr/bin/env node
// L2 win entry 0.6.5 面还原回归（specs/win32-cua-0.6.5-implementation-design.md §四
// L2.1-L2.5；W0 批）。官方证据锚（官方 @zcode/zcode-cua 0.6.5 win32-x64 运行时，
// cua-helper.zip 解包 dist/windows-helper.js，行号 + 字节偏移双锚；契约文档
// native/reverse/data/win32-0.6.5-js-contract.md）：
//   L2.1 argv 契约：parseWindowsDevHelperConfig @34053-34090（字节 1345013）——
//       allowedFlags={--ghost-cursor-overlay,--disable-multi-cursor-overlay} 先滤出、
//       positional 恰 4、extras 拒绝、条件展开返回 ghost 双旗
//   L2.2 token 退场：configSchema @34048-34052（字节 1344726）无 token 字段；官方
//       entry 全文 authToken 零出现；--token 出现在 argv 按 extras 拒绝
//   L2.3 鉴权门：WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN @19866（字节 761722）；
//       开门 stderr 告警 @34183-34185；assertPeerIdentityAuthCapable 文案
//       @34093-34099（字节 1346700，品牌词 ZCode→Drora，env 键 ZCODE_CUA_DEV_MODE
//       不改）；gateDetail 拼接 @34235-34242（退出码 2=argv / 1=gate 与启动失败）。
//       注意：官方发行面常量恒 true → 门异常不可达，其文案以产物字面量钉扎
//       （r3 先例 :29-34），开门语义另有行为面断言
//   L2.4 延迟原生初始化：createDeferredSurface @34004-34047（字节 1343453）；
//       deferNativeInitialization 决策 @34180（未注入 startBroker 恒延迟）；
//       onTransportReady 顺序 @34198-34214（transport_ready 控制消息 @34199-34204
//       字节 1350913 → 失败即抛 "transport-ready IPC channel closed" → loadNative →
//       门校验 → ghost → createSystemSurface → setTarget）；runHelper 侧
//       deferBackendInitialization/onTransportReady 官方 @33625/:33789-33854
//       （createDeferredBackend @33584-33612 字节 1326608，backend 接线 @33816）
//   L2.5 ghost plumb：enableGhostCursorOnNative @34162-34166（字节 1348932）——
//       ghostSetEnabled?.(true) + ghostSetMultiCursorEnabled?.(!disable)，全可选链
// 运行：node test/win-entry-065-face.mjs（需先 tsc -p tsconfig.json 产出 dist；且
// 运行环境不设 NODE_ENV=production——dev 判定常量在 dist 模块加载期求值，与 r3/r8 同）。
// 说明：注入 startBroker（默认）走立即分支；显式 deferNativeInitialization:true 走
// 官方同一条延迟分支代码（生产缺省"未注入 startBroker → 延迟"的决策式与双分支接线
// 另以 dist 产物字面量钉扎，先例=r3-behavior-restoration.mjs:29-34）。
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runWindowsDevHelper } from "../dist/broker/server/windowsDevHelperMain.js";

// fileURLToPath 而非 URL.pathname：win 宿主 pathname 形如 /D:/... 不是 fs 路径
// （join 后成 D:\D:\... 双盘符，readFileSync 即崩——mac 上 pathname 恰可用，win 机 W1 首跑暴露）
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const PIPE = "\\\\.\\pipe\\zcode-cua-helper-test-065";
const devEntrySource = readFileSync(
  join(packageRoot, "dist/broker/server/windowsDevHelperMain.js"),
  "utf8",
);
const helperMainSource = readFileSync(
  join(packageRoot, "dist/broker/server/helperMain.js"),
  "utf8",
);

// —— 注入式 fake runtime / natives（r8-input-guards.mjs 同款直驱风格）——
// state.events 是统一事件日志：runtime.send 投递（send:<type>）与注入件
// （loadNative/createSystem/startBroker）共用，供跨层顺序断言。

function makeRuntime({ argv = [], env = {}, sendBehavior = null } = {}) {
  const state = { sent: [], stderr: [], stdout: [], exits: [], events: [] };
  const send =
    sendBehavior ??
    ((message, callback) => {
      state.sent.push(message);
      state.events.push(`send:${message.type}`);
      callback(null);
    });
  const runtime = {
    argv: ["node", "windows-helper.js", ...argv],
    env,
    platform: "win32",
    pid: 42123,
    send,
    exit: (code) => {
      state.exits.push(code);
    },
    on: () => {},
    off: () => {},
    writeStdout: (text) => {
      state.stdout.push(text);
    },
    writeStderr: (text) => {
      state.stderr.push(text);
    },
  };
  return { runtime, state };
}

function makeFakeNative({ capable = false, ghost = true } = {}) {
  const calls = { ghostSetEnabled: [], ghostSetMultiCursorEnabled: [] };
  const native = {};
  if (ghost) {
    native.ghostSetEnabled = (enabled) => calls.ghostSetEnabled.push(enabled);
    native.ghostSetMultiCursorEnabled = (enabled) =>
      calls.ghostSetMultiCursorEnabled.push(enabled);
  }
  if (capable) {
    // 官方 @34094 门判据四原语（win addon 0.6.5 面；测试只须 typeof function）。
    native.getPeerCredentials = () => null;
    native.verifyProcessCodeSignatureWithAuditToken = () => false;
    native.verifyProcessCodeSignature = () => false;
    native.parentProcessPid = () => 0;
  }
  return { native, calls };
}

function makeInjections(state, { native, fireTransportReady = false } = {}) {
  return {
    loadNativeAddon: () => {
      state.events.push("loadNative");
      return native;
    },
    createSystemSurface: () => {
      state.events.push("createSystem");
      return { marker: "sys" };
    },
    startBroker: async (brokerOptions) => {
      state.events.push("startBroker");
      state.brokerOptions = brokerOptions;
      // 真 runHelper 顺序（官方 helperMain :33844-33883）：server.start() →
      // onTransportReady → onReady。fireTransportReady 模拟生产 await 链，
      // onTransportReady 抛错即向上传播（runWindowsDevHelper catch 接住）。
      if (fireTransportReady && brokerOptions.onTransportReady) {
        await brokerOptions.onTransportReady({ socketPath: brokerOptions.socketPath });
      }
      brokerOptions.onReady?.({ socketPath: brokerOptions.socketPath });
      return { stop: async () => {} };
    },
    startLivenessWatchdog: (parentPid) => {
      state.watchdogPid = parentPid;
      return () => {};
    },
  };
}

const PRODUCTION_ENV = { ZCODE_RUNTIME_ENV: "production" }; // 告警必现（无 local dev 请求）
const DEV_MODE_ENV = { ZCODE_RUNTIME_ENV: "development", ZCODE_CUA_DEV_MODE: "1" }; // 显式 dev → 无告警

async function expectStartupFailure(argvSuffix, env = {}) {
  const { runtime, state } = makeRuntime({ argv: argvSuffix, env });
  const { native } = makeFakeNative({ capable: true });
  const result = await runWindowsDevHelper({
    runtime,
    ...makeInjections(state, { native }),
  });
  assert.equal(result, void 0, `argv [${argvSuffix.join(" ")}] must fail startup`);
  assert.deepEqual(state.exits, [2], `argv [${argvSuffix.join(" ")}] must exit(2)`);
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].protocol, "zcode-cua-windows-dev/v1");
  assert.equal(state.sent[0].type, "error");
  assert.equal(state.sent[0].message, "Windows Computer Use Helper failed to start.");
  assert.equal(state.stderr.join(""), "Windows Computer Use Helper failed to start.\n");
  // argv 失败在组合根之前：事件流只有 send:error，无 loadNative/createSystem/startBroker。
  assert.deepEqual(state.events, ["send:error"], "no native load on argv failure");
  return state;
}

async function expectStartupSuccess(argvSuffix, { env = {}, capable = true, ghost = true } = {}) {
  const { runtime, state } = makeRuntime({ argv: argvSuffix, env });
  const fake = makeFakeNative({ capable, ghost });
  const handle = await runWindowsDevHelper({
    runtime,
    ...makeInjections(state, { native: fake.native }),
  });
  assert.ok(handle && typeof handle.stop === "function", "startup must succeed");
  assert.deepEqual(state.exits, [], "no exit on success");
  assert.ok(state.brokerOptions, "startBroker must be invoked");
  return { state, calls: fake.calls };
}

// —— L2.1 + L2.2 argv 契约矩阵（官方 @34053-34090 逐字面）——

// 4 positional 基线：无 ghost 旗 → 整个 enableGhostCursorOnNative no-op（@34163）。
{
  const { state, calls } = await expectStartupSuccess([
    "--socket",
    PIPE,
    "--parent-pid",
    "4242",
  ]);
  assert.equal(state.brokerOptions.socketPath, PIPE);
  assert.strictEqual(state.watchdogPid, 4242, "parentPid coerce number 透传 watchdog");
  assert.deepEqual(calls.ghostSetEnabled, [], "无 --ghost-cursor-overlay 时 no-op");
  assert.deepEqual(calls.ghostSetMultiCursorEnabled, []);
  console.log("L2.1 argv 基线 4-positional：OK（ghost no-op）");
}

// +--ghost-cursor-overlay（5 args）：ghostSetEnabled(true)+ghostSetMultiCursorEnabled(true)。
{
  const { calls } = await expectStartupSuccess([
    "--socket",
    PIPE,
    "--parent-pid",
    "4242",
    "--ghost-cursor-overlay",
  ]);
  assert.deepEqual(calls.ghostSetEnabled, [true]);
  assert.deepEqual(calls.ghostSetMultiCursorEnabled, [true]);
  console.log("L2.5 ghost 单旗：ghostSetEnabled(true)+MultiCursor(true) OK");
}

// 双旗（6 args）：ghostSetMultiCursorEnabled(false)（官方 @34165 !disable）。
{
  const { calls } = await expectStartupSuccess([
    "--socket",
    PIPE,
    "--parent-pid",
    "4242",
    "--ghost-cursor-overlay",
    "--disable-multi-cursor-overlay",
  ]);
  assert.deepEqual(calls.ghostSetEnabled, [true]);
  assert.deepEqual(calls.ghostSetMultiCursorEnabled, [false]);
  console.log("L2.5 ghost 双旗：ghostSetMultiCursorEnabled(false) OK");
}

// 仅 --disable-multi-cursor-overlay（5 args）：接受但 ghost 整体 no-op。
{
  const { calls } = await expectStartupSuccess([
    "--disable-multi-cursor-overlay",
    "--socket",
    PIPE,
    "--parent-pid",
    "4242",
  ]);
  assert.deepEqual(calls.ghostSetEnabled, []);
  assert.deepEqual(calls.ghostSetMultiCursorEnabled, []);
  console.log("L2.1 仅 disable 旗（任意次序）：接受且 ghost no-op OK");
}

// 旗可重复出现（allowedFlags 逐 token 过滤，includes 判定）。
{
  await expectStartupSuccess([
    "--ghost-cursor-overlay",
    "--ghost-cursor-overlay",
    "--socket",
    PIPE,
    "--parent-pid",
    "4242",
  ]);
  console.log("L2.1 旗重复出现：接受 OK");
}

// 旧 4-arg 严格门死链解除的对照面：5-6 args 已在上方接受；坏参族仍拒（exit 2）。
await expectStartupFailure(["--socket", PIPE, "--parent-pid", "4242", "--extra"]);
await expectStartupFailure(["--socket", PIPE]); // 缺 --parent-pid
await expectStartupFailure([PIPE, "4242", "--socket", "--parent-pid"]); // 值位错乱 → extras
await expectStartupFailure(["--socket", "/tmp/not-a-pipe", "--parent-pid", "4242"]); // schema refine
await expectStartupFailure(["--socket", PIPE, "--parent-pid", "abc"]); // coerce 拒
await expectStartupFailure(["--socket", PIPE, "--parent-pid", "0"]); // positive 拒

// --token 出现在 argv 仍拒（不在 allowedFlags → extras/positional 计数；凭据不进参数表）。
await expectStartupFailure(["--socket", PIPE, "--parent-pid", "4242", "--token"]);
await expectStartupFailure(["--socket", PIPE, "--parent-pid", "4242", "--token", "secret"]);
console.log("L2.1 坏参/--token/extras 矩阵：exit(2) 全拒 OK");

// token-less 启动：env 无 ZCODE_CUA_PERMISSION_BROKER_TOKEN 仍可启动，startBroker
// 不含 authToken 键（官方 entry authToken 零出现）。
{
  const { state } = await expectStartupSuccess(
    ["--socket", PIPE, "--parent-pid", "4242"],
    { env: { ZCODE_RUNTIME_ENV: "development" } }, // 显式 dev：免告警噪音，token 仍缺省
  );
  assert.ok(!("authToken" in state.brokerOptions), "startBroker 无 authToken 键");
  assert.ok(
    !devEntrySource.includes("ZCODE_CUA_PERMISSION_BROKER_TOKEN"),
    "win entry 产物无 BROKER_TOKEN_ENV 字面量",
  );
  console.log("L2.2 token-less 启动 + 产物零 token 字面量：OK");
}

// —— L2.3 鉴权门同构 ——

// 开门 stderr 告警（官方 @34183-34185 逐字；生产 env 无 local dev 请求必现）。
{
  const { state } = await expectStartupSuccess(
    ["--socket", PIPE, "--parent-pid", "4242"],
    { env: PRODUCTION_ENV },
  );
  assert.equal(
    state.stderr[0],
    "cua windows helper: peer identity verification temporarily disabled (WINDOWS_PEER_IDENTITY_GATE_TEMPORARILY_OPEN); any local process can drive Computer Use\n",
  );
  console.log("L2.3 开门 stderr 告警逐字：OK");
}

// ZCODE_CUA_DEV_MODE=1（显式 dev）→ 无告警。
{
  const { state } = await expectStartupSuccess(
    ["--socket", PIPE, "--parent-pid", "4242"],
    { env: DEV_MODE_ENV },
  );
  assert.deepEqual(
    state.stderr.filter((line) => line.includes("peer identity verification")),
    [],
    "显式 dev 请求不打告警",
  );
  console.log("L2.3 显式 dev（ZCODE_CUA_DEV_MODE=1）无告警：OK");
}

// 门失败文案与 gateDetail 拼接：官方发行面恒开门（WINDOWS_PEER_IDENTITY_GATE_
// TEMPORARILY_OPEN=true → allowUnauthenticatedLocalDev 恒 true，@34181），门异常在
// 0.6.5 发行物内不可达——文案与拼接式按 r3 先例（:29-34）以产物字面量钉扎：
assert.ok(
  devEntrySource.includes(
    '"Drora Computer Use broker requires native peer-identity primitives (getPeerCredentials / code-signature / parentProcessPid); refusing to start an unauthenticated broker. Windows peer verification lands separately; for local development set ZCODE_CUA_DEV_MODE=1."',
  ),
  "门失败文案逐字（品牌词 ZCode→Drora，env 键原名）",
);
assert.match(devEntrySource, /instanceof PeerIdentityAuthGateError \? `: \$\{error51\.message\}` : ""/);
assert.match(devEntrySource, /`Windows Computer Use Helper failed to start\.\$\{gateDetail\}`/);
console.log("L2.3 门失败文案 + gateDetail 拼接（产物字面量钉扎，官方发行面不可达）：OK");

// 开门语义行为面：无四原语 + 生产 env（若门闭合必抛）→ 仍启动成功——证明常量 true
// 真实流入 allowUnauthenticatedLocalDev（官方 0.6.5 发行形态，spec §七.1）。
{
  await expectStartupSuccess(["--socket", PIPE, "--parent-pid", "4242"], {
    env: PRODUCTION_ENV,
    capable: false,
    ghost: false,
  });
  console.log("L2.3 开门常量行为面（原语缺失仍启动）：OK");
}

// dev 模式旁路：无四原语 + ZCODE_CUA_DEV_MODE=1 → 启动成功。
{
  await expectStartupSuccess(["--socket", PIPE, "--parent-pid", "4242"], {
    env: DEV_MODE_ENV,
    capable: false,
    ghost: false,
  });
  console.log("L2.3 dev 模式旁路（原语缺失仍可启动）：OK");
}

// 旧 addon 缺 ghost 导出：可选链 no-op 降级不炸（官方 @34164-34165 ?.）。
{
  const { calls } = await expectStartupSuccess(
    ["--socket", PIPE, "--parent-pid", "4242", "--ghost-cursor-overlay"],
    { env: PRODUCTION_ENV, capable: true, ghost: false },
  );
  assert.deepEqual(calls.ghostSetEnabled, []);
  assert.deepEqual(calls.ghostSetMultiCursorEnabled, []);
  console.log("L2.5 旧 addon 缺 ghost 导出 no-op 降级：OK");
}

// —— L2.4 defer 双路径 ——

// 注入 startBroker（默认）→ 立即分支：loadNative 先于 startBroker；native 为真对象，
// 无 deferBackendInitialization/onTransportReady 键（官方 @34219-34234 只传 4 字段）。
{
  const { runtime, state } = makeRuntime({
    argv: ["--socket", PIPE, "--parent-pid", "4242"],
    env: PRODUCTION_ENV,
  });
  const fake = makeFakeNative({ capable: true });
  const handle = await runWindowsDevHelper({
    runtime,
    ...makeInjections(state, { native: fake.native }),
  });
  assert.ok(handle, "eager 分支启动成功");
  assert.ok(state.brokerOptions);
  assert.ok(state.brokerOptions.native === fake.native, "立即分支直传真 native");
  assert.ok(!("deferBackendInitialization" in state.brokerOptions));
  assert.ok(!("onTransportReady" in state.brokerOptions));
  assert.deepEqual(
    state.events.filter((event) => event !== "send:ready"),
    ["loadNative", "createSystem", "startBroker"],
  );
  console.log("L2.4 注入 startBroker → 立即分支（loadNative 先行/4 字段）：OK");
}

// deferNativeInitialization:true → 延迟分支：native/system 为占位 surface；warming up
// 拒绝（BrokerError broker_unavailable）；onTransportReady 内顺序 transport_ready →
// loadNative → ghost → createSystem → setTarget 接管。
{
  const { runtime, state } = makeRuntime({
    argv: ["--socket", PIPE, "--parent-pid", "4242", "--ghost-cursor-overlay"],
    env: PRODUCTION_ENV,
  });
  const fake = makeFakeNative({ capable: true });
  const handle = await runWindowsDevHelper({
    runtime,
    deferNativeInitialization: true,
    ...makeInjections(state, { native: fake.native }),
  });
  assert.ok(handle, "defer 分支启动成功");
  const brokerOptions = state.brokerOptions;
  assert.ok(brokerOptions.native !== fake.native, "延迟分支传占位 surface");
  assert.equal(brokerOptions.deferBackendInitialization, true);
  assert.equal(typeof brokerOptions.onTransportReady, "function");
  assert.equal(brokerOptions.socketPath, PIPE);
  // setTarget 前：任何方法调用 warming up 拒绝（官方 @34016-34020 文案逐字）。
  assert.throws(() => brokerOptions.native.ghostSetEnabled(true), (error) => {
    assert.equal(error.code, "broker_unavailable");
    assert.equal(error.message, "Windows CUA native backend is warming up");
    assert.deepEqual(error.details, {
      ready_state: "warming_up",
      request_delivery_state: "not_sent",
    });
    return true;
  });
  assert.throws(() => brokerOptions.system.captureWindowPng(1), (error) => {
    assert.equal(error.code, "broker_unavailable");
    assert.equal(error.message, "Windows CUA system surface is warming up");
    return true;
  });
  // transport 就绪回调（官方 @34198-34214 顺序）：transport_ready 控制消息 → loadNative
  // → 门校验/ghost（事件面）→ createSystem → setTarget。send:ready 是 fake startBroker
  // 在 runWindowsDevHelper 返回前打的，过滤后核对跨层顺序。
  await brokerOptions.onTransportReady({ socketPath: PIPE });
  assert.deepEqual(
    state.events.filter((event) => event !== "send:ready"),
    ["startBroker", "send:transport_ready", "loadNative", "createSystem"],
    "onTransportReady 顺序=transport_ready→loadNative→createSystem",
  );
  const transportReady = state.sent.find((message) => message.type === "transport_ready");
  assert.ok(transportReady, "transport_ready 控制消息已发");
  assert.equal(transportReady.protocol, "zcode-cua-windows-dev/v1");
  assert.equal(transportReady.socketPath, PIPE);
  assert.equal(transportReady.pid, 42123);
  // setTarget 后：透传真 native/system（ghost 调用已由 onTransportReady 内 plumb；
  // Proxy get 对函数成员每次返回新绑定包装，故以调用穿透而非恒等验证）。
  assert.deepEqual(fake.calls.ghostSetEnabled, [true]);
  assert.deepEqual(fake.calls.ghostSetMultiCursorEnabled, [true]);
  brokerOptions.native.ghostSetEnabled(false);
  assert.deepEqual(fake.calls.ghostSetEnabled, [true, false], "setTarget 后调用穿透真 native");
  assert.equal(brokerOptions.system.marker, "sys");
  console.log("L2.4 延迟分支（占位/warming_up/transport_ready 顺序/setTarget）：OK");
}

// transport_ready 投递失败 → "transport-ready IPC channel closed" → 退出码 1 且不带
// gate 后缀（官方 @34205 + @34236 仅 PeerIdentityAuthGateError 拼接）。
{
  const { runtime, state } = makeRuntime({
    argv: ["--socket", PIPE, "--parent-pid", "4242"],
    env: PRODUCTION_ENV,
    sendBehavior: (message, callback) => {
      state.sent.push(message);
      callback(new Error("channel closed"));
    },
  });
  const fake = makeFakeNative({ capable: true });
  const result = await runWindowsDevHelper({
    runtime,
    deferNativeInitialization: true,
    ...makeInjections(state, { native: fake.native, fireTransportReady: true }),
  });
  assert.equal(result, void 0);
  assert.deepEqual(state.exits, [1]);
  assert.equal(state.sent[0].type, "transport_ready");
  assert.equal(state.sent[1].type, "error");
  assert.equal(state.sent[1].message, "Windows Computer Use Helper failed to start.");
  const failureLine = state.stderr.find((line) =>
    line.startsWith("Windows Computer Use Helper failed to start."),
  );
  assert.equal(failureLine, "Windows Computer Use Helper failed to start.\n");
  assert.ok(!state.events.includes("loadNative"), "transport 失败不加载 native");
  console.log("L2.4 transport_ready 失败 → 无 gate 后缀退出 1：OK");
}

// —— 产物字面量钉扎（生产缺省决策与 runHelper 侧接线；r3 先例 :29-34）——

// 官方 @34180：未注入 startBroker（生产路径）恒走延迟分支。
assert.match(devEntrySource, /options\.deferNativeInitialization \?\? options\.startBroker === void 0/);
assert.match(devEntrySource, /createDeferredSurface\("Windows CUA native backend"\)/);
assert.match(devEntrySource, /createDeferredSurface\("Windows CUA system surface"\)/);
assert.match(devEntrySource, /type: "transport_ready"/);
// runHelper 侧（官方 helperMain @33625/:33789-33854/:33816/createDeferredBackend @33584）：
assert.match(helperMainSource, /const deferBackendInitialization = options\.deferBackendInitialization === true/);
assert.match(helperMainSource, /backend: deferredBackend\?\.backend \?\? activeBackend/);
assert.match(helperMainSource, /await options\.onTransportReady\?\.\(\{ socketPath: options\.socketPath \}\)/);
assert.match(helperMainSource, /deferredBackend\.setTarget\(initializedBackend\)/);
assert.match(helperMainSource, /"Windows CUA broker backend is warming up"/);
console.log("产物字面量钉扎（defer 决策式 + runHelper 接线 + backend warming up）：OK");

console.log("ALL win-entry-065-face checks passed");
