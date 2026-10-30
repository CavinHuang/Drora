import { expect, it } from "vitest";
import { hostSupportsPersonaControlV1 } from "@drora/shared/drora-protocol-v4";
import zhCN from "@/i18n/locales/zh-CN.js";
import enUS from "@/i18n/locales/en-US.js";
import { PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1 } from "@drora/shared";

/**
 * ui-drora-persona 契约钉住（specs/drora-persona-system.md §10、合同 §4.1）：
 * - hello 能力位只以 contracts 单一字面量识别，旧 Host 缺失键等价 false（不试发 persona 方法）；
 * - E 开关文案硬边界：双语都必须说明「新建或真正重新加载的会话」，禁止「当前会话已关闭」类表述，
 *   并保留隐私说明（个性化内容发送给当前选择的模型、可能随原诊断保留）；
 * - 已保存 / 已应用 / 未应用三态词汇双语齐全，不得互相冒充。
 */

const CAPABILITY_KEY = PERSONA_PROTOCOL_CAPABILITY_CONTROL_V1;

it("hello 能力位按 contracts 单一字面量判定；缺失键等价不可用", () => {
  expect(CAPABILITY_KEY).toBe("personaControlV1");
  expect(hostSupportsPersonaControlV1({ [CAPABILITY_KEY]: true } as never)).toBe(true);
  expect(hostSupportsPersonaControlV1({} as never)).toBe(false);
  expect(hostSupportsPersonaControlV1({ [CAPABILITY_KEY]: false } as never)).toBe(false);
});

for (const [locale, messages] of [
  ["zh-CN", zhCN],
  ["en-US", enUS],
] as const) {
  it(`E 开关文案说明生效时点并附隐私说明（${locale}）`, () => {
    const description = messages["settings.drora.execution.description"];
    const privacy = messages["settings.drora.execution.privacy"];
    expect(description).toBeTruthy();
    expect(privacy).toBeTruthy();
    // 硬边界：必须说明「用于新建或真正重新加载的会话」。
    expect(description).toMatch(/新建|真正重新加载|new or truly reloaded/i);
    // 隐私说明：个性化内容发送给当前选择的模型，并可能随原诊断保留。
    expect(privacy).toMatch(/当前选择的模型|currently selected model/i);
    expect(privacy).toMatch(/诊断|diagnostics/i);
    // 硬边界：不得显示「当前会话已关闭」类表述。
    expect(description).not.toMatch(/当前会话已|已关闭/);
  });

  it(`已保存/已应用/未应用三态词汇齐全且不互相冒充（${locale}）`, () => {
    for (const key of [
      "settings.drora.identity.savedRevision",
      "settings.drora.notice.saved",
      "settings.drora.application.applied",
      "settings.drora.application.notApplied",
      "settings.drora.preview.disclaimer",
    ] as const) {
      expect(messages[key]).toBeTruthy();
    }
    // 保存成功文案只承诺落库与下一轮生效，不声称当前轮已应用。
    expect(messages["settings.drora.notice.saved"]).not.toContain("已应用");
    expect(messages["settings.drora.notice.saved"]).not.toContain("Applied");
  });
}
