import { useEffect, useState } from "react";
import type { MobilePairingRuntimeState, MobileRelayTaskSyncEntry } from "@drora/shared";
import { useGlobalTaskList } from "@/hooks/useGlobalTaskList.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

/**
 * 云中继远控的任务同步器（对齐官方 Root 挂载的隐藏推送组件 AMn）：
 * relay 运行期间把跨工作区任务时间线推给 main（syncWebRemoteControlTasks），
 * 作为手机页 bootstrap 任务种子的数据源。不渲染任何 UI。
 *
 * 挂载条件与官方一致：relay 运行中（running/active）且平台提供同步方法；
 * 订阅生命周期跟随挂载，relay 停止即卸载，不常驻占用。
 */
export function WebRemoteControlTaskSync(props: { workspaceTabs: WorkspaceTabState[] }) {
  const platform = usePlatform();
  const [relayRunning, setRelayRunning] = useState(false);

  useEffect(() => {
    if (!platform.getMobileRelayControlState || !platform.onMobileRelayStateChanged) {
      return;
    }
    let disposed = false;
    const apply = (state: MobilePairingRuntimeState) => {
      if (!disposed) setRelayRunning(state.running);
    };
    void platform
      .getMobileRelayControlState()
      .then(apply)
      .catch(() => {});
    const dispose = platform.onMobileRelayStateChanged(apply);
    return () => {
      disposed = true;
      dispose();
    };
  }, [platform]);

  if (!relayRunning || !platform.syncWebRemoteControlTasks) {
    return null;
  }
  return <WebRemoteControlTaskSyncActive workspaceTabs={props.workspaceTabs} />;
}

function WebRemoteControlTaskSyncActive(props: { workspaceTabs: WorkspaceTabState[] }) {
  const platform = usePlatform();
  const { items, loading } = useGlobalTaskList({
    kind: "timeline",
    workspaceTabs: props.workspaceTabs,
    sortBy: "updated",
    searchQuery: "",
    expanded: true,
    collapsedLimit: 100,
  });

  useEffect(() => {
    // 首次加载完成前不推空列表，避免覆盖 main 侧已有种子。
    if (loading) return;
    const tasks: MobileRelayTaskSyncEntry[] = items.map((item) => ({
      taskId: item.taskId,
      title: item.title,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt,
      workspacePath: item.workspacePath,
      ...(item.workspaceIdentity ? { workspaceIdentity: item.workspaceIdentity } : {}),
      ...(item.remoteSessionId ? { remoteSessionId: item.remoteSessionId } : {}),
    }));
    platform.syncWebRemoteControlTasks?.(tasks);
  }, [items, loading, platform]);

  return null;
}
