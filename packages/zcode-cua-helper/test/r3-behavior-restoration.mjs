#!/usr/bin/env node
// R3 Helper 行为面机械还原回归（specs/cua-gap-remediation-2026-11-09.md R3.1-R3.6）。
// 每件的官方证据锚（SEA 字节偏移，官方 3.17.2 二进制
// packages/desktop/resources/cua-helper/ZCode Computer Use.app）见对应源码头注释；
// 本文件按方案验证列断言：
//   R3.1 cps 旋钮：常量字面量 + 解析真值表（1/true/on/yes）+ 构建产物下推接线
//   R3.2 多光标旋钮：常量字面量 + 构建产物下推接线
//   R3.3 socket 第三兜底：三常量 + resolveBrokerSocketPath 四返回路径 + 裸启动可起
//   R3.4 paste 串行化：并发 paste 串行（第二次 begin 在第一次 finish 之后）
//   R3.5 paste 收尾协议：restored/finish/paste_provided_cleanup_failed/延迟 rethrow
//   R3.6 exit-log 管道：helperLogLines 逐行 JSON 重写 + pruneHelperLogs 保留清理 +
//        --exit-log 落盘（mkdir + 重写）
// 运行：node test/r3-behavior-restoration.mjs（需先 tsc -p tsconfig.json 产出 dist；
// 裸启动/exit-log 两个 spawn 断言需 dist-cua-helper 的 .app，缺省跳过并标注 SKIP）。
import { spawn, spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const packageRoot = new URL("..", import.meta.url).pathname;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const constants = await import("../dist/broker/helperConstants.js");
const socketPathModule = await import("../dist/broker/socketPath.js");
const helperMain = await import("../dist/broker/server/helperMain.js");
const { createElectronNativeBackend } = await import("../dist/broker/server/electronNativeBackend.js");
// 构建产物源码（下推接线是 main() 内 3 行直写，单测无法进 main——按方案"构建后
// 字面量计数对齐官方"的口径，钉扎 dist 产物中的官方原文接线形态）。
const helperMainDistSource = readFileSync(
  join(packageRoot, "dist/broker/server/helperMain.js"),
  "utf8",
);

// —— R3.1 cps 旋钮 ——
// 官方 SEA：var HELPER_DISABLE_CPS_ACTIVATION_ARG @ 85321460（helperConstants.ts 头注释）。
assert.equal(constants.HELPER_DISABLE_CPS_ACTIVATION_ARG, "--disable-cps-activation");
assert.ok(resolveDisable("1"));
assert.ok(resolveDisable("true"));
assert.ok(resolveDisable("on"));
assert.ok(resolveDisable("yes"));
assert.ok(resolveDisable("TRUE"));
assert.ok(resolveDisable(" Yes "));
assert.ok(resolveDisable(" On"));
for (const value of ["0", "false", "off", "no", "maybe", ""]) {
  assert.equal(resolveDisable(value), false, `--disable-cps-activation ${value} must be false`);
}
assert.equal(resolveDisable(undefined), false); // flag 缺失
assert.equal(resolveDisableAtEnd(), false); // flag 在末尾无值
function resolveDisable(value) {
  const argv = value === undefined ? [] : ["--disable-cps-activation", value];
  return helperMain.resolveDisableCpsActivationFromArgv(argv);
}
function resolveDisableAtEnd() {
  return helperMain.resolveDisableCpsActivationFromArgv(["--disable-cps-activation"]);
}
// 下推接线（官方 SEA @ 86562506-86562734 区）：
assert.match(helperMainDistSource, /native\.setCpsActivationDisabled\?\.\(disableCpsActivation\)/);
assert.match(helperMainDistSource, /"\[cua-cps-activation\] disabled via argv"/);
console.log("R3.1 cps 旋钮：常量/真值表/下推接线 OK");

// —— R3.2 多光标旋钮 ——
// 官方 SEA：var HELPER_DISABLE_MULTI_CURSOR_OVERLAY_ARG @ 85321528。
assert.equal(constants.HELPER_DISABLE_MULTI_CURSOR_OVERLAY_ARG, "--disable-multi-cursor-overlay");
assert.match(helperMainDistSource, /argv\.includes\(HELPER_DISABLE_MULTI_CURSOR_OVERLAY_ARG\)/);
assert.match(helperMainDistSource, /native\.ghostSetMultiCursorEnabled\?\.\(!disableMultiCursorOverlay\)/);
console.log("R3.2 多光标旋钮：常量/下推接线 OK");

// —— R3.3 socket 第三兜底 ——
// 官方 SEA：BROKER_SOCKET_ENV @ 85316105 / BROKER_SOCKET_FILENAME @ 85316167 /
// WINDOWS_NAMED_PIPE_PREFIX @ 85316211 / resolveBrokerSocketPath @ 85316277。
assert.equal(socketPathModule.BROKER_SOCKET_ENV, "ZCODE_CUA_PERMISSION_BROKER_SOCKET");
assert.equal(socketPathModule.BROKER_SOCKET_FILENAME, "broker.sock");
assert.equal(socketPathModule.WINDOWS_NAMED_PIPE_PREFIX, "\\\\.\\pipe\\zcode-cua-helper-");
// 四返回路径（win32 pipe 分支依赖 process.platform，POSIX 主机上以常量+产物接线钉扎）：
assert.equal(
  socketPathModule.resolveBrokerSocketPath({ env: { ZCODE_CUA_PERMISSION_BROKER_SOCKET: "/x/y.sock" } }),
  "/x/y.sock",
  "explicit env wins",
);
assert.equal(
  socketPathModule.resolveBrokerSocketPath({ env: { ZCODE_CUA_PERMISSION_BROKER_SOCKET: "   " }, dir: "/tmp/zz" }),
  join("/tmp/zz", "broker.sock"),
  "blank env falls through to options.dir",
);
assert.equal(
  socketPathModule.resolveBrokerSocketPath({ env: {} }),
  join(socketPathModule.brokerRuntimeDir({}), "broker.sock"),
  "default resolves runtime dir",
);
assert.match(helperMainDistSource, /\?\? resolveBrokerSocketPath\(\)/);
if (process.platform === "win32") {
  assert.equal(
    socketPathModule.resolveBrokerSocketPath({ env: {} }),
    "\\\\.\\pipe\\zcode-cua-helper-default",
  );
}
console.log("R3.3 socket 第三兜底：常量/四路径/主入口接线 OK");

// —— R3.4 paste 串行化 + R3.5 paste 收尾协议 ——
// 官方 SEA：pasteSerialTail/runPasteSerial @ 85520859-85520900；收尾协议
// @ 85546274/85546427/85546470/85546575（electronNativeBackend.ts 头注释）。
const diagnostics = [];
function makeBackend({ providedPaste }) {
  const axSource = {
    // 身份解析面读 snake_case 的 bundle_id（cuaAppIdentity.bundleOf）。
    applicationInfo: async () => ({ pid: 4242, bundle_id: "com.example.app", name: "Example", active: true }),
    listApplications: async () => [{ pid: 4242, bundle_id: "com.example.app", name: "Example", active: true }],
  };
  const adapter = {
    supportsClipboard: true,
    providedPaste,
    pressKeyToApp: async () => ({ ok: true }),
    pressKeyGlobal: () => true,
    isFocusStealPrevented: () => false,
  };
  return createElectronNativeBackend({
    adapter,
    axSource,
    brokerInfo: { platform: "darwin", bundle_id: "dev.drora.cua-helper", version: "0.0.0" },
    onDiagnostic: (event, evidence, level) => diagnostics.push({ event, evidence, level }),
  });
}
const pasteParams = { text: "hello", app_ref: { pid: 4242, bundle_id: "com.example.app", name: "Example" } };
function makeProvidedPaste({ restored = true, readError = null, events = null } = {}) {
  let token = 0;
  return {
    begin: async () => {
      token += 1;
      events?.push(`begin-${token}`);
      return { ok: true, error: null, token };
    },
    markDispatched: (t) => {
      events?.push(`mark-${t}`);
      return true;
    },
    awaitRead: async (t) => {
      events?.push(`read-${t}`);
      await delay(20);
      return readError
        ? { ok: false, error: readError, reads: 0, readsBeforeDispatch: 0 }
        : { ok: true, error: null, reads: 1, readsBeforeDispatch: 0, holdMs: 5 };
    },
    finish: async (t) => {
      events?.push(`finish-${t}`);
      return restored;
    },
  };
}

// R3.4：并发两次 paste，第二次 begin 必须晚于第一次 finish（串行链）。
{
  const events = [];
  const backend = makeBackend({ providedPaste: makeProvidedPaste({ events }) });
  await Promise.all([backend.paste(pasteParams), backend.paste(pasteParams)]);
  const order = events.filter((e) => e.startsWith("begin-") || e.startsWith("finish-"));
  assert.deepEqual(order, ["begin-1", "finish-1", "begin-2", "finish-2"], `serial order, got ${order}`);
  assert.ok(diagnostics.some((d) => d.event === "paste_provided" && d.level === "info"));
}
console.log("R3.4 paste 串行化：并发串行断言 OK");

// R3.5a：finish 恢复成功 + 读取成功 → 正常返回，无 cleanup 告警。
{
  diagnostics.length = 0;
  const backend = makeBackend({ providedPaste: makeProvidedPaste({ restored: true }) });
  await backend.paste(pasteParams);
  assert.ok(!diagnostics.some((d) => d.event === "paste_provided_cleanup_failed"));
}

// R3.5b：finish 未恢复（restored=false）→ cleanup 告警 + "勿重发"错误。
{
  diagnostics.length = 0;
  const backend = makeBackend({ providedPaste: makeProvidedPaste({ restored: false }) });
  await assert.rejects(
    backend.paste(pasteParams),
    (error) =>
      error.code === "internal" &&
      error.message.startsWith("paste cleanup could not restore the clipboard") &&
      error.message.includes("Do not repeat the paste") &&
      error.details.action_sent === true &&
      error.details.reason === "pasteboard_restore_failed" &&
      error.details.clipboard_restore_pending === true,
  );
  const warn = diagnostics.find((d) => d.event === "paste_provided_cleanup_failed");
  assert.ok(warn, "paste_provided_cleanup_failed warn emitted");
  assert.equal(warn.level, "warn");
  assert.deepEqual(warn.evidence, { reason: "pasteboard_restore_failed", action_sent: true });
}

// R3.5c：读取超时（dispatch 阶段失败）+ finish 恢复 → 原错误在 finish 之后 rethrow。
{
  diagnostics.length = 0;
  const events = [];
  const backend = makeBackend({
    providedPaste: makeProvidedPaste({ restored: true, readError: "pasteboard_read_timed_out", events }),
  });
  await assert.rejects(backend.paste(pasteParams), (error) => {
    assert.equal(error.code, "internal");
    assert.ok(error.message.startsWith("paste timed out waiting for the app to read the pasteboard"));
    assert.equal(error.details.reason, "pasteboard_read_timed_out");
    return true;
  });
  // finish 先于 rethrow（事件序证）：
  assert.equal(events[events.length - 1], "finish-1");
  assert.ok(diagnostics.some((d) => d.event === "paste_provided_failed" && d.level === "warn"));
  assert.ok(!diagnostics.some((d) => d.event === "paste_provided_cleanup_failed"));
}

// R3.5d：读取失败 + finish 未恢复 → cleanup 错误优先，且附 paste_error（原错误 details）。
{
  diagnostics.length = 0;
  const backend = makeBackend({
    providedPaste: makeProvidedPaste({ restored: false, readError: "pasteboard_read_timed_out" }),
  });
  await assert.rejects(
    backend.paste(pasteParams),
    (error) =>
      error.code === "internal" &&
      error.message.startsWith("paste cleanup could not restore the clipboard") &&
      error.details.clipboard_restore_pending === true &&
      error.details.paste_error?.reason === "pasteboard_read_timed_out",
  );
  assert.ok(diagnostics.some((d) => d.event === "paste_provided_cleanup_failed"));
}
console.log("R3.5 paste 收尾协议：restored/告警/延迟 rethrow/paste_error OK");

// —— R3.6 exit-log 管道 ——
// 官方 SEA：helperLogLines @ 86549645 / pruneHelperLogs @ 86550881 / IIFE @ 86548983。
{
  // 1) helperRuntimeLogger 形态的 JSON 行 → timestamp/level/event/module/pid/context。
  const jsonOut = helperMain.helperLogLines(
    `${JSON.stringify({ scope: "zcode-cua-helper", level: "warn", event: "paste_provided", evidence: { reads: 1 } }, null)}\n`,
  );
  const record = JSON.parse(jsonOut.trim());
  assert.equal(record.module, "zcode-cua-helper");
  assert.equal(record.level, "warn");
  assert.equal(record.event, "paste_provided");
  assert.deepEqual(record.context, { reads: 1 });
  assert.equal(typeof record.timestamp, "string");
  assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(record.pid, process.pid);
  assert.ok(!("scope" in record) && !("evidence" in record), "scope/evidence renamed to module/context");
  // 自定义 scope 透传为 module：
  const custom = JSON.parse(
    helperMain
      .helperLogLines(JSON.stringify({ scope: "custom-scope", level: "info", event: "e" }))
      .trim(),
  );
  assert.equal(custom.module, "custom-scope");
  // 2) [tag] 纯文本行 → event=tag、message=剩余文本；无 tag → helper stderr。
  const tagged = JSON.parse(helperMain.helperLogLines("[helper-exit] exit code=0 at now\n").trim());
  assert.equal(tagged.event, "helper-exit");
  assert.equal(tagged.message, "exit code=0 at now");
  assert.equal(tagged.module, "zcode-cua-helper");
  const plain = JSON.parse(helperMain.helperLogLines("plain stderr line\n").trim());
  assert.equal(plain.event, "helper stderr");
  assert.equal(plain.message, "plain stderr line");
  // 3) 空行剔除、多行逐行输出：
  const two = helperMain.helperLogLines("a\n\nb\n").trim().split("\n");
  assert.equal(two.length, 2);
  // 4) pruneHelperLogs：保留最新 7 个日期文件，删除更旧的；非匹配名不动。
  const dir = mkdtempSync(join(tmpdir(), "r36-prune-"));
  try {
    for (let day = 1; day <= 9; day += 1) {
      const mm = String(Math.floor((day - 1) / 20) + 11).padStart(2, "0");
      const dd = String(((day - 1) % 20) + 1).padStart(2, "0");
      writeFileSync(join(dir, `zcode-cua-helper-2026-${mm}-${dd}.jsonl`), "{}\n");
    }
    writeFileSync(join(dir, "rogue.txt"), "keep");
    writeFileSync(join(dir, "zcode-cua-helper-bad.jsonl"), "keep");
    helperMain.pruneHelperLogs(dir);
    const remaining = readdirSync(dir).sort();
    // 2026-11-01..09 共 9 个，保留最新 7（11-03..11-09），删除 11-01/11-02。
    assert.deepEqual(
      remaining.filter((name) => /^zcode-cua-helper-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)),
      [
        "zcode-cua-helper-2026-11-03.jsonl",
        "zcode-cua-helper-2026-11-04.jsonl",
        "zcode-cua-helper-2026-11-05.jsonl",
        "zcode-cua-helper-2026-11-06.jsonl",
        "zcode-cua-helper-2026-11-07.jsonl",
        "zcode-cua-helper-2026-11-08.jsonl",
        "zcode-cua-helper-2026-11-09.jsonl",
      ],
    );
    assert.ok(remaining.includes("rogue.txt") && remaining.includes("zcode-cua-helper-bad.jsonl"));
    assert.equal(helperMain.HELPER_LOG_RETENTION_DAYS, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log("R3.6 exit-log 管道：helperLogLines 重写 + pruneHelperLogs 保留 7 天 OK");

// —— spawn 断言（需构建产物 .app；缺失则 SKIP）——
const helperApp = resolve(
  packageRoot,
  "dist-cua-helper/Drora Computer Use.app/Contents/MacOS/Drora Computer Use",
);
if (!existsSync(helperApp)) {
  console.log("SKIP spawn 断言（R3.3 裸启动 / R3.6 --exit-log）：未构建 dist-cua-helper .app");
} else if (process.platform !== "darwin") {
  console.log("SKIP spawn 断言：仅 darwin 产物");
} else {
  const cleanEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: mkdtempSync(join(tmpdir(), "r36-home-")) };
  delete cleanEnv.ZCODE_CUA_PERMISSION_BROKER_SOCKET;

  // R3.3 裸启动（R10 认证模型换代后的官方语义，SEA @ 86555928-86556224+
  // 86558800）：token 门不存在；darwin+原生四原语齐备 → peer 门过；无
  // --launcher-pid → launcher 门跳过 → broker 正常起监听（idle 300s 自退）。
  // 断言形态从「exit 2 at token gate」改为「存活驻留」。
  const bare = spawn(helperApp, [], { env: cleanEnv, stdio: ["ignore", "pipe", "pipe"] });
  let bareStdout = "";
  let bareStderr = "";
  bare.stdout.on("data", (c) => (bareStdout += c));
  bare.stderr.on("data", (c) => (bareStderr += c));
  const exitedEarly = await new Promise((resolveEarly) => {
    const t = setTimeout(() => resolveEarly(false), 3_000);
    bare.once("exit", () => { clearTimeout(t); resolveEarly(true); });
  });
  assert.ok(!exitedEarly, `bare start should stay running (official peer model), stderr: ${bareStderr}`);
  assert.ok(!bareStderr.includes("requires --socket"), `socket gate must be passed, stderr: ${bareStderr}`);
  assert.ok(!bareStderr.includes("token"), `no token gate in official 0.6.5, stderr: ${bareStderr}`);
  bare.kill("SIGKILL");
  await new Promise((r) => bare.once("exit", r));
  console.log("R3.3 裸启动：官方 peer 模型下驻留运行（无 token 门）OK");

  // R3.6 --exit-log：目录自动 mkdir + stderr 经 helperLogLines 逐行 JSON 重写落盘。
  // R10 后 exit-2 路径改用不可信 launcher pid（launcher 门：非 dev 态且带
  // --launcher-pid 但非宿主签名进程 → exit 2，文案 "did not verify as a code-signed"）。
  const logDir = join(mkdtempSync(join(tmpdir(), "r36-log-")), "sub", "dir");
  const logPath = join(logDir, "zcode-cua-helper-2026-11-09.jsonl");
  const logged = spawnSync(helperApp, ["--exit-log", logPath, "--launcher-pid", String(process.pid)], {
    env: cleanEnv,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(logged.status, 2, `expected exit 2 at untrusted launcher gate: ${logged.stderr}`);
  assert.ok(logged.stderr.includes("did not verify as a code-signed"), logged.stderr);
  assert.ok(existsSync(logPath), "exit log file created (with mkdir -p)");
  const logLines = readFileSync(logPath, "utf8").trim().split("\n");
  assert.ok(logLines.length >= 1);
  for (const line of logLines) {
    const rec = JSON.parse(line);
    assert.equal(rec.module, "zcode-cua-helper");
    assert.equal(typeof rec.timestamp, "string");
    assert.equal(rec.pid, logged.pid);
  }
  assert.ok(
    logLines.some((line) => JSON.parse(line).message?.includes("did not verify as a code-signed")),
    "launcher refusal line captured",
  );
  console.log("R3.6 --exit-log：mkdir + JSON 重写落盘（launcher 门路径）OK");
}

console.log("ALL R3 regression checks passed");
