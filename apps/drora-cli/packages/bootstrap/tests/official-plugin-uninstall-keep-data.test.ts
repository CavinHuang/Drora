/**
 * D6 卸载数据保留强制语义（specs/obsidian-vault-phase2-true-extraction.md §11-D6、
 * §10-P6「升级路径测试（含 D6 keepData 交互）」）：obsidian 插件数据目录现含知识库
 * （P6 搬迁后的索引库/向量/审核账本）+ 嵌入模型，卸载 rm 即全库丢失——定义声明
 * uninstallKeepData=true 的插件**无条件保留**（显式 keepData:false 不生效）；未声明
 * 插件维持「显式参数优先，缺省删」的全局语义。同时锁定已装摘要的
 * uninstallKeepData 投影（卸载 UI 明示的数据来源）。
 */
import { describe, expect, it } from "vitest";
import {
  OFFICIAL_OBSIDIAN_PLUGIN_ID,
  OFFICIAL_PLUGIN_DEFINITIONS,
  resolveOfficialPluginUninstallKeepData,
} from "../src/app/official-plugin-definitions.js";
import { DRORA_OFFICIAL_PLUGIN_MARKETPLACE } from "@drora/contracts";

const OBSIDIAN_PLUGIN_ID = OFFICIAL_OBSIDIAN_PLUGIN_ID;

describe("D6 uninstall keepData（P6 强制语义）", () => {
  it("obsidian 定义声明 uninstallKeepData=true（前提锁定）", () => {
    const definition = OFFICIAL_PLUGIN_DEFINITIONS.find(
      (candidate) => `${candidate.name}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}` === OBSIDIAN_PLUGIN_ID,
    );
    expect(definition?.uninstallKeepData).toBe(true);
  });

  it("obsidian：未显式传 keepData → 保留（升级前默认语义延续）", () => {
    expect(resolveOfficialPluginUninstallKeepData(OBSIDIAN_PLUGIN_ID)).toBe(true);
  });

  it("obsidian：显式 keepData:false 也不生效（强制——数据目录含知识库+模型）", () => {
    expect(resolveOfficialPluginUninstallKeepData(OBSIDIAN_PLUGIN_ID, false)).toBe(true);
  });

  it("未声明插件：缺省删、显式 true 保留（全局语义不被本声明收窄）", () => {
    const undeclared = OFFICIAL_PLUGIN_DEFINITIONS.find(
      (candidate) => candidate.uninstallKeepData !== true,
    );
    expect(undeclared).toBeDefined();
    const undeclaredId = `${undeclared!.name}@${DRORA_OFFICIAL_PLUGIN_MARKETPLACE}`;
    expect(resolveOfficialPluginUninstallKeepData(undeclaredId)).toBe(false);
    expect(resolveOfficialPluginUninstallKeepData(undeclaredId, true)).toBe(true);
    expect(resolveOfficialPluginUninstallKeepData(undeclaredId, false)).toBe(false);
  });
});
