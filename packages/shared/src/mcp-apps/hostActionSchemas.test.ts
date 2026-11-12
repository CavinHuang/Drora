import { describe, expect, it } from "vitest";
import {
  MCP_APPS_HOST_ACTION_NAMES,
  MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY,
  MCP_APPS_LOCALE_CONTEXT_KEY,
  MCP_APPS_NAVIGATE_METHOD,
  MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD,
  MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD,
  MCP_APPS_OPEN_WITH_METHOD,
  MCP_APPS_THEME_CONTEXT_KEY,
  mcpAppsNavigateParamsSchema,
  mcpAppsOpenConversationHandoffParamsSchema,
  mcpAppsOpenDirectoryPickerParamsSchema,
  mcpAppsOpenDirectoryPickerResultSchema,
  mcpAppsOpenWithParamsSchema,
} from "./index.js";

// g4/g9 契约键与运行时 schema（specs/obsidian-vault-phase2-true-extraction.md §6/§8/§10-P2）。
// 宿主（plugin-ui interactionPorts）与沙箱页面（aliasRuntime）两侧共用同一出处；
// 这里锁键名与 schema 判定，防两侧字面量漂移。
describe("g4/g9 mcp-apps contract keys", () => {
  it("固定 hostContext 只读扩展键与 g9 方法名", () => {
    expect(MCP_APPS_THEME_CONTEXT_KEY).toBe("drora/theme");
    expect(MCP_APPS_LOCALE_CONTEXT_KEY).toBe("drora/locale");
    expect(MCP_APPS_OPEN_CONVERSATION_HANDOFF_METHOD).toBe("drora/openConversationHandoff");
    expect(MCP_APPS_OPEN_DIRECTORY_PICKER_METHOD).toBe("drora/openDirectoryPicker");
    expect(MCP_APPS_NAVIGATE_METHOD).toBe("drora/navigate");
    expect(MCP_APPS_OPEN_WITH_METHOD).toBe("drora/openWith");
    expect(MCP_APPS_HOST_ACTIONS_EXPERIMENTAL_KEY).toBe("drora/hostActions");
    expect([...MCP_APPS_HOST_ACTION_NAMES].sort()).toEqual([
      "navigate",
      "openConversationHandoff",
      "openDirectoryPicker",
    ]);
  });
});

describe("g9 mcp-apps schemas", () => {
  it("openConversationHandoff 只接受非空内容块数组", () => {
    expect(
      mcpAppsOpenConversationHandoffParamsSchema.safeParse({
        content: [{ type: "text", text: "handoff" }],
      }).success,
    ).toBe(true);
    expect(
      mcpAppsOpenConversationHandoffParamsSchema.safeParse({
        content: [{ type: "text", text: "handoff" }],
        structuredContent: { kind: "vault-search" },
      }).success,
    ).toBe(true);
    // 空内容不是合法交接负载（composer 无从投递）。
    expect(mcpAppsOpenConversationHandoffParamsSchema.safeParse({ content: [] }).success).toBe(
      false,
    );
    expect(mcpAppsOpenConversationHandoffParamsSchema.safeParse({}).success).toBe(false);
  });

  it("openDirectoryPicker params/result 形状", () => {
    expect(mcpAppsOpenDirectoryPickerParamsSchema.safeParse({}).success).toBe(true);
    expect(mcpAppsOpenDirectoryPickerParamsSchema.safeParse({ title: "选择 Vault 根目录" }).success).toBe(true);
    expect(
      mcpAppsOpenDirectoryPickerResultSchema.safeParse({ path: "/vault/root" }).success,
    ).toBe(true);
    // 用户取消 = path:null（不是缺省字符串）。
    expect(mcpAppsOpenDirectoryPickerResultSchema.safeParse({ path: null }).success).toBe(true);
    expect(mcpAppsOpenDirectoryPickerResultSchema.safeParse({ path: 42 }).success).toBe(false);
  });

  it("navigate 只接受 surface 目标且 surfaceId 走清单 id 校验", () => {
    expect(
      mcpAppsNavigateParamsSchema.safeParse({ kind: "surface", surfaceId: "vault" }).success,
    ).toBe(true);
    expect(
      mcpAppsNavigateParamsSchema.safeParse({
        kind: "surface",
        surfaceId: "vault",
        payload: { receiptId: "r1" },
      }).success,
    ).toBe(true);
    // P2 最小面：非 surface 目标一律拒绝（§8 白名单最小面，不开放任意导航）。
    expect(
      mcpAppsNavigateParamsSchema.safeParse({ kind: "url", surfaceId: "vault" }).success,
    ).toBe(false);
    expect(mcpAppsNavigateParamsSchema.safeParse({ kind: "surface", surfaceId: "" }).success).toBe(
      false,
    );
    // 清单 id 字符集之外的 surfaceId 拒绝（与 surfaces[].id 同一 pattern）。
    expect(
      mcpAppsNavigateParamsSchema.safeParse({ kind: "surface", surfaceId: "bad id!" }).success,
    ).toBe(false);
  });

  it("openWith 通知 payload 透传", () => {
    expect(mcpAppsOpenWithParamsSchema.safeParse({ payload: { receiptId: "r1" } }).success).toBe(
      true,
    );
    expect(mcpAppsOpenWithParamsSchema.safeParse({}).success).toBe(true);
  });
});
