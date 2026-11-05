import { memo, useEffect, useState } from "react";
import type { AssistantMode } from "@drora/shared";
import { ASSISTANT_DISTURBANCE_DEFAULTS, ASSISTANT_SETTINGS_KEYS } from "@drora/shared";
import type { AssistantResult, IAssistantTicketService } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { cn } from "@/components/lib/utils.js";
import { resolveMateErrorMessageId, type MateErrorMessageId } from "./view-model.js";
import { useMateStore } from "@/store/mateStore.js";
import { useOptionalServices } from "@/hooks/useServices.jsx";
import { useSettings } from "@/hooks/useSettingService.js";

/**
 * 配置区（01 §5 MateConfigSection）：模式（observe 锁定展示；auto 恒禁用+达标 tooltip，
 * mate.auto.locked——P1 信任门未开）｜allowlist 编辑（每行 identity，唯一写路径
 * setAllowlist）｜W1 worktree 开关（spec §9 W2 兜底，唯一写路径 setWorktreeDisabled；
 * P2 审查修复补交互入口）｜双测试触发按钮（点名=explicit / 未指名=inferred，直调
 * recordTrigger；P3 前替代 im 未指名形态，00 master plan §2）。
 *
 * 触发目标 = 本 pane 的 workspace（tab.workspaceIdentity 由容器传入）：P1 本地 Source
 * 只在本 workspace 语境触发，服务侧 approve 以 decision.workspace_identity 兜底。
 * 动作失败按 mate.error.* 出 role=alert 行，不在 store 落错误状态。
 */
export const MateConfigSection = memo(function MateConfigSection({
  service,
  workspaceKey,
  mode,
  allowlist,
  worktreeDisabled,
  workspaceIdentity,
  dailyQuota,
}: {
  service: IAssistantTicketService;
  /** 本 workspace 分域键（store 动作 single-flight 按 workspace 隔离）。 */
  workspaceKey: string;
  mode: AssistantMode;
  allowlist: readonly string[];
  /** W1 worktree 开关当前值（快照投影；唯一事实源，本组件不落本地副本）。 */
  worktreeDisabled: boolean;
  /** 本 pane 所属 workspace 的 identity（触发 target；缺席=不携带由服务兜底）。 */
  workspaceIdentity?: string;
  /** P4 第二棒（04 详设 §4）：生效每日配额（快照 quota.quota 投影；缺席=旧 Host 不渲染）。 */
  dailyQuota?: number;
}) {
  const { intl } = useDroraIntl();
  const setAllowlist = useMateStore((state) => state.setAllowlist);
  const setWorktreeDisabled = useMateStore((state) => state.setWorktreeDisabled);
  const recordTrigger = useMateStore((state) => state.recordTrigger);
  // P4 第二棒：每日配额调整走 AppSettings（useSettings 写 droraMateDailyQuota，键字面量
  // contracts ASSISTANT_SETTINGS_KEYS 单出处）。settings 服务缺席（本仓夹具/远端降级形态）
  // → 输入禁用（诚实降级，不建第二条写路径）。
  const { update: updateSharedSettings } = useSettings();
  const settingsServicePresent = useOptionalServices()?.settingService != null;
  const quotaEditable = settingsServicePresent;
  // 配额草稿：生效值=快照投影（服务闭包缓存）；AppSettings 原始值缺席（缺省 5）时也以
  // 生效值回填草稿——保存即把当前生效值固化进 AppSettings（语义等价，判定本就实时读）。
  const [quotaDraft, setQuotaDraft] = useState(() => `${dailyQuota ?? ""}`);
  const [quotaDirty, setQuotaDirty] = useState(false);
  useEffect(() => {
    if (quotaDirty || dailyQuota === undefined) return;
    setQuotaDraft(`${dailyQuota}`);
  }, [dailyQuota, quotaDirty]);

  // 名单草稿：快照推送是唯一事实，但**编辑中不被推送覆盖**（PR-1B 三审发现 2）——
  // 同面板任意动作（recordTrigger/approve 等）都会触发 publish，服务端每次
  // buildSnapshot 产生新数组身份，无条件覆盖会把输入到一半的 identity 静默清掉。
  // dirty 期间草稿归用户；保存成功后交还推送权威（下一次推送/当前值回填）。
  const [allowlistDraft, setAllowlistDraft] = useState(() => allowlist.join("\n"));
  const [allowlistDirty, setAllowlistDirty] = useState(false);
  useEffect(() => {
    if (allowlistDirty) return;
    setAllowlistDraft(allowlist.join("\n"));
  }, [allowlist, allowlistDirty]);

  const [triggerText, setTriggerText] = useState("");
  const [failure, setFailure] = useState<MateErrorMessageId | null>(null);

  // 传输层异常（store 留 warn 日志后原样上抛）与失败臂同路出 role=alert，不留
  // unhandled rejection（PR-1B 二审发现 7）；错误码是封闭集合，异常一律落 generic。
  const run = (pending: Promise<AssistantResult<unknown>>, onSuccess?: () => void): void => {
    pending
      .then((result) => {
        if (result.ok) {
          setFailure(null);
          onSuccess?.();
        } else {
          setFailure(resolveMateErrorMessageId(result.error));
        }
      })
      .catch(() => {
        setFailure("mate.error.generic");
      });
  };

  const handleSaveAllowlist = (): void => {
    run(
      setAllowlist(
        service,
        workspaceKey,
        allowlistDraft
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      ),
      // 保存成功 → 草稿不再 dirty，快照推送重新接管（服务确认值回填草稿框）。
      () => setAllowlistDirty(false),
    );
  };

  const handleTrigger = (simulated: "explicit" | "inferred"): void => {
    const text = triggerText.trim();
    if (text.length === 0) return;
    run(
      recordTrigger(service, workspaceKey, {
        text,
        simulated,
        ...(workspaceIdentity ? { targetWorkspaceIdentity: workspaceIdentity } : {}),
      }),
      () => setTriggerText(""),
    );
  };

  const handleWorktreeToggle = (checked: boolean): void => {
    // 快照推送是唯一事实：开关只发服务动作，不落本地副本（服务确认值随下次快照回填）。
    run(setWorktreeDisabled(service, workspaceKey, !checked));
  };

  // P4 第二棒（04 详设 §4）：每日配额保存——0-整数上界（缺省/上界=contracts
  // ASSISTANT_DISTURBANCE_DEFAULTS 单出处，validationAppSettings 同界同源；
  // 键=ASSISTANT_SETTINGS_KEYS.dailyQuota 单出处）。越界/非整数本地拒绝（不落请求）。
  const handleSaveQuota = (): void => {
    const parsed = Number(quotaDraft);
    if (
      quotaDraft.trim() === "" ||
      !Number.isSafeInteger(parsed) ||
      parsed < 0 ||
      parsed > ASSISTANT_DISTURBANCE_DEFAULTS.dailyQuotaMax
    ) {
      setFailure("mate.config.quota.invalid");
      return;
    }
    updateSharedSettings({ [ASSISTANT_SETTINGS_KEYS.dailyQuota]: parsed })
      .then(() => {
        setFailure(null);
        setQuotaDirty(false);
      })
      .catch(() => setFailure("mate.error.generic"));
  };

  return (
    <div
      className="flex shrink-0 flex-col gap-3 border-t border-border/50 px-3 py-3"
      data-testid="mate-config"
    >
      <div className="flex items-center gap-2">
        <span className="text-ui-sm font-medium text-foreground">
          {intl.formatMessage({ id: "mate.config.mode" })}
        </span>
        <span
          data-active={mode === "observe" ? "true" : "false"}
          data-testid="mate-mode-observe"
          className={cn(
            // 最近圆角容器是 side pane 壳（rounded-xl），按 DESIGN.md 控件表用 rounded-lg。
            "rounded-lg px-2 py-1 text-ui-xs",
            mode === "observe"
              ? "bg-selected font-medium text-foreground"
              : "text-foreground-subtlest",
          )}
        >
          {intl.formatMessage({ id: "mate.config.mode.observe" })}
        </span>
        <ControlHintTooltip title={intl.formatMessage({ id: "mate.config.mode.auto.locked" })}>
          {/* 包一层 span 作 TooltipTrigger：disabled button 不吐指针事件，触发落在 span 上。 */}
          <span className="inline-flex" data-testid="mate-mode-auto-wrap">
            <button
              type="button"
              disabled
              aria-disabled="true"
              data-testid="mate-mode-auto"
              // 最近圆角容器是 side pane 壳（rounded-xl），按 DESIGN.md 控件表用 rounded-lg。
              className="rounded-lg px-2 py-1 text-ui-xs text-foreground-subtlest"
            >
              auto
            </button>
          </span>
        </ControlHintTooltip>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="mate-allowlist-input" className="text-ui-xs text-foreground-subtlest">
          {intl.formatMessage({ id: "mate.config.allowlist" })}
        </label>
        <textarea
          id="mate-allowlist-input"
          value={allowlistDraft}
          onChange={(event) => {
            setAllowlistDraft(event.target.value);
            setAllowlistDirty(true);
          }}
          rows={2}
          placeholder={intl.formatMessage({ id: "mate.config.allowlistPlaceholder" })}
          className="w-full resize-y rounded-lg border border-input-border bg-input px-2 py-1.5 font-mono text-ui-sm text-foreground placeholder:text-foreground-subtlest focus:border-input-border-focused focus:outline-none"
          data-testid="mate-allowlist-input"
        />
        <div>
          <Button
            size="xs"
            variant="outline"
            onClick={handleSaveAllowlist}
            data-testid="mate-allowlist-save"
          >
            {intl.formatMessage({ id: "common.save" })}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="mate-worktree-switch" className="text-ui-sm font-medium text-foreground">
          {intl.formatMessage({ id: "mate.config.worktree.label" })}
        </label>
        <Switch
          id="mate-worktree-switch"
          size="sm"
          checked={!worktreeDisabled}
          onCheckedChange={handleWorktreeToggle}
          data-testid="mate-worktree-switch"
          aria-label={intl.formatMessage({ id: "mate.config.worktree.label" })}
        />
        <span className="text-ui-xs text-foreground-subtlest" data-testid="mate-worktree-state">
          {intl.formatMessage({
            id: worktreeDisabled ? "mate.config.worktree.off" : "mate.config.worktree.on",
          })}
        </span>
        <ControlHintTooltip title={intl.formatMessage({ id: "mate.config.worktree.hint" })}>
          <span
            className="inline-flex cursor-help text-ui-xs text-foreground-subtlest"
            data-testid="mate-worktree-hint"
          >
            ?
          </span>
        </ControlHintTooltip>
      </div>

      {/* P4 第二棒（04 详设 §4 调整入口）：每日打扰配额（条/日；0=非决策类全静音聚合，
          决策类不受限）。settings 服务缺席时输入禁用（诚实降级，不建第二条写路径）。 */}
      {dailyQuota !== undefined ? (
        <div className="flex flex-col gap-1.5" data-testid="mate-config-quota">
          <label htmlFor="mate-quota-input" className="text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "mate.config.quota.label" })}
          </label>
          <div className="flex items-center gap-1.5">
            <input
              id="mate-quota-input"
              type="number"
              min={0}
              max={ASSISTANT_DISTURBANCE_DEFAULTS.dailyQuotaMax}
              step={1}
              value={quotaDraft}
              disabled={!quotaEditable}
              onChange={(event) => {
                setQuotaDraft(event.target.value);
                setQuotaDirty(true);
              }}
              className="w-24 rounded-lg border border-input-border bg-input px-2 py-1.5 font-mono text-ui-sm text-foreground focus:border-input-border-focused focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="mate-quota-input"
            />
            <Button
              size="xs"
              variant="outline"
              disabled={!quotaEditable || !quotaDirty}
              onClick={handleSaveQuota}
              data-testid="mate-quota-save"
            >
              {intl.formatMessage({ id: "common.save" })}
            </Button>
          </div>
          <p className="text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "mate.config.quota.hint" })}
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="mate-trigger-input" className="text-ui-xs text-foreground-subtlest">
          {intl.formatMessage({ id: "mate.config.triggerPlaceholder" })}
        </label>
        <textarea
          id="mate-trigger-input"
          value={triggerText}
          onChange={(event) => setTriggerText(event.target.value)}
          rows={2}
          className="w-full resize-y rounded-lg border border-input-border bg-input px-2 py-1.5 text-ui-sm text-foreground focus:border-input-border-focused focus:outline-none"
          data-testid="mate-trigger-input"
        />
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            disabled={triggerText.trim().length === 0}
            onClick={() => handleTrigger("explicit")}
            data-testid="mate-trigger-explicit"
          >
            {intl.formatMessage({ id: "mate.config.trigger.explicit" })}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={triggerText.trim().length === 0}
            onClick={() => handleTrigger("inferred")}
            data-testid="mate-trigger-inferred"
          >
            {intl.formatMessage({ id: "mate.config.trigger.inferred" })}
          </Button>
        </div>
      </div>

      {failure !== null ? (
        <p role="alert" className="text-ui-sm text-destructive" data-testid="mate-config-error">
          {intl.formatMessage({ id: failure })}
        </p>
      ) : null}
    </div>
  );
});
