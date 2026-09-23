#!/usr/bin/env node
// CI 冒烟:drora.cjs 构建产物的深度验证。
//   1. app-server 协议链路:启动后应在超时内输出合法 JSON 行(startup/* 通知)
//   2. 子命令面:plugins/skills/commands list 与 doctor 正常执行
//   3. agent 核心工具面:bundle 内必须含基础工具注册(字符串面)
// 用法:node scripts/ci/cli-app-server-smoke.mjs <drora.cjs 路径>
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";

const bundle = process.argv[2];
if (!bundle) {
  console.error("usage: cli-app-server-smoke.mjs <drora.cjs>");
  process.exit(2);
}

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  → " + (detail ?? "")}`);
  if (!ok) failed++;
};

// —— 1. app-server 协议链路 ——
{
  const firstLine = await new Promise((resolve) => {
    const child = spawn(process.execPath, [bundle, "app-server"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    const done = (v) => {
      child.kill();
      resolve(v);
    };
    const timer = setTimeout(() => done(""), 15000);
    child.stdout.on("data", (d) => {
      buf += d;
      const i = buf.indexOf("\n");
      if (i >= 0) {
        clearTimeout(timer);
        done(buf.slice(0, i).trim());
      }
    });
    child.on("error", () => { clearTimeout(timer); done(""); });
    child.on("exit", (code) => { clearTimeout(timer); done(buf.trim().slice(0, 200) || `exit:${code}`); });
  });
  let parsed = null;
  try { parsed = JSON.parse(firstLine); } catch {}
  check(
    "app-server 首行是合法 JSON 通知",
    Boolean(parsed?.method) && String(parsed.method).startsWith("startup/"),
    firstLine.slice(0, 120),
  );
}

// —— 2. 子命令面 ——
for (const [name, args, expect] of [
  ["plugins list", ["plugins", "list"], "Plugins ("],
  ["skills list", ["skills", "list"], "Available skills ("],
  ["commands list", ["commands", "list"], "Custom commands ("],
  ["doctor", ["doctor"], "version:"],
]) {
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [bundle, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => { child.kill(); resolve({ code: -1, out }); }, 30000);
    child.stdout.on("data", (d) => (out += d));
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e) }); });
  });
  check(
    `子命令 ${name}`,
    r.code === 0 && r.out.includes(expect),
    `exit=${r.code} head=${r.out.split("\n")[0]?.slice(0, 70)}`,
  );
}

// —— 3. agent 核心工具面(字符串面)——
{
  const src = await readFile(bundle, "utf8");
  const tools = ["Bash", "Edit", "Read", "Write", "Glob", "Grep", "TodoRead", "TodoWrite"];
  const missing = tools.filter((t) => !new RegExp(`name:\\s*["']${t}["']`).test(src));
  check("agent 核心工具注册", missing.length === 0, `missing=[${missing}]`);
}

console.log(failed === 0 ? "\nCLI 冒烟通过 ✓" : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
