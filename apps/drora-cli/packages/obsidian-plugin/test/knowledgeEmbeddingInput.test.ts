// 迁自 packages/services/test/knowledgeEmbeddingInput.test.ts @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：测试随实现迁入插件包，
// node:test/vitest 直连插件 server 模块（迁后路径）。除本头注释与导入重指
// （../src/knowledge|obsidian-vault|paths → ../src/server/... 同深度镜像）外与 HEAD
// 逐字节等价。原 services/test 文件随迁删除（本体实现在 P7 拆除，测试归属插件侧）。
/**
 * 嵌入输入构造单测（spec §5b.9 准确性保障）。
 *
 * 断言：Markdown/URL/HTML 噪声净化（链接取文字、裸 URL 移除、wikilink 别名优先、
 * 标题井号/强调/代码标记剥离）；组合顺序 标题→标题路径→净化正文（空段跳过）。
 * 运行：node --import tsx --test packages/services/test/knowledgeEmbeddingInput.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanMarkdownForEmbedding,
  composeEmbeddingText,
} from "../src/server/knowledge/search/embeddingInput.js";

test("cleanMarkdownForEmbedding：链接取文字、裸 URL 移除、wikilink 别名优先", () => {
  const cleaned = cleanMarkdownForEmbedding(
    "参考[前端指南](https://example.com/post/1)与文档 https://docs.example.com/a/b 的说明",
  );
  assert.equal(cleaned, "参考前端指南与文档 的说明");

  const wiki = cleanMarkdownForEmbedding("见[[目标页|更好读的别名]]与[[裸目标]]");
  assert.equal(wiki, "见更好读的别名与裸目标");

  const image = cleanMarkdownForEmbedding("截图：![界面截图](https://example.com/a.png) 如上");
  assert.equal(image, "截图：界面截图 如上");
});

test("cleanMarkdownForEmbedding：标题井号/强调/代码标记剥离（代码内容保留）、HTML 剥离", () => {
  const cleaned = cleanMarkdownForEmbedding("## **重点**：`const x = 1` 与 <br> 换行");
  assert.equal(cleaned, "重点：const x = 1 与 换行");
});

test("composeEmbeddingText：标题→标题路径→正文（保留体内部结构）", () => {
  const composed = composeEmbeddingText({
    title: "上下文工程",
    headingPath: "上下文工程 > 窗口管理",
    body: "## 窗口\n\n窗口管理要点。",
  });
  assert.deepEqual(composed.split("\n"), [
    "上下文工程",
    "上下文工程 > 窗口管理",
    "窗口",
    "",
    "窗口管理要点。",
  ]);
});

test("composeEmbeddingText：正文 URL/链接净化后再组合", () => {
  const composed = composeEmbeddingText({
    title: "阅读清单",
    headingPath: null,
    body: "详见 [深度文章](https://example.com/a) 原文 https://example.com/b 全文。",
  });
  assert.equal(composed, "阅读清单\n详见 深度文章 原文 全文。");
});
