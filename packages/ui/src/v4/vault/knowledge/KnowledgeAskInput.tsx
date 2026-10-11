/**
 * 智能问库输入区（W04 / spec §5c.3）。
 *
 * 意图四选一（自动识别默认/找文章/问内容/比较）+ 多行自然语言输入
 * （Enter 提交、Shift+Enter 换行、IME 组合期不提交）+ 检索中取消/失败重试。
 */
import * as React from "react";
import { Loader2, RefreshCw, Search, Square } from "lucide-react";
import type { KnowledgeIndexStatus } from "@drora/services";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { KnowledgeAskIntentChoice } from "./knowledgeAskModel.js";
import { cn } from "@/components/lib/utils.js";

const INTENT_CHOICES: KnowledgeAskIntentChoice[] = ["auto", "find", "answer", "compare"];

export function KnowledgeAskInput({
  input,
  onInputChange,
  intentChoice,
  onIntentChoiceChange,
  indexStatus,
  retrieving,
  failed,
  canRetry,
  onSubmit,
  onCancel,
  onRetry,
  onConnectVault,
}: {
  input: string;
  onInputChange: (value: string) => void;
  intentChoice: KnowledgeAskIntentChoice;
  onIntentChoiceChange: (choice: KnowledgeAskIntentChoice) => void;
  indexStatus: KnowledgeIndexStatus | null;
  retrieving: boolean;
  failed: boolean;
  canRetry: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onConnectVault: () => void;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  return (
    <div className="rounded-xl border border-card-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-1.5 pb-2">
        {INTENT_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={intentChoice === choice}
            onClick={() => onIntentChoiceChange(choice)}
            className={cn(
              "rounded-lg px-2 py-1 text-ui-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              intentChoice === choice
                ? "bg-selected text-foreground"
                : "text-foreground-subtle hover:bg-hover hover:text-foreground",
            )}
          >
            {intl.formatMessage({ id: `vault.ask.intent.${choice}` })}
          </button>
        ))}
        {indexStatus?.configured ? (
          <span className="ml-auto truncate font-mono text-ui-xs text-foreground-subtlest">
            {intl.formatMessage(
              { id: "vault.ask.scope" },
              {
                name: indexStatus.source?.displayName ?? "",
                files: indexStatus.coverage.indexedFiles,
              },
            )}
          </span>
        ) : null}
      </div>
      <Textarea
        autoFocus
        data-testid="ask-input"
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={(event) => {
          // Enter 提交 / Shift+Enter 换行 / IME 组合期 Enter 不提交（spec §5c.3）。
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={intl.formatMessage({ id: "vault.ask.placeholder" })}
        aria-label={intl.formatMessage({ id: "vault.ask.inputAria" })}
        className="min-h-20"
      />
      <div className="flex items-center gap-2 pt-2">
        <Button type="button" size="sm" disabled={!input.trim() || retrieving} onClick={onSubmit}>
          <Search className="size-4" />
          {intl.formatMessage({ id: "vault.ask.submit" })}
        </Button>
        {retrieving && (
          <Button type="button" size="sm" variant="outline" onClick={onCancel}>
            <Square className="size-3.5" />
            {intl.formatMessage({ id: "vault.ask.cancel" })}
          </Button>
        )}
        {failed && canRetry && (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="size-3.5" />
            {intl.formatMessage({ id: "vault.ask.retry" })}
          </Button>
        )}
        {retrieving && (
          <span className="flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
            <Loader2 className="size-3.5 animate-spin" />
            {intl.formatMessage({ id: "vault.ask.retrieving" })}
          </span>
        )}
        {!indexStatus?.configured && (
          <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onConnectVault}>
            {intl.formatMessage({ id: "vault.ask.connectVault" })}
          </Button>
        )}
      </div>
    </div>
  );
}
