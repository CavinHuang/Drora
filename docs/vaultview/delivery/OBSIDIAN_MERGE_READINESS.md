# Obsidian / VaultView unified PR #23 — Merge Readiness Gate

**Updated:** 2026-10-16 (L2 implementation closeout; no merge approval). **PR:** https://github.com/CavinHuang/Drora/pull/23
**Branch:** `feat/obsidian-knowledge-e2e` → `main`
**Decision:** **IMPLEMENTATION READY / HOLD FOR FORMAL REVIEW**. A1 is normative: L2 production Apply/Undo remain disabled. The production Host explicitly passes `reviewWriteSafetyGatePassed: false`; only isolated tests may override the gate. No unilateral merge.

This page is the release gate, not a promise that every listed test passed. An OS
bundle build and a Linux Electron smoke are not substitutes for real GUI
acceptance on Windows/macOS. Model SSE replay only controls generated answer
text; the tested Vault, Knowledge RPC, CLI admission, receipts and CodeMirror
are the production implementations.

## Current automated checkpoint and human gates

Historical checkpoint `e830c57f70e4791f753a366b65763f5b713281d6`: Full CI `38915497030`, Electron Provenance `38915496940`, and Windows/macOS Electron Acceptance `38915496910` passed. However, that version enabled the production L2 gate in the desktop Host, contradicting A1; its Apply/Undo G67 result is implementation evidence, not acceptance for the approved release scope. The current HEAD explicitly closes the production gate and updates G67 to require proposal/preview/approval while proving Apply/Undo remain disabled. New checks must pass on the corrected HEAD.

**A1 approved release scope:** L0 + optional L1 were approved with L1 default-off. L2 proposal/approval/ledger mechanisms may remain present for development and review, but production Apply/Undo and the L2 activation switch must stay fail-closed. The earlier desktop-local gate injection has been removed and replaced with an explicit production false value. Formal independent S03 review remains open.

## Historical independently traceable evidence

| Gate | Evidence | Result / limit |
| --- | --- | --- |
| Linux: G56–G57 forged source | [run 38696659954](https://github.com/CavinHuang/Drora/actions/runs/38696659954) | Passed — no trusted navigation from model-authored links |
| Linux: G58–G60 real Vault + Inspector/TOCTOU | [run 38696659954](https://github.com/CavinHuang/Drora/actions/runs/38696659954) | Passed — real isolated Markdown/host |
| Linux: G61–G64 Composer → CLI → sourced Agent reply → Vault | [run 38696659954](https://github.com/CavinHuang/Drora/actions/runs/38696659954) | Passed 4/4 — stale citation rejected, restored original opens |
| macOS 14 real Electron Vault and Agent | [run 38696660072](https://github.com/CavinHuang/Drora/actions/runs/38696660072) | Passed both end-to-end specs, not whole G01–G55 manual matrix |
| Windows 2022 real Electron Vault and Agent | [run 38696660072](https://github.com/CavinHuang/Drora/actions/runs/38696660072) | Passed both end-to-end specs, not whole G01–G55 manual matrix |
| Latest full CI at this checkpoint | [run 38696659960](https://github.com/CavinHuang/Drora/actions/runs/38696659960) | Must inspect *final* conclusion; do not infer from individual passing jobs |
| G67 approved-release behavior | `obsidian-knowledge-positive.test.ts` | Prior Apply/Undo run is not valid release-scope acceptance; corrected test must prove proposal/preview/approval work while production toggle, Apply and Undo stay disabled |

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
   production Host explicitly passes `reviewWriteSafetyGatePassed: false` for
   every authority; persisted preferences cannot grant runtime capability.
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


## 2026-10-17 · Additional S03 source-audit correction

A further review found that third-party MCP `readOnlyHint=true` could still bypass P0 permission handling. The current branch now treats all non-Host-verified MCP tools as P0 regardless of that server-authored hint, blocks build/plan read-only fast paths, and keeps only the Host-verified OfficialCua exception. Unit regressions were added; the new head must pass CI/Electron checks. This is still not an independent S03 GO, and production L2 remains disabled under A1.



## 2026-10-17 · Maintainer-directed automated self-review

The maintainer explicitly requested **no manual acceptance walkthrough** and asked for assistant-led code review. The current automated coverage map is recorded in [AUTOMATED_SELF_REVIEW_2026-10-17.md](./AUTOMATED_SELF_REVIEW_2026-10-17.md). For G35/G42/G45–G55, use the named automated evidence instead of waiting for a manual checkbox where that test directly covers the risk. This does not upgrade unit-level evidence to full GUI evidence.

The critical code review rechecked the production Host's explicit `reviewWriteSafetyGatePassed: false`, the service-level dual gate for Apply/Undo, MCP read-only hint trust boundaries, and Receipt/session/source binding. G54 now has a dedicated assertion that a change outside the quote excerpt still fails the full-file SHA second-read check.

**No safety boundary changed:** L1 remains default-off. The formal S03 NO-GO is not revoked; production L2 Apply/Undo remain disabled. This self-review is not described as an independent external S03 sign-off. No merge or deployment is performed here.
