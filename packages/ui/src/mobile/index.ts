/**
 * R3 移动壳组件族（spec specs/mobile-relay-r3-frontend.md D1）。
 * 纯展示组件：数据与动作全部 props 注入，不接数据面、不路由；
 * 装配（RootShell 能力位分支、relay-client 接线）为后续任务。
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
