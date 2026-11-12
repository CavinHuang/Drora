// `plugins/listUiSurfaces` 投影过滤语义（P7 本体清除后收窄，
// specs/obsidian-vault-phase2-true-extraction.md §1-C4）：session 级沙箱面板维持
// plugin.enabled 过滤（既有语义零变化）；app 级宿主面板投影分支与三态合成过滤随
// 宿主面板机制废除——解析侧已拒绝该形态，投影内不会再出现 app 条目。
import { describe, expect, it } from "vitest";
import type { PluginMetadata } from "@drora/contracts";
// P7（specs/obsidian-vault-phase2-true-extraction.md §9）：插件 id 改引官方定义常量。
import { OFFICIAL_OBSIDIAN_PLUGIN_ID } from "../src/app/official-plugin-definitions.js";
import {
  resolvePluginHooksPresence,
  resolvePluginHostComponentsPresence,
  type PluginEnablementState,
} from "@drora/shared";
import { listPluginUiSurfacesFromPlugins } from "../src/drora-protocol/plugin-ui-surfaces.js";

function makePlugin(input: {
  id: string;
  enabled: boolean;
  surfaces?: Array<Record<string, unknown>>;
}): PluginMetadata {
  return {
    id: input.id,
    name: input.id.split("@")[0] ?? input.id,
    enabled: input.enabled,
    ...(input.surfaces?.length ? { uiSurfaces: input.surfaces as never } : {}),
  } as PluginMetadata;
}

const OBSIDIAN_ID = OFFICIAL_OBSIDIAN_PLUGIN_ID;
const DOC_ID = "documents@drora-plugins-official";

const documentsEnabled = makePlugin({
  id: DOC_ID,
  enabled: true,
  surfaces: [
    {
      id: "viewer",
      title: "Viewer",
      server: "plugin:documents:office",
      declaredServer: "office",
      resourceUri: "ui://office/view",
      availability: "session",
    },
  ],
});

describe("listPluginUiSurfacesFromPlugins 投影过滤", () => {
  it("session 级：维持 plugin.enabled 过滤（既有语义零变化）", () => {
    const documentsDisabled = makePlugin({
      id: DOC_ID,
      enabled: false,
      surfaces: documentsEnabled.uiSurfaces,
    });
    expect(listPluginUiSurfacesFromPlugins([documentsDisabled])).toEqual([]);
    expect(listPluginUiSurfacesFromPlugins([documentsEnabled])).toHaveLength(1);
  });

  it("禁用插件的 surfaces 不投影（禁用插件没有运行时 MCP，入口不可用）", () => {
    const obsidianDisabled = makePlugin({
      id: OBSIDIAN_ID,
      enabled: false,
      surfaces: [
        {
          id: "vault",
          title: "Vault",
          server: "plugin:obsidian:knowledge",
          declaredServer: "knowledge",
          resourceUri: "ui://obsidian/panel.html",
          availability: "session",
        },
      ],
    });
    expect(listPluginUiSurfacesFromPlugins([obsidianDisabled])).toEqual([]);
  });
});

describe("两层启用位三态合成读取器（shared 单一出处）", () => {
  it("hooks 在场：enabledPlugins 显式值优先，未配置回落 defaultEnabled", () => {
    const state: PluginEnablementState = { enabledPlugins: { [OBSIDIAN_ID]: true } };
    expect(resolvePluginHooksPresence(state, OBSIDIAN_ID, false)).toBe(true);
    expect(resolvePluginHooksPresence({}, OBSIDIAN_ID, false)).toBe(false);
    expect(resolvePluginHooksPresence({}, OBSIDIAN_ID, true)).toBe(true);
  });

  it("hooks 在场：suppressedBuiltins 优先于一切（卸载即失效，禁止按 enabledPlugins 误判）", () => {
    const state: PluginEnablementState = {
      enabledPlugins: { [OBSIDIAN_ID]: true },
      suppressedBuiltins: [OBSIDIAN_ID],
    };
    expect(resolvePluginHooksPresence(state, OBSIDIAN_ID, true)).toBe(false);
  });

  it("宿主能力在场：缺省 true，不读 enabledPlugins/defaultEnabled", () => {
    expect(resolvePluginHostComponentsPresence({}, OBSIDIAN_ID)).toBe(true);
    expect(
      resolvePluginHostComponentsPresence({ enabledPlugins: { [OBSIDIAN_ID]: false } }, OBSIDIAN_ID),
    ).toBe(true);
    expect(
      resolvePluginHostComponentsPresence({ hostComponents: false }, OBSIDIAN_ID),
    ).toBe(false);
    expect(resolvePluginHostComponentsPresence({ hostComponents: true }, OBSIDIAN_ID)).toBe(true);
    expect(
      resolvePluginHostComponentsPresence(
        { suppressedBuiltins: [OBSIDIAN_ID] },
        OBSIDIAN_ID,
      ),
    ).toBe(false);
  });
});
