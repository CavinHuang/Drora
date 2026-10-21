/**
 * Markdown chunker（W02 / spec §5b.4；2026-10-12 尺寸上限与块级切分 + 结构抽取）。
 *
 * - 按 ATX 标题（#..######）切 chunk，heading 路径形如 `A > B`；
 * - chunk 保存 quote selector：1-based 起止行 + 全文字符偏移（W03 Receipt 绑定）；
 * - chunk 文本含标题行本身（标题词可命中正文检索）；
 * - 文首 frontmatter（--- 包围）单独成 chunk（heading=null）；
 * - 标题段文本超过 MAX_CHUNK_CHARS 时按空行（段落）边界二次切分，无段落边界按行
 *   硬切；子块继承段的 heading 路径与级别，quote selector 仍为精确行区间；
 * - 单文件 chunk 上限 MAX_CHUNKS_PER_FILE，超出截断并标记 truncated（partial coverage）；
 * - 结构抽取（spec §5b.4）：逐 chunk 抽正文 [[wikilink]] 目标（别名取 | 前部分，
 *   去重保序）；frontmatter tags 为文档级，作用于该文档全部 chunk。元数据只作
 *   索引侧检索信号（§5b.5 meta 列），不进 RPC 出站面。
 * 纯函数：不做任何 IO。
 */
import { createHash } from "node:crypto";

export const MAX_CHUNKS_PER_FILE = 512;

/** 单 chunk 文本上限（字符）；超过的标题段按段落/行边界二次切分（spec §5b.4）。 */
export const MAX_CHUNK_CHARS = 1200;

export interface MarkdownChunk {
  ordinal: number;
  /** `A > B` 形式的标题路径；正文顶层/frontmatter 为 null。 */
  headingPath: string | null;
  /** 标题级别（1-6）；非标题 chunk 为 0。 */
  level: number;
  /** 1-based 起止行。 */
  startLine: number;
  endLine: number;
  /** 全文（原 content）字符偏移，含头不含尾。 */
  startOffset: number;
  endOffset: number;
  text: string;
  sha256: string;
  /** 正文 [[wikilink]] 目标（别名取 `|` 前部分；去重保序；spec §5b.4）。 */
  links?: string[];
  /** 文档级 frontmatter tags（作用于该文档全部 chunk；去重保序；spec §5b.4）。 */
  tags?: string[];
}

export interface ChunkDocumentResult {
  title: string;
  chunks: MarkdownChunk[];
  truncated: boolean;
}

interface HeadingLine {
  level: number;
  text: string;
  lineIndex: number;
}

function parseHeading(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  const levelText = match?.[1];
  const headingText = match?.[2];
  if (!levelText || !headingText) return null;
  return { level: levelText.length, text: headingText.trim() };
}

/** 文档标题：第一个 H1 标题文本，缺省回退文件名（去 .md）。 */
export function resolveDocumentTitle(content: string, fallbackName: string): string {
  for (const line of content.split(/\r?\n/)) {
    const heading = parseHeading(line);
    if (heading && heading.level === 1) return heading.text;
  }
  return fallbackName;
}

/**
 * 正文 [[wikilink]] 目标抽取（spec §5b.4）：别名取 `|` 前部分，去重保序；空目标跳过。
 * V1 边界：不拆 `#标题`/`^块` 引用（目标整体保留）；`![[embed]]` 同按链接目标收录。
 */
export function extractWikilinkTargets(text: string): string[] {
  const targets: string[] = [];
  for (const match of text.matchAll(/\[\[([^[\]]+?)\]\]/gu)) {
    const raw = match[1] ?? "";
    const target = raw.split("|")[0]?.trim() ?? "";
    if (target && !targets.includes(target)) targets.push(target);
  }
  return targets;
}

/**
 * frontmatter tags 解析（spec §5b.4，文档级）：只识别 `tags`/`tag` 键，flow（`[a, b]`）
 * 与 block（缩进 `- a` 逐行）两种形态；剥离首尾引号与 `#` 前缀，去重保序。
 * 宽松解析（非完整 YAML）：行首缩进内的其他键、无法识别的形态一律跳过不加噪声。
 */
export function parseFrontmatterTags(frontmatterText: string): string[] {
  const tags: string[] = [];
  const pushTag = (value: string): void => {
    const tag = value
      .trim()
      .replace(/^#/, "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  };
  const lines = frontmatterText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const keyMatch = /^(tags|tag)\s*:(.*)$/u.exec(line);
    if (!keyMatch) continue;
    const inline = keyMatch[2]?.trim() ?? "";
    if (inline) {
      // flow 形态：`tags: [a, b]`（含裸值 `tags: a`）。
      const flow = /^\[(.*)\]$/u.exec(inline);
      for (const part of (flow?.[1] ?? inline).split(",")) pushTag(part);
      continue;
    }
    // block 形态：后续缩进行 `- a`，直到首个非列表行。
    for (let next = index + 1; next < lines.length; next++) {
      const item = /^(\s*)-\s+(.+?)\s*$/u.exec(lines[next] ?? "");
      if (!item || (item[1]?.length ?? 0) === 0) break;
      pushTag(item[2] ?? "");
      index = next;
    }
  }
  return tags;
}

/**
 * frontmatter chunk 文本 → 文档级 tags（spec §5g.2 单一口径）：首行 `---` 且存在闭合
 * `---` 才解析，否则返回 `[]`（正文任意 `tags:` 行永不误判为 frontmatter）。索引切分
 * （chunkMarkdown）与洞察聚合（§5g 从落盘 frontmatter chunk body 重提取）共用本函数，
 * 保证两处 tags 口径严格一致，不出现第二份解析逻辑。
 */
export function parseFrontmatterChunkTags(chunkText: string): string[] {
  const lines = chunkText.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]?.trim() === "---") return parseFrontmatterTags(chunkText);
  }
  return [];
}

export function chunkMarkdown(content: string, fallbackName: string): ChunkDocumentResult {
  const lines = content.split(/\r?\n/);
  const headings: HeadingLine[] = [];
  // prefixOffsets[i] = 第 i 行起字符偏移；prefixOffsets[n] = 末尾（按 \n 连接口径）。
  const prefixOffsets: number[] = Array.from({ length: lines.length + 1 }, () => 0);
  prefixOffsets[0] = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const heading = parseHeading(line);
    if (heading) headings.push({ ...heading, lineIndex: index });
    prefixOffsets[index + 1] = (prefixOffsets[index] ?? 0) + line.length + 1;
  }
  const totalChars = content.length;

  // frontmatter（文首 --- 包围）边界先于切分确定：tags 是文档级元数据（spec §5b.4），
  // 作用于该文档全部 chunk；frontmatter 本身仍单独成 chunk（见下方 bodyStartLine）。
  let frontmatterClosing = -1;
  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < lines.length; index++) {
      if (lines[index]?.trim() === "---") {
        frontmatterClosing = index;
        break;
      }
    }
  }
  const documentTags =
    frontmatterClosing > 0
      ? parseFrontmatterChunkTags(lines.slice(0, frontmatterClosing + 1).join("\n"))
      : [];

  const chunks: MarkdownChunk[] = [];
  let truncated = false;

  // pushChunk：按行区间产出 chunk（含上限守卫与空顶层块跳过）。
  const pushChunk = (
    startLine: number,
    endLine: number,
    headingPath: string | null,
    level: number,
  ): void => {
    if (chunks.length >= MAX_CHUNKS_PER_FILE) {
      truncated = true;
      return;
    }
    const text = lines.slice(startLine, endLine + 1).join("\n");
    if (!text.trim() && headingPath === null) return;
    chunks.push({
      ordinal: chunks.length,
      headingPath,
      level,
      startLine: startLine + 1,
      endLine: endLine + 1,
      startOffset: Math.min(prefixOffsets[startLine] ?? totalChars, totalChars),
      // D3 修复（2026-10-17 R9 验收实证）：endOffset 必须精确落在 chunk 文本末尾。
      // 旧口径 prefixOffsets[endLine+1] 比文本多含一个换行——非末段 chunk 的
      // quoteSliceSha256（按 offset 切片）与 chunk.sha256（按无尾换行的 text 计算）
      // 恒差一个换行符，多段笔记的非末段永远过不了 prepareEvidence 的 stale 校验、
      // 签发不出可信 Receipt。末段以 totalChars 收口不变；既有索引需随 epoch
      // 重建后生效新口径。
      endOffset: Math.min(
        (prefixOffsets[endLine] ?? 0) + (lines[endLine] ?? "").length,
        totalChars,
      ),
      text,
      sha256: createHash("sha256").update(text, "utf-8").digest("hex"),
      links: extractWikilinkTargets(text),
      tags: documentTags,
    });
  };

  /**
   * 段超上限的二次切分（spec §5b.4）：贪心按行累积到上限，优先回退到窗口内最后一个
   * 空行（段落边界）；无空行按行硬切；单行超上限整行成块（行不可再分）。含段首行
   * （标题行）的子块永不跳过——标题词必须可检索；纯空白子块跳过不加噪声。
   */
  const pushSectionWithCap = (
    startLine: number,
    endLine: number,
    headingPath: string | null,
    level: number,
  ): void => {
    const sectionLength =
      (prefixOffsets[endLine + 1] ?? totalChars) - (prefixOffsets[startLine] ?? totalChars);
    if (sectionLength <= MAX_CHUNK_CHARS) {
      pushChunk(startLine, endLine, headingPath, level);
      return;
    }
    let subStart = startLine;
    while (subStart <= endLine && !truncated) {
      let subEnd = subStart;
      while (
        subEnd + 1 <= endLine &&
        (prefixOffsets[subEnd + 2] ?? totalChars) - (prefixOffsets[subStart] ?? totalChars) <=
          MAX_CHUNK_CHARS
      ) {
        subEnd += 1;
      }
      // 窗口内（不含 subStart 自身）回退最后一个空行，避免切断段落。
      if (subEnd < endLine) {
        for (let candidate = subEnd; candidate > subStart; candidate--) {
          if ((lines[candidate] ?? "").trim() === "") {
            subEnd = candidate;
            break;
          }
        }
      }
      const text = lines.slice(subStart, subEnd + 1).join("\n");
      if (text.trim() !== "" || subStart === startLine) {
        pushChunk(subStart, subEnd, headingPath, level);
      }
      subStart = subEnd + 1;
    }
  };

  // lineIndex 处生效的标题链（含当行标题）：栈内保存层级，弹栈按栈顶层级比较，
  // 防止浅级别回退时过度弹出（同级替换只弹同级与更深，不动祖先）。
  const headingPathAt = (lineIndex: number): { path: string | null; level: number } => {
    const stack: Array<{ text: string; level: number }> = [];
    for (const heading of headings) {
      if (heading.lineIndex > lineIndex) break;
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= heading.level) {
        stack.pop();
      }
      stack.push({ text: heading.text, level: heading.level });
    }
    const top = stack[stack.length - 1];
    return {
      path: stack.length > 0 ? stack.map((entry) => entry.text).join(" > ") : null,
      level: top?.level ?? 0,
    };
  };

  // frontmatter（文首 --- 包围）单独成 chunk（边界已在切分前确定）。
  let bodyStartLine = 0;
  if (frontmatterClosing > 0) {
    pushChunk(0, frontmatterClosing, null, 0);
    bodyStartLine = frontmatterClosing + 1;
  }

  // 正文按标题切分：每个标题行开启新 chunk（含标题行）；超上限的段做块级二次切分。
  const bodyHeadings = headings.filter((heading) => heading.lineIndex >= bodyStartLine);
  const firstBodyHeadingLine = bodyHeadings[0]?.lineIndex ?? lines.length;

  // 第一个正文标题前的内容作为顶层 chunk。
  if (firstBodyHeadingLine - 1 >= bodyStartLine) {
    pushSectionWithCap(bodyStartLine, firstBodyHeadingLine - 1, null, 0);
  }

  for (let index = 0; index < bodyHeadings.length && !truncated; index++) {
    const heading = bodyHeadings[index];
    if (!heading) break;
    const start = heading.lineIndex;
    const next = bodyHeadings[index + 1];
    const end = next ? next.lineIndex - 1 : lines.length - 1;
    const { path, level } = headingPathAt(start);
    pushSectionWithCap(start, end, path, level);
  }

  return { title: resolveDocumentTitle(content, fallbackName), chunks, truncated };
}
