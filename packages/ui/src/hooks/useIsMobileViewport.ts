import { useEffect, useState } from "react";

const MOBILE_VIEWPORT_QUERY =
  "(max-width: 767px) and (hover: none) and (pointer: coarse)";

/**
 * 移动触屏视口判定（手机/平板窄屏；对齐原版 PR() 的 matchMedia 条件）。
 * 消费方：权限弹窗反馈输入框的 iOS 聚焦防缩放（text-mobile-input-safe 16px 档）、
 * SessionPane/Composer 的 /side 斜杠命令与自动聚焦策略抑制。
 * 订阅式：matchMedia 变化即时反映。
 */
export function useIsMobileViewport(): boolean {
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const sync = () => setIsMobileViewport(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return isMobileViewport;
}
