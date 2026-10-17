/**
 * Human-authored proposal entry. Proposal creation/approval is ledger-only;
 * apply/undo require the runtime S03 gate, explicit Vault write authorization,
 * the Review write-path opt-in, and the current proposal approval.
 */
import * as React from "react";
import { Loader2 } from "lucide-react";
import type {
  IKnowledgeReviewService,
  IObsidianVaultService,
  KnowledgeReviewChangeKind,
} from "@drora/services";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import {
  prepareKnowledgeReviewProposal,
  ReviewProposalInputError,
  type ReviewProposalDraft,
  type ReviewProposalInputErrorCode,
} from "./knowledgeReviewProposalInput.js";

/** 错误码 → i18n 键静态映射（增量评审 D-3：不再把英文 Error.message 直出到界面）。 */
const PROPOSAL_ERROR_KEYS: Record<ReviewProposalInputErrorCode, string> = {
  titleReasonRequired: "vault.review.proposalError.titleReasonRequired",
  invalidPath: "vault.review.proposalError.invalidPath",
  unsupportedKind: "vault.review.proposalError.unsupportedKind",
  contentTooLarge: "vault.review.proposalError.contentTooLarge",
  vaultNotConfigured: "vault.review.proposalError.vaultNotConfigured",
  vaultChanged: "vault.review.proposalError.vaultChanged",
};

export function KnowledgeReviewProposalComposer({
  vaultService,
  reviewService,
  onCreated,
  disabled,
}: {
  vaultService: IObsidianVaultService | null;
  reviewService: IKnowledgeReviewService | null;
  onCreated: () => Promise<void>;
  disabled: boolean;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  const [draft, setDraft] = React.useState<ReviewProposalDraft>({
    title: "",
    reason: "",
    relativePath: "",
    content: "",
    kind: "create",
  });
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);
  const [loadedPath, setLoadedPath] = React.useState<string | null>(null);
  const change = <K extends keyof ReviewProposalDraft>(
    key: K,
    value: ReviewProposalDraft[K],
  ): void => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (key === "kind" || key === "relativePath") setLoadedPath(null);
    setError(null);
    setSuccess(false);
  };

  async function loadCurrentMarkdown(): Promise<void> {
    if (!vaultService || working || disabled || draft.kind !== "write") return;
    const requested = draft.relativePath.trim().replace(/\\/g, "/");
    if (!requested) return;
    setWorking(true);
    setError(null);
    try {
      const before = await vaultService.getSummary();
      if (!before) throw new ReviewProposalInputError("vaultNotConfigured");
      const current = await vaultService.readFile({ relativePath: requested });
      const after = await vaultService.getSummary();
      if (
        !after ||
        before.vaultId !== after.vaultId ||
        before.configuredAt !== after.configuredAt ||
        current.relativePath !== requested
      ) {
        throw new ReviewProposalInputError("vaultChanged");
      }
      setDraft((prev) => ({ ...prev, content: current.content }));
      setLoadedPath(requested);
    } catch (cause) {
      setLoadedPath(null);
      setError(proposalErrorText(cause));
    } finally {
      setWorking(false);
    }
  }

  /** 表单错误的统一出口：本地校验按错误码走 i18n，未知错误走通用文案。 */
  function proposalErrorText(cause: unknown): string {
    if (cause instanceof ReviewProposalInputError) {
      return intl.formatMessage({ id: PROPOSAL_ERROR_KEYS[cause.code] });
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    return intl.formatMessage(
      { id: "vault.review.error.generic" },
      { detail: detail.slice(0, 160) },
    );
  }

  async function submit(): Promise<void> {
    if (
      !reviewService ||
      !vaultService ||
      working ||
      disabled ||
      (draft.kind === "write" && loadedPath !== draft.relativePath.trim().replace(/\\/g, "/"))
    )
      return;
    setWorking(true);
    setError(null);
    setSuccess(false);
    try {
      const params = await prepareKnowledgeReviewProposal(draft, vaultService);
      // createProposal is read/ledger-only. Never call applyProposal from this form.
      await reviewService.createProposal(params);
      await onCreated();
      setDraft({ title: "", reason: "", relativePath: "", content: "", kind: "create" });
      setLoadedPath(null);
      setSuccess(true);
    } catch (cause) {
      setError(proposalErrorText(cause));
    } finally {
      setWorking(false);
    }
  }

  const blocked = working || disabled || !reviewService || !vaultService;
  const fieldStyle =
    "w-full min-w-0 rounded-lg border border-card-border bg-background px-3 py-2 text-ui-sm text-foreground";
  return (
    <form
      className="rounded-xl border border-card-border bg-card p-4"
      data-testid="review-proposal-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "vault.review.createTitle" })}
      </h3>
      <p className="mt-1 text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "vault.review.createNoWriteHint" })}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-ui-sm text-foreground">
          {intl.formatMessage({ id: "vault.review.proposalTitle" })}
          <input
            className={fieldStyle}
            data-testid="review-proposal-title"
            value={draft.title}
            maxLength={160}
            onChange={(event) => change("title", event.target.value)}
            disabled={blocked}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-ui-sm text-foreground">
          {intl.formatMessage({ id: "vault.review.proposalKind" })}
          <select
            className={fieldStyle}
            data-testid="review-proposal-kind"
            value={draft.kind}
            onChange={(event) => change("kind", event.target.value as KnowledgeReviewChangeKind)}
            disabled={blocked}
          >
            <option value="create">
              {intl.formatMessage({ id: "vault.review.proposalCreate" })}
            </option>
            <option value="write">
              {intl.formatMessage({ id: "vault.review.proposalWrite" })}
            </option>
            <option value="delete">
              {intl.formatMessage({ id: "vault.review.proposalDelete" })}
            </option>
          </select>
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1 text-ui-sm text-foreground">
        {intl.formatMessage({ id: "vault.review.proposalPath" })}
        <input
          className={fieldStyle}
          data-testid="review-proposal-path"
          value={draft.relativePath}
          placeholder="notes/example.md"
          onChange={(event) => change("relativePath", event.target.value)}
          disabled={blocked}
          required
        />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-ui-sm text-foreground">
        {intl.formatMessage({ id: "vault.review.proposalReason" })}
        <textarea
          className={fieldStyle}
          data-testid="review-proposal-reason"
          rows={2}
          value={draft.reason}
          onChange={(event) => change("reason", event.target.value)}
          disabled={blocked}
          required
        />
      </label>
      {draft.kind === "write" && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="review-proposal-load"
            disabled={blocked || !draft.relativePath.trim()}
            onClick={() => {
              void loadCurrentMarkdown();
            }}
          >
            {working && <Loader2 className="size-3.5 animate-spin" />}
            {intl.formatMessage({ id: "vault.review.proposalLoadExisting" })}
          </Button>
          <p
            className="text-ui-sm text-foreground-subtle"
            data-testid="review-proposal-load-status"
            data-loaded={String(
              !working && loadedPath === draft.relativePath.trim().replace(/\\/g, "/"),
            )}
          >
            {working
              ? intl.formatMessage({ id: "vault.review.proposalLoadLoading" })
              : loadedPath === draft.relativePath.trim().replace(/\\/g, "/")
                ? intl.formatMessage({ id: "vault.review.proposalLoaded" })
                : intl.formatMessage({ id: "vault.review.proposalLoadRequired" })}
          </p>
        </div>
      )}
      {draft.kind !== "delete" && (
        <label className="mt-3 flex flex-col gap-1 text-ui-sm text-foreground">
          {intl.formatMessage({ id: "vault.review.proposalContent" })}
          <textarea
            className={fieldStyle + " font-mono"}
            data-testid="review-proposal-content"
            rows={7}
            value={draft.content}
            onChange={(event) => change("content", event.target.value)}
            disabled={blocked}
            spellCheck={false}
          />
        </label>
      )}
      {error && (
        <p
          className="mt-2 text-ui-sm text-destructive"
          role="alert"
          data-testid="review-proposal-error"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          className="mt-2 text-ui-sm text-foreground"
          role="status"
          data-testid="review-proposal-created"
        >
          {intl.formatMessage({ id: "vault.review.proposalCreated" })}
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={
            blocked ||
            !draft.title.trim() ||
            !draft.relativePath.trim() ||
            !draft.reason.trim() ||
            (draft.kind === "write" && loadedPath !== draft.relativePath.trim().replace(/\\/g, "/"))
          }
          data-testid="review-proposal-submit"
        >
          {intl.formatMessage({ id: "vault.review.proposalSubmit" })}
        </Button>
      </div>
    </form>
  );
}
