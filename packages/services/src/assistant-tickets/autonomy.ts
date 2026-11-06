/**
 * P9 自主节奏层（Autonomy Loop；docs/mate-implementation-plan-2026-11-04/
 * 09-work-inventory-rhythm.md §2 v2 定案；spec §14 P9）。
 *
 * 心跳唤醒 → 大副自主评估（quiet/report/suggest 三臂）→ 受控出口：
 *   心跳（watchdog cron tick 同源触发，独立 face 入口 fire-and-forget——不进 watchdog
 *   await 链防串行阻塞；kv `autonomy_interval_ms` 缺省 30min 节流、`autonomy_enabled`
 *   总闸缺省 true）
 *   → 组装全域速览（composeLedgerDigest 升级版）
 *   → 直调 router port（自主评估输入=速览+自主约言段，含显式标记「本输入为自主评估」
 *     防与候选卡轮约言互扰；countTowardsRotation=false——不计入轮转计数）
 *   → autonomyVerdictSchema.safeParse（独立 zod——非 routerDecisionSchema 第六臂）
 *   → 三臂出口（§2.2）。
 *
 * 执行归属（v2 钉死，本文件即实现）：
 * - 自主轮**不写 router_evaluation 表**（该表以 decision_id 为主键，自主轮无 decision
 *   ——不挂账）；解析失败=quiet+warn（不落 failed、不进 Tier3 语义）；
 * - **不计入 Router 轮转计数**（ticketsSinceRotation 只数候选卡轮——轮转计数的唯一
 *   写者在装配层 node.ts，经端口字段 countTowardsRotation=false 声明不计数）；
 * - suggest 臂=独立建卡事务（§2.2.1：INSERT trigger source_kind=autonomy +
 *   admission_decision outcome=decision_card decided_by=gate + 同事务 decision 计数 +
 *   建卡即写对象冷却 24h），**不调 scheduleRouterEvaluation**——autonomy 卡不进候选
 *   卡评估循环（P0-1 闭合：auto 模式下无任何自动建票路径）；
 * - report 臂=admitDisturbanceTx(kind=report) 过闸 → 自主通知区（kv
 *   `autonomy_notices`，与 watchdog_notices 同形同界的独立键——watchdog 轮的「判据
 *   解除出清」按 ticket 事实维护， autonomy 条目混写会被下一轮 watchdog 出清，故
 *   单写者分键、快照投影合并，MateDigestCard 既有面呈现）。
 *
 * mode 联动（§2.4）：off=自主循环整体停跳（含评估读——off=大副不下场，含读零执行）；
 * observe/auto=autonomy_enabled 总闸控制（auto 下 suggest 卡不进 auto 放行链）。
 *
 * 防打扰五闸（§2.3）：①配额闸（report 过闸/suggest decision 计数）；②速览指纹去重
 * 24h（hash 输入域=对象集合（workspace/工单 id/会话 id 的排序序列）+状态摘要，排除
 * 一切时刻类字段——否则任何活动都破坏去重）；③建卡即写对象冷却 24h；④否定记忆 48h
 * （用户忽略 autonomy 卡 → 同对象不再 suggest，写入点在服务 ignoreDecision，经
 * writeAutonomyNegationTx）；⑤总闸 autonomy_enabled（缺省 true）+首启告知（首次心跳
 * 产一张一次性告知通知）。
 *
 * 纯模块：db/端口/配额读点由调用方注入；kv 键字面量单出处 autonomyProjection.ts
 * （照 watchdog.ts ASSISTANT_WATCHDOG_KV_KEYS 先例——mate.sqlite 内部键，不涉跨进程
 * 契约；读点/通知区投影件在该拆件——破 assistantSnapshot→autonomy→queryReply→
 * assistantSnapshot 依赖环，架构检查即对账点）。本文件对外 re-export 读点供
 * configActions/测试引用（单向边）。
 */
import { z } from "zod";
import {
  ASSISTANT_AUTONOMY_DEFAULTS,
  ASSISTANT_AUTONOMY_STRENGTH,
  ASSISTANT_DISTURBANCE_KINDS,
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_SNAPSHOT_LIMITS,
  ASSISTANT_SOURCE_KINDS,
  createUuid,
  type AssistantMode,
  type MateWorkInventoryView,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { AssistantDatabase, AssistantDatabaseRaw } from "./assistantDatabase.js";
import { admitAssistantDisturbanceTx } from "./quotaCenter.js";
import { composeLedgerDigest } from "./queryReply.js";
import { readAssistantInventoryView } from "./routerEvaluation.js";
import { extractRouterDecisionJson } from "./routerDecision.js";
import { getAssistantPorts } from "./assistantPorts.js";
import {
  appendAutonomyNoticeTx,
  ASSISTANT_AUTONOMY_KV_KEYS,
  ASSISTANT_AUTONOMY_NOTICE_KINDS,
  ASSISTANT_AUTONOMY_NOTICE_TICKET_ID,
  autonomyKvGet,
  autonomyKvSet,
  readAssistantAutonomyEnabled,
  readAssistantAutonomyIntervalMs,
  readAutonomyMutedUntil,
  writeAutonomyMutedUntilTx,
} from "./autonomyProjection.js";

// 读点 re-export（单向边：本文件 → autonomyProjection；configActions/测试引用面不变）。
export {
  ASSISTANT_AUTONOMY_KV_KEYS,
  readAssistantAutonomyEnabled,
  readAssistantAutonomyIntervalMs,
  readAssistantRhythmView,
} from "./autonomyProjection.js";

const logger = createServiceLogger("assistant-tickets");

// ---------------------------------------------------------------------------
// autonomyVerdictSchema（独立 zod——非 routerDecisionSchema 第六臂：五臂恰现其一的
// refine 与三臂解析互不掺和；wire 语义只在 Router 会话文本，字面量收本文件）
// ---------------------------------------------------------------------------

/** quiet 臂：零动作（大副自主评估的预期绝大多数）。 */
const quietArmSchema = z.object({}).strict();

/** report 臂：一段汇报文本（≤800 字）+ 理由（≤500 字）。 */
const reportArmSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1)
      .max(ASSISTANT_AUTONOMY_DEFAULTS.reportTextMax),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

/** suggest 臂：建卡建议——brief（≤1500 字 verbatim 语义）+ attach|dispatch 建议参数 + 理由。 */
const suggestArmSchema = z
  .object({
    brief: z
      .string()
      .trim()
      .min(1)
      .max(ASSISTANT_AUTONOMY_DEFAULTS.suggestBriefMax),
    kind: z.enum(["dispatch", "attach"]),
    /** dispatch 建议的目标 workspace（attach 建议必带目标+会话）。 */
    targetWorkspaceIdentity: z.string().trim().min(1).max(200).optional(),
    /** attach 建议的既有会话 id（只能取自速览可见会话，禁止编造——约言纪律）。 */
    sessionId: z.string().trim().min(1).max(200).optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const autonomyVerdictSchema = z
  .object({
    quiet: quietArmSchema.optional(),
    report: reportArmSchema.optional(),
    suggest: suggestArmSchema.optional(),
  })
  .strict()
  .refine((value) => [value.quiet, value.report, value.suggest].filter((arm) => arm != null).length === 1, {
    message: "quiet/report/suggest 必须恰现其一",
  });

/** 归一后的自主评估裁决（三臂 tagged union）。 */
export type AutonomyVerdict =
  | { readonly kind: "quiet" }
  | { readonly kind: "report"; readonly text: string; readonly reason: string }
  | {
      readonly kind: "suggest";
      readonly brief: string;
      readonly suggestKind: "dispatch" | "attach";
      readonly targetWorkspaceIdentity: string | null;
      readonly sessionId: string | null;
      readonly reason: string;
    };

export type AutonomyVerdictParseResult =
  | { readonly ok: true; readonly verdict: AutonomyVerdict }
  | { readonly ok: false; readonly reason: string };

/** 严格校验并归一自主裁决；失败臂携带 reason（调用方按 quiet+warn 处置，不重试模型）。 */
export function parseAutonomyVerdict(raw: unknown): AutonomyVerdictParseResult {
  const parsed = autonomyVerdictSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: issue ? `${issue.path.join(".") || "verdict"}: ${issue.message}` : "schema 校验失败",
    };
  }
  const value = parsed.data;
  if (value.report) {
    return { ok: true, verdict: { kind: "report", text: value.report.text, reason: value.report.reason } };
  }
  if (value.suggest) {
    const arm = value.suggest;
    // 臂参数一致性 fail-closed：dispatch 必带目标、attach 必带会话+目标——不命中即
    // 解析失败（=quiet+warn），不猜测收敛。
    if (arm.kind === "dispatch" && !arm.targetWorkspaceIdentity) {
      return { ok: false, reason: "suggest.kind=dispatch 缺 targetWorkspaceIdentity" };
    }
    if (arm.kind === "attach" && (!arm.sessionId || !arm.targetWorkspaceIdentity)) {
      return { ok: false, reason: "suggest.kind=attach 缺 sessionId/targetWorkspaceIdentity" };
    }
    return {
      ok: true,
      verdict: {
        kind: "suggest",
        brief: arm.brief,
        suggestKind: arm.kind,
        targetWorkspaceIdentity: arm.targetWorkspaceIdentity ?? null,
        sessionId: arm.sessionId ?? null,
        reason: arm.reason,
      },
    };
  }
  return { ok: true, verdict: { kind: "quiet" } };
}

/** 便捷封装：文本 → 裁决（提取 + 校验合一；任一步失败即 quiet 臂）。 */
export function parseAutonomyVerdictText(text: string): AutonomyVerdictParseResult {
  const raw = extractRouterDecisionJson(text);
  if (raw === undefined) return { ok: false, reason: "输出不含 JSON 裁决对象" };
  return parseAutonomyVerdict(raw);
}

// ---------------------------------------------------------------------------
// 自主约言与评估输入组装（防互扰：显式标记「本输入为自主评估」——候选卡轮约言是
// 「对候选卡输出决策」，自主轮约言是「对速览输出三臂裁决」，同一 Router 会话内两段
// 约言靠标记区分，不靠模型猜）
// ---------------------------------------------------------------------------

/**
 * 自主评估约言段（09 §2.1：输入=速览+自主约言段）。输出 schema 与
 * autonomyVerdictSchema 一一对应——两处同改（本注释即对账点）。纪律：
 * 默认 quiet，只有用户不回应就会损失什么时才开口（09 §4 风险表第一行）。
 */
export function composeAutonomyPreamble(): string {
  return [
    "你是「大副」（Drora Mate）。【本输入为自主评估】——这不是用户请求，也不是候选卡轮：没有候选卡，无需路由决策；这是你按心跳自主观察工作台账后的汇报裁决。",
    "只依据下文台账速览判断，不臆测速览之外的账本内容；你不读代码/文件/日志原文。",
    "输出恰好一个 JSON 对象（可带前后缀说明文字），三臂恰现其一：",
    '{"quiet":{}}——无事可报（默认臂：台账平稳、或任何变化用户自己可见，就不开口）',
    '{"report":{"text":"≤800字汇报","reason":"≤500字开口理由"}}——有用户不回应就会损失的事（停滞/滞留/排队过久/跨项目异常），一句话说清',
    '{"suggest":{"brief":"≤1500字建议任务原文","kind":"dispatch|attach","targetWorkspaceIdentity":"…","sessionId":"…(attach必带)","reason":"≤500字建议理由"}}——建议建一张任务决策卡交人工定夺（你无执行权，卡不自动建票）',
    "quiet 预期占绝大多数；开口必须给出台账速览内的事实依据；suggest 的 attach 臂 sessionId 只能取自速览中出现的会话，禁止编造。",
  ].join("\n");
}

/** 自主评估输入全文（约言 + 速览 + 显式尾标）。 */
export function composeAutonomyInput(digest: string | undefined): string {
  return [
    composeAutonomyPreamble(),
    "【台账速览】（当前事实快照；缺席=空账，不臆测）：",
    digest ?? "（台账为空——无活动工单/待决策/全域会话/闲时任务）",
    "\n请按约言输出 JSON 裁决（本输入为自主评估）。",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// 速览指纹（闸 2）与对象 hash（闸 3/4）
// ---------------------------------------------------------------------------

/**
 * FNV-1a 32 位哈希（十六进制串）。去重/冷却用途——非安全摘要，纯 JS 免 node crypto
 * （autonomy.ts 保持与 watchdog.ts 同级的零额外依赖）。
 */
export function autonomyHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 速览指纹输入域（09 §2.3 闸 2 v2 钉死）：对象集合（workspace/工单 id/会话 id 的
 * 排序序列）+状态摘要，**排除一切时刻类字段**（atMs/updatedAtMs/最近活动时刻——
 * 否则任何活动都破坏去重，去重退化为永久失效）。含：
 * - 工单：id+status（target workspace）排序序列；
 * - 待决策：decision_card×gate 计数；
 * - 台账视图：每 workspace key + 行（kind+实体 id+status/phase）排序序列（视图缺席
 *   =空序列——指纹只认可达事实，与速览组装口径一致）。
 */
export function computeAutonomyFingerprint(
  raw: AssistantDatabaseRaw,
  inventory: MateWorkInventoryView | null,
): string {
  const tickets = (
    raw
      .prepare(
        "SELECT id, status, target_workspace_identity FROM ticket ORDER BY id ASC",
      )
      .all() as Array<{ id: string; status: string; target_workspace_identity: string | null }>
  ).map((row) => `${row.id}|${row.status}|${row.target_workspace_identity ?? ""}`);
  const pending = (
    raw
      .prepare("SELECT COUNT(*) AS n FROM admission_decision WHERE outcome = ? AND decided_by = ?")
      .get(ASSISTANT_OUTCOMES.decisionCard, "gate") as { n: number }
  ).n;
  const inventoryLines = (inventory?.workspaces ?? [])
    .map((workspace) => {
      const rows = workspace.rows
        .map((row) => {
          const id =
            row.kind === "ticket"
              ? row.ticketId
              : row.kind === "session"
                ? row.sessionId
                : row.taskId;
          const state =
            row.kind === "ticket"
              ? row.status
              : row.kind === "session"
                ? row.phase
                : (row.status ?? "");
          return `${row.kind}:${id}:${state}`;
        })
        .sort();
      return `${workspace.key}::{${rows.join(",")}}`;
    })
    .sort();
  return autonomyHash(JSON.stringify({ tickets, pending, inventory: inventoryLines }));
}

/**
 * suggest 建卡的对象 hash（闸 3/4 的冷却键成分）。
 *
 * **对象 hash 提取规则（09 §2.3 闸 2 同源口径，写死在此注释）**：取 suggest 的
 * workspace / sessionId / brief 三个成分字符串（缺省成分记空串），按字典序排序后
 * 以 \u0000 连接再哈希——排序使同对象不同字段顺序（模型输出抖动）仍命中同一冷却键。
 * brief 取 trim 后原文（verbatim 语义，不归一化大小写/空白内串——同对象重复 suggest
 * 的 brief 由模型稳定产出，轻微措辞差异视为新对象是保守语义：宁可多问一次，不静默
 * 丢建议）。闸 4（否定记忆）的再计算：trigger 行只留 workspace_identity+text，
 * sessionId 成分经 kv `autonomy_object:<triggerId>` 登记回取（建卡同事务写入，
 * writeAutonomyNegationTx 是唯一消费方）。
 */
export function computeAutonomyObjectHash(input: {
  readonly targetWorkspaceIdentity: string | null;
  readonly sessionId: string | null;
  readonly brief: string;
}): string {
  const parts = [
    input.targetWorkspaceIdentity ?? "",
    input.sessionId ?? "",
    input.brief.trim(),
  ].sort();
  return autonomyHash(parts.join("\u0000"));
}

// ---------------------------------------------------------------------------
// suggest 独立建卡事务（09 §2.2.1）与否定记忆（闸 4）
// ---------------------------------------------------------------------------

export interface AutonomySuggestCardInput {
  readonly brief: string;
  readonly targetWorkspaceIdentity: string | null;
  readonly sessionId: string | null;
  readonly mode: AssistantMode;
  readonly localIdentity: string;
  readonly objectHash: string;
  readonly atMs: number;
  /** decision 类配额计数的配额值（判定臂永不抑制，值无判定效果——照 triggerRecord 纪律）。 */
  readonly quota: number;
}

/**
 * suggest 独立建卡事务（09 §2.2.1 v2 全新，P0/P1 闭合核心；事务顺序）：
 *   INSERT trigger(source_kind='autonomy', simulated_strength='autonomous',
 *                  identity=localIdentity, text=brief, at_ms=now)
 *   → INSERT admission_decision(strength='autonomous', mode=当前模式,
 *                  outcome=decision_card, decided_by='gate')
 *   → admitAssistantDisturbanceTx(kind=decision)   // 同事务计数（recordTrigger 同款）
 *   → kv autonomy_muted:<对象hash> = now + 24h      // 建卡即写冷却（闸 3）
 *   → kv autonomy_object:<triggerId> = hash         // 闸 4 否定记忆的再计算锚点
 * **不调 scheduleRouterEvaluation**（调用方编排纪律）——autonomy 卡不进候选卡评估
 * 循环：无 router_evaluation 行、无 onSuggested 钩子路径，auto 模式无任何自动建票
 * 路径（卡上 routerState 天然缺席=无建议区，人工终审照常）。
 */
export function insertAutonomySuggestCardTx(
  raw: AssistantDatabaseRaw,
  input: AutonomySuggestCardInput,
): { triggerId: string; decisionId: number } {
  // id 形态与 recordTrigger 同款（T-<uuid>；createUuid 是 shared 单出处）。
  const triggerId = `T-${createUuid()}`;
  raw
    .prepare(
      "INSERT INTO trigger(id, source_kind, simulated_strength, identity, workspace_identity, text, at_ms) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      triggerId,
      ASSISTANT_SOURCE_KINDS.autonomy,
      ASSISTANT_AUTONOMY_STRENGTH,
      input.localIdentity,
      input.targetWorkspaceIdentity,
      input.brief,
      input.atMs,
    );
  const info = raw
    .prepare(
      "INSERT INTO admission_decision(trigger_id, strength, mode, outcome, reason_code, decided_by, decided_ms) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      triggerId,
      ASSISTANT_AUTONOMY_STRENGTH,
      input.mode,
      ASSISTANT_OUTCOMES.decisionCard,
      "autonomy_suggest",
      "gate",
      input.atMs,
    );
  const decisionId = Number(info.lastInsertRowid);
  // decision 类配额计数（同事务；永不抑制——安全优先于安静，照 triggerRecord 同款）。
  admitAssistantDisturbanceTx(raw, {
    kind: ASSISTANT_DISTURBANCE_KINDS.decision,
    atMs: input.atMs,
    quota: input.quota,
  });
  // 闸 3：建卡即写对象冷却（不依赖用户先忽略）。
  writeAutonomyMutedUntilTx(
    raw,
    input.objectHash,
    input.atMs + ASSISTANT_AUTONOMY_DEFAULTS.mutedCooldownMs,
    input.atMs,
  );
  // 闸 4 锚点：对象 hash 登记（用户忽略时 writeAutonomyNegationTx 经 triggerId 取回）。
  autonomyKvSet(
    raw,
    `${ASSISTANT_AUTONOMY_KV_KEYS.objectHashPrefix}${triggerId}`,
    input.objectHash,
    input.atMs,
  );
  return { triggerId, decisionId };
}

/**
 * 否定记忆写入（闸 4；服务 ignoreDecision 的事务内调用）：trigger source_kind=autonomy
 * 的卡被用户忽略 → 同对象 48h 不再 suggest。对象 hash 经 autonomy_object:<triggerId>
 * 登记回取（computeAutonomyObjectHash 注释即规则出处；登记缺席=无法定位对象——
 * 不猜全库扫描，冷却不写，warn 由调用方记）。
 */
export function writeAutonomyNegationTx(
  raw: AssistantDatabaseRaw,
  triggerId: string,
  nowMs: number,
): string | null {
  const sourceKind = (
    raw.prepare("SELECT source_kind FROM trigger WHERE id = ?").get(triggerId) as
    | { source_kind: string }
    | undefined
  )?.source_kind;
  if (sourceKind !== ASSISTANT_SOURCE_KINDS.autonomy) return null;
  const hash = autonomyKvGet(raw, `${ASSISTANT_AUTONOMY_KV_KEYS.objectHashPrefix}${triggerId}`);
  if (hash === undefined) return null;
  writeAutonomyMutedUntilTx(
    raw,
    hash,
    nowMs + ASSISTANT_AUTONOMY_DEFAULTS.negationCooldownMs,
    nowMs,
  );
  // 登记消费完即清（冷却键本身接管后续判定；防 triggerId→hash 行无界滞留）。
  raw.prepare("DELETE FROM kv WHERE key = ?").run(`${ASSISTANT_AUTONOMY_KV_KEYS.objectHashPrefix}${triggerId}`);
  return hash;
}

// ---------------------------------------------------------------------------
// 一轮自主评估（host face 入口 runAutonomyRound 的实现件）
// ---------------------------------------------------------------------------

export interface AssistantAutonomyRoundResult {
  /** false=本轮被停跳/未到轮（off/总闸关/节流/指纹未变/router 缺席），零动作。 */
  ran: boolean;
  readonly atMs: number;
  /** 停跳原因（ran=false 时可读；观测/测试用）。 */
  readonly skipReason?: "off" | "disabled" | "throttled" | "fingerprint" | "router_absent";
  /** ran=true 时：本轮出口臂（parse_failed=解析失败按 quiet 语义）。 */
  readonly arm?: "quiet" | "report" | "suggest" | "parse_failed";
  /** suggest 臂建卡的 decisionId（muted 冷却跳过/其余臂缺席）。 */
  readonly decisionId?: number;
  /** suggest 臂被对象冷却拦下（闸 3 生效）。 */
  readonly mutedSkipped?: boolean;
  /** report 臂是否过闸入通知区（false=超额聚合次日摘要）。 */
  readonly noticeAllowed?: boolean;
}

export interface AssistantAutonomyDeps {
  readonly db: AssistantDatabase;
  /** 本机用户 identity（autonomy trigger 的 identity）。 */
  readonly localIdentity: string;
  /** 当前模式读取（服务闭包 readConfig；off 停跳判定）。 */
  readonly readMode: () => AssistantMode;
  /** 轮后推送快照（服务闭包的 publish；无变化时不推）。 */
  readonly publish: () => void;
  /**
   * decision 类配额计数的配额值读点（快照投影同口径的闭包缓存值；decision 判定臂
   * 永不抑制，值无判定效果——照 triggerRecord 纪律）。
   */
  readonly readDailyQuotaSnapshot: () => number;
  /**
   * report 臂配额值读点（判定实时读纪律约束 report 抑制臂——照 watchdog 轮先例，
   * 装配层 settings 端口实时读）。
   */
  readonly readDailyQuota: () => Promise<number>;
}

/**
 * 一轮自主评估（到轮判定 → 总闸 → 指纹去重 → 速览组装 → router 直调 → 三臂出口）。
 * 心跳节流/mode 联动在本入口按 kv+config 裁决（kv 改值即时生效、定时器不重启）。
 * 事务顺序：到轮记账+首启告知同事务；report 闸计+通知区同事务；suggest 建卡事务见
 * insertAutonomySuggestCardTx。publish 仅在确有变化时触发（mateActivity 投影去重纪律）。
 */
export async function runAssistantAutonomyRound(
  deps: AssistantAutonomyDeps,
  input: { nowMs?: number } = {},
): Promise<AssistantAutonomyRoundResult> {
  const nowMs = input.nowMs ?? Date.now();
  const kvGet = (key: string) => autonomyKvGet(deps.db.raw, key);

  // mode 联动（§2.4）：off=自主循环整体停跳（含评估读——不读 provider、不调 router、
  // 不写任何 kv 记账；observe/auto 由总闸接管）。
  if (deps.readMode() === ASSISTANT_MODES.off) {
    return { ran: false, atMs: nowMs, skipReason: "off" };
  }
  // 闸 5：总闸（缺省 true）。
  if (!readAssistantAutonomyEnabled(kvGet)) {
    return { ran: false, atMs: nowMs, skipReason: "disabled" };
  }
  // 心跳节流（kv interval 可调，缺省 30min；坏值回落缺省）。
  const intervalMs = readAssistantAutonomyIntervalMs(kvGet);
  const lastRaw = kvGet(ASSISTANT_AUTONOMY_KV_KEYS.lastRoundMs);
  const lastMs = lastRaw !== undefined ? Number(lastRaw) : null;
  if (lastMs !== null && Number.isFinite(lastMs) && nowMs - lastMs < intervalMs) {
    return { ran: false, atMs: nowMs, skipReason: "throttled" };
  }

  // 闸 5 首启告知（一次性）：首次到轮心跳产一条告知通知（一次性——标记 kv 幂等）。
  let firstNoticeWritten = false;
  const firstNoticeRaw = kvGet(ASSISTANT_AUTONOMY_KV_KEYS.firstNoticeMs);
  if (firstNoticeRaw === undefined) {
    appendAutonomyNoticeTx(
      deps.db.raw,
      {
        ticketId: ASSISTANT_AUTONOMY_NOTICE_TICKET_ID,
        kind: ASSISTANT_AUTONOMY_NOTICE_KINDS.firstNotice,
        summary: "自主观察已开启——大副将按节奏自主评估工作台账，可随时在设置关闭。",
        atMs: nowMs,
      },
      nowMs,
    );
    autonomyKvSet(deps.db.raw, ASSISTANT_AUTONOMY_KV_KEYS.firstNoticeMs, String(nowMs), nowMs);
    firstNoticeWritten = true;
  }

  // 闸 2：速览指纹去重 24h（输入域见 computeAutonomyFingerprint 注释）——同指纹窗口
  // 内零 LLM 调用直接 quiet。到轮记账与指纹写同事务（先记账后评估：评估异常时本轮
  // 仍被节流，下一 tick 重试由 interval 界定节奏——与 watchdog 记账时序同形）。
  const inventory = readAssistantInventoryView();
  const fingerprint = computeAutonomyFingerprint(deps.db.raw, inventory);
  const fingerprintRaw = kvGet(ASSISTANT_AUTONOMY_KV_KEYS.fingerprint);
  if (fingerprintRaw !== undefined) {
    try {
      const previous = JSON.parse(fingerprintRaw) as { hash?: unknown; atMs?: unknown };
      if (
        previous.hash === fingerprint &&
        typeof previous.atMs === "number" &&
        nowMs - previous.atMs < ASSISTANT_AUTONOMY_DEFAULTS.fingerprintDedupMs
      ) {
        if (firstNoticeWritten) deps.publish();
        return { ran: false, atMs: nowMs, skipReason: "fingerprint" };
      }
    } catch {
      // 坏指纹登记按未登记处理（重评一轮重写覆盖，不猜残余状态）。
    }
  }
  deps.db.transaction((raw: AssistantDatabaseRaw) => {
    autonomyKvSet(raw, ASSISTANT_AUTONOMY_KV_KEYS.lastRoundMs, String(nowMs), nowMs);
    autonomyKvSet(
      raw,
      ASSISTANT_AUTONOMY_KV_KEYS.fingerprint,
      JSON.stringify({ hash: fingerprint, atMs: nowMs }),
      nowMs,
    );
  });

  // router 通道缺席=无自主评估（诚实降级 quiet；与候选卡轮 Tier3 同因不同臂——
  // 自主轮无决策卡可挂，只静默跳过）。
  const router = getAssistantPorts().router;
  if (!router) {
    if (firstNoticeWritten) deps.publish();
    return { ran: false, atMs: nowMs, skipReason: "router_absent" };
  }

  // 组装评估输入：全域速览（composeLedgerDigest 升级版）+ 自主约言段（含互扰标记）。
  const digest = composeLedgerDigest(deps.db.raw, deps.localIdentity, () => nowMs, undefined, inventory);
  const result = await router({ card: composeAutonomyInput(digest), countTowardsRotation: false });
  if (!result.ok) {
    logger.warn("assistant-tickets 自主评估 router 通道失败（本轮 quiet）", { reason: result.reason });
    return { ran: true, atMs: nowMs, arm: "quiet" };
  }
  const parsed = parseAutonomyVerdictText(result.output);
  if (!parsed.ok) {
    // 解析失败=quiet+warn：不落 router_evaluation、不进 Tier3、不计入轮转计数
    // （09 §2.1 执行归属）；指纹已记账——同态势窗口内不重试模型（闸 2 语义延伸）。
    logger.warn("assistant-tickets 自主评估裁决解析失败（按 quiet 处置）", { reason: parsed.reason });
    if (firstNoticeWritten) deps.publish();
    return { ran: true, atMs: nowMs, arm: "parse_failed" };
  }
  const verdict = parsed.verdict;

  if (verdict.kind === "quiet") {
    // 首启告知已落账时也要 publish（quiet 零动作本身不触发推送——通知区需可达）。
    if (firstNoticeWritten) deps.publish();
    return { ran: true, atMs: nowMs, arm: "quiet" };
  }

  if (verdict.kind === "report") {
    // report 臂：配额实时读（判定实时读纪律）→ 同事务过闸+通知区落账。
    const quota = await deps.readDailyQuota();
    const summary = verdict.text.slice(0, ASSISTANT_SNAPSHOT_LIMITS.disturbanceDigestItemMax);
    const allowed = deps.db.transaction((raw: AssistantDatabaseRaw) => {
      const gate = admitAssistantDisturbanceTx(raw, {
        kind: ASSISTANT_DISTURBANCE_KINDS.report,
        summary,
        atMs: nowMs,
        quota,
      });
      if (gate.aggregated) return false;
      appendAutonomyNoticeTx(
        raw,
        {
          ticketId: ASSISTANT_AUTONOMY_NOTICE_TICKET_ID,
          kind: ASSISTANT_AUTONOMY_NOTICE_KINDS.report,
          summary,
          atMs: nowMs,
        },
        nowMs,
      );
      return true;
    });
    if (allowed) {
      logger.info("assistant-tickets 自主评估 report 过闸落通知区", { atMs: nowMs });
    } else {
      logger.info("assistant-tickets 自主评估 report 超额聚合次日摘要", { atMs: nowMs });
    }
    deps.publish();
    return { ran: true, atMs: nowMs, arm: "report", noticeAllowed: allowed };
  }

  // suggest 臂：闸 3 对象冷却 → 独立建卡事务（不进候选卡评估循环）。
  const objectHash = computeAutonomyObjectHash({
    targetWorkspaceIdentity: verdict.targetWorkspaceIdentity,
    sessionId: verdict.sessionId,
    brief: verdict.brief,
  });
  const mutedUntil = readAutonomyMutedUntil(deps.db.raw, objectHash);
  if (mutedUntil !== null && nowMs < mutedUntil) {
    logger.info("assistant-tickets 自主评估 suggest 命中对象冷却（跳过建卡）", { atMs: nowMs });
    return { ran: true, atMs: nowMs, arm: "suggest", mutedSkipped: true };
  }
  const { decisionId } = deps.db.transaction((raw: AssistantDatabaseRaw) =>
    insertAutonomySuggestCardTx(raw, {
      brief: verdict.brief,
      targetWorkspaceIdentity: verdict.targetWorkspaceIdentity,
      sessionId: verdict.sessionId,
      mode: deps.readMode(),
      localIdentity: deps.localIdentity,
      objectHash,
      atMs: nowMs,
      quota: deps.readDailyQuotaSnapshot(),
    }),
  );
  logger.info("assistant-tickets 自主评估 suggest 建卡（人工终审）", { decisionId, atMs: nowMs });
  deps.publish();
  return { ran: true, atMs: nowMs, arm: "suggest", decisionId };
}

// ---------------------------------------------------------------------------
// 服务闭包的 runner 工厂（assistantTicketsService 拆出——单文件 ≤800 行纪律）：
// 依赖注入 + 在途互斥，编排语义与 runAssistantAutonomyRound 注释一致。
// ---------------------------------------------------------------------------

/** 服务侧依赖（照 AssistantWatchdogDeps 注入形态；quota 读点双轨见各字段注释）。 */
export interface AssistantAutonomyRunnerDeps {
  readonly db: AssistantDatabase;
  readonly localIdentity: string;
  /** 当前模式读取（服务闭包 readConfig；off 停跳判定）。 */
  readonly readMode: () => AssistantMode;
  readonly publish: () => void;
  /** decision 类配额计数的闭包缓存值（decision 判定臂永不抑制，值无判定效果）。 */
  readonly readDailyQuotaSnapshot: () => number;
  /** report 臂配额值（判定实时读纪律约束 report 抑制臂——照 watchdog 轮先例）。 */
  readonly readDailyQuota: () => Promise<number>;
}

/**
 * 服务闭包的自主轮入口（host face runAutonomyRound 透传目标）。在途互斥（fire-and-forget
 * 的并发兜底）：kv 节流记账在闸后写入，慢评估在途时下一 tick 的重入可能穿过节流判定
 * ——单服务实例串行化自主轮（router 端口本身在装配层串行链排队，此处避免重复排队
 * 两轮）；重入按 throttled 拒绝（ran=false 零副作用）。
 */
export function createAssistantAutonomyRunner(
  deps: AssistantAutonomyRunnerDeps,
): (input?: { nowMs?: number }) => Promise<AssistantAutonomyRoundResult> {
  let inFlight = false;
  return async (input) => {
    if (inFlight) {
      return { ran: false, atMs: input?.nowMs ?? Date.now(), skipReason: "throttled" };
    }
    inFlight = true;
    try {
      return await runAssistantAutonomyRound(deps, input);
    } finally {
      inFlight = false;
    }
  };
}

/**
 * 决策卡忽略事务（含闸 4 否定记忆钩子；服务 ignoreDecision 的拆件——≤800 行纪律）：
 * decision_card → rejected×user（单一 UPDATE 路径不变）+ autonomy 来源卡命中时同事务
 * 写否定记忆（writeAutonomyNegationTx；非 autonomy 卡返回 null 零副作用）。
 */
export function ignoreAssistantDecisionTx(
  raw: AssistantDatabaseRaw,
  decisionId: number,
  nowMs: number,
): void {
  const decision = raw
    .prepare("SELECT trigger_id FROM admission_decision WHERE id = ? AND outcome = ?")
    .get(decisionId, ASSISTANT_OUTCOMES.decisionCard) as { trigger_id: string } | undefined;
  raw
    .prepare(
      "UPDATE admission_decision SET outcome = ?, decided_by = ? WHERE id = ? AND outcome = ?",
    )
    .run(ASSISTANT_OUTCOMES.rejected, "user", decisionId, ASSISTANT_OUTCOMES.decisionCard);
  if (decision) {
    writeAutonomyNegationTx(raw, decision.trigger_id, nowMs);
  }
}
