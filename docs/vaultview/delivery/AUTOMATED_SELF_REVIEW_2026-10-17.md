> **已由同日收尾复评取代。** 本文是 `3a7f4fe` 基线记录；其中“未发现新增缺陷”不能用于当前交付。
> 后续审查实际发现并修复 P0 内容授权、旧批准、跨进程恢复和竞争创建问题。
> 当前状态见 [S03_CLOSEOUT_2026-10-17.md](./S03_CLOSEOUT_2026-10-17.md)。

# Drora PR #23 — Automated self-review and coverage map

**Date:** 2026-10-17  
**Branch:** `feat/obsidian-knowledge-e2e` → `main`  
**Scope:** approved A1 release boundary; automated review replaces the requested manual walkthrough for covered scenarios.

## Review decision

The assistant-led code review of the critical receipt, citation-navigation, permission-tier and L2-write-gate paths found no additional production defect in this pass. Two missing regression assertions were added: distinct Receipt isolation across turns and timeout/single-flight behavior; this update also makes the second-read full-file SHA requirement independently testable.

This is **not** a claim of independent external security approval. The formal S03 NO-GO remains in force. L1 remains default-off, and production L2 Apply/Undo remain fail-closed. No merge or deployment is performed by this change.

## Critical security boundaries reviewed

- `packages/services/src/node.ts` explicitly constructs Knowledge services with `reviewWriteSafetyGatePassed: false` for production.
- `packages/services/src/knowledge/review/reviewEngine.ts` requires both the runtime safety gate and user opt-in. A persisted preference cannot enable Apply/Undo when the runtime gate is false; the rejection happens before the file-write path.
- `apps/drora-cli/packages/core/src/permission/write-tier-policy.ts` treats all non-Host-verified MCP tools as P0 regardless of the server-authored `readOnlyHint`. The plan/build read-only fast paths require trusted capability metadata. The documented CLI `allowedTools` startup override remains an explicit operator-authorization exception.
- Receipt navigation uses an opaque, server-resolved Receipt bound to the exact Session and source; it does not infer authority from model-authored Markdown `[1]` text.
- Before changing the editor selection, the second file read must match both the full-file SHA-256 and the projected quote excerpt. A change outside the excerpt is still stale.

## Automated coverage map

| Risk / cases | Automated evidence | What it proves |
|---|---|---|
| G35/G42 — same display citation number across turns/sessions | `packages/services/test/knowledgeReceiptIsolation.test.ts`; `packages/ui/test/knowledgeTurnCitations.test.ts` | Distinct notes get distinct Receipts; cross-session reuse is forbidden; changing one file invalidates only its Receipt; turn projection is not inferred from display number |
| G45 — duplicate opens, timeout and late callback | `packages/ui/test/messageCitationOpenIntegration.test.ts` | Identical concurrent requests share one in-flight operation; timeout resolves failed; late success cannot reactivate navigation |
| G46/G52 — scope changes and A→B→A | `packages/ui/test/knowledgeCitationTransaction.test.ts`; `packages/ui/test/knowledgeCitationNavigation.test.ts` | Delayed results from a revoked request cannot regain authority when the prior scope returns |
| G47/G48 — failed/changed readback | `packages/ui/test/knowledgeCitationTransaction.test.ts`; `packages/ui/test/knowledgeCitationNavigation.test.ts` | Failed reads and mismatched quote slices fail closed |
| G49/G50 — forged source and genuine navigation | `packages/desktop/test/e2e/conversation-session/manual-review/obsidian-inline-citation-provenance.test.ts`; `obsidian-authenticated-handoff.test.ts` | Real Electron/CLI/Receipt path rejects forged or stale sources and opens only a currently authenticated source |
| G51 — repeat warning/retry behavior | `packages/ui/test/knowledgeCitationOpenFeedback.test.ts` | Duplicate feedback is deduplicated while a later retry remains possible |
| G53/G55 — quote reveal and focus | `packages/ui/test/vaultQuoteRevealCodeMirror.test.ts` | Exact two-line selection, unchanged document text, focus on valid scope, and no focus steal after scope revocation |
| G54 — edit outside the quoted excerpt | `matchesKnowledgeCitationFileReadback` regression in `knowledgeCitationNavigation.test.ts`; production use in `VaultView.tsx` | Full-file SHA mismatch rejects the second read even when the quoted excerpt itself still matches |
| G65/G67 — L2 stays closed under A1/S03 NO-GO | `packages/desktop/test/e2e/obsidian-knowledge-positive.test.ts` and service write-path tests | Proposal/preview/approval remain available; production toggle/Apply/Undo remain disabled and Vault content is unchanged |

The Electron suites use deterministic replay for model response text only. Vault access, indexing, Knowledge RPC, CLI admission, Receipt projection, CodeMirror navigation and the L2 gate are exercised through the production implementations in an isolated `.e2e-home`. This is not evidence of real-provider answer quality.

## Release boundary

- Manual walkthrough is not being requested for cases with automated coverage, per the maintainer's explicit instruction.
- A scenario not represented by an automated test must remain marked unverified; do not infer success from a neighboring test.
- The S03 NO-GO has not been revoked. Do not enable production L2 or treat this self-review as an independent security sign-off.
- The PR remains open and unmerged; latest-head CI and Electron results are the authority for code validation.
