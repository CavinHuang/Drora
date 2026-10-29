/**
 * Drora Persona P0 跨层契约（specs/drora-persona-system.md §4 模块表「shared/contracts
 * 人格常量与 schema」；字段/接口/错误语义依据 docs/design/drora-persona-data-contracts-2026-10-29.md
 * §1/§2/§3）。切片 B（独立 SQLite 存储＋PersonaAppService＋服务级逻辑管理 API）的共享最小集。
 *
 * 契约键单一出处（AGENTS.md）：以下字面量只在此定义一次，生产方（CLI Persona 服务、
 * adapters 独立库仓储）与消费方引用同一常量，禁止两处独立写字面量；改名任何一侧前
 * 先全链 grep 生产与消费。结构照 contracts/desktopPet.ts / voice.ts 先例
 * （对象常量 + 严格只读类型）。
 *
 * 明确不进本文件：
 * - personaControlV1 / personaEnabled 能力位与 persona/* wire 方法名：切片 C 协议注册时
 *   与生产消费两侧一起落 shared/contracts（合同 §4.1），本层不提前发明尚无生产方的键；
 * - P1a policy/preference 与 P1b evidence/candidate/work 的键与字段：对应分期才建（合同 §2）；
 * - mutation receipt 行 schema 与 SQL 迁移：adapters 仓储所有（合同 §2），本文件只固定
 *   scope/resultCode 词汇与库位置键。
 */

// ---------------------------------------------------------------------------
// 版本常量（合同 §1；值随首次发行冻结，语义变更必须递增并走迁移/兼容流程）
// ---------------------------------------------------------------------------

/** 独立库 schema 版本（Authority/P0.schemaVersion）；迁移遇到未知版本报 schema_incompatible，只停扩展。 */
export const PERSONA_STORE_SCHEMA_VERSION = 1;

/** 产品模板版本（ProductTemplate/P0.templateVersion）；模板正文随发行冻结，正文变更必须递增。 */
export const PERSONA_TEMPLATE_VERSION = 1;

/** 确定性编译器版本（合同 §5：同输入必须产生同摘要）；编译语义变更必须递增。 */
export const PERSONA_COMPILER_VERSION = 1;

// ---------------------------------------------------------------------------
// 持久化位置键（spec §4：独立库位于可信 getCliStorageRoot 下 personas/persona.sqlite；
// 禁止用 project config 的 storage.dir 或 cwd 推导——路径拼接只引用这里的字面量）
// ---------------------------------------------------------------------------

export const PERSONA_STORAGE_KEYS = {
  /** 可信 CLI 存储根下的资料目录名。 */
  directory: "personas",
  /** 该目录内的 SQLite 库文件名。 */
  database: "persona.sqlite",
} as const;

// ---------------------------------------------------------------------------
// mutation receipt 词汇（合同 §1 MutationReceipt/P0、§2：receipt(scope,mutationId) 幂等键）
// ---------------------------------------------------------------------------

/** receipt scope：P0 只有 authority 初始化与 core 变更两族（update/reset 共用 core）。 */
export const PERSONA_RECEIPT_SCOPES = {
  authority: "authority",
  core: "core",
} as const;

export type PersonaReceiptScope =
  (typeof PERSONA_RECEIPT_SCOPES)[keyof typeof PERSONA_RECEIPT_SCOPES];

/** receipt.resultCode 回放词汇＝各变更结果的 status 字面量（同 ID 同摘要按此回放先前结果）。 */
export type PersonaReceiptResultCode = "created" | "saved" | "unchanged";

// ---------------------------------------------------------------------------
// 管理 API 错误码（合同 §3 错误枚举，封闭集合；capture 的正常 omitted reason 与管理错误分开）
// ---------------------------------------------------------------------------

export const PERSONA_ERROR_CODES = {
  unsupported: "unsupported",
  unauthorized: "unauthorized",
  authorityMismatch: "authority_mismatch",
  validationFailed: "validation_failed",
  revisionConflict: "revision_conflict",
  mutationConflict: "mutation_conflict",
  uninitialized: "uninitialized",
  storageUnavailable: "storage_unavailable",
  storageCapacity: "storage_capacity",
  outcomeUnknown: "outcome_unknown",
  schemaIncompatible: "schema_incompatible",
  sourceUnavailable: "source_unavailable",
  snapshotConflict: "snapshot_conflict",
  budgetExhausted: "budget_exhausted",
  cancelled: "cancelled",
} as const;

export type PersonaErrorCode = (typeof PERSONA_ERROR_CODES)[keyof typeof PERSONA_ERROR_CODES];

// ---------------------------------------------------------------------------
// 核心字段（合同 §1.1；cli-persona-domain 的 PersonaCore 与本结构逐字段对齐，
// 由切片 B 服务侧 parity 断言钉住）
// ---------------------------------------------------------------------------

/** Unicode code point 界限（合同 §1.1 及编译贡献上限）；超限报 validation_failed，不截断静默保存。 */
export const PERSONA_CORE_LIMITS = {
  displayNameMin: 1,
  displayNameMax: 40,
  selfDescriptionMax: 300,
  compiledContributionMax: 4000,
} as const;

export type PersonaWarmth = "restrained" | "balanced" | "warm";

export type PersonaDirectness = "gentle" | "balanced" | "direct";

export type PersonaHumor = "off" | "light";

/** 五个可编辑核心字段；不含 preferredAddress 等交流默认（P1a 才有），不含产品模板字段。 */
export interface PersonaEditableCore {
  readonly displayName: string;
  readonly selfDescription: string;
  readonly warmth: PersonaWarmth;
  readonly directness: PersonaDirectness;
  readonly humor: PersonaHumor;
}

/** updatePersonaCore 的 patch：只允许五个核心字段的子集（合同 §3「只允许五个核心字段」）。 */
export type PersonaCorePatch = {
  readonly [K in keyof PersonaEditableCore]?: PersonaEditableCore[K];
};

/** 产品只读模板说明（getPersonaCore 附带的可审阅子集）。正文与受控情境词汇随
 *  templateVersion 冻结、由版本化模板资产拥有，本类型只固定字段集；不接受学习 patch。 */
export interface PersonaProductTemplateSummary {
  readonly templateVersion: number;
  readonly compilerVersion: number;
  readonly identityStatement: string;
  readonly principles: readonly string[];
  readonly capabilityHonesty: string;
  readonly relationshipBoundary: string;
}

// ---------------------------------------------------------------------------
// P0 逻辑管理 API 输入/输出（合同 §3 方法表的逻辑签名；实际 RPC 注册在切片 C
// 服从现有框架与能力发现，届时 wire 侧以 strict schema 引用此处词汇）
// ---------------------------------------------------------------------------

/** 管理方法统一结果：失败臂只携带封闭错误码（合同 §3；故障日志只记固定类别/ID/耗时，不落个人正文）。 */
export type PersonaManagementResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: PersonaErrorCode };

/** getPersonaOverview 的已初始化臂：资料的最小观测事实；schemaVersion 即 Authority/P0.schemaVersion
 *  （值＝PERSONA_STORE_SCHEMA_VERSION）。能力位在切片 C 随协议补齐，本层不提前发明。 */
export interface PersonaOverviewInitialized {
  readonly state: "initialized";
  readonly personaId: string;
  readonly schemaVersion: number;
  readonly coreRevision: number;
  readonly templateVersion: number;
  readonly compilerVersion: number;
}

/** getPersonaOverview 输出：未初始化是查询成功的一种答案；对写方法则表现为错误码 uninitialized。 */
export type PersonaOverview = PersonaOverviewInitialized | { readonly state: "uninitialized" };

/** getPersonaCore 输出：当前可编辑字段＋产品只读模板说明；未初始化返回产品默认预览（不落库、无已存 revision）。 */
export type PersonaCoreSnapshot =
  | {
      readonly state: "current";
      readonly coreRevision: number;
      readonly core: PersonaEditableCore;
      readonly template: PersonaProductTemplateSummary;
    }
  | {
      readonly state: "built_in_preview";
      readonly core: PersonaEditableCore;
      readonly template: PersonaProductTemplateSummary;
    };

/** initializePersona 输入（合同 §2：mutationId 每次用户提交新生成；同 scope 同 ID 同摘要
 *  回放先前结果，同 ID 异摘要报 mutation_conflict；opaque ID 不得从昵称/cwd/用户文本推导）。 */
export interface PersonaInitializeInput {
  readonly mutationId: string;
}

/** updatePersonaCore 输入：expectedRevision 为 CAS 前置（合同 §2）；无内容变化返回 unchanged，不新增 revision。 */
export interface PersonaUpdateCoreInput {
  readonly expectedRevision: number;
  readonly patch: PersonaCorePatch;
  readonly mutationId: string;
}

/** resetPersonaCore 输入：恢复产品字段默认是明确的 Core 更新（合同 §1.1），其余域不动。 */
export interface PersonaResetCoreInput {
  readonly expectedRevision: number;
  readonly mutationId: string;
}

/** previewPersona 输入：有界核心草稿＋可选受控情境；本地确定性文本，不写库、不用模型。 */
export interface PersonaPreviewInput {
  readonly draft: PersonaEditableCore;
  /** 受控情境 id 由 templateVersion 拥有（spec §2「工作/日常/异议/纠正等固定示例」，
   *  集合可扩展故不在此冻结）；未知 id 报 validation_failed。 */
  readonly situationId?: string;
}

/** updatePersonaCore / resetPersonaCore 输出：saved 返回新 revision；unchanged 不新增 revision。 */
export type PersonaCoreMutationResult =
  | { readonly status: "saved"; readonly coreRevision: number }
  | { readonly status: "unchanged" };

/** initializePersona 输出：初始化完成后的概览；并发/重放命中已存在资料时 status="unchanged"（并发幂等）。 */
export type PersonaInitializeResult = PersonaOverviewInitialized & {
  readonly status: "created" | "unchanged";
};

/** previewPersona 输出：确定性文本＋编译所用模板/编译器版本（PM47：同输入同输出）。 */
export interface PersonaPreviewResult {
  readonly text: string;
  readonly templateVersion: number;
  readonly compilerVersion: number;
}
