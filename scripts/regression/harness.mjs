// drora↔zcode A/B regression harness.
//   node scripts/regression/harness.mjs [--scenarios <file|dir>] [--only s01,s02]
//                                        [--out <dir>] [--request-timeout-ms N]
//
// Per run:
//   1. spawn two scripted mock-model instances (one per side, unambiguous
//      request attribution) — scripts/regression/mock-model.mjs
//   2. spawn drora app-server (--protocol v1) and zcode.cjs app-server --stdio
//      with model env aliases pointed at their mock instances
//   3. execute scenario op pipelines identically on both sides, auto-answering
//      reverse requests with symmetric policies; scenarios may declare
//      "serial": true to run each side to completion in turn (shared-filesystem
//      tool scenarios must not race)
//   4. normalize frames (alias volatile ids, strip volatile leaves, pass through
//      literals sent identically to both sides), diff responses per request id
//      and event streams per scenario window
//   5. write report.json / report.md / per-scenario detail JSON + raw frame logs
//
// Exit code: 0 all ALIGNED, 1 diffs found, 2 infra error. Zero dependencies.
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DRORA_CJS = path.join(REPO_ROOT, "apps/drora-cli/packages/cli/dist/drora.cjs");
const ZCODE_CJS = process.env.ZCODE_CJS_PATH?.trim() || "D:\\software\\zcode\\resources\\glm\\zcode.cjs";
const REG_DIR = path.dirname(fileURLToPath(import.meta.url));
const REG_REPORTS = path.join(REG_DIR, "reports");
const SCENARIO_DIR = path.join(REG_DIR, "scenarios");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const ONLY = String(arg("only", "")).split(",").map((s) => s.trim()).filter(Boolean);
const REQ_TIMEOUT_MS = Number(arg("request-timeout-ms", 15000));
const EVENT_TIMEOUT_MS = Number(arg("event-timeout-ms", 30000));
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.resolve(String(arg("out", "")) || path.join(REG_DIR, "reports", RUN_ID));
// round3 D 簇：drora 官方插件种子源容器（真值 zcode 从其安装资源
// resources/glm/packages/<name>-plugin 解析同一种子集）。缺省与 ZCODE_CJS_PATH
// 同源（<zcode 资源>/glm/packages），保证两侧发现同一批官方插件。
const DRORA_OFFICIAL_PLUGIN_ROOT =
  process.env.DRORA_OFFICIAL_PLUGIN_ROOT?.trim() || path.join(path.dirname(ZCODE_CJS), "packages");

function fail(msg) {
  console.error(`[harness] ${msg}`);
  process.exit(2);
}

// ---------------------------------------------------------------- scenarios

function loadScenarios() {
  const scArg = String(arg("scenarios", SCENARIO_DIR));
  const scPath = path.resolve(scArg);
  let files;
  try {
    files = readdirSync(scPath).filter((f) => f.endsWith(".json")).sort().map((f) => path.join(scPath, f));
  } catch {
    files = existsSync(scPath) ? [scPath] : fail(`scenarios not found: ${scPath}`);
  }
  const plans = {};
  const scenarios = [];
  for (const file of files) {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    Object.assign(plans, doc.plans ?? {});
    for (const sc of doc.scenarios ?? []) scenarios.push({ ...sc, _file: path.basename(file) });
  }
  return { plans, scenarios: ONLY.length ? scenarios.filter((s) => ONLY.includes(s.id)) : scenarios };
}

// ---------------------------------------------------------------- procs

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

const children = new Set();
function spawnDetached(cmd, args, opts) {
  const child = spawn(cmd, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], ...opts });
  children.add(child);
  return child;
}
// 2026-10-08：Windows 下 app-server 会派生插件宿主/原生搜索工具等孙进程，
// 直接 kill 只收父进程——孙进程短暂存活持住场景 ws 目录句柄，下一场景
// rmSync 清理即 EPERM（t01/bt* HARNESS_ERROR 根因）。win32 用 taskkill /T
// 连树收割，其余平台保持 kill()。
function killTree(child) {
  try {
    if (child.exitCode !== null) return;
    if (process.platform === "win32" && child.pid) {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
    } else {
      child.kill();
    }
  } catch { /* best effort */ }
}
function killAll() {
  for (const c of children) {
    killTree(c);
  }
  children.clear();
}
process.on("exit", killAll);
process.on("SIGINT", () => { killAll(); process.exit(2); });

function pipeLines(stream, onLine) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      onLine(buffer.slice(0, idx).replace(/\r$/, ""));
      buffer = buffer.slice(idx + 1);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) onLine(buffer.replace(/\r$/, ""));
  });
}

/** Wait until both sides stop producing frames for `quietMs` — straggler
 *  events from a previous scenario must not leak into the next window. */
async function settle(sides, quietMs = 700, maxMs = 10000) {
  const total = (side) => side.events.length + side.notifications.length + side.reverse.length;
  let last = { drora: -1, zcode: -1 };
  let lastChange = Date.now();
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 150));
    const now = { drora: total(sides.drora), zcode: total(sides.zcode) };
    if (now.drora !== last.drora || now.zcode !== last.zcode) {
      last = now;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) {
      return;
    }
  }
}

// ---------------------------------------------------------------- normalization

// Timing/environment noise → constant leaves.
const VOLATILE_LEAF = new Set([
  "eventId", "traceId", "timestamp", "createdAt", "updatedAt", "generatedAt",
  "since", "until", "tzOffsetMs", "duration", "elapsedMs", "durationMs",
  "uptimeMs", "startedAt", "endedAt", "occurredAt", "intervalMs",
  "avgTimeToFirstTokenMs", "avgTurnDurationMs", "avgTimeToFirstContentMs",
  // t02 真值（09-19）：tool.lifecycle performance 的 fs 实测时延（zcode 实测
  // 写耗时 4ms 级、drora 同为实测位）——墙钟时延本质随机，数值归一。
  "fsReadMs", "fsWriteMs",
  // t08 真值（09-20）：subagent result output 的 serialization 计数——usage
  // 块 duration_ms 位数抖动 ±1-2 字节（墙钟），归零保断言面在内容本身。
  "originalBytes", "returnedBytes",
  // t09 真值（09-19）：autoResolution 墙钟三元组（startedAt 已在表；visibleAt/
  // deadlineAt=startedAt+常量偏移——绝对墙钟归一，结构/状态仍断言）。
  "visibleAt", "deadlineAt",
  // h01/h02 真值（09-19）：bash perf 的 commandRunMs 实测墙钟（pj1 commandRunMs
  // 同族）——进程调度级随机，数值归一（键在位仍断言）。
  "commandRunMs", "noOutputMs",
  // 2026-10-08：executionStartedAt 双侧均为墙钟浮点毫秒（事件投递时点），
  // 仅数值随机——归一同族（结构/顺序仍由事件序列断言）。
  "executionStartedAt",
  // x09 真值（09-20）：backgroundJobs 行 pid（进程随机分配）。
  "pid",
  // t08 真值（09-20）：subagent stopped 帧 totalDurationMs（子代理墙钟随机）。
  "totalDurationMs",
  "lastUpdated", "longestSessionMs",
  // fixM：消息记录时间叶子（zcode time.created/completed、part time.start/end）
  // 与 envInfo 噪声数组（gitStatusLines 两侧 pass 间可漂移）。
  "created", "completed", "start", "end", "gitStatusLines",
  // wave2a 仲裁④（用户授权）：模型遥测首字毫秒是时序噪声——avg* 兄弟键已在
  // 上方，per-request 三键此前漏归一。
  "timeToFirstContentMs", "timeToFirstProviderEventMs", "timeToFirstTextMs",
  // wave3 仲裁（R2 申报落地）：goal 运行时时间叶——activeRun* 是 per-run
  // 起止毫秒，`updated` 是泛化变更时间戳（定义即噪声）。
  "updated", "activeRunStartedAtMs", "activeRunLastSeenAtMs",
  // wave4 仲裁②：插件安装时间戳（install/uninstall 落账真钟值）。
  "installedAt",
  // 2026-09-18 t02 勘误：readState readFileState 的文件 mtime 叶（工具读写
  // 刚落盘文件，双侧墙钟必异——环境噪声非行为面）。
  "mtimeMs", "readAtMs",
  // phase7 R3：streamRecovery committedAt 是真钟 ISO 值（恢复投影锚的结算时点）。
  "committedAt",
  // phase7 v4 面：订阅 ack openTiming 计时噪声族（zcode Iti——per-run 毫秒）。
  "hostPrepareMs", "providerRegistrySyncMs", "taskMetaReadMs", "cliBootstrapMs", "initialFrameEncodeMs", "cliSessionRestoreMs",
  // p7 R3.6：工具 result perf 计时叶（真值自身即时变——磁盘竞速毫秒）。
  "totalMs", "permissionWaitMs", "readMs", "writeMs",
  // p7 R3.6 扩展（xZo command 族）：runMs/noOutputMs/firstOutputMs 是 bash
  // 执行墙钟（真值自身即时变）——detail.command 结构逐键断言不含计时值。
  "runMs", "noOutputMs", "firstOutputMs",
  // v3 真值（09-20）：retry_scheduled fact 的 delayMs 是重试退避墙钟（双侧
  // 同为指数退避实测毫秒，轮间必漂）——键在位仍断言，数值归一。
  "delayMs",
  // F11 G1：read 面 RMi state.completedAt 是真毫秒值（测试台债务清单项）。
  "completedAt",
]);
// Correlation ids → per-side canonical aliases; identity relationships survive,
// literal values are hidden. Client-chosen values map identically on both sides.
const ALIAS_KIND = {
  sessionId: "s", forkedSessionId: "s", childSessionId: "s", parentSessionId: "s",
  sessionID: "s",
  turnId: "t", childTurnId: "t", currentTurnId: "t", activeTurnId: "t",
  messageId: "m", targetMessageId: "m", parentMessageId: "m",
  // fk1 真值（09-20）：timeline part 的 anchorMessageId=child-local 锚行 id
  // （双侧各自 per-run 随机）——同 m 通道（与 anchorId/attemptId 串内嵌折
  // 叠同族，键通道化保 identity）。
  anchorMessageId: "m",
  // 2026-09-19 t02：checkpoint 的 toolMessageId=工具结果消息 id——drora 不外发
  // tool 行（幻影行修复），该 id 双侧首见位次必然错位 → a 通道吸收值保位次。
  toolMessageId: "a",
  // fixM：消息记录 transcript 方言 id 族（zcode `id`/messageID/parentID/
  // boundaryMessageId/orderedMessageIds 元素——键即别名通道）。
  id: "m", messageID: "m", parentID: "m", boundaryMessageId: "m", orderedMessageIds: "m",
  partId: "p",
  toolCallId: "c", parentToolCallId: "c", childToolCallId: "c", callId: "c",
  // p7 R3.5：zcode transcript part 方言的 callID 拼写（大写 ID）同通道——
  // 两侧 mock 协议槽位派生值（openai call_N vs anthropic toolu_N）。
  callID: "c",
  requestId: "r", serverRequestId: "q",
  // t09 真值（09-19）：autoResolution 广播的 interactionId=perm_uuid（门铸造
  // 的请求 id 同族）——r 通道吸收。
  interactionId: "r",
  checkpointId: "k", targetCheckpointId: "k",
  // 2026-09-18：checkpoint URI 内嵌 per-side 随机 uuid——a 通道吸收值、
  // 保留 URI 在流中的身份/位次关系。
  snapshotRef: "a", diffRef: "a",
  operationId: "o", inputId: "i", queryId: "i",
  // wave1 仲裁①②：assistantMessageId 是双侧独立计数（msg_mtti… 随机段），
  // 与 messageId 同通道；流式 delta 事件的 id 面此前漏归一。
  assistantMessageId: "m",
  // wave2a 仲裁④（用户授权）：模型遥测信封 span 族（Fve @6792914——spanId/
  // parentSpanId 为 per-run 随机 uuid 前缀，modelCall.logicalCallId 为
  // ZPt @748090 per-request 随机）——关联 id 通道延伸，identity 关系保留。
  spanId: "n", parentSpanId: "n", logicalCallId: "n",
  // wave3 仲裁（R2 申报落地）：goal target id = target_<runslug>_<uuid>
  // per-run 随机（s08 op[2] 双侧实证）——独立 g 通道。
  targetId: "g", targetID: "g",
  // F14 t08：ended 台账的 agentId（agent_<uuid>）与 childSessionIds 数组
  // 元素（sess_subagent_agent_<uuid>）均 per-run 随机——独立 ag 通道+s 通道。
  agentId: "ag", childSessionIds: "s", childSessionId: "s",
  // w67 预基线仲裁（批准落地）：runtime_command 进程级单调计数器——一侧
  // 多打一个运行时命令（如 s09 压缩遥测帧）即全程 ±1 级联（h01/h02 实证
  // 各仅此 1 叶）。按首见序别名保序关系。
  foregroundExecutionId: "f",
  // w6 仲裁（批准落地）：s09 压缩边界身份族——摘要消息 id 走 m 通道延伸，
  // boundaryId=K1e compact_<uuid> per-run 随机，独立 b 通道。
  summaryMessageId: "m", summaryMessageIds: "m", lastSummarizedMessageId: "m", tailStartMessageId: "m",
  boundaryId: "b",
  // phase7 v4 面：logEpoch/atLogEpoch 是 per-run 随机 CAS 纪元（zcode
  // defaultLogEpoch Date36-rand36），e 通道保 CAS 关系隐藏字面值；
  // subscriptionId 独立 u 通道；entityId（行实体=message/turn id 族）走 m
  // 通道；attachment ref 独立 a 通道。
  logEpoch: "e", atLogEpoch: "e",
  subscriptionId: "u",
  entityId: "m",
  ref: "a",
  // v4 frame 信封的逻辑帧 id 内嵌 subscriptionId+序号——u 通道按首见序保序。
  logicalFrameId: "u",
};
const HOME = process.env.USERPROFILE || process.env.HOME || "";

function makeNormalizer(echoSelf, echoOther, homeSelf, homeOther) {
  const aliases = new Map();
  // 终审 §六 债务（2026-09-12 B3 落地）：eventSeq 是单调总线计数器，其绝对值
  // 编码的是各家内部总线成员模型（zcode 按 q.* 原始事件 append、drora 的
  // message/part 投影事件同账本占号）——绝对值差已定谳为总线构成差（s03 双侧
  // 通知 9=9 同形同序、es 终值 32 vs 18），非可观测行为面。按 alias 通道化
  // （requestId 同例）：单调值→本侧第 N 个不同值（保序）；真实顺序/缺发差异
  // 仍由 kind 序列与载荷键暴露。
  const esRanks = [];
  const seqRanks = [];
  const alias = (kind, value) => {
    const key = `${kind}:${value}`;
    if (!aliases.has(key)) aliases.set(key, `#${kind}${aliases.size + 1}`);
    return aliases.get(key);
  };
  const hs = homeSelf ? homeSelf.replaceAll("\\", "/") : "";
  const ho = homeOther ? homeOther.replaceAll("\\", "/") : "";
  const leaf = (value, key) => {
    if (key === "stack") return "<stack>";
    // 2026-10-08 改名收编：protocol.name 品牌串（Drora/ZCode Protocol）为
    // 全量改名的设计内分歧，折叠为同一 token，保留其余结构比对。
    if (value === "Drora Protocol" || value === "ZCode Protocol") return "<proto-brand>";
    // 消息 info.agent 品牌串（drora-agent/zcode-agent）同类收编。
    if (value === "drora-agent" || value === "zcode-agent") return "<agent-brand>";
    // final10 工单（final9 §六.5 对拍器工单）：streamRecovery 锚点族内嵌
    // provider 消息 id（msg_mu00* 随机后缀，两侧各自生成）——anchorId/
    // attemptId 提取内嵌 id 入 m 值通道（同 id 同别名，identity 关系保留；
    // 与 assistantMessageId 键通道汇合同一别名），锚点结构字面（:call:
    // tool-result / :end-of-stream 后缀）原样比对。resultPartId 两侧形态
    // 不同（drora part_<msgId>_<callId> vs zcode part_mu<N>_<uuid> 独立
    // 分配——bt4 seq16 实证）但语义同为"本调用部件 id"：整值走 p 值通道
    // （首见序别名，同帧序双侧对位）。
    if (typeof value === "string" && key === "revisionId") {
      return value.replace(/\d{10,}/g, "<mtime>");
    }
    if (typeof value === "string" && key === "resultPartId") {
      return alias("p", value);
    }
    if (typeof value === "string" && (key === "anchorId" || key === "attemptId")) {
      const folded = value
        // msg_ 后的前缀是时间计数器编码（09-20 写死 msg_mu 时为 mu 段；
        // 2026-10-09 上午滚入 mv 段致正则失配，fk1/x09 整族误红）——
        // 泛化为 msg_m 起头，随时间前滚免疫。
        .replace(/msg_m[0-9a-zA-Z]+_[0-9a-f-]+/g, (id) => alias("m", id))
        .replace(/\b(?:call|toolu)_(\d+)\b/g, "toolid_$1");
      // startup/storageState 的 attemptId 是裸 uuid（非 msg_ 内嵌位），per-run
      // 随机；负载拖慢启动时该通知流可整段落入开窗（r6 实证 9 场景误红），
      // 按形状折叠，保留 phase/sequence 结构比对。
      return /^[0-9a-f-]{36}$/.test(folded) ? "<UUID>" : folded;
    }
    if (typeof value === "string" && key === "databaseId" && /^[0-9a-f]{64}$/.test(value)) {
      // 同上：storageState databaseId 为内容 sha256，per-run 随机。
      return "<DBID>";
    }
    if ((key === "eventSeq" || key === "sequenceNumber") && typeof value === "number") {
      let idx = esRanks.indexOf(value);
      if (idx === -1) { esRanks.push(value); idx = esRanks.length - 1; }
      return `#es${idx + 1}`;
    }
    // wire 发射台账 seq（session/event 帧）：zcode 台账计入被投递过滤的帧
    // （message.upserted 等），drora 影子帧不计数——t03 tool.updated seq
    // 10v12 同构错位。同 eventSeq 准则 rank 通道化（独立 rank 列表；kind 序
    // 相等仍由事件序列对比把守）。
    if (key === "seq" && typeof value === "number") {
      let idx = seqRanks.indexOf(value);
      if (idx === -1) { seqRanks.push(value); idx = seqRanks.length - 1; }
      return `#ws${idx + 1}`;
    }
    if (VOLATILE_LEAF.has(key)) return typeof value === "number" ? 0 : "<volatile>";
    // w5 仲裁②（批准落地）：contextUsage breakdown chars 是 zcode Zzr
    // （@10890231 区）运行期自估诊断面——请求面契约字节已证等（x90 单变量
    // 场景共享 19 工具 77530/77530），±2 藏于 BT 规范化外部不可观测细节。
    // 32 字节桶归一：桶间差仍捕大回归（s04 Δ52 实证跨桶 6 vs 4）。
    if (key === "chars" && typeof value === "number") return Math.round(value / 32);
    // t08 真值（09-20）：output 串内嵌 usage 块的 duration_ms（子代理墙钟
    // 随机）与 agentId 行（子代理随机 uuid）——串级掩蔽（J: 路径不走
    // VOLATILE_TEXT 的 ms 正则；agent_ uuid 非别名键通道）。
    if (typeof value === "string" && value.includes("duration_ms: ")) {
      const masked = value
        .replace(/duration_ms: \d+/g, "duration_ms: N")
        .replace(/agent_[0-9a-f-]{36}/g, "<agent-uuid>");
      return masked;
    }
    // wave2a 仲裁④（用户授权）：双侧 mock 协议槽不对称（zcode 走 anthropic、
    // drora env 别名走 openai-compatible，DRORA_PROVIDER_ID 先例的延伸）——
    // providerKind 是刺激面派生值，非行为面。
    if (key === "providerKind") return "<provider-kind>";
    // p7 r8：marketplace 公网 archive 抓取失败的 diagnostic 整条是外网可达性
    // 噪声（离线 harness 下双侧都不应被外网波动定罪）——数组级整条剔除。
    if (key === "diagnostics" && Array.isArray(value)) {
      return value
        .filter((item) => !(item && typeof item === "object" && typeof item.code === "string" && item.code.startsWith("plugin_archive_fetch")))
        .map((item) => walk(item, key));
    }
    if (typeof value === "string") {
      const v = value.replaceAll("\\", "/");
      // literals we sent identically to both sides pass through untouched —
      // alias numbering must not be consumed by client-chosen values
      if (echoSelf?.has(v) && echoOther?.has(v)) return v;
      let n = v;
      // fk1 真值（09-20）：fork response/notice 文本内嵌 msg_m<时间前缀><rand>_<uuid>
      // （双侧各自 per-run 随机；键通道覆盖不到串内嵌位）——同 anchorId 折
      // 叠规则，m 通道保 identity。键通道值（targetMessageId 等）跳过——
      // 先折后键通道别名会二次别名（#m2→#m16 双号，fk1 实证）。
      if (typeof value === "string" && !(typeof key === "string" && ALIAS_KIND[key])) {
        n = n.replace(/msg_m[0-9a-zA-Z]+_[0-9a-f-]{36}/g, (id) => alias("m", id));
      }
      // wave1 仲裁①：mock 模型名可内嵌（wire model "anthropic/mock-drora"）——
      // 全局替换而非仅串首；两侧 env 别名派生噪声，非行为面。
      n = n.replace(/mock-(drora|zcode)/g, "mock");
      // wave1 仲裁③：双侧各自 mock 端口（baseURL http://127.0.0.1:<port>/v1）——
      // 端口是 per-run 随机分配，折叠为定值。
      n = n.replace(/(127\.0\.0\.1|localhost):\d+/g, "$1:<PORT>");
      // w5 仲裁①（批准落地）：错误消息内嵌 per-run 随机会话 id（-32004
      // "Session not found: sess_<uuid>"，双侧行为全等仅 id 各异）——别名
      // 键通道够不到字符串内嵌位，按 uuid 形状正则折叠；客户端字面量
      // （sess_none 等）不匹配 uuid 形状不受影响。
      n = n.replace(/sess_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<SESSID>");
      // v2 真值（09-20）：error.detail 内嵌 request=<uuid>（Fve requestId
      // 双侧各自随机——键通道在串内嵌位够不到）按 uuid 形状折叠。
      n = n.replace(/request=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "request=<UUID>");
      // x09 真值（09-20）：后台通知文本/backgroundJobs 行的 exec_<uuid>
      // 任务 id（串内嵌+taskId 键的 per-run 随机）按形状折叠。
      n = n.replace(/exec_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "exec_<UUID>");
      // 族D 勘误（t04 ev9 复审）：executionOrder/parallelGroups 数组元素内嵌
      // 的工具调用 id 是 mock 双线槽位派生值（openai 线 call_N / anthropic 线
      // toolu_N——两侧都是透传各自 provider 的 id，非行为差）。键通道（callId
      // 等）已归一，这里折叠字符串内嵌形。
      n = n.replace(/\b(?:call|toolu)_(\d+)\b/g, "toolid_$1");
      if (HOME && n.startsWith(HOME.replaceAll("\\", "/"))) n = `<HOME>${n.slice(HOME.length)}`;
      // wave4 仲裁①（批准落地）：假 home 隔离根（<OUT>/home-drora vs
      // home-zcode）+存储品牌段（.drora/cli vs .zcode/cli）是机械侧标识
      // ——路径级行为无分歧（e01/i01/i02 残差 100% 此类，叶级分类实证）。
      // x09（09-20）：output 串内嵌路径（后台通知文本）不走 startsWith——
      // 全局替换覆盖嵌入位。
      if (hs) n = n.split(hs).join("<RUNHOME>");
      else if (ho) n = n.split(ho).join("<RUNHOME>");
      n = n.replace(/\/\.(drora|zcode)\/cli\//g, "/.STORAGE/cli/");
      // 2026-10-08：串行双 pass 的 per-pass ws 目录后缀（.../t01-p1|p2）——
      // 机械 pass 标识，双侧各记录自己 pass 的路径，折叠后缀（内嵌错误
      // 文本里后缀可后跟句点/冒号，一并覆盖）。
      n = n.replace(/-p\d+(?=[/.:,\s)]|$)/g, "");
      return typeof key === "string" && ALIAS_KIND[key] ? alias(ALIAS_KIND[key], n) : n;
    }
    return value;
  };
  const walk = (value, key) => {
    if (value === null || typeof value !== "object") return leaf(value, key);
    if (Array.isArray(value)) {
      // fixM：envInfo.gitStatusLines 两侧 pass 间文件集可漂移（长度噪声）——
      // 整列坍缩为定值（环境噪声，非行为面）。
      if (key === "gitStatusLines") return "<git-status-lines>";
      return value.map((v) => walk(v, key));
    }
    // wave2a 仲裁④（用户授权）：模型遥测信封 requestHeaders/responseHeaders
    // 内嵌 per-run uuid（x-request-id/x-session-id/x-zcode-trace-id）、墙钟
    // （date）与端口——整对象坍缩（header COUNT 键保留为真实断言叶）。
    if (key === "requestHeaders" || key === "responseHeaders") return "<headers>";
    const out = {};
    for (const k of Object.keys(value).sort()) {
      // 2026-10-08：_meta.<品牌> 诊断块（apiRetry 等）双侧各自以自家品牌作键
      // （drora/zcode）——机械侧标识，折叠为同一键名。
      const kk = key === "_meta" && (k === "drora" || k === "zcode") ? "<brand>" : k;
      out[kk] = walk(value[k], kk);
    }
    return out;
  };
  return {
    normalize: (value) => JSON.stringify(walk(value, undefined)),
    debugMap: () => [...aliases.entries()].map(([k, v]) => `${v}=${k}`),
  };
}

// ---------------------------------------------------------------- side runtime

class Side {
  constructor(name, bin, args, cwd, env, frameLog) {
    this.name = name;
    this.frameLog = frameLog;
    this.aliases = new Map(); // $name -> raw value (captured from results)
    this.echo = new Set();    // string literals sent in params (per side)
    this.pending = new Map();
    this.events = [];        // session/event envelopes (raw params)
    this.notifications = []; // other notify frames (raw)
    this.reverse = [];       // reverse requests (raw)
    this.stderrLines = [];
    this.exitCode = null;
    this.child = spawnDetached(process.execPath, [bin, ...args], { cwd, env });
    pipeLines(this.child.stdout, (line) => this.onLine(line));
    pipeLines(this.child.stderr, (line) => this.stderrLines.push(line));
    this.child.on("close", (code) => { this.exitCode = code; });
  }

  get alive() { return this.exitCode === null; }

  onLine(line) {
    let frame;
    try { frame = JSON.parse(line); } catch {
      this.stderrLines.push(`[stdout-nonjson] ${line}`);
      return;
    }
    appendFileSync(this.frameLog, `${JSON.stringify(frame)}\n`);
    if (frame.method !== undefined) {
      if (typeof frame.id === "string") this.reverse.push(frame);
      else if (frame.method === "session/event") this.events.push(frame.params ?? frame);
      else this.notifications.push(frame);
      return;
    }
    const pending = this.pending.get(frame.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      pending.resolve(frame);
    }
  }

  request(payload, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(payload.id);
        resolve({ id: payload.id, error: { code: -32099, message: `[harness] no response within ${timeoutMs}ms` } });
      }, timeoutMs);
      this.pending.set(payload.id, { resolve, timer });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(payload.id);
          resolve({ id: payload.id, error: { code: -32098, message: `[harness] stdin write failed: ${err.message}` } });
        }
      });
    });
  }

  marker(entry) {
    appendFileSync(this.frameLog, `${JSON.stringify({ t: "marker", ...entry })}\n`);
  }

  kill() {
    killTree(this.child);
  }
}

// ---------------------------------------------------------------- policies

/** Symmetric reverse-request policies: both sides get identical treatment. */
function reverseAnswer(frame) {
  const p = frame.params ?? {};
  switch (frame.method) {
    case "interaction/requestPermission": {
      // zcode E2 应答 schema（bundle VLe=f.enum(allow/deny/escalate/modify)，
      // .strict() 无 optionId 键）——正形应答仅 {decision: <动词>}。此前把
      // 选项单 optionId（allow_once 等）塞进 decision 槽，zcode strict 解析
      // 抛错→"Permission request failed"→拒绝工具（p7 r3 t02 系实证）。
      return { result: { decision: "allow" } };
    }
    case "interaction/requestUserInput": {
      // zcode dwn 应答 schema：{requestId(必填), value?, cancelled?}——value
      // 必须是问题单的合法选项值（AskUserQuestion 校验选项，非法值 → deny，
      // p7 t09 实证），取首问题首选项的 value/label。
      const questions = Array.isArray(p.questions) ? p.questions : [];
      const options = Array.isArray(questions[0]?.options) ? questions[0].options : [];
      const picked = options[0] ?? {};
      const value = typeof picked.value === "string" && picked.value
        ? picked.value
        : typeof picked.label === "string" ? picked.label : "mock-answer";
      return { result: { requestId: p.requestId, value } };
    }
    case "session/requestRuntimePreferences":
      return { result: { nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: true, modelContextBudgetStrategy: "preflight-v1" } };
    case "automation/list":
      return { result: { automations: [] } };
    case "automation/delete":
      // tf4（09-19）：zcode CronDelete 经 automation/delete 反向请求（yEt
      // {deleted} 形，桌面客户端域）——无策略时 -32601 文案被 zcode 吃进工具
      // 错误，伪造单侧差。store 无该 id → deleted:false → zcode 产
      // "no automation with id: …" 与 drora 本地删同形。
      return { result: { deleted: false } };
    case "automation/checkTaskBinding":
      return { result: { bound: false } };
    case "interaction/requestProviderRuntimeHeaders":
      // zcode VCt strict（@450547）：{headersApplied 必填, errorMessage?,
      // providerRevision?}；headersApplied:false → 真值抛 -32031。触发条件
      // （@11971660 shouldRefreshBeforeModelRequest）仅 providerId 为
      // builtin:zai-start-plan / builtin:bigmodel-start-plan——harness mock
      // 别名 provider 恒不触发，对称应答仅防御性保留。
      return { result: { headersApplied: true, providerRevision: "mock-1" } };
    case "interaction/requestOfficialMcpAuthHeaders":
      // zcode GCt discriminated union（@450762）：{ok:true,headers}|
      // {ok:false,reason}。触发条件（@11926739 official MCP auth port）需
      // 官方 MCP 插件源（mcpKey+targetOrigin）——harness 不可达，防御性保留。
      return { result: { ok: true, headers: { "x-mock-auth": "mock-run" } } };
    case "offPeak/list":
      // bt7 清偿债（10-09）：OffPeakList 工具经反向请求 offPeak/list 向 Host 取
      // 闲置任务快照。应答 schema 严格（双侧 zod 同拒多余 ok 键=bt7 实证），
      // 合法形仅 {tasks:[...]}。空表对称应答，双侧同刺激。
      return { result: { tasks: [] } };
    default:
      return { error: { code: -32601, message: `[harness] no policy for reverse method ${frame.method}` } };
  }
}

// ---------------------------------------------------------------- helpers

function substitute(value, aliasMap) {
  if (typeof value === "string") {
    let v = value;
    for (const [name, val] of aliasMap) v = v.split(name).join(val);
    return v;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, aliasMap));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, aliasMap)]));
  }
  return value;
}

function capturePath(obj, dotPath) {
  let cur = obj;
  for (const seg of dotPath.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[seg];
  }
  return cur;
}

function collectStrings(value, into) {
  if (typeof value === "string") into.add(value.replaceAll("\\", "/"));
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, into));
  else if (value !== null && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, into));
}

function safeParse(json) {
  try { return JSON.parse(json); } catch { return json; }
}

// ---------------------------------------------------------------- scenario run

async function runScenario(sc, sides, wsDir, outDir, normalizers, resetMocks) {
  const state = {
    nextId: 1,
    timeline: [],      // per-opIndex merged records
    baseline: {},      // per-side event baselines (set at each pass start)
    baselineNotif: {}, // per-side notification baselines（v4 frame 出站窗）
    filesWritten: new Set(),
  };
  const result = { id: sc.id, title: sc.title ?? "", file: sc._file, status: "ALIGNED", firstDiff: null };
  const serial = sc.serial === true;

  const runPass = async (sideNames) => {
    for (const name of sideNames) {
      state.baseline[name] = sides[name].events.length;
      state.baselineNotif[name] = sides[name].notifications.length;
      sides[name].marker({ scenario: sc.id, pass: sideNames.join("+"), opIndex: -1, op: "pass-start" });
    }
    const ops = sc.ops ?? [];
    for (let opIndex = 0; opIndex < ops.length; opIndex++) {
      const op = ops[opIndex];
      for (const name of sideNames) {
        sides[name].marker({ scenario: sc.id, opIndex, op: op.op, method: op.method ?? op.type ?? "" });
      }

      if (op.op === "request") {
        const entries = await Promise.all(sideNames.map(async (name) => {
          const side = sides[name];
          const payload = { id: state.nextId, method: op.method, params: substitute(op.params ?? {}, side.aliases) };
          collectStrings(payload.params, side.echo);
          const resp = await side.request(payload, op.timeoutMs ?? REQ_TIMEOUT_MS);
          return { side, resp };
        }));
        state.nextId += 1;
        for (const { side, resp } of entries) {
          for (const [aliasName, dotPath] of Object.entries(op.capture ?? {})) {
            const raw = capturePath(resp.result ?? {}, dotPath);
            if (typeof raw === "string" && raw) side.aliases.set(aliasName, raw);
          }
        }
        const record = state.timeline[opIndex] ?? (state.timeline[opIndex] = { kind: "request", method: op.method, reqId: state.nextId - 1, equal: null, drora: null, zcode: null });
        for (const { side, resp } of entries) {
          record[side.name] = safeParse(normalizers[side.name].normalize(resp));
        }
        if (record.drora !== null && record.zcode !== null && record.equal === null) {
          const eq = JSON.stringify(record.drora) === JSON.stringify(record.zcode);
          record.equal = eq;
          if (!eq && process.env.ALIAS_DEBUG === "1") {
            console.error(`[pairdebug response op[${opIndex}] ${op.method}] -> resp-diff-op${opIndex}.json`);
            writeFileSync(path.join(OUT, `resp-diff-op${opIndex}.json`), JSON.stringify({ method: op.method, drora: record.drora, zcode: record.zcode }, null, 1));
          }
          if (!eq && !result.firstDiff) {
            result.firstDiff = { at: `op[${opIndex}] ${op.method}`, kind: "response" };
            result.status = "CONTENT_DIFF";
          }
        }
        continue;
      }

      if (op.op === "waitEvent") {
        const need = op.count ?? 1;
        const deadline = Date.now() + (op.timeoutMs ?? EVENT_TIMEOUT_MS);
        const gotSince = (name) => sides[name].events.slice(state.baseline[name]).filter((e) => e.type === op.type).length;
        const ok = {};
        while (Date.now() < deadline && sideNames.some((name) => !ok[name])) {
          await new Promise((r) => setTimeout(r, 100));
          for (const name of sideNames) ok[name] = gotSince(name) >= need;
        }
        const record = state.timeline[opIndex] ?? (state.timeline[opIndex] = { kind: "waitEvent", type: op.type, need, ok: {} });
        for (const name of sideNames) record.ok[name] = { got: gotSince(name), ok: ok[name] ?? false };
        if (sideNames.some((name) => !ok[name]) && !result.firstDiff) {
          result.firstDiff = { at: `op[${opIndex}] waitEvent ${op.type}`, kind: "timeout" };
          result.status = "TIMEOUT";
        }
        if (process.env.WAIT_SETTLE_MS) await new Promise((r) => setTimeout(r, Number(process.env.WAIT_SETTLE_MS)));
        // pt1/r34 两轮实验在案（均撤销）：baseline 消费式推进（无论盲推
        // events.length、按匹配类型推进、per-type 计数消费）都会改变多回合
        // 场景的 waitEvent 语义（s04 等依赖陈旧匹配立即通过）——电池级重标
        // 定专项在案（台账 10.13/10.14）。
        continue;
      }

      if (op.op === "writeFile") {
        if (!state.filesWritten.has(op.path)) {
          state.filesWritten.add(op.path);
          const full = path.join(wsDir, op.path);
          mkdirSync(path.dirname(full), { recursive: true });
          writeFileSync(full, op.content ?? "");
        }
        continue;
      }

      if (op.op === "writeHome") {
        // seed a per-side fake-home file (config domain: zcode-shape config,
        // plugin manifests, skills) — content identical, path mirrored
        const key = `${op.side}:${op.path}`;
        if (!state.filesWritten.has(key)) {
          state.filesWritten.add(key);
          const full = path.join(sides[op.side].homeDir, op.path);
          mkdirSync(path.dirname(full), { recursive: true });
          writeFileSync(full, op.content ?? "");
        }
        continue;
      }

      if (op.op === "sleep") {
        await new Promise((r) => setTimeout(r, Number(op.ms ?? 250)));
        continue;
      }

      state.timeline[opIndex] = { kind: "unknown", op };
    }
  };

  if (serial) {
    let passIdx = 0;
    for (const name of ["drora", "zcode"]) {
      await resetMocks(); // replay plan cursors from step 0 for each side
      state.nextId = 1;   // request ids must match across passes
      // p7 t02 仲裁：serial 两轮 pass 共享场景 ws——side 1 的写产物泄漏进
      // side 2 的刺激面（zcode "has not been read" 拒写而 drora 成功）。
      // 每 pass 前清空 ws、重置种子账，保证双侧同构初态（writeFile op 重播）。
      // 2026-10-08 改每 pass 独立 ws 目录（wsDir-p1/-p2）：原"pass 边界
      // rmSync 清空活目录"与存活侧 app-server 的 workspace watcher/插件宿主
      // 目录句柄竞速（t01/bt* EPERM HARNESS_ERROR 根因，重试不可救）——
      // Windows 目录句柄阻止删除；隔离语义由独立目录等价保留且免删活目录。
      const passWs = `${wsDir}-p${++passIdx}`;
      rmSync(passWs, { recursive: true, force: true });
      mkdirSync(passWs, { recursive: true });
      for (const side of Object.values(sides)) side.aliases.set("$WS", passWs);
      state.filesWritten.clear();
      await runPass([name]);
      await settle(sides);
    }
  } else {
    await resetMocks();
    await runPass(["drora", "zcode"]);
  }

  // --- event stream comparison over this scenario's window
  // p7 真值仲裁：completed-typed/aggregate 双 su 相对 tu(sched)/tu(started)
  // 的位次是 zcode 自身异步竞速（fix-w27 t01/t02 互反实证）——从严格序列
  // 比对中剔除这两类完成帧（内容仍进 evPM 计数），其余事件保持严格按序。
  const isRaceFrame = (e) =>
    e.type === "session.updated" &&
    (e.payload?.type === "model_request_completed" || e.payload?.cacheHit !== undefined);
  const evDroraAll = sides.drora.events.slice(state.baseline.drora ?? 0);
  const evZcodeAll = sides.zcode.events.slice(state.baseline.zcode ?? 0);
  const evDrora = evDroraAll.filter((e) => !isRaceFrame(e));
  const evZcode = evZcodeAll.filter((e) => !isRaceFrame(e));
  const seqDrora = evDrora.map((e) => e.type);
  const seqZcode = evZcode.map((e) => e.type);
  const sameSeq = JSON.stringify(seqDrora) === JSON.stringify(seqZcode);

  // phase7：通知流窗口（v4/conversation/frame 等出站通知此前不进 diff——
  // v4 网关面的比对盲区）。方法序结构对比 + 归一化载荷对比，同事件口径折叠。
  // process/resourceSample 是 60s 周期采样器——相位随机器负载漂移，属时序
  // 噪声（同 gitStatusLines 口径），从窗口对比中剔除。
  // process/mcpTelemetry 是 ~2s 异步租约结算发射——到达时点跨场景窗泄漏
  // （tl2 会话的迟发落在后继场景窗，zcode/drora 同理），窗口归属即噪声；
  // 其生命周期语义（每租约 pair/计数面）由专用探针场景另行把关（todo）。
  // state.updated/prompt_completed 是真值固有竞速窗（2026-09-15 wave-e2 帧证）：
  // 同一 mock 时序下 zcode 自身 round1 背靠背（受理即发）、round2 延迟 4 帧
  // （排在回合遥测之后）——发点随时序漂移、逐 run 可复现但不可由任何确定性
  // 发点复刻。浮动化处理（不计位序），但计数守恒断言保留（发射次数语义）。
  const isNotifNoise = (n) => n.method === "process/resourceSample" || n.method === "process/mcpTelemetry";
  const isRacyNotify = (n) => n.method === "state.updated" && n.params?.reason === "prompt_completed";
  // 09-19 notify 族竞速定谳（tf5 帧 es16/17 早 vs t01 帧 es21/22 迟——同构点
  // 两序，zcode 内部 ModelComplete fact 发射 vs 工具调度=异步竞速）：每模型轮
  // 的完成态 fact（model.request.status completed + usage.delta）相对工具事件
  // 位次浮动化（同 prompt_completed 口径）——计数守恒断言保留（每轮恒一对）。
  const isRacyFact = (n) => n.method === "v4/telemetry/event"
    && (n.params?.kind === "usage.delta"
      || (n.params?.kind === "model.request.status" && n.params?.durationMs !== undefined));
  const countRacy = (arr) => arr.filter(isRacyNotify).length;
  const countFacts = (arr) => arr.filter(isRacyFact).length;
  const ntDroraAll = sides.drora.notifications.slice(state.baselineNotif.drora ?? 0).filter((n) => !isNotifNoise(n));
  const ntZcodeAll = sides.zcode.notifications.slice(state.baselineNotif.zcode ?? 0).filter((n) => !isNotifNoise(n));
  const pcDrora = countRacy(ntDroraAll);
  const pcZcode = countRacy(ntZcodeAll);
  const factDrora = countFacts(ntDroraAll);
  const factZcode = countFacts(ntZcodeAll);
  const ntDrora = ntDroraAll.filter((n) => !isRacyNotify(n) && !isRacyFact(n));
  const ntZcode = ntZcodeAll.filter((n) => !isRacyNotify(n) && !isRacyFact(n));
  const nseqDrora = ntDrora.map((n) => n.method);
  const nseqZcode = ntZcode.map((n) => n.method);
  const sameNseq = JSON.stringify(nseqDrora) === JSON.stringify(nseqZcode);
  const notifPairs = [];
  let notifMismatch = 0;
  const nn = Math.min(ntDrora.length, ntZcode.length);
  for (let i = 0; i < nn; i++) {
    const a = normalizers.drora.normalize(ntDrora[i]);
    const b = normalizers.zcode.normalize(ntZcode[i]);
    if (a !== b) {
      notifMismatch += 1;
      if (notifPairs.length < 12) notifPairs.push({ index: i, method: ntDrora[i].method, drora: safeParse(a), zcode: safeParse(b) });
    }
  }

  const payloadPairs = [];
  let payloadMismatch = 0;
  const n = Math.min(evDrora.length, evZcode.length);
  for (let i = 0; i < n; i++) {
    const a = normalizers.drora.normalize(evDrora[i]);
    const b = normalizers.zcode.normalize(evZcode[i]);
    if (a !== b) {
      payloadMismatch += 1;
      if (payloadPairs.length < 12) {
        payloadPairs.push({ index: i, type: evDrora[i].type, drora: safeParse(a), zcode: safeParse(b) });
      }
    }
  }
  if (process.env.ALIAS_DEBUG === "1") {
    for (const pair of payloadPairs.slice(0, 12)) {
      console.error(`[pairdebug event[${pair.index}] ${pair.type}]\n  drora: ${JSON.stringify(pair.drora)}\n  zcode: ${JSON.stringify(pair.zcode)}`);
    }
    for (const pair of notifPairs.slice(0, 12)) {
      console.error(`[pairdebug notify[${pair.index}] ${pair.method}]\n  drora: ${JSON.stringify(pair.drora)}\n  zcode: ${JSON.stringify(pair.zcode)}`);
    }
    console.error(`[aliasdebug post] dmap:`, JSON.stringify(normalizers.drora.debugMap()));
    console.error(`[aliasdebug post] zmap:`, JSON.stringify(normalizers.zcode.debugMap()));
  }

  if (result.status === "ALIGNED") {
    if (pcDrora !== pcZcode) {
      result.status = "STRUCT_DIFF";
      result.firstDiff = { at: `notify-sequence (prompt_completed ${pcDrora}vs${pcZcode})`, kind: "notify-structure" };
    } else if (factDrora !== factZcode) {
      // 浮动 fact 的计数守恒断言（每模型轮恒一对 completed+usage.delta）。
      result.status = "STRUCT_DIFF";
      result.firstDiff = { at: `notify-sequence (completion facts ${factDrora}vs${factZcode})`, kind: "notify-structure" };
    } else if (!sameSeq) {
      result.status = "STRUCT_DIFF";
      result.firstDiff = { at: "event-sequence", kind: "structure" };
    } else if (payloadMismatch > 0) {
      result.status = "CONTENT_DIFF";
      result.firstDiff = { at: `event[${payloadPairs[0]?.index}] ${payloadPairs[0]?.type}`, kind: "event-payload" };
    } else if (!sameNseq) {
      result.status = "STRUCT_DIFF";
      result.firstDiff = { at: "notify-sequence", kind: "notify-structure" };
    } else if (notifMismatch > 0) {
      result.status = "CONTENT_DIFF";
      result.firstDiff = { at: `notify[${notifPairs[0]?.index}] ${notifPairs[0]?.method}`, kind: "notify-payload" };
    }
  }

  const full = {
    ...result,
    serial,
    ops: state.timeline,
    events: {
      droraTypes: seqDrora, zcodeTypes: seqZcode, sameSequence: sameSeq,
      droraCount: evDrora.length, zcodeCount: evZcode.length,
      payloadMismatchCount: payloadMismatch, payloadDiffs: payloadPairs,
    },
    notifications: {
      droraMethods: nseqDrora, zcodeMethods: nseqZcode, sameSequence: sameNseq,
      droraCount: ntDrora.length, zcodeCount: ntZcode.length,
      payloadMismatchCount: notifMismatch, payloadDiffs: notifPairs,
    },
  };
  writeFileSync(path.join(outDir, `scenario-${sc.id}.json`), JSON.stringify(full, null, 2));
  return full;
}

// ---------------------------------------------------------------- main

async function main() {
  if (!existsSync(DRORA_CJS)) fail(`drora.cjs missing: ${DRORA_CJS} — run pnpm build first`);
  if (!existsSync(ZCODE_CJS)) fail(`zcode.cjs missing: ${ZCODE_CJS} — set ZCODE_CJS_PATH`);

  const { plans, scenarios } = loadScenarios();
  if (scenarios.length === 0) fail("no scenarios matched");

  mkdirSync(OUT, { recursive: true });
  // wave2ab 定位：zcode project scope slug 有长度截断（实测 ~86 字符）。OUT 名
  // 偏长时各场景 scWs slug 的差异尾（-sNN）被截掉 → 多场景撞进同一 project
  // 作用域，前序场景被拒的 setMode 也持久化并泄漏进后续场景 create（s06 假阳性）。
  // ws 根固定短路径（repo 前缀 slug 63 + ws-<run7> 9 + /tNN ≈ 76 < 截断限），
  // 且不得置于真实 home 下（否则撞 <HOME> 归一化通道，t 系 create 假阳性）。
  // 跟随 OUT（--out 可指 C:/Users/Public 等仓外位次）——此前硬编码 REG_REPORTS
  // 使 --out 改道后 per-scenario workspace 仍写 D 盘，盘满即中途死。
  const wsDir = path.join(OUT, `ws-${Date.now().toString(36).slice(-7)}`);
  mkdirSync(wsDir, { recursive: true });

  const plansFile = path.join(OUT, "plans.json");
  writeFileSync(plansFile, JSON.stringify(plans, null, 2));
  const portDrora = await freePort();
  const portZcode = await freePort();
  spawnDetached(process.execPath, [path.join(REG_DIR, "mock-model.mjs"), "--port", String(portDrora), "--out", path.join(OUT, "mock-drora"), "--plans", plansFile]);
  spawnDetached(process.execPath, [path.join(REG_DIR, "mock-model.mjs"), "--port", String(portZcode), "--out", path.join(OUT, "mock-zcode"), "--plans", plansFile]);
  await new Promise((r) => setTimeout(r, 400));
  // 0.16.9 种模门（2026-10-08 实测定谳，探针 scripts/regression/tmp-gate/ 双侧 PASS）：
  // 旧 *_BASE_URL/_API_KEY/_MODEL env 别名已从双 CLI 契约移除（两侧对称失效，非差距）；
  // 唯一种模面=个人 Provider 配置文件。providerModelRules 必须给满 complete config
  // （manual 起步因个人 provider 无 built-in 基线，完整性校验必败→回到选择门）。
  const personalProviderConfig = (port, modelId) => ({
    schemaVersion: 1,
    config: {
      providerOrder: ["custom:mock"],
      providerConfigRules: {
        providerRules: [{
          providerId: "custom:mock",
          providerName: "Mock Provider",
          enabled: true,
          config: {
            group: "standard-personal",
            access: { type: "api-key", apiKey: "mock-key" },
            api: { type: "openai-chat-completions", baseUrl: `http://127.0.0.1:${port}/v1` },
            personalModelIds: [modelId],
            modelOrder: [modelId],
            visibility: "visible",
          },
        }],
      },
      modelConfigRules: {
        providerModelRules: [{
          providerId: "custom:mock",
          modelId,
          config: {
            enabled: true,
            properties: {
              requiresMfjsToolSchema: false,
              contextWindow: 128000,
              inputFormat: { supportsText: true, supportsImage: false, supportsVideo: false, supportsAudio: false, supportsPdf: false },
              outputFormat: { supportsText: true },
              supportsToolCall: true,
              supportsJsonSchemaOutput: false,
              supportsNativeWebSearch: false,
              supportsMidConversationSystem: true,
            },
            optionSpecs: {
              reasoningLevel: { values: ["low", "high"], map: "{}" },
              maxOutputTokens: { max: 16384, map: "{}" },
            },
          },
        }],
        manualProviderModelRules: [],
      },
      defaultModelSelection: { providerId: "custom:mock", modelId, options: { reasoningLevel: "low" } },
    },
  });
  const providerCfgDrora = path.join(OUT, "personal-provider-drora.json");
  const providerCfgZcode = path.join(OUT, "personal-provider-zcode.json");
  writeFileSync(providerCfgDrora, JSON.stringify(personalProviderConfig(portDrora, "mock-drora"), null, 2));
  writeFileSync(providerCfgZcode, JSON.stringify(personalProviderConfig(portZcode, "mock-zcode"), null, 2));
  const resetMocks = async () => {
    for (const port of [portDrora, portZcode]) {
      await fetch(`http://127.0.0.1:${port}/reset`, { method: "POST" }).catch(() => {});
    }
  };

  const git = (cmd) => { try { return execSync(cmd, { cwd: REPO_ROOT }).toString().trim(); } catch { return "?"; } };
  const baselineRev = git("git rev-parse --short HEAD");
  const baselineDirty = git("git status --porcelain").split("\n").filter(Boolean).length;

  // Full per-run home isolation: both sides resolve their storage roots from
  // os.homedir()（每场景 spawnSides(homeTag) 再派生独立 home——见工厂注记）。

  // wave1 环境注记：母 shell 可能残留 ZCODE_*/DRORA_*（桌面/旧会话联调遗留），
  // 透传进真值侧会翻默认面（实证 mode auto 漂移）——先剥离再注入本 run 别名。
  const envBase = { ...process.env };
  for (const k of Object.keys(envBase)) {
    if (/^(ZCODE|DRORA)_/.test(k)) delete envBase[k];
  }
  const sides = {};
  // 工厂化（phase12 终检定谳）：每场景全新进程对+全新家目录——真实持久化
  // 落地（usage 台账/驻留池/用户域命令发现）后，共进程跨场景累积会伪造
  // 差异（v8 家目录种命令→后续 readState 泄漏；100+ 会话累积→rs1 驱逐
  // 误杀 c01 新会话）与淹没真差异（e04 空库假设失效）。ws 仍每场景独立
  // （zcode project scope 按 workspacePath 键控）。代价 ≈+1.5s/场景。
  const spawnSides = (homeTag) => {
    const homeDrora = path.join(OUT, `home-drora${homeTag}`);
    const homeZcode = path.join(OUT, `home-zcode${homeTag}`);
    mkdirSync(homeDrora, { recursive: true });
    mkdirSync(homeZcode, { recursive: true });
    for (const [name, bin, args, env, frames] of [
      // 2026-10-08 适配：当前 drora（feat/migrate-remote-and-pet 线）已移除
      // --protocol v1 旗标（Unknown option 实证），app-server 缺省即对齐面。
      ["drora", DRORA_CJS, ["app-server", "--stdio"],
        {
          ...envBase, USERPROFILE: homeDrora, HOME: homeDrora,
          DRORA_BASE_URL: `http://127.0.0.1:${portDrora}/v1`, DRORA_API_KEY: "mock-key", DRORA_MODEL: "mock-drora", DRORA_DEBUG_V2: "1", DRORA_DEBUG_PERM: "1",
          // fixM：真值 providerID 面——zcode 侧 mock 挂 anthropic 槽（wire
          // model.providerID "anthropic"），drora 的 env 别名经 DRORA_PROVIDER_ID
          // 对齐同值（wire-shape 残差清零面；不涉请求行为）。
          DRORA_PROVIDER_ID: "anthropic",
          DRORA_PERSONAL_PROVIDER_CONFIG_FILE: providerCfgDrora,
          DRORA_OFFICIAL_PLUGIN_ROOT,
        },
        path.join(OUT, "frames-drora.jsonl")],
      ["zcode", ZCODE_CJS, ["app-server", "--stdio"],
        {
          ...envBase, USERPROFILE: homeZcode, HOME: homeZcode,
          ZCODE_BASE_URL: `http://127.0.0.1:${portZcode}/v1`, ZCODE_API_KEY: "mock-key", ZCODE_MODEL: "mock-zcode",
          ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: providerCfgZcode,
        },
        path.join(OUT, "frames-zcode.jsonl")],
    ]) {
      const home = name === "drora" ? homeDrora : homeZcode;
      sides[name] = new Side(name, bin, args, wsDir, env, frames);
      sides[name].homeDir = home;
      sides[name].aliases.set("$WS", wsDir);
      sides[name].aliases.set("$REPO", REPO_ROOT);
      sides[name].aliases.set("$REG", REG_DIR);
      // N1 探针（setModel→compact 摘要请求模型面）：每侧各自的 mock URL——
      // workspace 注册 provider 行的 baseURL 指向本侧 mock，摘要请求落回
      // requests.jsonl 供 request-diff 断言。
      const mockPort = name === "drora" ? portDrora : portZcode;
      sides[name].aliases.set("$MOCK", `http://127.0.0.1:${mockPort}/v1`);
    }
  };

  writeFileSync(path.join(OUT, "stderr-drora.log"), "");
  writeFileSync(path.join(OUT, "stderr-zcode.log"), "");
  // phase8：按场景反向请求策略——sc.reversePolicy[method] = "none"（不应答，
  // 仿无宿主面：真值侧应自行 deny 快收）/ "deny"（拒绝应答）。缺省沿用上面的
  // 对称应答表。
  let activeReversePolicy = null;
  const reverseSeen = { drora: 0, zcode: 0 };
  const flushTimer = setInterval(() => {
    for (const side of Object.values(sides)) {
      while (reverseSeen[side.name] < side.reverse.length) {
        const frame = side.reverse[reverseSeen[side.name]++];
        const policy = activeReversePolicy?.[frame.method];
        if (policy === "none") continue; // 消费但不作答——请求侧悬置
        // phase10：策略值可为对象——按该方法的 result 直通应答（场景级自定义
        // 反向面，如 session/requestRuntimePreferences memoryEnabled:true）。
        const answer = policy !== null && typeof policy === "object"
          ? { result: policy }
          : policy === "deny" && frame.method === "interaction/requestPermission"
            ? { result: { decision: "deny" } }
            : policy === "deny" && frame.method === "interaction/requestUserInput"
              ? { result: { requestId: frame.params?.requestId, cancelled: true } }
              : reverseAnswer(frame);
        side.child.stdin.write(`${JSON.stringify({ id: frame.id, ...answer })}\n`);
      }
      if (side.stderrLines.length > 0) {
        appendFileSync(path.join(OUT, `stderr-${side.name}.log`), `${side.stderrLines.splice(0).join("\n")}\n`);
      }
    }
  }, 50);

  const results = [];
  for (const sc of scenarios) {
    console.log(`▶ ${sc.id} ${sc.title ?? ""}`);
    activeReversePolicy = sc.reversePolicy ?? null;
    // phase12：每场景全新进程对+家目录（吸收原 dirtyPair 语义）——持久化
    // 三面（usage 台账/驻留池/用户域命令发现）的场景间耦合根治，见工厂注记。
    for (const side of Object.values(sides)) side.kill();
    reverseSeen.drora = 0;
    reverseSeen.zcode = 0;
    spawnSides(`-${sc.id}`);
    await new Promise((r) => setTimeout(r, 800));
    // per-scenario workspace: zcode persists project-scope settings keyed by
    // workspacePath, so scenarios must not share one (s06 setMode would leak)
    const scWs = path.join(wsDir, sc.id);
    mkdirSync(scWs, { recursive: true });
    for (const side of Object.values(sides)) side.aliases.set("$WS", scWs);
    await settle(sides);
    let res;
    try {
      if (!sides.drora.alive || !sides.zcode.alive) {
        res = { id: sc.id, title: sc.title ?? "", status: "PROCESS_DIED", droraExit: sides.drora.exitCode, zcodeExit: sides.zcode.exitCode };
      } else {
        const runOnce = async (ws) => {
          const nn = {
            drora: makeNormalizer(sides.drora.echo, sides.zcode.echo, sides.drora.homeDir, sides.zcode.homeDir),
            zcode: makeNormalizer(sides.zcode.echo, sides.drora.echo, sides.zcode.homeDir, sides.drora.homeDir),
          };
          return runScenario(sc, sides, ws, OUT, nn, resetMocks);
        };
        res = await runOnce(scWs);
        // wave4 仲裁③（批准落地）：真值侧 plugin add/install 偶发 EPERM
        // rename（Windows 文件锁竞态，w4-r1 i01 op4 / w4-r3 i02 op3 双证，
        // 真值该路径无重试）——不掩饰不归一，全新 ws 整场景重跑一次。
        if (res.status === "CONTENT_DIFF" && JSON.stringify(res.ops ?? []).includes("EPERM")) {
          console.log("  ↻ 真值侧 EPERM 噪声，全新 ws 重跑");
          const scWs2 = path.join(wsDir, `${sc.id}-e2`);
          mkdirSync(scWs2, { recursive: true });
          for (const side of Object.values(sides)) side.aliases.set("$WS", scWs2);
          await settle(sides);
          res = await runOnce(scWs2);
          res.retriedEperm = true;
        }
      }
    } catch (err) {
      res = { id: sc.id, title: sc.title ?? "", status: "HARNESS_ERROR", error: String(err?.stack ?? err) };
    }
    results.push(res);
    console.log(`  → ${res.status}`);
    // dirtyPair 语义已并入场景头部的全新进程对（phase12）——无需尾部处理。
  }
  clearInterval(flushTimer);
  for (const side of Object.values(sides)) side.kill();
  killAll();
  for (const side of Object.values(sides)) {
    if (side.stderrLines.length > 0) {
      appendFileSync(path.join(OUT, `stderr-${side.name}.log`), `${side.stderrLines.splice(0).join("\n")}\n`);
    }
  }

  const byStatus = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const report = {
    runId: RUN_ID, baselineRev, baselineDirty,
    summary: { total: results.length, aligned: results.filter((r) => r.status === "ALIGNED").length, byStatus },
    scenarios: results.map(({ ops, events, notifications, ...rest }) => ({
      ...rest,
      eventCounts: events ? { drora: events.droraCount, zcode: events.zcodeCount, sameSequence: events.sameSequence, payloadMismatch: events.payloadMismatchCount } : undefined,
      notifCounts: notifications ? { drora: notifications.droraCount, zcode: notifications.zcodeCount, sameSequence: notifications.sameSequence, payloadMismatch: notifications.payloadMismatchCount } : undefined,
    })),
  };
  writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  const md = [
    `# A/B 回归报告 ${RUN_ID}`,
    "",
    `- 基线: ${baselineRev}（工作树改动文件 ${baselineDirty}）`,
    `- 汇总: ${report.summary.total} 场景 · ALIGNED ${report.summary.aligned} · ${JSON.stringify(byStatus)}`,
    "",
    "| 场景 | 状态 | 首个分歧 | 事件 drora/zcode | 载荷不一致 | 通知 drora/zcode |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map((r) => {
      const ev = r.eventCounts;
      const nt = r.notifCounts;
      const evCell = ev ? `${ev.drora}/${ev.zcode}${ev.sameSequence ? "" : " ✎序"}` : "—";
      const ntCell = nt ? `n${nt.drora}/${nt.zcode}${nt.sameSequence ? "" : " ✎序"}（n载 ${nt.payloadMismatch}）` : "—";
      return `| ${r.id} ${r.title} | ${r.status} | ${r.firstDiff ? `${r.firstDiff.at} (${r.firstDiff.kind})` : "—"} | ${evCell} | ${ev ? ev.payloadMismatch : "—"} | ${ntCell} |`;
    }),
    "",
    "明细: scenario-*.json · 原始帧: frames-*.jsonl · 模型请求: mock-*/requests.jsonl · stderr: stderr-*.log",
    "",
  ];
  writeFileSync(path.join(OUT, "report.md"), md.join("\n"));

  console.log(`\n报告: ${path.join(OUT, "report.md")}`);
  console.log(`${report.summary.aligned}/${report.summary.total} scenarios aligned`);
  process.exit(report.summary.aligned === report.summary.total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  killAll();
  process.exit(2);
});
