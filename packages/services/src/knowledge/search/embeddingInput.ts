/**
 * 嵌入输入构造（spec §5b.9 准确性保障）。
 *
 * 嵌入模型的输入质量直接决定语义召回的准确性：
 * - Markdown 语法与 URL 是「token 汤」——链接括号、裸 URL、HTML 标签会把向量拉向
 *   语法噪声而非正文语义，索引前必须净化；
 * - 标题与标题路径是 chunk 最重要的主题语境（短正文 chunk 尤甚），纳入嵌入输入；
 * - 净化/组合是**纯函数**：索引侧（embed-before-tx）与检索侧重排的回退嵌入共用
 *   同一实现——两侧口径分叉会让余弦比较失去意义。
 */

export interface EmbeddingInputParts {
  title: string;
  headingPath: string | null;
  body: string;
}

/** 剥离 Markdown/HTML 语法噪声，保留正文语义（代码内容保留、代码围栏标记剥离）。 */
export function cleanMarkdownForEmbedding(body: string): string {
  let text = body;
  // 图片（![alt](url) / ![[target]]）：占位语法无正文语义，保留 alt/target 文字。
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1");
  text = text.replace(/!\[\[([^\]|]+)(\|[^\]]*)?\]\]/gu, "$1");
  // wikilink [[target|alias]] → alias 优先（别名是作者写给读者的措辞）。
  text = text.replace(
    /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/gu,
    (_match, target: string, alias?: string) =>
      alias !== undefined && alias.trim().length > 0 ? alias : target,
  );
  // markdown 链接 [text](url) → text（URL 是嵌入噪声）。
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1");
  // 裸 URL → 整体移除。
  text = text.replace(/https?:\/\/\S+/gu, "");
  // HTML 标签剥离。
  text = text.replace(/<[^>]+>/gu, "");
  // 标题井号 / 强调 / 行内与围栏代码标记剥离（代码内容保留）。
  text = text.replace(/^#{1,6}\s+/gmu, "");
  text = text.replace(/(\*\*|__|~~)/gu, "");
  text = text.replace(/`{1,3}/gu, "");
  // URL 移除等留下的连续空白折叠（嵌入对空白不敏感，避免 token 汤残留双空格）。
  text = text.replace(/ {2,}/gu, " ");
  return text;
}

/** 组装嵌入输入：标题 + 标题路径 + 净化后正文（空段跳过）。 */
export function composeEmbeddingText(parts: EmbeddingInputParts): string {
  const cleaned = cleanMarkdownForEmbedding(parts.body);
  const heading = parts.headingPath ?? "";
  return [parts.title, heading, cleaned].filter((part) => part.trim().length > 0).join("\n");
}
