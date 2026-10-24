// 独立能力面提取：对 zcode.cjs（官方）与 drora.cjs（本仓源码构建）做同族抽取与差分。
// 方法：正则抽各族字面量 → 本仓侧先做 rename 归一化（specs/drora-rename.md 映射的机器可判定子集）→ 集合差分。
// 与 check-bundle-key-parity.mjs 互补：那个只覆盖 4 个契约键族，这里扩展到命令/工具/hook/权限/协议/存储族。
import fs from "node:fs";

const origPath = "D:/software/ZCode/resources/glm/zcode.cjs";
const oursPath = "packages/desktop/bundled-agents/win32-x64/glm/drora.cjs";

const orig = fs.readFileSync(origPath, "utf8");
let ours = fs.readFileSync(oursPath, "utf8");

// rename 归一化（保守子集：仅作用于字面量抽取后的 token，不做全文替换，避免误伤标识符）
function normalizeToken(t) {
  return t
    .replace(/^@drora\//, "@zcode/")
    .replace(/^DRORA_/, "ZCODE_")
    .replace(/^\.drora/, ".zcode")
    .replace(/^drora-plugins-official$/, "zcode-plugins-official")
    .replace(/^drora:/, "zcode:")
    .replace(/^Drora Protocol$/, "ZCode Protocol")
    .replace(/^drora-artifact/, "zcode-artifact")
    .replace(/^drora\./, "zcode.") // 遥测命名空间 drora.* → zcode.*（报告登记的超集改名豁免，先归一再比）
    .replace(/^drora-/, "zcode-")
    .replace(/^"DRORA_/, '"ZCODE_')
    .replace(/^"drora:permission/, '"zcode:permission')
    .replace(/^"drora\./, '"zcode.');
}

// 工具全集（报告 §2 的 41 官方名 + 自研 7 个）做成员检测；开放正则会被压缩形态漏抽
const TOOL_CANDIDATES = [
  "Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch",
  "Agent", "Task", "Skill", "TodoRead", "TodoWrite", "EnterPlanMode",
  "ExitPlanMode", "AskUserQuestion", "SendMessage", "RespondToCoordinator",
  "submit_result", "escalate", "TaskOutput", "TaskStop", "ReadSessionContext",
  "ReplyToChannel", "CronCreate", "CronList", "CronUpdate", "CronDelete",
  "OffPeakCreate", "OffPeakList", "CreateWorkflow", "AmendWorkflow",
  "EvalWorkflowSnippet", "SaveWorkflow", "ListSavedWorkflows", "ListWorkflowRuns",
  "GetWorkflowRun", "ResolveWorkflowQuestion", "FillWorkflowHole",
  "ResumeWorkflowRun", "ListModels", "VaultSearch", "TeamTaskCreate",
  "TeamTaskGet", "TeamTaskClaim", "TeamTaskUpdate", "TeamTaskList",
  "TeamSendMessage",
];

// 关键证据点成员检测（值 → 在两侧的命中应为 gap=0 / 有意分歧 / 已知缺口）
const EVIDENCE_POINTS = [
  "X-Client-Sig", // V4 签名请求头（官方有；本仓预期缺 → GAP-2）
  "X-Client-Pow",
  "c1f3a7e2", // V4 握手端点片段
  "/api/v1/oauth/cli/init", // OAuth 设备码
  "/api/biz/", // 本仓替代取钥路径
  "forceUpdateGuard", // 官方启动强更门控（本仓有意移除）
  "Auto mode is reserved but not implemented yet", // auto 模式同文案
  "reactiveCompactAfterContextExceeded",
  "CommandInbox",
  "workspace-hook-trust-v1",
];

function uniq(a) {
  return [...new Set(a)].sort();
}

function extract(text) {
  return {
    // 斜杠命令：builtin help 表形态 name:"xxx",summary:"..."
    slashCommands: [...text.matchAll(/name:"([a-z][a-z0-9:_-]*)",summary:"/g)].map((m) => m[1]),
    // 工具：候选名单成员检测（压缩形态多样：name:"X" 或裸 "X"，取带引号精确匹配）
    tools: TOOL_CANDIDATES.filter((t) => text.includes(`"${t}"`)),
    // hook 事件名
    hookEvents: [
      "SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest",
      "PostToolUse", "PostToolUseFailure", "Stop",
    ].filter((e) => text.includes(`"${e}"`)),
    // 权限模式枚举
    permissionModes: [
      "default", "yolo", "guarded", "plan", "edit", "acceptEdits",
      "auto", "dontAsk", "bypassPermissions", "autoEdit", "build",
    ].filter((m) => text.includes(`"${m}"`)),
    // 协议方法名（v1 名族：namespace/verb）
    protocolMethods: [
      ...text.matchAll(/"(?:session|model|permission|file|workspace|agent|workflow|mcp|skill|command|host|terminal|ui|config|extension|update|doctor|telemetry|remote|device|relay|lan)\/[a-zA-Z-]+(?:\/[a-zA-Z-]+)*"/g),
    ].map((m) => m[0]),
    // SQLite 表
    sqliteTables: [...text.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`?([a-z_]+)`?/gi)].map((m) => m[1]),
    // CLI 子命令线索（parseArgs 的 command 字符串）
    cliSubcommands: [
      "tui", "app-server", "agent-server", "doctor", "login", "logout",
    ].filter((c) => new RegExp(`"${c}"`).test(text)),
    // 诊断码 code:"..."
    diagCodes: [...text.matchAll(/code:"([a-z_]+)"/g)].map((m) => m[1]),
    // 遥测指标（zcode.* / drora.*）
    telemetryMetrics: [...text.matchAll(/"(?:zcode|drora)\.[a-z_.]+"/g)].map((m) => m[0]),
    // permissions 键
    permissionKeys: [...text.matchAll(/"(?:zcode|drora):permission[a-z-]*:[a-z_]+"/g)].map((m) => m[0]),
    // env 键
    envKeys: [...text.matchAll(/"(?:ZCODE|DRORA)_[A-Z0-9_]+"/g)].map((m) => m[0]),
    // _meta 键族
    metaKeys: [...text.matchAll(/"(?:zcode|drora|codex)\.cua\/[a-z0-9./-]+"/g)].map((m) => m[0]),
  };
}

const o = extract(orig);
const mRaw = extract(ours);
const m = {};
for (const [fam, arr] of Object.entries(mRaw)) m[fam] = uniq(arr.map(normalizeToken));
for (const fam of Object.keys(o)) o[fam] = uniq(o[fam]);

console.log("=== EVIDENCE POINTS (成员检测) ===");
for (const p of EVIDENCE_POINTS) {
  console.log(`  ${orig.includes(p) ? "ORIG" : "----"} | ${ours.includes(p) ? "OURS" : "----"} | ${p}`);
}

for (const fam of Object.keys(o)) {
  const onlyOrig = o[fam].filter((x) => !m[fam].includes(x));
  const onlyOurs = m[fam].filter((x) => !o[fam].includes(x));
  console.log(`\n### ${fam}  (orig ${o[fam].length} / ours ${m[fam].length})`);
  if (onlyOrig.length) {
    console.log(`ONLY IN ORIGINAL (${onlyOrig.length}):`);
    for (const x of onlyOrig) console.log(`  - ${x}`);
  }
  if (onlyOurs.length) {
    console.log(`ONLY IN OURS (${onlyOurs.length}):`);
    for (const x of onlyOurs) console.log(`  + ${x}`);
  }
  if (!onlyOrig.length && !onlyOurs.length) console.log("identical");
}
