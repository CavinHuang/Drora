# S03 写入安全运行时覆盖报告（A31 素材，复评输入）

**日期：** 2026-10-11　**分支：** `feat/knowledge-jev-assembly`　**spec：** `specs/agent-write-safety.md`
**性质：** 复评素材，不是 GO 裁定。S03 复评通过前 `writePathEnabled` 维持关闭
（`WRITE_SAFETY_NO_GO.md` 仍然有效），本文件只证明「GO 前提的运行时部分已程序化落地」。

## 1. 逐洞修复证据

| 洞 | 修法 | 文件与符号 | 测试 |
| --- | --- | --- | --- |
| 1a plan MCP 直通 | 删除 `mode.plan.mcp` 分支；MCP 与其它工具同规则（自报 readOnly 且非 destructive 才放行） | `apps/drora-cli/packages/core/src/permission/service.ts` `checkPlanMode` | `permission-service-write-tier.test.ts`（plan deny ×2） |
| 1b memory 覆盖 plan deny | `preservesExistingPermissionDecision` 保留一切 deny（删 `mode.plan.nonReadOnly` 豁免） | `apps/drora-cli/packages/core/src/tool/executor/memory-file-permission.ts` | `memory-file-permission.test.ts`（deny 保留 ×2、P2 免确认保留、alwaysAsk/项目 ask 保留、非目标透传） |
| 2 建议侧 | P0 工具（Bash/js/未自报 readOnly MCP）提取不到内容 → 空建议 | `src/tool/executor/permission-suggestions.ts` `buildDefaultPermissionUpdates`（新参 capability） | `permission-suggestions.test.ts` ×5 |
| 2 评估侧 | behavior=allow 且无 rulePolicy 时，P0 工具的无内容 allow 规则不匹配；OfficialCua 豁免；有 rulePolicy 的 Bash 交由评估器（洞 3 修复） | `src/permission/service.ts` `matchesProjectRules` | `permission-service-write-tier.test.ts`（js/MCP 不放行、readOnly MCP 与 CUA 照旧、P1 Write 内容规则不受影响） |
| 2 持久化边界 | `persistProjectPermissionUpdates` 消毒：P0 无内容 allow 规则丢弃 + `tool.permission.project_update.sanitized` warn 审计；全拒时短路 | `src/tool/executor/permission-rules-persistence.ts` + `src/permission/write-tier-policy.ts` `sanitizePermissionUpdatesForPersistence` | `write-tier-policy.test.ts` ×6 |
| 3 Bash 整工具短路 | 整工具 allow 只对 `safe` 命令生效；非 safe 落逐次确认；精确命令 allow（用户逐条看过）保持原语义；deny/ask 不变 | `src/tool/handlers/bash-command-rule-evaluator.ts` `evaluateBashRules` | `bash-command-rule-evaluator.test.ts` ×5 |
| 5 mcp 自报收口 | 自报只在收紧方向采信：`readOnlyHint=true` 才有 plan 直通/整工具 allow 资格；漏报 destructive 按 P0 逐次确认兜底 | `write-tier-policy.ts` `isP0WriteTarget` + 上述评估侧 | 同上 |

新增策略模块：`src/permission/write-tier-policy.ts`（P0/P1/P2 单一出处 + 消毒函数）；core 包
新增 `test/`（node:test + tsx，`pnpm test`），`package.json` 增加 `test` 脚本。

## 2. 逐路径阻断矩阵（模型可见工具全覆盖）

| 通道 | 任意路径写形态 | 门控行为 | 审计 |
| --- | --- | --- | --- |
| Bash | 重定向/tee/写型命令（`safe=false`） | 整工具 allow 不生效 → build/edit 模式逐次确认；plan 直接 deny | `tool.permission.evaluated`（writeTier=p0 + ruleId） |
| Bash | safe 命令 | 整工具/内容 allow 照旧（既有体验） | 同上 |
| Bash | 精确命令 allowlist | 照旧（用户逐条看过完整命令） | 同上 |
| js (node_repl) | 任意代码 | 整工具 allow（项目/会话）不匹配；自报 high-risk → `mode.build.highRisk` 逐次确认；plan deny | 同上 |
| MCP 未自报 readOnly | 任意工具调用 | 整工具 allow 不匹配；`mode.build.sideEffect` 逐次确认；plan deny | 同上 |
| MCP 自报 readOnly | —（声明只读） | plan 直通/整工具 allow 保留；漏报风险 = 有意分歧 1 | 同上 |
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

1. **MCP server 进程内自发改写**（有意分歧 1）：server 在工具调用之外写盘不可见；
   自报 readOnly 的 server 漏报时本门控不设防。
2. **宿主自动写盘**（有意分歧 2）：安装器/更新器等不经模型工具面。
3. **yolo 直通**（有意分歧 3）：本门控不拦 yolo；显式 receipt 属后续工作项。
4. **CLI 启动 `allowedTools`**：操作员显式启动参数，视同操作员决定，不拦截（spec §1 记录）。
5. **建议为空时的确认窗形态**：P0 无内容工具现在没有「总是允许」可勾选，确认窗只剩
   一次性放行/拒绝——UI 侧是否需要文案说明属后续打磨，不阻断安全语义。

## 5. 复评路径

本文件 + `specs/agent-write-safety.md` 交复评；S03 通过后以独立改动翻转
`writePathEnabled`（生产装配 + `specs/obsidian-knowledge.md` §5e 引言同步），
`WRITE_SAFETY_NO_GO.md` 撤销归档。在那之前任何文档/代码不得宣称审核写入已生效。
