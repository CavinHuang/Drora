import { useState, type KeyboardEvent } from "react";
import { InfoIcon, PencilIcon } from "lucide-react";
import {
  teamPermissionModeSchema,
  type TeamPermissionModeWire,
} from "@drora/shared/drora-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamCommandOutcome } from "./commands.js";
import type { TeamPanelStagedDraftView } from "./view-model.js";

/**
 * staged 审批编辑器（PR-2.4b；specs/agents-team.md §10「staged 审批视图」、
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §3.1）。
 *
 * 两阶段成队：staged 态的 TeamPanel 即本编辑器——成员行（名称/角色/路由）与任务行
 * （标题/负责人/依赖）v1 **只读展示**（行内编辑属后续卡；缺口10 起成员名称的「改名」
 * 经 setTeamMemberName 命令接线——staged 草案原子更新同一 teamId，任务 assignee 随
 * 名字重定向）；三个动作：
 * - 「确认并启动」→ onApprove（宿主发 approveTeamPlan，**唯一创建成员入口**，批准前零成员零会话）；
 * - 「回对话修改」→ onRevise(note?)（宿主发 reviseTeamPlan；note 为面板内可选输入，
 *   修改方向也可留空后在对话里说明——宿主负责预填会话输入框：侧栏 TeamSidePane 与
 *   dock/摘要卡（TeamStagedEditorConnected，spec §15 第4条 2026-10-23 三发起面扩圈）
 *   的 onPrefillComposer 回调，文案构造见 team/revise-prefill.ts；无法触达 composer
 *   的面传 noteInputSuppressed 隐藏输入，禁止 note 静默丢弃）；
 * - 「放弃」→ onAbandon（宿主发 abandonTeamPlan；二次确认在本组件内完成，
 *   归档后禁止模型自动重建）。
 *
 * presentational：命令发送一律由宿主接 team/commands.ts，本组件只上抛意图。
 * DESIGN.md：text-ui-* 刻度、技术值（路由/任务 id）等宽、成员/任务行无大面积色块。
 *
 * M2.5 i18n：全部文案走 locales `team.stagedEditor.*` 词典（原 zh 内联常量
 * TEAM_STAGED_EDITOR_COPY 已整体迁出，zh 值逐字搬运；design 01 §4）；
 * 依赖 id 列表的连接符也随语言（dependsOnSeparator），路由/依赖 id 本体保持等宽拼接。
 *
 * 2026-10-22 审批面呈现对齐（spec §10 呈现规则五子条，同日 01-design §3.1 同步）：
 * - 问句表头：顶部问句行（「启动这支团队？」语义）+「N 名成员 · N 项任务」计数
 *   （原 stagedSummary 文案移作表头计数）；会话流卡头已有团队名与状态徽标，表头
 *   不重复。表头为 team 自有实现——**不 import** WorkflowCardChrome /
 *   WorkflowPermissionBlock（workflow 图标硬编码于 WorkflowCardChrome.tsx:24/:176，
 *   借用即把 workflow 徽记带进 team 语境；对齐的是问句/信息层级语汇，不是徽记资产）。
 * - 三动作失败出显：approveTeamPlan/reviseTeamPlan/abandonTeamPlan 的
 *   TeamCommandOutcome 此前失败只进 logger、无 UI 消费面——本组件内联 role=alert
 *   失败提示（按 ack.reasonCode 出 i18n 文案，未知 reasonCode 走兜底文案），
 *   借形不借管线：不接权限请求管线，命令单一通道不变（hub/wire 零结构改动）。
 * - 触达：编辑器内全部可交互控件（三动作按钮、改名铅笔/输入/确认/取消、备注输入）
 *   pointer-coarse ≥44px（DESIGN.md:661-662「keep touch targets at 44px
 *   (`size-11`/`min-h-11`)」；写法照 TeamConversationSummary.tsx:73 现有先例）。
 */

/**
 * 三动作 + 成员改动的失败来源动作标识（spec §10 呈现规则4 及其 §19 契约 5 扩圈）。
 * rename 走同一失败出显面：改名入口（TeamStagedEditorConnected 内部发送 / 面板
 * onRenameMember 宿主接线）被拒时与三动作共用内联 role=alert。
 */
export type TeamStagedActionKind = "approve" | "approveSession" | "revise" | "abandon" | "rename";

/**
 * 在途动作标识（spec §19 契约 6，2026-10-23）：任一三动作发起后到 outcome 结算前，
 * 全部动作按钮禁用 + 在途按钮出等待文案——对齐 workflow 确认窗的 responding 全禁用
 * 语义（PermissionDialog.tsx responding 挡选项/设置/确认），消除「双击发第二条独立
 * 命令」与「长事务期间零反馈」。null = 无在途。
 */
export type TeamStagedPendingAction = Exclude<TeamStagedActionKind, "rename">;

/**
 * 最近一次三动作失败（宿主消费 TeamCommandOutcome 后交回；null/缺席 = 无失败提示）。
 * `reasonCode` 取 ack.reasonCode——hub 拒绝 = `fault.command.teamRejected.<TeamPortErrorCode>`
 * （bootstrap drora-protocol-v4/commands/handlers/team.ts，错误码集合见 core
 * src/team/errors.ts）、hub 缺席 = fault.command.teamHubUnavailable；传输异常
 * （sendCommand 抛错、ack 缺席）时 reasonCode 缺席 → 走 transport 文案。
 */
export interface TeamStagedCommandFailure {
  action: TeamStagedActionKind;
  reasonCode?: string;
}

/**
 * 已知拒绝 reasonCode → 失败文案键（spec §10 呈现规则4「按 ack.reasonCode 出 i18n
 * 文案，未知 reasonCode 有兜底文案」）。字面量生产方在 bootstrap handlers/team.ts
 * （V4TeamRejectedError / V4TeamHubUnavailableError）；本表是 UI 侧的呈现归并
 * （同族校验错误共用一句），不构成契约的生产/消费对，新增错误码不要求同步本表
 * ——未知值统一落 `team.stagedEditor.failure.fallback` 兜底。
 */
export const TEAM_STAGED_FAILURE_REASON_I18N_KEYS: Readonly<Record<string, string>> = {
  "fault.command.teamRejected.team_not_present": "team.stagedEditor.failure.teamNotPresent",
  "fault.command.teamRejected.team_lead_only": "team.stagedEditor.failure.teamLeadOnly",
  "fault.command.teamRejected.member_spawn_failed": "team.stagedEditor.failure.memberSpawnFailed",
  "fault.command.teamRejected.draft_duplicate_member": "team.stagedEditor.failure.draftInvalid",
  "fault.command.teamRejected.draft_unknown_assignee": "team.stagedEditor.failure.draftInvalid",
  "fault.command.teamRejected.draft_duplicate_task": "team.stagedEditor.failure.draftInvalid",
  "fault.command.teamRejected.unknown_dependency": "team.stagedEditor.failure.draftInvalid",
  "fault.command.teamRejected.dependency_cycle": "team.stagedEditor.failure.draftInvalid",
  "fault.command.teamHubUnavailable": "team.stagedEditor.failure.hubUnavailable",
  // §19 契约 5（2026-10-23 扩圈）：用户面五命令的 hub 拒绝码（hub.ts portSend /
  // halt/resume/stop/rename 路径）——文案键落命令域 team.commandFailure.*，供
  // 成员下钻 composer 与面板动作区共用（staged 三动作的正常流触不到这些码）。
  "fault.command.teamRejected.team_halted": "team.commandFailure.teamHalted",
  "fault.command.teamRejected.message_target_terminal_retired": "team.commandFailure.targetRetired",
  "fault.command.teamRejected.name_redirect": "team.commandFailure.nameRedirect",
  "fault.command.teamRejected.mailbox_persist_failed": "team.commandFailure.persistFailed",
};

/** 失败原因文案键：无 reasonCode（传输异常）→ transport；已知 → 映射；未知 → 兜底。 */
export function stagedFailureReasonI18nKey(failure: TeamStagedCommandFailure): string {
  if (failure.reasonCode === undefined) return "team.stagedEditor.failure.transport";
  return (
    TEAM_STAGED_FAILURE_REASON_I18N_KEYS[failure.reasonCode] ?? "team.stagedEditor.failure.fallback"
  );
}

/**
 * 拒绝码 → 命令域文案键（§19 契约 5 扩圈的共用查表出处）；未知码返回 undefined，
 * 由调用面出自己的 fallback 文案（composer/面板与 staged 编辑器的兜底措辞不同）。
 */
export function teamRejectionReasonI18nKeyOrUndefined(reasonCode: string): string | undefined {
  return TEAM_STAGED_FAILURE_REASON_I18N_KEYS[reasonCode];
}

/**
 * TeamCommandOutcome → 失败态（两挂载点共用的单一映射出处；ok = accepted|duplicate|noop
 * 不出提示，拒绝携带 ack.reasonCode，传输异常 ack 缺席则 reasonCode 缺席）。
 */
export function teamCommandOutcomeToStagedFailure(
  action: TeamStagedActionKind,
  outcome: TeamCommandOutcome,
): TeamStagedCommandFailure | null {
  if (outcome.ok) return null;
  const reasonCode = outcome.ack?.reasonCode;
  return { action, ...(reasonCode === undefined ? {} : { reasonCode }) };
}

/** 成员权限模式全集（§10 增补三；枚举单一出处 teamPermissionModeSchema）。 */
const TEAM_PERMISSION_MODES = teamPermissionModeSchema.options;

export interface TeamStagedEditorProps {
  draft: TeamPanelStagedDraftView;
  /**
   * 「允许」/「本会话内始终允许」上抛；宿主发 approveTeamPlan。permissionMode 恒
   * undefined（2026-10-28 用户裁定：面板不再铺开权限选择，成员权限维持建队捕获值
   * ——审批面的权限语义收敛为 workflow 同款「允许/本会话内始终允许」二选项）；
   * rememberForSession=true 即后者（hub 置会话免问标志，后续草案自动批准）。
   */
  onApprove: (permissionMode?: TeamPermissionModeWire, rememberForSession?: boolean) => void;
  /** 「回对话修改」上抛；note 为面板内可选输入（trim 后为空则不携带）。 */
  onRevise: (note?: string) => void;
  /** 「放弃」上抛（本组件已完成二次确认）；宿主发 abandonTeamPlan。 */
  onAbandon: () => void;
  /**
   * 成员「改名」上抛（缺口10）：宿主发 setTeamMemberName（staged 草案原子更新，
   * assignee 重定向在 handler 侧完成）。缺席 = 成员行只读（无改名入口）。
   */
  onRenameMember?: (memberName: string, newName: string) => void;
  /**
   * 最近一次三动作失败（spec §10 呈现规则4；宿主消费 TeamCommandOutcome 后交回，
   * 映射用 teamCommandOutcomeToStagedFailure）。null/缺席 = 无失败提示；任一动作
   * 再次发起时由宿主置空清除（两挂载点在动作回调开头 set null）。
   */
  failure?: TeamStagedCommandFailure | null;
  /**
   * 在途动作（spec §19 契约 6）：宿主在动作发起时置位、outcome 结算时清空。
   * 在途期间三动作按钮全部禁用（对齐 workflow responding），在途按钮出等待文案；
   * 备注输入同步禁用（revise 在途后备注已无意义）。null/缺席 = 无在途。
   */
  pendingAction?: TeamStagedPendingAction | null;
  /**
   * note 输入抑制（spec §15 第4条「三发起面 revise note 一律经预填通道落对话」
   * 2026-10-23 扩圈）：挂载面无法触达 composer（TeamStagedEditorConnected 未注入
   * onPrefillComposer，如远端 timeline 摘要卡）时为 true——隐藏 note 输入并出
   * 「请在对话说明」提示，禁止 note 静默丢弃（输入了也只会随命令上 wire 而 hub v1
   * 不消费）。缺省 false：侧栏 TeamPanel 形态（宿主自接预填）不变。
   */
  noteInputSuppressed?: boolean;
}

/**
 * 动作选项（§18 附裁内部结构对齐 PermissionDialog；§10 增补六 2026-10-27 对齐
 * workflow 权限选项族）。顺序即编号：
 * 1 启动一次 / 2 本会话内始终允许（带说明行）/ 3 提出修改 / 4 放弃。
 */
const TEAM_STAGED_OPTIONS = [
  {
    action: "approve",
    labelKey: "team.stagedEditor.approve",
    descriptionKey: "team.stagedEditor.approveDescription",
    testId: "team-staged-approve",
  },
  {
    action: "approveSession",
    labelKey: "team.stagedEditor.approveSession",
    descriptionKey: "team.stagedEditor.approveSessionDescription",
    testId: "team-staged-approve-session",
  },
  { action: "abandon", labelKey: "team.stagedEditor.abandon", testId: "team-staged-abandon" },
] as const;

const PENDING_LABEL_KEYS: Record<Exclude<TeamStagedPendingAction, null>, string> = {
  approve: "team.stagedEditor.pendingApprove",
  approveSession: "team.stagedEditor.pendingApproveSession",
  revise: "team.stagedEditor.pendingRevise",
  abandon: "team.stagedEditor.pendingAbandon",
};

export function TeamStagedEditor({
  draft,
  onApprove,
  onRevise,
  onAbandon,
  onRenameMember,
  failure,
  pendingAction = null,
  noteInputSuppressed = false,
}: TeamStagedEditorProps): JSX.Element {
  const { intl } = useDroraIntl();
  const requestConfirmation = useConfirmDialog();
  const [note, setNote] = useState("");
  // §18 附裁（2026-10-26）：选项默认选中 1（允许）——既有 E2E「单击 approve 即
  // 发信封」的语义依赖此默认值（单击已选中项=执行，照 PermissionDialog）。
  const [selectedIndex, setSelectedIndex] = useState(0);
  const busy = pendingAction !== null;

  // 执行语义（照 PermissionDialog respondWithOption）：放弃过二次确认门；修订携带 trim
  // 后说明（空则不带）；在途全禁用（responding 同构，spec §19 契约 6）。
  const execute = (action: "approve" | "approveSession" | "revise" | "abandon") => {
    if (busy) return;
    if (action === "approve") {
      onApprove(undefined);
      return;
    }
    if (action === "approveSession") {
      // §10 增补六：批准 + 置会话免问标志（等价 workflow allowForSession 语义）。
      onApprove(undefined, true);
      return;
    }
    if (action === "revise") {
      const trimmed = note.trim();
      onRevise(trimmed === "" ? undefined : trimmed);
      return;
    }
    void (async () => {
      const confirmed = await requestConfirmation({
        title: intl.formatMessage({ id: "team.stagedEditor.abandonConfirmTitle" }),
        description: intl.formatMessage({ id: "team.stagedEditor.abandonConfirmBody" }),
        confirmLabel: intl.formatMessage({ id: "team.stagedEditor.abandonConfirmLabel" }),
        confirmVariant: "destructive",
      });
      if (confirmed) onAbandon();
    })();
  };

  const confirmSelection = () => {
    // 备注行（视觉第 4 项）占用 selectedIndex=3：确认钮即「提出修改」（随行 note）。
    if (selectedIndex === TEAM_STAGED_OPTIONS.length) {
      execute("revise");
      return;
    }
    const option = TEAM_STAGED_OPTIONS[selectedIndex];
    if (option !== undefined) execute(option.action);
  };

  const moveSelection = (delta: number) => {
    setSelectedIndex(
      (current) => (current + delta + TEAM_STAGED_OPTIONS.length) % TEAM_STAGED_OPTIONS.length,
    );
  };

  // 选项行键盘（照 PermissionDialog handleOptionKeyDown）：数字键=选中并执行；方向键=
  // 移动；Enter=已选中则执行、否则先选中。
  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (busy) return;
    const digit = ["1", "2", "3"].indexOf(event.key);
    if (digit !== -1) {
      const shortcut = TEAM_STAGED_OPTIONS[digit];
      if (shortcut === undefined) return;
      event.preventDefault();
      setSelectedIndex(digit);
      execute(shortcut.action);
      return;
    }
    switch (event.key) {
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        moveSelection(-1);
        return;
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        moveSelection(1);
        return;
      case "Enter":
        event.preventDefault();
        if (index === selectedIndex) execute(TEAM_STAGED_OPTIONS[index]!.action);
        else setSelectedIndex(index);
        return;
      default:
        return;
    }
  };

  // 反馈行 Enter（非输入法组合态）= 执行选项 2（照 PermissionDialog feedback 行）。
  const handleNoteKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing && !busy) {
      event.preventDefault();
      // 备注行视觉上是第 4 项（三选项之后），选中态与选项 3（放弃）互斥显示。
      setSelectedIndex(3);
      execute("revise");
    }
  };

  return (
    <section
      aria-label={intl.formatMessage({ id: "team.stagedEditor.title" })}
      className="flex min-w-0 flex-col gap-3"
      data-testid="team-staged-editor"
    >
      {/*
       * 问句表头（§10 呈现规则1；§18 附裁二：镜像 WorkflowCardHeader 结构——kind 问句
       * font-medium + name 团队名 truncate + detail 计数 tabular-nums，类名逐字同款；
       * 不借 WORKFLOW_CARD_ICON 徽记（§15 裁决不变）。
       */}
      <div
        className="flex min-w-0 flex-wrap items-center gap-2 text-ui-base"
        data-testid="team-staged-header"
      >
        <span className="shrink-0 whitespace-nowrap font-medium" data-testid="team-staged-kind">
          <span className="text-foreground">
            {intl.formatMessage({ id: "team.stagedEditor.question" })}
          </span>
        </span>
        <span
          className="min-w-20 flex-1 truncate text-foreground-subtle"
          data-testid="team-staged-name"
          title={draft.teamName ?? intl.formatMessage({ id: "team.ui.title" })}
        >
          {draft.teamName ?? intl.formatMessage({ id: "team.ui.title" })}
        </span>
        <span
          className="ml-auto min-w-0 truncate tabular-nums text-foreground-subtlest"
          data-testid="team-staged-detail"
        >
          {intl.formatMessage(
            { id: "team.stagedEditor.stagedSummary" },
            { members: draft.members.length, tasks: draft.tasks.length },
          )}
        </span>
      </div>

      {draft.awaitingFeedback ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "team.stagedEditor.awaitingFeedback" })}
        </p>
      ) : null}

      {/*
       * 草案清单（§10「全量呈现不折叠」裁决不变；§18 附裁二：限高滚动照 PermissionDialog
       * bounded 模式——长草案不再撑高确认窗）。
       */}
      <div className="max-h-72 min-w-0 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-3">
          <DraftMemberRows
            members={draft.members}
            managerName={draft.managerName}
            {...(onRenameMember === undefined ? {} : { onRenameMember })}
          />
          <DraftTaskRows tasks={draft.tasks} />
        </div>
      </div>

      {/*
       * 三动作失败出显（spec §10 呈现规则4）：role=alert 内联提示，文案 = 动作标签
       * （复用按钮文案键）+ 按 ack.reasonCode 映射的原因（未知走兜底，见
       * stagedFailureReasonI18nKey）。宿主在任一动作再次发起时置空清除。
       */}
      {failure === undefined || failure === null ? null : (
        <p
          role="alert"
          className="text-ui-base text-destructive"
          data-testid="team-staged-command-error"
        >
          {intl.formatMessage(
            { id: "team.stagedEditor.failure.line" },
            {
              action: intl.formatMessage({ id: `team.stagedEditor.${failure.action}` }),
              reason: intl.formatMessage({ id: stagedFailureReasonI18nKey(failure) }),
            },
          )}
        </p>
      )}

      {/*
       * 编号选项 listbox（§18 附裁，2026-10-26：内部结构对齐 PermissionDialog）：行样式与
       * 键盘/点击语义照 PermissionDialog 选项同款——数字键=选中并执行、方向键=移动、
       * 单击已选中项=执行（默认选中 1，E2E 单击 approve 发信封的语义由此保持）。在途全
       * 禁用（spec §19 契约 6）。pointer-coarse ≥44px 行高同纪律。
       */}
      <div className="shrink-0 space-y-1">
        <div
          role="listbox"
          aria-label={intl.formatMessage({ id: "team.stagedEditor.optionsAria" })}
          className="space-y-1"
        >
          {TEAM_STAGED_OPTIONS.map((option, index) => {
            const selected = index === selectedIndex;
            const labelKey = option.labelKey;
            return (
              <button
                key={option.action}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={intl.formatMessage({ id: option.labelKey })}
                tabIndex={selected ? 0 : -1}
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  if (selected) execute(option.action);
                  else setSelectedIndex(index);
                }}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                data-testid={option.testId}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors focus-visible:bg-selected pointer-coarse:min-h-11",
                  selected ? "bg-selected" : "hover:bg-hover",
                  busy && "cursor-not-allowed opacity-50",
                )}
              >
                <span
                  className={cn(
                    "w-5 shrink-0 self-center text-ui-base font-medium",
                    selected ? "text-foreground" : "text-foreground-subtlest",
                  )}
                >
                  {index + 1}.
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      "text-ui-base font-medium",
                      option.action === "abandon" ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {intl.formatMessage({ id: labelKey })}
                  </span>
                  {"descriptionKey" in option && option.descriptionKey !== undefined ? (
                    // 说明行（§10 增补六，照 workflow allowForSession.description）。
                    <span className="text-ui-sm text-foreground-subtlest">
                      {intl.formatMessage({ id: option.descriptionKey })}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        {noteInputSuppressed ? null : (
          // 反馈行（照 PermissionDialog feedback 形态，L12 修复：在 listbox 闭合后作
          // 兄弟节点）：修订说明随备注行（视觉第 4 项，selectedIndex=3），聚焦即选中、
          // Enter 直接提交该选项，确认钮在选中态执行；无边框行内输入。
          <div
            onClick={(event) => {
              if (event.target !== event.currentTarget) return;
              if (!busy) setSelectedIndex(3);
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2 transition-colors",
              selectedIndex === 3 && !busy ? "bg-selected" : "hover:bg-hover",
            )}
          >
            <span
              className={cn(
                "w-5 shrink-0 self-center text-center text-ui-base font-medium",
                selectedIndex === 3 && !busy ? "text-foreground" : "text-foreground-subtlest",
              )}
              aria-hidden
            >
              ✎
            </span>
            <Input
              aria-label={intl.formatMessage({ id: "team.stagedEditor.noteLabel" })}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onFocus={() => {
                if (!busy) setSelectedIndex(3);
              }}
              onKeyDown={handleNoteKeyDown}
              disabled={busy}
              placeholder={intl.formatMessage({ id: "team.stagedEditor.notePlaceholder" })}
              className="h-auto min-w-0 flex-1 border-transparent bg-transparent px-0 py-0 text-ui-base shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0 pointer-coarse:min-h-11"
              data-testid="team-staged-revise-note"
            />
          </div>
        )}
        {noteInputSuppressed ? (
          // note 静默丢弃禁止（spec §15 第4条）：无法预填的面不出输入（输入即丢），
          // 引导修改方向走对话（§18 附裁后此形态仅侧栏挂载面出现）。
          <p
            className="px-3 text-ui-caption text-foreground-subtle"
            data-testid="team-staged-note-suppressed"
          >
            {intl.formatMessage({ id: "team.stagedEditor.noteSuppressedHint" })}
          </p>
        ) : null}
      </div>

      {/*
       * 底栏（§18 附裁：对齐 PermissionDialog 底栏）：左键盘提示（复用权限面板键位文案键）、
       * 右大号确认钮——执行当前选中项；在途禁用 + 在途文案（§19 契约 6）。
       */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-1">
        <p className="flex items-center gap-2 text-ui-base text-foreground-subtle">
          <InfoIcon className="size-4 shrink-0 text-foreground" />
          {intl.formatMessage({ id: "chat.permission.keyboardHint" })}
        </p>
        <Button
          type="button"
          size="lg"
          onClick={confirmSelection}
          disabled={busy}
          // L14 修复：对照 PermissionDialog 确认钮（PermissionDialog.tsx 底栏）的品牌蓝
          // 类名逐字同款——此前用默认 bg-primary，两卡并排时确认钮异色。
          className="pointer-coarse:min-h-11 bg-brand text-foreground-inverse hover:bg-brand/80"
          data-testid="team-staged-confirm"
        >
          {intl.formatMessage({
            id:
              pendingAction === null
                ? "team.stagedEditor.confirm"
                : PENDING_LABEL_KEYS[pendingAction],
          })}
        </Button>
      </div>
    </section>
  );
}

function DraftMemberRows({
  members,
  managerName,
  onRenameMember,
}: {
  members: TeamPanelStagedDraftView["members"];
  /** 管理者成员名（§22 契约 1；首位成员行「管理者」徽标）。 */
  managerName?: string;
  onRenameMember?: (memberName: string, newName: string) => void;
}): JSX.Element {
  const { intl } = useDroraIntl();
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-ui-caption text-foreground-subtle">
        {`${intl.formatMessage({ id: "team.stagedEditor.membersHeading" })} (${String(members.length)})`}
      </h3>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li
            key={member.memberName}
            className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-surface px-1.5 py-1"
          >
            <span className="text-ui-sm font-medium">{member.memberName}</span>
            {member.memberName === managerName ? (
              <span
                className="rounded-sm bg-surface px-1.5 py-0.5 text-ui-caption text-foreground-subtle"
                data-testid="team-staged-manager-badge"
              >
                {intl.formatMessage({ id: "team.ui.managerBadge" })}
              </span>
            ) : null}
            <span className="text-ui-caption text-foreground-subtle">
              {member.profile ?? intl.formatMessage({ id: "team.stagedEditor.roleNone" })}
            </span>
            <span className="text-ui-caption font-mono text-foreground-subtle">
              {member.modelSelection === undefined
                ? intl.formatMessage({ id: "team.stagedEditor.routingNone" })
                : `${intl.formatMessage({ id: "team.stagedEditor.routingLabel" })} ${member.modelSelection.provider}/${member.modelSelection.model}${member.modelSelection.thought === undefined ? "" : ` · ${member.modelSelection.thought}`}`}
            </span>
            {onRenameMember === undefined ? null : (
              <DraftMemberRename memberName={member.memberName} onRename={onRenameMember} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 成员行「改名」入口（缺口10）：staged 草案期的成员改名经 setTeamMemberName 命令
 * （宿主接 team/commands.ts；重名/空白由 wire schema 与 hub 草案校验单一出处拒绝，
 * 本组件只做非空与「有变化」的本地门）。改名只改草案名——批准前零成员零会话，
 * 任务 assignee 的重定向在 handler 重建草案时完成。
 */
function DraftMemberRename({
  memberName,
  onRename,
}: {
  memberName: string;
  onRename: (memberName: string, newName: string) => void;
}): JSX.Element {
  const { intl } = useDroraIntl();
  const [editing, setEditing] = useState(false);
  const [nextName, setNextName] = useState(memberName);
  const trimmed = nextName.trim();
  const ready = trimmed !== "" && trimmed !== memberName;
  const apply = () => {
    if (!ready) return;
    onRename(memberName, trimmed);
    setEditing(false);
  };
  return editing ? (
    // pointer-coarse ≥44px：改名输入/确认/取消（spec §10 呈现规则5；desktop 保持原 h-7 紧凑密度）。
    <span className="ml-auto flex items-center gap-1">
      <Input
        value={nextName}
        onChange={(event) => setNextName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            apply();
          }
          if (event.key === "Escape") {
            setNextName(memberName);
            setEditing(false);
          }
        }}
        aria-label={intl.formatMessage(
          { id: "team.stagedEditor.renameLabel" },
          { name: memberName },
        )}
        data-testid="team-staged-rename-input"
        className="h-7 w-32 text-ui-sm pointer-coarse:min-h-11"
      />
      <Button
        type="button"
        size="sm"
        disabled={!ready}
        onClick={apply}
        data-testid="team-staged-rename-apply"
        className="h-7 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        {intl.formatMessage({ id: "team.stagedEditor.renameApply" })}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setNextName(memberName);
          setEditing(false);
        }}
        data-testid="team-staged-rename-cancel"
        className="h-7 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        {intl.formatMessage({ id: "team.stagedEditor.renameCancel" })}
      </Button>
    </span>
  ) : (
    // pointer-coarse ≥44px：改名铅笔（desktop 保持 size-6，coarse 指针抬到 44px）。
    <button
      type="button"
      onClick={() => {
        setNextName(memberName);
        setEditing(true);
      }}
      aria-label={intl.formatMessage({ id: "team.stagedEditor.renameLabel" }, { name: memberName })}
      data-testid="team-staged-rename"
      className="ml-auto flex size-6 shrink-0 items-center justify-center self-center rounded-md text-foreground-subtle hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    >
      <PencilIcon className="size-3" />
    </button>
  );
}

function DraftTaskRows({ tasks }: { tasks: TeamPanelStagedDraftView["tasks"] }): JSX.Element {
  const { intl } = useDroraIntl();
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-ui-caption text-foreground-subtle">
        {`${intl.formatMessage({ id: "team.stagedEditor.tasksHeading" })} (${String(tasks.length)})`}
      </h3>
      <ul className="flex flex-col gap-1">
        {tasks.map((task) => (
          <li
            key={task.taskId}
            className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-surface px-1.5 py-1"
          >
            <span className="text-ui-sm font-medium">{task.title}</span>
            <span className="text-ui-caption font-mono text-foreground-subtle">{task.taskId}</span>
            <span className="text-ui-caption text-foreground-subtle">
              {task.assignee ?? intl.formatMessage({ id: "team.stagedEditor.assigneeNone" })}
            </span>
            <span className="text-ui-caption font-mono text-foreground-subtle">
              {task.dependsOn.length === 0
                ? intl.formatMessage({ id: "team.stagedEditor.dependsOnNone" })
                : `${intl.formatMessage({ id: "team.stagedEditor.dependsOnLabel" })} ${task.dependsOn.join(
                    intl.formatMessage({ id: "team.stagedEditor.dependsOnSeparator" }),
                  )}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
