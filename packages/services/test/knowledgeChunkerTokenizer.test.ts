import assert from "node:assert/strict";
import test from "node:test";
import { chunkMarkdown, MAX_CHUNK_CHARS, resolveDocumentTitle } from "../src/knowledge/index/markdownChunker.js";
import { buildMatchExpression, extractQueryTerms, tokenizeForIndex } from "../src/knowledge/search/tokenizer.js";
import { matchAwareExcerpt } from "../src/knowledge/search/lexicalRetriever.js";
import { cosineSimilarity } from "../src/knowledge/search/embeddingPort.js";

test("chunker：标题路径、行号与字符偏移可对回原文", () => {
  const content = ["# 根标题", "引言段落。", "## 小节 A", "A 的正文。", "### 深层 B", "B 的正文。", "## 小节 C", "C 的正文。"].join("\n");
  const result = chunkMarkdown(content, "fallback");
  assert.equal(result.title, "根标题");
  const byPath = new Map(result.chunks.map((chunk) => [chunk.headingPath, chunk]));
  const root = byPath.get("根标题");
  assert.ok(root);
  assert.equal(root.startLine, 1);
  assert.equal(root.level, 1);
  assert.ok(content.slice(root.startOffset, root.endOffset).startsWith("# 根标题"));
  const deep = byPath.get("根标题 > 小节 A > 深层 B");
  assert.ok(deep);
  assert.equal(deep.level, 3);
  assert.ok(deep.text.includes("B 的正文。"));
  // 同级替换：小节 C 的路径不含"深层 B"。
  assert.ok(byPath.has("根标题 > 小节 C"));
});

test("chunker：frontmatter 单独成 chunk 且偏移越界安全", () => {
  const content = ["---", "title: 笔记", "tags: [a]", "---", "正文第一段", "## 节", "节内容"].join("\n");
  const result = chunkMarkdown(content, "fallback");
  const frontmatter = result.chunks.find((chunk) => chunk.headingPath === null);
  assert.ok(frontmatter);
  assert.equal(frontmatter.startLine, 1);
  assert.equal(frontmatter.endLine, 4);
  assert.ok(frontmatter.text.includes("title: 笔记"));
  for (const chunk of result.chunks) {
    assert.ok(chunk.startOffset <= content.length);
    assert.ok(chunk.endOffset <= content.length);
    assert.equal(chunk.sha256.length, 64);
  }
});

test("chunker：超出单文件 chunk 上限时截断并标记", () => {
  const lines: string[] = ["# 顶"];
  for (let index = 0; index < 600; index++) {
    lines.push(`## 节 ${index}`, `内容 ${index}`);
  }
  const result = chunkMarkdown(lines.join("\n"), "fallback");
  assert.ok(result.truncated);
  assert.ok(result.chunks.length <= 512);
});

test("chunker：文档标题回退文件名", () => {
  assert.equal(resolveDocumentTitle("没有标题的正文", "我的笔记"), "我的笔记");
});

test("chunker：超上限标题段按空行（段落）边界二次切分，headingPath 继承且 quote 可回原文", () => {
  const paragraph = "这是一段用于撑爆单块上限的正文内容。".repeat(20); // ≈360 字符
  const content = [
    "# 长文",
    "",
    paragraph,
    "",
    paragraph,
    "",
    paragraph,
    "",
    paragraph,
    "",
  ].join("\n");
  const result = chunkMarkdown(content, "长文");
  const section = result.chunks.filter((chunk) => chunk.headingPath === "长文");
  assert.ok(section.length >= 2, "应切成多个子块");
  for (const chunk of section) {
    assert.ok(chunk.text.length <= MAX_CHUNK_CHARS, "每个子块不超上限");
    assert.ok(chunk.level === 1);
    // quote selector 逐字回原文（W03 Receipt 复验语义不变）；行尾 +1 的偏移约定
    // 使 slice 可能多含结尾换行——逐字前缀成立且残差全为空白即可。
    const sliced = content.slice(chunk.startOffset, chunk.endOffset);
    assert.ok(sliced.startsWith(chunk.text), "切片应以 chunk 文本为逐字前缀");
    assert.equal(sliced.slice(chunk.text.length).trim(), "");
    assert.ok(content.split(/\r?\n/)[chunk.startLine - 1] !== undefined);
  }
  // 行区间连续覆盖：子块首尾相接无缝隙。
  for (let index = 1; index < section.length; index++) {
    const previous = section[index - 1];
    const current = section[index];
    assert.ok(previous && current);
    assert.equal(current.startLine, (previous.endLine ?? 0) + 1, "子块行区间应相接");
  }
});

test("chunker：无空行超长块按行硬切；单行超上限整行成块", () => {
  // 无空行的多行列表（每行短）：行级硬切后每块 ≤ 上限。
  const listLines = Array.from({ length: 40 }, (_, index) => `- 列表项 ${index}：${"细节内容。".repeat(8)}`);
  const listDoc = ["# 清单", ...listLines].join("\n");
  const listResult = chunkMarkdown(listDoc, "清单");
  const listChunks = listResult.chunks.filter((chunk) => chunk.headingPath === "清单");
  assert.ok(listChunks.length >= 2);
  for (const chunk of listChunks) {
    assert.ok(chunk.text.length <= MAX_CHUNK_CHARS);
  }

  // 单行超上限：整行独立成块（行不可再分），不抛错、不丢内容。
  const longLine = "无断行超长单行。".repeat(300); // ≈2400 字符单行
  const singleDoc = ["# 单行", longLine, "", "尾段"].join("\n");
  const singleResult = chunkMarkdown(singleDoc, "单行");
  const bigChunk = singleResult.chunks.find((chunk) => chunk.text.includes(longLine));
  assert.ok(bigChunk, "超长单行应完整保留在某个 chunk 中");
});

test("tokenizer：索引侧中文 bigram + 英文小写词（CJK 串先产出，串内相邻保序）", () => {
  assert.equal(tokenizeForIndex("上下文窗口"), "上下 下文 文窗 窗口");
  assert.equal(tokenizeForIndex("Context Window"), "context window");
  // CJK run 先于词 run 产出；短语相邻性只在 CJK 串内部要求。
  assert.equal(tokenizeForIndex("中文 mixed 词"), "中文 词 mixed");
});

test("tokenizer：查询单字走 prefix，词组走 bigram phrase，英文 ≥3 字符前缀", () => {
  const single = buildMatchExpression("窗", false);
  assert.equal(single.expression, '"窗" *');
  const phrase = buildMatchExpression("上下文", false);
  assert.equal(phrase.expression, '"上下 下文"');
  // 英文 ≥3 字符 → 前缀（含本词）；<3 字符保持精确词（防 "js"/"ai" 过召回）。
  const mixed = buildMatchExpression("窗口 window", false);
  assert.equal(mixed.expression, '"窗口" "window" *');
  const shortWord = buildMatchExpression("js 上下", false);
  assert.equal(shortWord.expression, '"上下" "js"');
  // 前缀在两轮同形（strict 已生效，单英文词不再具备降级前提）。
  const strictWord = buildMatchExpression("memory", false);
  assert.equal(strictWord.expression, '"memory" *');
  assert.equal(strictWord.canRelax, false);
});

test("tokenizer：canRelax 判定扩搜资格（§5b.5）", () => {
  // ≥3 字 CJK run 可拆 bigram 备选 → 可降级。
  assert.equal(buildMatchExpression("知识图谱入门", false).canRelax, true);
  // 2 字 run 的 phrase 与 bigram 相同，无可放松。
  assert.equal(buildMatchExpression("上下", false).canRelax, false);
  // 多部件：AND→OR 改变语义 → 可降级。
  assert.equal(buildMatchExpression("窗口 window", false).canRelax, true);
  assert.equal(buildMatchExpression("上下 文", false).canRelax, true);
  // 单个短英文词：前缀已生效、单部件 → 降级轮不可能改变结果。
  assert.equal(buildMatchExpression("gpt", false).canRelax, false);
});

test("tokenizer：降级轮形态——CJK run 为 phrase OR 全部 bigram（修复死降级）", () => {
  const relaxed = buildMatchExpression("知识图谱入门", true);
  assert.equal(
    relaxed.expression,
    '("知识 识图 图谱 谱入 入门") OR ("知识" OR "识图" OR "图谱" OR "谱入" OR "入门")',
  );
  assert.equal(relaxed.relaxed, true);
  // 多部件查询降级：部件间 OR；2 字 run 退化为 phrase 本身（无可拆 bigram）。
  const multi = buildMatchExpression("窗口 memory", true);
  assert.equal(multi.expression, '"窗口" OR "memory" *');
});

test("tokenizer：MATCH 表达式严格转义（注入输入无法改变语法形状）", () => {
  // 表达式只允许三种成分：带引号字面量（可带 prefix 星号）与 OR 连接词。
  const shape = /^("(?:[^"]|"")*"( \*)?|OR)( ("(?:[^"]|"")*"( \*)?|OR))*$/;
  for (const hostile of [
    '窗" NEAR (当前) OR * **',
    "上下文) OR 1=1 --",
    '标题" UNION SELECT rowid FROM chunks_fts',
    "中文 OR OR NOT",
  ]) {
    const expression = buildMatchExpression(hostile, false).expression;
    assert.ok(shape.test(expression), `表达式形状异常: ${expression}`);
  }
  // 引号不属于任何词元（词元只含 CJK/字母数字），注入输入中的引号被直接丢弃。
  const withQuote = buildMatchExpression('a"b', false).expression;
  assert.equal(withQuote, '"a" "b"');
});

test("tokenizer：无词元查询显式报错，绝不回退原始输入", () => {
  assert.throws(() => buildMatchExpression("*** ||", false), /没有可检索词元/);
});

test("tokenizer：降级轮表达式同样严格转义（括号分组不引入自由语法）", () => {
  // 剥掉全部合法成分（引号字面量+可选 prefix 星号、括号、OR、空白）后不剩任何字符。
  const expression = buildMatchExpression('知识图谱" NEAR (当前) OR 1=1 -- 攻击', true).expression;
  const residue = expression
    .replace(/"(?:[^"]|"")*"( \*)?/gu, "")
    .replace(/[()\s]|OR/gu, "");
  assert.equal(residue, "", `降级表达式存在非法残留: ${expression}`);
});

test("tokenizer：extractQueryTerms 供命中感知摘要（去重保序、英文小写）", () => {
  assert.deepEqual(extractQueryTerms("上下文窗口 tuning"), ["上下", "下文", "文窗", "窗口", "tuning"]);
  assert.deepEqual(extractQueryTerms("Token Tokenizer"), ["token", "tokenizer"]);
  assert.deepEqual(extractQueryTerms("窗口 窗口"), ["窗口"]);
  assert.deepEqual(extractQueryTerms("窗"), ["窗"]);
});

test("命中感知摘要：窗口对准命中位置，省略号标注逐字截断（spec §5b.5）", () => {
  const preamble = "背景铺垫与常识笔记。".repeat(20); // 200 字
  const body = `${preamble}斐波那契数列与上下文窗口相关。${"收尾内容。".repeat(40)}`;
  const excerpt = matchAwareExcerpt(body, ["斐波", "波那", "那契"]);
  assert.ok(excerpt.startsWith("…"), "命中在正文后段 → 前侧截断标注");
  assert.ok(excerpt.endsWith("…"));
  assert.ok(excerpt.includes("斐波那契"));
  assert.ok(excerpt.length <= 240 + 2, "窗口总长受 240 字符约束（不含省略号）");

  // 命中在正文开头 → 无前导省略号；短正文无后侧省略号。
  const head = matchAwareExcerpt("上下文窗口优化是第一优先级", ["上下"]);
  assert.equal(head, "上下文窗口优化是第一优先级");

  // 多词元：窗口选择偏向同时覆盖两个词元的位置（并列取最早）。
  const spread = `${"前段铺垫。".repeat(30)}唯一甲出现。${"中段填充。".repeat(10)}唯一乙出现。${"尾部填充。".repeat(30)}`;
  const dual = matchAwareExcerpt(spread, ["唯一甲", "唯一乙"]);
  assert.ok(dual.includes("唯一甲") && dual.includes("唯一乙"), "窗口应覆盖两个词元");

  // 无词元命中 → 回落正文开头（兜底；正常词法命中不可达）。
  assert.equal(matchAwareExcerpt("完全无关的正文内容", ["量子"]), "完全无关的正文内容");
});

test("cosineSimilarity：零向量/维度不齐返回 0", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 0]), 0);
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0);
  assert.ok(Math.abs(cosineSimilarity([1, 1], [1, 1]) - 1) < 1e-9);
});
