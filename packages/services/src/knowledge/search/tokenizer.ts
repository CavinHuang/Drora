/**
 * 词法分析（W02 / spec §5b.5）。
 *
 * - 连续汉字串（CJK 统一表意文字）按相邻二元组（bigram）切分；
 * - 英文/数字串按词切分并小写；
 * - 索引侧产出空格分隔的 token 流（FTS5 默认 unicode61 以空白切词）；
 * - 查询侧构造严格转义的 MATCH 表达式：用户输入永不原样进入查询串，
 *   只允许 [token] 与 [phrase] 两种字面形式，引号转义为 "" 后整体加双引号。
 * 纯函数：不做任何 IO。
 */

/** CJK 统一表意文字 + 扩展A + 兼容表意文字（spec §5b.5 范围；谚文/假名不展开）。 */
const CJK_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const CJK_RUN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/gu;
const WORD_RUN = /[A-Za-z0-9_]+/g;

/** 单个 token 的合法性守卫：只接受 bigram/词切分产物能产生的形态。 */
function isSafeToken(token: string): boolean {
  return token.length > 0 && [...token].every((ch) => CJK_CHAR.test(ch) || /[A-Za-z0-9_]/.test(ch));
}

function cjkBigrams(run: string): string[] {
  if (run.length === 1) return [run];
  const bigrams: string[] = [];
  for (let index = 0; index < run.length - 1; index++) {
    bigrams.push(run.slice(index, index + 2));
  }
  return bigrams;
}

/** 索引侧：文本 → token 流（空格连接）。 */
export function tokenizeForIndex(text: string): string {
  const tokens: string[] = [];
  for (const run of text.match(CJK_RUN) ?? []) {
    tokens.push(...cjkBigrams(run));
  }
  for (const run of text.match(WORD_RUN) ?? []) {
    tokens.push(run.toLowerCase());
  }
  return tokens.filter(isSafeToken).join(" ");
}

export interface MatchExpression {
  /** 可直接作为 `MATCH ?` 参数的表达式（已严格转义）。 */
  expression: string;
  /** 是否 OR 连接（AND 无命中时的一次降级）。 */
  relaxed: boolean;
  tokenCount: number;
}

function quoteToken(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

function bigramPhrase(run: string): string {
  return quoteToken(cjkBigrams(run).join(" "));
}

function andExpression(parts: string[]): string {
  // FTS5 隐式 AND：相邻带引号 token 即与语义。
  return parts.join(" ");
}

function orExpression(parts: string[]): string {
  return parts.join(" OR ");
}

/**
 * 查询侧：查询文本 → MATCH 表达式。
 * - 汉字串 ≥2 → bigram phrase；单字 → prefix（`"字" *`，可命中以该字开头的大词元）；
 * - 英文/数字 → 小写词 term；
 * - 先 AND；tokenCount ≥2 时允许降级 OR（调用方在 AND 无命中时使用）。
 * 任何非法产物（理论上不可达）直接报错，绝不回退为原始用户输入。
 */
export function buildMatchExpression(query: string, relaxed: boolean): MatchExpression {
  const parts: string[] = [];
  for (const run of query.match(CJK_RUN) ?? []) {
    if (run.length === 1) {
      parts.push(`${quoteToken(run)} *`);
    } else {
      parts.push(bigramPhrase(run));
    }
  }
  for (const run of query.match(WORD_RUN) ?? []) {
    const word = run.toLowerCase();
    if (isSafeToken(word)) parts.push(quoteToken(word));
  }
  if (parts.length === 0) {
    throw new Error("查询文本没有可检索词元");
  }
  for (const part of parts) {
    // 纵深防御：表达式只允许引号包裹字面量、空白、OR 与 prefix 星号。
    if (!/^("[^"]*"|\s|\*|OR)+$/.test(part)) {
      throw new Error("MATCH 表达式构造异常");
    }
  }
  return {
    expression: relaxed ? orExpression(parts) : andExpression(parts),
    relaxed,
    tokenCount: parts.length,
  };
}
