import { describe, expect, it } from "vitest";
import {
  CORE_USER_ACTION_FEATURES,
  SETTINGS_USER_ACTION_FEATURES,
  USER_ACTION_CATALOG,
} from "../src/lib/userActionTraceCatalog.js";

describe("user action trace catalog", () => {
  it("固定 24 个 Core 与 18 个 Settings 叶子 feature（agents_team/persona 增；v3.17.1 增 settings.browser）", () => {
    expect(Object.keys(CORE_USER_ACTION_FEATURES)).toHaveLength(24);
    // 目录自本测试写下后新增：persona（settings.drora 12 动作）、knowledge（3 动作）与
    // v3.17.1 吸收的 settings.browser（5 动作）＝17→18 feature、48→60 entry。
    expect(Object.keys(SETTINGS_USER_ACTION_FEATURES)).toHaveLength(18);
    expect(USER_ACTION_CATALOG.filter((entry) => entry.group === "core")).toHaveLength(94);
    expect(USER_ACTION_CATALOG.filter((entry) => entry.group === "settings")).toHaveLength(60);
  });

  it("feature/action 组合唯一且不使用动态标识", () => {
    const keys = USER_ACTION_CATALOG.map((entry) => `${entry.featureId}:${entry.action}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of USER_ACTION_CATALOG) {
      expect(entry.featureId).toMatch(/^[a-z]+(?:[._][a-z]+)+$/u);
      expect(entry.action).toMatch(/^[a-z]+(?:_[a-z]+)*$/u);
      expect(entry.featureId).not.toMatch(/taskId|workspacePath|pluginId/iu);
    }
  });

  it("不声明 /event/report sink", () => {
    for (const entry of USER_ACTION_CATALOG) {
      expect(entry).not.toHaveProperty("eventPolicy");
      expect(entry).not.toHaveProperty("elementName");
    }
  });
});
