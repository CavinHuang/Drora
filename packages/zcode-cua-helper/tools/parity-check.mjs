#!/usr/bin/env node
// 与原版发行物做入口与 broker 协议对齐验收。
// 用法：node tools/parity-check.mjs [原版 cua-helper 目录]
// 注意：本工具只对 0.5.13 基线有效——0.6.3 官方 Helper 已删除 token 概念、改为两段式
// transport_ready 握手且方法表 63→42，对 0.6.3 运行本工具会给出虚假 DIFF。默认对照 D:\software\zcode\resources\tools\cua-helper（0.5.13 发行物）。
// 场景：入口 5 个参数场景（stdout/stderr/exit code）+ 真实拉起 broker 后的
// authenticate / broker_info / 错误 token 拒绝。任一 DIFF 即非零退出。
import { spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const RESTORED = resolve(packageRoot, "dist", "windows-helper.js");
const ORIG_DIR = process.argv[2] ?? "D:\\software\\zcode\\resources\\tools\\cua-helper";
const ORIG = resolve(ORIG_DIR, "dist", "windows-helper.js");

if (!existsSync(RESTORED)) {
  console.error(
    `missing restored bundle: ${RESTORED}; run pnpm --filter @drora/drora-cua-helper-runtime build`,
  );
  process.exit(2);
}
if (!existsSync(ORIG)) {
  console.error(`missing original bundle: ${ORIG}; pass the installed cua-helper dir as argv[2]`);
  process.exit(2);
}

let failed = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.replace(/^(ORIG|REST):/, "X:");

// —— 入口场景 parity ——
const entryCases = [
  { name: "no-args", args: [], env: {} },
  { name: "3 args (missing parent-pid)", args: ["--socket", "\\\\.\\pipe\\x"], env: {} },
  {
    name: "--token rejected",
    args: ["--socket", "\\\\.\\pipe\\x", "--parent-pid", "1", "--token", "t"],
    env: {},
  },
  {
    name: "4 args + no env token",
    args: ["--socket", "\\\\.\\pipe\\x", "--parent-pid", "4242"],
    env: {},
  },
  {
    name: "4 args + bad pipe",
    args: ["--socket", "/not-a-pipe", "--parent-pid", "4242"],
    env: { ZCODE_CUA_PERMISSION_BROKER_TOKEN: "tok" },
  },
];
for (const c of entryCases) {
  const out = [];
  for (const [label, exe] of [
    ["ORIG", ORIG],
    ["REST", RESTORED],
  ]) {
    const r = spawnSync(process.execPath, [exe, ...c.args], {
      env: { ...process.env, ...c.env },
      encoding: "utf8",
      timeout: 15000,
    });
    out.push(
      `${label}: stdout=${JSON.stringify((r.stdout || "").trim())} stderr=${JSON.stringify((r.stderr || "").trim())} code=${r.status}`,
    );
  }
  const ok = norm(out[0]) === norm(out[1]);
  if (!ok) failed++;
  console.log(`${ok ? "MATCH" : "DIFF"} entry: ${c.name}`);
  if (!ok) console.log(`  ${out[0]}\n  ${out[1]}`);
}

// —— broker E2E parity ——
const TOKEN = `parity-${randomUUID()}`;

async function runHelper(label, exe) {
  const pipe = `\\\\.\\pipe\\zcode-cua-parity-${randomUUID().slice(0, 8)}`;
  const child = spawn(
    process.execPath,
    [exe, "--socket", pipe, "--parent-pid", String(process.pid)],
    {
      env: { ...process.env, ZCODE_CUA_PERMISSION_BROKER_TOKEN: TOKEN },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  const ready = await new Promise((res) => {
    const deadline = Date.now() + 20000;
    const poll = () => {
      if (stdout.includes('"type":"ready"') || Date.now() > deadline || child.exitCode !== null)
        return res(stdout.includes('"type":"ready"'));
      setTimeout(poll, 200);
    };
    poll();
  });
  const exchange = (lines) =>
    new Promise((res, rej) => {
      const sock = connect(pipe);
      let buf = "";
      const replies = [];
      sock.on("error", (e) => (sock.destroy(), rej(e)));
      sock.on("connect", () => {
        for (const l of lines) sock.write(l + "\n");
      });
      sock.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          replies.push(JSON.parse(line));
          if (replies.length >= lines.length) {
            sock.destroy();
            res(replies);
          }
        }
      });
      setTimeout(() => (sock.destroy(), rej(new Error("exchange timeout"))), 10000);
    });
  const replies = ready
    ? await exchange([
        JSON.stringify({ id: 1, method: "authenticate", params: { token: TOKEN } }),
        JSON.stringify({ id: 2, method: "broker_info", params: {} }),
      ]).catch((e) => [{ error: e.message }])
    : null;
  const badAuth = ready
    ? await exchange([
        JSON.stringify({ id: 3, method: "authenticate", params: { token: "wrong" } }),
      ]).catch((e) => [{ error: e.message }])
    : null;
  child.kill();
  await wait(200);
  const redact = (x) =>
    JSON.stringify(x, (k, v) => (k === "pid" || k === "socketPath" || k === "id" ? "<dyn>" : v));
  return {
    ready,
    replies: redact(replies),
    badAuth: redact(badAuth),
  };
}

const a = await runHelper("ORIG", ORIG);
const b = await runHelper("REST", RESTORED);
for (const [name, key] of [
  ["broker ready", "ready"],
  ["authenticate + broker_info", "replies"],
  ["bad token rejected", "badAuth"],
]) {
  const ok = a.ready === b.ready && (key === "ready" || a[key] === b[key]);
  if (!ok) failed++;
  console.log(`${ok ? "MATCH" : "DIFF"} e2e: ${name}`);
  if (!ok && key !== "ready") {
    console.log(`  ORIG: ${String(a[key]).slice(0, 700)}`);
    console.log(`  REST: ${String(b[key]).slice(0, 700)}`);
  }
}

console.log(failed === 0 ? "\n对齐验收通过 ✓" : `\n${failed} 项不一致 ✗`);
process.exit(failed === 0 ? 0 : 1);
