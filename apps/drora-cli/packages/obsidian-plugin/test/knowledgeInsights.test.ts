// 迁自 packages/services/test/knowledgeInsights.test.ts @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：测试随实现迁入插件包，
// node:test/vitest 直连插件 server 模块（迁后路径）。除本头注释与导入重指
// （../src/knowledge|obsidian-vault|paths → ../src/server/... 同深度镜像）外与 HEAD
// 逐字节等价。原 services/test 文件随迁删除（本体实现在 P7 拆除，测试归属插件侧）。
/**
 * 洞察视图聚合测试（spec §5g / 验收 K-INS-1、K-INS-2）。
 *
 * 纯函数：结构口径（frontmatter tags 边界、双链去重累计）、job 时长、telemetry 投影。
 * 服务级：mkdtemp 合成临时 Vault 全链（写入→索引→getInsights），绝不触碰用户真实 Vault。
 * 运行：node --import tsx --test packages/services/test/knowledgeInsights.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setDataBaseDir } from "../src/server/platform/dataPaths.js";
import { configureVaultAt } from "../src/server/vault/config.js";
import {
  createKnowledgeServices,
  type KnowledgeServices,
} from "../src/server/knowledge/knowledgeServices.js";
import {
  aggregateDocumentStructure,
  toDecisionInsights,
  toInsightJobEntries,
} from "../src/server/knowledge/index/insightsAggregator.js";
import {
  computeHealthReport,
  resolveWikilinkTarget,
  type HealthDocumentMeta,
  type HealthDocumentSignals,
} from "../src/server/knowledge/index/healthReport.js";
import type { DecisionTelemetrySnapshot } from "../src/server/knowledge/decision/decisionTelemetry.js";
import type { KnowledgeIndexJobView } from "../src/server/knowledge/knowledgeTypes.js";

// ── K-INS-2：聚合纯函数 ─────────────────────────────────────

test("aggregateDocumentStructure：frontmatter tags 命中文档；正文 tags: 行不误判", () => {
  const frontmatter = ["---", "tags: [项目/alpha, 阅读]", "title: 笔记", "---"].join("\n");
  const withTags = aggregateDocumentStructure([
    { ordinal: 0, body: frontmatter },
    { ordinal: 1, body: "# 正文\n\n内容" },
  ]);
  assert.equal(withTags.tagged, true);
  assert.equal(withTags.wikilinkCount, 0);

  // 正文任意 `tags:` 行不是 frontmatter（首行非 ---）→ 不计 tagged。
  const bodyOnly = aggregateDocumentStructure([{ ordinal: 0, body: "# 正文\n\ntags: [伪标签]" }]);
  assert.equal(bodyOnly.tagged, false);

  // 未闭合的 --- 不是 frontmatter（与 chunker 边界判定同口径）。
  const unclosed = aggregateDocumentStructure([{ ordinal: 0, body: "---\n残缺\n# 标题" }]);
  assert.equal(unclosed.tagged, false);
});

test("aggregateDocumentStructure：双链 chunk 内去重、跨 chunk/文档累计；frontmatter 块内双链也计入（与索引信号一致）", () => {
  const aggregate = aggregateDocumentStructure([
    { ordinal: 0, body: "---\ntags: a\n---\n关联 [[目标A]]" },
    { ordinal: 1, body: "重复 [[目标A]] 与别名 [[目标B|别名]] 与 [[目标A]]" },
    { ordinal: 2, body: "# 下节\n\n新目标 [[目标C]]" },
  ]);
  // chunk1: 目标A；chunk2: 目标A/目标B（第三个 [[目标A]] 去重）；chunk3: 目标C → 共 4。
  assert.equal(aggregate.wikilinkCount, 4);
  assert.equal(aggregate.tagged, true);
});

test("toInsightJobEntries：时长=终态差值；进行中/异常差值为 null", () => {
  const jobs: KnowledgeIndexJobView[] = [
    {
      jobId: "job-1",
      kind: "reconcile",
      status: "completed",
      generation: 1,
      fence: 1,
      sourceEpoch: 1,
      startedAtMs: 1_000,
      finishedAtMs: 3_500,
      reason: null,
      indexedFiles: 3,
      indexedChunks: 12,
    },
    {
      jobId: "job-2",
      kind: "rebuild",
      status: "running",
      generation: 2,
      fence: 2,
      sourceEpoch: 1,
      startedAtMs: 5_000,
      finishedAtMs: null,
      reason: null,
      indexedFiles: 1,
      indexedChunks: 2,
    },
  ];
  const [completed, running] = toInsightJobEntries(jobs);
  assert.deepEqual(completed, {
    kind: "reconcile",
    status: "completed",
    startedAtMs: 1_000,
    finishedAtMs: 3_500,
    durationMs: 2_500,
    indexedFiles: 3,
    indexedChunks: 12,
    reason: null,
  });
  assert.equal(running?.durationMs, null);
  assert.equal(running?.finishedAtMs, null);
});

test("toDecisionInsights：投影六项计数，latencySamplesMs 不出 RPC 面", () => {
  const snapshot: DecisionTelemetrySnapshot = {
    outboundCountTotal: 7,
    cacheHitCountTotal: 3,
    fallbackCountTotal: 1,
    scoredCountTotal: 9,
    fallbackByReason: { timeout: 1 },
    inputTokensTotal: 100,
    outputTokensTotal: 40,
    latencySamplesMs: [12, 34],
  };
  assert.deepEqual(toDecisionInsights(snapshot), {
    outboundCountTotal: 7,
    cacheHitCountTotal: 3,
    fallbackCountTotal: 1,
    scoredCountTotal: 9,
    inputTokensTotal: 100,
    outputTokensTotal: 40,
  });
  assert.equal("latencySamplesMs" in toDecisionInsights(snapshot), false);
});

// ── K-INS-1：服务级全链（真实索引 → getInsights）──────────────

interface TestEnv {
  root: string;
  pluginDataDir: string;
  vaultA: string;
  services: KnowledgeServices;
}

async function createEnv(): Promise<TestEnv> {
  const root = await mkdtemp(join(tmpdir(), "drora-knowledge-insights-"));
  setDataBaseDir(root);
  const pluginDataDir = join(root, "plugin-data");
  const vaultA = join(root, "vault-a");
  await mkdir(vaultA, { recursive: true });
  const services = createKnowledgeServices({
    databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
    pluginDataDir,
    leaseTtlMs: 2000,
    heartbeatIntervalMs: 250,
  });
  return { root, pluginDataDir, vaultA, services };
}

async function destroyEnv(env: TestEnv): Promise<void> {
  env.services.dispose();
  await rm(env.root, { recursive: true, force: true });
}

async function writeNote(vaultRoot: string, relativePath: string, content: string): Promise<void> {
  const absolute = join(vaultRoot, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf-8");
}

async function waitForJobTerminal(
  services: KnowledgeServices,
  jobId: string,
  timeoutMs = 15000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await services.indexService.getStatus();
    if (status.job && status.job.jobId === jobId && status.job.status !== "running") {
      return status.job.status;
    }
    if (Date.now() > deadline) throw new Error(`任务未在时限内结束: ${jobId}`);
    await sleep(40);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("getInsights：未配置 vault → configured=false 且库存全零、任务列表为空", async () => {
  const env = await createEnv();
  try {
    const insights = await env.services.indexService.getInsights();
    assert.equal(insights.configured, false);
    assert.equal(insights.source, null);
    assert.deepEqual(insights.inventory, {
      documents: 0,
      chunks: 0,
      taggedDocuments: 0,
      wikilinkCount: 0,
    });
    assert.equal(insights.coverage.partial, false);
    assert.deepEqual(insights.recentJobs, []);
    assert.equal(insights.decision.outboundCountTotal, 0);
    // 体检零值结构（§5h.3：未配置 vault = 如实空态，与 inventory 零值先例同形）。
    assert.deepEqual(insights.health, {
      orphanNotes: [],
      orphanCount: 0,
      brokenLinks: [],
      brokenLinkCount: 0,
      emptyNotes: [],
      emptyNoteCount: 0,
    });
  } finally {
    await destroyEnv(env);
  }
});

test("getInsights：真实计数——tags 文档数、双链总数与写入内容精确一致；recentJobs 含本次任务", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    // 文档 1：frontmatter flow tags + 跨 chunk 双链。
    await writeNote(
      env.vaultA,
      "notes/记忆策略.md",
      [
        "---",
        "tags: [知识管理, 上下文]",
        "---",
        "",
        "# 记忆策略",
        "",
        "参见 [[上下文窗口]] 与 [[检索实践|别名写法]]，重复 [[上下文窗口]] 不重复计数。",
        "",
        "## 细节",
        "",
        "补充 [[评测基准]]。",
      ].join("\n"),
    );
    // 文档 2：block tags + 正文伪 tags 行（不得计入 taggedDocuments）。
    await writeNote(
      env.vaultA,
      "notes/检索实践.md",
      [
        "---",
        "tags:",
        "  - 本地检索",
        "---",
        "",
        "# 检索实践",
        "",
        "tags: [不是frontmatter]",
        "",
        "链接 [[记忆策略]]。",
      ].join("\n"),
    );
    // 文档 3：无 tags、无双链。
    await writeNote(env.vaultA, "readme.md", "# 说明\n\n普通说明文字");

    const job = await env.services.indexService.startReconcile();
    assert.equal(job.alreadyRunning, false);
    const terminal = await waitForJobTerminal(env.services, job.jobId);
    assert.equal(terminal, "completed");

    const insights = await env.services.indexService.getInsights();
    assert.equal(insights.configured, true);
    assert.ok((insights.source?.displayName ?? "").length > 0);
    // 双链口径（逐项核对写入内容）：
    //   文档1 frontmatter chunk 无链接；H1 段 [[上下文窗口]]/[[检索实践]]（重复的
    //   [[上下文窗口]] chunk 内去重）= 2；H2 段 [[评测基准]] = 1 → 3
    //   文档2 frontmatter chunk 无链接；正文段 [[记忆策略]] = 1 → 1
    //   文档3 无 → 合计 4。tagged = 文档1（flow）+ 文档2（block）= 2；正文伪
    //   tags 行不产生文档级标签。
    assert.deepEqual(insights.inventory, {
      documents: 3,
      chunks: 6,
      taggedDocuments: 2,
      wikilinkCount: 4,
    });
    assert.equal(insights.coverage.partial, false);

    // recentJobs：最近一条即本次任务，终态时长非空。
    const latest = insights.recentJobs[0];
    assert.ok(latest);
    assert.equal(latest.kind, "reconcile");
    assert.equal(latest.status, "completed");
    assert.ok(latest.durationMs !== null && latest.durationMs >= 0);
    assert.equal(insights.recentJobs.length, 1);
    // 决策 telemetry：本流程未发起任何决策出站，如实为零。
    assert.equal(insights.decision.outboundCountTotal, 0);
  } finally {
    await destroyEnv(env);
  }
});

// ── K-N4：健康体检（剥离 spec §8 N4，obsidian-knowledge.md §5h.3，B6）────────

function meta(id: number, relativePath: string, title = relativePath): HealthDocumentMeta {
  return { id, relativePath, title };
}

function signals(
  targets: string[],
  hasBodyContent = true,
): HealthDocumentSignals {
  return { wikilinkTargets: new Set(targets), hasBodyContent };
}

test("resolveWikilinkTarget：解析顺序 ① 精确等值（含补 .md）② 路径后缀 ③ basename", () => {
  const docs = [
    meta(1, "notes/目标A.md"),
    meta(2, "guides/deep/notes/目标A.md"),
    meta(3, "其他笔记.md"),
  ].sort((left, right) => (left.relativePath < right.relativePath ? -1 : 1));

  // ① 精确等值（含/不含 .md 两种形态）。
  assert.equal(resolveWikilinkTarget("notes/目标A.md", docs)?.id, 1);
  assert.equal(resolveWikilinkTarget("notes/目标A", docs)?.id, 1);
  // ② 路径后缀：`[[deep/notes/目标A]]` 命中长路径（多候选取最短 relative_path）。
  assert.equal(resolveWikilinkTarget("deep/notes/目标A", docs)?.id, 2);
  // ③ basename：`[[其他笔记]]` 唯一 basename 命中。
  assert.equal(resolveWikilinkTarget("其他笔记", docs)?.id, 3);
  // 剥 `#标题`/`^块` 后缀后解析。
  assert.equal(resolveWikilinkTarget("notes/目标A#小节", docs)?.id, 1);
  assert.equal(resolveWikilinkTarget("notes/目标A#^块id", docs)?.id, 1);
  // 全部失败 → null（断链）。
  assert.equal(resolveWikilinkTarget("不存在", docs), null);
  assert.equal(resolveWikilinkTarget("#纯标题引用", docs), null);
});

test("computeHealthReport：孤儿/断链/空笔记口径精确（自指边不计、count 全量、字典序）", () => {
  // a(孤儿：无入链有出链——出链不豁免孤儿)；b(被 a/c 指向)；c(孤儿：自指 [[c#x]] 不计)；
  // d(空笔记：仅 frontmatter)；e(空笔记：零 chunk → 无信号行)。
  const documents = [
    meta(1, "a.md", "甲"),
    meta(2, "b.md", "乙"),
    meta(3, "c.md", "丙"),
    meta(4, "d.md", "丁"),
    meta(5, "e.md", "戊"),
  ];
  const report = computeHealthReport({
    documents,
    signals: new Map([
      [1, signals(["b.md", "幽灵"])],
      [2, signals([])],
      [3, signals(["c#标题", "b"])], // 自指（解析回自身）不计入链；[[b]] basename 命中 b.md。
      [4, signals([], false)], // d：仅 frontmatter（无正文信号——hasBodyContent=false）。
      // 5 无信号行（零 chunk 文档）。
    ]),
  });

  assert.deepEqual(report.orphanNotes, [
    { relativePath: "a.md", title: "甲" },
    { relativePath: "c.md", title: "丙" },
    { relativePath: "d.md", title: "丁" },
    { relativePath: "e.md", title: "戊" },
  ]);
  assert.equal(report.orphanCount, 4);
  assert.deepEqual(report.emptyNotes, [
    { relativePath: "d.md", title: "丁" },
    { relativePath: "e.md", title: "戊" },
  ]);
  assert.equal(report.emptyNoteCount, 2);
  // 断链：a 的 [[幽灵]] 解析失败；c 的 [[c#标题]] 剥后缀解析回自身 → 不是断链。
  assert.deepEqual(report.brokenLinks, [{ sourcePath: "a.md", target: "幽灵" }]);
  assert.equal(report.brokenLinkCount, 1);
});

test("computeHealthReport：条目数组截断至 200、count 恒为全量（§5h.3 上限纪律）", () => {
  const documents: HealthDocumentMeta[] = [];
  const signalMap = new Map<number, HealthDocumentSignals>();
  for (let index = 1; index <= 260; index++) {
    documents.push(meta(index, `孤立${String(index).padStart(3, "0")}.md`));
    signalMap.set(index, signals([]));
  }
  const report = computeHealthReport({ documents, signals: signalMap });
  assert.equal(report.orphanCount, 260);
  assert.equal(report.orphanNotes.length, 200);
  assert.equal(report.orphanNotes[0]?.relativePath, "孤立001.md");
});

test("getInsights：健康体检——真实索引上的孤儿/断链/空笔记与库存口径同源（K-N4-1）", async () => {
  const env = await createEnv();
  try {
    await configureVaultAt(env.pluginDataDir, env.vaultA);
    // hub：出链一条解析到 leaf、一条断链；leaf：basename 形态回链 hub。
    await writeNote(env.vaultA, "hub.md", "# Hub\n\n参见 [[leaf.md]] 与 [[幽灵目标]]。");
    await writeNote(env.vaultA, "leaf.md", "# Leaf\n\n回链 [[hub]]。");
    // 孤儿：无出链无入链。
    await writeNote(env.vaultA, "orphan.md", "# 孤儿\n\n没有任何链接。");
    // 空笔记：仅 frontmatter chunk（ordinal=0），无非空白正文。
    await writeNote(env.vaultA, "empty.md", "---\ntags: [体检]\n---\n");

    const job = await env.services.indexService.startReconcile();
    assert.equal(await waitForJobTerminal(env.services, job.jobId), "completed");

    const insights = await env.services.indexService.getInsights();
    assert.equal(insights.configured, true);
    const health = insights.health;
    assert.ok(health, "已配置 vault 的快照必须携带 health（additive）");
    // 孤儿 = 无入链（hub/leaf 互链互救；empty.md 与 orphan.md 无人指向；自指出链不豁免）。
    assert.equal(health.orphanCount, 2);
    assert.deepEqual(health.orphanNotes, [
      { relativePath: "empty.md", title: "empty" },
      { relativePath: "orphan.md", title: "孤儿" },
    ]);
    // 断链 = 解析失败的 wikilink（(source, target) 精确核对）。
    assert.deepEqual(health.brokenLinks, [{ sourcePath: "hub.md", target: "幽灵目标" }]);
    assert.equal(health.brokenLinkCount, 1);
    // 空笔记 = 除 frontmatter 外无非空白正文。
    assert.deepEqual(health.emptyNotes, [{ relativePath: "empty.md", title: "empty" }]);
    assert.equal(health.emptyNoteCount, 1);
  } finally {
    await destroyEnv(env);
  }
});
