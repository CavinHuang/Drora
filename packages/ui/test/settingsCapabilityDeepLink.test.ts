// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  consumePendingSettingsModelProviderTarget,
  setPendingSettingsSectionIntent,
} from "@/lib/settingsNavigation.js";

/**
 * 模型能力条目深链 intent（specs/model-capabilities.md §12 修复 F-5）。
 *
 * 背景：capability 命名空间此前不存在——能力横幅等运行时入口只能跳到模型设置
 * 分区级，用户还得自己在左栏找到具体条目。本测试钉住 intent 的写入/消费往返
 * （sessionStorage + capability 优先于 providerId 的互斥语义）。
 * P7 本体清除（specs/obsidian-vault-phase2-true-extraction.md §1-C11）：示例 purpose
 * 由「知识评分」改为现存条目「语音识别」（Jev 节点随 knowledge 栈拆除）。
 */

describe("settings capability 深链 intent", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("写入 modelCapabilityPurpose 后消费返回 capability target（往返一致）", () => {
    setPendingSettingsSectionIntent("modelProvider", { modelCapabilityPurpose: "asr" });
    expect(consumePendingSettingsModelProviderTarget()).toEqual({
      capabilityPurpose: "asr",
    });
  });

  it("capability 深链与供应商深链互斥：purpose 优先，消费后两键俱清", () => {
    setPendingSettingsSectionIntent("modelProvider", {
      modelProviderId: "account:zai-individual-coding-plan",
      modelCapabilityPurpose: "tts",
    });
    expect(consumePendingSettingsModelProviderTarget()).toEqual({
      capabilityPurpose: "tts",
    });
    expect(consumePendingSettingsModelProviderTarget()).toBeUndefined();
  });

  it("不带 purpose 时保持既有供应商深链语义（回归保护）", () => {
    setPendingSettingsSectionIntent("modelProvider", { modelProviderId: "custom:foo" });
    expect(consumePendingSettingsModelProviderTarget()).toEqual({ providerId: "custom:foo" });
  });
});
