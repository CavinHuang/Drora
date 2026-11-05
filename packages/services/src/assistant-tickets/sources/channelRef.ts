/**
 * Source 通道绑定串接与点名匹配纯函数（03 详设 §5：ticket 增 channel_ref 索引；
 * §4：点名=评论正文整词 @大副）。
 *
 * channelRef 串接格式单出处（本文件）：仅 host 侧 mate.sqlite 自产自读（trigger/
 * ticket.channel_ref 列 + 直通等值匹配），不跨进程；组件经 encodeURIComponent 编码，
 * 防止 id 内分隔符造成「feishu:g/a/b/c」式碰撞。
 *
 * 纯模块：无 IO。
 */

import type { MateSourceChannelRef } from "./contract.js";

/** 解析失败（未知 kind/格式/数量）→ null，调用方按无绑定处置（不猜测）。 */
export function serializeChannelRef(ref: MateSourceChannelRef): string | null {
  switch (ref.kind) {
    case "feishu": {
      const chatId = encodeURIComponent(ref.chatId);
      // 群聊绑定线程粒度（03 详设 §2：群聊只认被 @ 的线程）；私聊=会话粒度。
      return ref.threadId
        ? `feishu:g/${chatId}/${encodeURIComponent(ref.threadId)}`
        : `feishu:p/${chatId}`;
    }
    case "github":
      if (!Number.isInteger(ref.issueNumber) || ref.issueNumber <= 0) return null;
      return `github:${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}#${ref.issueNumber}`;
    case "phone":
      return `phone:${encodeURIComponent(ref.remoteSessionId)}`;
    default:
      return null;
  }
}

export function parseChannelRef(value: string): MateSourceChannelRef | null {
  if (value.startsWith("feishu:g/")) {
    const rest = value.slice("feishu:g/".length);
    const split = rest.split("/");
    if (split.length !== 2 || !split[0] || !split[1]) return null;
    const chatId = split[0];
    const threadId = split[1];
    try {
      return {
        kind: "feishu",
        chatId: decodeURIComponent(chatId),
        threadId: decodeURIComponent(threadId),
      };
    } catch {
      return null;
    }
  }
  if (value.startsWith("feishu:p/")) {
    try {
      return { kind: "feishu", chatId: decodeURIComponent(value.slice("feishu:p/".length)) };
    } catch {
      return null;
    }
  }
  if (value.startsWith("github:")) {
    const match = /^github:([^/]+)\/([^#]+)#(\d+)$/u.exec(value);
    // 正则三个捕获组在 exec 命中时必有值；显式收窄满足 noUncheckedIndexedAccess。
    const owner = match?.[1];
    const repo = match?.[2];
    const issueNumber = match?.[3];
    if (!match || !owner || !repo || !issueNumber) return null;
    try {
      return {
        kind: "github",
        owner: decodeURIComponent(owner),
        repo: decodeURIComponent(repo),
        issueNumber: Number(issueNumber),
      };
    } catch {
      return null;
    }
  }
  if (value.startsWith("phone:")) {
    try {
      return { kind: "phone", remoteSessionId: decodeURIComponent(value.slice("phone:".length)) };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 整词 @点名匹配（03 详设 §4）：`@name` 前后不得紧邻字母/数字或另一个 @——
 * 防止 `@大副助手` 误命中 `@大副`、`@leonardo` 误命中 `@leo`、邮箱 `a@name` 误判点名。
 * 词字符用 Unicode 字母/数字属性类（\w 不含 CJK，`@大副助手` 会被误判整词命中——
 * 测试先行发现）；lookbehind/lookahead 均为 Node 原生正则能力；name 经正则转义。
 */
export function matchesWholeWordMention(text: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}@])@${escaped}(?![\\p{L}\\p{N}])`, "u");
  return pattern.test(text);
}
