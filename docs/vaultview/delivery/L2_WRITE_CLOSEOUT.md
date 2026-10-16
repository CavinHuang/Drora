# L2 governed Markdown writes — engineering closeout record

**Date:** 2026-10-16  
**PR:** [#23](https://github.com/CavinHuang/Drora/pull/23)  
**Release decision:** **S03 NO-GO / production L2 apply and undo remain disabled**. This document does **not** approve changing `writeSafetyGatePassed`.

## Implemented (test-gated, not an S03 approval)

- Proposal → manual approval (revision, changesHash, sourceEpoch, TTL) → SQLite operation ledger → snapshot-protected CAS apply → undo and read-only reconcile.
- Strict TTL input validation rejects NaN, infinities, fractions, unsafe integers and non-number values before mutating approvals.
- Undo writes first **atomically claim** all `applied` rows as durable `undoing` rows in one SQLite `BEGIN IMMEDIATE` transaction. In-process per-Vault locking is **additional**, not the cross-Host guarantee.
- Competing Hosts using the **same knowledge-index.sqlite** cannot claim the same files. A second undo returns `operation_busy` while the claim remains and `undo_unavailable` after completion. No blind second inverse write.
- Before `prepared → applying` and before claiming Undo rows, a shared SQLite transaction also checks for **any other Vault-local `applying` / `uncertain` operation or `undoing` file**. This serializes governed L2 writes of *different* operations, because the Vault facade's read-SHA followed by rename is not itself an atomic interprocess CAS. A fenced apply returns `reconcile_required` and can retry its still-`prepared` ledger row once the prior owner is settled.
- An interrupted `undoing` claim remains durable; explicit reconcile reads the Vault, marking `undo_applied` only when inverse SHA evidence matches. Not-landed or externally changed files become `undo_conflict`; unreadable evidence stays `undoing`. **No automatic inverse retry**, even if the old target content remains present.
- Recovery of a **partially applied multi-file proposal** is an auditable `conflict` rather than `prepared`; landed files remain explicitly undoable while untouched files remain untouched.
- Review reads a bounded history (up to 100 operations) scoped to the current Vault and restores eligible Undo targets across renderer/host restarts without enabling production L2.
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

CI must run on the **latest PR HEAD**. Earlier green runs cannot validate a later commit, and queued/in-progress runs are not PASS.

## Remaining P0 acceptance gates (open)

1. **S03 independent security sign-off:** verify permission bypass closure for Bash/node_repl/MCP, readOnly hints, project/session persistent rules, and P0/plan mode; resolve the formal [NO-GO](WRITE_SAFETY_NO_GO.md). No developer self-attestation counts as GO.
2. **Remaining real-process crash coverage:** extend actual OS-process-kill coverage beyond the two undo ledger/IO boundaries into complete engine apply/undo execution and verify all supported platforms. The newly added SIGKILL fixtures are partial evidence, not release sign-off.
3. **Concurrent recoverer ownership:** the explicit `reconcileStuckOperations` recovery API is only safe to invoke for an interrupted Undo **after the previous owner has been stopped**. No distributed liveness proof / lease fencing is implemented. Do not treat reconcile calls while an active peer is writing as production-safe.
4. **UI / human acceptance:** exercise actual Electron Review approval→preview→apply/undo, source switch and revocation, busy queue and errors, and record the required G01–G55 manual evidence on Windows/macOS/Linux. Existing deterministic model replay is not real-provider testing.
5. **Formal GitHub review / limited-release decision:** A1 approves default-off restricted L1; L2 stays out of scope until the separate safety decision. Keep L2 production activation disabled and do not merge solely because the tests are green.

## Invariants

- Nothing here changes production `writeSafetyGatePassed`, `reviewWritePathEnabled` defaults, or the S03 ruling.
- All tests use throwaway Vault roots, never real personal Obsidian vaults.
- An `undoing` state is a **no-replay hold**, not an invitation to reclaim it automatically.
- Cross-Host single-winner depends on a *shared* SQLite ledger; isolated databases are not a distributed lock. The Vault facade cannot guarantee atomic SHA CAS against **external writers not participating in the L2 ledger** (manual editor, direct Bash, remote MCP side effects). Those channels must be covered by the separate S03 permission policy and independent review.
