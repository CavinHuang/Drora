/**
 * 语义检索准确性棘轮（spec §5b.9 准确性保障 / A28 种子）。
 *
 * 手工核对标注集（fixtures/semanticAccuracyDataset.ts）× 真实本地嵌入端口全链
 * （索引写向量 → 混合召回 → 词法候选），阈值门禁：Recall@30 ≥ 0.9 / Hit@1 ≥ 0.6 /
 * MRR ≥ 0.7（初值，真机首跑校准后只许上调）。模型未下载时显式 skip（NOT_RUN 诚实
 * 语义），绝不静默编造数字。
 *
 * 运行：node --import tsx --test packages/services/test/knowledgeSemanticAccuracy.test.ts
 * （需已下载本地模型；或把模型目录放入数据根 knowledge/models/bge-small-zh-v1.5/）
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { homedir } from "node:os";
import { setDataBaseDir } from "../src/paths.js";
import { configureVaultAt } from "../src/obsidian-vault/config.js";
import { createKnowledgeServices } from "../src/knowledge/knowledgeServices.js";
import { createLocalEmbeddingPort } from "../src/knowledge/search/localEmbeddingPort.js";
import {
  SEMANTIC_ACCURACY_CASES,
  SEMANTIC_ACCURACY_NOTES,
} from "./fixtures/semanticAccuracyDataset.js";

/** 棘轮阈值（spec §5b.9 初值；真机首跑校准后只许上调）。 */
const RATCHET = {
  recallAt30: 0.9,
  hitAt1: 0.6,
  mrr: 0.7,
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("等待超时（含首次向量回填）");
    await sleep(50);
  }
}

test("准确性棘轮：真实本地嵌入 × 标注集阈值门禁", async (t) => {
  // 模型在位检测：直接看真实数据根（默认 ~/.drora，不随测试 setDataBaseDir 漂移），
  // 与生产装配同源；DRORA_DATA_DIR 覆盖时同步跟随。
  const dataRoot = process.env.DRORA_DATA_DIR ?? join(homedir(), ".drora");
  const realModelDir = join(dataRoot, "knowledge", "models", "bge-small-zh-v1.5");
  const modelPresent = existsSync(join(realModelDir, "model_quantized.onnx"));
  if (!modelPresent) {
    t.skip("本地模型未下载（设置页「下载模型」或首次索引自动下载后重跑本测试）");
    return;
  }

  const root = await mkdtemp(join(tmpdir(), "drora-knowledge-accuracy-"));
  const port = createLocalEmbeddingPort({ modelRoot: realModelDir });
  const services = createKnowledgeServices({
    databasePath: join(root, "knowledge", "knowledge-index.sqlite"),
    pluginDataDir: join(root, "plugin-data"),
    embeddingPort: port,
    leaseTtlMs: 8000,
    heartbeatIntervalMs: 500,
  });
  try {
    // 真实数据根的既有模型 + 临时 vault：数据根需指向临时目录，但模型用真实路径。
    setDataBaseDir(root);
    const pluginDataDir = join(root, "plugin-data");
    const vault = join(root, "vault");
    await mkdir(vault, { recursive: true });
    for (const note of SEMANTIC_ACCURACY_NOTES) {
      const absolute = join(vault, note.relativePath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, note.content, "utf-8");
    }
    await configureVaultAt(pluginDataDir, vault);
    await services.indexService.startReconcile();
    await waitFor(async () => {
      const status = await services.indexService.getStatus();
      return status.job?.status === "completed" || status.job?.status === "failed";
    });
    // 等向量回填完成（全库 6 笔记 6+ chunk，窗口化推理秒级）。
    await waitFor(async () => {
      const status = await services.indexService.getStatus();
      return status.job === null || status.job.status !== "running";
    });

    let recallSum = 0;
    let hit1Sum = 0;
    let rrSum = 0;
    let answered = 0;
    let falsePositives = 0;
    for (const testCase of SEMANTIC_ACCURACY_CASES) {
      const run = await services.queryService.createRun({
        query: testCase.query,
        clientRequestId: `accuracy-${testCase.id}`,
      });
      const finished = await services.queryService.search({ runId: run.runId });
      if (!testCase.hasAnswer) {
        if (finished.candidates.length > 0) falsePositives += 1;
        continue;
      }
      answered += 1;
      const ranked = finished.candidates.map((candidate) => candidate.relativePath);
      const relevant = new Set(testCase.relevantPaths);
      const firstRank = ranked.findIndex((path) => relevant.has(path));
      if (firstRank !== -1) rrSum += 1 / (firstRank + 1);
      if (firstRank === 0) hit1Sum += 1;
      if (firstRank !== -1) recallSum += 1;
    }

    const recallAt30 = answered > 0 ? recallSum / answered : 0;
    const hitAt1 = answered > 0 ? hit1Sum / answered : 0;
    const mrr = answered > 0 ? rrSum / answered : 0;
    const falsePositiveRate = SEMANTIC_ACCURACY_CASES.filter((c) => !c.hasAnswer).length > 0
      ? falsePositives / SEMANTIC_ACCURACY_CASES.filter((c) => !c.hasAnswer).length
      : 0;
    console.log(
      `[accuracy] recall@30=${recallAt30.toFixed(3)} hit@1=${hitAt1.toFixed(3)} mrr=${mrr.toFixed(3)} noAnswerFP=${falsePositiveRate.toFixed(3)} (answered=${answered})`,
    );

    assert.ok(recallAt30 >= RATCHET.recallAt30, `Recall@30 ${recallAt30.toFixed(3)} < ${RATCHET.recallAt30}`);
    assert.ok(hitAt1 >= RATCHET.hitAt1, `Hit@1 ${hitAt1.toFixed(3)} < ${RATCHET.hitAt1}`);
    assert.ok(mrr >= RATCHET.mrr, `MRR ${mrr.toFixed(3)} < ${RATCHET.mrr}`);
  } finally {
    services.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
