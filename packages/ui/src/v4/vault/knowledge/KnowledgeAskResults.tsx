/**
 * 智能问库结果区子组件（W04 / spec §5c）。
 *
 * 从 KnowledgeAskView 拆出的结果态展示：Decision trace（默认折叠）、上一轮
 * （追问保留，默认折叠）、结构化空态/引导/过期态。
 */
import * as React from "react";
import { ChevronDown, ChevronRight, FileSearch, Loader2, Search } from "lucide-react";
import type { KnowledgeArticleCandidate, KnowledgeRunView } from "@drora/services";
import { Button } from "@/components/ui/button.js";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { displayCandidateTitle } from "./KnowledgeCandidateCard.js";
import type { KnowledgeEvidenceQuote } from "./knowledgeAskModel.js";

export function AskDecisionTrace({
  run,
  open,
  onOpenChange,
}: {
  run: KnowledgeRunView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement | null {
  const { intl } = useDroraIntl();
  const diagnostics = run?.diagnostics ?? null;
  if (!diagnostics) return null;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="mt-3" data-testid="ask-decision-trace">
      <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-lg px-1 py-1 text-ui-sm text-foreground-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        {intl.formatMessage({ id: "vault.ask.trace.title" })}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-surface p-2.5 font-mono text-ui-xs text-foreground-subtle">
          <dt className="text-foreground-subtlest">runId</dt>
          <dd className="truncate">{run?.runId ?? "—"}</dd>
          <dt className="text-foreground-subtlest">sourceEpoch</dt>
          <dd>{run?.source?.sourceEpoch ?? "—"}</dd>
          <dt className="text-foreground-subtlest">lexicalChunkHits</dt>
          <dd>{diagnostics.lexicalChunkHits}</dd>
          <dt className="text-foreground-subtlest">lexicalCandidates</dt>
          <dd>{diagnostics.lexicalCandidates}</dd>
          <dt className="text-foreground-subtlest">matchRelaxedToOr</dt>
          <dd>{String(diagnostics.matchRelaxedToOr)}</dd>
          <dt className="text-foreground-subtlest">semantic</dt>
          <dd>
            {diagnostics.semantic}
            {diagnostics.semanticReason ? ` (${diagnostics.semanticReason})` : ""}
          </dd>
          {run?.candidates[0] && (
            <>
              <dt className="text-foreground-subtlest">topScore</dt>
              <dd>{run.candidates[0].score.toFixed(4)}</dd>
            </>
          )}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AskPreviousRound({
  candidates,
  submittedQuery,
  onOpenNote,
}: {
  candidates: KnowledgeArticleCandidate[];
  submittedQuery: string;
  onOpenNote: (relativePath: string, reveal?: KnowledgeEvidenceQuote) => void;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  return (
    <Collapsible className="mt-3">
      <CollapsibleTrigger className="group flex w-full items-center gap-1 rounded-lg px-1 py-1 text-ui-sm text-foreground-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {intl.formatMessage({ id: "vault.ask.previous.title" })}：
        <span className="min-w-0 truncate">{submittedQuery}</span>
        <span className="text-ui-xs text-foreground-subtlest">({candidates.length})</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 pt-2">
          {candidates.slice(0, 5).map((candidate) => (
            <button
              key={candidate.articleId}
              type="button"
              onClick={() => onOpenNote(candidate.relativePath)}
              className="flex min-w-0 items-center gap-2 rounded-lg border border-card-border bg-surface px-2.5 py-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 truncate text-ui-sm text-foreground">
                {displayCandidateTitle(candidate)}
              </span>
              <span className="ml-auto shrink-0 truncate font-mono text-ui-xs text-foreground-subtlest">
                {candidate.relativePath}
              </span>
            </button>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AskEmptyState(): React.ReactElement {
  const { intl } = useDroraIntl();
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="ask-empty">
      <FileSearch className="size-6 text-foreground-subtlest" />
      <p className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "vault.ask.empty.title" })}
      </p>
      <p className="text-ui-sm text-foreground-subtle">{intl.formatMessage({ id: "vault.ask.empty.hint" })}</p>
    </div>
  );
}

export function AskNoVaultState({ onConnect }: { onConnect: () => void }): React.ReactElement {
  const { intl } = useDroraIntl();
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="ask-novault">
      <p className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "vault.ask.noVault.title" })}
      </p>
      <p className="text-ui-sm text-foreground-subtle">{intl.formatMessage({ id: "vault.ask.noVault.hint" })}</p>
      <Button type="button" size="sm" variant="outline" onClick={onConnect}>
        {intl.formatMessage({ id: "vault.ask.connectVault" })}
      </Button>
    </div>
  );
}

export function AskBuildIndexButton({
  busy,
  onStart,
}: {
  busy: boolean;
  onStart: () => void;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  return (
    <div className="flex justify-center pb-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onStart}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
        {intl.formatMessage({ id: "vault.ask.index.build" })}
      </Button>
    </div>
  );
}

export function AskSourceStaleState(): React.ReactElement {
  const { intl } = useDroraIntl();
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center" data-testid="ask-stale">
      <p className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "vault.ask.sourceStale.title" })}
      </p>
      <p className="text-ui-sm text-foreground-subtle">{intl.formatMessage({ id: "vault.ask.sourceStale.hint" })}</p>
    </div>
  );
}
