import type { MobilePairingRuntimeState } from "@zcode/shared";

export type WebRemoteControlTransport = "lan" | "relay";

/** 当前 tab 只消费本传输的运行状态；旧生产方未携带 transport 时按兼容语义处理。 */
export function stateMatchesTransport(
  state: Pick<MobilePairingRuntimeState, "transport">,
  tab: WebRemoteControlTransport,
): boolean {
  if (!state.transport) return true;
  return tab === "relay" ? state.transport === "cloud" : state.transport === "lan";
}

/**
 * 修复依据：Main 的 idle 是自动开启命令的准入事实，不能在 tab 过滤时先丢弃。
 * 仅非 idle 状态携带有效传输归属，其他传输的运行态才应从当前 tab 投影中排除。
 */
export function selectWebRemoteControlTabState<
  T extends Pick<MobilePairingRuntimeState, "status" | "transport">,
>(state: T | undefined, tab: WebRemoteControlTransport): T | undefined {
  if (!state) return undefined;
  return state.status === "idle" || stateMatchesTransport(state, tab) ? state : undefined;
}

/**
 * 弹层自动开启闸门（spec: mobile-web-remote.md「Renderer 集成面」）：
 * 每次弹层打开、每个传输至多自动开启一次。
 *
 * 修复背景（2026-09-27）：此前是跨传输共享的单一布尔——默认传输 LAN 在弹层打开时
 * 消耗掉唯一名额后，切到“云中继”tab 永远不会再自动开启，而 relay 未运行时弹层内
 * 又没有手动开启入口，二维码区停在无超时的“正在准备二维码”分支。
 */
export function createWebRemoteControlAutoStartGate() {
  const started = new Set<WebRemoteControlTransport>();
  return {
    /** 弹层关闭时清空全部名额（下次打开每个传输都可再自动开启一次）。 */
    reset(): void {
      started.clear();
    },
    /**
     * 服务未运行（idle）且该传输本次打开还未自动开启过时准许，并占用该传输名额；
     * state 为 undefined（平台未提供查询方法，如 Web）时一律拒绝，与修复前行为一致。
     */
    admit(
      state: Pick<MobilePairingRuntimeState, "status"> | undefined,
      transport: WebRemoteControlTransport,
    ): boolean {
      if (state?.status !== "idle" || started.has(transport)) return false;
      started.add(transport);
      return true;
    },
  };
}
