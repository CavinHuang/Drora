import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildPluginReferenceCatalog: vi.fn(),
  getDroraPluginsOverview: vi.fn(),
  resolveDroraPlugins: vi.fn(),
  updateDroraPluginMarketplace: vi.fn(),
}));

vi.mock("@drora/core", () => ({
  buildPluginReferenceCatalog: mocks.buildPluginReferenceCatalog,
}));

vi.mock("../src/plugins.js", () => ({
  enrichCachedClaudeMarketplaceIconsForOverview: vi.fn(),
  getDroraPluginsOverview: mocks.getDroraPluginsOverview,
  resolveDroraPlugins: mocks.resolveDroraPlugins,
  updateDroraPluginMarketplace: mocks.updateDroraPluginMarketplace,
}));

import {
  droraPluginOperationStateSchema,
  droraPluginOperationProgressNotificationSchema,
  droraPluginsResolveSuggestedReferenceParamsSchema,
  droraPluginsResolveSuggestedReferenceResultSchema,
  droraProtocolNotifications,
} from "@drora/shared";
import type { PluginReferenceCatalogEntry } from "@drora/contracts";
import { resolveSuggestedPluginReference } from "../src/drora-protocol/plugin-reference-catalog.js";
import type { DroraProtocolAgentServerContext } from "../src/drora-protocol/server-types.js";

const STABLE_ID = "document-skills@drora-plugins-official";
const WORKSPACE = { workspacePath: "/workspace", workspaceKey: "ssh://host/workspace" };
const DESKTOP_BOUNDARY = {
  operationId: "suggested-test",
  clientMode: "desktop-continuous" as const,
  deliveryKind: "desktop-continuous" as const,
};
const notify = vi.fn();

function protocolContext(): DroraProtocolAgentServerContext {
  return { notify } as unknown as DroraProtocolAgentServerContext;
}

function catalogEntry(
  overrides: Partial<PluginReferenceCatalogEntry> = {},
): PluginReferenceCatalogEntry {
  return {
    pluginId: STABLE_ID,
    name: "document-skills",
    marketplace: "drora-plugins-official",
    enabled: true,
    conflictingPluginIds: [],
    skillQualifiedNames: ["document-skills:pdf"],
    mcpServerNames: [],
    subagentNames: [],
    rootPath: "/plugins/document-skills",
    ...overrides,
  };
}

function overviewCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: STABLE_ID,
    name: "document-skills",
    marketplace: "drora-plugins-official",
    installed: false,
    listing: { displayName: "Document skills" },
    ...overrides,
  };
}

describe("plugins/resolveSuggestedReference protocol", () => {
  let entries: PluginReferenceCatalogEntry[];

  beforeEach(() => {
    entries = [];
    mocks.buildPluginReferenceCatalog.mockReset();
    mocks.buildPluginReferenceCatalog.mockImplementation(() => ({ plugins: entries }));
    mocks.resolveDroraPlugins.mockReset();
    mocks.resolveDroraPlugins.mockReturnValue({ diagnostics: [], plugins: [] });
    mocks.updateDroraPluginMarketplace.mockReset();
    mocks.updateDroraPluginMarketplace.mockResolvedValue({ diagnostics: [], marketplaces: [] });
    mocks.getDroraPluginsOverview.mockReset();
    mocks.getDroraPluginsOverview.mockReturnValue({
      availablePlugins: [],
      diagnostics: [],
      installedPlugins: [],
      marketplaces: [],
      restorableBuiltins: [],
    });
    notify.mockReset();
  });

  it("registers a strict request/result contract with operation and delivery boundaries", () => {
    expect(droraPluginOperationStateSchema.parse("cancelling")).toBe("cancelling");
    expect(droraPluginOperationStateSchema.parse("cancelled")).toBe("cancelled");
    expect(
      droraPluginOperationProgressNotificationSchema.parse({
        operationId: "suggested-1",
        state: "refreshing",
      }),
    ).toEqual({ operationId: "suggested-1", state: "refreshing" });
    expect(() =>
      droraPluginOperationProgressNotificationSchema.parse({
        operationId: "suggested-1",
        state: "refreshing",
        unexpected: true,
      }),
    ).toThrow();
    expect(
      droraPluginsResolveSuggestedReferenceParamsSchema.parse({
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        operationId: "suggested-1",
        clientMode: "web-remote-replayable",
        deliveryKind: "web-remote-replayable",
      }),
    ).toEqual({
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      operationId: "suggested-1",
      clientMode: "web-remote-replayable",
      deliveryKind: "web-remote-replayable",
    });
    expect(() =>
      droraPluginsResolveSuggestedReferenceParamsSchema.parse({
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        operationId: "suggested-missing-client-mode",
        deliveryKind: "desktop-continuous",
      }),
    ).toThrow();
    expect(() =>
      droraPluginsResolveSuggestedReferenceParamsSchema.parse({
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        clientMode: "desktop-continuous",
        deliveryKind: "desktop-continuous",
      }),
    ).toThrow();
    expect(() =>
      droraPluginsResolveSuggestedReferenceParamsSchema.parse({
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      droraPluginsResolveSuggestedReferenceResultSchema.parse({
        stableId: STABLE_ID,
        status: "missing",
        diagnostics: [],
      }),
    ).toThrow(/trusted install identity/);
    expect(
      droraPluginsResolveSuggestedReferenceResultSchema.parse({
        stableId: STABLE_ID,
        status: "ready",
        marketplace: "drora-plugins-official",
        pluginName: "document-skills",
        sourceTrust: "official",
        icon: "https://cdn.example/plugin.svg",
        diagnostics: [],
      }).icon,
    ).toBe("https://cdn.example/plugin.svg");
  });

  it("rejects non-official stable IDs without refreshing any marketplace", async () => {
    const result = await resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: "document-skills@personal",
      ...DESKTOP_BOUNDARY,
    });

    expect(result.status).toBe("unavailable");
    expect(result.diagnostics[0]?.code).toBe("plugin_suggested_reference_untrusted_source");
    expect(mocks.updateDroraPluginMarketplace).not.toHaveBeenCalled();
    expect(() => droraPluginsResolveSuggestedReferenceResultSchema.parse(result)).not.toThrow();
  });

  it.each([
    ["ready", true],
    ["disabled", false],
  ] as const)(
    "returns %s for an installed official plugin without refreshing",
    async (status, enabled) => {
      entries = [catalogEntry({ enabled })];
      mocks.getDroraPluginsOverview.mockReturnValue({
        availablePlugins: [
          overviewCandidate({
            installed: true,
            listing: { icon: "https://cdn.example/document-skills.svg" },
          }),
        ],
        diagnostics: [],
        installedPlugins: [],
        marketplaces: [],
        restorableBuiltins: [],
      });

      const result = await resolveSuggestedPluginReference(protocolContext(), {
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        ...DESKTOP_BOUNDARY,
      });

      expect(result).toMatchObject({
        stableId: STABLE_ID,
        status,
        marketplace: "drora-plugins-official",
        pluginName: "document-skills",
        sourceTrust: "official",
        icon: "https://cdn.example/document-skills.svg",
      });
      expect(mocks.updateDroraPluginMarketplace).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    },
  );

  it("refreshes only drora-plugins-official before exposing a missing candidate", async () => {
    mocks.getDroraPluginsOverview.mockReturnValue({
      availablePlugins: [
        overviewCandidate({ listing: { icon: "https://cdn.example/document-skills.svg" } }),
      ],
      diagnostics: [],
      installedPlugins: [],
      marketplaces: [],
      restorableBuiltins: [],
    });

    const result = await resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      operationId: "suggested-2",
      clientMode: "desktop-continuous",
      deliveryKind: "desktop-continuous",
    });

    expect(mocks.updateDroraPluginMarketplace).toHaveBeenCalledOnce();
    expect(mocks.updateDroraPluginMarketplace).toHaveBeenCalledWith(
      expect.objectContaining({
        marketplace: "drora-plugins-official",
        workingDirectory: "/workspace",
      }),
    );
    expect(notify).toHaveBeenCalledWith({
      method: "plugins/operationProgress",
      params: { operationId: "suggested-2", state: "refreshing" },
    });
    expect(result).toMatchObject({
      stableId: STABLE_ID,
      status: "missing",
      marketplace: "drora-plugins-official",
      pluginName: "document-skills",
      sourceTrust: "official",
      icon: "https://cdn.example/document-skills.svg",
    });
  });

  it("emits refreshing after the first local miss and before marketplace refresh settles", async () => {
    let settleRefresh!: (value: { diagnostics: never[]; marketplaces: never[] }) => void;
    mocks.updateDroraPluginMarketplace.mockReturnValue(
      new Promise((resolve) => {
        settleRefresh = resolve;
      }),
    );
    const pending = resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      operationId: "suggested-progress",
      clientMode: "desktop-continuous",
      deliveryKind: "desktop-continuous",
    });

    await vi.waitFor(() => {
      expect(notify).toHaveBeenCalledWith({
        method: droraProtocolNotifications.pluginOperationProgress,
        params: { operationId: "suggested-progress", state: "refreshing" },
      });
    });
    expect(mocks.updateDroraPluginMarketplace).toHaveBeenCalledOnce();

    settleRefresh({ diagnostics: [], marketplaces: [] });
    await expect(pending).resolves.toMatchObject({ status: "unavailable" });
  });

  it("fails closed after a refresh failure even when an old snapshot still has a candidate", async () => {
    mocks.updateDroraPluginMarketplace.mockResolvedValue({
      diagnostics: [
        {
          code: "plugin_archive_fetch_failed",
          message: "offline",
          pluginId: "drora-plugins-official",
          severity: "error",
        },
      ],
      marketplaces: [],
    });
    mocks.getDroraPluginsOverview.mockReturnValue({
      availablePlugins: [overviewCandidate()],
      diagnostics: [],
      installedPlugins: [],
      marketplaces: [],
      restorableBuiltins: [],
    });

    const result = await resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      ...DESKTOP_BOUNDARY,
    });

    expect(result.status).toBe("unavailable");
    expect(result.diagnostics[0]?.code).toBe("marketplace_refresh_failed");
    expect(mocks.getDroraPluginsOverview).not.toHaveBeenCalled();
  });

  it("fails closed and aborts the official marketplace refresh at ten seconds", async () => {
    let refreshSignal: AbortSignal | undefined;
    mocks.updateDroraPluginMarketplace.mockImplementation(
      (options: { abortSignal?: AbortSignal }) => {
        refreshSignal = options.abortSignal;
        return new Promise(() => {});
      },
    );

    vi.useFakeTimers();
    try {
      const pending = resolveSuggestedPluginReference(protocolContext(), {
        workspace: WORKSPACE,
        stableId: STABLE_ID,
        ...DESKTOP_BOUNDARY,
      });
      await Promise.resolve();
      expect(refreshSignal).toBeInstanceOf(AbortSignal);

      vi.advanceTimersByTime(9_999);
      await Promise.resolve();
      expect(refreshSignal?.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      const result = await pending;

      expect(refreshSignal?.aborted).toBe(true);
      expect(result.status).toBe("unavailable");
      expect(result.diagnostics[0]?.code).toBe("marketplace_refresh_failed");
      expect(mocks.getDroraPluginsOverview).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports cancellation separately from marketplace refresh failure", async () => {
    const controller = new AbortController();
    mocks.updateDroraPluginMarketplace.mockImplementation(async () => {
      controller.abort();
      throw controller.signal.reason;
    });

    const result = await resolveSuggestedPluginReference(
      protocolContext(),
      { workspace: WORKSPACE, stableId: STABLE_ID, ...DESKTOP_BOUNDARY },
      controller.signal,
    );

    expect(result.status).toBe("unavailable");
    expect(result.diagnostics[0]?.code).toBe("plugin_operation_cancelled");
  });

  it("re-resolves installed state from the refreshed catalog", async () => {
    mocks.updateDroraPluginMarketplace.mockImplementation(async () => {
      entries = [catalogEntry()];
      return { diagnostics: [], marketplaces: [] };
    });

    const result = await resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      ...DESKTOP_BOUNDARY,
    });

    expect(mocks.resolveDroraPlugins).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("ready");
  });

  it("rejects a disappeared or identity-mismatched candidate after refresh", async () => {
    mocks.getDroraPluginsOverview.mockReturnValue({
      availablePlugins: [overviewCandidate({ marketplace: "personal" })],
      diagnostics: [],
      installedPlugins: [],
      marketplaces: [],
      restorableBuiltins: [],
    });

    const result = await resolveSuggestedPluginReference(protocolContext(), {
      workspace: WORKSPACE,
      stableId: STABLE_ID,
      ...DESKTOP_BOUNDARY,
    });

    expect(result.status).toBe("unavailable");
    expect(result.diagnostics[0]?.code).toBe("plugin_suggested_reference_not_listed");
  });
});
