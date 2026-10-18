import assert from "node:assert/strict";
import test from "node:test";
import {
  chunkMarkdown,
  extractWikilinkTargets,
  MAX_CHUNK_CHARS,
  parseFrontmatterTags,
  resolveDocumentTitle,
} from "../src/knowledge/index/markdownChunker.js";
import {
  buildMatchExpression,
  extractQueryTerms,
  tokenizeForIndex,
} from "../src/knowledge/search/tokenizer.js";
import { matchAwareExcerpt } from "../src/knowledge/search/lexicalRetriever.js";
import { cosineSimilarity } from "../src/knowledge/search/embeddingPort.js";

test("chunker：标题路径、行号与字符偏移可对回原文", () => {
  const content = [
    "# 根标题",
    "引言段落。",
    "## 小节 A",
    "A 的正文。",
    "### 深层 B",
    "B 的正文。",
    "## 小节 C",
    "C 的正文。",
  ].join("\n");
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
  const content = ["---", "title: 笔记", "tags: [a]", "---", "正文第一段", "## 节", "节内容"].join(
    "\n",
  );
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

test("chunker：wikilink 目标抽取——别名取 | 前部分、去重保序（spec §5b.4）", () => {
  // 别名形态：目标取 `|` 前部分。
  assert.deepEqual(extractWikilinkTargets("[[知识图谱|KG]]"), ["知识图谱"]);
  // 普通形态与相邻多链接保序；重复目标去重。
  assert.deepEqual(extractWikilinkTargets("见 [[甲]] 与 [[乙|别名]]，再看 [[甲|again]]。"), [
    "甲",
    "乙",
  ]);
  // V1 边界：#标题/^块 引用整体保留不拆；embed 同按目标收录；空目标跳过。
  assert.deepEqual(extractWikilinkTargets("[[笔记#小节]] [[画布]]"), ["笔记#小节", "画布"]);
  assert.deepEqual(extractWikilinkTargets("![[image.png]] [[]] [[ ]]"), ["image.png"]);
  assert.deepEqual(extractWikilinkTargets("没有链接的正文"), []);
});

test("chunker：frontmatter tags 解析——flow/block/引号/# 前缀/去重保序（spec §5b.4）", () => {
  // flow 形态（含引号与 # 前缀剥离）。
  assert.deepEqual(parseFrontmatterTags('---\ntags: [项目/甲, "带 空格", #zettel, 项目/甲]\n---'), [
    "项目/甲",
    "带 空格",
    "zettel",
  ]);
  // block 形态：缩进 `- ` 逐行；遇到非列表行停止。
  assert.deepEqual(parseFrontmatterTags("---\ntags:\n  - 甲\n  - 乙\ntitle: 无关键\n---"), [
    "甲",
    "乙",
  ]);
  // 旧写法 `tag` 键与裸值。
  assert.deepEqual(parseFrontmatterTags("---\ntag: 读书\n---"), ["读书"]);
  // 无 tags 键 → 空。
  assert.deepEqual(parseFrontmatterTags("---\ntitle: 笔记\n---"), []);
});

test("chunker：结构抽取挂载——tags 文档级作用于全部 chunk，links 逐 chunk（spec §5b.4）", () => {
  const content = [
    "---",
    "tags: [项目/atlas, zettel]",
    "---",
    "引言，链到 [[方法论文档|method]]。",
    "## 节一",
    "正文提到 [[另一个笔记]] 与 [[方法论文档]]。",
  ].join("\n");
  const result = chunkMarkdown(content, "fallback");
  assert.ok(result.chunks.length >= 2);
  for (const chunk of result.chunks) {
    // 文档级 tags：frontmatter chunk 与正文 chunk 拿到同一份。
    assert.deepEqual(chunk.tags, ["项目/atlas", "zettel"]);
    assert.ok(Array.isArray(chunk.links));
  }
  const preamble = result.chunks.find((chunk) => chunk.text.includes("引言"));
  assert.ok(preamble);
  assert.deepEqual(preamble.links, ["方法论文档"]);
  const section = result.chunks.find((chunk) => chunk.text.includes("另一个笔记"));
  assert.ok(section);
  assert.deepEqual(section.links, ["另一个笔记", "方法论文档"]);
  // 无 frontmatter 的文档 tags 为空数组（缺省事实，不加噪声）。
  const plain = chunkMarkdown("# 纯正文\n没有标签", "plain");
  for (const chunk of plain.chunks) {
    assert.deepEqual(chunk.tags, []);
  }
});

test("chunker：超上限标题段按空行（段落）边界二次切分，headingPath 继承且 quote 可回原文", () => {
  const paragraph = "这是一段用于撑爆单块上限的正文内容。".repeat(20); // ≈360 字符
  const content = ["# 长文", "", paragraph, "", paragraph, "", paragraph, "", paragraph, ""].join(
    "\n",
  );
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
  const listLines = Array.from(
    { length: 40 },
    (_, index) => `- 列表项 ${index}：${"细节内容。".repeat(8)}`,
  );
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

test("tokenizer：降级轮形态——CJK run 为 phrase OR 内容 bigram 备选（修复死降级）", () => {
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

test("tokenizer：降级备选过滤含虚词字的 bigram（真库反馈：虚词以数量压过高区分度命中）", () => {
  // 「相关的文章」的 bigram 备选去掉 关的/的文（含虚词「的」），保留 相关/文章。
  const relaxed = buildMatchExpression("相关的文章", true);
  assert.equal(relaxed.expression, '("相关 关的 的文 文章") OR ("相关" OR "文章")');
  // 全部备选被滤时保留原始集合，绝不交空（「的了」的 bigram 含「的」「了」双虚词）。
  const allFiltered = buildMatchExpression("的了", true);
  assert.equal(allFiltered.expression, '"的了"');
  // strict 轮不受影响：phrase 完整保留。
  const strict = buildMatchExpression("相关的文章", false);
  assert.equal(strict.expression, '"相关 关的 的文 文章"');
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
  const residue = expression.replace(/"(?:[^"]|"")*"( \*)?/gu, "").replace(/[()\s]|OR/gu, "");
  assert.equal(residue, "", `降级表达式存在非法残留: ${expression}`);
});

test("tokenizer：extractQueryTerms 供命中感知摘要（去重保序、英文小写）", () => {
  assert.deepEqual(extractQueryTerms("上下文窗口 tuning"), [
    "上下",
    "下文",
    "文窗",
    "窗口",
    "tuning",
  ]);
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

test("D3 回归：每个 chunk 的 offset 区间切片 sha 与 chunk.sha256 严格一致（含非末段）", async () => {
  // 2026-10-17 R9 subagent 验收实证：旧口径 endOffset 多含一个换行，非末段 chunk
  // 在 evidenceRegistry.prepareEvidence 的 quoteSliceSha256 校验恒 stale——多段
  // 笔记的非末段永远拿不到可信 Receipt。本用例按签发路径同款算法锁死口径。
  const { quoteSliceSha256 } = await import("../src/knowledge/evidence/evidenceRegistry.js");
  const content = [
    "# 甲",
    "第一段内容，行一。",
    "第一段内容，行二。",
    "",
    "# 乙",
    "第二段内容，行一。",
    "第二段内容，行二。",
    "第二段内容，行三。",
    "",
    "# 丙",
    "第三段（末段）内容。",
  ].join("\n");
  const { chunks } = chunkMarkdown(content, "multi.md");
  assert.ok(chunks.length >= 3, `应切出至少 3 段，实际 ${chunks.length}`);
  for (const chunk of chunks) {
    assert.equal(
      quoteSliceSha256(content, {
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
      }),
      chunk.sha256,
      `chunk ordinal=${chunk.ordinal}（行 ${chunk.startLine}-${chunk.endLine}）切片 sha 必须等于 chunk sha`,
    );
    // 切片还原的文本应与 chunk.text 逐字一致。
    const normalized = content; // 测试内容无 CRLF，归一化后不变
    assert.equal(normalized.slice(chunk.startOffset, chunk.endOffset), chunk.text);
  }
});
