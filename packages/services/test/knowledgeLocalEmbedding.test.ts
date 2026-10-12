/**
 * 本地嵌入端口单测（spec §5b.9）。
 *
 * 断言：bge WordPiece 编码（CJK 逐字/词切分/贪心续片/[UNK]/512 窗口与 [CLS][SEP]）；
 * 模型缺失且下载失败时 embed 显式抛错（调用方既有降级语义接管），端口 id 如实。
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
} from "../src/knowledge/search/localEmbeddingPort.js";

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
