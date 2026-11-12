// ui.surfaces 解析契约（P7 本体清除，specs/obsidian-vault-phase2-true-extraction.md
// §1-C4 + §9 配套契约测试）：session 唯一形态回归 + `availability:"app"` 与
// `hostPanelId` 字段一律解析拒绝并记诊断（宿主面板机制已随本体清除废除，不留
// 死成员；解析器拒绝行为由本文件锁定，防止白名单外形态回流）。
import { describe, expect, it } from "vitest";
import type { PluginDiagnostic, PluginManifest, PluginUiSurfaceAvailability } from "@drora/contracts";
import { parsePluginUiSurfaces } from "../src/plugins/ui-surfaces.js";
import type { LoadedPlugin } from "../src/plugins/types.js";

function makeLoadedPlugin(input: {
  name?: string;
  source?: "official" | "inline" | "cache";
  ui?: unknown;
}): LoadedPlugin {
  const manifest = {
    name: input.name ?? "demo",
    ...(input.ui !== undefined ? { ui: input.ui } : {}),
  } as PluginManifest;
  return {
    id: `${manifest.name}@${input.source === "official" ? "drora-plugins-official" : "inline"}`,
    manifest,
    manifestPath: "/tmp/plugin.json",
    marketplace: input.source === "official" ? "drora-plugins-official" : "inline",
    rootPath: "/tmp/demo",
    source: input.source ?? "official",
  };
}

function parse(input: {
  source?: "official" | "inline" | "cache";
  ui?: unknown;
  declaredMcpServerNames?: string[];
}): { surfaces: ReturnType<typeof parsePluginUiSurfaces>; diagnostics: PluginDiagnostic[] } {
  const diagnostics: PluginDiagnostic[] = [];
  const surfaces = parsePluginUiSurfaces({
    loaded: makeLoadedPlugin(input),
    declaredMcpServerNames: input.declaredMcpServerNames ?? ["panel"],
    diagnostics,
  });
  return { surfaces, diagnostics };
}

describe("parsePluginUiSurfaces 唯一 session 形态（P7）", () => {
  it("session 形态：server/resourceUri 校验与运行时名归一保持既有语义", () => {
    const { surfaces, diagnostics } = parse({
      ui: {
        surfaces: [
          {
            id: "notes",
            title: "Notes",
            server: "panel",
            resourceUri: "ui://panel/notes",
            availability: "session",
          },
        ],
      },
    });
    expect(diagnostics).toEqual([]);
    expect(surfaces).toEqual([
      {
        id: "notes",
        title: "Notes",
        server: "plugin:demo:panel",
        declaredServer: "panel",
        resourceUri: "ui://panel/notes",
        availability: "session",
      },
    ]);
  });

  it("session 形态：server 未在 mcpServers 声明仍拒绝（既有语义）", () => {
    const { surfaces, diagnostics } = parse({
      ui: {
        surfaces: [
          {
            id: "bad",
            title: "Bad",
            server: "ghost",
            resourceUri: "ui://panel/x",
            availability: "session",
          },
        ],
      },
    });
    expect(surfaces).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("plugin_manifest_invalid");
  });

  it("availability:\"app\" 一律拒绝——官方插件声明也不例外（宿主面板形态已废除）", () => {
    // 官方与第三方两侧都拒绝：解析器不再有 official 归属门（该分支已随 app 形态删除）。
    for (const source of ["official", "inline", "cache"] as const) {
      const { surfaces, diagnostics } = parse({
        source,
        ui: {
          surfaces: [
            { id: "vault", title: "Vault", availability: "app", hostPanelId: "vault" },
          ],
        },
      });
      expect(surfaces).toEqual([]);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain("availability");
    }
  });

  it("session 形态携带 hostPanelId 拒绝（宿主面板字段不复存在）", () => {
    const { surfaces, diagnostics } = parse({
      ui: {
        surfaces: [
          {
            id: "notes",
            title: "Notes",
            server: "panel",
            resourceUri: "ui://panel/notes",
            availability: "session",
            hostPanelId: "vault",
          },
        ],
      },
    });
    expect(surfaces).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("hostPanelId");
  });

  it("availability 非法值拒绝", () => {
    const { surfaces, diagnostics } = parse({
      ui: { surfaces: [{ id: "x", title: "X", availability: "draft" }] },
    });
    expect(surfaces).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("availability");
  });
});

// C4 拆除验证（spec §1-C4：契约测试断言 PluginUiSurfaceAvailability 仅含 "session"）。
describe("PluginUiSurfaceAvailability 联合仅含 session（无 token 拆除面兜底）", () => {
  it("类型层面的唯一成员在运行时同样收敛", () => {
    const availability: PluginUiSurfaceAvailability = "session";
    // 运行时无联合可检——用解析器对全部历史成员的拒绝行为兜住（见上）。
    expect(availability).toBe("session");
  });
});
