import { memo, useEffect, useState } from "react";
import type { AssistantMode } from "@drora/shared";
import { ASSISTANT_DISTURBANCE_DEFAULTS, ASSISTANT_SETTINGS_KEYS } from "@drora/shared";
import type { AssistantResult, IAssistantTicketService } from "@drora/services";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { cn } from "@/components/lib/utils.js";
import {
  mateTriggerOutcomeFeedbackMessageId,
  resolveMateErrorMessageId,
  type MateErrorMessageId,
} from "./view-model.js";
import { useMateStore } from "@/store/mateStore.js";
import { useOptionalServices } from "@/hooks/useServices.jsx";
import { useSettings } from "@/hooks/useSettingService.js";
import { ASSISTANT_CONFIG_LIMITS } from "@drora/shared";
import { MateModelPreference } from "./MateModelPreference.js";
import { MateSourceSettings } from "./MateSourceSettings.js";

/**
 * 配置区（01 §5 MateConfigSection）：模式（observe 锁定展示；auto 恒禁用+达标 tooltip，
 * mate.auto.locked——P1 信任门未开）｜allowlist 编辑（每行 identity，唯一写路径
 * setAllowlist）｜W1 worktree 开关（spec §9 W2 兜底，唯一写路径 setWorktreeDisabled；
 * P2 审查修复补交互入口）｜双测试触发按钮（点名=explicit / 未指名=inferred，直调
 * recordTrigger；P3 前替代 im 未指名形态，00 master plan §2）。
 *
 * 触发目标 = workspaceKey（AGENTS 身份键=workspaceIdentity?.trim()||workspacePath）恒
 * 透传（F1 修复，2026-11-06）：本地 tab 的 workspaceIdentity 恒 undefined，旧实现缺席
 * 即不带 target → trigger.workspace_identity=NULL → 服务 approve 兜底链全落空
 * （validationFailed「缺少派发目标 workspace」，默认桌面场景放行必失败）。本地 tab 的
 * workspaceKey=本地绝对路径，恰是 workspaceProbe 端口的合法形态；远程 tab 的
 * workspaceKey=远程 identity，probe 诚实拒绝、卡不消费可改选（spec §8「拒绝猜测，问人」）。
 *
 * 动作失败按 mate.error.* 出 role=alert 行；触发成功按返回 outcome 出 role=status
 * 反馈行（F2：decision_card/would_accept/ignored 三态封闭映射，off 模式静默修复），
 * 均不在 store 落状态。
 */
export const MateConfigSection = memo(function MateConfigSection({
  service,
  workspaceKey,
  mode,
  allowlist,
  worktreeDisabled,
  dailyQuota,
  budgetMaxActivePerWorkspace,
  modelPreference,
  trustGateThresholds,
  watchdogIntervalMinutes,
  sourcesConfig,
  identityMap,
}: {
  service: IAssistantTicketService;
  /** 本 workspace 分域键（store 动作 single-flight 按 workspace 隔离；兼触发 target）。 */
  workspaceKey: string;
  mode: AssistantMode;
  allowlist: readonly string[];
  /** W1 worktree 开关当前值（快照投影；唯一事实源，本组件不落本地副本）。 */
  worktreeDisabled: boolean;
  /** P4 第二棒（04 详设 §4）：生效每日配额（快照 quota.quota 投影；缺席=旧 Host 不渲染）。 */
  dailyQuota?: number;
  /** P5：软预算当前值（快照 budget 投影；缺席=旧 Host 不渲染高级区）。 */
  budgetMaxActivePerWorkspace?: number;
  /** P5：大副模型偏好（快照投影；null=未设置→CLI 缺省）。 */
  modelPreference: { providerId: string; modelId: string; reasoningLevel?: string } | null;
  /** P5：信任门生效阈值（快照投影；缺席=旧 Host 用缺省草稿）。 */
  trustGateThresholds?: { minRate: number; minSamples: number };
  /** P5：watchdog 轮询间隔（分钟；快照投影）。 */
  watchdogIntervalMinutes?: number;
  /** P5：Source 开关配置（快照投影；undefined=旧 Host 空配置）。 */
  sourcesConfig?: {
    feishu?: { enabled?: boolean };
    phone?: { enabled?: boolean };
    github?: { enabled?: boolean; repo?: string; mentionName?: string };
  };
  /** P5：Source 身份映射（快照投影；feishu/github 嵌套形态）。 */
  identityMap?: {
    feishu?: Readonly<Record<string, string>>;
    github?: Readonly<Record<string, string>>;
  };
}) {
  const { intl } = useDroraIntl();
  const setAllowlist = useMateStore((state) => state.setAllowlist);
  const setWorktreeDisabled = useMateStore((state) => state.setWorktreeDisabled);
  // P5 设置中心动作（06 号详设；模型/Source 区在子组件内各自取用）。
  const setBudget = useMateStore((state) => state.setBudget);
  const setTrustGateThresholds = useMateStore((state) => state.setTrustGateThresholds);
  const setWatchdogIntervalMinutes = useMateStore((state) => state.setWatchdogIntervalMinutes);
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
  // P5 高级区草稿（06 号详设 §5）：预算/信任门两阈值/watchdog 间隔，三输入一体保存
  // （dirty 纪律照 quota；bounds=ASSISTANT_CONFIG_LIMITS 单出处，本地预检+服务 fail-closed 双闸）。
  const [budgetDraft, setBudgetDraft] = useState(() =>
    budgetMaxActivePerWorkspace !== undefined ? `${budgetMaxActivePerWorkspace}` : "",
  );
  const [rateDraft, setRateDraft] = useState(() =>
    trustGateThresholds ? `${trustGateThresholds.minRate}` : "",
  );
  const [samplesDraft, setSamplesDraft] = useState(() =>
    trustGateThresholds ? `${trustGateThresholds.minSamples}` : "",
  );
  const [intervalDraft, setIntervalDraft] = useState(() =>
    watchdogIntervalMinutes ? `${watchdogIntervalMinutes}` : "",
  );
  const [advancedDirty, setAdvancedDirty] = useState(false);
  // 快照回填（quotaDraft 同款纪律）：未 dirty 时跟随服务事实源；保存成功清 dirty 后
  // 下一次快照推送把服务确认值写回草稿框。
  useEffect(() => {
    if (advancedDirty || budgetMaxActivePerWorkspace === undefined) return;
    setBudgetDraft(`${budgetMaxActivePerWorkspace}`);
  }, [advancedDirty, budgetMaxActivePerWorkspace]);
  useEffect(() => {
    if (advancedDirty || trustGateThresholds === undefined) return;
    setRateDraft(`${trustGateThresholds.minRate}`);
    setSamplesDraft(`${trustGateThresholds.minSamples}`);
  }, [advancedDirty, trustGateThresholds]);
  useEffect(() => {
    if (advancedDirty || watchdogIntervalMinutes === undefined) return;
    setIntervalDraft(`${watchdogIntervalMinutes}`);
  }, [advancedDirty, watchdogIntervalMinutes]);
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
  // F2：触发成功反馈（outcome → 文案键封闭映射；null=本态无反馈行）。只作即时反馈，
  // 持续呈现仍由快照推送承接（决策卡/观察行/工单行），不在 store 落状态。
  const [triggerFeedback, setTriggerFeedback] = useState<string | null>(null);

  // 传输层异常（store 留 warn 日志后原样上抛）与失败臂同路出 role=alert，不留
  // unhandled rejection（PR-1B 二审发现 7）；错误码是封闭集合，异常一律落 generic。
  // onSuccess 回调收到结果值（F2：recordTrigger 按返回 outcome 出反馈行需要它）。
  const run = (
    pending: Promise<AssistantResult<unknown>>,
    onSuccess?: (value: unknown) => void,
  ): void => {
    pending
      .then((result) => {
        if (result.ok) {
          setFailure(null);
          onSuccess?.(result.value);
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
        // F1：target=workspaceKey 恒透传（AGENTS 身份键=identity?.trim()||path）。
        // 旧实现仅在 tab.workspaceIdentity 真值时携带——本地 tab 恒 undefined，
        // trigger.workspace_identity=NULL 使 approve 兜底链全落空成死卡。
        targetWorkspaceIdentity: workspaceKey,
      }),
      (value) => {
        setTriggerText("");
        setTriggerFeedback(
          mateTriggerOutcomeFeedbackMessageId((value as { outcome?: string }).outcome ?? ""),
        );
      },
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

  // P5 高级区保存（06 号详设 §5）：三输入一体提交——预算+信任门两阈值+watchdog 间隔。
  // 本地 bounds 预检（ASSISTANT_CONFIG_LIMITS 单出处同界），服务侧 fail-closed 双闸；
  // 任一项校验失败整批不发（一体保存语义，避免半批落库的中间态）。
  const handleSaveAdvanced = (): void => {
    const budget = Number(budgetDraft);
    const rate = Number(rateDraft);
    const samples = Number(samplesDraft);
    const interval = Number(intervalDraft);
    const limits = ASSISTANT_CONFIG_LIMITS;
    if (
      !Number.isInteger(budget) ||
      budget < limits.budgetMaxActivePerWorkspace.min ||
      budget > limits.budgetMaxActivePerWorkspace.max
    ) {
      setFailure("mate.config.advanced.budgetInvalid");
      return;
    }
    if (
      !Number.isFinite(rate) ||
      rate < limits.trustGateMinRate.min ||
      rate > limits.trustGateMinRate.max
    ) {
      setFailure("mate.config.advanced.rateInvalid");
      return;
    }
    if (
      !Number.isInteger(samples) ||
      samples < limits.trustGateMinSamples.min ||
      samples > limits.trustGateMinSamples.max
    ) {
      setFailure("mate.config.advanced.samplesInvalid");
      return;
    }
    if (
      !Number.isInteger(interval) ||
      interval < limits.watchdogIntervalMinutes.min ||
      interval > limits.watchdogIntervalMinutes.max
    ) {
      setFailure("mate.config.advanced.intervalInvalid");
      return;
    }
    void setBudget(service, workspaceKey, budget).then(async (budgetResult) => {
      if (!budgetResult.ok) {
        setFailure(resolveMateErrorMessageId(budgetResult.error));
        return;
      }
      const trustResult = await setTrustGateThresholds(service, workspaceKey, {
        minRate: rate,
        minSamples: samples,
      });
      if (!trustResult.ok) {
        setFailure(resolveMateErrorMessageId(trustResult.error));
        return;
      }
      const intervalResult = await setWatchdogIntervalMinutes(service, workspaceKey, interval);
      if (!intervalResult.ok) {
        setFailure(resolveMateErrorMessageId(intervalResult.error));
        return;
      }
      setFailure(null);
      setAdvancedDirty(false);
    });
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

      {/* P5 设置中心（06 号详设 §5）：模型偏好——Router 与 Mode A/B 新建会话的模型，
          下一次建会话生效（在途会话不热切）；清除回落 CLI 缺省。 */}
      <MateModelPreference
        service={service}
        workspaceKey={workspaceKey}
        preference={modelPreference}
      />

      {/* P5 高级区：软预算/信任门阈值/watchdog 间隔（三输入一体保存；旧 Host 快照字段
          缺席时不渲染，诚实降级不猜测）。 */}
      {budgetMaxActivePerWorkspace !== undefined &&
      trustGateThresholds !== undefined &&
      watchdogIntervalMinutes !== undefined ? (
        <div className="flex flex-col gap-1.5" data-testid="mate-config-advanced">
          <span className="text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "mate.config.advanced.title" })}
          </span>
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="mate-budget-input"
              className="w-20 shrink-0 text-ui-xs text-foreground-subtlest"
            >
              {intl.formatMessage({ id: "mate.config.advanced.budget" })}
            </label>
            <input
              id="mate-budget-input"
              type="number"
              min={ASSISTANT_CONFIG_LIMITS.budgetMaxActivePerWorkspace.min}
              max={ASSISTANT_CONFIG_LIMITS.budgetMaxActivePerWorkspace.max}
              step={1}
              value={budgetDraft}
              onChange={(event) => {
                setBudgetDraft(event.target.value);
                setAdvancedDirty(true);
              }}
              className="w-20 rounded-lg border border-input-border bg-input px-2 py-1.5 font-mono text-ui-sm text-foreground focus:border-input-border-focused focus:outline-none"
              data-testid="mate-budget-input"
            />
            <label
              htmlFor="mate-rate-input"
              className="w-20 shrink-0 text-ui-xs text-foreground-subtlest"
            >
              {intl.formatMessage({ id: "mate.config.advanced.minRate" })}
            </label>
            <input
              id="mate-rate-input"
              type="number"
              min={ASSISTANT_CONFIG_LIMITS.trustGateMinRate.min}
              max={ASSISTANT_CONFIG_LIMITS.trustGateMinRate.max}
              step={0.05}
              value={rateDraft}
              onChange={(event) => {
                setRateDraft(event.target.value);
                setAdvancedDirty(true);
              }}
              className="w-20 rounded-lg border border-input-border bg-input px-2 py-1.5 font-mono text-ui-sm text-foreground focus:border-input-border-focused focus:outline-none"
              data-testid="mate-rate-input"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="mate-samples-input"
              className="w-20 shrink-0 text-ui-xs text-foreground-subtlest"
            >
              {intl.formatMessage({ id: "mate.config.advanced.minSamples" })}
            </label>
            <input
              id="mate-samples-input"
              type="number"
              min={ASSISTANT_CONFIG_LIMITS.trustGateMinSamples.min}
              max={ASSISTANT_CONFIG_LIMITS.trustGateMinSamples.max}
              step={1}
              value={samplesDraft}
              onChange={(event) => {
                setSamplesDraft(event.target.value);
                setAdvancedDirty(true);
              }}
              className="w-20 rounded-lg border border-input-border bg-input px-2 py-1.5 font-mono text-ui-sm text-foreground focus:border-input-border-focused focus:outline-none"
              data-testid="mate-samples-input"
            />
            <label
              htmlFor="mate-interval-input"
              className="w-20 shrink-0 text-ui-xs text-foreground-subtlest"
            >
              {intl.formatMessage({ id: "mate.config.advanced.interval" })}
            </label>
            <input
              id="mate-interval-input"
              type="number"
              min={ASSISTANT_CONFIG_LIMITS.watchdogIntervalMinutes.min}
              max={ASSISTANT_CONFIG_LIMITS.watchdogIntervalMinutes.max}
              step={1}
              value={intervalDraft}
              onChange={(event) => {
                setIntervalDraft(event.target.value);
                setAdvancedDirty(true);
              }}
              className="w-20 rounded-lg border border-input-border bg-input px-2 py-1.5 font-mono text-ui-sm text-foreground focus:border-input-border-focused focus:outline-none"
              data-testid="mate-interval-input"
            />
          </div>
          <div>
            <Button
              size="xs"
              variant="outline"
              onClick={handleSaveAdvanced}
              data-testid="mate-advanced-save"
            >
              {intl.formatMessage({ id: "common.save" })}
            </Button>
          </div>
        </div>
      ) : null}

      {/* P5 Source 设置区：三开关+GitHub 参数+身份映射（保存即 reconcile，启停即时生效）。 */}
      <MateSourceSettings
        service={service}
        workspaceKey={workspaceKey}
        sourcesConfig={sourcesConfig}
        identityMap={identityMap}
      />

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

      {/* F2：触发成功反馈行（decision_card/would_accept/ignored 三态封闭映射；
          auto_notice 不在此——呈现面是决策卡区告知卡，不重复出两处文案）。 */}
      {triggerFeedback !== null ? (
        <p
          role="status"
          className="text-ui-sm text-foreground-subtle"
          data-testid="mate-trigger-feedback"
        >
          {intl.formatMessage({ id: triggerFeedback })}
        </p>
      ) : null}

      {failure !== null ? (
        <p role="alert" className="text-ui-sm text-destructive" data-testid="mate-config-error">
          {intl.formatMessage({ id: failure })}
        </p>
      ) : null}
    </div>
  );
});
