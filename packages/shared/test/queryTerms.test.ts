/**
 * 查询词元提取与命中区间规划单测（specs/obsidian-knowledge.md §5b.5/§5c.3）。
 *
 * `extractQueryTerms` 是 services 命中感知摘要与 UI 摘录高亮共用的单一出处；
 * `planTextHitIntervals` 保证高亮区间互不重叠且对原文逐字对齐。
 * 运行：node --import tsx --test packages/shared/test/queryTerms.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  cjkBigrams,
  extractQueryTerms,
  isSafeToken,
  planTextHitIntervals,
} from "../src/knowledge/queryTerms.js";

test("extractQueryTerms：CJK bigram/单字 + 英文小写词，去重保序", () => {
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
  // 无可检索词元的输入（纯标点/空白）→ 空词元表，高亮与摘要自然回落。
  assert.deepEqual(extractQueryTerms("  ！？... "), []);
  assert.deepEqual(extractQueryTerms(""), []);
});

test("词元基元：cjkBigrams/isSafeToken 与 services tokenizer 原口径一致", () => {
  assert.deepEqual(cjkBigrams("上下文"), ["上下", "下文"]);
  assert.deepEqual(cjkBigrams("窗"), ["窗"]);
  assert.equal(isSafeToken("上下"), true);
  assert.equal(isSafeToken("ctx_1"), true);
  assert.equal(isSafeToken("a-b"), false);
  assert.equal(isSafeToken(""), false);
});

test("planTextHitIntervals：大小写不敏感子串匹配，区间有序且互不重叠", () => {
  const intervals = planTextHitIntervals("Context Window tuning", ["window", "tuning"]);
  assert.deepEqual(intervals, [
    { start: 8, end: 14 },
    { start: 15, end: 21 },
  ]);
  // 切片逐字对齐原文（证据文本不可错位）。
  const text = "Context Window tuning";
  for (const range of intervals) {
    assert.equal(
      text.slice(range.start, range.end).toLowerCase(),
      text.slice(range.start, range.end).toLocaleLowerCase(),
    );
  }
});

test("planTextHitIntervals：CJK bigram 相邻命中合并为连续区间", () => {
  // 查询「上下文」→ bigram [上下, 下文]；正文连续命中合并为一段高亮。
  const text = "前缀。上下文窗口的长度。";
  const intervals = planTextHitIntervals(text, ["上下", "下文", "文窗", "窗口"]);
  assert.deepEqual(intervals, [{ start: 3, end: 8 }]);
  assert.equal(text.slice(3, 8), "上下文窗口");
});

test("planTextHitIntervals：重叠词元按起点合并不重叠；空词元/空文本守卫", () => {
  // 「窗口」「口优」在「窗口优」中重叠 → 合并为一个区间。
  assert.deepEqual(planTextHitIntervals("窗口优", ["窗口", "口优"]), [{ start: 0, end: 3 }]);
  assert.deepEqual(planTextHitIntervals("abc", [""]), []);
  assert.deepEqual(planTextHitIntervals("", ["abc"]), []);
  assert.deepEqual(planTextHitIntervals("abc", []), []);
  // 同一词元多次出现 → 多个互不重叠区间。
  assert.deepEqual(planTextHitIntervals("aXaXa", ["a"]), [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
    { start: 4, end: 5 },
  ]);
});

test("planTextHitIntervals：大小写折叠改变串长的罕见 Unicode 回落敏感匹配，偏移不错位", () => {
  // "İstanbul".toLocaleLowerCase() 串长 +1：折叠路径的偏移对原文不可信，必须回落。
  const text = "İstanbul 窗口";
  const intervals = planTextHitIntervals(text, ["窗口"]);
  assert.deepEqual(intervals, [{ start: 9, end: 11 }]);
  assert.equal(text.slice(9, 11), "窗口");
});
