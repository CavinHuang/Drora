/**
 * P1b 有限学习的服务层契约（specs/drora-persona-system.md §5/§8；数据合同
 * docs/design/drora-persona-data-contracts-2026-10-29.md §6「来源、工作与预算」）。
 *
 * 边界：
 * - acceptLearningSource 是合同 §3 标注「内部」的方法：只经进程组合层（persona-system）
 *   绑定的学习通知端口进入，不在 PersonaControlPort 管理面上暴露，外部 UI 不可调用。
 * - 来源角色/origin/边界事实由可信 owner 提供（PM37）；模型只输出语义候选草稿，不得
 *   自报 sourceRole/origin（抽取草稿形状里没有这些字段，独立校验器拒绝未知字段）。
 * - 机会通知进程内 64 待接收上限由学习消费者（learning-coordinator）执行并计数；
 *   DB 非终态 128/authority 由 cli-persona-store 执行。
 * - 预算常量唯一出处是 shared PERSONA_LEARNING_BUDGET；本文件不另设数值。
 */
import type { Logger } from "@drora/contracts";
import {
  PERSONA_LEARNING_BUDGET,
  type PersonaAllowLearningInput,
  type PersonaAllowLearningResult,
  type PersonaLearningOverview,
  type PersonaManagementResult,
} from "@drora/shared";
import type { PersonaLearningExtractionPort } from "./learning-extraction.js";

// ---------------------------------------------------------------------------
// 可信 origin（合同 §6「可信 origin」）：本服务只接受进程组合层绑定的学习通知端口，
// 其来源身份固定为该字面量；模型输出与任何远端声明都不能自报它。
// ---------------------------------------------------------------------------

export const PERSONA_LEARNING_TRUSTED_ORIGIN = "drora-cli-local-runtime";

/** 合格执行许可描述（sourceHandle 的 permissionDescription；E on 的进程内通知固定值）。 */
export const PERSONA_LEARNING_PERMISSION_DESCRIPTION = "runtime-persona-enabled";

// ---------------------------------------------------------------------------
// 消息边界（合同 §6「原始消息边界」）：结构化边界由服务编码为 sourceHandle.messageBoundary
// 定位串（稳定 JSON，无正文）；owner 复验按它定位并核对持久边界。
// ---------------------------------------------------------------------------

export interface PersonaLearningMessageBoundary {
  /** 本轮真实用户消息 ID（窗口起点）。 */
  readonly userMessageId: string;
  /** 本轮成功持久边界的最终 assistant 消息 ID（窗口终点）。 */
  readonly boundaryMessageId: string;
}

export function encodePersonaLearningMessageBoundary(
  boundary: PersonaLearningMessageBoundary,
): string {
  return JSON.stringify({
    boundaryMessageId: boundary.boundaryMessageId,
    userMessageId: boundary.userMessageId,
  });
}

/** 解码失败返回 undefined（handle 存储串不可信时按缺证据跳过，不补造）。 */
export function decodePersonaLearningMessageBoundary(
  text: string,
): PersonaLearningMessageBoundary | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.userMessageId !== "string" ||
      record.userMessageId.length === 0 ||
      typeof record.boundaryMessageId !== "string" ||
      record.boundaryMessageId.length === 0
    ) {
      return undefined;
    }
    return {
      userMessageId: record.userMessageId,
      boundaryMessageId: record.boundaryMessageId,
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 来源 owner 端口（合同 §6「源 owner 必须能够证明成功持久边界」）：只读复验 + 有界
// 人类消息窗口读取。owner 负责角色/合成过滤（PM37：可信 owner 提供 role/origin）；
// 服务层负责数量/合计上界裁剪与负例归因。
// ---------------------------------------------------------------------------

export type PersonaLearningSourceVerificationStatus =
  | "verified"
  | "missing"
  | "branch_invalid"
  | "workspace_mismatch"
  | "unavailable";

export type PersonaLearningSourceVerification =
  | {
      readonly status: "verified";
      /** owner 快照校验值（成功持久边界的稳定身份；evidenceId 构造与复验期望值）。 */
      readonly sourceRevision: string;
      /** 活动分支凭据描述（sourceHandle.branchEvidence；不含正文）。 */
      readonly branchEvidence: string;
    }
  | { readonly status: Exclude<PersonaLearningSourceVerificationStatus, "verified"> };

export interface PersonaLearningSourceOwnerPort {
  /**
   * 只读复验：来源轮存在、位于活动分支、workspaceKey 域一致、成功持久边界可证明。
   * expectedSourceRevision 提交前重验时必须提供并与当前值一致（合同 §6「model 返回后
   * 重验源…revision」）。
   */
  verifyLearningSource(input: {
    readonly workspaceKey: string;
    readonly sessionId: string;
    readonly boundary: PersonaLearningMessageBoundary;
    readonly expectedSourceRevision?: string;
  }): Promise<PersonaLearningSourceVerification>;
  /**
   * owner 提供的该轮原始人类消息文本（角色/合成过滤属 owner）；暂不可用返回 undefined。
   * 返回值不承诺条数/合计上界——上界裁剪是服务层职责（合同 §6「最多 8 条、合计 8,000」）。
   */
  readTurnHumanMessages(input: {
    readonly sessionId: string;
    readonly boundary: PersonaLearningMessageBoundary;
  }): Promise<readonly string[] | undefined>;
}

// ---------------------------------------------------------------------------
// 接收（合同 §3 acceptLearningSource 内部方法；spec §5 接收前置 E && Q && U && L &&
// 预算 && 成功源证据）。Q（可信入口资格）由通知接缝的资格表冻结保证：本端口只收
// 普通成功轮通知，接入即 Q 满足。
// ---------------------------------------------------------------------------

export interface PersonaLearningAcceptanceRequest {
  /** 执行许可 E（装配层按 Runtime 冻结的值；E off 一票拒绝）。 */
  readonly personaPermission: boolean;
  /** workspaceIdentity?.trim() || workspacePath（AGENTS 身份键统一规则）。 */
  readonly workspaceKey: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly boundary: PersonaLearningMessageBoundary;
}

/** 跳过原因（固定类别；计数与日志只使用类别，不落来源正文）。 */
export type PersonaLearningSkipReason =
  | "permission_not_granted"
  | "invalid_source"
  | "uninitialized"
  | "policy_disabled"
  | "budget_exhausted"
  | "source_unverified"
  | "storage_capacity"
  | "storage_unavailable";

export type PersonaLearningAcceptanceOutcome =
  | { readonly kind: "accepted"; readonly evidenceId: string; readonly workId: string }
  | { readonly kind: "already_accepted"; readonly evidenceId: string }
  | { readonly kind: "skipped"; readonly reason: PersonaLearningSkipReason };

// ---------------------------------------------------------------------------
// 内部学习面（PersonaAppServiceImpl 实现；与 PersonaInternalCapture 同类的进程内面）。
// ---------------------------------------------------------------------------

export interface PersonaInternalLearning {
  /** 合同 §3 acceptLearningSource（内部）：全门通过才入库；任一不满足跳过并计数。 */
  acceptLearningSource(
    request: PersonaLearningAcceptanceRequest,
  ): Promise<PersonaLearningAcceptanceOutcome>;
  /**
   * 一个工作循环：领取（租约+fencing）→（按需）预算预留 → 抽取 → 候选严格校验 →
   * 源/revision 重验 → 单库提交或 settle。返回 "claimed" 表示处理了一个工作（调用方可
   * 继续驱动），"idle" 表示当前无可领取工作或策略关闭。
   */
  processLearningWork(): Promise<"idle" | "claimed">;
}

// ---------------------------------------------------------------------------
// 服务选项与默认值（PersonaAppServiceOptions.learning）
// ---------------------------------------------------------------------------

export interface PersonaLearningServiceOptions {
  /**
   * 来源 owner 端口（生产装配来自 SessionStorePort；缺省＝无 owner 可复验：来源验证
   * 一律失败，学习接收与 inferred 注入按「缺证据即跳过」降级，显式域不受影响）。
   */
  readonly sourceOwner?: PersonaLearningSourceOwnerPort;
  /**
   * 抽取端口（生产缺省＝paused：不发生任何模型调用，工作按 retry_wait 等待并在尝试
   * 上限内终态化。真实模型适配器属切片 D 授权后部分）。
   */
  readonly extractor?: PersonaLearningExtractionPort;
  /** 租约时长毫秒（服务层实验旋钮；缺省 5 分钟）。 */
  readonly leaseDurationMs?: number;
  /**
   * 单次抽取的输出 token 预留上界（合同 §6 只给日总量 4,000；单次预留缺省取日总量＝
   * 保守硬上界，真实适配器可经此收窄以提高日尝试配额的可用度）。
   */
  readonly outputTokenReserveMax?: number;
}

export const PERSONA_LEARNING_SERVICE_DEFAULTS = {
  leaseDurationMs: 5 * 60 * 1000,
  /**
   * 单次抽取的输出 token 预留缺省＝日总量 ÷ 日尝试上限（合同 §6 首版预算 4,000/10 的
   * 均分推导，不引入新数值）：既不超日上界，也不让一次预留吃光全天输出预算而使后续
   * 尝试永远无法成立。
   */
  outputTokenReserveMax: Math.floor(
    PERSONA_LEARNING_BUDGET.dailyOutputTokensMax / PERSONA_LEARNING_BUDGET.dailyModelAttemptsMax,
  ),
} as const;

/** 学习计数器（进程内观测；固定类别，不含正文）。 */
export interface PersonaLearningCounters {
  /** 通知接收总数。 */
  received: number;
  /** 进程内 64 待接收满丢弃数（合同 §6「超出丢机会并计数」）。 */
  droppedQueueFull: number;
  acceptAccepted: number;
  acceptAlreadyAccepted: number;
  /** 接收跳过按原因计数（门矩阵证据）。 */
  acceptSkipped: Record<string, number>;
  workApplied: number;
  workNoChange: number;
  workRejected: number;
  workRetryWait: number;
  /** stale fence/迟到 settle/提交冲突等工作竞争丢弃。 */
  workConflicts: number;
  /** 编排循环内部错误计数（固定类别日志之外的总数）。 */
  orchestrationErrors: number;
}

export function createPersonaLearningCounters(): PersonaLearningCounters {
  return {
    received: 0,
    droppedQueueFull: 0,
    acceptAccepted: 0,
    acceptAlreadyAccepted: 0,
    acceptSkipped: {},
    workApplied: 0,
    workNoChange: 0,
    workRejected: 0,
    workRetryWait: 0,
    workConflicts: 0,
    orchestrationErrors: 0,
  };
}

/** 学习编排可注入依赖（learning-coordinator 构造用；E/workspaceKey 在端口绑定期注入）。 */
export interface PersonaLearningCoordinatorDeps {
  readonly learning: PersonaInternalLearning;
  readonly logger?: Logger;
}

// ---------------------------------------------------------------------------
// P1b 学习管理面（合同 §3 allowLearningForKey 与 P1b 读侧概览；spec §5/§8/§10「来源状态、
// 争议、抑制、自动学习开关」）。与 PersonaInternalLearning（进程内通知面）相对：这是
// 受信管理入口经 PersonaControlPort 暴露的方法，接口独立成文件以满足 contract.ts 的
// max-public-methods 上限（PersonaAppService 既有 12 个方法已满）。
// ---------------------------------------------------------------------------

export interface PersonaLearningManagement {
  /**
   * 解除该键自动学习抑制（合同 §3 allowLearningForKey）：generation++（屏障：只接受之后
   * 的新机会，旧工作快照失效）并清 autoSuppressed。争议（disputed）不由它解决——用户
   * 设置保存/忘记才是争议解决路径（合同 §8）；「不恢复旧源/旧值」（spec §9）。
   */
  allowLearningForKey(
    input: PersonaAllowLearningInput,
  ): Promise<PersonaManagementResult<PersonaAllowLearningResult>>;
  /**
   * P1b 读侧概览（wire 名 persona/getPersonaLearningOverview，新增读侧方法——合同 §3
   * 无此逻辑名，偏差记录见 spec §13 实施跟踪）：当前策略事实（U/L 真值，P1a 时代 UI
   * 「不读取全局当前值」的替代读路径）、当日预算台账、inferred 槽合并来源定位（无正文）
   * 与本进程学习计数。未初始化返回 uninitialized 语义（查询成功的一种答案）。
   * per-work 队列行不在快照内：仓储无 per-work 只读方法，工作状态概览以计数呈现。
   */
  getPersonaLearningOverview(): Promise<PersonaManagementResult<PersonaLearningOverview>>;
}
