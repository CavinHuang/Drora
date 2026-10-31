import type { ModelInputMessage } from "@drora/contracts";
// 版本字面量单一出处是 shared contracts（AGENTS.md）；类型经 typeof 引用同一常量，
// 升级版本时本契约形状随常量自动演进，不再出现第二份手写字面量。
import { PERSONA_COMPILER_VERSION, PERSONA_TEMPLATE_VERSION } from "@drora/shared";
import type { PersonaApplicationResult } from "@drora/shared";

/** Pure, local P0a contract; not a wire schema or execution permission. */
export interface PersonaCore {
  readonly displayName: string;
  readonly selfDescription: string;
  readonly warmth: "restrained" | "balanced" | "warm";
  readonly directness: "gentle" | "balanced" | "direct";
  readonly humor: "off" | "light";
}

export interface PersonaContribution {
  readonly content: string;
  readonly coreRevision: number;
  readonly templateVersion: typeof PERSONA_TEMPLATE_VERSION;
  readonly compilerVersion: typeof PERSONA_COMPILER_VERSION;
  /**
   * 捕获时的策略屏障值（合同 §6「成功结果含 coreRevision、policyEpoch、compilerVersion…」）；
   * 仅当本轮注入了交流默认（U on）时出现。内存观测事实，不新增公共会话帧字段。
   */
  readonly policyEpoch?: number;
}

export type PersonaCompileResult =
  | { readonly status: "compiled"; readonly contribution: PersonaContribution }
  | {
      readonly status: "invalid";
      readonly field:
        | keyof PersonaCore
        | "core"
        | "coreRevision"
        | "content"
        | "preferences";
    };

/** 编译输入里的单条交流默认（U on 且校验通过的有效槽；key/value 已由服务层按受控合同校验）。 */
export interface PersonaPreferenceInput {
  readonly key: string;
  readonly value: string;
}

export interface PersonaProjectionDiagnostics {
  latestRealUserMessageIndex?: number;
  cacheControlIndex?: number;
}

/** Source entries remain canonical; an added request-only system message has no source. */
export interface PersonaRequestProjection<
  Source,
  Diagnostics extends PersonaProjectionDiagnostics,
> {
  messages: ModelInputMessage[];
  sourceEntries: Array<Source | undefined>;
  diagnostics: Diagnostics;
}

/**
 * Runtime-facing capture seam for one admitted main turn. The production service
 * and its storage arrive in a later slice; an unregistered port means the
 * feature is off and the turn keeps the original request path. The port owns
 * permission, repository reads and its own bounded waiting budget.
 */
export interface PersonaTurnCaptureRequest {
  readonly sessionId: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
}

export type PersonaCaptureOutcome =
  | { readonly status: "applied"; readonly contribution: PersonaContribution }
  | { readonly status: "omitted"; readonly reason?: string }
  | { readonly status: "cancelled"; readonly reason?: string };

export interface PersonaCapturePort {
  captureContribution(request: PersonaTurnCaptureRequest): Promise<PersonaCaptureOutcome>;
}

/**
 * 本 Runtime 最近一次已结算的轮内应用记录（切片 C 的 getPersonaApplication 查询口事实来源）。
 * 只在存活 Runtime 内存中；重启即消失，查询按 not_available 如实回答（合同 §3「不伪造冷历史」）。
 */
export type PersonaSettledTurnApplication = Extract<
  PersonaApplicationResult,
  { status: "applied" | "omitted" }
>;

/** getPersonaApplication 查询（合同 §3）：turnId 不匹配或无记录时如实 not_available。 */
export type PersonaTurnApplicationQuery = PersonaApplicationResult;

// ---------------------------------------------------------------------------
// P1b 有限学习：机会通知端口（specs/drora-persona-system.md §8「只在普通成功轮获得有界
// 机会通知」；docs/design/drora-persona-data-contracts-2026-10-29.md §6）。端口缺席即
// 功能关闭；运行时只在普通成功轮完成后非阻塞调用一次——不等待、不写任务活动时间、不进
// TurnComplete 关键路径。eligibility 与 capture 同表（isPersonaEligibleMainRequest 在
// admission 冻结），自动化/闲时/model-only/合成来源不产生机会。持久边界事实（消息 ID）
// 由本 Runtime 提供；owner 复验、预算、接收与抽取全部在消费者侧，本端口不承载。
// ---------------------------------------------------------------------------

/** 一次普通成功轮的学习机会：只携带 Runtime 拥有的持久边界定位事实，无正文。 */
export interface PersonaTurnLearningOpportunity {
  readonly sessionId: string;
  /** 本轮 product turn ID（合同 §6 sourceHandle 的 productTurnId 来源）。 */
  readonly turnId: string;
  /** 本轮真实用户消息 ID（消息边界起点）。 */
  readonly userMessageId: string;
  /** 本轮成功持久边界的最终 assistant 消息 ID（消息边界终点）。 */
  readonly boundaryMessageId: string;
}

/**
 * 学习机会通知端口：同步 void 调用，消费者进程内有界队列（进程内 64 待接收，超出丢机会
 * 并计数——合同 §6）；端口实现不得抛出、不得阻塞。执行许可 E 由装配层冻结：E off 时
 * Runtime 不装配端口（缺席即关闭，零开销）。
 */
export interface PersonaLearningNotificationPort {
  notifyLearningOpportunity(opportunity: PersonaTurnLearningOpportunity): void;
}
