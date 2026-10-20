/**
 * Real SIGKILL at the apply ledger/IO boundary, using the same ReviewLedgerStore
 * and VaultFileSystem as the production engine. Invoked only against an isolated
 * synthetic Vault; does not grant or toggle production S03 permissions.
 */
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setDataBaseDir } from "../../src/paths.js";
import { openKnowledgeDatabase } from "../../src/knowledge/store/knowledgeDatabase.js";
import { ReviewLedgerStore, sha256Hex } from "../../src/knowledge/review/reviewStore.js";
import { createVaultFileSystem } from "../../src/obsidian-vault/vault-fs.js";

const [databasePath, vaultPath, proposalId, operationId, mode, marker] = process.argv.slice(2);
if (
  !databasePath ||
  !vaultPath ||
  !proposalId ||
  !operationId ||
  !marker ||
  (mode !== "claimed" && mode !== "first-file-written")
) {
  throw new Error(
    "Expected databasePath vaultPath proposalId operationId claimed|first-file-written marker",
  );
}
setDataBaseDir(dirname(dirname(databasePath)));
const db = openKnowledgeDatabase(databasePath);
const store = new ReviewLedgerStore(db);
const proposal = store.getProposal(proposalId);
if (!proposal) throw new Error("Missing proposal");
const approval = store.getApproval(proposal.proposalId, proposal.revision);
if (!approval) throw new Error("Missing approval");
const facade = createVaultFileSystem(vaultPath);
const changes = JSON.parse(proposal.changesJson) as Array<{
  kind: "write";
  relativePath: string;
  baseSha256: string;
  content: string;
}>;
if (changes.length !== 2 || changes.some((change) => change.kind !== "write")) {
  throw new Error("Crash fixture only accepts an isolated two-file write proposal");
}
const nowMs = Date.now();
if (
  !store.insertOperation({
    operationId,
    proposalId,
    revision: proposal.revision,
    vaultId: proposal.vaultId,
    sourceEpoch: approval.sourceEpoch,
    status: "prepared",
    error: null,
    createdAtMs: nowMs,
    finishedAtMs: null,
    reconciledAtMs: null,
  })
) {
  throw new Error("Operation already exists");
}
for (const [ordinal, change] of changes.entries()) {
  const current = await facade.readFile(change.relativePath);
  if (current.sha256 !== change.baseSha256)
    throw new Error("Base SHA changed before crash fixture");
  store.insertOperationFile({
    operationId,
    ordinal,
    relativePath: change.relativePath,
    kind: "write",
    baseSha256: current.sha256,
    nextSha256: sha256Hex(change.content),
    nextContent: change.content,
    snapshotContent: current.content,
    snapshotSha256: current.sha256,
    status: "prepared",
    error: null,
    updatedAtMs: nowMs,
  });
}
if (!store.transitionOperationToApplying(operationId)) {
  throw new Error("Expected exclusive applying claim");
}
if (mode === "first-file-written") {
  const first = changes[0]!;
  store.updateOperationFileStatus(operationId, 0, "applying", null, Date.now());
  const result = await facade.writeFile({
    relativePath: first.relativePath,
    content: first.content,
    expectedSha256: first.baseSha256,
  });
  if (!result.ok) throw new Error("Unexpected write conflict");
}
// Crash before the final status is written. Parent tests durable WAL + Vault
// evidence through the new host's read-only reconcile entrypoint.
await writeFile(marker, mode, "utf-8");
process.kill(process.pid, "SIGKILL");
throw new Error("SIGKILL failed");
