import type { SessionStorePort } from "@drora/contracts";
import {
  TEAM_HISTORY_PAGE_DEFAULT,
  TEAM_HISTORY_QUERY,
  TEAM_HISTORY_UNAVAILABLE,
  TEAM_LIMITS,
  teamHistoryEntrySchema,
  teamHistoryQuerySchema,
  type TeamHistoryEntry,
  type TeamHistoryQuery,
  type TeamHistoryResult,
} from "@drora/shared/drora-protocol-v4";
import {
  parseTeamJournalEntries,
  TEAM_JOURNAL_ENTRY_TYPE,
  type TeamJournalEvent,
} from "./journal.js";

/** journal 是唯一历史来源；不把读取失败转换成“没有发生过”。 */
export async function readTeamHistoryPage(
  input: TeamHistoryQuery & {
    sessionStore: Pick<SessionStorePort, "sessionEntries"> | undefined;
    sessionId: string;
  },
): Promise<TeamHistoryResult> {
  const query = teamHistoryQuerySchema.parse({
    teamId: input.teamId,
    beforeSeq: input.beforeSeq,
    throughSeq: input.throughSeq,
    limit: input.limit,
  });
  if (!input.sessionStore?.sessionEntries) {
    throw Object.assign(new Error("Team history persistence is unavailable"), {
      reasonCode: TEAM_HISTORY_UNAVAILABLE,
    });
  }
  const entries = await input.sessionStore.sessionEntries({
    sessionID: input.sessionId as never,
    type: TEAM_JOURNAL_ENTRY_TYPE,
  });
  const parsed = parseTeamJournalEntries(entries ?? []);
  let skippedEntries = (entries?.length ?? 0) - parsed.length;
  const unique = new Map<number, TeamJournalEvent>();
  for (const event of parsed) {
    if (event.payload.teamId !== query.teamId) continue;
    if (!Number.isSafeInteger(event.seq) || event.seq <= 0 || unique.has(event.seq)) {
      skippedEntries++;
      continue;
    }
    unique.set(event.seq, event);
  }
  const ordered = [...unique.values()].sort((a, b) => a.seq - b.seq);
  const throughSeq = query.throughSeq ?? ordered.at(-1)?.seq ?? 0;
  const bounded = ordered.filter((event) => event.seq <= throughSeq);
  const delivered = new Set(
    bounded.flatMap((event) => {
      if (event.payload.kind !== "message_delivered") return [];
      // 中文依据：损坏的回执只能计入跳过数，不能先被用来推导别的消息“已送达”。
      const receipt = teamHistoryEntrySchema.safeParse({
        seq: event.seq,
        at: event.at,
        kind: event.payload.kind,
        messageIds: event.payload.messageIds,
      });
      return receipt.success ? (receipt.data.messageIds ?? []) : [];
    }),
  );
  const events: TeamHistoryEntry[] = [];
  for (const event of bounded) {
    const result = teamHistoryEntrySchema.safeParse(historyFact(event, delivered));
    if (result.success) events.push(result.data);
    else skippedEntries++;
  }
  const candidates = events.filter(
    (event) => query.beforeSeq === undefined || event.seq < query.beforeSeq,
  );
  const limit = query.limit ?? TEAM_HISTORY_PAGE_DEFAULT;
  const page = candidates.slice(-limit);
  return {
    type: TEAM_HISTORY_QUERY,
    teamId: query.teamId,
    events: page,
    throughSeq,
    ...(candidates.length > page.length ? { nextBeforeSeq: page[0]!.seq } : {}),
    ...(bounded.at(-1) ? { savedAt: bounded.at(-1)!.at } : {}),
    skippedEntries,
  };
}

function historyFact(event: TeamJournalEvent, delivered: ReadonlySet<string>): unknown {
  const p = event.payload;
  const base = { seq: event.seq, at: event.at, kind: p.kind };
  switch (p.kind) {
    case "task_created":
    case "task_updated":
      return {
        ...base,
        taskId: p.task?.taskId,
        title:
          typeof p.task?.title === "string"
            ? p.task.title.slice(0, TEAM_LIMITS.maxSummaryChars)
            : undefined,
        taskStatus: p.task?.status,
        assignee: p.task?.assignee,
      };
    case "message_appended":
      return {
        ...base,
        messageId: p.entry?.messageId,
        from: p.entry?.from,
        to: p.entry?.to,
        message: p.entry?.message,
        summary: p.entry?.summary,
        sourceTaskId: p.entry?.sourceTaskId,
        sourceAttemptId: p.entry?.sourceAttemptId,
        // 中文依据：append 载荷可能引用后续被更新的邮箱对象；历史上界内只认独立的送达事件。
        delivered: delivered.has(p.entry?.messageId),
      };
    case "message_delivered":
      return { ...base, messageIds: p.messageIds };
    // §21 A1（2026-10-24）：丢弃事实复用 messageIds + reason 载荷——不加本分支会
    // 落到 default 只剩 {seq,at,kind}，被 schema superRefine（要求 messageIds）拒成
    // skippedEntries，事实在历史查询面不可见。
    case "message_dropped":
      return { ...base, messageIds: p.messageIds, reason: p.reason };
    case "member_added":
    case "member_removed":
      return { ...base, memberName: p.memberName };
    case "resumed":
      return { ...base, reason: p.reason };
    // §22 契约 3（2026-10-27 审查 M13 修复）：终态汇报两 kind 载荷仅 teamId，base 已足
    // 过 schema（superRefine 对两 kind 无附加字段要求）。不加显式 case 虽也能落到
    // default 透传，但枚举补齐前的教训是「schema 拒帧静默计入 skippedEntries」——显式
    // 列出这两 kind，superRefine 将来若收紧字段要求（如随行 manager 名）时会在此编译
    // 期暴露，而不是又静默跳过。
    case "final_report_dispatched":
    case "final_report_delivered":
      return base;
    default:
      return base;
  }
}
