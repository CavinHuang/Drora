/**
 * ui-mate 公开入口：宿主 ui 模块（store/hooks/组件/i18n/app-shell 容器）经此消费 Mate
 * 契约类型、视图模型纯函数与面板组件；模块内部分组/实现细节不经此入口外泄。
 */
export {
  MATE_UNTARGETED_WORKSPACE_KEY,
  deriveMateViewModel,
  isMateActiveTicket,
  isMateObserveDecision,
  isMatePendingDecision,
  resolveMateBudgetActive,
  resolveMateErrorMessageId,
} from "./view-model.js";
export type {
  MateErrorMessageId,
  MateFilter,
  MateViewModel,
  MateViewCounts,
} from "./view-model.js";
export type { MateLocalUiState } from "./contract.js";
export { mateTicketLampTone, MATE_LAMP_TONE_CLASS } from "./statusTone.js";
export type { MateLampTone } from "./statusTone.js";
export { MateLamp } from "./MateLamp.js";
export { MatePaneHeader } from "./MatePaneHeader.js";
export { MateTrustBar } from "./MateTrustBar.js";
export { MateWorkspaceGroup } from "./MateWorkspaceGroup.js";
export { MateDecisionCard } from "./MateDecisionCard.js";
export { MateTicketRow, firstPreviewLine } from "./MateTicketRow.js";
export { MateReportCard } from "./MateReportCard.js";
export { MateObserveRow } from "./MateObserveRow.js";
export { MateConfigSection } from "./MateConfigSection.js";
