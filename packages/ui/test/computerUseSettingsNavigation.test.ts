import assert from "node:assert/strict";
import test from "node:test";
import { isSettingsSectionEnabled, resolveSettingsSection } from "../src/lib/settingsNavigation.js";
import { SETTINGS_SECTIONS, createSettingsPageConfig } from "../src/settings/settingsPageConfig.js";

// 电脑控制设置分区对齐原版发行物（3.14.3 renderer 隐藏集只有
// automations/plugins/workspaceFileSearch）：桌面端必须露出 computerUse 分区，
// Web 视图继续按平台门控排除，路由解析不得再把 computerUse 降级成 general。

test("computerUse 不在全局隐藏集合中", () => {
  assert.ok(isSettingsSectionEnabled("computerUse"));
  assert.equal(resolveSettingsSection("computerUse"), "computerUse");
});

test("Web 静态配置不包含 computerUse", () => {
  assert.ok(!SETTINGS_SECTIONS.some((section) => section.id === "computerUse"));
});

test("桌面端配置包含 computerUse，Web 动态配置不包含", () => {
  const desktop = createSettingsPageConfig({ isDesktop: true });
  assert.ok(desktop.settingsSections.some((section) => section.id === "computerUse"));

  const windowsOnly = createSettingsPageConfig({ isWindowsDesktop: true });
  assert.ok(windowsOnly.settingsSections.some((section) => section.id === "computerUse"));

  const web = createSettingsPageConfig({});
  assert.ok(!web.settingsSections.some((section) => section.id === "computerUse"));
});
