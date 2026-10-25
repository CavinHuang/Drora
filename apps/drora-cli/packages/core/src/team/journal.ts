import type { SessionEntryInfo, SessionStorePort, TeamPermissionMode } from "@drora/contracts";
import { TEAM_JOURNAL_KEY_PREFIX } from "@drora/contracts";
import { appendToMailbox, dropMailEntries, isCurrentMail, markDelivered } from "./mailbox.js";
import type { TeamHub } from "./hub.js";
import type { TeamMailboxEntry, TeamRecord, TeamTaskInternal } from "./types.js";

/**
 * team journal 持久化（M3 PR-3.1；specs/agents-team.md §2.2/§2.6/§3.3 + 差异裁决#5）。
 *
 * 裁决#5：journal 只记「用户/协议动作与板/邮箱数据事实」——常规状态迁移（active↔idle）
 * 与成员运行态（working/terminal 边缘）不写 journal，恢复后由事实推导；状态事实只保留
 * halted/resumed/escalated/archived 这类用户/协议裁决结果。
 *
 * 持久化通道（任务卡：经 sessionStore 既有通道）：每个事件 = 一条 SessionEntryInfo，
 * type = TEAM_JOURNAL_KEY_PREFIX + "journal"（键前缀单一出处 contracts team.port.ts）；
 * 写入是同步入队 + 串行异步刷盘（persistMailboxEntry 同款契约——抛错不中断 hub 裁决），
 * 读取按 seq 排序重放，未知/损坏事件跳过并 warn（design §9：不劫持宿主）。
 */

// ---------- 事件载荷（载荷 = 数据事实，非状态迁移指令） ----------

/** staged 草案成员事实（与 TeamStageMemberDraft 同构；agentId 在 spawn 前不存在）。 */
export interface TeamJournalDraftMemberFact {
  memberName: string;
  profile?: string;
  modelSelection?: { provider: string; model: string; thought?: string };
}

/**
 * 任务板事实卡：TeamTaskInternal 剥除交接瞬态（handoffId/reassigning——重启后
 * 在途交接无从静默，重放一律按非在途处理）。attempt/attemptId/recoveryRetried 是
 * 冷恢复单次重试（spec §2.3）的依据，保留。
 */
export type TeamJournalTaskFact = Omit<TeamTaskInternal, "handoffId" | "reassigning">;

/** 剥除交接瞬态（hub 动作点统一经此取事实，避免逐点遗漏）。 */
export function taskJournalFactOf(task: TeamTaskInternal): TeamJournalTaskFact {
  const { handoffId: _handoffId, reassigning: _reassigning, ...fact } = task;
  return fact;
}

export type TeamJournalPayload =
  | {
      kind: "team_created";
      teamId: string;
      leadSessionId: string;
      name?: string;
      permissionMode?: TeamPermissionMode;
      createdAt: string;
    }
  | {
      kind: "staged";
      teamId: string;
      name?: string;
      awaitingFeedback: boolean;
      members: readonly TeamJournalDraftMemberFact[];
      tasks: readonly TeamJournalTaskFact[];
    }
  | { kind: "approved"; teamId: string }
  | {
      kind: "member_added";
      teamId: string;
      memberName: string;
      agentId: string;
      childSessionId: string;
    }
  | { kind: "task_created"; teamId: string; task: TeamJournalTaskFact }
  | { kind: "task_updated"; teamId: string; task: TeamJournalTaskFact }
  | { kind: "message_appended"; teamId: string; entry: TeamMailboxEntry }
  | {
      kind: "message_delivered";
      teamId: string;
      messageIds: readonly string[];
      // lead_injected（2026-10-21 缺口12）：lead 邮箱注入事实（spec §14），与成员
      // steered/resumed 同族 additive 扩展；deliveredVia 不入 wire 投影。
      via: "steered" | "resumed" | "lead_injected";
      at: string;
    }
  // §21 A1（2026-10-24 登记）：lead 邮箱投递通道判定「永久不可投」（发件人离册/
  // childSessionId 缺席）的条目丢弃事实——载荷复用 messageIds + reason（与
  // teamHistoryEntrySchema 既有字段同构，零新增字段词表）。重放语义=等同丢弃：
  // 该 messageId 不进恢复邮箱，按 seq 顺序 message_appended 先入、message_dropped
  // 后清，多次重放幂等。
  | {
      kind: "message_dropped";
      teamId: string;
      messageIds: readonly string[];
      reason: string;
      at: string;
    }
  | { kind: "member_removed"; teamId: string; memberName: string }
  | { kind: "halted"; teamId: string }
  | { kind: "resumed"; teamId: string; reason: string }
  // escalated（M5 自动升级）与 archived（abandonTeamPlan 归档）同为用户/协议裁决
  // 结果的状态事实：不记则恢复后丢失「禁止自动重建/升级待决」语义（spec §2.6）。
  | { kind: "escalated"; teamId: string }
  | { kind: "archived"; teamId: string };

/** 单条 journal 事件（seq 由 sink 单调分配；at = 事实时间，hub clock 供给）。 */
export interface TeamJournalEvent {
  seq: number;
  at: string;
  payload: TeamJournalPayload;
}

/** hub 动作点的写入形态（无 seq；同步入队契约——抛错实现内部兜底，不得中断裁决）。 */
export type TeamJournalEventDraft = Omit<TeamJournalEvent, "seq">;

/** hub 可选依赖 journalWriter 的类型（specs/agents-team.md 差异裁决#5 的写入面）。 */
export type TeamJournalWriter = (event: TeamJournalEventDraft) => void;

/** session entry 通道的 type 键（TEAM_JOURNAL_KEY_PREFIX 是唯一出处，此处只拼接）。 */
export const TEAM_JOURNAL_ENTRY_TYPE = `${TEAM_JOURNAL_KEY_PREFIX}journal`;

/**
 * team 邮箱条目持久化通道的 type 键（E12；specs/agents-team.md §21 A13 B 案裁决）。
 * 写入方 = bootstrap install persistMailboxEntry，读取方 = 冷恢复对账
 * readPersistedMailboxEntries——两侧同引本常量（键前缀单一出处 contracts，AGENTS.md
 * 契约键单一出处；2026-10-24 自 bootstrap install.ts 移入 core，单一出处不变）。
 */
export const TEAM_MAILBOX_ENTRY_TYPE = `${TEAM_JOURNAL_KEY_PREFIX}mailbox`;

// ---------- 写入：同步入队 + 串行异步刷盘 ----------

export interface TeamJournalSessionStoreSink {
  /** 同步入队（含 seq 分配）；刷盘失败只 warn，不向调用方抛。 */
  append(event: TeamJournalEventDraft): void;
  /** 恢复后续写：把下一 seq 对齐到重放末尾（journal 流跨进程单调）。 */
  setNextSeq(seq: number): void;
  lastSeq(): number;
  /** 测试/关停钩子：等待全部排队刷盘完成。 */
  flush(): Promise<void>;
}

export function createTeamJournalSessionStoreSink(input: {
  sessionStore: Pick<SessionStorePort, "saveSessionEntry"> | undefined;
  sessionId: string;
  warn?: (message: string, error?: unknown) => void;
}): TeamJournalSessionStoreSink {
  let nextSeq = 1;
  let chain = Promise.resolve();
  const persist = (event: TeamJournalEvent): void => {
    const store = input.sessionStore;
    if (store === undefined) return; // 无 store（极端装配）= journal 降级为内存态，不阻断裁决
    const timestamp = Date.now();
    const entry: SessionEntryInfo = {
      id: `${input.sessionId}:${TEAM_JOURNAL_ENTRY_TYPE}/${event.seq}`,
      sessionID: input.sessionId as never,
      type: TEAM_JOURNAL_ENTRY_TYPE,
      touchSession: false, // journal 是旁路事实流，不把会话伪装成「刚刚活跃」
      time: { created: timestamp, updated: timestamp },
      data: event,
    };
    chain = chain
      .then(() => store.saveSessionEntry?.(entry))
      .catch((error: unknown) => {
        input.warn?.(
          `team journal entry flush failed (seq=${event.seq}, kind=${event.payload.kind}); ` +
            "continuing: journal loss degrades crash-restore only, runtime state stays correct",
          error,
        );
      });
  };
  return {
    append(event) {
      const full: TeamJournalEvent = { ...event, seq: nextSeq };
      nextSeq += 1;
      persist(full);
    },
    setNextSeq(seq) {
      nextSeq = Math.max(nextSeq, Math.trunc(seq));
    },
    lastSeq() {
      return nextSeq - 1;
    },
    flush() {
      return chain;
    },
  };
}

// ---------- 读取：解析 + 按 seq 稳定排序（未知/损坏跳过） ----------

export function readTeamJournalEvents(input: {
  sessionStore: Pick<SessionStorePort, "sessionEntries"> | undefined;
  sessionId: string;
  warn?: (message: string) => void;
}): Promise<TeamJournalEvent[]> {
  const store = input.sessionStore;
  if (store?.sessionEntries === undefined) return Promise.resolve([]);
  return store
    .sessionEntries({ sessionID: input.sessionId as never, type: TEAM_JOURNAL_ENTRY_TYPE })
    .then((entries) => parseTeamJournalEntries(entries ?? [], input.warn))
    .catch((error: unknown) => {
      input.warn?.(`team journal read failed; restoring as no team (${String(error)})`);
      return [];
    });
}

/**
 * 冷恢复对账读取面（§21 A13 B 案裁决，2026-10-24）：读该会话持久化的
 * team.mailbox 条目（写入通道即 bootstrap persistMailboxEntry）。读法复用
 * sessionEntries({ sessionID, type }) 既有 port API（readTeamJournalEvents 同款），
 **不扩 port 面**。损坏条目跳过 + warn（同 journal 读取面逐条防御语义）；读取
 * 失败按无对账面降级返回 []（对账是恢复增强，不劫持装配）。
 */
export function readPersistedMailboxEntries(input: {
  sessionStore: Pick<SessionStorePort, "sessionEntries"> | undefined;
  sessionId: string;
  warn?: (message: string) => void;
}): Promise<TeamMailboxEntry[]> {
  const store = input.sessionStore;
  if (store?.sessionEntries === undefined) return Promise.resolve([]);
  return store
    .sessionEntries({ sessionID: input.sessionId as never, type: TEAM_MAILBOX_ENTRY_TYPE })
    .then((entries) => {
      const parsed: TeamMailboxEntry[] = [];
      for (const entry of entries ?? []) {
        const data = entry.data as TeamMailboxEntry | undefined;
        if (data === undefined || !isMailboxEntryWellFormed(data)) {
          input.warn?.(`team mailbox entry skipped (malformed): id=${entry.id}`);
          continue;
        }
        parsed.push(data);
      }
      return parsed;
    })
    .catch((error: unknown) => {
      input.warn?.(`team mailbox entries read failed; skipping reconcile (${String(error)})`);
      return [];
    });
}

/** entry.data → 事件（结构守卫；缺失/畸形条目跳过 + warn，不让单条损坏劫持整流）。 */
export function parseTeamJournalEntries(
  entries: readonly SessionEntryInfo[],
  warn?: (message: string) => void,
): TeamJournalEvent[] {
  const events: TeamJournalEvent[] = [];
  for (const entry of entries) {
    const data = entry.data as Partial<TeamJournalEvent> | undefined;
    const kind = (data?.payload as { kind?: unknown } | undefined)?.kind;
    if (
      data === undefined ||
      typeof data.seq !== "number" ||
      !Number.isFinite(data.seq) ||
      typeof data.at !== "string" ||
      data.payload === undefined ||
      typeof data.payload !== "object" ||
      typeof kind !== "string"
    ) {
      warn?.(`team journal entry skipped (malformed): id=${entry.id}`);
      continue;
    }
    if (!isKnownJournalKind(kind)) {
      // 旧版本事件（design §9：未知事件跳过 + warn，不猜测语义）。
      warn?.(`team journal entry skipped (unknown kind "${kind}"): id=${entry.id}`);
      continue;
    }
    events.push({ seq: data.seq, at: data.at, payload: data.payload as TeamJournalPayload });
  }
  // seq 升序稳定排序：同 seq（跨进程竞态窗口）保持 entry 顺序。
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.seq - b.event.seq || a.index - b.index)
    .map((row) => row.event);
}

const KNOWN_JOURNAL_KINDS: readonly TeamJournalPayload["kind"][] = [
  "team_created",
  "staged",
  "approved",
  "member_added",
  "task_created",
  "task_updated",
  "message_appended",
  "message_delivered",
  "message_dropped",
  "member_removed",
  "halted",
  "resumed",
  "escalated",
  "archived",
];

function isKnownJournalKind(kind: string): kind is TeamJournalPayload["kind"] {
  return (KNOWN_JOURNAL_KINDS as readonly string[]).includes(kind);
}

// ---------- 重放：事实 → TeamRecord（纯函数） ----------

const TEAM_PERMISSION_MODES: readonly TeamPermissionMode[] = [
  "build",
  "edit",
  "yolo",
  "guarded",
  "auto",
];

export interface TeamJournalReplayResult {
  /** 重放重建的聚合根；journal 无 team_created 时为 undefined。 */
  record: TeamRecord | undefined;
  /** 见过的最大 seq（含被跳过的事件）——续写 sink.setNextSeq(lastSeq + 1)。 */
  lastSeq: number;
  /**
   * 重放见过的 message_appended messageId **全集**（含其后 delivered/dropped 的；
   * §21 A13 B 案冷恢复对账的「已见」判定依据——dropped 死件经此不复活，
   * team_created 重建 team 时重置）。
   */
  appendedMessageIds: ReadonlySet<string>;
}

/**
 * journal 事件流 → TeamRecord（M3 PR-3.1 恢复语义）：
 * - 花名册含 removed 标记 = 退休拒绝表（被移除成员即已持久退休，永不复活，E6/E11）；
 * - status 由事实推导（spec 差异裁决#5）：halted/escalated/archived 事实保留；
 *   approved 后按「working 成员或未投邮件 = active，否则 idle」推导；未 approved = staged；
 * - 权限模式记录值恢复；不在闭合集的记录值按缺席处理回退（spec §8.1，不猜旧版本不懂的模式）。
 * 畸形载荷的事件整条跳过（warn）——facts 是内部持久化面，逐字段防御重于容错拼接。
 */
export function replayTeamJournal(
  events: readonly TeamJournalEvent[],
  warn?: (message: string) => void,
): TeamJournalReplayResult {
  let record: TeamRecord | undefined;
  let approved = false;
  // 用户/协议裁决的冻结态：halted/escalated/archived 最后一次事实；resumed 解除。
  let frozen: TeamRecord["status"] | undefined;
  let lastSeq = 0;
  let updatedAt: string | undefined;
  // §21 A13 B 案：message_appended 见过的 messageId 全集（team_created 重置）。
  let appendedMessageIds = new Set<string>();

  const restoreTask = (fact: TeamJournalTaskFact): void => {
    const restored: TeamTaskInternal = { ...fact, handoffId: undefined, reassigning: false };
    const index = record?.tasks.findIndex((task) => task.taskId === fact.taskId) ?? -1;
    if (record === undefined) return;
    if (index >= 0) record.tasks[index] = restored;
    else record.tasks.push(restored);
  };

  for (const event of events) {
    lastSeq = Math.max(lastSeq, event.seq);
    updatedAt = event.at;
    const payload = event.payload;
    if (!isPayloadWellFormed(payload)) {
      warn?.(
        `team journal event skipped (malformed payload): seq=${event.seq} kind=${payload.kind}`,
      );
      continue;
    }
    if (payload.kind === "team_created") {
      const permissionMode =
        payload.permissionMode === undefined
          ? undefined
          : isKnownPermissionMode(payload.permissionMode)
            ? payload.permissionMode
            : (warn?.(
                `team journal permission mode "${payload.permissionMode}" unknown; ` +
                  "falling back to the lead session's current mode (spec §8.1, no guessing)",
              ),
              undefined);
      record = {
        teamId: payload.teamId,
        leadSessionId: payload.leadSessionId,
        ...(payload.name === undefined ? {} : { name: payload.name }),
        // 未知模式值按缺席处理（spec §8.1：回退继承 lead 当前模式，不猜语义）。
        ...(permissionMode === undefined ? {} : { permissionMode }),
        status: "staged",
        members: [],
        tasks: [],
        mailbox: [],
        createdAt: payload.createdAt,
        updatedAt: event.at,
      };
      approved = false;
      frozen = undefined;
      // team_created 重建 team：旧 team 的 message 集不参与新 team 对账（§21 A13）。
      appendedMessageIds = new Set<string>();
      record.updatedAt = updatedAt;
      continue;
    }
    if (record === undefined) {
      // 无 team_created 的流首（损坏头）：后续事实无处附着，整流按无 team 处理。
      warn?.(
        `team journal event before team_created skipped: seq=${event.seq} kind=${payload.kind}`,
      );
      continue;
    }
    switch (payload.kind) {
      case "staged": {
        record.name = payload.name;
        // 2026-10-23 空白归一（specs/agents-team.md §19 契约 2④）：legacy 空串
        // profile/空白 thought 事实原样恢复会让烧帧草案在 CLI 重启后复燃——
        // fail-closed 下用户连 abandon 都不可达。重放即归一为键缺席，与
        // hub.stageTeam 物化处同一规范形（§19 契约 2②）。
        record.members = payload.members.map((member) => {
          const profile = member.profile?.trim() === "" ? undefined : member.profile;
          let modelSelection = member.modelSelection;
          if (modelSelection !== undefined && modelSelection.thought?.trim() === "") {
            const { thought: _blankThought, ...rest } = modelSelection;
            modelSelection = rest;
          }
          return {
            agentId: `pending_${member.memberName}`,
            memberName: member.memberName,
            ...(profile === undefined ? {} : { profile }),
            ...(modelSelection === undefined ? {} : { modelSelection }),
            state: "spawning" as const,
            removed: false,
          };
        });
        record.tasks = payload.tasks.map((fact) => ({
          ...fact,
          handoffId: undefined,
          reassigning: false,
        }));
        if (payload.awaitingFeedback === true) record.awaitingFeedback = true;
        else delete record.awaitingFeedback;
        break;
      }
      case "approved": {
        approved = true;
        frozen = undefined;
        delete record.awaitingFeedback;
        break;
      }
      case "member_added": {
        const member = record.members.find(
          (candidate) => candidate.memberName === payload.memberName,
        );
        if (member === undefined) {
          warn?.(`team journal member_added without draft member: ${payload.memberName}`);
          break;
        }
        member.agentId = payload.agentId;
        member.childSessionId = payload.childSessionId;
        break;
      }
      case "task_created":
      case "task_updated":
        restoreTask(payload.task);
        break;
      case "message_appended":
        // 2026-10-21 缺口12（保留期一致性，spec §14）：重放走 appendToMailbox 的
        // 每收件人保留期裁剪（默认限额与 hub 运行态同源）——裸 push 会让重放邮箱
        // 无界增长且与运行态形状不一致（运行态每次入队都裁）。
        // §21 A13 B 案：已见集在裁剪/丢弃**之前**登记（被保留期裁掉的 messageId
        // 也算 journal 已见——它是 hub 正常运行态裁决的结果，非刷盘丢失）。
        appendedMessageIds.add(payload.entry.messageId);
        record.mailbox = appendToMailbox(record.mailbox, payload.entry);
        break;
      case "message_delivered":
        record.mailbox = markDelivered(record.mailbox, payload.messageIds, payload.via, payload.at);
        break;
      case "message_dropped":
        // §21 A1：重放遇丢弃事实等同丢弃（dropMailEntries 幂等——按 seq 顺序
        // message_appended 先入、message_dropped 后清，重复重放终态一致）。
        record.mailbox = dropMailEntries(record.mailbox, payload.messageIds);
        break;
      case "member_removed": {
        const member = record.members.find(
          (candidate) => candidate.memberName === payload.memberName,
        );
        if (member === undefined) break;
        // 退休拒绝表：removed 标记持久化，被移除成员永不接受复活/续聊（E6/E11）。
        member.removed = true;
        member.state = "removed";
        break;
      }
      case "halted":
        record.status = "halted";
        frozen = "halted";
        break;
      case "escalated":
        record.status = "escalated";
        frozen = "escalated";
        break;
      case "archived":
        record.status = "archived";
        frozen = "archived";
        break;
      case "resumed":
        // resumed 解除冻结，状态回到可推导族（最终推导在流末统一做）。
        frozen = undefined;
        record.status = derivedActiveIdle(record);
        break;
    }
    record.updatedAt = updatedAt;
  }

  if (record !== undefined) {
    // 先终态化成员运行态（重放无运行时，一律 terminal），再做 busy 推导——
    // 否则 staged 事实物化的 spawning 占位会被误算成「有 working 成员」。
    finalizeMemberStates(record, approved);
    record.status = frozen ?? (approved ? derivedActiveIdle(record) : "staged");
  }
  return { record, lastSeq, appendedMessageIds };
}

/** 成员运行态不入 journal（差异裁决#5）：重放后统一推导——无运行时的一律 terminal。 */
function finalizeMemberStates(record: TeamRecord, approved: boolean): void {
  if (!approved) return; // staged 草案成员保持 spawning（与 hub.stageTeam 物化形态一致）
  for (const member of record.members) {
    if (member.removed) continue;
    if (!member.agentId.startsWith("pending_")) member.state = "terminal";
  }
}

/** busy 推导（hub.refreshStatus 同一谓词族）：working 成员或未投世代当前邮件 = active。 */
function derivedActiveIdle(record: TeamRecord): TeamRecord["status"] {
  const busy =
    record.members.some(
      (member) => !member.removed && (member.state === "working" || member.state === "spawning"),
    ) ||
    record.mailbox.some((entry) => !entry.deliveredAccepted && isCurrentMail(record.tasks, entry));
  return busy ? "active" : "idle";
}

function isKnownPermissionMode(value: unknown): value is TeamPermissionMode {
  return typeof value === "string" && (TEAM_PERMISSION_MODES as readonly string[]).includes(value);
}

// ---------- 载荷结构守卫（重放逐字段防御；不引入 schema 依赖） ----------

function isPayloadWellFormed(payload: TeamJournalPayload): boolean {
  switch (payload.kind) {
    case "team_created":
      return (
        nonEmpty(payload.teamId) &&
        nonEmpty(payload.leadSessionId) &&
        nonEmpty(payload.createdAt) &&
        (payload.permissionMode === undefined || typeof payload.permissionMode === "string")
      );
    case "staged":
      return (
        nonEmpty(payload.teamId) &&
        Array.isArray(payload.members) &&
        Array.isArray(payload.tasks) &&
        payload.members.every(isDraftMemberFactWellFormed) &&
        payload.tasks.every(isTaskFactWellFormed)
      );
    case "member_added":
      return (
        nonEmpty(payload.memberName) &&
        nonEmpty(payload.agentId) &&
        nonEmpty(payload.childSessionId)
      );
    case "task_created":
    case "task_updated":
      return isTaskFactWellFormed(payload.task);
    case "message_appended":
      return isMailboxEntryWellFormed(payload.entry);
    case "message_delivered":
      return (
        Array.isArray(payload.messageIds) &&
        payload.messageIds.every((id) => typeof id === "string") &&
        (payload.via === "steered" ||
          payload.via === "resumed" ||
          payload.via === "lead_injected") &&
        nonEmpty(payload.at)
      );
    case "message_dropped":
      // §21 A1：与 message_delivered 同款要求 messageIds 在场 + reason/at 非空。
      return (
        Array.isArray(payload.messageIds) &&
        payload.messageIds.every((id) => typeof id === "string") &&
        nonEmpty(payload.reason) &&
        nonEmpty(payload.at)
      );
    case "member_removed":
      return nonEmpty(payload.memberName);
    case "resumed":
      return typeof payload.reason === "string";
    case "approved":
    case "halted":
    case "escalated":
    case "archived":
      return nonEmpty(payload.teamId);
  }
}

function isDraftMemberFactWellFormed(member: TeamJournalDraftMemberFact): boolean {
  return (
    typeof member === "object" &&
    member !== null &&
    nonEmpty(member.memberName) &&
    (member.profile === undefined || typeof member.profile === "string")
  );
}

function isTaskFactWellFormed(task: TeamJournalTaskFact | undefined): boolean {
  return (
    typeof task === "object" &&
    task !== null &&
    nonEmpty(task.taskId) &&
    nonEmpty(task.title) &&
    typeof task.spec === "object" &&
    task.spec !== null &&
    Array.isArray(task.spec.acceptance) &&
    typeof task.attempt === "number" &&
    Array.isArray(task.dependsOn) &&
    Array.isArray(task.artifactRefs) &&
    nonEmpty(task.createdAt) &&
    nonEmpty(task.updatedAt)
  );
}

function isMailboxEntryWellFormed(entry: TeamMailboxEntry | undefined): boolean {
  return (
    typeof entry === "object" &&
    entry !== null &&
    nonEmpty(entry.messageId) &&
    nonEmpty(entry.from) &&
    nonEmpty(entry.to) &&
    typeof entry.message === "string" &&
    nonEmpty(entry.at) &&
    typeof entry.deliveredAccepted === "boolean"
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// ---------- restore 入口（install 随装配调用一次） ----------

export interface TeamJournalRestoreOutcome {
  /** 重放见过的最大 seq；续写 sink.setNextSeq(lastSeq + 1)。 */
  lastSeq: number;
  /** 重建的 record 是否已装入 hub（hub 已有在库记录时不覆盖——装配竞态让位于现役记录）。 */
  adopted: boolean;
  /**
   * 重放见过的 message_appended messageId 全集（§21 A13 B 案冷恢复对账的
   * 「已见」判定依据；adopted=false 时无消费意义，仍原样返回）。
   */
  appendedMessageIds: ReadonlySet<string>;
}

/**
 * lead resume 恢复（M3 PR-3.1）：读 journal → 重放 → hub.adoptRestored。
 * 调用时机约束（登记）：install 内随装配「调用一次」，fire-and-forget；装配完成到
 * 恢复完成之间是竞态窗口（工具/命令会看到「无 team」），窗口内若已创建新 team，
 * 恢复结果让位于现役记录（不覆盖）。失败只 warn，不劫持装配。
 */
export async function restoreAgentsTeamFromJournal(input: {
  hub: TeamHub;
  sessionStore: Pick<SessionStorePort, "sessionEntries"> | undefined;
  sessionId: string;
  warn?: (message: string) => void;
}): Promise<TeamJournalRestoreOutcome | undefined> {
  const events = await readTeamJournalEvents({
    sessionStore: input.sessionStore,
    sessionId: input.sessionId,
    warn: input.warn,
  });
  if (events.length === 0) return undefined;
  const { record, lastSeq, appendedMessageIds } = replayTeamJournal(events, input.warn);
  const adopted = record !== undefined && input.hub.adoptRestored(record);
  return { lastSeq, adopted, appendedMessageIds };
}
