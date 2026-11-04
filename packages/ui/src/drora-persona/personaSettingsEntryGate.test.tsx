// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

/**
 * Drora 设置入口能力门控守护（specs/drora-persona-system.md §10）：
 * 静态导出不含 drora 分区；createSettingsPageConfig 仅在能力确认后注入，
 * 其余分区不受影响。从 PersonaSettingsSection.test.tsx 拆出满足 max-file-lines。
 */

const { createSettingsPageConfig, SETTINGS_SECTIONS } =
  await import("@/settings/settingsPageConfig.js");

describe("Drora 设置入口能力门控（settingsPageConfig）", () => {
  it("静态只读导出不含 drora；createSettingsPageConfig 仅在能力确认后加入，其余分区不受影响", () => {
    expect(SETTINGS_SECTIONS.some((section) => section.id === "drora")).toBe(false);
    expect(
      createSettingsPageConfig({ isDesktop: true }).settingsSections.some(
        (section) => section.id === "drora",
      ),
    ).toBe(false);
    const enabledConfig = createSettingsPageConfig({ isDesktop: true, showDroraPersona: true });
    expect(enabledConfig.settingsSections.some((section) => section.id === "drora")).toBe(true);
    expect(enabledConfig.settingsSections.some((section) => section.id === "memory")).toBe(true);
    // 分组导航同步出现，落到 agentCapabilities 组。
    expect(
      enabledConfig.settingsSectionGroups
        .find((group) => group.id === "agentCapabilities")
        ?.sections.some((section) => section.id === "drora"),
    ).toBe(true);
  });
});
