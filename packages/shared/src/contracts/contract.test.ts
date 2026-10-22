import { describe, expect, it } from "vitest";
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

  it("exposes exactly the eight appSettings keys per spec §6.1", () => {
    expect(Object.keys(VOICE_SETTINGS_KEYS).sort()).toEqual(
      [
        "announcementEnabled",
        "announcementRate",
        "announcementVoice",
        "asrEngine",
        "composerEntryHidden",
        "dictationLang",
        "privacyDisclosureAcknowledged",
        "toolBriefEnabled",
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
    expect(
      conversationInputIntentSchema.safeParse({ ...baseIntent, source: { kind: "nope" } })
        .success,
    ).toBe(false);
  });
});
