import { Check } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/**
 * R3 移动壳状态卡族（四步加载卡 + 11 张失败卡）。
 *
 * 纯展示组件：全部数据与动作经 props 注入，不接 relay 数据面。
 * 视觉与文案对齐官方 3.14.3 托管页（.tmp-work/official-page/remote/v4/3.14.3/assets/index-NjWRUABD.js
 * 内的 CVn 失败卡映射、lHn 加载态映射与 $9/EVn 渲染结构），中英文案已提取到
 * mobileShell.loading.* / mobileShell.failure.* i18n 命名空间。
 *
 * spec：specs/mobile-relay-r3-frontend.md §2 对齐清单、D1 模块决策。
 */

/** 加载卡覆盖的连接阶段（对齐官方 lHn 的 state 入参；preparing 为官方 default 兜底态）。 */
export type MobileConnectionPhase =
  | "connecting"
  | "authenticating"
  | "waiting"
  | "reconnecting"
  | "paired"
  | "suspended"
  | "preparing";

/** 四步固定顺序：1 连接中转服务 / 2 设备鉴权 / 3 等待桌面端配对 / 4 同步工作区。 */
const LOADING_STEP_KEYS = [
  "mobileShell.loading.step.relay",
  "mobileShell.loading.step.auth",
  "mobileShell.loading.step.pairing",
  "mobileShell.loading.step.sync",
] as const;

/** 官方失败卡的 tone → 徽章/图标配色（逐类取自官方 TVn）。 */
export type MobileFailureCardTone = "warning" | "danger" | "neutral";

const FAILURE_TONE_CLASSES: Record<MobileFailureCardTone, string> = {
  danger: "border-destructive/30 bg-destructive/10 text-destructive",
  warning: "border-warning/30 bg-warning/10 text-warning-foreground",
  neutral: "border-border bg-surface text-foreground-subtle",
};

/** 11 个失败码（对齐官方 CVn 映射的键集，camelCase 对应官方 wire code 的 kebab-case）。 */
export type MobileFailureCode =
  | "sessionNotFound"
  | "sessionExpired"
  | "sessionConflict"
  | "workspaceClosed"
  | "desktopDisconnected"
  | "invalidMobileConnection"
  | "desktopBootstrapTimeout"
  | "connectionRecoveryTimeout"
  | "relayUnavailable"
  | "unsupportedAction"
  | "unexpectedError";

/** code → tone（逐字取自官方 CVn：danger ×3、warning ×6、neutral ×2）。 */
export const MOBILE_FAILURE_CARD_TONES: Record<MobileFailureCode, MobileFailureCardTone> = {
  sessionNotFound: "warning",
  sessionExpired: "warning",
  sessionConflict: "warning",
  workspaceClosed: "neutral",
  desktopDisconnected: "danger",
  invalidMobileConnection: "warning",
  desktopBootstrapTimeout: "warning",
  connectionRecoveryTimeout: "warning",
  relayUnavailable: "danger",
  unsupportedAction: "neutral",
  unexpectedError: "danger",
};

/** 官方 wire 协议失败码（kebab-case）→ 组件 code（camelCase）。 */
const WIRE_CODE_MAP: Record<string, MobileFailureCode> = {
  "session-not-found": "sessionNotFound",
  "session-expired": "sessionExpired",
  "session-conflict": "sessionConflict",
  "workspace-closed": "workspaceClosed",
  "desktop-disconnected": "desktopDisconnected",
  "invalid-mobile-connection": "invalidMobileConnection",
  "desktop-bootstrap-timeout": "desktopBootstrapTimeout",
  "connection-recovery-timeout": "connectionRecoveryTimeout",
  "relay-unavailable": "relayUnavailable",
  "unsupported-action": "unsupportedAction",
  "unexpected-error": "unexpectedError",
};

/** relay wire 失败码 → 组件失败码；未知码兜底为 unexpected-error（对齐官方 T() 的兜底语义）。 */
export function mobileFailureCodeFromWire(wireCode: string): MobileFailureCode {
  return WIRE_CODE_MAP[wireCode] ?? "unexpectedError";
}

/** 状态卡全屏居中框架：水平垂直居中，宽视口限宽（四步卡 600px / 失败卡对齐官方 max-w-md）。 */
function StatusCardFrame({
  maxWidthClass,
  children,
}: {
  maxWidthClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-background px-4 py-8 text-foreground">
      <div className={cn("w-full", maxWidthClass)}>{children}</div>
    </div>
  );
}

export interface MobileLoadingCardProps {
  /** 卡片标题（如「已配对，正在加载工作区…」），由调用方按连接阶段注入。 */
  title: string;
  /** 副标题说明行。 */
  description: string;
  /** 四步标签（固定顺序，一般直接用 MobileConnectionStatusCard 注入）。 */
  steps: readonly string[];
  /** 已完成步数（1 基计数，≤ steps 数量）。 */
  doneCount: number;
  /** 当前进行中的步数（1 基计数）；null/0 表示没有 active 步。 */
  activeCount: number | null;
  className?: string;
}

/**
 * 四步加载卡（对齐官方 $9 结构：warning 脉冲圆点 + 标题 + 副标题 + 四步列表）。
 * done/active 步样式为本仓扩展：官方宽屏步行为纯文本行，R2 兜底页与 spec §2 要求
 * done/active 可区分，故按官方 tone 语言补 success/warning 变体。
 */
export function MobileLoadingCard({
  title,
  description,
  steps,
  doneCount,
  activeCount,
  className,
}: MobileLoadingCardProps) {
  return (
    <section
      className={cn("w-full rounded-xl border border-card-border bg-card p-5", className)}
      aria-busy="true"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 animate-pulse rounded-full bg-warning"
        />
        <h1 className="text-ui-xs font-medium text-foreground">{title}</h1>
      </div>
      <p className="mt-2 text-ui-xs/relaxed text-foreground-subtle">{description}</p>
      <div className="mt-4 grid gap-2">
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const isDone = stepNumber <= doneCount;
          const isActive = activeCount !== null && stepNumber === activeCount && !isDone;
          return (
            <div
              key={step}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-ui-xs",
                isDone
                  ? "border-success/30 bg-success/10 text-success-foreground"
                  : isActive
                    ? "border-warning/30 bg-warning/10 text-warning-foreground"
                    : "border-border bg-surface text-foreground-subtle",
              )}
            >
              <span className="w-4 shrink-0 text-center font-medium">{stepNumber}</span>
              <span className="min-w-0 flex-1">{step}</span>
              {isDone ? (
                <Check aria-hidden="true" className="size-3 shrink-0 text-success-foreground" />
              ) : isActive ? (
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning"
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export interface MobileConnectionStatusCardProps {
  /** 连接阶段；标题/副标题/四步文案按阶段从 mobileShell.loading.* 解析（对齐官方 lHn）。 */
  phase: MobileConnectionPhase;
  /** 已完成步数（透传 MobileLoadingCard）。 */
  doneCount?: number;
  /** 进行中步数（透传 MobileLoadingCard）。 */
  activeCount?: number | null;
  className?: string;
}

const PHASE_COPY_KEYS: Record<MobileConnectionPhase, { title: string; description: string }> = {
  connecting: {
    title: "mobileShell.loading.connecting.title",
    description: "mobileShell.loading.connecting.description",
  },
  authenticating: {
    title: "mobileShell.loading.authenticating.title",
    description: "mobileShell.loading.authenticating.description",
  },
  waiting: {
    title: "mobileShell.loading.waiting.title",
    description: "mobileShell.loading.waiting.description",
  },
  reconnecting: {
    title: "mobileShell.loading.reconnecting.title",
    description: "mobileShell.loading.reconnecting.description",
  },
  paired: {
    title: "mobileShell.loading.paired.title",
    description: "mobileShell.loading.paired.description",
  },
  suspended: {
    title: "mobileShell.loading.suspended.title",
    description: "mobileShell.loading.suspended.description",
  },
  preparing: {
    title: "mobileShell.loading.preparing.title",
    description: "mobileShell.loading.preparing.description",
  },
};

/** 四步加载卡便捷封装：按 phase 解析官方逐字文案并套用 600px 居中框架。 */
export function MobileConnectionStatusCard({
  phase,
  doneCount = 0,
  activeCount = null,
  className,
}: MobileConnectionStatusCardProps) {
  const { intl } = useZCodeIntl();
  const copy = PHASE_COPY_KEYS[phase];
  const steps = LOADING_STEP_KEYS.map((key) => intl.formatMessage({ id: key }));
  return (
    <StatusCardFrame maxWidthClass="max-w-[600px]">
      <MobileLoadingCard
        title={intl.formatMessage({ id: copy.title })}
        description={intl.formatMessage({ id: copy.description })}
        steps={steps}
        doneCount={doneCount}
        activeCount={activeCount}
        className={className}
      />
    </StatusCardFrame>
  );
}

export interface MobileFailureCardProps {
  /** 失败码；badge/title/描述/nextSteps/动作文案按码从 mobileShell.failure.* 解析。 */
  code: MobileFailureCode;
  /** 可选失败详情（如 relay error message），渲染为官方样式的 detail 块。 */
  detail?: string | null;
  /** 可选动作回调（重新连接/刷新/重试）；未提供时不渲染动作按钮（任务要求「可选动作按钮」）。 */
  onAction?: () => void;
  className?: string;
}

/**
 * 失败卡（11 code，badge + title + 描述 + nextSteps + 可选动作按钮，tone 配色）。
 * 结构逐类对齐官方 EVn；文案见 mobileShell.failure.*。
 */
export function MobileFailureCard({ code, detail, onAction, className }: MobileFailureCardProps) {
  const { intl } = useZCodeIntl();
  const prefix = `mobileShell.failure.${code}`;
  const tone = MOBILE_FAILURE_CARD_TONES[code];
  const toneClasses = FAILURE_TONE_CLASSES[tone];
  const title = intl.formatMessage({ id: `${prefix}.title` });
  const steps = [
    intl.formatMessage({ id: `${prefix}.step1` }),
    intl.formatMessage({ id: `${prefix}.step2` }),
  ];

  return (
    <StatusCardFrame maxWidthClass="max-w-md">
      <main
        role="alert"
        className={cn(
          "w-full rounded-xl border border-card-border bg-card p-5 shadow-sm",
          className,
        )}
      >
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg border text-ui-lg font-semibold",
              toneClasses,
            )}
          >
            !
          </div>
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "mb-2 inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-ui-xs font-medium",
                toneClasses,
              )}
            >
              <span className="min-w-0 truncate">
                {intl.formatMessage({ id: `${prefix}.badge` })}
              </span>
            </div>
            <h1 className="text-ui-lg font-medium text-foreground">{title}</h1>
            <p className="mt-2 text-ui-xs leading-6 text-foreground-subtle">
              {intl.formatMessage({ id: `${prefix}.description` })}
            </p>
          </div>
        </div>
        <section className="mt-5 border-t border-border pt-4">
          <h2 className="text-ui-xs font-medium text-foreground">
            {intl.formatMessage({ id: `${prefix}.stepsTitle` })}
          </h2>
          <ol className="mt-2 space-y-2 text-ui-xs leading-6 text-foreground-subtle">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-2">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-ui-xs text-foreground-subtle">
                  {index + 1}
                </span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>
        </section>
        {detail ? (
          <section className="mt-4 rounded-lg border border-border bg-surface px-3 py-2.5">
            <div className="text-ui-xs font-medium text-foreground">
              {intl.formatMessage({ id: `${prefix}.detailLabel` })}
            </div>
            <div className="mt-1 break-words font-mono text-ui-xs leading-5 text-foreground-subtle">
              {detail}
            </div>
          </section>
        ) : null}
        {onAction ? (
          <button
            type="button"
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-ui-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={onAction}
          >
            {intl.formatMessage({ id: `${prefix}.action` })}
          </button>
        ) : null}
      </main>
    </StatusCardFrame>
  );
}
