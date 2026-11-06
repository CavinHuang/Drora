/**
 * ui-mate 公开入口：宿主 ui 模块（store/hooks/组件/i18n/app-shell 容器）经此消费 Mate
 * 契约类型、视图模型纯函数与面板组件；模块内部分组/实现细节不经此入口外泄。
 */
export {
  MATE_UNTARGETED_WORKSPACE_KEY,
  deriveMateStatusLine,
  deriveMateViewModel,
  findMateDecisionForTicket,
  isMateActiveTicket,
  isMateAutoNoticeDecision,
  isMateAutoSwitchAvailable,
  isMateAwaitingVerification,
  isMateObserveDecision,
  isMateQueryReply,
  isMatePendingDecision,
  isMateQueuedTicket,
  matePermissionTierMessageId,
  mateRouterSuggestionKindMessageId,
  mateSourceKindMessageId,
  mateStaleBadgeKind,
  mateTicketGenerationNumber,
  mateUnconfirmedIncrement,
  resolveMateBudgetActive,
  resolveMateErrorMessageId,
  resolveMateQuotaLine,
  resolveMateTrustGateProgress,
  resolveMateUsageGenerations,
} from "./view-model.js";
export type {
  MateErrorMessageId,
  MateFilter,
  MateStatusLine,
  MateViewModel,
  MateViewCounts,
} from "./view-model.js";
// P3 桌宠接缝投影（spec §11 落地注记）：barrel 只外泄 MatePetSync 发布方消费的
// projectMatePet/deriveMatePetBubble；matePetBubbleKey/matePetReportSummary 是
// petProjection 内部辅助（模块外零引用，G3 审查 2026-11-06 收敛）——经 petProjection
// 自测直连 "./petProjection.js" 消费，不经 barrel 外泄。
export { deriveMatePetBubble, projectMatePet } from "./petProjection.js";
export type { MateLocalUiState } from "./contract.js";
export { mateTicketLampTone, MATE_LAMP_TONE_CLASS } from "./statusTone.js";
export type { MateLampTone } from "./statusTone.js";
export { MateLamp } from "./MateLamp.js";
export { MateAutoNoticeRow } from "./MateAutoNoticeRow.js";
export { MatePaneHeader } from "./MatePaneHeader.js";
export { MateStatusStrip } from "./MateStatusStrip.js";
export { MateDigestCard } from "./MateDigestCard.js";
export { MateTrustBar } from "./MateTrustBar.js";
export { MateWorkspaceGroup } from "./MateWorkspaceGroup.js";
export { MateDecisionCard } from "./MateDecisionCard.js";
export { MateSourceBadge } from "./MateSourceBadge.js";
export { MateTicketRow, firstPreviewLine } from "./MateTicketRow.js";
export { MateReportCard } from "./MateReportCard.js";
export { MateObserveRow } from "./MateObserveRow.js";
export { MateQueryReply } from "./MateQueryReply.js";
export { MateWorkOverview } from "./MateWorkOverview.js";
export { MateConfigSection } from "./MateConfigSection.js";
export { MateTicketDetail } from "./MateTicketDetail.js";
export { MateSessionLine } from "./MateSessionLine.js";
