import { MonitorDownIcon } from "lucide-react";
import type { TeamProjectionState } from "@drora/shared/drora-protocol-v4";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamHistoryConnection } from "@/hooks/useTeamHistory.js";
import { TeamStagedEditorConnected } from "./TeamStagedEditorConnected.js";
import { mapTeamProjectionToViewModel } from "./view-model.js";

/**
 * staged 审批的 timeline bottom dock（specs/agents-team.md §10 呈现规则修订，2026-10-23）：
 * 与 workflow 确认窗（PermissionDialog）同位同 chrome——钉在 timeline 底部、composer 之上，
 * 「团队计划待确认」眉题 + 问句表头 + 草案全文 + 三动作。此前审批卡内联在消息流中部，
 * 会话一长就要滚动找审批面；workflow 确认窗的「钉底待决」才是同一交互的正确位置。
 *
 * 命令仍走 team/commands.ts 单一通道（sendCommand 由 SessionPane 传入，与摘要卡/面板同
 * 路径）；本组件纯呈现，不接权限管线（借形不借管线的裁定继续有效）。
 * 移动/远端 surface 保留摘要卡内联编辑器（无 dock 机制），由调用方以
 * `stagedEditorSuppressed` 区分。
 */
export function TeamApprovalDock({
  team,
  sessionId,
  sendCommand,
  onPrefillComposer,
}: {
  team: TeamProjectionState;
  sessionId: string;
  /** 与摘要卡/面板同源（TeamHistoryConnection["sendCommand"]），单一通道不变。 */
  sendCommand: TeamHistoryConnection["sendCommand"];
  /**
   * 「回对话修改」的会话输入框预填回调（spec §15 第4条 2026-10-23 三发起面扩圈；
   * SessionPane 注入，走 requestComposerTextInsert 缺口9 通道定向 lead 会话）。
   * 缺席 = note 输入隐藏并提示走对话（禁止静默丢弃，TeamStagedEditorConnected 裁决）。
   */
  onPrefillComposer?: (prefill: string, targetSessionId?: string | null) => void;
}): JSX.Element | null {
  const { intl } = useDroraIntl();
  const model = mapTeamProjectionToViewModel(team);
  if (model.stagedDraft === undefined) {
    // staged 但草案视图缺失（理论不可达：hub staged 必带草案）——退化为不渲染，摘要卡兜底。
    return null;
  }
  return (
    // role="status" + aria-live="polite"（spec §19 契约 6 可达性半边，2026-10-23）：dock
    // 静默插入 timeline 底部并把 composer 下推，读屏与键盘用户需要感知「出现了待审批面」；
    // 挂载即播报眉题文案。workflow 确认窗同位面有 role=alert 失败播报与 Shift+Tab 回焦
    // （PermissionDialog.tsx:1074/:749-768），dock 的失败播报由编辑器内联 role=alert 承担。
    <div
      className="w-full shrink-0 relative z-1"
      role="status"
      aria-live="polite"
      data-testid="team-approval-dock"
    >
      <div className="w-full rounded-2xl border border-border bg-popover shadow-xs">
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-ui-base font-medium leading-tight text-foreground-subtle">
              {intl.formatMessage({ id: "team.stagedDock.title" })}
            </p>
            <span className="flex items-center gap-1 text-ui-caption text-foreground-subtlest">
              <MonitorDownIcon className="size-3.5" />
              {intl.formatMessage({ id: "team.stagedDock.hint" })}
            </span>
          </div>
          <TeamStagedEditorConnected
            draft={model.stagedDraft}
            sessionId={sessionId}
            sendCommand={sendCommand}
            {...(onPrefillComposer === undefined ? {} : { onPrefillComposer })}
          />
        </div>
      </div>
    </div>
  );
}
