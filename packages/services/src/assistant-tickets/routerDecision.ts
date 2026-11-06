/**
 * Router 决策输出 schema（02 详设 §1.2；S2-T0 结论 (a) 结构化文本路线）。
 *
 * Router（大副会话）按路由约言输出 JSON；host 侧用 zod 严格校验：
 * - 校验失败（不命中 schema）→ 该候选降级 Tier3 决策卡问人（不重试模型、不猜测），
 *   调用方只需看 parseRouterDecision 的 ok 臂；
 * - dispatch/hold/reject/attach/query_status/manage 六臂互斥、恰现其一（attach 为 02 §2
 *   Tier2 扩展；query_status 为 P7 对话式查询直答扩展，08 号详设 §3.1；manage 为 P10b
 *   管理动作面扩展，10 号详设 §3.1——经批准的管理动作，永不 auto 放行）；
 * - evidence 引用原文片段 ≤80 字、至多 3 条（ASSISTANT_SNAPSHOT_LIMITS 单出处）。
 *
 * 纯模块：无 IO、无 await；wire 语义只存在于 Router 会话文本（host 拼装的路由约言
 * 携带 schema 形状），不涉及跨进程契约键，故字面量收在本文件（AGENTS.md 契约键
 * 单一出处的范围是跨进程/跨包字面量）。manage 臂枚举值是跨包契约（services schema/
 * 执行端口/快照投影/UI 呈现同引），引用 contracts ASSISTANT_MANAGE_* 常量。
 */
import { z } from "zod";
import {
  ASSISTANT_MANAGE_ACTIONS,
  ASSISTANT_MANAGE_LIMITS,
  ASSISTANT_MANAGE_TARGET_KINDS,
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_SNAPSHOT_LIMITS,
} from "@drora/shared";

const evidenceItemSchema = z
  .object({
    /** 原文片段引用（≤80 字；Router 只允许引用候选卡原文，禁止改写）。 */
    quote: z
      .string()
      .min(1)
      .max(ASSISTANT_SNAPSHOT_LIMITS.routerEvidenceQuoteMax),
  })
  .strict();

/** Mode A 臂：建新会话独立执行（02 §1.2 dispatch 臂）。 */
const dispatchArmSchema = z
  .object({
    targetWorkspaceIdentity: z.string().trim().min(1).max(200),
    permissionTier: z.enum([
      ASSISTANT_PERMISSION_TIERS.build,
      ASSISTANT_PERMISSION_TIERS.guarded,
    ]),
    briefBase: z.enum(["verbatim", "verbatim+appendix"]),
    appendix: z.string().max(2000).optional(),
    budgetMaxTokens: z.number().int().positive().max(10_000_000).optional(),
  })
  .strict();

/** 保守臂：信息不足暂缓（决策卡保留人工入口）。 */
const holdArmSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

/** 拒绝臂：与工单无关/超范围。 */
const rejectArmSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

/**
 * P7 查询直答臂（08 号详设 §3.1）：进度/状态/成本/摘要类意图 → host 确定性应答器
 * 直答（不建票、不派 worker、不过 Mandate）。Router 只判意图与 scope；答案由 host
 * 从账本模板生成（零 LLM 加工——与账本结构性恒一致）。写意图（停止/切换）不在此臂
 * （约言引导 reject+面板指引）。P8b（09 号详设 §1.6）：新增 "work" scope——全域工作
 * 台账视角（应答器读快照 inventory；缺席回落工单账并注明「仅工单视角」）。
 * P10a（10 号详设 §2.2）：新增 "chat" scope kind（无参形态）——非四 scope 的读意图
 * （闲聊/咨询/泛问题）判定臂；命中后评估循环不走 composeQueryReply，改调 router port
 * 聊天轮入口（同一 Router 会话自由作答；互扰标记+不计轮转，routerEvaluation.ts 分流）。
 */
const queryStatusArmSchema = z
  .object({
    scope: z
      .object({
        kind: z.enum(["status", "ticket", "usage", "digest", "work", "chat"]),
        workspaceIdentity: z.string().trim().max(200).optional(),
        ticketId: z.string().trim().max(200).optional(),
      })
      .strict(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

/** Mode C 臂（02 §2 Tier2 扩展）：附着既有会话；派发桥随后校验存在/归属 identity。 */
const attachArmSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(200),
    targetWorkspaceIdentity: z.string().trim().min(1).max(200),
  })
  .strict();

/**
 * P10b manage 臂（10 号详设 §3.1）：用户管理意图（停掉会话当前回合/取消闲时任务）→
 * 决策卡人工 Y 后经既有 harness 服务面执行（大副零新执行逻辑）。targetRef 只能取自
 * 候选卡【可管理对象】清单（attach 臂同款反编造纪律——约言约束+放行预检 fail-closed
 * 兜底，见 manageActions）。动作族封闭（10 号详设 §3.2）：session↔stop_turn、
 * offpeak_task↔cancel 的合法配对在本 schema superRefine 强校验，交叉组合失配拒绝。
 */
const manageArmSchema = z
  .object({
    targetKind: z.enum([
      ASSISTANT_MANAGE_TARGET_KINDS.session,
      ASSISTANT_MANAGE_TARGET_KINDS.offpeakTask,
    ]),
    targetRef: z.string().trim().min(1).max(200),
    action: z.enum([ASSISTANT_MANAGE_ACTIONS.stopTurn, ASSISTANT_MANAGE_ACTIONS.cancel]),
    reason: z.string().trim().min(1).max(ASSISTANT_MANAGE_LIMITS.reasonMax),
  })
  .strict()
  .superRefine((arm, context) => {
    const valid =
      (arm.targetKind === ASSISTANT_MANAGE_TARGET_KINDS.session &&
        arm.action === ASSISTANT_MANAGE_ACTIONS.stopTurn) ||
      (arm.targetKind === ASSISTANT_MANAGE_TARGET_KINDS.offpeakTask &&
        arm.action === ASSISTANT_MANAGE_ACTIONS.cancel);
    if (!valid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `manage 臂动作与对象失配（${arm.targetKind} 不支持 ${arm.action}）`,
        path: ["action"],
      });
    }
  });

export const routerDecisionSchema = z
  .object({
    dispatch: dispatchArmSchema.optional(),
    hold: holdArmSchema.optional(),
    reject: rejectArmSchema.optional(),
    attach: attachArmSchema.optional(),
    query_status: queryStatusArmSchema.optional(),
    manage: manageArmSchema.optional(),
    evidence: z.array(evidenceItemSchema).max(ASSISTANT_SNAPSHOT_LIMITS.routerEvidenceMax),
  })
  .strict()
  .refine(
    (value) =>
      [
        value.dispatch,
        value.hold,
        value.reject,
        value.attach,
        value.query_status,
        value.manage,
      ].filter((arm) => arm != null).length === 1,
    { message: "dispatch/hold/reject/attach/query_status/manage 必须恰现其一" },
  );

export interface RouterDispatchArm {
  readonly targetWorkspaceIdentity: string;
  readonly permissionTier: (typeof ASSISTANT_PERMISSION_TIERS)[keyof typeof ASSISTANT_PERMISSION_TIERS];
  readonly briefBase: "verbatim" | "verbatim+appendix";
  readonly appendix?: string;
  readonly budgetMaxTokens?: number;
}

export interface RouterAttachArm {
  readonly sessionId: string;
  readonly targetWorkspaceIdentity: string;
}

/** P10b manage 臂归一形状（zod 推断；枚举值=contracts ASSISTANT_MANAGE_* 单出处）。 */
export interface RouterManageArm {
  readonly targetKind:
    | typeof ASSISTANT_MANAGE_TARGET_KINDS.session
    | typeof ASSISTANT_MANAGE_TARGET_KINDS.offpeakTask;
  readonly targetRef: string;
  readonly action: typeof ASSISTANT_MANAGE_ACTIONS.stopTurn | typeof ASSISTANT_MANAGE_ACTIONS.cancel;
  readonly reason: string;
}

/** 归一后的 Router 决策（六臂 tagged union；evidence 原样携带供决策卡预填）。 */
export type RouterDecision =
  | { readonly kind: "dispatch"; readonly arm: RouterDispatchArm; readonly evidence: readonly string[] }
  | { readonly kind: "attach"; readonly arm: RouterAttachArm; readonly evidence: readonly string[] }
  | { readonly kind: "hold"; readonly reason: string; readonly evidence: readonly string[] }
  | { readonly kind: "reject"; readonly reason: string; readonly evidence: readonly string[] }
  | {
      readonly kind: "query_status";
      readonly arm: RouterQueryStatusArm;
      readonly evidence: readonly string[];
    }
  | { readonly kind: "manage"; readonly arm: RouterManageArm; readonly evidence: readonly string[] };
export interface RouterQueryStatusArm {
  readonly scope: {
    /** P10a：含 "chat"（无参形态——workspaceIdentity/ticketId 对 chat 无意义，缺省不携带）。 */
    readonly kind: "status" | "ticket" | "usage" | "digest" | "work" | "chat";
    readonly workspaceIdentity?: string;
    readonly ticketId?: string;
  };
  readonly reason: string;
}

export type RouterDecisionParseResult =
  | { readonly ok: true; readonly decision: RouterDecision }
  | { readonly ok: false; readonly reason: string };

/**
 * 从 Router 会话输出文本提取 JSON 对象（(a) 路线：输出是结构化文本，允许前后缀说明）。
 * 取首个 "{" 到与之配对的 "}"（括号计数，忽略字符串字面量内的括号）；无 JSON 返回 undefined。
 */
export function extractRouterDecisionJson(text: string): unknown | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** 严格校验并归一 Router 决策；失败臂携带 reason（决策卡如实展示，不重试模型）。 */
export function parseRouterDecision(raw: unknown): RouterDecisionParseResult {
  const parsed = routerDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: issue ? `${issue.path.join(".") || "decision"}: ${issue.message}` : "schema 校验失败",
    };
  }
  const value = parsed.data;
  if (value.dispatch) {
    return {
      ok: true,
      decision: {
        kind: "dispatch",
        arm: value.dispatch,
        evidence: value.evidence.map((item) => item.quote),
      },
    };
  }
  if (value.attach) {
    return {
      ok: true,
      decision: {
        kind: "attach",
        arm: value.attach,
        evidence: value.evidence.map((item) => item.quote),
      },
    };
  }
  if (value.manage) {
    return {
      ok: true,
      decision: {
        kind: "manage",
        arm: value.manage,
        evidence: value.evidence.map((item) => item.quote),
      },
    };
  }
  if (value.query_status) {
    return {
      ok: true,
      decision: {
        kind: "query_status",
        arm: value.query_status,
        evidence: value.evidence.map((item) => item.quote),
      },
    };
  }
  if (value.hold) {
    return { ok: true, decision: { kind: "hold", reason: value.hold.reason, evidence: value.evidence.map((item) => item.quote) } };
  }
  return {
    ok: true,
    decision: {
      kind: "reject",
      reason: value.reject?.reason ?? "",
      evidence: value.evidence.map((item) => item.quote),
    },
  };
}

/** 便捷封装：文本 → 决策（提取 + 校验合一；任一步失败即降级臂）。 */
export function parseRouterDecisionText(text: string): RouterDecisionParseResult {
  const raw = extractRouterDecisionJson(text);
  if (raw === undefined) return { ok: false, reason: "输出不含 JSON 决策对象" };
  return parseRouterDecision(raw);
}
