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
// P10a-2（G3 收敛先例）：对话流投影（deriveMateThreadRows/mergeMateThreadRows/
// formatMateThreadClock/isMateThreadTicketNavigable/isMateQueryReply）目前仅模块内
// MateThread.tsx 与 view-model.test 直连消费——不出 barrel，宿主消费方出现时再外泄。
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
// P9：deriveMateAutonomyBubble 同为发布方消费面（自主 report 帧差分，09 详设 §2.2）。
export { deriveMateAutonomyBubble, deriveMatePetBubble, projectMatePet } from "./petProjection.js";
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
// P10a-2：status_replied 的呈现面迁入对话流答复气泡（MateThread.tsx）——原查询直答
// 卡（MateQueryReply.tsx）随卡区撤除删除（同源同卡不双写）。
export { MateThreadSection } from "./MateThread.js";
export { MateWorkOverview } from "./MateWorkOverview.js";
export { MateConfigSection } from "./MateConfigSection.js";
export { MateTicketDetail } from "./MateTicketDetail.js";
export { MateSessionLine } from "./MateSessionLine.js";
