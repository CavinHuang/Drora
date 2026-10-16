# Obsidian / VaultView unified PR #23 — Merge Readiness Gate

**Updated:** 2026-10-16 (L2 implementation closeout; no merge approval). **PR:** https://github.com/CavinHuang/Drora/pull/23
**Branch:** `feat/obsidian-knowledge-e2e` → `main`
**Decision:** **IMPLEMENTATION READY / HOLD FOR FORMAL REVIEW**. A1's earlier release decision remains a historical scope record; this L2 development branch now contains the desktop-local runtime gate wiring. No unilateral merge.

This page is the release gate, not a promise that every listed test passed. An OS
bundle build and a Linux Electron smoke are not substitutes for real GUI
acceptance on Windows/macOS. Model SSE replay only controls generated answer
text; the tested Vault, Knowledge RPC, CLI admission, receipts and CodeMirror
are the production implementations.

## Current automated checkpoint and human gates

Latest verified HEAD before this documentation refresh: `e830c57f70e4791f753a366b65763f5b713281d6`. Full CI `38915497030`, Electron Provenance `38915496940`, and Windows/macOS Electron Acceptance `38915496910` are all **success**. G67 real Electron acceptance now passes on both Windows 2022 and macOS 14.

**A1 historical scope:** L0 + optional L1 were approved with L1 default-off. The current branch continues the separate L2 development requested afterward: proposal → approval → apply/undo is implemented, and the desktop-local Host now injects the S03 runtime gate. Formal independent S03 review is still open; this page does not convert that into an approval.

## Historical independently traceable evidence

| Gate | Evidence | Result / limit |
| --- | --- | --- |
| Linux: G56–G57 forged source | [run 38696659954](https://github.com/CavinHuang/Drora/actions/runs/38696659954) | Passed — no trusted navigation from model-authored links |
| Linux: G58–G60 real Vault + Inspector/TOCTOU | [run 38696659954](https://github.com/CavinHuang/Drora/actions/runs/38696659954) | Passed — real isolated Markdown/host |
| Linux: G61–G64 Composer → CLI → sourced Agent reply → Vault | [run 38696659954](https://github.com/CavinHuang/Drora/actions/runs/38696659954) | Passed 4/4 — stale citation rejected, restored original opens |
| macOS 14 real Electron Vault and Agent | [run 38696660072](https://github.com/CavinHuang/Drora/actions/runs/38696660072) | Passed both end-to-end specs, not whole G01–G55 manual matrix |
| Windows 2022 real Electron Vault and Agent | [run 38696660072](https://github.com/CavinHuang/Drora/actions/runs/38696660072) | Passed both end-to-end specs, not whole G01–G55 manual matrix |
| Latest full CI at this checkpoint | [run 38696659960](https://github.com/CavinHuang/Drora/actions/runs/38696659960) | Must inspect *final* conclusion; do not infer from individual passing jobs |
| G67 actual desktop L2 approval/apply/undo | `obsidian-knowledge-positive.test.ts` | Windows 2022 + macOS 14 passed on `38915496910` |

## Required before marking Ready for review / merging

1. **Latest head CI, each OS Electron lane:** green typecheck/lint, CLI,
   Knowledge/Obsidian regressions, Linux G56–G65, native macOS and Windows
   Vault/Agent acceptance. Inspect logs and upload failure artifacts; do
   not extrapolate a result from an older SHA.
2. **Close user-visible negative paths:** actual CLI admission rejection
   for changed/deleted/re-authorized sources before Send (G05–G07);
   queued promotion revalidation (G08); real multi-turn independent receipts
   after session switch/restart (G12/G35/G42); concurrency/timeouts (G45–G55).
   See `KNOWLEDGE_E2E_PHASE1_SMOKE.md` for remaining granular cases.
3. **S03 hard-write-safety gate:** runtime P0 controls have separate coverage in
   `S03_WRITE_SAFETY_RUNTIME_COVERAGE.md`. The formal `WRITE_SAFETY_NO_GO.md`
   ruling remains until an independent reviewer explicitly resolves it. The
   implementation is now wired for desktop-local only; persisted preferences
   still cannot grant the runtime capability.
4. **Release scope decision:** the L2 development work is complete enough for formal review. Record whether this branch is included in the release, then use the latest-head CI/Electron evidence plus human acceptance to make the final decision. Silence is not approval.
5. **Review and release:** no unresolved review objections; correct
   platform-specific screenshots/logs; final PR checks green and mergeability
   reconfirmed on the *same* head SHA.

## Non-negotiable rollback controls

- Never seed or mutate real user Obsidian Vaults in CI. Use `.e2e-home` only.
- Model prose, Markdown `[1]`, or fake paths cannot mint Receipt authority.
- Changed file SHA, Vault switch, Session switch, late RPC, queued promotion
  and unmount must fail closed.
- Keep `writeSafetyGatePassed=false` in production until a separate,
  independently evidenced S03 GO.
- Do not remove the one-PR rule, turn off failing jobs or mark unexecuted
  acceptance cases passed to accelerate merge.
