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
 * - 捕获（切片 C 起）：本方法实现 E on 的真实存储捕获路径——未初始化省略不建库、取消返回
 *   cancelled、超 capture 总预算（合同 §2 初始 250ms，PERSONA_STORE_DEFAULTS.captureBudgetMs）
 *   按 budget_exhausted 省略、环境故障按封闭错误码省略；E off 的零 IO 快速省略在
 *   persona-system.ts 的 capturePortForPermission 端口层冻结，不经本方法。
 */
import { createHash } from "node:crypto";
import type {
  PersonaCaptureOutcome,
  PersonaCapturePort,
  PersonaTurnCaptureRequest,
} from "@drora/core/persona";
import type { PersonaInternalCapture } from "./persona-capture-port.js";
import {
  compilePersonaContribution,
  compilePersonaCore,
  validatePersonaCoreFields,
} from "@drora/core/persona";
import {
  isPersonaStoreError,
  openPersonaStore,
  PERSONA_STORE_DEFAULTS,
  PersonaStoreError,
  type PersonaStorePort,
} from "@drora/adapters/storage/persona";
import {
  PERSONA_ERROR_CODES,
  PERSONA_PREFERENCE_ALLOWED_VALUES,
  PERSONA_PREFERENCE_KEYS,
  PERSONA_PREFERENCE_LIMITS,
  type PersonaAllowLearningInput,
  type PersonaAllowLearningResult,
  type PersonaCoreMutationResult,
  type PersonaCorePatch,
  type PersonaCoreSnapshot,
  type PersonaErrorCode,
  type PersonaExportPayload,
  type PersonaForgetPreferenceInput,
  type PersonaForgetResult,
  type PersonaInitializeInput,
  type PersonaInitializeResult,
  type PersonaLearningOverview,
  type PersonaManagementResult,
  type PersonaOverview,
  type PersonaPolicyMutationResult,
  type PersonaPreferenceFacts,
  type PersonaPreferenceKey,
  type PersonaPreferenceMutationResult,
  type PersonaPreviewInput,
  type PersonaPreviewResult,
  type PersonaProductTemplateSummary,
  type PersonaResetCoreInput,
  type PersonaSavePreferenceInput,
  type PersonaSetPolicyInput,
  type PersonaUpdateCoreInput,
} from "@drora/shared";
import {
  PERSONA_CAPTURE_OMITTED_COMPILE_FAILED,
  type PersonaAppService,
  type PersonaAppServiceOptions,
} from "./contract.js";
import { getProductPersonaTemplate } from "./product-template.js";
import {
  createPersonaLearningCounters,
  type PersonaInternalLearning,
  type PersonaLearningAcceptanceOutcome,
  type PersonaLearningAcceptanceRequest,
  type PersonaLearningCounters,
  type PersonaLearningManagement,
} from "./learning-contract.js";
import {
  canonicalJson,
  createPersonaLearningRuntime,
  type PersonaLearningRuntime,
} from "./persona-learning-service.js";
import {
  allowLearningRequestDigest,
  composeLearningOverview,
  isValidAllowLearningInput,
} from "./persona-learning-management.js";
import { prepareExportPayload } from "./persona-export.js";

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

/**
 * capture 总预算竞速（合同 §2「capture 总预算初始 250ms」、spec §6「运行中不能无限等
 * worker」）：预算先到返回 { settled: false }，操作先到返回其值。预算获胜时底层操作
 * 可能仍在挂起——给它的 promise 挂 no-op catch，避免迟到的打开/迁移失败变成
 * unhandled rejection；其结果（无论成败）不再被消费：预算外的迟到快照不进本轮请求，
 * 同轮迟到的身份突然出现会违反「omitted 终局」（spec §6）。
 */
async function raceWithinCaptureBudget<T>(
  budgetMs: number,
  operation: () => Promise<T>,
): Promise<{ settled: true; value: T } | { settled: false }> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    return { settled: true, value: await operation() };
  }
  let clearBudgetTimer = (): void => {};
  const budgetElapsed = new Promise<{ settled: false }>((resolve) => {
    const timer = setTimeout(() => resolve({ settled: false }), budgetMs);
    clearBudgetTimer = () => clearTimeout(timer);
  });
  const operationOutcome = operation();
  try {
    return await Promise.race([
      budgetElapsed,
      operationOutcome.then((value) => ({ settled: true as const, value })),
    ]);
  } finally {
    clearBudgetTimer();
    // 预算先到时操作仍在挂起：吞掉其迟到失败，避免 unhandled rejection。
    void operationOutcome.catch(() => {});
  }
}

function isExpectedRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPreferenceKey(key: unknown): key is PersonaPreferenceKey {
  return (
    typeof key === "string" &&
    Object.values(PERSONA_PREFERENCE_KEYS).includes(
      key as (typeof PERSONA_PREFERENCE_KEYS)[keyof typeof PERSONA_PREFERENCE_KEYS],
    )
  );
}

/**
 * 偏好值规范化与受控校验（合同 §1.2）：枚举键必须命中受控集合；preferredAddress 是
 * 1–40 code point 单行纯文本（NFC/trim、拒绝全部控制字符——含换行：编译层按单行渲染，
 * 服务层放行换行会让已存值在每次 capture 时毒化整份贡献）。返回 undefined 表示
 * validation_failed，不截断后静默保存。
 */
function normalizePreferenceValue(key: string, value: unknown): string | undefined {
  if (!isPreferenceKey(key)) return undefined;
  if (key === PERSONA_PREFERENCE_KEYS.preferredAddress) {
    if (typeof value !== "string") return undefined;
    const normalized = value.normalize("NFC").trim();
    if (
      normalized === "" ||
      [...normalized].length > PERSONA_PREFERENCE_LIMITS.preferredAddressMax ||
      [...normalized].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      })
    ) {
      return undefined;
    }
    return normalized;
  }
  const allowed: readonly string[] | undefined =
    PERSONA_PREFERENCE_ALLOWED_VALUES[key as keyof typeof PERSONA_PREFERENCE_ALLOWED_VALUES];
  if (!allowed || typeof value !== "string" || !allowed.includes(value)) return undefined;
  return value;
}

function isCorePatch(value: unknown): value is PersonaCorePatch {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => CORE_PATCH_KEYS.includes(key))
  );
}


export class PersonaAppServiceImpl
  implements
    PersonaAppService,
    PersonaInternalCapture,
    PersonaInternalLearning,
    PersonaLearningManagement
{
  private readonly dbPath: string;
  private readonly now: () => number;
  private readonly captureBudgetMs: number;
  private readonly openStore: (dbPath: string) => Promise<PersonaStorePort>;
  private readonly logger: PersonaAppServiceOptions["logger"];
  private readonly learningOptions: PersonaAppServiceOptions["learning"]; // sourceOwner 供导出侧 inferred 复验与学习运行时共用
  /** 学习计数（进程内观测；所有者=本服务，学习运行时经依赖引用同一对象）。 */
  private readonly learningCounters: PersonaLearningCounters = createPersonaLearningCounters();
  /** P1b 学习运行时（persona-learning-service.ts）：接收门序/工作循环/capture 复验。 */
  private readonly learningRuntime: PersonaLearningRuntime;
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
    // capture 总预算缺省取 adapters 合同的初始值（合同 §2），不在此手写字面量。
    this.captureBudgetMs = options.captureBudgetMs ?? PERSONA_STORE_DEFAULTS.captureBudgetMs;
    this.openStore =
      options.openStore ?? ((path) => openPersonaStore({ dbPath: path }));
    this.logger = options.logger;
    this.learningOptions = options.learning;
    this.learningRuntime = createPersonaLearningRuntime({
      counters: this.learningCounters,
      dbPath: this.dbPath,
      logger: this.logger,
      now: this.now,
      options: options.learning,
      requireStore: () => this.requireStore(),
    });
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
    // 执行许可 E 的门在 capturePortForPermission 端口层（persona-system.ts，装配时冻结）；
    // 到达这里即 E on：走真实存储捕获。资料未初始化省略且不自动建库——显式 initialize 才建
    // （合同 §3/PM55：明确默认预览与不可用区别，不暗建身份）。管理域语义照旧：schema_incompatible
    // 是进程内终态、环境故障按封闭错误码省略，原 session/provider 错误不经本服务。
    const startedAt = Date.now();
    try {
      // capture 总预算（合同 §2）：打开库+迁移+读快照+inferred 来源复验整体限时；超预算按
      // budget_exhausted 省略扩展、原任务继续（PM16），首个合格主请求不被慢盘/迁移/worker
      // 卡死无上界延迟。竞速在 try 内：操作先于预算失败时仍走下方封闭错误码映射（原语义）。
      const raced = await raceWithinCaptureBudget(this.captureBudgetMs, () =>
        this.learningRuntime.readVerifiedCaptureSnapshot(),
      );
      if (!raced.settled) {
        this.logger?.warn("persona capture exceeded its total budget; omitting extension", {
          budgetMs: this.captureBudgetMs,
          durationMs: Date.now() - startedAt,
          event: "persona.capture.budget_exhausted",
          module: "drora-persona",
        });
        return { status: "omitted", reason: PERSONA_ERROR_CODES.budgetExhausted };
      }
      const snapshot = raced.value.snapshot;
      if (snapshot.state === "uninitialized") {
        return { status: "omitted", reason: PERSONA_ERROR_CODES.uninitialized };
      }
      // 交流默认门＝E && Q && U（spec §5）：U on 才读偏好并注入。注入集合＝显式槽 +
      // 复验通过的 inferred 槽（disputed 停止注入；来源不可验证的推测省略，spec §8）。
      // capture 只消费 active 槽——forgotten 槽的正文已清，仅为重设 CAS 保留 revision。
      const compiled = snapshot.policy.usePreferences
        ? compilePersonaContribution(
            snapshot.core.core,
            snapshot.core.coreRevision,
            raced.value.preferences.map((preference) => ({
              key: preference.key,
              value: preference.value,
            })),
            snapshot.policy.policyEpoch,
          )
        : compilePersonaCore(snapshot.core.core, snapshot.core.coreRevision);
      if (compiled.status === "invalid") {
        // 已存自定义核心/偏好编译失败（模板/编译器版本漂移或存储内容越界）：只省略扩展，
        // 不静默换默认身份、不截断缩写（spec §6、合同 §1）。
        this.logger?.warn("persona capture omitted: stored data failed to compile", {
          event: "persona.capture.compile_failed",
          field: compiled.field,
          module: "drora-persona",
        });
        return { status: "omitted", reason: PERSONA_CAPTURE_OMITTED_COMPILE_FAILED };
      }
      return { status: "applied", contribution: compiled.contribution };
    } catch (error) {
      // 故障只省略扩展（spec §6、PM16）；日志只记固定类别，不落个人正文。
      const code = isPersonaStoreError(error) ? error.code : PERSONA_ERROR_CODES.storageUnavailable;
      this.logger?.warn("persona capture omitted by storage failure", {
        code,
        event: "persona.capture.storage_failed",
        module: "drora-persona",
      });
      return { status: "omitted", reason: code };
    }
  }

  async setPersonalPolicy(
    input: PersonaSetPolicyInput,
  ): Promise<PersonaManagementResult<PersonaPolicyMutationResult>> {
    if (
      !isValidMutationId(input.mutationId) ||
      !isExpectedRevision(input.expectedPolicyRevision) ||
      typeof input.usePreferences !== "boolean" ||
      // P1b（合同 §1 Policy/P1b、§3「usePreferences/autoLearn/预算 patch」）：autoLearn 是
      // 可选 patch 字段，出现时必须是布尔。级联（关 U 同事务关 L、撤租约、清候选/负载）
      // 与 learningGeneration 屏障由 cli-persona-store 的策略事务执行（第一层仓储语义）。
      (input.autoLearn !== undefined && typeof input.autoLearn !== "boolean")
    ) {
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    return this.runManaged("setPersonalPolicy", async () =>
      this.requireStore().then((store) =>
        store.updatePolicy({
          mutationId: input.mutationId,
          requestDigest: sha256Canonical({
            op: "setPersonalPolicy",
            expectedPolicyRevision: input.expectedPolicyRevision,
            usePreferences: input.usePreferences,
            // digest 只含出现的 patch 字段：旧（P1a）请求的幂等回放不受新字段影响。
            ...(input.autoLearn === undefined ? {} : { autoLearn: input.autoLearn }),
          }),
          now: this.now(),
          expectedPolicyRevision: input.expectedPolicyRevision,
          usePreferences: input.usePreferences,
          ...(input.autoLearn === undefined ? {} : { autoLearn: input.autoLearn }),
        }),
      ),
    );
  }

  async savePreference(
    input: PersonaSavePreferenceInput,
  ): Promise<PersonaManagementResult<PersonaPreferenceMutationResult>> {
    // 受控四键与受控值在服务层校验（合同 §1.2：未知 key/value 拒绝，不把任意 JSON 转成指令）。
    const normalized = normalizePreferenceValue(input.key, input.value);
    if (
      !isValidMutationId(input.mutationId) ||
      !isExpectedRevision(input.expectedRevision) ||
      normalized === undefined
    ) {
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    return this.runManaged("savePreference", async () =>
      this.requireStore().then((store) =>
        store.savePreference({
          mutationId: input.mutationId,
          requestDigest: sha256Canonical({
            op: "savePreference",
            key: input.key,
            value: normalized,
            expectedRevision: input.expectedRevision,
          }),
          now: this.now(),
          expectedRevision: input.expectedRevision,
          key: input.key,
          value: normalized,
        }),
      ),
    );
  }

  async forgetPreference(
    input: PersonaForgetPreferenceInput,
  ): Promise<PersonaManagementResult<PersonaForgetResult>> {
    if (!isValidMutationId(input.mutationId) || !isExpectedRevision(input.expectedRevision)) {
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    if (!isPreferenceKey(input.key)) {
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    return this.runManaged("forgetPreference", async () =>
      this.requireStore().then((store) =>
        store.forgetPreference({
          mutationId: input.mutationId,
          requestDigest: sha256Canonical({
            op: "forgetPreference",
            key: input.key,
            expectedRevision: input.expectedRevision,
          }),
          now: this.now(),
          expectedRevision: input.expectedRevision,
          key: input.key,
        }),
      ),
    );
  }

  /**
   * 解除该键自动学习抑制（合同 §3 allowLearningForKey、§4.2；spec §9「重新授权不能给旧
   * 来源重新编号使其复活」）。校验/摘要辅助在 persona-learning-management（拆分满足
   * max-file-lines）；CAS 与屏障语义在 cli-persona-store 的单事务。
   */
  async allowLearningForKey(
    input: PersonaAllowLearningInput,
  ): Promise<PersonaManagementResult<PersonaAllowLearningResult>> {
    if (!isValidAllowLearningInput(input, isValidMutationId)) {
      return failure(PERSONA_ERROR_CODES.validationFailed);
    }
    return this.runManaged("allowLearningForKey", async () =>
      this.requireStore().then((store) =>
        store.allowLearningForKey({
          mutationId: input.mutationId,
          requestDigest: allowLearningRequestDigest(sha256Canonical, input),
          now: this.now(),
          expectedGeneration: input.expectedGeneration,
          key: input.key,
        }),
      ),
    );
  }

  /**
   * P1b 读侧概览（新增读侧方法，偏差记录见 spec §13）：单次读路径组合 store 的三个只读
   * 方法与本进程学习计数；行形状组合在 persona-learning-management.composeLearningOverview。
   */
  async getPersonaLearningOverview(): Promise<
    PersonaManagementResult<PersonaLearningOverview>
  > {
    return this.runManaged("getPersonaLearningOverview", async () => {
      const store = await this.requireStore();
      const snapshot = await store.readSnapshot();
      if (snapshot.state === "uninitialized") {
        return { state: "uninitialized" } satisfies PersonaLearningOverview;
      }
      const [budget, sources] = await Promise.all([
        store.learning.readLearningBudgetUsage(this.now()),
        store.learning.readInferredSlotSources(),
      ]);
      if (!budget.ok) return budget;
      if (!sources.ok) return sources;
      return composeLearningOverview(snapshot.policy, budget.value, sources.value, {
        ...this.learningCounters,
      });
    });
  }

  async listPreferences(): Promise<
    PersonaManagementResult<readonly PersonaPreferenceFacts[]>
  > {
    return this.runManaged("listPreferences", async () =>
      this.requireStore().then((store) => store.listPreferences()),
    );
  }

  async preparePersonaExport(): Promise<PersonaManagementResult<PersonaExportPayload>> {
    // 冻结组合与 inferred 来源复验在 persona-export；owner 与学习运行时共用同一端口（合同 §7）。
    return this.runManaged("preparePersonaExport", async () =>
      prepareExportPayload({
        store: await this.requireStore(),
        now: this.now,
        sourceOwner: this.learningOptions?.sourceOwner,
        logger: this.logger,
      }),
    );
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

  async acceptLearningSource(
    request: PersonaLearningAcceptanceRequest,
  ): Promise<PersonaLearningAcceptanceOutcome> {
    return this.learningRuntime.acceptLearningSource(request);
  }

  async processLearningWork(): Promise<"idle" | "claimed"> {
    return this.learningRuntime.processLearningWork();
  }

  /** 学习计数快照（测试/诊断；进程内观测，不落盘）。 */
  get learningCountersSnapshot(): PersonaLearningCounters {
    return this.learningCounters;
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
