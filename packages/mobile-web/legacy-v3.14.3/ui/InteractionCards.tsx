// R3 P3b 阻塞交互应答卡（spec §15 第 1 条）：快照 pendingInteractions 驱动的受控组件。
// permission 卡（options 按 kind 配色 + fullAccessOption + 可选反馈输入）与 userInput
// 卡（prompt/questions 顺序作答 + freeText，sensitive 密码态）。应答经上层
// onResolve → taskSession.resolveInteraction（v4 resolveInteraction 命令）。
// workspaceHookReview 类本轮不渲染（spec §15 有意分歧）。D6：不 import @drora/ui。
import { useState } from "react";
import type { PendingInteraction } from "@drora/shared/drora-protocol-v4";
import { cn } from "./cn.js";
import { useIntl } from "./intl.js";

export interface InteractionAnswer {
  optionId?: string;
  freeText?: string;
}

export interface InteractionCardsProps {
  interactions: readonly PendingInteraction[];
  /** 应答进行中：禁用全部动作按钮（防双击重复提交；迟到应答由 CLI noop）。 */
  busy?: boolean;
  onResolve: (interactionId: string, answer: InteractionAnswer) => void;
  className?: string;
}

/** 选项 kind → 按钮配色（allow 系 primary、deny destructive、custom outline）。 */
function optionButtonClass(kind: string, isFullAccess: boolean): string {
  if (kind === "deny") {
    return "border border-destructive/40 text-destructive hover:bg-destructive/10";
  }
  if (kind === "allowOnce" || kind === "allowAlways") {
    return "bg-primary text-primary-foreground hover:bg-primary/90";
  }
  // custom / fullAccess。
  return isFullAccess
    ? "border border-warning/40 text-warning-foreground hover:bg-warning/10"
    : "border border-border text-foreground hover:bg-surface-hover";
}

/** 单条交互卡：内部持有 freeText 草稿（interactionId 维度互不干扰）。 */
function InteractionCard({
  interaction,
  busy,
  onResolve,
}: {
  interaction: PendingInteraction;
  busy?: boolean;
  onResolve: InteractionCardsProps["onResolve"];
}) {
  const { formatMessage } = useIntl();
  const [feedback, setFeedback] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [draft, setDraft] = useState("");

  if (interaction.payload.kind === "permission") {
    const payload = interaction.payload;
    const options = payload.fullAccessOption
      ? [...payload.options, payload.fullAccessOption]
      : payload.options;
    const submit = (optionId: string) => {
      const freeText = feedback.trim();
      onResolve(interaction.interactionId, freeText ? { optionId, freeText } : { optionId });
    };
    return (
      <div
        role="alert"
        className="rounded-xl border border-warning/30 bg-card p-4 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-ui-xs font-medium text-warning-foreground">
            {formatMessage({ id: "chat.permission.awaitingApproval" })}
          </span>
          <span className="truncate font-mono text-ui-xs text-foreground-subtle">
            {payload.toolName}
          </span>
        </div>
        <p className="mt-2 break-words text-ui-sm text-foreground">{payload.summary}</p>
        {payload.freeText ? (
          <div className="mt-2">
            <button
              type="button"
              className="text-ui-xs text-foreground-subtle underline-offset-2 hover:underline"
              onClick={() => setFeedbackOpen((open) => !open)}
            >
              {formatMessage({ id: "mobileShell.interaction.addFeedback" })}
            </button>
            {feedbackOpen ? (
              <textarea
                className="mt-1 max-h-24 min-h-9 w-full resize-none rounded-lg border border-input-border bg-input px-2.5 py-2 text-ui-sm text-foreground outline-none focus:border-input-border-focused"
                rows={2}
                maxLength={4096}
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
              />
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {options.map((option) => (
            <button
              key={option.optionId}
              type="button"
              disabled={busy === true}
              className={cn(
                "min-h-11 flex-1 rounded-lg px-3 py-2 text-ui-sm font-medium transition-colors disabled:opacity-50",
                optionButtonClass(option.kind, option.optionId === "fullAccess"),
              )}
              onClick={() => submit(option.optionId)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (interaction.payload.kind === "userInput") {
    const payload = interaction.payload;
    // 顺序作答当前题（spec §15 有意分歧：多题 elicitation 第一档只答 currentQuestionIndex）。
    const question =
      payload.questions && payload.questions.length > 0
        ? payload.questions[Math.min(payload.currentQuestionIndex ?? 0, payload.questions.length - 1)]
        : null;
    const sensitive = payload.sensitive === true;
    const submitFreeText = () => {
      const text = draft.trim();
      if (!text) return;
      onResolve(interaction.interactionId, { freeText: text });
      setDraft("");
    };
    return (
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-border bg-surface px-2 py-0.5 text-ui-xs font-medium text-foreground-subtle">
            {formatMessage({ id: "mobileShell.interaction.questionBadge" })}
          </span>
        </div>
        <p className="mt-2 break-words text-ui-sm text-foreground">
          {question ? question.question : payload.prompt}
        </p>
        {question?.options && question.options.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {question.options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={busy === true}
                className="min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-left text-ui-sm text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
                onClick={() => onResolve(interaction.interactionId, { optionId: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        {payload.freeText ? (
          <div className="mt-3 flex items-end gap-2">
            <input
              type={sensitive ? "password" : "text"}
              className="min-h-11 flex-1 rounded-lg border border-input-border bg-input px-3 py-2 text-mobile-input-safe text-foreground outline-none focus:border-input-border-focused"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitFreeText();
                }
              }}
            />
            <button
              type="button"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
              disabled={busy === true || !draft.trim()}
              aria-label={formatMessage({ id: "mobileShell.composer.send" })}
              onClick={submitFreeText}
            >
              ↑
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // workspaceHookReview：本轮不渲染（spec §15 有意分歧）。
  return null;
}

export function InteractionCards({
  interactions,
  busy,
  onResolve,
  className,
}: InteractionCardsProps) {
  const { formatMessage } = useIntl();
  const renderable = interactions.filter(
    (interaction) => interaction.payload.kind !== "workspaceHookReview",
  );
  if (renderable.length === 0) return null;
  return (
    <div className={cn("space-y-3 px-3 py-2", className)}>
      <div className="text-ui-xs font-medium text-foreground-subtle">
        {formatMessage({ id: "notification.permissionRequired" })}
      </div>
      {renderable.map((interaction) => (
        <InteractionCard
          key={interaction.interactionId}
          interaction={interaction}
          busy={busy}
          onResolve={onResolve}
        />
      ))}
    </div>
  );
}
