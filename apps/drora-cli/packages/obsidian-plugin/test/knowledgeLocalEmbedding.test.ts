// 迁自 packages/services/test/knowledgeLocalEmbedding.test.ts @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：测试随实现迁入插件包，
// node:test/vitest 直连插件 server 模块（迁后路径）。除本头注释与导入重指
// （../src/knowledge|obsidian-vault|paths → ../src/server/... 同深度镜像）外与 HEAD
// 逐字节等价；原 services/test 文件随迁删除（本体实现在 P7 拆除，测试归属插件侧）。
// 2026-11-14 增补：失败冷却回归用例（spec obsidian-knowledge.md §5b.9 同日修订，
// localEmbeddingPort.ts 文件头④改点）——超出迁入等价范围的部分仅此用例。
/**
 * 本地嵌入端口单测（spec §5b.9）。
 *
 * 断言：bge WordPiece 编码（CJK 逐字/词切分/贪心续片/[UNK]/512 窗口与 [CLS][SEP]）；
 * 模型缺失且下载失败时 embed 显式抛错（调用方既有降级语义接管），端口 id 如实；
 * 下载失败进入失败冷却（2026-11-14 修订）：冷却期内 embed 快速失败零出站，
 * ensureReady 手动路径强制重试，冷却期满恢复自动重试。
 * 运行：node --import tsx --test packages/services/test/knowledgeLocalEmbedding.test.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  LOCAL_EMBEDDING_MODEL_ID,
  createLocalEmbeddingPort,
  encodeForBge,
} from "../src/server/knowledge/search/localEmbeddingPort.js";

function miniVocab(): Map<string, number> {
  // 布局严格仿 BERT：0-99 预留位、100=[UNK]、101=[CLS]、102=[SEP]（与编码器常量对齐），
  // 其后内容 token。CJK 按「逐字」查找（BERT 基本切分），多字 CJK 词条在编码侧不可达——
  // WordPiece 的 ## 续片只对非 CJK 词生效。
  const vocab = new Map<string, number>();
  for (let index = 0; index < 100; index++) vocab.set(`[unused${index}]`, index);
  vocab.set("[UNK]", 100);
  vocab.set("[CLS]", 101);
  vocab.set("[SEP]", 102);
  const tokens = ["苹", "果", "手", "机", "agent", "ai", "ag", "##ent", "##x"];
  tokens.forEach((token, index) => {
    if (!vocab.has(token)) vocab.set(token, 103 + index);
  });
  return vocab;
}
test("encodeForBge：CJK 逐字查找 + [CLS]/[SEP] 包裹", () => {
  const ids = encodeForBge("苹果", miniVocab());
  assert.deepEqual(ids, [101, 103, 104, 102]); // [CLS] 苹 果 [SEP]
});

test("encodeForBge：WordPiece 贪心最长匹配（整词 → ## 续片）与 [UNK] 兜底", () => {
  // 整词命中：agent → 107。
  assert.deepEqual(encodeForBge("agent", miniVocab()), [101, 107, 102]);
  // 贪心：agentx → agent(107) + ##x(111)；任一位置失败 → 整词 [UNK]（量子）。
  assert.deepEqual(encodeForBge("agentx", miniVocab()), [101, 107, 111, 102]);
  assert.deepEqual(encodeForBge("量子", miniVocab()), [101, 100, 100, 102]);
});

test("encodeForBge：英文小写化 + 窗口截断（512 含 [CLS]/[SEP]）", () => {
  const ids = encodeForBge("Agent AI", miniVocab());
  assert.deepEqual(ids, [101, 107, 108, 102]);
  // 长文本：1200 个 CJK 字 → 截到 510 内容位 + 首尾特殊 token。
  const long = encodeForBge("苹果".repeat(600), miniVocab());
  assert.equal(long.length, 512);
  assert.equal(long[0], 101);
  assert.equal(long[long.length - 1], 102);
});

test("端口：模型缺失且下载失败 → embed 显式抛错（调用方降级接管），id 如实", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-local-embed-"));
  try {
    const port = createLocalEmbeddingPort({
      modelRoot: root,
      fetchImpl: (async () => {
        throw new Error("network unreachable");
      }) as typeof fetch,
    });
    assert.equal(port.id, LOCAL_EMBEDDING_MODEL_ID);
    await assert.rejects(() => port.embed(["测试"]), /模型文件下载失败/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("端口：下载失败进入失败冷却——冷却期内 embed 快速失败零出站；ensureReady 强制重试；期满恢复自动重试", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-local-embed-"));
  let fetchCalls = 0;
  try {
    const port = createLocalEmbeddingPort({
      modelRoot: root,
      // 收紧冷却（缺省 10 分钟）以便在用例内覆盖「期满恢复」分支。
      failureCooldownMs: 100,
      fetchImpl: (async () => {
        fetchCalls += 1;
        throw new Error("network unreachable");
      }) as typeof fetch,
    });
    // 首次 embed：真实出站一轮（model_quantized.onnx 逐镜像尝试）后失败。
    await assert.rejects(() => port.embed(["一"]), /模型文件下载失败/u);
    assert.equal(port.status().state, "failed");
    const callsAfterFirst = fetchCalls;
    assert.ok(callsAfterFirst >= 2, `首轮应逐镜像出站（实际 ${callsAfterFirst} 次）`);
    // 冷却期内：后续 embed 快速失败，fetch 调用数不再增长（零出站）。
    for (let round = 0; round < 3; round += 1) {
      await assert.rejects(() => port.embed(["二"]), /模型文件下载失败/u);
    }
    assert.equal(fetchCalls, callsAfterFirst, "冷却期内 embed 不得重复出站下载");
    // 手动下载（ensureReady）是显式用户意图：冷却期内仍立即真实重试。
    assert.ok(port.ensureReady, "端口应提供手动就绪入口");
    await assert.rejects(() => port.ensureReady!(), /模型文件下载失败/u);
    assert.ok(fetchCalls > callsAfterFirst, "手动路径应绕过冷却真实出站");
    const callsAfterManual = fetchCalls;
    // 冷却期满：背景路径恢复自动重试（环境可能恢复语义由冷却到期承接）。
    await new Promise((resolve) => setTimeout(resolve, 250));
    await assert.rejects(() => port.embed(["三"]), /模型文件下载失败/u);
    assert.ok(fetchCalls > callsAfterManual, "冷却期满后 embed 应恢复出站重试");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
