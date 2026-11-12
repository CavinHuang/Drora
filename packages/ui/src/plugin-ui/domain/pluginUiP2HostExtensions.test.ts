import { describe, expect, it } from "vitest";
import { buildPluginUiHostCapabilities } from "./buildPluginUiHostCapabilities.js";
import { buildPluginUiHostContext } from "./buildPluginUiHostContext.js";
import {
  MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY,
  MCP_APPS_LOCALE_CONTEXT_KEY,
  MCP_APPS_THEME_CONTEXT_KEY,
} from "@drora/shared/mcp-apps";

// g4/g9 平台扩展（specs/obsidian-vault-phase2-true-extraction.md §2/§6/§10-P2）。
describe("g4 hostContext 只读扩展键", () => {
  it("drora/theme、drora/locale 与标准位同源写入（唯一构造点）", () => {
    const context = buildPluginUiHostContext({
      theme: "dark",
      locale: "zh-CN",
      displayMode: "fullscreen",
      width: 400,
    });
    expect(context[MCP_APPS_THEME_CONTEXT_KEY as unknown as keyof typeof context]).toBe("dark");
    expect(context[MCP_APPS_LOCALE_CONTEXT_KEY as unknown as keyof typeof context]).toBe("zh-CN");
    // 值与标准位一致：页面读哪一份都不出现两个事实源。
    expect(context.theme).toBe("dark");
    expect(context.locale).toBe("zh-CN");
  });

  it("主题/locale 变化经重建 hostContext 传递（updateHostContext 同一构造点）", () => {
    const first = buildPluginUiHostContext({
      theme: "light",
      locale: "en",
      displayMode: "inline",
      width: 100,
    });
    const second = buildPluginUiHostContext({
      theme: "dark",
      locale: "en",
      displayMode: "inline",
      width: 100,
    });
    expect(first[MCP_APPS_THEME_CONTEXT_KEY as unknown as keyof typeof first]).toBe("light");
    expect(second[MCP_APPS_THEME_CONTEXT_KEY as unknown as keyof typeof second]).toBe("dark");
  });
});

describe("g9 hostActions 能力宣告（声明与 handler 一一对应）", () => {
  const base = {
    canSendFollowUpMessage: false,
    canUpdateModelContext: false,
    canSetWidgetState: true,
    canSubscribeResources: true,
    canDownloadFile: false,
  };
  it("未注入动作时不宣告 hostActions 键（页面据此走降级路径）", () => {
    const capabilities = buildPluginUiHostCapabilities(base);
    expect(
      (capabilities.experimental as Record<string, unknown>)[
        MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY
      ],
    ).toBeUndefined();
  });
  it("只宣告真实接了 handler 的动作", () => {
    const capabilities = buildPluginUiHostCapabilities({
      ...base,
      hostActions: ["openDirectoryPicker"],
    });
    expect(
      (capabilities.experimental as Record<string, { actions: string[] }>)[
        MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY
      ],
    ).toEqual({ actions: ["openDirectoryPicker"] });
  });
  it("三动作全注入时按传入顺序宣告", () => {
    const capabilities = buildPluginUiHostCapabilities({
      ...base,
      hostActions: ["openConversationHandoff", "openDirectoryPicker", "navigate"],
    });
    expect(
      (capabilities.experimental as Record<string, { actions: string[] }>)[
        MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY
      ],
    ).toEqual({ actions: ["openConversationHandoff", "openDirectoryPicker", "navigate"] });
  });
});
