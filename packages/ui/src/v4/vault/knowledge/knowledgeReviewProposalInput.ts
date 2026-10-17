/**
 * Prepare one human-authored L2 proposal, without applying any Vault writes.
 * The host's createProposal performs the authoritative path/epoch/base-SHA check.
 */
import type {
  IObsidianVaultService,
  KnowledgeReviewCreateProposalParams,
  KnowledgeReviewChangeKind,
} from "@drora/services";

export interface ReviewProposalDraft {
  title: string;
  reason: string;
  kind: KnowledgeReviewChangeKind;
  relativePath: string;
  content: string;
}

/**
 * 提案表单本地校验错误的稳定码（增量评审 D-3 修复：错误一律携带 code，
 * 由 UI 映射 i18n 文案；模块不再抛英文文案字符串，中文界面不再直出英文）。
 */
export type ReviewProposalInputErrorCode =
  | "titleReasonRequired"
  | "invalidPath"
  | "unsupportedKind"
  | "contentTooLarge"
  | "vaultNotConfigured"
  | "vaultChanged";

export class ReviewProposalInputError extends Error {
  constructor(readonly code: ReviewProposalInputErrorCode) {
    super(code);
    this.name = "ReviewProposalInputError";
  }
}

export async function prepareKnowledgeReviewProposal(
  draft: ReviewProposalDraft,
  vault: Pick<IObsidianVaultService, "getSummary" | "readFile">,
): Promise<KnowledgeReviewCreateProposalParams> {
  const title = draft.title.trim();
  const reason = draft.reason.trim();
  const relativePath = draft.relativePath.trim().replace(/\\/g, "/");
  if (!title || !reason) throw new ReviewProposalInputError("titleReasonRequired");
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.includes("\0") ||
    /(^|\/)\.{1,2}(\/|$)/.test(relativePath) ||
    /(^|\/)\.[^/]+/.test(relativePath) ||
    !/\.md$/i.test(relativePath) ||
    /^[a-z]:/i.test(relativePath)
  ) {
    throw new ReviewProposalInputError("invalidPath");
  }
  if (draft.kind !== "create" && draft.kind !== "write" && draft.kind !== "delete") {
    throw new ReviewProposalInputError("unsupportedKind");
  }
  if (
    draft.kind !== "delete" &&
    new TextEncoder().encode(draft.content).byteLength > 2 * 1024 * 1024
  ) {
    throw new ReviewProposalInputError("contentTooLarge");
  }

  const before = await vault.getSummary();
  if (!before) throw new ReviewProposalInputError("vaultNotConfigured");
  if (draft.kind === "create") {
    const after = await vault.getSummary();
    if (!after || before.vaultId !== after.vaultId || before.configuredAt !== after.configuredAt) {
      throw new ReviewProposalInputError("vaultChanged");
    }
    return { title, reason, changes: [{ kind: "create", relativePath, content: draft.content }] };
  }
  // Never invent a base SHA. The actual Vault RPC resolves a safe, current path.
  const current = await vault.readFile({ relativePath });
  const after = await vault.getSummary();
  if (
    !after ||
    before.vaultId !== after.vaultId ||
    before.configuredAt !== after.configuredAt ||
    current.relativePath !== relativePath
  ) {
    throw new ReviewProposalInputError("vaultChanged");
  }
  const change =
    draft.kind === "write"
      ? { kind: "write" as const, relativePath, baseSha256: current.sha256, content: draft.content }
      : { kind: "delete" as const, relativePath, baseSha256: current.sha256 };
  return { title, reason, changes: [change] };
}
