/**
 * Human-authored proposal entry. Proposal creation/approval is ledger-only;
 * production apply/undo remains blocked until an independent S03 safety GO.
 */
import * as React from "react";
import type { IKnowledgeReviewService, IObsidianVaultService, KnowledgeReviewChangeKind } from "@drora/services";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { prepareKnowledgeReviewProposal, type ReviewProposalDraft } from "./knowledgeReviewProposalInput.js";

export function KnowledgeReviewProposalComposer({
  vaultService, reviewService, onCreated, disabled,
}: {
  vaultService: IObsidianVaultService | null;
  reviewService: IKnowledgeReviewService | null;
  onCreated: () => Promise<void>;
  disabled: boolean;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  const [draft, setDraft] = React.useState<ReviewProposalDraft>({
    title: "", reason: "", relativePath: "", content: "", kind: "create",
  });
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const change = <K extends keyof ReviewProposalDraft,>(key: K, value: ReviewProposalDraft[K]): void => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSuccess(false);
  };

  async function submit(): Promise<void> {
    if (!reviewService || !vaultService || working || disabled) return;
    setWorking(true);
    setError(null);
    setSuccess(false);
    try {
      const params = await prepareKnowledgeReviewProposal(draft, vaultService);
      // createProposal is read/ledger-only. Never call applyProposal from this form.
      await reviewService.createProposal(params);
      await onCreated();
      setDraft({ title: "", reason: "", relativePath: "", content: "", kind: "create" });
      setSuccess(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  }

  const blocked = working || disabled || !reviewService || !vaultService;
  const fieldStyle = "w-full min-w-0 rounded-lg border border-card-border bg-background px-3 py-2 text-ui-sm text-foreground";
  return (
    <form className="rounded-xl border border-card-border bg-card p-4" data-testid="review-proposal-composer"
      onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h3 className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "vault.review.createTitle" })}
      </h3>
      <p className="mt-1 text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "vault.review.createNoWriteHint" })}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-ui-sm text-foreground">
          {intl.formatMessage({ id: "vault.review.proposalTitle" })}
          <input className={fieldStyle} data-testid="review-proposal-title" value={draft.title}
            maxLength={160} onChange={(event) => change("title", event.target.value)} disabled={blocked} required />
        </label>
        <label className="flex flex-col gap-1 text-ui-sm text-foreground">
          {intl.formatMessage({ id: "vault.review.proposalKind" })}
          <select className={fieldStyle} data-testid="review-proposal-kind" value={draft.kind}
            onChange={(event) => change("kind", event.target.value as KnowledgeReviewChangeKind)}
            disabled={blocked}>
            <option value="create">{intl.formatMessage({ id: "vault.review.proposalCreate" })}</option>
            <option value="write">{intl.formatMessage({ id: "vault.review.proposalWrite" })}</option>
            <option value="delete">{intl.formatMessage({ id: "vault.review.proposalDelete" })}</option>
          </select>
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1 text-ui-sm text-foreground">
        {intl.formatMessage({ id: "vault.review.proposalPath" })}
        <input className={fieldStyle} data-testid="review-proposal-path" value={draft.relativePath}
          placeholder="notes/example.md" onChange={(event) => change("relativePath", event.target.value)}
          disabled={blocked} required />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-ui-sm text-foreground">
        {intl.formatMessage({ id: "vault.review.proposalReason" })}
        <textarea className={fieldStyle} data-testid="review-proposal-reason" rows={2}
          value={draft.reason} onChange={(event) => change("reason", event.target.value)}
          disabled={blocked} required />
      </label>
      {draft.kind !== "delete" && (
        <label className="mt-3 flex flex-col gap-1 text-ui-sm text-foreground">
          {intl.formatMessage({ id: "vault.review.proposalContent" })}
          <textarea className={fieldStyle + " font-mono"} data-testid="review-proposal-content" rows={7}
            value={draft.content} onChange={(event) => change("content", event.target.value)}
            disabled={blocked} spellCheck={false} />
        </label>
      )}
      {error && <p className="mt-2 text-ui-sm text-destructive" role="alert" data-testid="review-proposal-error">{error}</p>}
      {success && <p className="mt-2 text-ui-sm text-foreground" role="status" data-testid="review-proposal-created">
        {intl.formatMessage({ id: "vault.review.proposalCreated" })}
      </p>}
      <div className="mt-3 flex justify-end">
        <Button type="submit" size="sm" disabled={blocked || !draft.title.trim() ||
          !draft.relativePath.trim() || !draft.reason.trim()} data-testid="review-proposal-submit">
          {intl.formatMessage({ id: "vault.review.proposalSubmit" })}
        </Button>
      </div>
    </form>
  );
}
