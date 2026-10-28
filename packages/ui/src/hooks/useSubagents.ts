import type { DroraProvider } from "@drora/shared";
import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useServices } from "./useServices.js";
import { useResolvedRemoteWorkspaceSessionId } from "@/hooks/useResolvedRemoteWorkspaceSessionId.js";
import { shouldEnableWorkspaceRpc } from "@/lib/workspaceRpcAvailability.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab, type WindowTabState, type WorkspaceTabState } from "@/store/tabStore.js";
import { getSubagentsContextKey, useSubagentsContextStore } from "@/store/subagentsContextStore.js";
import { useSubagentsStore } from "@/store/subagentsStore.js";

export function useSubagents(
  workspacePath: string | null,
  provider: DroraProvider,
  explicitWorkspaceIdentity?: string,
) {
  const { subagentsService } = useServices();
  const explicitIdentity = explicitWorkspaceIdentity?.trim() || undefined;
  const workspaceRpcTarget = useTabStore(
    useShallow((state) => {
      if (!workspacePath) {
        return {
          workspaceIdentity: undefined,
          preferredRemoteSessionId: undefined,
          remoteTarget: undefined,
        };
      }

      const activeWorkspaceTab = state.activeTabId
        ? state.tabs.find((tab) => tab.id === state.activeTabId)
        : undefined;
      const matchesRequestedScope = (tab: WindowTabState): tab is WorkspaceTabState =>
        isWorkspaceTab(tab) &&
        tab.workspacePath === workspacePath &&
        (!explicitIdentity || tab.workspaceIdentity?.trim() === explicitIdentity);
      const matchedWorkspaceTab =
        activeWorkspaceTab && matchesRequestedScope(activeWorkspaceTab)
          ? activeWorkspaceTab
          : state.tabs.find(matchesRequestedScope);

      return {
        workspaceIdentity: matchedWorkspaceTab?.workspaceIdentity,
        preferredRemoteSessionId: matchedWorkspaceTab?.remoteSessionId,
        remoteTarget: matchedWorkspaceTab?.remoteTarget,
      };
    }),
  );
  const workspaceIdentity = explicitIdentity || workspaceRpcTarget.workspaceIdentity;
  const remoteSessionId = useResolvedRemoteWorkspaceSessionId(
    workspacePath,
    workspaceRpcTarget.preferredRemoteSessionId,
    workspaceIdentity,
    workspaceRpcTarget.remoteTarget,
  );
  const workspaceRpcEnabled = shouldEnableWorkspaceRpc({
    workspaceIdentity,
    remoteSessionId,
    remoteTarget: workspaceRpcTarget.remoteTarget,
  });
  // service 缺席（官网 hero mock 的 ServiceProvider 只聚合展示面、SSR 渲染链）时
  // 不查上下文键——getSubagentsContextKey 会以 service 作 WeakMap 键，undefined 入键
  // 直接 TypeError（main 99ab7901 起官网 Pages 部署实证）。语义同「无 service 即无
  // subagents 上下文可查」，与 workspacePath 空值同路。
  const contextKey =
    workspacePath && subagentsService
      ? getSubagentsContextKey(workspacePath, provider, workspaceIdentity, subagentsService)
      : null;
  const context = useSubagentsContextStore((state) =>
    contextKey ? state.contexts[contextKey] : undefined,
  );
  const initialize = useSubagentsContextStore((state) => state.initialize);
  const refreshStore = useSubagentsContextStore((state) => state.refresh);
  const setEnabledStore = useSubagentsContextStore((state) => state.setEnabled);
  const legacyContext = useSubagentsStore(
    useShallow((state) => ({
      workspacePath: state.loadedWorkspacePath,
      workspaceIdentity: state.loadedWorkspaceIdentity,
      provider: state.loadedProvider,
      agents: state.agents,
      capability: state.capability,
      loading: state.loading,
      error: state.error,
    })),
  );
  const useLegacyContext =
    workspacePath !== null &&
    legacyContext.workspacePath === workspacePath &&
    legacyContext.workspaceIdentity === (workspaceIdentity ?? null) &&
    legacyContext.provider === provider;

  useEffect(() => {
    if (!workspacePath || !workspaceRpcEnabled) {
      // 远程 workspace 断连或 session 尚未重挂时，@ 面板会随输入框挂载预加载子智能体。
      // 这里先跳过 workspace RPC，避免 disconnected proxy 的内部错误码显示成红色子智能体提示。
      return;
    }
    if (context) return;
    void initialize(workspacePath, provider, subagentsService, workspaceIdentity);
  }, [
    context,
    initialize,
    provider,
    subagentsService,
    workspaceIdentity,
    workspacePath,
    workspaceRpcEnabled,
  ]);

  const refresh = useCallback(async () => {
    if (!workspaceRpcEnabled) {
      return;
    }
    if (!workspacePath) return;
    await refreshStore(workspacePath, provider, subagentsService, workspaceIdentity);
  }, [
    provider,
    refreshStore,
    subagentsService,
    workspaceIdentity,
    workspacePath,
    workspaceRpcEnabled,
  ]);

  const setEnabled = useCallback(
    async (agentId: string, enabled: boolean) => {
      if (!workspaceRpcEnabled) {
        return;
      }
      if (!workspacePath) return;
      await setEnabledStore(
        workspacePath,
        provider,
        agentId,
        enabled,
        subagentsService,
        workspaceIdentity,
      );
    },
    [
      provider,
      setEnabledStore,
      subagentsService,
      workspaceIdentity,
      workspacePath,
      workspaceRpcEnabled,
    ],
  );

  return useMemo(
    () => ({
      agents: workspaceRpcEnabled
        ? useLegacyContext
          ? legacyContext.agents
          : (context?.agents ?? [])
        : [],
      capability: workspaceRpcEnabled
        ? useLegacyContext
          ? legacyContext.capability
          : (context?.capability ?? null)
        : null,
      loading:
        workspaceRpcEnabled && workspacePath !== null
          ? useLegacyContext
            ? legacyContext.loading
            : !context || context.loading
          : false,
      error: workspaceRpcEnabled
        ? useLegacyContext
          ? legacyContext.error
          : (context?.error ?? null)
        : null,
      refresh,
      setEnabled,
    }),
    [
      context,
      legacyContext,
      refresh,
      setEnabled,
      useLegacyContext,
      workspacePath,
      workspaceRpcEnabled,
    ],
  );
}
