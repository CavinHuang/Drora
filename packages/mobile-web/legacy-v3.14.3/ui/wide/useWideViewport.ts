// R3 P5b 宽视口断点订阅（specs/mobile-relay-r3-frontend.md §19）：官方字面
// `(max-width: 767px)` 的 width-only matchMedia，命中取反即 ≥768px 宽壳。
// 判定与缺省语义收口在 wideShellModel.isWideViewport（matchMedia 缺失/抛错 → 窄壳零回归）；
// 本 hook 只做订阅接线：change 事件驱动重渲染，卸载摘除监听。
import { useEffect, useState } from "react";
import { MOBILE_WIDE_BREAKPOINT_QUERY, isWideViewport } from "./wideShellModel.js";

function getMatchMedia(): ((query: string) => { matches: boolean }) | null {
  if (typeof window === "undefined") return null;
  try {
    return window.matchMedia.bind(window);
  } catch {
    return null;
  }
}

export function useWideViewport(): boolean {
  const [wide, setWide] = useState(() => isWideViewport(getMatchMedia()));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(MOBILE_WIDE_BREAKPOINT_QUERY);
    // 订阅后立即对齐一次，避免首帧读取与订阅之间窗口尺寸变化留下的陈旧值。
    setWide(!mql.matches);
    const onChange = (event: MediaQueryListEvent) => setWide(!event.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return wide;
}
