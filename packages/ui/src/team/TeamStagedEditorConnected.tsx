import { useCallback, useState } from "react";
import {
  TeamStagedEditor,
  teamCommandOutcomeToStagedFailure,
  type TeamStagedActionKind,
  type TeamStagedCommandFailure,
  type TeamStagedPendingAction,
} from "./TeamStagedEditor.js";
import type { TeamPermissionModeWire } from "@drora/shared/drora-protocol-v4";
import type { TeamPanelStagedDraftView } from "./view-model.js";
import { abandonTeamPlan, approveTeamPlan, reviseTeamPlan, setTeamMemberName } from "./commands.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import {
  buildTeamReviseComposerPrefill,
  TEAM_REVISE_PREFILL_PROMPT_KEY,
} from "./revise-prefill.js";
import type { TeamHistoryConnection } from "@/hooks/useTeamHistory.js";

/**
 * staged 编辑器 + 三动作失败出显 + 在途态的共用接线（specs/agents-team.md §10 呈现规则
 * 修订、§19 契约 5/6，2026-10-23）：desktop 的 timeline bottom dock（TeamApprovalDock）、
 * 移动/远端的摘要卡内联（TeamConversationSummary）与侧栏（TeamSidePane → TeamPanel）
 * 三个发起面共用同一条命令通道、同一套失败映射与同一套在途纪律——动作发起即在途
 * （按钮全禁用 + 等待文案，对齐 workflow responding），TeamCommandOutcome 结算后在途
 * 清空；被拒时按 reasonCode 回填内联提示。任一动作再次发起时清空上一次失败。
 * 三面呈现不同，命令语义必须一处实现（§19 契约 5 施工时由两处状态机收拢为此 hook）。
 */
export interface TeamStagedActions {
  /** 最近一次动作失败（staged 编辑器内联 role=alert；null = 无）。 */
  failure: TeamStagedCommandFailure | null;
  /** 在途动作（三动作按钮全禁用的依据；null = 无在途）。 */
  pending: TeamStagedPendingAction | null;
  /**
   * 批准并启动。§10 增补三：permissionMode=面板选定成员权限（undefined=维持捕获值）；
   * §10 增补六：rememberForSession=true=「本会话内始终允许」（hub 置会话免问标志）。
   */
  onApprove: (permissionMode?: TeamPermissionModeWire, rememberForSession?: boolean) => void;
  onRevise: (note?: string) => void;
  onAbandon: () => void;
  /**
   * 成员改名（§19 契约 5 扩圈面）：经 setTeamMemberName 发送，失败并入同一 failure
   * 出显（action=rename）。直传 TeamStagedEditor 的 onRenameMember 即可。
   */
  onRenameMember: (memberName: string, newName: string) => void;
}

export function useTeamStagedActions(
  sessionId: string,
  sendCommand: TeamHistoryConnection["sendCommand"],
): TeamStagedActions {
  const [failure, setFailure] = useState<TeamStagedCommandFailure | null>(null);
  const [pending, setPending] = useState<TeamStagedPendingAction | null>(null);
  // 发送并结算：在途清空 + 失败映射回填（成功时 outcome.ok → 映射为 null，不动现有值——
  // 调用面已在发起时清空，成功即保持无失败）。组件因状态迁移卸载（approve 成功后 dock
  // 卸载）时 setState 为安全 no-op。
  const settle = useCallback(
    (action: TeamStagedActionKind, outcomePromise: ReturnType<typeof approveTeamPlan>) => {
      void outcomePromise.then((outcome) => {
        setPending(null);
        const mapped = teamCommandOutcomeToStagedFailure(action, outcome);
        if (mapped !== null) setFailure(mapped);
      });
    },
    [],
  );
  const onApprove = useCallback(
    (permissionMode?: TeamPermissionModeWire, rememberForSession?: boolean) => {
      setFailure(null);
      setPending(rememberForSession === true ? "approveSession" : "approve");
      settle(
        rememberForSession === true ? "approveSession" : "approve",
        approveTeamPlan({
          sessionId,
          sendCommand,
          ...(permissionMode === undefined ? {} : { permissionMode }),
          ...(rememberForSession === undefined ? {} : { rememberForSession }),
        }),
      );
    },
    [sendCommand, sessionId, settle],
  );
  const onRevise = useCallback(
    (note?: string) => {
      setFailure(null);
      setPending("revise");
      settle(
        "revise",
        reviseTeamPlan({
          sessionId,
          sendCommand,
          ...(note === undefined ? {} : { note }),
        }),
      );
    },
    [sendCommand, sessionId, settle],
  );
  const onAbandon = useCallback(() => {
    setFailure(null);
    setPending("abandon");
    settle("abandon", abandonTeamPlan({ sessionId, sendCommand }));
  }, [sendCommand, sessionId, settle]);
  const onRenameMember = useCallback(
    (memberName: string, newName: string) => {
      setFailure(null);
      // 改名是快命令，不进 pending（禁用三按钮会让「改名等待」看起来像整表锁定）。
      settle("rename", setTeamMemberName({ sessionId, sendCommand, memberName, newName }));
    },
    [sendCommand, sessionId, settle],
  );
  return { failure, pending, onApprove, onRevise, onAbandon, onRenameMember };
}

/**
 * dock 与摘要卡共用的渲染壳：hook 出动作，presentational 出视图。
 * 改名入口恒接线（本组件只在 sendCommand 在场时挂载，通道必有）——spec §10「审批面
 * 挂载两处、呈现规则一体适用」（§19 契约 3 补桥后成员行可见建队路由，改名同一知情面）。
 * 「回对话修改」预填（spec §15 第4条 2026-10-23 三发起面扩圈）：onPrefillComposer
 * 在场 = revise 时照侧栏先例（TeamSidePane handlePanelCommand）预填追问文案（note
 * 随行）并定向 lead 会话（本组件 sessionId）；缺席 = 挂载面无法触达 composer——
 * note 输入隐藏并出「请在对话说明」提示，禁止 note 静默丢弃（输入了 hub v1 也不消费）。
 */
export function TeamStagedEditorConnected({
  draft,
  permissionMode,
  sessionId,
  sendCommand,
  onPrefillComposer,
}: {
  draft: TeamPanelStagedDraftView;
  /** 建队捕获的权限模式——选择行默认值（§10 增补三）。 */
  permissionMode?: TeamPermissionModeWire;
  sessionId: string;
  /** 与摘要卡/面板同源（TeamHistoryConnection["sendCommand"]），单一通道不变。 */
  sendCommand: TeamHistoryConnection["sendCommand"];
  /**
   * 「回对话修改」的会话输入框预填回调（侧栏 TeamSidePane 同形；实现由挂载点提供，
   * 走 requestComposerTextInsert 缺口9 通道，targetSessionId = 本组件 sessionId 即
   * lead 会话）。缺席 = note 输入抑制形态（见上头注）。
   */
  onPrefillComposer?: (prefill: string, targetSessionId?: string | null) => void;
}): JSX.Element {
  const staged = useTeamStagedActions(sessionId, sendCommand);
  const { intl } = useDroraIntl();
  // 预填追问文案渲染期解析（语言切换随渲染更新；与 TeamSidePane 同款）。
  const revisePrefillQuestion = intl.formatMessage({ id: TEAM_REVISE_PREFILL_PROMPT_KEY });
  const handleRevise = useCallback(
    (note?: string) => {
      staged.onRevise(note);
      // v1 边界（revise-prefill.ts 头注）：hub 不消费 wire note，note 随预填进对话；
      // 回调缺席 = 只发命令（与侧栏挂载点未接线时的诚实降级同语义）。
      if (onPrefillComposer !== undefined) {
        onPrefillComposer(
          buildTeamReviseComposerPrefill({
            question: revisePrefillQuestion,
            ...(note === undefined ? {} : { note }),
          }),
          sessionId,
        );
      }
    },
    [onPrefillComposer, revisePrefillQuestion, sessionId, staged],
  );
  return (
    <TeamStagedEditor
      draft={draft}
      permissionMode={permissionMode}
      failure={staged.failure}
      pendingAction={staged.pending}
      onApprove={staged.onApprove}
      onRevise={handleRevise}
      onAbandon={staged.onAbandon}
      onRenameMember={staged.onRenameMember}
      noteInputSuppressed={onPrefillComposer === undefined}
    />
  );
}
