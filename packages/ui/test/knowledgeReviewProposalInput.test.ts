import { describe, expect, it, vi } from "vitest";
import type { IObsidianVaultService, ObsidianVaultSummary } from "@drora/services";
import {
  prepareKnowledgeReviewProposal,
  ReviewProposalInputError,
  type ReviewProposalDraft,
} from "../src/v4/vault/knowledge/knowledgeReviewProposalInput.js";

/** 断言稳定的错误码（D-3 修复后本地校验不再抛英文文案，UI 按 code 映射 i18n）。 */
async function expectInputError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "ReviewProposalInputError", code });
  try {
    await promise;
  } catch (cause) {
    expect(cause).toBeInstanceOf(ReviewProposalInputError);
  }
}

const summary = {
  vaultId: "vault-1",
  configuredAt: 1,
  displayName: "Fixture",
  inboxPath: "Inbox",
  allowAgentWrites: false,
};
const file = {
  relativePath: "notes/current.md",
  content: "# Existing",
  sha256: "sha-original",
  modifiedAt: 1,
};
function vault() {
  return {
    getSummary: vi.fn(async (): Promise<ObsidianVaultSummary | null> => summary),
    readFile: vi.fn(async () => file),
  } satisfies Pick<IObsidianVaultService, "getSummary" | "readFile">;
}
function draft(kind: ReviewProposalDraft["kind"]): ReviewProposalDraft {
  return {
    title: " Draft ",
    reason: " Human review ",
    kind,
    relativePath: "notes/current.md",
    content: "# New\n\nContent",
  };
}

describe("L2 human proposal input, never applies writes", () => {
  it("creates a new note proposal without reading/writing a Vault note", async () => {
    const service = vault();
    const input = await prepareKnowledgeReviewProposal(draft("create"), service);
    expect(input).toEqual({
      title: "Draft",
      reason: "Human review",
      changes: [{ kind: "create", relativePath: "notes/current.md", content: "# New\n\nContent" }],
    });
    expect(service.readFile).not.toHaveBeenCalled();
  });
  it("uses the real current SHA for write and preserves exact Markdown", async () => {
    const service = vault();
    const input = await prepareKnowledgeReviewProposal(draft("write"), service);
    expect(input.changes).toEqual([
      {
        kind: "write",
        relativePath: file.relativePath,
        baseSha256: "sha-original",
        content: "# New\n\nContent",
      },
    ]);
    expect(service.readFile).toHaveBeenCalledWith({ relativePath: file.relativePath });
  });
  it("deletion proposes a base SHA without copying or deleting contents", async () => {
    const service = vault();
    const input = await prepareKnowledgeReviewProposal(draft("delete"), service);
    expect(input.changes).toEqual([
      { kind: "delete", relativePath: file.relativePath, baseSha256: "sha-original" },
    ]);
  });
  it.each([
    "../escape.md",
    ".obsidian/app.md",
    "notes/.hidden.md",
    "/tmp/raw.md",
    "C:/evil.md",
    "notes/no.txt",
    "notes/./a.md",
    "notes/../a.md",
    "notes/\0evil.md",
  ])("rejects unsafe path %s before calling any Vault service", async (path) => {
    const service = vault();
    await expect(
      prepareKnowledgeReviewProposal({ ...draft("write"), relativePath: path }, service),
    ).rejects.toThrow();
    expect(service.getSummary).not.toHaveBeenCalled();
  });
  it("rejects Vault switch/re-authorization during asynchronous SHA fetch", async () => {
    const service = vault();
    service.getSummary.mockResolvedValueOnce(summary).mockResolvedValueOnce({
      ...summary,
      configuredAt: 2,
    });
    await expectInputError(prepareKnowledgeReviewProposal(draft("write"), service), "vaultChanged");
  });
  it("does not accept a forged or mismatched file identity from the host", async () => {
    const service = vault();
    service.readFile.mockResolvedValueOnce({ ...file, relativePath: "notes/other.md" });
    await expectInputError(
      prepareKnowledgeReviewProposal(draft("delete"), service),
      "vaultChanged",
    );
  });
  it("rejects content beyond the 2MB Vault cap", async () => {
    const service = vault();
    await expectInputError(
      prepareKnowledgeReviewProposal(
        { ...draft("create"), content: "字".repeat(800_000) },
        service,
      ),
      "contentTooLarge",
    );
    expect(service.getSummary).not.toHaveBeenCalled();
  });
  it("rejects missing rationale and missing Vault authorization", async () => {
    const service = vault();
    await expectInputError(
      prepareKnowledgeReviewProposal({ ...draft("write"), reason: "  " }, service),
      "titleReasonRequired",
    );
  });
  it("missing Vault authorization rejects with vaultNotConfigured", async () => {
    const service = vault();
    service.getSummary.mockResolvedValueOnce(null);
    await expectInputError(
      prepareKnowledgeReviewProposal(draft("write"), service),
      "vaultNotConfigured",
    );
  });
});
