/**
 * Drora Mate 桌宠接缝 wire 形状（specs/drora-personal-assistant.md §11 P3 落地注记；
 * docs/mate-implementation-plan-2026-11-04/03-p3-detailed-design.md §6）。
 *
 * 与 desktopPet.ts 同位的 IPC wire 层：通道字面量在 contracts/assistant.ts
 * `MATE_PET_COMMANDS` 单出处，本文件只放 zod schema 与类型（照 desktopPet.ts 先例：
 * 渲染帧与命令进出 Main 前必须 safeParse）。投影是快照的有界精简投影——工单事实仍以
 * IAssistantTicketService 快照为唯一事实源，本投影只服务宠物窗 badge/tray 速览呈现。
 */

import { z } from "zod";
import {
  ASSISTANT_PERMISSION_TIERS,
  ASSISTANT_SOURCE_KINDS,
  MATE_PET_PROJECTION_LIMITS,
} from "./contracts/assistant.js";

const boundedText = z.string().max(MATE_PET_PROJECTION_LIMITS.textMax);

/**
 * 速览可透传的建议档（spec §11 tray 放行同参注记）：build/guarded 二值——yolo 不入
 * 投影（速览放行禁止以 yolo 执行，与面板 approveTier 预填同规则），建议缺席=回落
 * build（decide 执行体缺省）。
 */
const suggestedTierSchema = z.enum([
  ASSISTANT_PERMISSION_TIERS.build,
  ASSISTANT_PERMISSION_TIERS.guarded,
]);

/** 速览待决策卡精简行（放行/忽略所需最小集：decisionId + 原文首行 + 来源 + 身份 + 建议档）。 */
export const matePetPendingDecisionSchema = z
  .object({
    decisionId: z.number().int().positive(),
    /** 决策卡原文首行截断（verbatim，不静默改写——spec §2.4）。 */
    text: boundedText,
    sourceKind: z.enum([
      ASSISTANT_SOURCE_KINDS.local,
      ASSISTANT_SOURCE_KINDS.feishu,
      ASSISTANT_SOURCE_KINDS.phone,
      ASSISTANT_SOURCE_KINDS.github,
    ]),
    identity: z.string().min(1).max(160),
    /** Router 建议档（可选；速览行展示+decide 预填放行档——与面板放行同参）。 */
    suggestedTier: suggestedTierSchema.optional(),
  })
  .strict();
export type MatePetPendingDecision = z.infer<typeof matePetPendingDecisionSchema>;

/** 速览进行中工单行（queued/dispatched/running/awaiting；点击直达工单详情）。
 * awaiting（P4 第二棒，04 详设 §3）：工件核验滞留态——只加不破，旧宠物窗未知值
 * 按 fallback 文案呈现（desktopPetMateTrayDom.matePetStatusLabel 既有兜底分支）。 */
export const matePetActiveTicketSchema = z
  .object({
    ticketId: z.string().min(1).max(160),
    status: z.enum(["queued", "dispatched", "running", "awaiting"]),
    brief: boundedText,
    targetWorkspaceIdentity: z.string().max(160),
  })
  .strict();
export type MatePetActiveTicket = z.infer<typeof matePetActiveTicketSchema>;

/** 最新汇报一条（done/failed 终态；气泡与速览最新汇报行共用）。 */
export const matePetLatestReportSchema = z
  .object({
    ticketId: z.string().min(1).max(160),
    status: z.enum(["done", "failed"]),
    /** 一句话摘要（output_summary/fail_reason 首行截断）。 */
    summary: boundedText,
    targetWorkspaceIdentity: z.string().max(160),
    /** 汇报时刻（工单 updated_ms；气泡「新汇报」判定键的一半）。 */
    updatedAtMs: z.number().finite().nonnegative(),
  })
  .strict();
export type MatePetLatestReport = z.infer<typeof matePetLatestReportSchema>;

/** 桌宠接缝投影（快照的有界精简投影；Main 只转发，不持有工单事实）。 */
export const matePetProjectionSchema = z
  .object({
    pendingDecisions: z.array(matePetPendingDecisionSchema).max(MATE_PET_PROJECTION_LIMITS.pendingMax),
    activeTickets: z.array(matePetActiveTicketSchema).max(MATE_PET_PROJECTION_LIMITS.activeMax),
    latestReport: matePetLatestReportSchema.nullable(),
    /**
     * 本帧新汇报气泡（发布方 renderer 按上一登记键差分判定；判定纯函数在 ui
     * mate/petProjection.deriveMatePetBubble 单测锁定）。null=不弹；宠物窗只做展示
     * 与自动隐藏（呈现节流，不承担同步语义）。
     */
    bubble: matePetLatestReportSchema.nullable(),
  })
  .strict();
export type MatePetProjection = z.infer<typeof matePetProjectionSchema>;

/** 空「全收起」投影（模块级常量：发布方空闲态回退需稳定引用）。 */
export const EMPTY_MATE_PET_PROJECTION: MatePetProjection = {
  pendingDecisions: [],
  activeTickets: [],
  latestReport: null,
  bubble: null,
};

/** Pet/Tray → Main 命令（速览点卡/放行忽略；dismiss-bubble 是宠物窗局部态不过 IPC）。 */
export const matePetCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open-ticket"),
    ticketId: z.string().min(1).max(160),
    targetWorkspaceIdentity: z.string().max(160).optional(),
  }),
  z.object({
    action: z.literal("decide"),
    decisionId: z.number().int().positive(),
    choice: z.enum(["approve", "ignore"]),
  }),
]);
export type MatePetCommand = z.infer<typeof matePetCommandSchema>;

/** Main → Renderer 导航端口事件（菜单「打开大副」/tray 点卡/decide 转发共用）。 */
export const matePetRendererEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open-mate") }),
  z.object({
    kind: z.literal("open-ticket"),
    ticketId: z.string().min(1).max(160),
    targetWorkspaceIdentity: z.string().max(160).optional(),
  }),
  z.object({
    kind: z.literal("decide"),
    decisionId: z.number().int().positive(),
    choice: z.enum(["approve", "ignore"]),
    /**
     * 放行档预填（可选；Main 从已校验投影按 decisionId 查出——宠物窗命令 payload
     * 不扩，不可信面最小化）。缺席=renderer 回落 build（与面板放行同参，spec §11）。
     */
    suggestedTier: suggestedTierSchema.optional(),
  }),
]);
export type MatePetRendererEvent = z.infer<typeof matePetRendererEventSchema>;
