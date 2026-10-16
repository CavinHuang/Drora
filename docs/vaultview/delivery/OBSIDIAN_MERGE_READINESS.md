# Obsidian / VaultView unified PR #23 — Merge Readiness Gate

**Updated:** 2026-10-16 (A1 scope approved; no merge approval). **PR:** https://github.com/CavinHuang/Drora/pull/23
**Branch:** `feat/obsidian-knowledge-e2e` → `main`
**Decision:** **A1 SCOPE APPROVED; HOLD / DRAFT**. [Owner A1 decision](https://github.com/CavinHuang/Drora/pull/23#issuecomment-6209580588); no unilateral merge, no production L2 write enablement.

This page is the release gate, not a promise that every listed test passed. An OS
bundle build and a Linux Electron smoke are not substitutes for real GUI
acceptance on Windows/macOS. Model SSE replay only controls generated answer
text; the tested Vault, Knowledge RPC, CLI admission, receipts and CodeMirror
are the production implementations.

## Current automated checkpoint and human gates

At `1f1a457da384b2a5a9033715291b4ab163bddeff`: [Full CI](https://github.com/CavinHuang/Drora/actions/runs/38853003358) **8/8 success**; [Linux Electron](https://github.com/CavinHuang/Drora/actions/runs/38853003236) **3/3 success**; [Windows/macOS Electron](https://github.com/CavinHuang/Drora/actions/runs/38853003348) **2/2 success**. The genuine three-platform Agent test has **8 passing per OS**, including G12 real process restart and persisted Receipt revalidation. A new HEAD, including this docs commit, needs its own CI.

**A1 now approved:** L0 read/index/Agent evidence + manual CodeMirror edits + **optional L1 Agent Write/Edit** restricted to ordinary non-hidden Markdown, with `allowAgentWrites=false` by default. **L1 is not read-only**, and Bash/js/MCP/persisted allow may bypass its hook. **L2** apply/undo remains S03 NO-GO (proposal/preview/read-only reconcile is distinct). Neither the [proposed nine-group human package](https://github.com/CavinHuang/Drora/pull/23#issuecomment-6209475838) nor independent code Review / S03-exclusion signoff has been completed. Keep Draft.

## Historical independently traceable evidence

| Gate | Evidence | Result / limit |
| --- | --- | --- |
| Linux: G56–G57 forged source | [run 38696659954](https://github.com/CavinHuang/Drora/actions/runs/38696659954) | Passed — no trusted navigation from model-authored links |
| Linux: G58–G60 real Vault + Inspector/TOCTOU | [run 38696659954](https://github.com/CavinHuang/Drora/actions/runs/38696659954) | Passed — real isolated Markdown/host |
| Linux: G61–G64 Composer → CLI → sourced Agent reply → Vault | [run 38696659954](https://github.com/CavinHuang/Drora/actions/runs/38696659954) | Passed 4/4 — stale citation rejected, restored original opens |
| macOS 14 real Electron Vault and Agent | [run 38696660072](https://github.com/CavinHuang/Drora/actions/runs/38696660072) | Passed both end-to-end specs, not whole G01–G55 manual matrix |
| Windows 2022 real Electron Vault and Agent | [run 38696660072](https://github.com/CavinHuang/Drora/actions/runs/38696660072) | Passed both end-to-end specs, not whole G01–G55 manual matrix |
| Latest full CI at this checkpoint | [run 38696659960](https://github.com/CavinHuang/Drora/actions/runs/38696659960) | Must inspect *final* conclusion; do not infer from individual passing jobs |
| G65 actual desktop S03 NO-GO switch assertion | `obsidian-knowledge-positive.test.ts` | Test committed; rerun results not yet verified |

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
   `S03_WRITE_SAFETY_RUNTIME_COVERAGE.md`, but the formal `WRITE_SAFETY_NO_GO.md`
   ruling is *not* superseded. The production Review L2 apply/undo remains
   fail-closed, including persisted true preferences. This A1 release needs
   explicit independent safety approval to **exclude L2**; a later L2-enabling
   change would require a separate S03 GO and observed P0 coverage.
4. **Release scope decision:** A1 is now approved; L1 is explicitly opt-in **write**, not read-only, and L2 remains excluded under S03 NO-GO. Independently approve that L2 exclusion, and either execute G01–G55 human acceptance or explicitly approve the risk-based subset with documented deferrals. Silence is not approval.
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
