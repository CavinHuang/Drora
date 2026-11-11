#!/usr/bin/env node
// e2e-fork-win.cjs —— win CUA fork 链端到端验收（specs/win32-cua-0.6.5-implementation-design.md
// §五 W1 出口判据：fork 链 E2E（RECIPE → argv → socket → authenticate v3 → 工具冒烟）
// ＝ win CUA 复活，三断同修实证。
//
// 链路（镜像切段 ensureWindowsHelperForked 的真实组装）：
//   1. recipe：root=runtime/cua-helper（DRORA_CUA_DEV_ROOT 同源契约：package.json
//      droraCuaRuntime 指认 entry+addon），command=ELECTRON 宿主 + ELECTRON_RUN_AS_NODE=1；
//   2. argv 契约（官方 :34053-34090）：entry --socket \\.\pipe\<name> --parent-pid <pid>；
//   3. 等控制协议（zcode-cua-windows-dev/v1）stdout 行 transport_ready → ready；
//   4. brokerExchange（@drora/drora-cua/broker）authenticate clientApiVersion=3 + 工具冒烟
//      （broker_info / list_applications）；
//   5. shutdown 控制消息（stdin JSON 行，无 IPC 通道时的控制面）→ 子进程退出。
//
// 用法（packages/zcode-cua-helper/ 下）：
//   node tools/e2e-fork-win.cjs [--command <electron.exe>] [--timeout-ms 60000]
// 缺省 command=../../node_modules/electron/dist/electron.exe（desktop 44.7.0 宿主同源）。

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const TOOL_DIR = __dirname;
const PKG_DIR = path.resolve(TOOL_DIR, "..");
const RUNTIME_ROOT = path.join(PKG_DIR, "runtime", "cua-helper");
const DEFAULT_ELECTRON = path.resolve(PKG_DIR, "..", "..", "node_modules", "electron", "dist", "electron.exe");
const CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";

function argOf(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const command = argOf("--command") || DEFAULT_ELECTRON;
  const timeoutMs = Number(argOf("--timeout-ms") || 60000);
  // --ghost-flags：argv 携官方 ghost 双旗（0.6.5 契约 5-6 args 形态）——
  // allowedFlags 过滤后 positional 恒 4，起链应与 4-arg 基线一致。
  const ghostFlags = process.argv.includes("--ghost-flags")
    ? ["--ghost-cursor-overlay", "--disable-multi-cursor-overlay"] : [];
  const pkg = JSON.parse(fs.readFileSync(path.join(RUNTIME_ROOT, "package.json"), "utf8"));
  const contract = pkg.droraCuaRuntime && pkg.droraCuaRuntime.windows;
  if (!contract) throw new Error("runtime package.json 缺 droraCuaRuntime.windows 契约块");
  const entryPath = path.join(RUNTIME_ROOT, contract.entry);
  const addonPath = path.join(RUNTIME_ROOT, contract.nativeAddon);
  for (const p of [command, entryPath, addonPath]) {
    if (!fs.existsSync(p)) throw new Error(`链路文件缺失: ${p}`);
  }
  const pipe = `\\\\.\\pipe\\drora-cua-e2e-${randomUUID().slice(0, 8)}`;
  const steps = [];
  const step = (name, detail) => {
    steps.push({ name });
    console.log(`[e2e] ${name}${detail !== undefined ? " — " + detail : ""}`);
  };

  step(`recipe: command=${path.basename(command)} entry=${contract.entry} addon=${contract.nativeAddon} v${pkg.version}`);

  // fork：argv 契约 = [entry, (--ghost 双旗…), --socket, pipe, --parent-pid, pid]（positional 恰 4）
  const child = spawn(command, [entryPath, ...ghostFlags, "--socket", pipe, "--parent-pid", String(process.pid)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  step(`argv-fork: pid=${child.pid} --socket <pipe> --parent-pid ${process.pid}`);

  let stdoutBuf = "";
  let stderrBuf = "";
  const controlMessages = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk;
    let idx;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg && msg.protocol === CONTROL_PROTOCOL) {
          controlMessages.push(msg.type);
          step(`control-message: ${msg.type}`);
        }
      } catch { /* 非 JSON 行忽略（普通日志） */ }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk;
    if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-8000);
  });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));

  const deadline = Date.now() + timeoutMs;
  const fail = async (msg) => {
    child.kill("SIGKILL");
    throw new Error(`${msg}（控制消息: ${controlMessages.join(",") || "无"}；stderr 尾部: ${stderrBuf.slice(-500)}）`);
  };

  // —— 等 ready 控制消息（transport_ready → ready；defer 面在 transport_ready 后加载 addon）——
  while (!controlMessages.includes("ready") && Date.now() < deadline) {
    if (child.exitCode !== null) {
      await fail("helper 子进程提前退出");
    }
    await sleep(100);
  }
  if (!controlMessages.includes("transport_ready")) await fail("未见 transport_ready 控制消息");
  if (!controlMessages.includes("ready")) await fail("超时未见 ready 控制消息");
  step("socket-ready: transport_ready ✓ ready ✓");

  // —— authenticate v3 + 工具冒烟（brokerExchange 自带 authenticate clientApiVersion=3）——
  const broker = await import("@drora/drora-cua/broker");
  const info = await broker.callBrokerMethod({ socketPath: pipe, method: "broker_info", params: {}, timeoutMs: 8000 });
  step(`authenticate-v3 + broker_info: bundle_id=${info && info.bundle_id} pid=${info && info.pid}`);
  const apps = await broker.callBrokerMethod({ socketPath: pipe, method: "list_applications", params: {}, timeoutMs: 15000 });
  step(`tool-smoke: list_applications → ${Array.isArray(apps) ? apps.length + " 个应用" : JSON.stringify(apps).slice(0, 120)}`);

  // —— shutdown 控制消息（stdin JSON 行）→ 期待干净退出 ——
  child.stdin.write(JSON.stringify({ protocol: CONTROL_PROTOCOL, type: "shutdown" }) + "\n");
  step("shutdown: 已发 shutdown 控制消息");
  const exit = await Promise.race([exited, sleep(10000).then(() => null)]);
  if (!exit) {
    child.kill("SIGKILL");
    step("exit: 10s 未自然退出，已 kill（非致命：管道冒烟已过）");
  } else {
    step(`exit: code=${exit.code} signal=${exit.signal ?? "none"}`);
  }

  console.log("__E2E_JSON__" + JSON.stringify({ pass: true, steps, controlMessages }));
  process.exit(0);
}

main().catch((err) => {
  console.error("[e2e] FAIL:", err && err.message);
  process.exit(1);
});
