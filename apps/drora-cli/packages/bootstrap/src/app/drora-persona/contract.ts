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
 * - P0b 没有执行许可 E（spec §5，切片 C 才注册）：captureContribution 一律快速返回
 *   omitted(permission_not_granted)，不读库、不起 worker、不吞原 session/provider 错误。
 * - 同根多进程共享靠库事务/CAS；本模块不提供内存锁，进程内服务是惰性单例。
 */
import type {
  PersonaCaptureOutcome,
  PersonaCapturePort,
  PersonaTurnCaptureRequest,
} from "@drora/core/persona";
import type { Logger } from "@drora/contracts";
import type { PersonaStorePort } from "@drora/adapters/storage/persona";
import { PERSONA_STORAGE_KEYS } from "@drora/shared";
import { join } from "node:path";
import type {
  PersonaCoreMutationResult,
  PersonaCoreSnapshot,
  PersonaInitializeInput,
  PersonaInitializeResult,
  PersonaManagementResult,
  PersonaOverview,
  PersonaPreviewInput,
  PersonaPreviewResult,
  PersonaResetCoreInput,
  PersonaUpdateCoreInput,
} from "@drora/shared";

// ---------------------------------------------------------------------------
// capture 正常省略原因（合同 §3「正常 omitted reason 与管理错误分开」；P0b 进程内词汇，
// 执行许可 E 与 wire 能力位属切片 C，届时若需跨进程再进 shared contracts 常量区）
// ---------------------------------------------------------------------------

export const PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED = "permission_not_granted";

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
  /** 内部捕获（合同 §3）；P0b 无执行许可：cancelled/omitted 快速返回，零存储访问。 */
  captureContribution(request: PersonaTurnCaptureRequest): Promise<PersonaCaptureOutcome>;
  /** 关闭已打开的库连接（幂等）。进程生命周期内不要求显式调用；测试用于释放句柄。 */
  close(): Promise<void>;
}

export interface PersonaAppServiceOptions {
  /** persona.sqlite 完整路径；只能来自可信存储根（resolvePersonaDatabasePath）。 */
  readonly dbPath: string;
  /** 业务时间（合同 §1：服务产生 UTC 时间）；缺省 Date.now。 */
  readonly now?: () => number;
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

export interface DroraPersonaSystem {
  /** 进程内惰性服务单例；构造无 IO，首显式管理调用才打开库。 */
  readonly appService: () => PersonaAppService;
  /** AgentRuntimeDeps.personaCapturePort 的生产默认装配（P0b 一律 omitted）。 */
  readonly capturePort: PersonaCapturePort;
}

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
