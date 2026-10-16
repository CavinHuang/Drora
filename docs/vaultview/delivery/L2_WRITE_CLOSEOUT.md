# L2 governed Markdown writes — engineering closeout record

**Date:** 2026-10-16  
**PR:** [#23](https://github.com/CavinHuang/Drora/pull/23)  
**Release decision:** **S03 formal sign-off is still pending**. The L2 implementation is now wired to the desktop-local runtime safety gate; this document records implementation/verification status and does **not** itself constitute the independent S03 GO.

## Implemented (test-gated, not an S03 approval)

- Proposal → manual approval (revision, changesHash, sourceEpoch, TTL) → SQLite operation ledger → snapshot-protected CAS apply → undo and read-only reconcile.
- Strict TTL input validation rejects NaN, infinities, fractions, unsafe integers and non-number values before mutating approvals.
- Undo writes first **atomically claim** all `applied` rows as durable `undoing` rows in one SQLite `BEGIN IMMEDIATE` transaction. In-process per-Vault locking is **additional**, not the cross-Host guarantee.
- Competing Hosts using the **same knowledge-index.sqlite** cannot claim the same files. A second undo returns `operation_busy` while the claim remains and `undo_unavailable` after completion. No blind second inverse write.
- Before `prepared → applying` and before claiming Undo rows, a shared SQLite transaction also checks for **any other Vault-local `applying` / `uncertain` operation or `undoing` file**. This serializes governed L2 writes of *different* operations, because the Vault facade's read-SHA followed by rename is not itself an atomic interprocess CAS. A fenced apply returns `reconcile_required` and can retry its still-`prepared` ledger row once the prior owner is settled.
- An interrupted `undoing` claim remains durable; explicit reconcile reads the Vault, marking `undo_applied` only when inverse SHA evidence matches. Not-landed or externally changed files become `undo_conflict`; unreadable evidence stays `undoing`. **No automatic inverse retry**, even if the old target content remains present.
- Recovery of a **partially applied multi-file proposal** is an auditable `conflict` rather than `prepared`; landed files remain explicitly undoable while untouched files remain untouched.
- Review reads a bounded history (up to 100 operations) scoped to the current Vault and restores eligible Undo targets across renderer/host restarts. The desktop-local Host is now the only production authority that can inject the S03 runtime gate; the user still has to opt into the Review write path.
- Apply revalidates approval, write gate and source epoch after a lock wait. Apply and Undo additionally recheck the write gate, epoch, Vault and `allowAgentWrites` between individual file mutations. Revocation stops subsequent file mutations; a multi-file operation can be partial and must be reconciled/reviewed.

## Automated regression paths

Run from repository root with Node 24 and installed dependencies:

```sh
node --import tsx --test packages/services/test/knowledgeReview.test.ts
node --import tsx --test packages/services/test/knowledgeReviewWritePath.test.ts
pnpm typecheck
pnpm lint
```

`knowledgeReview.test.ts` covers two service instances racing for one Undo, **two independent Node processes** racing over the same SQLite WAL file, crashes simulated at the exact ledger/FS boundary (inverse landed and not-landed), plus a Vault-wide busy-writer fence test, and the earlier create/write/delete, concurrent apply, approval, undo-conflict and recovery cases. The two-process test uses `test/fixtures/review-undo-worker.ts` with an explicit **test-only** S03 override and an isolated synthetic Vault.

A separate fixture `test/fixtures/review-undo-crash-worker.ts` invokes the real ledger claim and Vault filesystem API, then is terminated with actual `SIGKILL` at the claim/IO boundary. A fresh read-only service verifies reconciliation after OS-process death. This covers those exact boundaries, not every possible engine instruction boundary.

The synthetic crash fixtures establish recovery logic given a known on-disk state; they do **not** establish that an actual operating-system process kill is safe at every instruction boundary.

Latest verification on `e830c57f70e4791f753a366b65763f5b713281d6`: full CI, Electron Provenance, and Windows/macOS Electron acceptance all passed. The Windows G67 path now passes after the atomic replacement retry fix.

## Remaining release gates (open)

1. **S03 independent security sign-off:** verify the already-landed runtime bypass closure for Bash/node_repl/MCP, readOnly hints, project/session persistent rules, and P0/plan mode; resolve the formal [NO-GO](WRITE_SAFETY_NO_GO.md). No developer self-attestation counts as GO.
2. **Concurrent recoverer ownership:** `reconcileStuckOperations` remains intentionally fail-closed while an owner may still be alive. There is no distributed liveness/lease proof; recovery is only safe after the previous writer is known to have stopped.
3. **Broader manual acceptance:** G67 now has real Windows/macOS Electron evidence for approval→preview→apply→undo. Source switch/revocation, busy queue/error UX, and the broader G01–G55 manual matrix remain human-review work rather than missing L2 implementation.
4. **Formal GitHub review / release decision:** review the same latest HEAD, record the S03 decision and final L2 release scope, then merge only after required approvals/checks are satisfied.

## Invariants

- `writeSafetyGatePassed` is injected only for `desktop-local`; remote/unspecified authorities remain fail-closed. `reviewWritePathEnabled` remains an explicit user opt-in and defaults off. This closeout does not revoke the formal S03 ruling.
- All tests use throwaway Vault roots, never real personal Obsidian vaults.
- An `undoing` state is a **no-replay hold**, not an invitation to reclaim it automatically.
- Cross-Host single-winner depends on a *shared* SQLite ledger; isolated databases are not a distributed lock. The Vault facade cannot guarantee atomic SHA CAS against **external writers not participating in the L2 ledger** (manual editor, direct Bash, remote MCP side effects). Those channels must be covered by the separate S03 permission policy and independent review.
