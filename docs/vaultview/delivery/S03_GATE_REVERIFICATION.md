# S03 写安全门禁复验（GO 裁定）

**工作单：** W08　**日期：** 2026-10-11　**分支：** `feat/vaultview-s03`（基于 main `00135862`）
**门禁：** W00_TOOL_WRITE_MATRIX §6 S03 有条件 GO 的落地条件 / `WRITE_SAFETY_NO_GO.md`（W06 裁定）所列前提
**裁定：** **GO**——W06 NO-GO 的全部前提已满足，本文件为翻转裁定的证据记录。

## 1. W06 NO-GO 前提逐项核对

| W06 NO-GO 前提 | 本分支状态 | 证据 |
| --- | --- | --- |
| 三洞 (1a)：plan 模式无 `destructiveHint` MCP 直通（`core/src/permission/service.ts` `mode.plan.mcp` 分支） | **已修** | 分支删除，未声明 readOnly 的 MCP 落 `mode.plan.nonReadOnly` deny；`isMcpToolCapability` 一并移除（WSG-1/WSG-2） |
| 三洞 (1b)：memory md 覆盖 plan deny（`core/src/tool/executor/memory-file-permission.ts:74-77`） | **已修** | `preservesExistingPermissionDecision` 对 deny 一律保留（WSG-3/WSG-3b/WSG-4/WSG-4b） |
| 三洞 (2)：缺内容键建议整工具 allow（`core/src/tool/executor/permission-suggestions.ts`）+ subjects 键集无 `code` | **已修** | 缺内容键返回空数组；键集补 `code`（建议器与 `PermissionService.ruleSubjects` 双侧）；判定侧空内容 allow 规则对非 readOnly 普通工具不再匹配（WSG-5/6/6b/9/9b/9c） |
| 三洞 (3)：Bash 整工具 allow 短路一切（`core/src/tool/handlers/bash-command-rule-evaluator.ts:14`） | **已修** | 整工具 allow 只豁免安全命令；allow 方向逐主体匹配忽略空内容规则；deny/ask 方向不变（WSG-7/7b/8） |
| P0 分级门控在 permission service/runtime 层程序化完成 | **已实施** | 判定侧统一收口于 `PermissionService.matchesRule`（`specs/write-safety-gating.md` §3）；Bash 经 rulePolicy 求值器承载等价语义；统一能力旗标广播沿用既有 `resolveToolCallCapabilityFlags` |

可复核命令：`git diff 00135862..<本分支> -- apps/drora-cli/packages/core/src/permission/service.ts apps/drora-cli/packages/core/src/tool/executor/memory-file-permission.ts apps/drora-cli/packages/core/src/tool/executor/permission-suggestions.ts apps/drora-cli/packages/core/src/tool/handlers/bash-command-rule-evaluator.ts`（五处改动全部落在上述文件 + 新增 `core/test/write-safety-gating.test.ts` + `specs/write-safety-gating.md`）。

## 2. 复验测试（真实命令与退出码，win32 / node v24.1.0 / tsx）

| 命令 | 结果 |
| --- | --- |
| `node --import tsx --test apps/drora-cli/packages/core/test/write-safety-gating.test.ts` | **tests 15 / pass 15 / fail 0**，EXIT=0（WSG-1..9 + 回归项全绿） |
| `pnpm typecheck`（全仓 tsc -b） | EXIT=0 |
| `pnpm --filter @drora/core typecheck`（src 全量 tsc --noEmit） | EXIT=0 |
| `tsc --noEmit --strict --module nodenext … test/write-safety-gating.test.ts`（新测试文件严格类型检查） | EXIT=0，0 errors |
| `pnpm lint`（全仓 oxlint） | EXIT=0；388 warnings / 0 errors——与基线 `00135862` 实测同值（388），**零新增**；本次改动文件定向 oxlint 零告警 |
| `pnpm --filter @drora/core lint` | EXIT=0（14 warnings 为 core 存量，定向复核本次改动文件零告警） |
| `pnpm architecture:check --changed` | `new: 0`，EXIT=0 |

## 3. 全量测试基线对比（方法与结果）

本仓全量 node:test 套件不在 CI 门禁内，基线须取自**无本分支改动的干净检出**，否则无法区分「改动引入」与「基线既有」：

1. 以 `git worktree add` 建立基线 `00135862` 的干净检出并 `pnpm install --frozen-lockfile`；
2. 基线全量套件（10 目录）：**tests 519 / pass 509 / fail 10**，失败文件集 = `desktopMobileRelayControl`（2，并行时序敏感：两检出隔离复跑均 41/41 全绿）、`desktopPetCatgirlArtwork`（3，main 上既有——与 website 合并带入的 `pnpm-lock.yaml` 变更（+463/−41）后依赖树相关，CI 不覆盖该套件故未被发现）、`desktopRendererPlatformMobileFace` / `services+ui nonCliAcpRetirement` / `computerUseSettingsNavigation`（既有基线红名单）；
3. 本分支全量套件（11 目录，含新增 core 测试）：**tests 534 / pass 525 / fail 9**，失败文件集与基线**完全一致**（同一 6 文件；9 vs 10 为 relayControl 并行涨落）；
4. 结论：**本分支零新增测试失败**，且新增 15 用例全绿。

## 4. 裁定

- S03 门禁由 W06 的 **NO-GO** 翻转为 **GO**：三洞全部修复（可执行测试锁定），P0 分级门控在判定唯一所有者（`PermissionService`）与 Bash rulePolicy 求值器落地，有意分歧三项（MCP 进程内落盘 / 宿主自动写盘 / yolo 直通）按 `specs/write-safety-gating.md` §4 以审计+凭证口径记录。
- **L2 审核写回机制允许被配置开启，但 `writePathEnabled` 缺省仍为关闭**（`knowledgeServices.ts` 缺省 false 不变），由用户显式开启；UI 开关与审核视图消费属后续工作单。在开关开启前，本裁定不改变任何用户可见行为（除 §2.1/§2.2 的 plan 模式与 memory 覆盖收紧，属安全修复本身）。

## 5. 未执行项（如实声明）

- Electron 进程内的真实工具调用 E2E（权限弹窗交互面）：本环境无 GUI 交互面；判定层语义已由进程内测试锁定，UI 半边归后续 GUI E2E 工作单。
- MCP server 真实进程内落盘的逐路径审计：结构性不可行，属 §4 有意分歧，不补测。
- ubuntu/macos 上的 WSG 套件实测：由 CI 承载（本分支推送后跑通为准）。
