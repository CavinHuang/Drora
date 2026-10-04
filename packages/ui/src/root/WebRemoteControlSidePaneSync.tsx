// §33.18.16 侧板初态投影的 renderer 推送器（镜像 WebRemoteControlTaskSync 模式）：
// relay 运行期间把桌面窗口侧板当前 tab（手机映射词表：审查→review、终端→terminal、
// 其余→null）推给 main（syncWebRemoteControlSidePane），作为手机页侧板初值与活体
// 跟随的数据源。不渲染任何 UI；relay 停止即卸载，不常驻占用。
import { useEffect, useState } from "react";
import type { MobilePairingRuntimeState, MobileRelaySidePaneSyncEntry } from "@zcode/shared";
import type { WorkspaceSidePaneTab } from "@/lib/workspaceSidePane.js";
import { usePlatform } from "@/hooks/usePlatform.js";

/** 桌面侧板 tab 类型 → 手机映射词表（§33.18.16 映射 D：其余类型一律 null）。 */
export function mapDesktopSidePaneTab(
  tab: WorkspaceSidePaneTab | null,
): MobileRelaySidePaneSyncEntry["tab"] {
  if (tab?.type === "git") return "review";
  if (tab?.type === "terminal") return "terminal";
  return null;
}

export function WebRemoteControlSidePaneSync(props: { activeTab: WorkspaceSidePaneTab | null }) {
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

  const tab = mapDesktopSidePaneTab(props.activeTab);

  useEffect(() => {
    if (!relayRunning || !platform.syncWebRemoteControlSidePane) return;
    // relay 恢复运行沿：先补推当前值（新会话 bootstrap 初值），随后 tab 变化沿推。
    platform.syncWebRemoteControlSidePane({ tab });
  }, [relayRunning, tab, platform]);

  return null;
}
