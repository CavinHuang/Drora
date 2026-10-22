/**
 * composerTextInsertRequest mode="append" 的确定性拼接规则
 * （specs/voice-agent-integration.md §2.4）：正文为空 → 直接写入；正文非空且尾字符
 * 非空白 → 先补一个空格再追加。不覆盖用户已编辑内容（只在其尾部拼接）。
 *
 * 为什么抽纯函数：规则要在 applyExternalTextInsertRequestToComposer（composer 应用面）
 * 与单测两处保持逐字一致，拼接边界（空白判定、多段顺序）靠用例钉住。
 */

export function appendComposerText(existing: string, incoming: string): string {
  const trimmedIncoming = incoming.trim();
  if (trimmedIncoming.length === 0) {
    return existing;
  }
  if (existing.length === 0) {
    return trimmedIncoming;
  }
  // 尾字符非空白才补空格：连续多句 final 顺序拼接，不产生连续空格，
  // 也不在用户以标点/空白收尾的正文后再补空格。
  if (/\s/u.test(existing.slice(-1))) {
    return `${existing}${trimmedIncoming}`;
  }
  return `${existing} ${trimmedIncoming}`;
}
