// 还原自发行 bundle（官方 3.17.2 / 0.6.5）：packages/zcode-cua/dist/broker/server/
// ghostCursorTurnLifecycle.js 原样还原。证据：官方 Helper SEA offset 85745356-85746004
// （SHA256 36ba7e600dce3cc715bdf278459fedb89eb9622dfbd8278abe9811f0717cad2b）。
// shipped 实现已演进过上游设计文档（docs/cua/producer/ghost-cursor-turn-end-hide.md 的
// withGhostCursorTurnEndHide 全局 running 判据）：per-session 化——turn-ended 立即隐藏
// **该 session 的组**，不再受 anyTurnRunning 布尔守卫（A 结束不藏 B）。
// 配无 ghost 面的旧 addon 时 hideSessionCursor/removeSessionCursor 经可选链安全
// no-op（现行自建 74 面 addon 自 W2 批起已含该二导出，真实生效；helperMain 装配处
// 传 options.native.ghostSessionTurnEnd?.()）。

export interface PipSessionLifecycleEffects {
  focusChanged: (event: any) => void;
  turnStarted: (event: any) => void;
  turnEnded: (event: any) => void;
  sessionClosed: (event: any) => void;
  captureAccepted: (binding: any) => void;
}

export interface GhostCursorSessionLifecycleOptions {
  hideSessionCursor: (sessionId: string) => void;
  removeSessionCursor: (sessionId: string) => void;
}

export function withGhostCursorSessionLifecycle(
  effects: PipSessionLifecycleEffects,
  options: GhostCursorSessionLifecycleOptions,
): PipSessionLifecycleEffects {
  return {
    focusChanged: (event) => effects.focusChanged(event),
    turnStarted: (event) => effects.turnStarted(event),
    turnEnded(event) {
      try {
        effects.turnEnded(event);
      } finally {
        options.hideSessionCursor(event.sessionId);
      }
    },
    sessionClosed(event) {
      try {
        effects.sessionClosed(event);
      } finally {
        options.removeSessionCursor(event.sessionId);
      }
    },
    captureAccepted: (binding) => effects.captureAccepted(binding),
  };
}
