/**
 * Source 事件统一入口（03 详设 §1/§5；从 assistantTicketsService 抽出——单文件 ≤800
 * 行纪律，先例：routerEvaluation/dispatchEngine/generationRollover 拆分）。
 *
 * 事件顺序（每个 SourceEvent）：
 *   1. channelRef 命中活动工单（ticket.channel_ref 等值 + 非终态）→ 跳过 gate 直投
 *      incarnation_current 会话（engine.followUp，v4 sendText 同通道；原文即输入，
 *      brief 不追加——spec §8 Tier1）。失配/失败如实报错，不落 gate、不猜测。
 *   2. 否则进 admissionGate：强度=真实规则 mention && allowlist 包含 identity →
 *      explicit，否则 inferred（名单外由 gate 拒绝——消息不能改变权限不变式不变）；
 *      trigger（source_kind/identity/channel_ref/remote_session_id）+ decision 同事务
 *      单一写者落库；决策卡照常进 Router 候选卡循环。
 *
 * P1 recordTrigger 的模拟语义原样保留（本地双按钮=测试工具，master plan §4.1）——
 * 本文件是 P3 起真实 Source 的唯一入口。
 *
 * 纯模块：无 IO（db 连接与 followUp 由服务闭包注入）。
 */

import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_SOURCE_KINDS,
  ASSISTANT_STRENGTHS,
  createUuid,
  type AssistantPermissionTier,
  type AssistantStrength,
} from "@drora/shared";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import {
  AssistantStoreBusyError,
  AssistantStoreMigrationError,
  type AssistantDatabase,
  type AssistantDatabaseRaw,
} from "../assistantDatabase.js";
import { evaluateAdmission } from "../admissionGate.js";
import type { AssistantConfigView, AssistantResult } from "../assistantTickets.js";
import { getAssistantPorts, type AssistantDispatchResult } from "../assistantPorts.js";
import type { RouterEvaluationTrigger } from "../routerEvaluation.js";
import { resolveAssistantAutoGateOutcome, insertAssistantAutoTicket } from "../autoDispatch.js";
import { parseChannelRef, serializeChannelRef } from "./channelRef.js";
import type { MateSourceEvent } from "./contract.js";
import { isSourceEnabled, readSourcesConfig } from "./sourceConfig.js";

const logger = createServiceLogger("assistant-tickets");

function nowMs(): number {
  return Date.now();
}

function fail<T>(
  code: (typeof ASSISTANT_ERROR_CODES)[keyof typeof ASSISTANT_ERROR_CODES],
  reason?: string,
): AssistantResult<T> {
  return { ok: false, error: { code, reason } };
}

export interface AssistantSourceIngestValue {
  /** gate 路径产出 trigger id；直通路径为 null。 */
  readonly triggerId: string | null;
  /** gate 路径的 outcome（决策卡/would-accept/rejected/ignored）；直通路径为 null。 */
  readonly outcome: string | null;
  /** true=channel_ref 命中活动工单，已直投既有会话（未过 gate、未建新票）。 */
  readonly directThrough: boolean;
  readonly ticketId?: string;
  readonly sessionId?: string;
}

export interface AssistantSourceIngestDeps {
  readonly db: AssistantDatabase;
  readonly readConfig: (raw: AssistantDatabaseRaw) => AssistantConfigView;
  readonly publish: () => void;
  /** 决策卡候选卡循环（与 recordTrigger 同一闭包）。 */
  readonly scheduleRouterEvaluation: (input: RouterEvaluationTrigger) => void;
  /** Tier1 直投执行（engine.followUp：锚对账+attachDispatch，busy 排队合法）。 */
  readonly followUp: (input: {
    ticketId: string;
    text: string;
  }) => Promise<AssistantDispatchResult>;
  /** 本机用户 identity（手机 Source 的 host 侧身份——renderer 不可自报）。 */
  readonly localIdentity: string;
  /**
   * P4 auto 直派的后半程（04 详设 §2；事务外编排归服务闭包）：auto 直派建票后的
   * runPostApproval（W1 规划/软预算排队/Mode A 派发）。缺席=auto 建票只落库不派发
   * （P4 前测试形态），诚实降级。
   */
  readonly dispatchCreatedTicket?: (input: {
    decisionId: number;
    ticketId: string;
    brief: string;
    targetIdentity: string;
    tier: AssistantPermissionTier;
  }) => Promise<AssistantDispatchResult>;
}

export function createAssistantSourceIngest(deps: AssistantSourceIngestDeps): {
  ingestSourceEvent(event: MateSourceEvent): Promise<AssistantResult<AssistantSourceIngestValue>>;
  /**
   * 手机 Source 的 channel 可见入口（renderer 可达的唯一 Source 入口）：identity 由
   * host 侧取本机用户（renderer 不可自报 feishu/github 外部身份——防身份伪造），
   * sourceKind 恒 phone（IAssistantTicketService.submitSourceEntry 委托到这里）。
   * 受 phone.enabled 门控（关闭 → sourceDisabled，含直通臂；spec §6 收尾注记）。
   * channelRef 入参=已串接字符串（submitSourceEntry 是 channel 面，不暴露结构类型）。
   */
  submitSourceEntry(input: {
    text: string;
    mention: boolean;
    remoteSessionId?: string;
    channelRef?: string;
    targetWorkspaceIdentity?: string;
    atMs?: number;
  }): Promise<AssistantResult<AssistantSourceIngestValue>>;
} {
  const { db, readConfig, publish } = deps;

  function wrapStoreError<T>(error: unknown): AssistantResult<T> | null {
    if (error instanceof AssistantStoreBusyError) return fail(ASSISTANT_ERROR_CODES.storeBusy);
    if (error instanceof AssistantStoreMigrationError)
      return fail(ASSISTANT_ERROR_CODES.storeMigration, String(error.message));
    return null;
  }

  /**
   * 直通匹配（03 详设 §5）：channel_ref 等值命中活动工单（非终态）→ followUp 直投。
   * 未命中 → undefined（继续 gate 路径）；命中但投递失败 → 如实报错（anchorMismatch/
   * ticketNotFound 等端口错误码透传），**不落 gate 建新票**——同通道重复建票=重复执行
   * 风险，spec §8「另开会话/问人由人工决策承接」。
   */
  async function tryDirectThrough(
    channelRef: string,
    text: string,
  ): Promise<AssistantResult<AssistantSourceIngestValue> | undefined> {
    const row = db.raw
      .prepare(
        `SELECT id, status FROM ticket
         WHERE channel_ref = ? AND status NOT IN ('done', 'failed')
         ORDER BY created_ms DESC LIMIT 1`,
      )
      .get(channelRef) as { id: string; status: string } | undefined;
    if (!row) return undefined;
    const result = await deps.followUp({ ticketId: row.id, text });
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        triggerId: null,
        outcome: null,
        directThrough: true,
        ticketId: result.value.ticketId,
        sessionId: result.value.sessionId,
      },
    };
  }

  /** gate 路径事务：trigger+decision（+ auto 直派建票）同写（单一写者纪律与 recordTrigger 同形）。 */
  function recordSourceTrigger(input: {
    kind: MateSourceEvent["kind"];
    identity: string;
    text: string;
    mention: boolean;
    atMs: number;
    channelRef: string | null;
    remoteSessionId: string | null;
    workspaceIdentity: string | null;
    /** P4 auto 预检计划（resolveAssistantAutoGateOutcome 产物；与事务内 verdict 对齐才采纳）。 */
    autoPlan: {
      finalOutcome: string;
      reasonCode?: string;
      autoTargetIdentity: string | null;
    };
  }): {
    triggerId: string;
    outcome: string;
    decisionId: number;
    autoTicket:
      | { ticketId: string; targetIdentity: string; tier: AssistantPermissionTier }
      | null;
  } {
    return db.transaction((raw) => {
      const config = readConfig(raw);
      // 强度真实规则（03 详设 §1）：mention && 名单内 → explicit；否则 inferred。
      // 名单外 identity 的 explicit 自称不放行（gate 拒绝，消息不能改变权限）。
      const strength: AssistantStrength =
        input.mention && config.allowlist.includes(input.identity)
          ? ASSISTANT_STRENGTHS.explicit
          : ASSISTANT_STRENGTHS.inferred;
      const verdict = evaluateAdmission({ strength, identity: input.identity }, config);
      // P4 auto 预检对账（recordTrigger 同纪律）：预检与事务间模式翻转时以事务内
      // verdict 为准，auto 建票仅在 finalOutcome=auto_notice 且有已探测目标时发生。
      const planMatches = verdict.outcome === input.autoPlan.finalOutcome;
      const finalOutcome = planMatches ? input.autoPlan.finalOutcome : verdict.outcome;
      const reasonCode =
        planMatches && input.autoPlan.finalOutcome !== verdict.outcome
          ? input.autoPlan.reasonCode
          : verdict.reasonCode;
      const triggerId = `T-${createUuid()}`;
      raw
        .prepare(
          `INSERT INTO trigger(id, source_kind, simulated_strength, identity, workspace_identity, text, at_ms, channel_ref, remote_session_id)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          triggerId,
          input.kind,
          strength,
          input.identity,
          input.workspaceIdentity,
          input.text,
          input.atMs,
          input.channelRef,
          input.remoteSessionId,
        );
      const info = raw
        .prepare(
          "INSERT INTO admission_decision(trigger_id, strength, mode, outcome, reason_code, decided_by, decided_ms) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          triggerId,
          verdict.strength,
          config.mode,
          finalOutcome,
          reasonCode ?? null,
          "gate",
          nowMs(),
        );
      const decisionId = Number(info.lastInsertRowid);
      // P4 auto 直派：同事务建票（mandate+ticket+dispatch_intent；与人工放行列集同形）。
      let autoTicket:
        | { ticketId: string; targetIdentity: string; tier: AssistantPermissionTier }
        | null = null;
      if (finalOutcome === ASSISTANT_OUTCOMES.autoNotice && input.autoPlan.autoTargetIdentity) {
        const created = insertAssistantAutoTicket(raw, {
          decisionId,
          triggerText: input.text,
          targetIdentity: input.autoPlan.autoTargetIdentity,
          channelRef: input.channelRef,
          atMs: nowMs(),
        });
        if (created.kind === "created") {
          autoTicket = {
            ticketId: created.value.ticketId,
            targetIdentity: created.value.targetIdentity,
            tier: created.value.tier,
          };
        }
      }
      return { triggerId, outcome: finalOutcome, decisionId, autoTicket };
    });
  }

  async function finalizeGatePath(
    outcome: string,
    triggerId: string,
    decisionId: number,
  ): Promise<AssistantResult<AssistantSourceIngestValue>> {
    if (outcome === ASSISTANT_OUTCOMES.decisionCard) {
      // 候选卡循环（02 §1.3）：与 recordTrigger 同构——fire-and-forget，事件驱动回填建议。
      const triggerRow = db.raw
        .prepare(
          "SELECT id, text, simulated_strength, identity, workspace_identity, at_ms FROM trigger WHERE id = ?",
        )
        .get(triggerId) as
        | {
            id: string;
            text: string;
            simulated_strength: string;
            identity: string;
            workspace_identity: string | null;
            at_ms: number;
          }
        | undefined;
      if (triggerRow) {
        deps.scheduleRouterEvaluation({
          decisionId,
          trigger: {
            id: triggerRow.id,
            text: triggerRow.text,
            strength: triggerRow.simulated_strength,
            identity: triggerRow.identity,
            atMs: triggerRow.at_ms,
            workspaceIdentity: triggerRow.workspace_identity,
          },
        });
      }
    }
    logger.info("assistant-tickets source trigger recorded", { triggerId, outcome });
    publish();
    return { ok: true, value: { triggerId, outcome, directThrough: false } };
  }

  async function ingest(
    event: MateSourceEvent,
    channelRefSerialized?: string | null,
  ): Promise<AssistantResult<AssistantSourceIngestValue>> {
    if (!event.identity.trim() || !event.text.trim()) {
      return fail(ASSISTANT_ERROR_CODES.validationFailed, "Source 事件缺 identity/text");
    }
    try {
      const channelRef =
        channelRefSerialized !== undefined
          ? channelRefSerialized
          : event.channelRef
            ? serializeChannelRef(event.channelRef)
            : null;
      if (event.channelRef && channelRef === null) {
        return fail(ASSISTANT_ERROR_CODES.validationFailed, "channelRef 序列化失败");
      }
      if (channelRef) {
        const direct = await tryDirectThrough(channelRef, event.text);
        if (direct) return direct;
      }
      // P4 auto 预检（04 详设 §2；recordTrigger 同纪律）：探测在 gate 事务外（异步 IO
      // 不进事务）；explicit×auto 带目标且探测通过才直派，否则降级 decision_card 问人。
      const preConfig = readConfig(db.raw);
      const preStrength: AssistantStrength =
        event.mention && preConfig.allowlist.includes(event.identity)
          ? ASSISTANT_STRENGTHS.explicit
          : ASSISTANT_STRENGTHS.inferred;
      const preVerdict = evaluateAdmission(
        { strength: preStrength, identity: event.identity },
        preConfig,
      );
      const autoPlan = await resolveAssistantAutoGateOutcome({
        verdict: preVerdict,
        targetIdentity: event.workspaceIdentity ?? null,
        probe: getAssistantPorts().workspaceProbe,
      });
      const recorded = recordSourceTrigger({
        kind: event.kind,
        identity: event.identity,
        text: event.text,
        mention: event.mention,
        atMs: event.atMs,
        channelRef,
        remoteSessionId: event.remoteSessionId ?? null,
        workspaceIdentity: event.workspaceIdentity ?? null,
        autoPlan,
      });
      if (recorded.autoTicket && deps.dispatchCreatedTicket) {
        // auto 直派后半程：runPostApproval 编排（排队/释放/W1 复用），失败如实返回。
        const dispatched = await deps.dispatchCreatedTicket({
          decisionId: recorded.decisionId,
          ticketId: recorded.autoTicket.ticketId,
          brief: event.text,
          targetIdentity: recorded.autoTicket.targetIdentity,
          tier: recorded.autoTicket.tier,
        });
        if (!dispatched.ok) return dispatched;
      }
      return await finalizeGatePath(recorded.outcome, recorded.triggerId, recorded.decisionId);
    } catch (error) {
      const wrapped = wrapStoreError<AssistantSourceIngestValue>(error);
      if (wrapped) return wrapped;
      throw error;
    }
  }

  return {
    async ingestSourceEvent(event) {
      return ingest(event);
    },

    async submitSourceEntry(input) {
      if (!input.text.trim()) {
        return fail(ASSISTANT_ERROR_CODES.validationFailed, "text 不能为空");
      }
      if (input.channelRef != null && parseChannelRef(input.channelRef) === null) {
        return fail(ASSISTANT_ERROR_CODES.validationFailed, "channelRef 格式非法");
      }
      // phone.enabled 门（spec §6 收尾注记，2026-11-05 修复批）：此前开关只作用于注册表
      // 运行态（emitPhoneInput 桥），本入口直达 ingest 不受门控——「关闭手机 Source」
      // 关不掉手机触发面。修复：入口前置 isSourceEnabled（kv 与注册表 reconcile 同源
      // readSourcesConfig，单一口径），关闭时整入口拒绝（含直通臂——与飞书/GitHub
      // 「Source 停用=事件面全关」语义对齐，不留半开门）。kv 空值=关闭（诚实缺省）。
      const kvGet = (key: string) => {
        const row = db.raw.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
          | { value: string }
          | undefined;
        return row?.value;
      };
      if (!isSourceEnabled(readSourcesConfig(kvGet), ASSISTANT_SOURCE_KINDS.phone)) {
        return fail(
          ASSISTANT_ERROR_CODES.sourceDisabled,
          "手机 Source 未启用（source_config.phone.enabled ≠ true）",
        );
      }
      return ingest(
        {
          kind: ASSISTANT_SOURCE_KINDS.phone,
          identity: deps.localIdentity,
          text: input.text,
          mention: input.mention,
          atMs: input.atMs ?? nowMs(),
          ...(input.remoteSessionId ? { remoteSessionId: input.remoteSessionId } : {}),
          ...(input.targetWorkspaceIdentity
            ? { workspaceIdentity: input.targetWorkspaceIdentity }
            : {}),
        },
        input.channelRef ?? null,
      );
    },
  };
}
