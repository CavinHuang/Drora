// 首页 sessions-index 展示投影的唯一装配点（specs/mobile-relay-r3-frontend.md §21）。
// App 持有桥生命周期与摘要投影；窄首页和宽侧栏只读同一结果。Host/CLI 仍拥有会话真相。
import { useEffect, useMemo, useRef, useState } from "react";
import type { SessionSummary } from "@drora/shared/drora-protocol-v4";
import { mergeHomeWorkspaceLiveness } from "./sessionsIndexStore.js";
import type { HomeSessionsIndexBridge } from "./taskSession.js";
import type { ProjectedWorkspace } from "./entry.js";

export type OpenHomeSessionsIndexBridge = (
  workspacePath: string,
  workspaceIdentity?: string,
) => Promise<HomeSessionsIndexBridge>;

/** 双视口展示边界：sessions-index 只提升运行态；空闲/完成以 Host 任务摘要为准。 */
export function projectHomeWorkspacesWithLiveness(
  workspaces: readonly ProjectedWorkspace[],
  summariesByKey: ReadonlyMap<string, readonly SessionSummary[]>,
): ProjectedWorkspace[] {
  return workspaces.map((workspace) => {
    const sourceStatusById = new Map(workspace.tasks.map((task) => [task.sessionId, task.status]));
    const merged = mergeHomeWorkspaceLiveness(
      workspace,
      summariesByKey.get(workspace.workspaceKey) ?? [],
    );
    return {
      ...workspace,
      tasks: merged.tasks.map((task) => ({
        ...task,
        // 会话已结束不等于任务摘要显式 completed；官方真 Host 的空串状态显示空闲。
        status:
          task.status === "running"
            ? ("running" as const)
            : sourceStatusById.get(task.sessionId) === "completed"
              ? ("completed" as const)
              : ("idle" as const),
      })),
    };
  });
}

export function useHomeSessionsIndex(
  workspaces: readonly ProjectedWorkspace[],
  openSessionsIndexBridge?: OpenHomeSessionsIndexBridge,
): ProjectedWorkspace[] {
  const bridgesRef = useRef(
    new Map<string, { bridge: HomeSessionsIndexBridge; unsubscribe: () => void }>(),
  );
  const pendingKeysRef = useRef(new Map<string, symbol>());
  const wantedKeysRef = useRef<ReadonlySet<string>>(new Set());
  const unmountedRef = useRef(false);
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  // App 的 bridge 工厂可能随渲染改变函数身份；生命周期仅随工作区 key 集改变。
  const openBridgeRef = useRef(openSessionsIndexBridge);
  openBridgeRef.current = openSessionsIndexBridge;
  const [summariesByKey, setSummariesByKey] = useState<
    ReadonlyMap<string, readonly SessionSummary[]>
  >(() => new Map());
  const workspaceKeysSig = useMemo(
    () => workspaces.map((workspace) => workspace.workspaceKey).join("\u0000"),
    [workspaces],
  );

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      for (const entry of bridgesRef.current.values()) {
        entry.unsubscribe();
        void entry.bridge.close().catch(() => {});
      }
      bridgesRef.current.clear();
      pendingKeysRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const openBridge = openBridgeRef.current;
    const bridges = bridgesRef.current;
    const pending = pendingKeysRef.current;
    const wanted = new Set(
      openBridge ? workspacesRef.current.map((workspace) => workspace.workspaceKey) : [],
    );
    wantedKeysRef.current = wanted;
    for (const [key, entry] of bridges) {
      if (wanted.has(key)) continue;
      bridges.delete(key);
      entry.unsubscribe();
      void entry.bridge.close().catch(() => {});
    }
    // 移除的工作区作废在途开桥 token；旧异步结果即使迟到也只能自行 close。
    for (const key of pending.keys()) if (!wanted.has(key)) pending.delete(key);
    setSummariesByKey((previous) => {
      if ([...previous.keys()].every((key) => wanted.has(key))) return previous;
      return new Map([...previous].filter(([key]) => wanted.has(key)));
    });
    if (!openBridge) return;
    for (const workspace of workspacesRef.current) {
      const key = workspace.workspaceKey;
      if (bridges.has(key) || pending.has(key)) continue;
      const token = Symbol(key);
      pending.set(key, token);
      const identity = key !== workspace.path ? key : undefined;
      void (async () => {
        let bridge: HomeSessionsIndexBridge | null = null;
        let registered = false;
        try {
          bridge = await openBridge(workspace.path, identity);
          if (unmountedRef.current || pending.get(key) !== token || !wantedKeysRef.current.has(key))
            return;
          const subscriptionId = await bridge.start();
          if (
            subscriptionId === null ||
            unmountedRef.current ||
            pending.get(key) !== token ||
            !wantedKeysRef.current.has(key)
          )
            return;
          const readyBridge = bridge;
          const publish = () => {
            const summaries = readyBridge.store.getSessionSummaries();
            setSummariesByKey((previous) =>
              previous.get(key) === summaries ? previous : new Map(previous).set(key, summaries),
            );
          };
          const unsubscribe = readyBridge.store.subscribe(publish);
          bridges.set(key, { bridge: readyBridge, unsubscribe });
          registered = true;
          publish();
        } catch {
          // 开桥/订阅失败只降级当前工作区投影；existing-only 不拉起新 runtime。
        } finally {
          if (!registered && bridge) void bridge.close().catch(() => {});
          if (pending.get(key) === token) pending.delete(key);
        }
      })();
    }
  }, [workspaceKeysSig, openSessionsIndexBridge !== undefined]);

  return useMemo(
    () => projectHomeWorkspacesWithLiveness(workspaces, summariesByKey),
    [workspaces, summariesByKey],
  );
}
