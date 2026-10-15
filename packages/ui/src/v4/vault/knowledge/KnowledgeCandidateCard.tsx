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
import { extractQueryTerms } from "@drora/shared";
import { KnowledgeHighlightedText } from "@/v4/vault/knowledge/KnowledgeHighlightedText.js";
import { Button } from "@/components/ui/button.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { setPendingSettingsSection } from "@/lib/settingsNavigation.js";
import type { MarkdownSelectionTarget } from "@/lib/conversationSelectionReference.js";
import {
  deriveAskBanners,
  type KnowledgeEvidenceInspectState,
  type KnowledgeEvidenceQuote,
} from "./knowledgeAskModel.js";
import { cn } from "@/components/lib/utils.js";

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
  // jevOff 是唯一带配置入口的横幅：跳设置页「知识问答」分区（桌面端分区可见）。
  // 与 App.handleOpenSettingsSection 同一机制：先写意图再开设置 tab，不另开路径。
  const openSettingsTab = useTabStore((state) => state.openSettingsTab);
  const goKnowledgeSettings = React.useCallback(() => {
    setPendingSettingsSection("knowledge");
    openSettingsTab();
  }, [openSettingsTab]);
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
          {code === "jevOff" ? (
            <button
              type="button"
              data-testid="ask-banner-jev-settings"
              className="underline underline-offset-2 hover:opacity-80"
              onClick={goKnowledgeSettings}
            >
              {intl.formatMessage({ id: "vault.ask.banner.jevOff.settings" })}
            </button>
          ) : null}
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
  query,
  selected,
  inspect,
  sessionId,
  selectionTarget,
  adding,
  onAddToAgent,
  onOpenNote,
  onSelect,
  onVerify,
  onFollowUp,
}: {
  candidate: KnowledgeArticleCandidate;
  /** 本轮提交的原始查询（spec §5c.3）：提取词元做摘录 <mark> 高亮，空查询不高亮。 */
  query: string;
  selected: boolean;
  inspect: KnowledgeEvidenceInspectState | undefined;
  sessionId?: string;
  selectionTarget: MarkdownSelectionTarget | null;
  adding: boolean;
  /** Verify a fresh receipt, then attach it to the existing Agent composer. */
  onAddToAgent: (candidate: KnowledgeArticleCandidate) => void;
  onOpenNote: (relativePath: string, reveal?: KnowledgeEvidenceQuote) => void;
  onSelect: (articleId: string) => void;
  onVerify: (candidate: KnowledgeArticleCandidate) => void;
  onFollowUp: (candidate: KnowledgeArticleCandidate) => void;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  const verified = inspect?.phase === "verified" ? inspect : null;
  // 词元提取是 shared 单一出处（spec §5b.5），与 services 命中感知摘要同一口径。
  const highlightTerms = React.useMemo(() => extractQueryTerms(query), [query]);
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
          {/* 摘录命中高亮是纯展示（spec §5c.3）：excerpt 事实字段与「加入 Agent」
              携带的 candidate.excerpt 原文一律不变，仅渲染层标出命中词元。 */}
          <KnowledgeHighlightedText text={candidate.excerpt} terms={highlightTerms} />
        </span>
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={inspect?.phase === "checking"}
          data-testid="ask-candidate-verify"
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
            data-testid="ask-candidate-open-note"
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
              disabled={!selectionTarget || adding}
              onClick={() => onAddToAgent(candidate)}
            >
              {adding ? <Loader2 className="size-3.5 animate-spin" /> : <SendHorizonal className="size-3.5" />}
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
