/**
 * P8 台账刷新环路（09 详设 §1.2 v2 定案；从 assistantTicketsService 拆出——单文件
 * ≤800 行纪律，先例：configActions/mateThread/manageActions 拆分；行为逐行等价）。
 *
 * 节流入口 refreshInventory（sessions-index delta / tasks-index 回调 → host face →
 * 本入口）：最小间隔 kv `inventory_refresh_interval_ms` 可调（缺省 30s，contracts
 * ASSISTANT_INVENTORY_DEFAULTS）——前沿节流防高频会话帧放大 publish，尾沿定时器补一拍
 * 保证突发末帧状态最终落账（单定时器、dispose 收口，非轮询——「零新轮询」红线不受
 * 影响）。任何一次 publish（含工单事件路径）都算「台账新鲜」基准。
 */
import type { AssistantDatabase } from "./assistantDatabase.js";
import { readAssistantInventoryRefreshIntervalMs, readAssistantKv } from "./assistantConfig.js";

export function createInventoryRefreshLoop(deps: {
  readonly db: AssistantDatabase;
  readonly publish: () => void;
}): {
  /** 节流刷新入口（host face refreshInventory 同名透传）。 */
  refreshInventory(): void;
  /** publish 侧「台账新鲜」基准标记（任何一次 publish——含工单事件路径——都算新基准）。 */
  markFresh(): void;
  /** 尾沿定时器收口（防 dispose 后定时器再 publish 打已关库；服务 dispose 统一调用）。 */
  dispose(): void;
} {
  const { db, publish } = deps;
  let lastInventorySnapshotMs = 0;
  let inventoryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  function clearTimer(): void {
    if (inventoryRefreshTimer === null) return;
    clearTimeout(inventoryRefreshTimer);
    inventoryRefreshTimer = null;
  }
  function refreshInventory(): void {
    const intervalMs = readAssistantInventoryRefreshIntervalMs((key) =>
      readAssistantKv(db.raw, key),
    );
    const elapsed = Date.now() - lastInventorySnapshotMs;
    if (elapsed >= intervalMs) {
      clearTimer();
      publish();
      return;
    }
    if (inventoryRefreshTimer === null) {
      inventoryRefreshTimer = setTimeout(() => {
        inventoryRefreshTimer = null;
        publish();
      }, intervalMs - elapsed);
    }
  }
  return {
    refreshInventory,
    markFresh: () => {
      lastInventorySnapshotMs = Date.now();
    },
    dispose: clearTimer,
  };
}
