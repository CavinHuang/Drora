#!/usr/bin/env node
// S2 段门辅助检查：确认 app-control 导航 IPC 常量已全数 drora 化（zcode: 形态零残留）。
// 背景：workflow 段门的 node -e 内联脚本经 shell 层时 ">" 等字符会被改写导致语法损坏
//（见 dwfq-4b2511bb-1），段禁命令一律落盘为脚本调用，不再内联。
import { execFileSync } from "node:child_process";

let r = "";
try {
  r = execFileSync("git", ["grep", "-n", "zcode:app-control-navigation", "--", "packages"], {
    encoding: "utf8",
  });
} catch {
  r = ""; // git grep 无命中时 exit 1，视为零残留
}
if (r.trim()) {
  console.error(`zcode:app-control-navigation 残留:\n${r}`);
  process.exit(1);
}
console.log("导航 IPC 常量零残留（zcode: 形态无命中）");
