// CLI headless-face A/B runner: executes identical drora.cjs / zcode.cjs CLI
// commands under fake homes + mock model env, then compares normalized output.
//   node scripts/regression/cli-harness.mjs [--scenarios <file>] [--only ids]
//                                          [--out <dir>]
//
// Normalization per stdout line: JSON lines are walked with the same
// volatile/alias rules as the RPC harness; text lines get digit-run collapse
// and path tokenization, then the line sequences are LCS-diffed.
// Exit code: 0 all ALIGNED, 1 diffs, 2 infra error.
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DRORA_CJS = path.join(REPO_ROOT, "apps/drora-cli/packages/cli/dist/drora.cjs");
const ZCODE_CJS = process.env.ZCODE_CJS_PATH?.trim() || "D:\\software\\zcode\\resources\\glm\\zcode.cjs";
const REG_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = path.join(REG_DIR, "scenarios-cli");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const ONLY = String(arg("only", "")).split(",").map((s) => s.trim()).filter(Boolean);
const RUN_TIMEOUT_MS = Number(arg("run-timeout-ms", 60000));
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.resolve(String(arg("out", "")) || path.join(REG_DIR, "reports", `cli-${RUN_ID}`));

function fail(msg) {
  console.error(`[cli-harness] ${msg}`);
  process.exit(2);
}

function loadScenarios() {
  const scPath = path.resolve(String(arg("scenarios", SCENARIO_DIR)));
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
process.on("exit", () => { for (const c of children) { try { if (c.exitCode === null) c.kill(); } catch { /* best effort */ } } });
process.on("SIGINT", () => process.exit(2));

// ---- normalization ----------------------------------------------------------

const VOLATILE_LEAF = new Set([
  "eventId", "traceId", "timestamp", "createdAt", "updatedAt", "generatedAt",
  "since", "until", "tzOffsetMs", "duration", "elapsedMs", "durationMs",
  "uptimeMs", "startedAt", "endedAt", "occurredAt", "session_id", "sessionId",
  "message_id", "id",
  // CLI 面仲裁（主控 2026-09-09）：RPC 侧别名族的 CLI 对应键此前漏豁免——
  // c05 stream-json 帧 messageId/assistantMessageId/turnId 是 per-run 随机。
  "messageId", "assistantMessageId", "turnId", "targetMessageId", "checkpointId",
  // 2026-09-19 c05：span 族 16 字符截短 id（8-4-2 hex 形，UUID_SHAPE 不匹配）
  // 双侧 per-run 随机 + 完成帧时延三键（provider 时延本质随机，live 轮同判）
  // + 响应 date 头（秒精度墙钟，双进程跨秒漂移）。
  "spanId", "parentSpanId", "operationId",
  "timeToFirstProviderEventMs", "timeToFirstContentMs", "timeToFirstTextMs",
  "date",
]);
const VOLATILE_TEXT = /\d+ms|\d+\.\d+s|generated_at|usage_limit|reset_at/g;
// CLI 面仲裁（主控 2026-09-09）：uuid 形状 id（sess_/trace/turn 尾段）在
// pretty-JSON 文本行内数字掩码后仍形状互异（c03 del/add 3 对实证）——行级
// 折叠；客户端字面量（sess_none 等）不匹配 uuid 形状不受影响。
const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function makeLineNormalizer(home, ws, mockPort) {
  const alias = (kind, value) => `#${kind}${value.length % 97}`;
  const leaf = (value, key) => {
    // 2026-09-19 c05：VOLATILE_LEAF 键按 key 归一（不区分值类型——数字型
    // timestamp/durationMs 等此前原样穿透成 26 行差的主力）。
    if (typeof key === "string" && VOLATILE_LEAF.has(key)) return `<${key}>`;
    if (typeof value !== "string") return value;
    let v = value.replaceAll("\\", "/");
    v = v.split(ws.replaceAll("\\", "/")).join("<WS>").split(home.replaceAll("\\", "/")).join("<HOME>");
    if (mockPort !== undefined) v = v.split(`:${mockPort}`).join(":<PORT>");
    v = v.replace(UUID_SHAPE, "<UUID>");
    v = v.replace(/^mock-(drora|zcode)/, "mock");
    return v;
  };
  const walk = (value, key) => {
    if (value === null || typeof value !== "object") return leaf(value, key);
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = walk(value[k], k);
    return out;
  };
  return { walk };
}

function normalizeLine(line, norm) {
  const trimmed = line.replace(/\r$/, "");
  if (!trimmed) return "";
  // identity tokens: product name/version are drora-vs-zcode branding, not
  // behavior — collapsed so STRUCTURE alignment is what gets judged
  let t = trimmed;
  t = t.replace(/\b(drora|zcode)\b/g, "<BRAND>").replace(/\b\d+\.\d+\.\d+\b/g, "<VER>");
  try {
    const json = JSON.parse(t);
    return `J:${JSON.stringify(norm.walk(json, undefined))}`;
  } catch {
    t = t.split(norm.wsToken).join("<WS>").split(norm.homeToken).join("<HOME>");
    t = t.replace(UUID_SHAPE, "<UUID>");
    t = t.replace(/\d+(ms|s\b)/g, "N$1").replace(/\d{4,}/g, "N");
    return `T:${t}`;
  }
}

function lcsMatrix(a, b) {
  const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      m[i][j] = a[i] === b[j] ? m[i + 1][j + 1] + 1 : Math.max(m[i + 1][j], m[i][j + 1]);
    }
  }
  return m;
}

function diffLines(a, b) {
  const m = lcsMatrix(a, b);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ t: "eq", i, j }); i += 1; j += 1; }
    else if (m[i + 1][j] >= m[i][j + 1]) { ops.push({ t: "del", i }); i += 1; }
    else { ops.push({ t: "add", j }); j += 1; }
  }
  while (i < a.length) { ops.push({ t: "del", i }); i += 1; }
  while (j < b.length) { ops.push({ t: "add", j }); j += 1; }
  return ops;
}

// ---- runner -----------------------------------------------------------------

function runOnce(bin, args, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, env, windowsHide: true });
    children.add(child);
    const stdout = [];
    const stderr = [];
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      buffer += c;
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) { stdout.push(buffer.slice(0, idx)); buffer = buffer.slice(idx + 1); }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => stderr.push(c));
    const timer = setTimeout(() => { try { child.kill(); } catch { /* best effort */ } }, RUN_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffer) stdout.push(buffer);
      resolve({ code: code ?? 1, stdout, stderr: stderr.join("") });
    });
  });
}

async function main() {
  if (!existsSync(DRORA_CJS)) fail(`drora.cjs missing: ${DRORA_CJS}`);
  if (!existsSync(ZCODE_CJS)) fail(`zcode.cjs missing: ${ZCODE_CJS}`);
  const { plans, scenarios } = loadScenarios();
  if (scenarios.length === 0) fail("no scenarios matched");

  mkdirSync(OUT, { recursive: true });
  const plansFile = path.join(OUT, "plans.json");
  writeFileSync(plansFile, JSON.stringify(plans, null, 2));
  const portDrora = await freePort();
  const portZcode = await freePort();
  for (const [port, side] of [[portDrora, "drora"], [portZcode, "zcode"]]) {
    spawn(process.execPath, [path.join(REG_DIR, "mock-model.mjs"), "--port", String(port), "--out", path.join(OUT, `mock-${side}`), "--plans", plansFile]);
  }
  await new Promise((r) => setTimeout(r, 400));
  const resetMocks = async () => {
    for (const port of [portDrora, portZcode]) await fetch(`http://127.0.0.1:${port}/reset`, { method: "POST" }).catch(() => {});
  };

  const results = [];
  for (const sc of scenarios) {
    console.log(`▶ ${sc.id} ${sc.title ?? ""}`);
    await resetMocks();
    // 同 harness.mjs wave2ab 注记：ws 走短路径——避开 zcode project slug
    // 截断上限的跨场景相撞，且不置于真实 home 下（<HOME> 归一化通道）。
    // d7/d8/d34/d35 污染治理：ws 必须在仓库外——仓根的 .drora/commands/bench.md
    // fixture 会经祖先链上扫进 drora 的 project 域命令发现（zcode 侧无对应）。
    // 仓根同盘短路径（D:\drora-cli-ab-w\<id>）同时满足三条。
    const scWs = path.join(path.parse(REPO_ROOT).root, "drora-cli-ab-w", `${Date.now().toString(36).slice(-7)}-${sc.id}`);
    mkdirSync(scWs, { recursive: true });
    const homeDrora = path.join(OUT, "home-drora", sc.id);
    const homeZcode = path.join(OUT, "home-zcode", sc.id);
    mkdirSync(homeDrora, { recursive: true });
    mkdirSync(homeZcode, { recursive: true });

    // seed files (workspace + homes)
    for (const f of sc.files ?? []) {
      const full = path.join(scWs, f.path);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, f.content ?? "");
    }
    for (const f of sc.homeFiles ?? []) {
      for (const [side, home] of [["drora", homeDrora], ["zcode", homeZcode]]) {
        const full = path.join(home, f.path.replaceAll("<BRAND>", side === "drora" ? ".drora" : ".zcode"));
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, typeof f.content === "string" ? f.content : JSON.stringify(f.content));
      }
    }

    // commands array = sequential runs per side (e.g. prompt run → --continue
    // run); outputs concatenate, exit codes recorded per run
    const commandSets = sc.commands ?? [sc.args ?? []];
    const runSets = commandSets.map((cmdArgs) => {
      const a = cmdArgs.map((x) => x.replaceAll("$WS", scWs).replaceAll("$REPO", REPO_ROOT));
      return a;
    });
    const run = async (side, port) => {
      const home = side === "drora" ? homeDrora : homeZcode;
      // 同 harness.mjs 环境注记：剥离母 shell 残留的 ZCODE_*/DRORA_* 再注入别名。
      const envStrip = { ...process.env };
      for (const k of Object.keys(envStrip)) {
        if (/^(ZCODE|DRORA)_/.test(k)) delete envStrip[k];
      }
      const env = {
        ...envStrip,
        USERPROFILE: home,
        HOME: home,
        ...(side === "drora"
          ? { DRORA_BASE_URL: `http://127.0.0.1:${port}/v1`, DRORA_API_KEY: "mock-key", DRORA_MODEL: "mock-drora", DRORA_PROVIDER_ID: "anthropic" }
          : { ZCODE_BASE_URL: `http://127.0.0.1:${port}/v1`, ZCODE_API_KEY: "mock-key", ZCODE_MODEL: "mock-zcode" }),
      };
      // phase4 additive: per-scenario env injection（双侧同值；`<BRAND>` 按侧替换为
      // DRORA/ZCODE 大写品牌词）。合并在侧环境之后，故场景 env 覆盖 harness 注入的
      // 同名 *_BASE_URL/*_MODEL 等变量。
      for (const [k, v] of Object.entries(sc.env ?? {})) {
        const brand = side === "drora" ? "DRORA" : "ZCODE";
        env[k.replaceAll("<BRAND>", brand)] = String(v).replaceAll("<BRAND>", brand);
      }
      const bin = side === "drora" ? DRORA_CJS : ZCODE_CJS;
      const outs = [];
      const codes = [];
      for (const a of runSets) {
        const r = await runOnce(bin, a, scWs, env);
        outs.push(r);
        codes.push(r.code);
      }
      return { stdout: outs.flatMap((o) => o.stdout), stderr: outs.map((o) => o.stderr).join(""), codes };
    };
    const [rd, rz] = await Promise.all([run("drora", portDrora), run("zcode", portZcode)]);
    const exitSame = JSON.stringify(rd.codes) === JSON.stringify(rz.codes);

    const norm = {
      drora: makeLineNormalizer(homeDrora, scWs, portDrora),
      zcode: makeLineNormalizer(homeZcode, scWs, portZcode),
    };
    norm.drora.wsToken = scWs.replaceAll("\\", "/");
    norm.drora.homeToken = homeDrora.replaceAll("\\", "/");
    norm.zcode.wsToken = scWs.replaceAll("\\", "/");
    norm.zcode.homeToken = homeZcode.replaceAll("\\", "/");
    if (sc.id === 'c05') {
      // c05 逐行证据落盘改随 OUT 目录（10-09）：原硬编码 cwd 相对路径
      // `scripts/regression/reports/...` 在非仓库根 cwd 调用时拼出双前缀 ENOENT。
      writeFileSync(path.join(OUT, 'c05-lines-drora.txt'), rd.stdout.join('\n'));
      writeFileSync(path.join(OUT, 'c05-lines-zcode.txt'), rz.stdout.join('\n'));
    }
    const a = rd.stdout.map((l) => normalizeLine(l, norm.drora)).filter(Boolean);
    const b = rz.stdout.map((l) => normalizeLine(l, norm.zcode)).filter(Boolean);
    const ops = diffLines(a, b);
    const diffCount = ops.filter((o) => o.t !== "eq").length;
    const status = diffCount === 0 && exitSame ? "ALIGNED" : "DIFF";
    const detail = {
      id: sc.id, title: sc.title ?? "", args: runSets, status,
      droraExit: rd.codes, zcodeExit: rz.codes,
      droraLines: a.length, zcodeLines: b.length, diffCount, exitSame,
      stderrDrora: rd.stderr.slice(0, 2000), stderrZcode: rz.stderr.slice(0, 2000),
      firstDiffs: ops.filter((o) => o.t !== "eq").slice(0, 12).map((o) => ({
        t: o.t,
        drora: o.t === "add" ? undefined : (a[o.i] ?? "").slice(0, 300),
        zcode: o.t === "del" ? undefined : (b[o.j] ?? "").slice(0, 300),
      })),
    };
    results.push(detail);
    appendFileSync(path.join(OUT, "cli-frames.jsonl"), `${JSON.stringify({ scenario: sc.id, droraRaw: rd.stdout, zcodeRaw: rz.stdout })}\n`);
    console.log(`  → ${status} (diffs ${diffCount}, exit ${rd.codes}/${rz.codes})`);
  }

  const byStatus = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  writeFileSync(path.join(OUT, "cli-report.json"), JSON.stringify({ runId: RUN_ID, summary: { total: results.length, byStatus }, scenarios: results }, null, 2));
  const md = [
    `# CLI headless 面 A/B 报告 ${RUN_ID}`,
    "",
    `- 汇总: ${results.length} 场景 · ${JSON.stringify(byStatus)}`,
    "",
    "| 场景 | 状态 | 行差 | exit |",
    "| --- | --- | --- | --- |",
    ...results.map((r) => `| ${r.id} ${r.title} | ${r.status} | ${r.diffCount} | ${r.droraExit}/${r.zcodeExit} |`),
    "",
  ];
  writeFileSync(path.join(OUT, "cli-report.md"), md.join("\n"));
  console.log(`\n报告: ${path.join(OUT, "cli-report.md")}`);
  process.exit(byStatus.ALIGNED === results.length ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
