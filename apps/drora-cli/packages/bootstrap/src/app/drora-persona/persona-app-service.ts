/**
 * PersonaAppService（specs/drora-persona-system.md §4 模块表「bootstrap/app/drora-persona」；
 * 管理语义逐条对应 docs/design/drora-persona-data-contracts-2026-10-29.md §2/§3）。
 *
 * 语义要点：
 * - 惰性打开：构造不做 IO；首个显式管理调用才打开独立库（打开即迁移）。schema_incompatible
 *   是本进程终态（损坏/未知 schema 只停扩展，合同 §2），缓存后快速失败不再重复迁移尝试；
 *   storage_unavailable 允许后续调用重试（磁盘/锁故障可恢复）。
 * - 幂等：requestDigest 只由规范请求内容（操作＋expectedRevision＋patch/reset/initialize
 *   标记）决定，与库内当前状态无关——超时重试复用同一 mutationId 必须得到同一摘要并被
 *   回放（PM53）；同 ID 不同请求报 mutation_conflict。
 * - 校验先于写：patch 键白名单、code point 上限、NFC/trim 控制字符由 cli-persona-domain
 *   的 validatePersonaCoreFields 归一化（合同 §1：字段校验属服务层与 cli-persona-domain）；
 *   超限报 validation_failed，不截断后静默保存。
 * - 错误通道：管理方法以 PersonaManagementResult 值返回封闭错误码；环境级
 *   PersonaStoreError 按 code 映射；未知异常归类 storage_unavailable 并记固定类别日志
 *   （只记类别/操作/耗时，不落个人正文）。不抛裸字符串。
 * - 预览零副作用：previewPersona 不触碰存储端口、不请求模型（PM20「preview 不写执行」）。
 * - P0b 捕获：无执行许可 E（spec §5，切片 C 注册）——captureContribution 一律快速省略，
 *   不得读库、不得起 worker；原 session/provider/权限错误不经本服务吞掉。
 */
import { createHash } from "node:crypto";
import type {
  PersonaCaptureOutcome,
  PersonaCapturePort,
  PersonaTurnCaptureRequest,
} from "@drora/core/persona";
import {
  compilePersonaCore,
  validatePersonaCoreFields,
} from "@drora/core/persona";
import {
  isPersonaStoreError,
  openPersonaStore,
  PersonaStoreError,
  type PersonaStorePort,
} from "@drora/adapters/storage/persona";
import {
  PERSONA_ERROR_CODES,
  type PersonaCoreMutationResult,
  type PersonaCorePatch,
  type PersonaCoreSnapshot,
  type PersonaErrorCode,
  type PersonaInitializeInput,
  type PersonaInitializeResult,
  type PersonaManagementResult,
  type PersonaOverview,
  type PersonaPreviewInput,
  type PersonaPreviewResult,
  type PersonaProductTemplateSummary,
  type PersonaResetCoreInput,
  type PersonaUpdateCoreInput,
} from "@drora/shared";
import {
  PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
  type PersonaAppService,
  type PersonaAppServiceOptions,
} from "./contract.js";
import { getProductPersonaTemplate } from "./product-template.js";

/** 服务层对 opaque mutationId 的进程内上界（wire 层严格 schema 属切片 C；超界 validation_failed）。 */
const MUTATION_ID_MAX_CODE_POINTS = 256;
const PREVIEW_CORE_REVISION = 0;

const CORE_PATCH_KEYS: readonly string[] = [
  "displayName",
  "selfDescription",
  "warmth",
  "directness",
  "humor",
];

function sha256Canonical(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

/** 键序无关的紧凑 JSON；requestDigest 与客户端对象键序解耦。 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function isValidMutationId(mutationId: unknown): mutationId is string {
  return (
    typeof mutationId === "string" &&
    mutationId.trim() !== "" &&
    [...mutationId].length <= MUTATION_ID_MAX_CODE_POINTS &&
    ![...mutationId].some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 10) || (code >= 127 && code <= 159);
    })
  );
}

function isExpectedRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isCorePatch(value: unknown): value is PersonaCorePatch {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => CORE_PATCH_KEYS.includes(key))
  );
}

export class PersonaAppServiceImpl implements PersonaAppService {
  private readonly dbPath: string;
  private readonly now: () => number;
  private readonly openStore: (dbPath: string) => Promise<PersonaStorePort>;
  private readonly logger: PersonaAppServiceOptions["logger"];
  private store: PersonaStorePort | undefined;
  /** schema_incompatible 的进程内终态：损坏/未知 schema 只停扩展，不再重复迁移尝试。 */
  private storeFatal: PersonaStoreError | undefined;
  /** close() 之后的终态标记；关闭后的管理调用不再重开库。 */
  private closed = false;

  constructor(options: PersonaAppServiceOptions) {
    if (typeof options.dbPath !== "string" || options.dbPath.trim() === "") {
      throw new Error("PersonaAppService requires a trusted database path");
    }
    this.dbPath = options.dbPath;
    this.now = options.now ?? Date.now;
    this.openStore =
      options.openStore ?? ((path) => openPersonaStore({ dbPath: path }));
    this.logger = options.logger;
  }

  async getPersonaOverview(): Promise<
    PersonaManagementResult<PersonaOverview>
  > {
    return this.runManaged("getPersonaOverview", async () => {
      const snapshot = await this.requireStore().then((store) =>
        store.readSnapshot(),
      );
      if (snapshot.state === "uninitialized") {
        // 查询成功的一种答案；不暗建身份/会话（合同 §3、PM19）。
        return { state: "uninitialized" } satisfies PersonaOverview;
      }
      const template = getProductPersonaTemplate();
      return {
        state: "initialized",
        personaId: snapshot.authority.personaId,
        schemaVersion: snapshot.authority.schemaVersion,
        coreRevision: snapshot.core.coreRevision,
        templateVersion: snapshot.core.templateVersion,
        compilerVersion: template.compilerVersion,
      } satisfies PersonaOverview;
    });
  }

  async initializePersona(
    input: PersonaInitializeInput,
  ): Promise<PersonaManagementResult<PersonaInitializeResult>> {
    if (!isValidMutationId(input.mutationId)) {
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    return this.runManaged("initializePersona", async () => {
      const template = getProductPersonaTemplate();
      const result = await this.requireStore().then((store) =>
        store.initializeAuthority({
          mutationId: input.mutationId,
          requestDigest: sha256Canonical({ op: "initialize" }),
          now: this.now(),
          initialCore: template.defaultCore,
          templateVersion: template.templateVersion,
        }),
      );
      if (!result.ok) return result;
      return {
        state: "initialized",
        status: result.value.status,
        personaId: result.value.snapshot.authority.personaId,
        schemaVersion: result.value.snapshot.authority.schemaVersion,
        coreRevision: result.value.snapshot.core.coreRevision,
        templateVersion: result.value.snapshot.core.templateVersion,
        compilerVersion: template.compilerVersion,
      } satisfies PersonaInitializeResult;
    });
  }

  async getPersonaCore(): Promise<
    PersonaManagementResult<PersonaCoreSnapshot>
  > {
    return this.runManaged("getPersonaCore", async () => {
      const template = toTemplateSummary(getProductPersonaTemplate());
      const snapshot = await this.requireStore().then((store) =>
        store.readSnapshot(),
      );
      if (snapshot.state === "uninitialized") {
        // 产品默认是无用户设置时的 fallback 预览，不落库、无已存 revision（合同 §3）。
        return {
          state: "built_in_preview",
          core: getProductPersonaTemplate().defaultCore,
          template,
        } satisfies PersonaCoreSnapshot;
      }
      return {
        state: "current",
        coreRevision: snapshot.core.coreRevision,
        core: snapshot.core.core,
        template,
      } satisfies PersonaCoreSnapshot;
    });
  }

  async updatePersonaCore(
    input: PersonaUpdateCoreInput,
  ): Promise<PersonaManagementResult<PersonaCoreMutationResult>> {
    if (
      !isValidMutationId(input.mutationId) ||
      !isExpectedRevision(input.expectedRevision)
    ) {
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    if (!isCorePatch(input.patch)) {
      // 只允许五个核心字段的子集；未知字段拒绝，不产生第二偏好 owner（合同 §3）。
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    return this.runManaged("updatePersonaCore", async () => {
      const snapshot = await this.requireStore().then((store) =>
        store.readSnapshot(),
      );
      if (snapshot.state === "uninitialized")
        return failure(PERSONA_ERROR_CODES.uninitialized);
      const validated = validatePersonaCoreFields({
        ...snapshot.core.core,
        ...input.patch,
      });
      if (validated.status === "invalid")
        return failure(PERSONA_ERROR_CODES.validationFailed);
      // digest 只由请求内容决定：同 ID 同请求跨时间回放，同 ID 异请求 mutation_conflict。
      const result = await this.requireStore().then((store) =>
        store.updateCore({
          mutationId: input.mutationId,
          requestDigest: sha256Canonical({
            op: "updateCore",
            expectedRevision: input.expectedRevision,
            patch: input.patch,
          }),
          now: this.now(),
          expectedRevision: input.expectedRevision,
          next: validated.core,
        }),
      );
      return result;
    });
  }

  async resetPersonaCore(
    input: PersonaResetCoreInput,
  ): Promise<PersonaManagementResult<PersonaCoreMutationResult>> {
    if (
      !isValidMutationId(input.mutationId) ||
      !isExpectedRevision(input.expectedRevision)
    ) {
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    return this.runManaged("resetPersonaCore", async () => {
      const snapshot = await this.requireStore().then((store) =>
        store.readSnapshot(),
      );
      if (snapshot.state === "uninitialized")
        return failure(PERSONA_ERROR_CODES.uninitialized);
      const next = getProductPersonaTemplate().defaultCore;
      // 恢复产品默认是明确的 Core 更新（合同 §1.1）；与当前内容全等时仓储返回 unchanged。
      const result = await this.requireStore().then((store) =>
        store.updateCore({
          mutationId: input.mutationId,
          requestDigest: sha256Canonical({
            op: "resetPersonaCore",
            expectedRevision: input.expectedRevision,
          }),
          now: this.now(),
          expectedRevision: input.expectedRevision,
          next,
        }),
      );
      return result;
    });
  }

  async previewPersona(
    input: PersonaPreviewInput,
  ): Promise<PersonaManagementResult<PersonaPreviewResult>> {
    // 零副作用路径：不触碰存储端口（不打开库）、不请求模型；同输入同输出（PM47）。
    const template = getProductPersonaTemplate();
    if (
      input.situationId !== undefined &&
      !template.situationIds.includes(input.situationId)
    ) {
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    const validated = validatePersonaCoreFields(input.draft);
    if (validated.status === "invalid")
      return failure(PERSONA_ERROR_CODES.validationFailed);
    const compiled = compilePersonaCore(validated.core, PREVIEW_CORE_REVISION);
    if (compiled.status === "invalid") {
      // 字段校验已通过仍超编译上限属于模板/编译器缺陷；按合同不截断、不静默缩写。
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    return {
      ok: true,
      value: {
        text: compiled.contribution.content,
        templateVersion: template.templateVersion,
        compilerVersion: template.compilerVersion,
      },
    };
  }

  async captureContribution(
    request: PersonaTurnCaptureRequest,
  ): Promise<PersonaCaptureOutcome> {
    // 取消沿原 AbortSignal 语义：已取消的轮不伪装成省略（spec §6「不能将 cancelled 当 omitted」）。
    if (request.signal.aborted) {
      return { status: "cancelled" };
    }
    // P0b 没有执行许可 E（spec §5；切片 C 才注册可信许可来源）：生产捕获一律快速省略，
    // 不读库、不起 worker。人格故障只降级扩展，本路径不会产生也不会吞原执行错误。
    return {
      status: "omitted",
      reason: PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
    };
  }

  async close(): Promise<void> {
    // close 是终态（测试/进程退出释放句柄）：关闭后的管理调用以 storage_unavailable 拒绝，
    // 不静默重开库——否则 teardown 期间会重建连接与库文件。
    this.closed = true;
    const store = this.store;
    this.store = undefined;
    this.storeFatal = undefined;
    await store?.close();
  }

  // ---------------------------------------------------------------------------
  // 惰性存储与错误通道
  // ---------------------------------------------------------------------------

  private requireStore(): Promise<PersonaStorePort> {
    if (this.closed) {
      return Promise.reject(
        new PersonaStoreError("PersonaAppService is closed", {
          code: PERSONA_ERROR_CODES.storageUnavailable,
          dbPath: this.dbPath,
        }),
      );
    }
    if (this.store) return Promise.resolve(this.store);
    if (this.storeFatal) {
      // 原样重抛 PersonaStoreError，保留 schema_incompatible 语义（不伪装成其他类别）。
      return Promise.reject(this.storeFatal);
    }
    return this.openStore(this.dbPath).then(
      (store) => {
        this.store = store;
        return store;
      },
      (error: unknown) => {
        if (
          isPersonaStoreError(error) &&
          error.code === PERSONA_ERROR_CODES.schemaIncompatible
        ) {
          this.storeFatal = error;
        }
        throw error;
      },
    );
  }

  /**
   * 管理方法统一外壳：计时、固定类别日志、封闭错误码映射。回调返回值臂（`T`）或已完成
   * 结果臂（`PersonaManagementResult<T>`，如 failure/仓储透传）皆可；不吞非 persona 信息，
   * 不抛裸字符串。
   */
  private async runManaged<T>(
    operation: string,
    fn: () => Promise<T | PersonaManagementResult<T>>,
  ): Promise<PersonaManagementResult<T>> {
    const startedAt = Date.now();
    try {
      const outcome = await fn();
      return isManagementResult<T>(outcome)
        ? outcome
        : { ok: true, value: outcome };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (isPersonaStoreError(error)) {
        this.logger?.warn("persona management failed", {
          operation,
          code: error.code,
          durationMs,
        });
        return failure(error.code);
      }
      // 未知异常按环境故障归类；只记固定类别，不落个人正文（合同 §3）。
      this.logger?.warn("persona management failed unexpectedly", {
        operation,
        durationMs,
      });
      return failure(PERSONA_ERROR_CODES.storageUnavailable);
    }
  }
}

function isManagementResult<T>(
  outcome: T | PersonaManagementResult<T>,
): outcome is PersonaManagementResult<T> {
  return typeof outcome === "object" && outcome !== null && "ok" in outcome;
}

function toTemplateSummary(
  template: ReturnType<typeof getProductPersonaTemplate>,
): PersonaProductTemplateSummary {
  return {
    templateVersion: template.templateVersion,
    compilerVersion: template.compilerVersion,
    identityStatement: template.identityStatement,
    principles: template.principles,
    capabilityHonesty: template.capabilityHonesty,
    relationshipBoundary: template.relationshipBoundary,
  };
}

function failure<T>(code: PersonaErrorCode): PersonaManagementResult<T> {
  return { ok: false, code };
}

/** PersonaCapturePort 的生产默认装配；与 PersonaAppServiceImpl.captureContribution 同源。 */
export function asPersonaCapturePort(service: {
  captureContribution(
    request: PersonaTurnCaptureRequest,
  ): Promise<PersonaCaptureOutcome>;
}): PersonaCapturePort {
  return {
    captureContribution: (request) => service.captureContribution(request),
  };
}
