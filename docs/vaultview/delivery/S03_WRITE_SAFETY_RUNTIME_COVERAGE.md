# S03 写入安全运行时覆盖报告（A31 素材，复评输入）

**日期：** 2026-10-16　**分支：** `feat/obsidian-knowledge-e2e`　**spec：** `specs/agent-write-safety.md`
**性质：** 复评素材，不是 GO 裁定。三洞修复 + P0/P1/P2 runtime 门控的实现和测试已在本分支，但这不构成独立 S03 GO。依照 A1 首发范围，生产装配显式传入 `reviewWriteSafetyGatePassed: false`；只有隔离测试可 override。正式 S03 裁定仍需独立 Review，本文件不自行宣布 GO。

## 1. 逐洞修复证据

| 洞 | 修法 | 文件与符号 | 测试 |
| --- | --- | --- | --- |
| 1a plan MCP 直通 | 普通 MCP 的自报 readOnly 不再获得 plan 直通；仅 Host 验证的 OfficialCua 可走可信只读快速路径 | `apps/drora-cli/packages/core/src/permission/service.ts` `checkPlanMode` | `permission-service-write-tier.test.ts`（普通 MCP deny + OfficialCua allow） |
| 1b memory 覆盖 plan deny | `preservesExistingPermissionDecision` 保留一切 deny（删 `mode.plan.nonReadOnly` 豁免） | `apps/drora-cli/packages/core/src/tool/executor/memory-file-permission.ts` | `memory-file-permission.test.ts`（deny 保留 ×2、P2 免确认保留、alwaysAsk/项目 ask 保留、非目标透传） |
| 2 建议侧 | P0 工具（Bash/js/所有普通 MCP）提取不到内容 → 空建议；readOnlyHint 不降级 | `src/tool/executor/permission-suggestions.ts` `buildDefaultPermissionUpdates` | `permission-suggestions.test.ts` ×5 |
| 2 评估侧 | behavior=allow 且无 rulePolicy 时，普通 MCP 的无内容 allow 规则不匹配；OfficialCua 由 Host 验证后豁免；Bash 交由命令评估器 | `src/permission/service.ts` `matchesProjectRules` | `permission-service-write-tier.test.ts`（普通 MCP readOnly 自报仍不放行、OfficialCua 豁免、P1 Write 不受影响） |
| 2 持久化边界 | `persistProjectPermissionUpdates` 消毒：P0 无内容 allow 规则丢弃 + `tool.permission.project_update.sanitized` warn 审计；全拒时短路 | `src/tool/executor/permission-rules-persistence.ts` + `src/permission/write-tier-policy.ts` `sanitizePermissionUpdatesForPersistence` | `write-tier-policy.test.ts` ×6 |
| 3 Bash 整工具短路 | 整工具 allow 只对 `safe` 命令生效；非 safe 落逐次确认；精确命令 allow（用户逐条看过）保持原语义；deny/ask 不变 | `src/tool/handlers/bash-command-rule-evaluator.ts` `evaluateBashRules` | `bash-command-rule-evaluator.test.ts` ×5 |
| 5 MCP 自报收口 | 普通 MCP 的 `readOnlyHint` 不能降低 P0、plan 直通或整工具 allow；仅 Host 验证的 OfficialCua 是可信例外 | `write-tier-policy.ts` `isP0WriteTarget` / `isTrustedReadOnlyTool` | 普通 MCP readOnly 自报回归 + OfficialCua 例外测试 |

新增策略模块：`src/permission/write-tier-policy.ts`（P0/P1/P2 单一出处 + 消毒函数）；core 包
新增 `test/`（node:test + tsx，`pnpm test`），`package.json` 增加 `test` 脚本。

## 2. 逐路径阻断矩阵（模型可见工具全覆盖）

| 通道 | 任意路径写形态 | 门控行为 | 审计 |
| --- | --- | --- | --- |
| Bash | 重定向/tee/写型命令（`safe=false`） | 整工具 allow 不生效 → build/edit 模式逐次确认；plan 直接 deny | `tool.permission.evaluated`（writeTier=p0 + ruleId） |
| Bash | safe 命令 | 整工具/内容 allow 照旧（既有体验） | 同上 |
| Bash | 精确命令 allowlist | 照旧（用户逐条看过完整命令） | 同上 |
| js (node_repl) | 任意代码 | 整工具 allow（项目/会话）不匹配；自报 high-risk → `mode.build.highRisk` 逐次确认；plan deny | 同上 |
| 普通 MCP（无论 readOnlyHint） | 任意工具调用 | 整工具 allow 不匹配；`mode.build.sideEffect` 逐次确认；plan deny | 同上 |
| 持久化通道 | 客户端回传 P0 无内容 allow | 落盘前丢弃 + sanitized warn | `tool.permission.project_update.sanitized` |
| P2 memory md | Write/Edit 落 memory 根内 .md | 非 plan 免确认保留（ruleId=`memory.file.markdown`）；plan deny 保留 | `tool.permission.evaluated`（writeTier=p2 + ruleId） |
| P1 Write/Edit/ApplyPatch | 授权根内写 | 既有骨架不变（模式/项目规则/obsidian vault hook 路径） | 既有日志 |
| yolo | 一切 | 直通保留 = 有意分歧 3（receipt 事项不在本轮） | 既有 |

## 3. 测试执行证据

```
node --import tsx --test test/*.test.ts（apps/drora-cli/packages/core）
# tests 28  # pass 28  # fail 0
```

- `core` `pnpm typecheck` / `pnpm build` exit 0；下游 `bootstrap`/`cli`/`node-repl-host`
  typecheck exit 0；根 `pnpm lint` exit 0 且本次改动文件零警告。
- 既有行为回归：`permission service` 既有调用方（permission-flow/permission-input-recheck）
  仅做能力解析提升与建议参数透传，无判定次序变化；`drora-cli` 无 turbo.json 的根 typecheck
  脚本为既有缺失，未由本轮引入。

## 4. 未覆盖/残余（复评时须计入）

1. **MCP server 进程内自发改写**：server 在工具调用之外写盘不可见。工具调用入口现在不信任
   `readOnlyHint`；但 server 自身绕开工具调用直接写盘仍不在本门控可见范围。
2. **宿主自动写盘**（有意分歧 2）：安装器/更新器等不经模型工具面。
3. **yolo 直通**（有意分歧 3）：本门控不拦 yolo；显式 receipt 属后续工作项。
4. **CLI 启动 `allowedTools`**：操作员显式启动参数，视同操作员决定，不拦截（spec §1 记录）。
5. **建议为空时的确认窗形态**：P0 无内容工具现在没有「总是允许」可勾选，确认窗只剩
   一次性放行/拒绝——UI 侧是否需要文案说明属后续打磨，不阻断安全语义。

## 5. 复评路径

本文件 + `specs/agent-write-safety.md` 交独立复评；生产 Host 当前显式传入 `reviewWriteSafetyGatePassed: false`，因此即使持久化偏好为 true，生产 Review 开关和 Apply/Undo 也不能激活。正式 S03 GO 仍需要独立 reviewer 撤销 `WRITE_SAFETY_NO_GO.md` 的裁定；在该复评完成前，不能把“代码已接通”表述成“安全审查已通过”。


## 6. 2026-10-16 实际验证更新

- `packages/services/src/node.ts`：生产装配对所有 authority 显式注入 `reviewWriteSafetyGatePassed: false`；desktop-local 也不会自动获得 L2 写能力。
- `packages/services/src/obsidian-vault/atomic.ts`：Windows 临时文件共享占用导致的 rename 失败增加有界重试，仍保持 temp-file + rename，不退化为 copy/truncate。
- 真实 Electron G67：Windows 2022 与 macOS 14 均通过 approval → preview → apply → undo；对应 Cross-platform Acceptance run `38915496910` 全部成功。
- Full CI `38915497030` 与 Electron Provenance `38915496940` 同一 HEAD 通过。


## 7. A1 production gate revalidation — 2026-10-17

A code review found that an earlier change inferred S03 approval from `serviceAuthorityMode === "desktop-local"`. That inference is invalid: a local host identifies the authority boundary, not an independent security decision. The production host now explicitly supplies `reviewWriteSafetyGatePassed: false` for all authority modes. G67 has been changed to assert that proposal creation, preview and approval work, while the production toggle and Apply/Undo remain disabled and the real Markdown file remains unchanged. This correction must pass on the latest CI/Electron HEAD before merge.


## 8. 2026-10-17 MCP self-report correction

The previous coverage text incorrectly described server-authored `readOnlyHint=true` as a tightening-only signal while using it to lower P0 risk. That inconsistency is fixed in code and tests: all non-Host-verified MCP tools remain P0 regardless of their annotations; only the broker/Host-verified `OfficialCua` group is exempt. Third-party MCP `readOnlyHint` no longer grants plan/build read-only fast paths and no longer lowers the UI risk tier. This report remains review material, not an S03 GO; production L2 is still explicitly disabled under A1.

