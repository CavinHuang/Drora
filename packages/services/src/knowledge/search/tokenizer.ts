/**
 * 词法分析（W02 / spec §5b.5；2026-10-12 查询能力增强）。
 *
 * - 连续汉字串（CJK 统一表意文字）按相邻二元组（bigram）切分；
 * - 英文/数字串按词切分并小写；
 * - 索引侧产出空格分隔的 token 流（FTS5 默认 unicode61 以空白切词）；
 * - 查询侧构造严格转义的 MATCH 表达式：用户输入永不原样进入查询串，
 *   只允许 [token]/[phrase]/[prefix] 三种字面形式，引号转义为 "" 后整体加双引号。
 * - 英文/数字词 ≥3 字符作前缀（`"词" *`，前缀含本词）；<3 字符保持精确词。
 * - 两级阶梯（spec §5b.5）：strict 轮 AND（CJK run 作整体 phrase）；零命中且
 *   canRelax 时唯一一次降级轮——CJK run = phrase OR 全部 bigram（修复单段长查询
 *   只有一个 AND 部件、旧判据「词元 ≥2」永不触发降级的死降级缺陷）。
 *
 * 词元基元与 `extractQueryTerms` 自 2026-10-12 起单一出处为 `@drora/shared`
 * （`knowledge/queryTerms.ts`，spec §5b.5）：services 的命中感知摘要与 UI 的摘录
 * 命中高亮共用同一词元口径，本文件经 re-export 保持既有导出面与测试不变。
 * 本文件保留 FTS 专属的 token 流产出与 MATCH 表达式构造。纯函数：不做任何 IO。
 */
import {
  cjkBigrams,
  extractQueryTerms,
  isSafeToken,
  matchCjkRuns,
  matchWordRuns,
} from "@drora/shared";

export { extractQueryTerms };

/** 英文/数字词前缀查询的最小长度：更短的词（"js"/"ai"）前缀召回噪声过大。 */
const PREFIX_MIN_CHARS = 3;

/** 索引侧：文本 → token 流（空格连接）。 */
export function tokenizeForIndex(text: string): string {
  const tokens: string[] = [];
  for (const run of matchCjkRuns(text)) {
    tokens.push(...cjkBigrams(run));
  }
  for (const run of matchWordRuns(text)) {
    tokens.push(run.toLowerCase());
  }
  return tokens.filter(isSafeToken).join(" ");
}

export interface MatchExpression {
  /** 可直接作为 `MATCH ?` 参数的表达式（已严格转义）。 */
  expression: string;
  /** 是否降级轮（AND 无命中后的唯一一次扩搜）。 */
  relaxed: boolean;
  tokenCount: number;
  /**
   * strict 形态下判定：降级形态是否确会产生不同表达式（§5b.5 扩搜资格，
   * DecisionPolicy EXPAND_ONCE 的前提）。存在 ≥3 字 CJK run（可拆 bigram 备选）
   * 或部件数 ≥2（AND→OR 改变语义）即为 true；单个英文词（前缀已在 strict 生效）
   * 等形态为 false——此时降级轮不可能改变结果，编排器不得浪费一轮。
   */
  canRelax: boolean;
}

function quoteToken(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

function bigramPhrase(run: string): string {
  return quoteToken(cjkBigrams(run).join(" "));
}

/** 降级轮 CJK 部件：phrase OR 全部 bigram（phrase 命中经 bm25 自然排前；2 字 run 退化为 phrase 本身）。 */
function relaxedCjkPart(run: string): string {
  const bigrams = cjkBigrams(run);
  if (bigrams.length <= 1) return bigramPhrase(run);
  return `(${bigramPhrase(run)}) OR (${bigrams.map((bigram) => quoteToken(bigram)).join(" OR ")})`;
}

function andExpression(parts: string[]): string {
  // FTS5 隐式 AND：相邻带引号 token 即与语义。
  return parts.join(" ");
}

function orExpression(parts: string[]): string {
  return parts.join(" OR ");
}

/** 英文/数字词的查询形态：≥3 字符前缀（含本词），短词精确。 */
function wordQueryPart(word: string): string {
  return word.length >= PREFIX_MIN_CHARS ? `${quoteToken(word)} *` : quoteToken(word);
}

/**
 * 查询侧：查询文本 → MATCH 表达式。
 * - 汉字串 ≥2 → bigram phrase（降级轮为 phrase OR bigram 集合）；单字 → prefix；
 * - 英文/数字 → 小写词，≥3 字符前缀、<3 精确（两轮同形）；
 * - strict 轮 AND；`canRelax`（strict 形态下判定）= 降级资格，编排器在 AND 零命中时
 *   据此决定是否执行唯一一次降级轮。
 * 任何非法产物（理论上不可达）直接报错，绝不回退为原始用户输入。
 */
export function buildMatchExpression(query: string, relaxed: boolean): MatchExpression {
  const parts: string[] = [];
  let canRelax = false;
  for (const run of matchCjkRuns(query)) {
    if (run.length === 1) {
      parts.push(`${quoteToken(run)} *`);
    } else {
      // ≥3 字 run 降级时可拆出 bigram 备选；2 字 run 的 phrase 与 bigram 相同，无可放松。
      // canRelax 与当前轮次无关——它描述「降级形态 ≠ strict 形态」，供降级轮诊断复用。
      if (run.length >= 3) canRelax = true;
      parts.push(relaxed ? relaxedCjkPart(run) : bigramPhrase(run));
    }
  }
  for (const run of matchWordRuns(query)) {
    const word = run.toLowerCase();
    if (isSafeToken(word)) parts.push(wordQueryPart(word));
  }
  if (parts.length === 0) {
    throw new Error("查询文本没有可检索词元");
  }
  if (parts.length >= 2) {
    // 多部件：AND→OR 本身改变语义。
    canRelax = true;
  }
  for (const part of parts) {
    // 纵深防御：表达式只允许引号包裹字面量、空白、OR、prefix 星号与分组括号。
    if (!/^("[^"]*"|\s|\*|OR|\(|\))+$/u.test(part)) {
      throw new Error("MATCH 表达式构造异常");
    }
  }
  return {
    expression: relaxed ? orExpression(parts) : andExpression(parts),
    relaxed,
    tokenCount: parts.length,
    canRelax,
  };
}
