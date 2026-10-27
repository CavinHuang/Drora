/**
 * R3 移动壳组件族（spec docs/web-remote-control/web-remote-control-architecture.md。
 * 纯展示组件：数据与动作全部 props 注入，不接数据面、不路由；
 * 装配（RootShell 能力位分支、官方 Web 入口接线）为后续任务。
 */
export {
  MobileLoadingCard,
  MobileConnectionStatusCard,
  MobileFailureCard,
  MOBILE_FAILURE_CARD_TONES,
  mobileFailureCodeFromWire,
} from "./StatusCards.js";
export type {
  MobileConnectionPhase,
  MobileFailureCardTone,
  MobileFailureCode,
  MobileLoadingCardProps,
  MobileConnectionStatusCardProps,
  MobileFailureCardProps,
} from "./StatusCards.js";
export { MobileHomeShell } from "./MobileHomeShell.js";
export type {
  MobileHomeShellProps,
  MobileHomeShellTask,
  MobileHomeShellWorkspace,
  MobileHomeConnectionState,
} from "./MobileHomeShell.js";
export { MobileTaskShell } from "./MobileTaskShell.js";
export type { MobileTaskShellProps } from "./MobileTaskShell.js";
