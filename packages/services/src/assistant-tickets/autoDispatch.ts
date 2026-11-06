/**
 * auto 模式自动建票（04 详设 §2 P4 落地注记；spec §6 auto 行）。
 *
 * 与人工放行（approveDecision → postApproval）同一事务形状：mandate+ticket+
 * dispatch_intent 同事务落库，放行形态（Mode A/C、权限档）落 dispatch_intent——
 * 排队/释放语义完全复用（queued FIFO 释放按落库形态重放派发，spec §9）。
 * 与人工路径的三点差异（诚实留痕）：
 *   1. decision.outcome 记 auto_notice（告知卡），decided_by 恒 gate——不进放行率
 *      统计（releaseCount 口径=decision_card+user，单一口径不被污染）；
 *   2. brief=触发原文 verbatim（无人工追加段；spec §2.4 不改写）；
 *   3. 前置探测（workspace/attach 目标）由调用方完成——失败不消费决策卡（留在
 *      decision_card 问人），不猜测目标。
 *
 * 纯模块：无 IO（raw 连接由调用方传入；探测/派发编排归服务闭包）。
 */
import {
  ASSISTANT_ERROR_CODES,
  ASSISTANT_MODES,
  ASSISTANT_OUTCOMES,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_TICKET_STATUSES,
  createUuid,
  type AssistantOutcome,
  type AssistantPermissionTier,
} from "@drora/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { AssistantDatabase, AssistantDatabaseRaw } from "./assistantDatabase.js";
import { serializeDispatchIntent } from "./dispatchIntent.js";
import type { AdmissionGateVerdict } from "./admissionGate.js";
import type { WorkspaceProbe } from "./writeDomain.js";
import { getAssistantPorts } from "./assistantPorts.js";
import { resolveAnchorVerdict } from "./incarnation.js";
import { runPostApproval } from "./postApproval.js";
import type { AssistantResult } from "./assistantTickets.js";

const logger = createServiceLogger("assistant-tickets");

/**
 * auto 门裁决（gate 事务**之前**调用；04 详设 §2 落地注记）：
 * - explicit（verdict.outcome=auto_notice）带目标且探测通过 → 维持 autoNotice（同事务
 *   建票直派）；无目标 / 探测失败 / 探测端口缺席且目标为空 → 降级 decision_card
 *   （reason_code 诚实留痕），进候选卡循环问人（Router 可补目标建议）。
 * - 探测端口缺席（P1 形态）且带目标 → 跳过探测按 workspace 域派发（approveDecision
 *   同口径：未隔离明示）。
 * 纯编排：探测闭包注入；本函数不发 IO（除注入的 probe）。
 */
export async function resolveAssistantAutoGateOutcome(input: {
  readonly verdict: AdmissionGateVerdict;
  readonly targetIdentity: string | null;
  readonly probe: ((identity: string) => Promise<WorkspaceProbe>) | null;
}): Promise<{
  readonly finalOutcome: AssistantOutcome;
  readonly reasonCode?: string;
  readonly autoTargetIdentity: string | null;
}> {
  if (input.verdict.outcome !== ASSISTANT_OUTCOMES.autoNotice) {
    return {
      finalOutcome: input.verdict.outcome,
      ...(input.verdict.reasonCode ? { reasonCode: input.verdict.reasonCode } : {}),
      autoTargetIdentity: null,
    };
  }
  const target = input.targetIdentity?.trim() ?? "";
  if (!target) {
    // 无目标不猜测（spec §8「拒绝猜测，问人」）：降级问人，Router 候选卡可补目标建议。
    return {
      finalOutcome: ASSISTANT_OUTCOMES.decisionCard,
      reasonCode: "auto_missing_target",
      autoTargetIdentity: null,
    };
  }
  if (input.probe) {
    const probe = await input.probe(target);
    if (!probe.ok) {
      // 探测失败不消费（approveDecision 同口径）：决策卡问人，人工可改选目标后重放。
      return {
        finalOutcome: ASSISTANT_OUTCOMES.decisionCard,
        reasonCode: "auto_target_probe_failed",
        autoTargetIdentity: null,
      };
    }
  }
  return { finalOutcome: ASSISTANT_OUTCOMES.autoNotice, autoTargetIdentity: target };
}

/** 自动建票入参（decision 行已存在且未消费；目标已过探测）。 */
export interface AssistantAutoTicketSeed {
  readonly decisionId: number;
  /** 触发原文 verbatim（brief；永不改写）。 */
  readonly triggerText: string;
  readonly targetIdentity: string;
  /** build/guarded（yolo 不经 auto——spec §2.5）；缺省 build。 */
  readonly tier?: Exclude<AssistantPermissionTier, typeof ASSISTANT_PERMISSION_TIERS.yolo>;
  /** attach 建议臂的既有会话（Mode C）；缺席=Mode A 独立会话。 */
  readonly attachSessionId?: string;
  /** 触发的通道绑定（P3 直通续绑；与人工放行同规则从 trigger.channel_ref 回填）。 */
  readonly channelRef?: string | null;
  readonly atMs: number;
}

export interface AssistantAutoTicketCreated {
  readonly ticketId: string;
  readonly mandateId: string;
  readonly targetIdentity: string;
  readonly tier: AssistantPermissionTier;
  readonly attachSessionId?: string;
}

/**
 * 建票事务体（调用方持 db.transaction；与 approveDecision 建票段同列集）。
 * 幂等：decision 已建过票（UNIQUE idx_ticket_decision_id / 事务内查重）→ 返回
 * 已有票（不重派），照 approveDecision 并发兜底纪律。
 */
export function insertAssistantAutoTicket(
  raw: AssistantDatabaseRaw,
  seed: AssistantAutoTicketSeed,
):
  | { readonly kind: "created"; readonly value: AssistantAutoTicketCreated }
  | { readonly kind: "alreadyExisted"; readonly ticketId: string; readonly sessionId: string } {
  const existing = raw
    .prepare("SELECT id, incarnation_current FROM ticket WHERE decision_id = ?")
    .get(seed.decisionId) as
    | { id: string; incarnation_current: string }
    | undefined;
  if (existing) {
    const incarnation = JSON.parse(existing.incarnation_current) as { sessionId?: string };
    return {
      kind: "alreadyExisted",
      ticketId: existing.id,
      sessionId: incarnation.sessionId ?? "",
    };
  }
  const ticketId = `T-${createUuid()}`;
  const mandateId = `M-${createUuid()}`;
  const tier: AssistantPermissionTier = seed.tier ?? ASSISTANT_PERMISSION_TIERS.build;
  const scope = JSON.stringify({
    permissionTier: tier,
    writeDomain: seed.attachSessionId ? "attach" : "workspace",
  });
  raw
    .prepare(
      "INSERT INTO mandate(id, ticket_id, scope, state, created_cause) VALUES (?,?,?,?,'accept')",
    )
    .run(mandateId, ticketId, scope, "active");
  // 派发意图落库（P2 审查修复口径）：auto 执行形态进 dispatch_intent，queued 释放
  // 按落库形态重放——auto 建票不发明第二条释放路径。
  const dispatchIntent = serializeDispatchIntent({
    mode: seed.attachSessionId ? "C" : "A",
    tier,
    ...(seed.attachSessionId ? { attachSessionId: seed.attachSessionId } : {}),
  });
  raw
    .prepare(
      `INSERT INTO ticket(id, mandate_id, decision_id, brief, target_workspace_identity, status,
        incarnation_current, incarnation_generations, usage_accum, dispatch_intent, channel_ref, created_ms, updated_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      ticketId,
      mandateId,
      seed.decisionId,
      seed.triggerText,
      seed.targetIdentity,
      ASSISTANT_TICKET_STATUSES.dispatched,
      JSON.stringify({
        workspaceIdentity: seed.targetIdentity,
        sessionId: null,
        boundAtMs: seed.atMs,
        cause: "dispatched",
        anchorCommandId: null,
        dispatchSeq: 0,
      }),
      "[]",
      "{}",
      dispatchIntent,
      // channel_ref 回填（P3 直通绑定）：与人工放行同规则，由调用方从 trigger 行携带。
      seed.channelRef ?? null,
      seed.atMs,
      seed.atMs,
    );
  // 告知卡落账（诚实留痕）：outcome=auto_notice，decided_by 恒 gate——不计入放行率。
  raw
    .prepare("UPDATE admission_decision SET outcome = ? WHERE id = ? AND outcome = ?")
    .run(
      ASSISTANT_OUTCOMES.autoNotice,
      seed.decisionId,
      ASSISTANT_OUTCOMES.decisionCard,
    );
  return {
    kind: "created",
    value: {
      ticketId,
      mandateId,
      targetIdentity: seed.targetIdentity,
      tier,
      ...(seed.attachSessionId ? { attachSessionId: seed.attachSessionId } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// auto 建票编排（服务闭包拆出——assistantTicketsService ≤800 行纪律，先例：
// routerEvaluation/sourceIngest 拆分）。探测预检 → 事务建票（insertAssistantAutoTicket）
// → runPostApproval（排队/释放/派发语义与人工放行完全复用）；失败不消费决策卡（问人）。
// ---------------------------------------------------------------------------

type DispatchEngine = ReturnType<typeof import("./dispatchEngine.js").createDispatchEngine>;

export interface AssistantAutoDispatchDeps {
  readonly db: AssistantDatabase;
  readonly readConfig: (
    raw: AssistantDatabaseRaw,
  ) => import("./assistantTickets.js").AssistantConfigView;
  readonly engine: DispatchEngine;
  readonly publish: () => void;
  /** decisionId → {ticketId, sessionId} 幂等登记（服务闭包持有，runPostApproval 消费）。 */
  readonly dispatchIndex: Map<number, { ticketId: string; sessionId: string }>;
}

export function createAssistantAutoDispatch(deps: AssistantAutoDispatchDeps): {
  /** Router 建议落账 suggested 后的自动执行臂（auto 模式复核；失败留卡问人）。 */
  handleRouterSuggested(input: { decisionId: number; verdictJson: string }): Promise<void>;
  /** auto 建票编排（explicit 直派与 inferred 建议臂共用；测试直驱）。 */
  autoDispatchDecision(input: {
    decisionId: number;
    kind: "dispatch" | "attach";
    targetIdentity: string;
    suggestedTier?: AssistantPermissionTier;
    attachSessionId?: string;
  }): Promise<AssistantResult<{ ticketId: string; sessionId: string }>>;
  /** 事务外后半程：建票已落库后的 runPostApproval 编排（recordTrigger/Source 直派与
   * sourceIngest dep 共用；排队/释放/W1 语义与人工放行一致）。 */
  dispatchCreatedTicket(input: {
    decisionId: number;
    ticketId: string;
    brief: string;
    targetIdentity: string;
    tier: AssistantPermissionTier;
  }): Promise<AssistantResult<{ ticketId: string; sessionId: string }>>;
} {
  /**
   * Router 建议自动执行（04 详设 §2：inferred→评估必须命中 evidence 引用原文，否则
   * 降级 Tier3 问人）。执行时点复核（gate 与派发之间切回 observe → 不自动执行）。
   * verdictJson 是 router_evaluation 落账的**归一后 RouterDecision 形状**
   * （{kind, arm, evidence}；schema 强校验已在评估落账前完成，routerDecision.ts），
   * 这里做防御式字段读取，不重复跑 schema。
   */
  async function handleRouterSuggested(input: {
    decisionId: number;
    verdictJson: string;
  }): Promise<void> {
    const config = deps.readConfig(deps.db.raw);
    if (config.mode !== ASSISTANT_MODES.auto) return;
    let verdict: {
      kind?: unknown;
      arm?: Record<string, unknown>;
      evidence?: unknown;
    };
    try {
      verdict = JSON.parse(input.verdictJson) as typeof verdict;
    } catch {
      return; // verdict 损坏不猜测（卡留人工）
    }
    // P10b（10 号详设 §3.1/§0 v2.1）：manage 臂永不自动执行——**auto 只自动建票派发**
    // （管理≠自动），管理动作一律留决策卡人工 Y（spec §14 P10 行「auto 模式管理动作
    // 同样必须人工 Y」）。显式排除（不靠下方 dispatch/attach 白名单的隐式遗漏——
    // autonomy suggest 卡不进评估循环是 §2.2.1 同款补强先例）；留 info 供审计。
    if (verdict.kind === "manage") {
      logger.info("assistant-tickets auto 不放行 manage 臂（管理动作必须人工 Y）", {
        decisionId: input.decisionId,
      });
      return;
    }
    if (verdict.kind !== "dispatch" && verdict.kind !== "attach") return;
    // evidence 强约束（04 详设 §2「必须命中 evidence 引用原文」）：空数组不算命中。
    const evidence = Array.isArray(verdict.evidence)
      ? verdict.evidence.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (evidence.length < 1) return;
    // 原文包含校验（2026-11-05 全链审查修复）：zod schema 只校验形状（1-80 字符字符串
    // ≤3 条），「引用原文」此前仅靠路由约言——Router 幻觉产出非原文引文仍可在 auto 下
    // 自动建票。auto 执行门补结构性校验：每条 evidence 须为触发原文子串，任一失配即
    // 不自动执行（决策卡留人工终审，与探测失败/无目标同降级路径）；人工放行不受影响
    // （人自己读卡判断引文真伪）。
    const triggerRow = deps.db.raw
      .prepare(
        "SELECT t.text FROM admission_decision d JOIN trigger t ON t.id = d.trigger_id WHERE d.id = ?",
      )
      .get(input.decisionId) as { text: string } | undefined;
    if (!triggerRow) return;
    if (!evidence.every((quote) => triggerRow.text.includes(quote))) {
      logger.info("assistant-tickets auto 建议未过原文包含校验，留卡问人", {
        decisionId: input.decisionId,
      });
      return;
    }
    const arm = verdict.arm ?? {};
    const targetIdentity =
      typeof arm.targetWorkspaceIdentity === "string" ? arm.targetWorkspaceIdentity : "";
    if (!targetIdentity.trim()) return; // 无目标不猜测（问人）
    const suggestedTier =
      arm.permissionTier === ASSISTANT_PERMISSION_TIERS.build ||
      arm.permissionTier === ASSISTANT_PERMISSION_TIERS.guarded
        ? (arm.permissionTier as AssistantPermissionTier)
        : undefined;
    const attachSessionId =
      verdict.kind === "attach" && typeof arm.sessionId === "string" ? arm.sessionId : undefined;
    if (verdict.kind === "attach" && !attachSessionId) return;
    await autoDispatchDecision({
      decisionId: input.decisionId,
      kind: verdict.kind,
      targetIdentity,
      ...(suggestedTier ? { suggestedTier } : {}),
      ...(attachSessionId ? { attachSessionId } : {}),
    });
  }

  /**
   * auto 建票编排（explicit 直派与 inferred 建议臂共用）：探测预检（失败/已消费→不动
   * 卡，问人）→ 事务建票（insertAssistantAutoTicket，与人工放行列集同形）→
   * runPostApproval → publish。返回值仅供测试观测。
   */
  async function autoDispatchDecision(input: {
    decisionId: number;
    kind: "dispatch" | "attach";
    targetIdentity: string;
    suggestedTier?: AssistantPermissionTier;
    attachSessionId?: string;
  }): Promise<AssistantResult<{ ticketId: string; sessionId: string }>> {
    try {
      const config = deps.readConfig(deps.db.raw);
      if (config.mode !== ASSISTANT_MODES.auto) {
        return {
          ok: false,
          error: {
            code: ASSISTANT_ERROR_CODES.autoLocked,
            reason: "auto 建议执行时模式已切离 auto",
          },
        };
      }
      const decisionRow = deps.db.raw
        .prepare(
          `SELECT d.id, d.outcome, t.text, t.workspace_identity, t.channel_ref
           FROM admission_decision d JOIN trigger t ON t.id = d.trigger_id WHERE d.id = ?`,
        )
        .get(input.decisionId) as
        | {
            id: number;
            outcome: string;
            text: string;
            workspace_identity: string | null;
            channel_ref: string | null;
          }
        | undefined;
      if (!decisionRow) {
        return { ok: false, error: { code: ASSISTANT_ERROR_CODES.decisionNotFound } };
      }
      if (decisionRow.outcome !== ASSISTANT_OUTCOMES.decisionCard) {
        return {
          ok: false,
          error: {
            code: ASSISTANT_ERROR_CODES.decisionNotFound,
            reason: `outcome=${decisionRow.outcome} 不可自动执行`,
          },
        };
      }
      const attachSessionId = input.kind === "attach" ? input.attachSessionId : undefined;
      // 探测预检（approveDecision 同口径）：attach 目标存在/归属；dispatch 目标本地
      // 绝对路径+目录存在。失败不消费决策卡（问人），不建票。
      if (attachSessionId) {
        const probe = await deps.engine.probeAttachTarget({
          targetIdentity: input.targetIdentity,
          sessionId: attachSessionId,
        });
        if (probe.kind !== "ok") {
          return {
            ok: false,
            error: {
              code: ASSISTANT_ERROR_CODES.attachTargetInvalid,
              reason: `auto 附着目标校验失败：${resolveAnchorVerdict(probe).reason}`,
            },
          };
        }
      } else {
        const { workspaceProbe } = getAssistantPorts();
        if (workspaceProbe) {
          const probe = await workspaceProbe(input.targetIdentity);
          if (!probe.ok) {
            return {
              ok: false,
              error: {
                code: ASSISTANT_ERROR_CODES.dispatchRejected,
                reason: `auto 目标 workspace 探测失败，决策卡未消费（问人）：${probe.reason}`,
              },
            };
          }
        }
      }
      const ts = Date.now();
      const created = deps.db.transaction((raw: AssistantDatabaseRaw) =>
        insertAssistantAutoTicket(raw, {
          decisionId: input.decisionId,
          triggerText: decisionRow.text,
          targetIdentity: input.targetIdentity,
          // auto 派发档：建议臂档（build/guarded）缺省 build；yolo 恒不经 auto（spec §2.5）。
          ...(input.suggestedTier && input.suggestedTier !== ASSISTANT_PERMISSION_TIERS.yolo
            ? { tier: input.suggestedTier }
            : {}),
          ...(attachSessionId ? { attachSessionId } : {}),
          channelRef: decisionRow.channel_ref,
          atMs: ts,
        }),
      );
      if (created.kind === "alreadyExisted") {
        return {
          ok: true,
          value: { ticketId: created.ticketId, sessionId: created.sessionId },
        };
      }
      const dispatched = await runPostApproval(
        { engine: deps.engine, publish: deps.publish, dispatchIndex: deps.dispatchIndex },
        {
          ticketId: created.value.ticketId,
          brief: decisionRow.text,
          targetIdentity: created.value.targetIdentity,
          tier: created.value.tier,
        },
        {
          decisionId: input.decisionId,
          ...(attachSessionId ? { attachSessionId } : {}),
          dispatchMode: "A",
          budgetMaxActivePerWorkspace: config.budgetMaxActivePerWorkspace,
        },
      );
      logger.info("assistant-tickets auto 工单建票", {
        decisionId: input.decisionId,
        kind: input.kind,
        ticketId: created.value.ticketId,
        dispatched: dispatched.ok,
      });
      deps.publish();
      return dispatched;
    } catch (error) {
      logger.warn("assistant-tickets auto 建票编排异常", error);
      return {
        ok: false,
        error: { code: ASSISTANT_ERROR_CODES.dispatchRejected, reason: String(error) },
      };
    }
  }

  async function dispatchCreatedTicket(input: {
    decisionId: number;
    ticketId: string;
    brief: string;
    targetIdentity: string;
    tier: AssistantPermissionTier;
  }): Promise<AssistantResult<{ ticketId: string; sessionId: string }>> {
    const config = deps.readConfig(deps.db.raw);
    return runPostApproval(
      { engine: deps.engine, publish: deps.publish, dispatchIndex: deps.dispatchIndex },
      {
        ticketId: input.ticketId,
        brief: input.brief,
        targetIdentity: input.targetIdentity,
        tier: input.tier,
      },
      {
        decisionId: input.decisionId,
        dispatchMode: "A",
        budgetMaxActivePerWorkspace: config.budgetMaxActivePerWorkspace,
      },
    );
  }

  return { handleRouterSuggested, autoDispatchDecision, dispatchCreatedTicket };
}
