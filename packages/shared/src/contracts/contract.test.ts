import { describe, expect, it } from "vitest";
import {
  PERSONA_CAPTURE_OMITTED_REASONS,
  PERSONA_COMPILER_VERSION,
  PERSONA_CORE_LIMITS,
  PERSONA_ERROR_CODES,
  PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1,
  PERSONA_PROTOCOL_METHODS,
  PERSONA_RECEIPT_SCOPES,
  PERSONA_RUNTIME_PREFERENCE_ENABLED,
  PERSONA_STORE_SCHEMA_VERSION,
  PERSONA_STORAGE_KEYS,
  PERSONA_TEMPLATE_VERSION,
} from "./persona.js";
import {
  droraProtocolMethods,
  droraRuntimeCapabilitiesSchema,
  droraSessionRuntimePreferencesResultSchema,
} from "../drora-protocol/index.js";
import { hostCapabilitiesSchema, hostSupportsPersonaControlV1 } from "../drora-protocol-v4/transport.js";
import {
  VOICE_BROADCAST_CLAIM_KEY,
  VOICE_INPUT_SOURCE_KIND,
  VOICE_SETTINGS_KEYS,
} from "./voice.js";
import {
  conversationInputIntentSchema,
  conversationInputSourceSchema,
  voiceInputSourceSchema,
} from "../drora-protocol-v4/input-intent.js";

/**
 * 语音契约常量与 input-intent additive 扩展守护（specs/voice-agent-integration.md
 * §2.1 / §2.2 / §9.1 验收第一条）。
 *
 * 文件名说明：spec §9.1 写 `voice.test.ts`（位置照该包测试现状）；本包 src 侧测试
 * 现状统一命名 `contract.test.ts`（gen-ui / mcp-apps / sqlite-migrations /
 * web-remote-relay 同款），且根 vitest unit 工程只收集各包 src 下以此命名的测试，
 * 按现状命名才能进入默认测试通道，故采用 contract.test.ts。
 *
 * §6.1 八键与 validationAppSettings schema 字段名的 parity 断言在本文件内
 * （persisted defaults + patch optional 两 schema 的字段名集合 === VOICE_SETTINGS_KEYS
 * 值集合，另抽查 §6.1 默认值）。
 */

describe("voice contract constants", () => {
  it("pins the wire source kind literal", () => {
    expect(VOICE_INPUT_SOURCE_KIND).toBe("voice");
    // 单一出处（§2.1）：schema 的 kind literal 必须引用常量，禁止两处独立写字面量。
    expect(voiceInputSourceSchema.shape.kind.value).toBe(VOICE_INPUT_SOURCE_KIND);
  });

  it("exposes exactly the appSettings keys per spec §6.1 + §9.6.2 厂商档 + §9.7.3/§9.7.5/§9.7.8 additive", () => {
    expect(Object.keys(VOICE_SETTINGS_KEYS).sort()).toEqual(
      [
        "announcementEnabled",
        "announcementLang",
        "announcementRate",
        "announcementVoice",
        "asrEngine",
        "asrVendorModel",
        "composerEntryHidden",
        "dictationLang",
        "personaId",
        "privacyDisclosureAcknowledged",
        "ttsEngine",
        "ttsVendorModel",
        "ttsVendorVoice",
        "toolBriefEnabled",
        "vendorBaseUrl",
      ].sort(),
    );
    expect(VOICE_SETTINGS_KEYS.composerEntryHidden).toBe("voiceComposerEntryHidden");
    expect(VOICE_SETTINGS_KEYS.announcementEnabled).toBe("voiceAnnouncementEnabled");
    expect(VOICE_SETTINGS_KEYS.announcementVoice).toBe("voiceAnnouncementVoice");
    expect(VOICE_SETTINGS_KEYS.announcementRate).toBe("voiceAnnouncementRate");
    expect(VOICE_SETTINGS_KEYS.dictationLang).toBe("voiceDictationLang");
    expect(VOICE_SETTINGS_KEYS.asrEngine).toBe("voiceAsrEngine");
    expect(VOICE_SETTINGS_KEYS.toolBriefEnabled).toBe("voiceToolBriefEnabled");
    expect(VOICE_SETTINGS_KEYS.privacyDisclosureAcknowledged).toBe(
      "voicePrivacyDisclosureAcknowledged",
    );
    // §9.7.3：云 TTS 音色独立键（与 voiceAnnouncementVoice 分属两个命名空间，永不互读）。
    expect(VOICE_SETTINGS_KEYS.ttsVendorVoice).toBe("voiceTtsVendorVoice");
    // §9.7.5：播报语言键（""=自动=UI locale）。
    expect(VOICE_SETTINGS_KEYS.announcementLang).toBe("voiceAnnouncementLang");
    // §9.7.8：persona 显示键（设置面显示派生单处消费，运行时零读路径）。
    expect(VOICE_SETTINGS_KEYS.personaId).toBe("voicePersonaId");
  });

  it("exposes the two broadcast claim keys", () => {
    expect(VOICE_BROADCAST_CLAIM_KEY.announcement).toBe("drora:voice-announcement-claim");
    // FD-7 / EG-7 预留键：Phase 1 零生产/消费方，dep:refs 同源断言豁免（§9.1）。
    expect(VOICE_BROADCAST_CLAIM_KEY.mic).toBe("drora:voice-mic-claim");
  });

  it("keeps VOICE_SETTINGS_KEYS in parity with the appSettings schema fields (§9.1 / §6.1)", async () => {
    // parity 单测（spec §9.1）：validationAppSettings voice 字段名集合 === 键值集合。
    // 动态 import 避免把大 schema 拉进非 settings 消费方的模块图。
    // persisted 侧经 appSettingsSchema.parse({}) 拿全默认对象——键集与默认值一次断言。
    const { appSettingsSchema, appSettingsPatchSchema } = await import(
      "../validationAppSettings.js"
    );
    const expected = Object.values(VOICE_SETTINGS_KEYS).sort();
    const persistedKeys = Object.keys(appSettingsSchema.parse({}))
      .filter((key) => key.startsWith("voice"))
      .sort();
    const patchKeys = Object.keys(appSettingsPatchSchema.shape)
      .filter((key) => key.startsWith("voice"))
      .sort();
    expect(persistedKeys).toEqual(expected);
    expect(patchKeys).toEqual(expected);
    // §6.1 默认值抽查：入口默认隐藏、播报默认关、披露未确认。
    const defaults = appSettingsSchema.parse({});
    expect(defaults.voiceComposerEntryHidden).toBe(true);
    expect(defaults.voiceAnnouncementEnabled).toBe(false);
    expect(defaults.voicePrivacyDisclosureAcknowledged).toBe(false);
    expect(defaults.voiceAnnouncementRate).toBe(1);
    expect(defaults.voiceAsrEngine).toBe("webSpeech");
    // §9.7.3/§9.7.5/§9.7.8 additive 默认值：三键空串（cloud=厂商默认音色 / lang=自动=UI locale / persona=未选）。
    expect(defaults.voiceTtsVendorVoice).toBe("");
    expect(defaults.voiceAnnouncementLang).toBe("");
    expect(defaults.voicePersonaId).toBe("");
  });
});

describe("voiceInputSourceSchema (strict, additive)", () => {
  it("parses the full voice source round-trip", () => {
    // §9.1：{kind:"voice",lang:"zh-CN",engine:"webSpeech"} parse 通过。
    const parsed = voiceInputSourceSchema.parse({
      kind: "voice",
      lang: "zh-CN",
      engine: "webSpeech",
    });
    expect(parsed).toEqual({ kind: "voice", lang: "zh-CN", engine: "webSpeech" });
  });

  it("parses the minimal voice source (source stays optional on intent)", () => {
    expect(voiceInputSourceSchema.parse({ kind: "voice" })).toEqual({ kind: "voice" });
  });

  it("rejects unknown kind", () => {
    expect(
      conversationInputSourceSchema.safeParse({ kind: "voiceX" }).success,
    ).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    // §2.2：.strict() 偏斜方向 CLI→renderer——多余字段整条拒收，旧 CLI 不携带 source。
    expect(
      voiceInputSourceSchema.safeParse({ kind: "voice", extra: 1 }).success,
    ).toBe(false);
  });

  it("rejects invalid engine and overlong lang", () => {
    expect(
      voiceInputSourceSchema.safeParse({ kind: "voice", engine: "whisper" }).success,
    ).toBe(false);
    expect(
      voiceInputSourceSchema.safeParse({ kind: "voice", lang: "x".repeat(36) }).success,
    ).toBe(false);
  });

  it("keeps the union discriminated on kind without breaking pluginUi/genUi members", () => {
    expect(conversationInputSourceSchema.parse({ kind: "voice" })).toEqual({ kind: "voice" });
    expect(
      conversationInputSourceSchema.safeParse({ kind: "pluginUi", pluginId: "p", toolCallId: "t" })
        .success,
    ).toBe(true);
    expect(
      conversationInputSourceSchema.safeParse({ kind: "genUi", path: "a.ts" }).success,
    ).toBe(true);
  });
});

describe("persona contract constants (Persona P0 切片 B 契约钉住)", () => {
  it("pins the closed management error code enum (数据合同 §3)", () => {
    // 15 个错误码封闭集合：值与合同 §3 逐字对齐（键为 camelCase 存取名，值即 wire/存储字面量）。
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
    // P0 只有 authority 初始化与 core 变更两族；resultCode 词汇（created/saved/unchanged）
    // 由 PersonaReceiptResultCode 类型钉住，无运行时值可断言。
    expect(PERSONA_RECEIPT_SCOPES).toEqual({ authority: "authority", core: "core" });
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

describe("conversationInputIntentSchema.source with voice member", () => {
  const baseIntent = {
    sourceCommandId: "cmd-1",
    queueItemId: "q-1",
    clientId: "client-1",
    kind: "sendText",
    text: "hello",
    delivery: { requested: "auto", admitted: "startNow" },
    order: { admissionSeq: 0 },
    steer: { state: "notRequested" },
    dispatch: { state: "admitted" },
    admittedAt: 0,
  };

  it("round-trips an intent carrying the voice source", () => {
    const parsed = conversationInputIntentSchema.parse({
      ...baseIntent,
      source: { kind: "voice", lang: "zh-CN", engine: "webSpeech" },
    });
    expect(parsed.source).toEqual({ kind: "voice", lang: "zh-CN", engine: "webSpeech" });
  });

  it("still accepts intents without source (old renderer / 灰度安全)", () => {
    // §9.1：旧 renderer + 新 CLI 灰度——sendText 不带 source 照常受理。
    const parsed = conversationInputIntentSchema.parse(baseIntent);
    expect(parsed.source).toBeUndefined();
  });

  it("rejects an intent whose source has an unknown kind", () => {
    expect(conversationInputIntentSchema.safeParse({ ...baseIntent, source: { kind: "nope" } }).success).toBe(false);
  });
});
