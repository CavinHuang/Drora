# Obsidian / VaultView — merge candidate scope and evidence

**Prepared:** 2026-10-15
**PR:** [#23](https://github.com/CavinHuang/Drora/pull/23)
**Base synchronized:** `main@7ced6f898070eaae63822f4ae97d635c3dfb1567`
**Sync commit:** `2b93f59f9ee52c6502dd412fe59e3c5f8e09ce55`
**State:** **A1 SCOPE APPROVED / MERGE HOLD**. On 2026-10-16 the repository owner explicitly approved default-off, restricted L1 Markdown Write/Edit as part of the first release; L2 remains disabled. [A1 approval record](https://github.com/CavinHuang/Drora/pull/23#issuecomment-6209580588). **Not** approval of human acceptance, independent S03 exclusion signoff, formal Review or merge.

## 1. Scope correction: L1 is NOT read-only

The normative definition is `specs/obsidian-knowledge.md` §2–§3.

| Capability | Behavior | Candidate disposition |
| --- | --- | --- |
| L0 / authenticated Vault reads | Read/Glob/Grep, index, FIND, source inspection, answer/compare handoff, authenticated Receipt, current-source navigation | Candidate for first release, subject to platform / lifecycle acceptance |
| Manual CodeMirror note editing | User-initiated Markdown changes behind Vault path protection / optimistic SHA checks | Explicit user-write feature; **not** evidence of an agent read-only guarantee |
| L1 / opt-in agent writing | `allowAgentWrites=true` enables narrow Write/Edit hook auto-allow for ordinary Markdown when runtime decision was `ask`; default is `false` | **Not read-only.** Needs explicit scope/risk acceptance and permission negative-path validation; do not count as part of a read-only approval |
| L2 / proposal-driven apply & undo | Proposal, approval, ledger and read-only reconciliation exist, but applying/undoing would write files | **EXCLUDED / S03 NO-GO.** Production `writeSafetyGatePassed` remains false and `applyProposal`/`undoOperation` reject with `write_path_disabled` |
| L3 / broad side-effect channels | Bash, js, MCP and other P0 tool paths | No claim of universal write prevention from an Obsidian hook; follow runtime policy and independent S03 assessment |

**Safe presentation:** "Vault-backed knowledge retrieval and evidence-grounded Agent navigation are ready for release evaluation; L1 authorized editing is a distinct opt-in capability; L2 governed writes are not enabled."

**Unsafe presentation:** "L0/L1 is read-only", "every agent-side Vault write is blocked", or "S03 has passed".

## 2. Branch sync and evidence rules

- Before sync, `main` was 8 commits ahead of the Obsidian branch, while the PR had no GitHub-reported textual merge conflict.
- Prepared a fast-forward feature-branch update via a **two-parent merge commit** with Obsidian HEAD `d88d5e1` and current `main@7ced6f8`. GitHub's previous clean merge tree was extended with exactly the final main commit's four non-overlapping file changes (D-outline watermark / test / branding spec / removed orphan SVG).
- Before updating the branch, independently compared the prepared commit against both parents: versus main, the Obsidian diff was still 82 files; versus old feature HEAD, the expected 8 main commits contributed exactly five changed paths. Updated the feature branch using a non-force ref update with an expected prior SHA.
- **Do not use the pre-sync green checks** for final merge approval. All mandated checks must succeed again on the latest HEAD, including any subsequent documentation commits.

## 3. Latest verified automated evidence, distinct from human acceptance

Final CI results verified at `1f1a457da384b2a5a9033715291b4ab163bddeff`:
- [Full CI](https://github.com/CavinHuang/Drora/actions/runs/38853003358) **8/8 success** (including Typecheck/Lint and the CLI).
- [Linux real Electron](https://github.com/CavinHuang/Drora/actions/runs/38853003236) **3/3 success**.
- [Windows/macOS real Electron](https://github.com/CavinHuang/Drora/actions/runs/38853003348) **2/2 success**.
- The actual Agent-to-Vault Electron acceptance suite was **8 passing on Linux, Windows and macOS**; G12 is a real Electron restart, not a page reload; G08 tests actual SQLite/Vault/CLI promotion but not a human Busy-session GUI.
- See the [proposed nine-group manual checklist](https://github.com/CavinHuang/Drora/pull/23#issuecomment-6209475838). Its subset and every remaining G01–G55 human case remain **unapproved/unexecuted**, not PASS. Deterministic replay only replaces the model response, not the Vault/CLI implementation.

**Any new documentation or code commit requires checking the new HEAD's CI before merge.**

## 3a. Historical acceptance evidence / still pending

Existing automated verification before the sync:

| Gate | Completed run at pre-sync `d88d5e1` |
| --- | --- |
| Full CI (8 jobs) | [38712890210](https://github.com/CavinHuang/Drora/actions/runs/38712890210) — success |
| Linux actual Electron (3 jobs) | [38712890330](https://github.com/CavinHuang/Drora/actions/runs/38712890330) — success, includes G06 deleted-source-at-Send |
| Windows 2022 + macOS 14 actual Electron (2 jobs) | [38712890190](https://github.com/CavinHuang/Drora/actions/runs/38712890190) — success |

These cover automated cases, **not** the entire human G01–G55 acceptance matrix.
For the current G01–G55 manual cases, the authoritative status remains `未执行` until desktop evidence is recorded; relevant automated G56–G66 successes must not be silently re-labeled as manual pass.

### Remaining release blockers

- [ ] Final HEAD CI, Linux real Electron, macOS real Electron, Windows real Electron are all successful and linked on the same HEAD.
- [ ] Real-world negative-path and lifecycle acceptance: revoke authorization before Send (G07), busy queue promotion recheck (G08), restart and independent multi-turn receipts (G12/G35/G42), async cancellation/timeouts / A→B→A / CodeMirror focus (G45–G55). Save anonymized logs/screenshots.
- [ ] Human/manual test plan G01–G55: explicitly select a reviewed limited subset or execute and record the whole required matrix. Unexecuted tests are NOT passes.
- [x] Owner approved **A1 scope** including opt-in L1; default false and exact Write/Edit limitations remain mandatory. [Decision](https://github.com/CavinHuang/Drora/pull/23#issuecomment-6209580588). This approval does **not** count as artificial/manual PASS.
- [ ] Independent S03 safety owner **explicitly approves excluding L2** from this A1 release while keeping S03 NO-GO / production write gate fail-closed. **No L2 GO is requested in PR #23.**
- [ ] Formal GitHub code review completed, with objections resolved; no automatic mark Ready or merge while the gates above are pending.

## 4. Immutable safety requirements

- Use isolated `.e2e-home` synthetic test Vaults; never run CI against user Vaults.
- A rendered model citation, filename, Markdown fragment or preview cannot mint Receipt authority.
- Host + CLI recheck file SHA, source epoch and scope at the actual admission/navigation boundary.
- Do **not** switch on `writeSafetyGatePassed`, bypass permission checks, alter the `WRITE_SAFETY_NO_GO.md` ruling, or suppress a failing CI lane to obtain green status.
- No PR merge, production deploy, or auto-merge as part of this preparatory record.
