/**
 * 查询词元提取与命中区间规划（specs/obsidian-knowledge.md §5b.5/§5c.3；2026-10-12）。
 *
 * 单一出处：本文件是「查询词元」口径的唯一定义处，两侧同时引用——
 * - packages/services（命中感知摘要窗口）：经 `search/tokenizer.ts` re-export 消费，
 *   依赖方向 services→shared；
 * - packages/ui（候选摘录 `<mark>` 命中高亮）：直接消费。
 * 任何一侧不得手写第二份词元切分逻辑（AGENTS.md「契约键单一出处」）。
 *
 * 纯函数：不做任何 IO、不依赖 node:*，browser-safe。
 */

/** CJK 统一表意文字 + 扩展A + 兼容表意文字（spec §5b.5 范围；谚文/假名不展开）。 */
const CJK_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const CJK_RUN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/gu;
const WORD_RUN = /[A-Za-z0-9_]+/g;

/** 文本中的连续汉字串（bigram 切分的输入）。 */
export function matchCjkRuns(text: string): string[] {
  return text.match(CJK_RUN) ?? [];
}

/** 文本中的英文/数字/下划线词串（小写化后作查询词）。 */
export function matchWordRuns(text: string): string[] {
  return text.match(WORD_RUN) ?? [];
}

/**
 * 单个 token 的合法性守卫：只接受 bigram/词切分产物能产生的形态（CJK 汉字或
 * ASCII 字母/数字/下划线），其余产物在进入 FTS/高亮前丢弃。
 */
export function isSafeToken(token: string): boolean {
  return token.length > 0 && [...token].every((ch) => CJK_CHAR.test(ch) || /[A-Za-z0-9_]/.test(ch));
}

/** 汉字串 → 相邻二元组序列；单字成元（与索引侧 tokenizer 同一口径）。 */
export function cjkBigrams(run: string): string[] {
  if (run.length === 1) return [run];
  const bigrams: string[] = [];
  for (let index = 0; index < run.length - 1; index++) {
    bigrams.push(run.slice(index, index + 2));
  }
  return bigrams;
}

/**
 * 查询词元提取（命中感知摘要与摘录高亮共用，spec §5b.5）：CJK bigram/单字 +
 * 英文小写词，去重保序。这些词元以子串形态在 chunk 正文中查找——bigram/前缀词
 * 按索引构造必然是命中文本的子串。
 */
export function extractQueryTerms(query: string): string[] {
  const terms: string[] = [];
  for (const run of matchCjkRuns(query)) {
    for (const bigram of cjkBigrams(run)) {
      if (bigram && !terms.includes(bigram)) terms.push(bigram);
    }
  }
  for (const run of matchWordRuns(query)) {
    const word = run.toLowerCase();
    if (isSafeToken(word) && !terms.includes(word)) terms.push(word);
  }
  return terms;
}

/** 文本中的一段命中区间（start 含 / end 不含，原文 code unit 偏移）。 */
export interface TextHitInterval {
  start: number;
  end: number;
}

/**
 * 规划词元在文本中的命中区间：大小写不敏感子串匹配；区间按起点排序，重叠/相邻
 * 合并，输出互不重叠——调用方据此把原文切片渲染为 `<mark>`。
 *
 * 大小写折叠可能改变串长（罕见 Unicode，如 `İ` 折叠为两 code unit）；此时偏移对
 * 原文不可信，整段回落大小写敏感匹配，保证区间与原文逐字对齐——摘录是证据文本，
 * 宁可少高亮不可错位。
 */
export function planTextHitIntervals(text: string, terms: string[]): TextHitInterval[] {
  if (text.length === 0 || terms.length === 0) return [];
  const folded = text.toLocaleLowerCase();
  // 折叠前后串长一致 → 折叠串上的偏移可原样映射回原文；否则用原文本身匹配。
  const haystack = folded.length === text.length ? folded : text;
  const ranges: TextHitInterval[] = [];
  for (const term of terms) {
    if (term.length === 0) continue;
    const needle = haystack === folded ? term.toLocaleLowerCase() : term;
    let searchFrom = 0;
    for (;;) {
      const at = haystack.indexOf(needle, searchFrom);
      if (at === -1) break;
      ranges.push({ start: at, end: at + needle.length });
      searchFrom = at + needle.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TextHitInterval[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ ...range });
    } else {
      last.end = Math.max(last.end, range.end);
    }
  }
  return merged;
}
