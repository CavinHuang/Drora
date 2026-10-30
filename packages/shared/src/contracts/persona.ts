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
 * 切片 C（许可与协议）在文末补齐 personaControlV1 能力位、personaEnabled 运行偏好键与
 * persona/* wire 方法名（spec §10、合同 §4.1：三层字面量只在 shared/contracts 常量区声明一次，
 * CLI runtimeCapabilities、Host hello.capabilities、session/requestRuntimePreferences 响应与
 * 实际 persona/* 方法注册全部引用同一常量）。
 *
 * 明确不进本文件：
 * - P1b evidence/candidate/work 的键与字段：对应分期才建（合同 §2）；P1a 的
 *   policy/preference 常量随 P1a（本文件）落地；
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

/** receipt scope：authority 初始化、core 变更与 P1a 的 policy/preference 变更族。 */
export const PERSONA_RECEIPT_SCOPES = {
  authority: "authority",
  core: "core",
  policy: "policy",
  preference: "preference",
} as const;

export type PersonaReceiptScope =
  (typeof PERSONA_RECEIPT_SCOPES)[keyof typeof PERSONA_RECEIPT_SCOPES];

/** receipt.resultCode 回放词汇＝各变更结果的 status 字面量（同 ID 同摘要按此回放先前结果）。 */
export type PersonaReceiptResultCode = "created" | "saved" | "unchanged" | "forgotten";

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

// ---------------------------------------------------------------------------
// 切片 C：协议能力位、运行偏好键与 wire 方法名（spec §10「两层能力发现」、
// 合同 §4.1「已核对的能力发现路径」：字面量只在 shared contracts 常量区声明一次，
// 生产（CLI server）与消费（Host services / UI）两侧引用同一常量，禁止两处独立写）
// ---------------------------------------------------------------------------

/**
 * personaControlV1 能力位字面量（合同 §4.1）：
 * - CLI↔Host：droraProtocolMethods.runtimeCapabilities 响应的可选布尔；
 * - Host↔UI：hello.capabilities（hostCapabilitiesSchema，非 strict）的可选布尔。
 * 该位只表示「对端注册/识别控制合同 v1」，不是启用、授权、资料健康或已应用状态；
 * 缺失、method-not-found 或断线均视为不可用，原会话继续，不试发 persona 方法。
 */
export const PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1 = "personaControlV1";

/**
 * personaEnabled 运行偏好键＝执行许可 E（spec §5）。字面量被三处引用同一常量：
 * 原 AppSettings/SharedSettings 保存字段、session/requestRuntimePreferences 响应可选字段。
 * 语义：默认 false；只在 Runtime 新建/cold materialization 冻结，warm 不重读，普通 fork 继承。
 */
export const PERSONA_RUNTIME_PREFERENCE_ENABLED = "personaEnabled";

/** persona 管理方法 wire 名（合同 §3 方法表：P0 子集＋独立应用状态查询＋P1a 策略/偏好/导出）。 */
export const PERSONA_PROTOCOL_METHODS = {
  getOverview: "persona/getPersonaOverview",
  initialize: "persona/initializePersona",
  getCore: "persona/getPersonaCore",
  updateCore: "persona/updatePersonaCore",
  resetCore: "persona/resetPersonaCore",
  preview: "persona/previewPersona",
  getApplication: "persona/getPersonaApplication",
  setPolicy: "persona/setPersonalPolicy",
  savePreference: "persona/savePreference",
  forgetPreference: "persona/forgetPreference",
  listPreferences: "persona/listPreferences",
  prepareExport: "persona/preparePersonaExport",
} as const;

export type PersonaProtocolMethod =
  (typeof PERSONA_PROTOCOL_METHODS)[keyof typeof PERSONA_PROTOCOL_METHODS];

// ---------------------------------------------------------------------------
// getPersonaApplication 应用状态（合同 §3：当前 Runtime 的 applied/omitted/not_available；
// 不伪造冷历史——重启后无内存记录即 not_available。独立查询方法，不进旧 snapshot/delta/index）
// ---------------------------------------------------------------------------

export type PersonaApplicationWireStatus = "applied" | "omitted" | "not_available";

/** getPersonaApplication 输出：omitted 携带省略原因（正常 omitted reason 与管理错误分开）。 */
export type PersonaApplicationResult =
  | { readonly status: "applied"; readonly turnId: string }
  | {
      readonly status: "omitted";
      readonly turnId: string;
      readonly reason?: string;
    }
  | { readonly status: "not_available" };

// ---------------------------------------------------------------------------
// capture 正常省略原因（合同 §3「正常 omitted reason 与管理错误分开」）。wire 词汇单一
// 出处（AGENTS.md 契约键单一出处）：生产方（bootstrap drora-persona 服务/E 门端口）与
// 消费方（UI 省略原因文案映射）引用同一常量；UI 不能反向 import bootstrap 内部模块，
// 字面量必须在 shared 常量区定义一次。reason 字段本身是不透明字符串：未知值原样展示。
// ---------------------------------------------------------------------------

export const PERSONA_CAPTURE_OMITTED_REASONS = {
  /** 执行许可 E off 的零 IO 快速省略（spec §5）。 */
  permissionNotGranted: "permission_not_granted",
  /** 已存自定义核心编译失败（模板/编译器版本漂移）：只省略扩展，不静默换默认身份（spec §6）。 */
  compileFailed: "compile_failed",
} as const;

export type PersonaCaptureOmittedReason =
  (typeof PERSONA_CAPTURE_OMITTED_REASONS)[keyof typeof PERSONA_CAPTURE_OMITTED_REASONS];

// ---------------------------------------------------------------------------
// P1a 使用策略（合同 §1 Policy/P1a、§2、§4.2）：policyRevision/policyEpoch/usePreferences。
// U 与执行许可 E 分离（spec §5）：E 只放行核心贡献；偏好注入还要 U on。每次策略内容
// 变更 = 新 revision＋新 epoch（屏障：已经冻结的当前轮不被中途改写，新 capture 读新值）；
// 无内容变化的策略提交返回 unchanged，不推进 epoch（合同 §2 unchanged 语义）。
// ---------------------------------------------------------------------------

/** policy 单例行缺席时的读侧默认（迁移不回填；首次 setPersonalPolicy 以 expectedRevision=0 CAS 创建）。 */
export const PERSONA_POLICY_DEFAULTS = {
  usePreferences: false,
  policyRevision: 0,
  policyEpoch: 0,
} as const;

export interface PersonaPolicyFacts {
  readonly usePreferences: boolean;
  readonly policyRevision: number;
  readonly policyEpoch: number;
}

export interface PersonaSetPolicyInput {
  readonly expectedPolicyRevision: number;
  readonly usePreferences: boolean;
  readonly mutationId: string;
}

/** setPersonalPolicy 输出：saved 携带新 revision＋新 epoch（屏障值）；unchanged 不推进。 */
export type PersonaPolicyMutationResult =
  | { readonly status: "saved"; readonly policyRevision: number; readonly policyEpoch: number }
  | { readonly status: "unchanged" };

// ---------------------------------------------------------------------------
// P1a 四类交流默认（合同 §1.2）：唯一四键，未知 key/value 拒绝（validation_failed），
// 不把任意 JSON 转成指令。P1a 只有显式设置（provenanceKind=settings、epistemicStatus=
// explicit、pinned=true）；inferred/争议/候选是 P1b 才建的域，本文件不提前发明其字段。
// ---------------------------------------------------------------------------

export const PERSONA_PREFERENCE_KEYS = {
  replyLanguage: "replyLanguage",
  explanationDetail: "explanationDetail",
  preferredAddress: "preferredAddress",
  collaborationStyle: "collaborationStyle",
} as const;

export type PersonaPreferenceKey =
  (typeof PERSONA_PREFERENCE_KEYS)[keyof typeof PERSONA_PREFERENCE_KEYS];

/** 受控值集合；后续新增语言/风格必须扩这里＋兼容测试，不自动保存 schema 不认识的值（合同 §1.2）。 */
export const PERSONA_PREFERENCE_ALLOWED_VALUES = {
  replyLanguage: ["follow_user", "zh-CN", "en-US"],
  explanationDetail: ["concise", "balanced", "detailed"],
  collaborationStyle: ["direct_answer", "explain_tradeoffs", "step_by_step"],
} as const;

export const PERSONA_PREFERENCE_LIMITS = {
  /** preferredAddress 上限（合同 §1.2：1–40 code point 纯文本）。 */
  preferredAddressMax: 40,
  /** 编译贡献里偏好段上限（spec §6「偏好贡献 2,000」code point；超限整份省略，不截断）。 */
  compiledPreferenceBudgetMax: 2000,
} as const;

/** P1a 偏好行的唯一合法来源/认识状态（自动提交永远 extraction/inferred 是 P1b 语义，这里不存在）。 */
export type PersonaPreferenceProvenanceKind = "settings";
export type PersonaPreferenceEpistemicStatus = "explicit";
/** status 与认识状态分开（合同 §1.2）：active/superseded/forgotten 不是置信度；P1a 只有 active/forgotten。 */
export type PersonaPreferenceStatus = "active" | "forgotten";

/**
 * 一个偏好槽（含 forgotten 屏障槽）的当前事实（合同 §1 Preference/P1a：一个 authority＋key
 * 只有一个槽）。forgotten 槽 value 为空串且保留 revision/keyGeneration——savePreference 的
 * CAS 与「忘记后重设」都以它为预期值（合同 §4.2：显式保存是忘记并列的解决路径）。
 */
export interface PersonaPreferenceFacts {
  readonly key: PersonaPreferenceKey;
  /** active 槽为当前值；forgotten 槽为空串（应用可访问正文已清，合同 §1.2）。 */
  readonly value: string;
  readonly revision: number;
  readonly keyGeneration: number;
  readonly provenanceKind: PersonaPreferenceProvenanceKind;
  readonly epistemicStatus: PersonaPreferenceEpistemicStatus;
  readonly pinned: boolean;
  readonly updatedAt: number;
  readonly status: PersonaPreferenceStatus;
}

export interface PersonaSavePreferenceInput {
  readonly key: PersonaPreferenceKey;
  readonly value: string;
  readonly expectedRevision: number;
  readonly mutationId: string;
}

/** savePreference 输出：saved 携带新 revision＋generation（屏障）；unchanged 不推进 generation。 */
export type PersonaPreferenceMutationResult =
  | { readonly status: "saved"; readonly revision: number; readonly keyGeneration: number }
  | { readonly status: "unchanged" };

export interface PersonaForgetPreferenceInput {
  readonly key: PersonaPreferenceKey;
  readonly expectedRevision: number;
  readonly mutationId: string;
}

/** forgetPreference 输出：逻辑撤销屏障（generation++、新 revision 供重设 CAS）；不承诺介质擦除（spec §9）。 */
export type PersonaForgetResult = {
  readonly status: "forgotten";
  readonly revision: number;
  readonly keyGeneration: number;
};

// ---------------------------------------------------------------------------
// P1a 只读导出（合同 §7）：冻结 JSON 快照。不含 authorityId、来源定位、聊天原文、
// 历史值、候选、抑制内部记录、令牌、执行/学习授权；pinned 等内部控制态不进 envelope
// （不能被未来导入误当许可）。总 UTF-8 bytes 超限报 validation_failed，不交付截断 JSON。
// ---------------------------------------------------------------------------

export const PERSONA_EXPORT_FORMAT = "drora-persona-export";
export const PERSONA_EXPORT_FORMAT_VERSION = 1;
/** 256 KiB（合同 §7）。 */
export const PERSONA_EXPORT_MAX_BYTES = 262144;

/** 固定限制说明（合同 §7/§9：准确范围，不宣称全域擦除/导入/备份）。 */
export const PERSONA_EXPORT_LIMITATIONS = [
  "Forgetting is a logical undo: it clears app-accessible preference values, but chat history, project memory, diagnostics and previously saved copies are not removed.",
  "This file is a read-only snapshot; importing it back is not supported.",
  "It contains no chat transcripts, learning evidence, work queues or credentials.",
] as const;

export interface PersonaExportPreferenceEntry {
  readonly key: PersonaPreferenceKey;
  readonly value: string;
  readonly revision: number;
  readonly provenanceKind: PersonaPreferenceProvenanceKind;
  readonly epistemicStatus: PersonaPreferenceEpistemicStatus;
}

export interface PersonaExportPayload {
  readonly format: typeof PERSONA_EXPORT_FORMAT;
  readonly formatVersion: typeof PERSONA_EXPORT_FORMAT_VERSION;
  /** 服务产生的 UTC ISO 时间（合同 §1：业务时间由服务产生）。 */
  readonly capturedAt: string;
  readonly coreRevision: number;
  readonly policyRevision: number;
  readonly core: PersonaEditableCore;
  readonly templateVersion: number;
  readonly compilerVersion: number;
  /** 只含未忘记且有效的当前值；P1a 全部为显式设置（inferred 是 P1b 域）。 */
  readonly preferences: readonly PersonaExportPreferenceEntry[];
  /** 省略计数（合同 §7）；P1a 只有显式值，恒为 0，键位为 P1b 的推断省略预留。 */
  readonly omittedCounts: { readonly inferredOmittedUnverifiable: number };
  /** 固定限制说明（合同 §7）：不是全域擦除、不是运行备份、不含聊天原文。 */
  readonly limitations: readonly string[];
}
