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
import type { AssistantDispatchResult } from "../assistantPorts.js";
import type { RouterEvaluationTrigger } from "../routerEvaluation.js";
import { parseChannelRef, serializeChannelRef } from "./channelRef.js";
import type { MateSourceEvent } from "./contract.js";

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
}

export function createAssistantSourceIngest(deps: AssistantSourceIngestDeps): {
  ingestSourceEvent(event: MateSourceEvent): Promise<AssistantResult<AssistantSourceIngestValue>>;
  /**
   * 手机 Source 的 channel 可见入口（renderer 可达的唯一 Source 入口）：identity 由
   * host 侧取本机用户（renderer 不可自报 feishu/github 外部身份——防身份伪造），
   * sourceKind 恒 phone（IAssistantTicketService.submitSourceEntry 委托到这里）。
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

  /** gate 路径事务：trigger+decision 同写（单一写者纪律与 recordTrigger 同形）。 */
  function recordSourceTrigger(input: {
    kind: MateSourceEvent["kind"];
    identity: string;
    text: string;
    mention: boolean;
    atMs: number;
    channelRef: string | null;
    remoteSessionId: string | null;
    workspaceIdentity: string | null;
  }): { triggerId: string; outcome: string; decisionId: number } {
    return db.transaction((raw) => {
      const config = readConfig(raw);
      // 强度真实规则（03 详设 §1）：mention && 名单内 → explicit；否则 inferred。
      // 名单外 identity 的 explicit 自称不放行（gate 拒绝，消息不能改变权限）。
      const strength: AssistantStrength =
        input.mention && config.allowlist.includes(input.identity)
          ? ASSISTANT_STRENGTHS.explicit
          : ASSISTANT_STRENGTHS.inferred;
      const verdict = evaluateAdmission({ strength, identity: input.identity }, config);
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
          verdict.outcome,
          verdict.reasonCode ?? null,
          "gate",
          nowMs(),
        );
      return { triggerId, outcome: verdict.outcome, decisionId: Number(info.lastInsertRowid) };
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
      const recorded = recordSourceTrigger({
        kind: event.kind,
        identity: event.identity,
        text: event.text,
        mention: event.mention,
        atMs: event.atMs,
        channelRef,
        remoteSessionId: event.remoteSessionId ?? null,
        workspaceIdentity: event.workspaceIdentity ?? null,
      });
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
