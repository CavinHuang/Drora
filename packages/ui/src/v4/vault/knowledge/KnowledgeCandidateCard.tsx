/**
 * 智能问库候选卡 + 状态条（W04 / spec §5c.3）。
 *
 * 从 KnowledgeAskView 拆出的展示子组件：候选卡（为何候选/节选/核验/加入 Agent/
 * 追问/跳到原文）与低噪音状态条。数据只来自服务端结构化结果，UI 不做二次推断。
 */
import * as React from "react";
import {
  BookOpenText,
  CircleSlash,
  FileSearch,
  Loader2,
  SendHorizonal,
  ShieldCheck,
} from "lucide-react";
import type { KnowledgeArticleCandidate } from "@drora/services";
import { Button } from "@/components/ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { toast as droraToast } from "@/components/ui/toast.js";
import {
  createConversationSelectionReference,
  dispatchConversationSelectionAdd,
  type MarkdownSelectionTarget,
} from "@/lib/conversationSelectionReference.js";
import {
  deriveAskBanners,
  type KnowledgeEvidenceInspectState,
  type KnowledgeEvidenceQuote,
} from "./knowledgeAskModel.js";
import { cn } from "@/components/lib/utils.js";

const toast = {
  error: (message: string): void => {
    droraToast(message, { variant: "warning" });
  },
};

/** prepareEvidence/resolveCitation 的结构化失败 → 文案 key（不做二次猜测）。 */
export function evidenceUnavailableMessageKey(status: string): string {
  switch (status) {
    case "stale":
      return "vault.ask.evidence.stale";
    case "missing":
      return "vault.ask.evidence.missing";
    case "forbidden":
      return "vault.ask.evidence.forbidden";
    case "no_source":
      return "vault.ask.evidence.noSource";
    case "source_stale":
      return "vault.ask.evidence.sourceStale";
    default:
      return "vault.ask.evidence.forbidden";
  }
}

const BANNER_TONE: Record<string, string> = {
  noVault: "text-foreground-subtle",
  indexing: "text-foreground-subtle",
  indexMissing: "text-warning",
  indexPartial: "text-warning",
  semanticUnavailable: "text-foreground-subtle",
  sourceStale: "text-warning",
  noAnswer: "text-foreground-subtle",
  expandedSearch: "text-foreground-subtle",
  jevOff: "text-foreground-subtlest",
  cancelled: "text-foreground-subtle",
  modelUnavailable: "text-foreground-subtle",
};

export function AskBannerList({
  banners,
}: {
  banners: ReturnType<typeof deriveAskBanners>;
}): React.ReactElement | null {
  const { intl } = useDroraIntl();
  if (banners.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="ask-banners">
      {banners.map((code) => (
        <p
          key={code}
          data-banner-code={code}
          className={cn("text-ui-sm leading-5", BANNER_TONE[code] ?? "text-foreground-subtle")}
        >
          {intl.formatMessage({ id: `vault.ask.banner.${code}` })}
        </p>
      ))}
    </div>
  );
}

export function displayCandidateTitle(candidate: KnowledgeArticleCandidate): string {
  return candidate.title.replace(/\.md$/i, "");
}

export function KnowledgeCandidateCard({
  candidate,
  selected,
  inspect,
  sessionId,
  selectionTarget,
  onOpenNote,
  onSelect,
  onVerify,
  onFollowUp,
}: {
  candidate: KnowledgeArticleCandidate;
  selected: boolean;
  inspect: KnowledgeEvidenceInspectState | undefined;
  sessionId?: string;
  selectionTarget: MarkdownSelectionTarget | null;
  onOpenNote: (relativePath: string, reveal?: KnowledgeEvidenceQuote) => void;
  onSelect: (articleId: string) => void;
  onVerify: (candidate: KnowledgeArticleCandidate) => void;
  onFollowUp: (candidate: KnowledgeArticleCandidate) => void;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  const verified = inspect?.phase === "verified" ? inspect : null;
  return (
    <article
      data-testid="ask-candidate"
      data-article-id={candidate.articleId}
      aria-selected={selected}
      className={cn(
        "rounded-xl border bg-card p-3 transition-colors",
        selected ? "border-card-border bg-card-selected" : "border-card-border hover:bg-surface-hover",
      )}
    >
      <button
        type="button"
        className="flex w-full min-w-0 flex-col gap-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSelect(candidate.articleId)}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-ui-xs text-foreground-subtlest">#{candidate.rank}</span>
          <span className="min-w-0 truncate text-ui-base font-medium text-foreground">
            {displayCandidateTitle(candidate)}
          </span>
          <span className="ml-auto shrink-0 text-ui-xs text-foreground-subtlest">
            {intl.formatMessage({ id: "vault.ask.candidate.chunks" }, { count: candidate.matchedChunkCount })}
          </span>
        </span>
        <span className="truncate font-mono text-ui-xs text-foreground-subtlest">{candidate.relativePath}</span>
        {candidate.matchedHeading && (
          <span className="truncate text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "vault.ask.candidate.why" })}: {candidate.matchedHeading}
          </span>
        )}
        <span className="line-clamp-3 whitespace-pre-wrap text-ui-sm leading-5 text-foreground-subtle">
          {candidate.excerpt}
        </span>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={inspect?.phase === "checking"}
          onClick={() => onVerify(candidate)}
        >
          {inspect?.phase === "checking" ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <ShieldCheck className="size-3.5" />
          )}
          {intl.formatMessage({
            id: verified ? "vault.ask.candidate.reverify" : "vault.ask.candidate.verify",
          })}
        </Button>
        {verified && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => onOpenNote(verified.relativePath, verified.quote)}
          >
            <BookOpenText className="size-3.5" />
            {intl.formatMessage({ id: "vault.ask.candidate.openNote" })}
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={!selectionTarget}
              onClick={() => {
                if (!selectionTarget) {
                  toast.error(intl.formatMessage({ id: "vault.ask.candidate.needSession" }));
                  return;
                }
                // userselect 引用语义（spec §5.4）：普通引用，不是 Receipt、不获执行时复验；
                // 该边界已通过按钮文案与 Tooltip 明示。
                const reference = createConversationSelectionReference({
                  contentType: "markdown",
                  sourceKey: `vault:${candidate.relativePath}`,
                  sourceTitle: displayCandidateTitle(candidate),
                  path: candidate.relativePath,
                  text: candidate.excerpt,
                });
                const result = dispatchConversationSelectionAdd({
                  targetSessionId: selectionTarget.sessionId,
                  workspaceKey: selectionTarget.workspaceKey,
                  reference,
                });
                if (!result.ok) {
                  toast.error(
                    intl.formatMessage({
                      id: result.reason === "count" ? "vault.selection.limitReached" : "vault.selection.tooLong",
                    }),
                  );
                }
              }}
            >
              <SendHorizonal className="size-3.5" />
              {intl.formatMessage({ id: "vault.ask.candidate.addToAgent" })}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">
            {intl.formatMessage({ id: "vault.ask.candidate.addToAgentHint" })}
          </TooltipContent>
        </Tooltip>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={!sessionId}
          onClick={() => onFollowUp(candidate)}
        >
          <FileSearch className="size-3.5" />
          {intl.formatMessage({ id: "vault.ask.candidate.askAbout" })}
        </Button>
      </div>
      {inspect && inspect.phase !== "checking" && (
        <div
          data-testid="ask-evidence"
          data-evidence-phase={inspect.phase}
          className="mt-2 rounded-lg border border-border/60 bg-surface p-2.5"
        >
          {inspect.phase === "verified" && (
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex items-center gap-1.5 text-ui-sm font-medium text-success">
                <ShieldCheck className="size-3.5" />
                {intl.formatMessage({ id: "vault.ask.evidence.verified" })}
              </p>
              <p className="font-mono text-ui-xs text-foreground-subtlest">
                {intl.formatMessage(
                  { id: "vault.ask.evidence.lines" },
                  { start: inspect.quote.startLine, end: inspect.quote.endLine },
                )}
              </p>
              <p className="whitespace-pre-wrap text-ui-sm leading-5 text-foreground-subtle">{inspect.excerpt}</p>
              <p className="truncate font-mono text-ui-xs text-foreground-subtlest">
                {intl.formatMessage({ id: "vault.ask.evidence.receipt" }, { id: inspect.receiptId })}
              </p>
            </div>
          )}
          {inspect.phase === "unavailable" && (
            <p className="flex items-center gap-1.5 text-ui-sm text-warning">
              <CircleSlash className="size-3.5 shrink-0" />
              {intl.formatMessage({ id: evidenceUnavailableMessageKey(inspect.status) })}
              {inspect.reason && (
                <span className="font-mono text-ui-xs text-foreground-subtlest">({inspect.reason})</span>
              )}
            </p>
          )}
          {inspect.phase === "failed" && (
            <p className="text-ui-sm text-destructive">
              {intl.formatMessage({ id: "vault.ask.evidence.failed" }, { message: inspect.message })}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
