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

export async function prepareKnowledgeReviewProposal(
  draft: ReviewProposalDraft,
  vault: Pick<IObsidianVaultService, "getSummary" | "readFile">,
): Promise<KnowledgeReviewCreateProposalParams> {
  const title = draft.title.trim();
  const reason = draft.reason.trim();
  const relativePath = draft.relativePath.trim().replace(/\\/g, "/");
  if (!title || !reason) throw new Error("Proposal title and reason are required");
  if (!relativePath || relativePath.startsWith("/") || relativePath.includes("\0") ||
      /(^|\/)\.{1,2}(\/|$)/.test(relativePath) || /(^|\/)\.[^/]+/.test(relativePath) ||
      !/\.md$/i.test(relativePath) || /^[a-z]:/i.test(relativePath)) {
    throw new Error("Only non-hidden relative Markdown paths are supported");
  }
  if (draft.kind !== "create" && draft.kind !== "write" && draft.kind !== "delete") {
    throw new Error("Unsupported proposal change kind");
  }
  if (draft.kind !== "delete" && new TextEncoder().encode(draft.content).byteLength > 2 * 1024 * 1024) {
    throw new Error("Markdown change exceeds the 2 MB Vault limit");
  }

  const before = await vault.getSummary();
  if (!before) throw new Error("Configure a Vault before proposing changes");
  if (draft.kind === "create") {
    const after = await vault.getSummary();
    if (!after || before.vaultId !== after.vaultId || before.configuredAt !== after.configuredAt) {
      throw new Error("Vault authorization changed while preparing the proposal");
    }
    return { title, reason, changes: [{ kind: "create", relativePath, content: draft.content }] };
  }
  // Never invent a base SHA. The actual Vault RPC resolves a safe, current path.
  const current = await vault.readFile({ relativePath });
  const after = await vault.getSummary();
  if (!after || before.vaultId !== after.vaultId || before.configuredAt !== after.configuredAt ||
      current.relativePath !== relativePath) {
    throw new Error("Vault or selected note changed while preparing the proposal");
  }
  const change = draft.kind === "write"
    ? { kind: "write" as const, relativePath, baseSha256: current.sha256, content: draft.content }
    : { kind: "delete" as const, relativePath, baseSha256: current.sha256 };
  return { title, reason, changes: [change] };
}
