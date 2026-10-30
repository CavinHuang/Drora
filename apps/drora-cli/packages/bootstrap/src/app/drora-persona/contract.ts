/**
 * cli-persona-service 对外契约（specs/drora-persona-system.md §4 模块表
 * 「bootstrap/app/drora-persona：惰性服务组合、捕获/取消/预算/降级」）。
 *
 * PersonaAppService 实现 docs/design/drora-persona-data-contracts-2026-10-29.md §3 的
 * P0 逻辑管理方法；字段/错误/幂等语义以该合同为准。本模块是独立库（cli-persona-store）
 * 的唯一预期消费方，也是 core `PersonaCapturePort` 的生产装配点。
 *
 * 边界（spec §4 硬规则）：
 * - 库路径只能由装配层从可信存储根解析（resolvePersonaDatabasePath ← getCliStorageRoot 下
 *   PERSONA_STORAGE_KEYS），不接受 project config 的 storage.dir 或 cwd。
 * - 服务构造与进程绑定不做任何 IO；只有显式管理调用才惰性打开库（打开即迁移）。
 *   getPersonaOverview 在未初始化时如实返回 uninitialized 语义，不暗建会话/身份。
 * - P0b 切片 C 起执行许可 E 生效（spec §5）：capture 权限判定由进程组合层经
 *   `capturePortForPermission(personaEnabled)` 冻结进端口——E off 一律快速
 *   `omitted(permission_not_granted)`，不读库、不起 worker；E on 走真实存储捕获，
 *   资料未初始化省略且不自动建库（显式 initialize 才建），取消返回 `cancelled`，
 *   不吞原 session/provider 错误。
 * - 同根多进程共享靠库事务/CAS；本模块不提供内存锁，进程内服务是惰性单例。
 */
import type { PersonaCapturePort } from "@drora/core/persona";
import type { Logger } from "@drora/contracts";
import type { PersonaStorePort } from "@drora/adapters/storage/persona";
import { PERSONA_CAPTURE_OMITTED_REASONS, PERSONA_STORAGE_KEYS } from "@drora/shared";
import { join } from "node:path";
import type { PersonaInternalCapture } from "./persona-capture-port.js";
import type {
  PersonaCoreMutationResult,
  PersonaCoreSnapshot,
  PersonaExportPayload,
  PersonaForgetPreferenceInput,
  PersonaForgetResult,
  PersonaInitializeInput,
  PersonaInitializeResult,
  PersonaManagementResult,
  PersonaOverview,
  PersonaPolicyMutationResult,
  PersonaPreferenceFacts,
  PersonaPreferenceMutationResult,
  PersonaPreviewInput,
  PersonaPreviewResult,
  PersonaResetCoreInput,
  PersonaSavePreferenceInput,
  PersonaSetPolicyInput,
  PersonaUpdateCoreInput,
} from "@drora/shared";

// ---------------------------------------------------------------------------
// capture 正常省略原因（合同 §3「正常 omitted reason 与管理错误分开」）。
// wire 词汇单一出处（AGENTS.md 契约键单一出处）：字面量只在 shared contracts 的
// PERSONA_CAPTURE_OMITTED_REASONS 定义一次，本包生产方与 UI 消费方（不能反向 import
// bootstrap 内部模块）引用同一常量；下面的包内名字是既有装配点/测试的兼容别名。
// 执行许可 E（切片 C，spec §5）由装配层经 capturePortForPermission 传入：
// off → permission_not_granted 快速省略（零 IO）；on 时走真实存储捕获，未初始化省略
// 不建库（显式 initialize 才建），环境故障按 storage 类错误码省略并如实记录。
// ---------------------------------------------------------------------------

export const PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED =
  PERSONA_CAPTURE_OMITTED_REASONS.permissionNotGranted;
export const PERSONA_CAPTURE_OMITTED_COMPILE_FAILED = PERSONA_CAPTURE_OMITTED_REASONS.compileFailed;

// ---------------------------------------------------------------------------
// 服务端口（合同 §3 方法表的 P0 子集；管理方法以 PersonaManagementResult 值返回封闭
// 错误码，不抛裸字符串；只有进程内编程错误才抛出）
// ---------------------------------------------------------------------------

export interface PersonaAppService {
  /** 资料最小观测事实；未初始化返回 state="uninitialized"（查询成功的一种答案）。 */
  getPersonaOverview(): Promise<PersonaManagementResult<PersonaOverview>>;
  /** 显式初始化：mutationId 幂等（同 ID 同摘要回放、同 ID 异摘要 mutation_conflict）。 */
  initializePersona(
    input: PersonaInitializeInput,
  ): Promise<PersonaManagementResult<PersonaInitializeResult>>;
  /** 当前可编辑核心＋产品只读模板说明；未初始化返回 built_in_preview（不落库）。 */
  getPersonaCore(): Promise<PersonaManagementResult<PersonaCoreSnapshot>>;
  /** expectedRevision CAS＋mutationId 幂等；无内容变化返回 unchanged，不新增 revision。 */
  updatePersonaCore(
    input: PersonaUpdateCoreInput,
  ): Promise<PersonaManagementResult<PersonaCoreMutationResult>>;
  /** 恢复产品字段默认是明确的 Core 更新；其他域（P1a/P1b）不动。 */
  resetPersonaCore(
    input: PersonaResetCoreInput,
  ): Promise<PersonaManagementResult<PersonaCoreMutationResult>>;
  /** 本地确定性预览：不写库、不请求模型、同输入同输出。 */
  previewPersona(input: PersonaPreviewInput): Promise<PersonaManagementResult<PersonaPreviewResult>>;
  /** P1a 使用策略（合同 §3 setPersonalPolicy）：CAS policyRevision；内容变更推进 epoch 屏障。 */
  setPersonalPolicy(
    input: PersonaSetPolicyInput,
  ): Promise<PersonaManagementResult<PersonaPolicyMutationResult>>;
  /** P1a 显式偏好保存（合同 §3 savePreference）：受控四键，settings/explicit/pinned。 */
  savePreference(
    input: PersonaSavePreferenceInput,
  ): Promise<PersonaManagementResult<PersonaPreferenceMutationResult>>;
  /** P1a 逻辑忘记（合同 §3/§9）：清应用持有正文、generation 屏障；不承诺全域擦除。 */
  forgetPreference(
    input: PersonaForgetPreferenceInput,
  ): Promise<PersonaManagementResult<PersonaForgetResult>>;
  /** P1a 偏好列表（合同 §3 listPreferences）：当前值＋来源类别；无原文复制之外派生。 */
  listPreferences(): Promise<PersonaManagementResult<readonly PersonaPreferenceFacts[]>>;
  /** P1a 只读导出（合同 §7）：冻结快照；无资料 uninitialized，不初始化；≤256KiB。 */
  preparePersonaExport(): Promise<PersonaManagementResult<PersonaExportPayload>>;
  /** 关闭已打开的库连接（幂等）。进程生命周期内不要求显式调用；测试用于释放句柄。 */
  close(): Promise<void>;
}

export interface PersonaAppServiceOptions {
  /** persona.sqlite 完整路径；只能来自可信存储根（resolvePersonaDatabasePath）。 */
  readonly dbPath: string;
  /** 业务时间（合同 §1：服务产生 UTC 时间）；缺省 Date.now。 */
  readonly now?: () => number;
  /**
   * capture 总预算毫秒（合同 §2「capture 总预算初始 250ms」、spec §6）：打开库+迁移+
   * 读快照的整个捕获路径限时；超预算按 budget_exhausted 省略扩展、原任务继续（PM16），
   * 不让慢盘/迁移/worker 卡死无上界延迟首个合格主请求。缺省取
   * PERSONA_STORE_DEFAULTS.captureBudgetMs。
   */
  readonly captureBudgetMs?: number;
  /**
   * 存储端口工厂；缺省 openPersonaStore。测试注入受控实现以演练环境级故障；
   * 生产代码不得用它绕过 cli-persona-store 的迁移/事务语义。
   */
  readonly openStore?: (dbPath: string) => Promise<PersonaStorePort>;
  /** 固定 scope 的服务日志；只记固定类别/ID/耗时，不落个人正文（合同 §3）。 */
  readonly logger?: Logger;
}

// ---------------------------------------------------------------------------
// 进程级组合（spec §4：新控制处理器在进程组合层惰性取得 Persona 服务；session 关闭
// 不能销毁进程级资料服务。同根多进程共享靠 DB/CAS，不靠内存锁。）
// ---------------------------------------------------------------------------

export interface PersonaSystemBinding {
  /** 可信 CLI 存储根（getCliStorageRoot 的结果）；库路径由此解析，进程内首个绑定生效。 */
  readonly trustedCliStorageRoot: string;
  readonly logger?: Logger;
}

/**
 * 进程组合层工厂：惰性绑定进程级 Persona 系统，返回无会话管理端口（不做任何 IO）。
 * 协议 server（entrypoint 装配）经它取得控制处理器用的 Persona 服务，不经 AgentRuntime
 * 取仓储（spec §4）；实现放 persona-system.ts（进程级 holder 的同文件），避免契约模块
 * 反向依赖组合实现。
 */
export type PersonaControlPortFactory = (binding: PersonaSystemBinding) => PersonaControlPort;

export interface DroraPersonaSystem {
  /** 进程内惰性服务单例；构造无 IO，首显式管理调用才打开库。含内部捕获面（capture）。 */
  readonly appService: () => PersonaAppService & PersonaInternalCapture;
  /**
   * 按执行许可 E 冻结的捕获端口（spec §5）：每个新建 Runtime 用自己的 E 值绑定一次，
   * warm Runtime 不重读；普通 fork 由协议启动偏好继承原许可。E off 一律快速
   * omitted(permission_not_granted)（零 IO、不起 worker）；E on 走真实存储捕获。
   */
  readonly capturePortForPermission: (personaEnabled: boolean) => PersonaCapturePort;
}

/**
 * 无会话管理的独立组合端口（spec §4「新控制处理器在进程组合层惰性取得 Persona 服务，
 * 不能通过构造 AgentRuntime 来取得仓储」）：协议 server 的控制处理器只经装配层注入的
 * 该端口访问管理 API；端口缺席时控制路由不注册、能力位不广告（合同 §3 unsupported）。
 */
export type PersonaControlPort = Pick<
  PersonaAppService,
  | "getPersonaOverview"
  | "initializePersona"
  | "getPersonaCore"
  | "updatePersonaCore"
  | "resetPersonaCore"
  | "previewPersona"
  | "setPersonalPolicy"
  | "savePreference"
  | "forgetPreference"
  | "listPreferences"
  | "preparePersonaExport"
>;

/**
 * 把可信 CLI 存储根解析为 persona.sqlite 路径（单一出处：shared PERSONA_STORAGE_KEYS；
 * 装配层不得手写 "personas/persona.sqlite" 字面量）。
 */
export function resolvePersonaDatabasePath(trustedCliStorageRoot: string): string {
  if (typeof trustedCliStorageRoot !== "string" || trustedCliStorageRoot.trim() === "") {
    // 装配层编程错误（可信根缺席）必须 fail fast，不能让它伪装成 storage 故障。
    throw new Error("Persona system requires a trusted CLI storage root");
  }
  return join(trustedCliStorageRoot, PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database);
}
