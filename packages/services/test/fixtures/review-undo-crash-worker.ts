/**
 * Integration fixture: kill a real Node process at the undo ledger/IO boundary.
 *
 * Uses the actual ReviewLedgerStore and VaultFileSystem, not a synthetic DB
 * UPDATE. It deliberately bypasses ReviewEngine's UI/RPC to control the exact
 * crash instruction; only run on throwaway test vaults.
 */
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setDataBaseDir } from "../../src/paths.js";
import { openKnowledgeDatabase } from "../../src/knowledge/store/knowledgeDatabase.js";
import { ReviewLedgerStore } from "../../src/knowledge/review/reviewStore.js";
import { createVaultFileSystem } from "../../src/obsidian-vault/vault-fs.js";

const [databasePath, vaultPath, operationId, crashMode, markerPath] = process.argv.slice(2);
if (
  !databasePath ||
  !vaultPath ||
  !operationId ||
  !markerPath ||
  (crashMode !== "claimed" && crashMode !== "inverse-written")
) {
  throw new Error("Expected databasePath vaultPath operationId claimed|inverse-written markerPath");
}
setDataBaseDir(dirname(dirname(databasePath)));
const db = openKnowledgeDatabase(databasePath);
const ledger = new ReviewLedgerStore(db);
const claim = ledger.claimUndoFiles(operationId, Date.now());
if (claim.outcome !== "claimed" || claim.files.length !== 1) {
  throw new Error(`Expected one durable undo claim, got ${claim.outcome}`);
}
const [file] = claim.files;
if (!file) throw new Error("No claimed file");
if (crashMode === "inverse-written") {
  const facade = createVaultFileSystem(vaultPath);
  const row = ledger.getOperationFile(operationId, file.relativePath);
  if (!row || row.kind !== "write" || row.snapshotContent === null || !row.nextSha256) {
    throw new Error("Crash fixture requires a write with a valid before-image");
  }
  const changed = await facade.writeFile({
    relativePath: file.relativePath,
    content: row.snapshotContent,
    expectedSha256: row.nextSha256,
  });
  if (!changed.ok) throw new Error("Inverse CAS unexpectedly rejected");
}
// The marker is written only after the target boundary. The parent verifies
// SIGKILL termination and restarts recovery using an independent service.
await writeFile(markerPath, crashMode, "utf-8");
process.kill(process.pid, "SIGKILL");
throw new Error("SIGKILL did not terminate the worker");
