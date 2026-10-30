import { describe, expect, it } from "vitest";
import {
  droraProtocolMethods,
  droraRuntimeCapabilitiesSchema,
  droraSessionRuntimePreferencesResultSchema,
} from "../drora-protocol/index.js";
import { hostCapabilitiesSchema, hostSupportsPersonaControlV1 } from "../drora-protocol-v4/transport.js";
import {
  PERSONA_CAPTURE_OMITTED_REASONS,
  PERSONA_COMPILER_VERSION,
  PERSONA_CORE_LIMITS,
  PERSONA_ERROR_CODES,
  PERSONA_EXPORT_FORMAT,
  PERSONA_EXPORT_FORMAT_VERSION,
  PERSONA_EXPORT_LIMITATIONS,
  PERSONA_EXPORT_MAX_BYTES,
  PERSONA_PREFERENCE_ALLOWED_VALUES,
  PERSONA_PREFERENCE_KEYS,
  PERSONA_PREFERENCE_LIMITS,
  PERSONA_POLICY_DEFAULTS,
  PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1,
  PERSONA_PROTOCOL_METHODS,
  PERSONA_RECEIPT_SCOPES,
  PERSONA_RUNTIME_PREFERENCE_ENABLED,
  PERSONA_STORE_SCHEMA_VERSION,
  PERSONA_STORAGE_KEYS,
  PERSONA_TEMPLATE_VERSION,
} from "./persona.js";

/**
 * Persona 契约常量单一出处钉住（specs/drora-persona-system.md、
 * docs/design/drora-persona-data-contracts-2026-10-29.md）：把错误码、receipt scope、
 * 存储位置、版本常量、核心字段界限、能力位/偏好键/wire 方法、P1a 受控四键与导出
 * envelope 常量逐字面量钉住；行为语义（CAS/receipt/导出）在 CLI 包各层测试。
 * 注册说明：根 vitest unit 工程只收集 src 下 contract.test.ts；本文件经
 * vitest.config.ts 显式 include 进默认通道（与 UI persona 测试同款登记）。
 */

describe("persona contract constants (Persona P0 切片 B 契约钉住)", () => {
  it("pins the closed management error code enum (合同 §3 错误枚举，封闭集合)", () => {
    expect(Object.values(PERSONA_ERROR_CODES).sort()).toEqual(
      [
        "unsupported",
        "unauthorized",
        "authority_mismatch",
        "validation_failed",
        "revision_conflict",
        "mutation_conflict",
        "uninitialized",
        "storage_unavailable",
        "storage_capacity",
        "outcome_unknown",
        "schema_incompatible",
        "source_unavailable",
        "snapshot_conflict",
        "budget_exhausted",
        "cancelled",
      ].sort(),
    );
    // 抽查 camelCase 键 → snake_case 值的映射（调用方引用常量，不重复写字面量）。
    expect(PERSONA_ERROR_CODES.revisionConflict).toBe("revision_conflict");
    expect(PERSONA_ERROR_CODES.outcomeUnknown).toBe("outcome_unknown");
    expect(PERSONA_ERROR_CODES.schemaIncompatible).toBe("schema_incompatible");
  });

  it("pins receipt scopes (数据合同 §1/§2：receipt(scope,mutationId) 幂等键)", () => {
    // P0 两族＋P1a 策略/偏好族；resultCode 词汇（含 P1a forgotten 屏障终态）
    // 由 PersonaReceiptResultCode 类型钉住，无运行时值可断言。
    expect(PERSONA_RECEIPT_SCOPES).toEqual({
      authority: "authority",
      core: "core",
      policy: "policy",
      preference: "preference",
    });
  });

  it("pins the trusted storage location keys (spec §4：getCliStorageRoot 下 personas/persona.sqlite)", () => {
    expect(PERSONA_STORAGE_KEYS).toEqual({ directory: "personas", database: "persona.sqlite" });
  });

  it("pins P0 version constants at their initial values (数据合同 §1)", () => {
    expect(PERSONA_STORE_SCHEMA_VERSION).toBe(1);
    expect(PERSONA_TEMPLATE_VERSION).toBe(1);
    expect(PERSONA_COMPILER_VERSION).toBe(1);
  });

  it("pins core field limits in Unicode code points (数据合同 §1.1)", () => {
    expect(PERSONA_CORE_LIMITS).toEqual({
      displayNameMin: 1,
      displayNameMax: 40,
      selfDescriptionMax: 300,
      compiledContributionMax: 4000,
    });
  });
});

describe("persona protocol literals (切片 C：能力位/偏好键/wire 方法单一出处)", () => {
  // 合同 §4.1/§3：三层字面量（含 capture 省略原因）只在 shared contracts 常量区声明一次；协议 schema（CLI
  // runtimeCapabilities、Host hello.capabilities、requestRuntimePreferences 响应）
  // 与方法表引用同一常量，从两侧消费面反查，防止任何一侧另写。
  const legacyHello = { nativeDialogs: true, localTerminal: true, binaryFrames: false, compression: "none" } as const;

  it("pins capability/preference keys and the P0 wire method names (合同 §3/§4.1)", () => {
    expect(PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1).toBe("personaControlV1");
    expect(PERSONA_RUNTIME_PREFERENCE_ENABLED).toBe("personaEnabled");
    expect(PERSONA_PROTOCOL_METHODS).toEqual({
      getOverview: "persona/getPersonaOverview",
      initialize: "persona/initializePersona",
      getCore: "persona/getPersonaCore",
      updateCore: "persona/updatePersonaCore",
      resetCore: "persona/resetPersonaCore",
      preview: "persona/previewPersona",
      getApplication: "persona/getPersonaApplication",
      // P1a（合同 §3）：策略/偏好/导出与核心管理同一方法表单一出处。
      setPolicy: "persona/setPersonalPolicy",
      savePreference: "persona/savePreference",
      forgetPreference: "persona/forgetPreference",
      listPreferences: "persona/listPreferences",
      prepareExport: "persona/preparePersonaExport",
    });
    expect(Object.values(droraProtocolMethods).filter((m) => m.startsWith("persona/"))).toEqual(
      Object.values(PERSONA_PROTOCOL_METHODS),
    );
    expect(PERSONA_CAPTURE_OMITTED_REASONS).toEqual({ permissionNotGranted: "permission_not_granted", compileFailed: "compile_failed" });
  });

  it("keeps the new keys optional for old peers (缺失即不可用/false；helper 只认 === true)", () => {
    expect(droraRuntimeCapabilitiesSchema.safeParse({}).success).toBe(true);
    expect(droraRuntimeCapabilitiesSchema.safeParse({ personaControlV1: true }).success).toBe(true);
    expect(hostCapabilitiesSchema.safeParse(legacyHello).success).toBe(true);
    expect(hostCapabilitiesSchema.safeParse({ ...legacyHello, personaControlV1: true }).success).toBe(true);
    expect(hostSupportsPersonaControlV1(hostCapabilitiesSchema.parse(legacyHello))).toBe(false);
    expect(hostSupportsPersonaControlV1(hostCapabilitiesSchema.parse({ ...legacyHello, personaControlV1: true }))).toBe(true);
    const preferences = (extra: Record<string, unknown>) =>
      droraSessionRuntimePreferencesResultSchema.parse({ nativeSearchEnhancementsEnabled: true, ...extra });
    expect(preferences({ personaEnabled: true }).personaEnabled).toBe(true);
    expect(preferences({}).personaEnabled).toBeUndefined();
  });
});

describe("persona P1a literals (交流默认与导出的受控词汇单一出处)", () => {
  it("pins P1a preference keys/values/export envelope constants (数据合同 §1.2/§7)", () => {
    expect(PERSONA_PREFERENCE_KEYS).toEqual({
      replyLanguage: "replyLanguage",
      explanationDetail: "explanationDetail",
      preferredAddress: "preferredAddress",
      collaborationStyle: "collaborationStyle",
    });
    expect(PERSONA_PREFERENCE_ALLOWED_VALUES).toEqual({
      replyLanguage: ["follow_user", "zh-CN", "en-US"],
      explanationDetail: ["concise", "balanced", "detailed"],
      collaborationStyle: ["direct_answer", "explain_tradeoffs", "step_by_step"],
    });
    expect(PERSONA_PREFERENCE_LIMITS).toEqual({
      preferredAddressMax: 40,
      compiledPreferenceBudgetMax: 2000,
    });
    expect(PERSONA_POLICY_DEFAULTS).toEqual({
      usePreferences: false,
      policyRevision: 0,
      policyEpoch: 0,
    });
    expect(PERSONA_EXPORT_FORMAT).toBe("drora-persona-export");
    expect(PERSONA_EXPORT_FORMAT_VERSION).toBe(1);
    expect(PERSONA_EXPORT_MAX_BYTES).toBe(262144);
    expect(PERSONA_EXPORT_LIMITATIONS.length).toBeGreaterThan(0);
  });
});
