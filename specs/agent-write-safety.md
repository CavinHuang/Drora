# Agent 写入安全：三洞修复与 P0/P1/P2 分级门控（S03）

状态：**实现完成，待 S03 复评**（2026-10-11）。本 spec 是
`docs/vaultview/delivery/W00_EVIDENCE_REPORT.md` §7「S03 有条件 GO（收窄口径）」GO 前提的
程序化落地记录；`WRITE_SAFETY_NO_GO.md` 的撤销条件见其 §3，翻转
`writePathEnabled` 仍以复评通过为前提，本 spec 不改变该裁定。

## 0. 范围与不变量

- 目标：VaultView L2 审核写回（`specs/obsidian-knowledge.md` §5e）的运行时前提——模型可见
  工具的任意路径写通道可判定、可阻断、可审计。
- 不变量：
  1. plan 模式拦下一切写入（memory md、workflow 草稿都是写入，无一例外）；
  2. P0 工具（任意路径写向量）不存在「一次确认、永久放行」的通道；
  3. 宿主验证过的能力组（OfficialCua）不受本门控影响（信任锚是 broker 验证，非自报）；
  4. 门控在 permission service / runtime 层程序化完成，不依赖插件 hook；
  5. 仓库纪律：core 属上游对齐代码，策略逻辑全部住新模块
     （`apps/drora-cli/packages/core/src/permission/write-tier-policy.ts`），既有文件只做
     sanctioned 挂点接线与缺陷修正，不做顺手重构。

## 1. 工具写入分级（P0/P1/P2）

判定输入：`toolName` + 解析后能力（`permissionName`/`readOnly`）。实现在
`write-tier-policy.ts`，单一出处。

| 级 | 集合 | 语义 |
| --- | --- | --- |
| P0 | `Bash`、`js`（node_repl）、所有非 Host 验证的 `mcp__*` | 任意路径写向量：逐次确认（整工具 allow 规则不生效），禁止整工具持久 allow；自报 `readOnlyHint` 不降级权限 |
| P1 | `Write`/`Edit`/`ApplyPatch`（授权根内写） | 维持现骨架：模式与项目规则照旧，obsidian vault hook 路径不变 |
| P2 | memory md / workflow 草稿 / artifacts / 执行日志等免确认区 | 保留免确认，但保留可审计的判定日志（ruleId 落事件） |

有意分歧（W00 §7 允许的三项，spec 层面如实记录，不伪装覆盖）：

1. MCP server 进程内写盘——工具调用之外的自发写入不可见；模型可见的第三方 MCP
   一律按 P0 逐次确认且不能整工具持久 allow；只有 Host 验证的 OfficialCua 能力组豁免。
   服务端自报 `readOnlyHint` 不构成信任锚；
2. 宿主自动写盘（安装器/更新器等）不经模型工具面；
3. yolo 模式直通——保留，需显式 receipt（既有行为，不在本 spec 收口范围）。

另：CLI 启动参数 `allowedTools` 是操作员显式授权（会话级启动配置），视同 yolo 级操作员
决定，本门控不拦截，在此记录。

## 2. 三洞修复（逐洞：缺陷 → 修法 → 证据）

### 洞 1a：plan 模式 MCP 直通

- 缺陷：`permission/service.ts` `checkPlanMode` 的 `mode.plan.mcp` 分支放行一切未自报
  `destructive` 的 MCP 工具——自报不可信（见洞 5/mcp 自报收口），写盘型 MCP 在 plan 模式
  可直接执行。
- 修法：删除该分支。普通 MCP 的 `readOnlyHint` 是服务端自报，不构成信任锚；plan 只允许
  Host 验证的只读能力（当前 OfficialCua）或其它内建可信只读工具。普通 MCP 一律 deny。

### 洞 1b：memory md 覆盖 plan deny

- 缺陷：`memory-file-permission.ts` `preservesExistingPermissionDecision` 对
  `mode.plan.nonReadOnly` 的 deny **不保留**，随后覆盖为 allow——plan 模式下 memory md
  写入被静默放行。
- 修法：保留一切 deny（删去该豁免）。P2 免确认在非 plan 模式照旧（allow/ask 覆盖逻辑不变，
  alwaysAsk 与项目 ask 的保留分支不变）。

### 洞 2：node_repl/MCP 无内容规则粒度

- 缺陷两面：
  1. 建议侧：`permission-suggestions.ts` 对输入无 `command/url/file_path/path/pattern`
     键的工具（js 的 `{code}`、多数 MCP）产出**无内容**整工具 allow 建议，一次「总是允许」
     即持久化整工具 allow；
  2. 评估侧：`permission/service.ts` `matchesRule` 对无 `ruleContent` 的 allow 规则恒匹配，
     在 `rule.project.allow`（先于 build/edit 的 high-risk 分支）放行 js/MCP 的一切调用。
- 修法：
  1. 建议侧：P0 工具且提取不到内容时返回空建议（确认窗不提供「总是允许」）；CUA 能力组
     路径不变；
  2. 评估侧：`matchesProjectRules` 在 behavior=allow 时，P0 工具的无内容 allow 规则不匹配
     （CUA 能力组豁免）；会话规则同一路径，一并生效；
  3. 持久化边界：`persistProjectPermissionUpdates` 消毒入站 updates——P0 工具（按规则名
     `Bash`/`js`/`mcp__` 前缀识别）的无内容 allow 规则丢弃并 warn 审计（防客户端回传越权
     更新，与建议侧互为纵深）。

### 洞 3：Bash 整工具 allow 短路一切命令

- 缺陷：`bash-command-rule-evaluator.ts` 首行 `rules.some(!ruleContent) → true` 在 `safe`
  判定之前短路——含重定向在内的任意命令（`safe=false`）都被整工具 allow 放行。
- 修法：behavior=allow 时先判 `safe`：非 safe 命令一律不匹配 allow 规则（含整工具与内容
  规则，逐次确认）；safe 命令才允许整工具 allow 短路与内容匹配。deny/ask 行为不变
  （整工具 deny/ask 匹配一切是安全方向）。

### 洞 5（收口）：mcp/index.ts 自报信任

- 现状：`readOnly`/`destructive` 直接取 server annotations。外部 server 行为不可验证，
  「信任自报」无法程序化证伪。
- 收口口径（2026-10-17 修订）：MCP server 自报的 `readOnlyHint` / `destructiveHint`
  都不是权限信任锚。`destructiveHint=true` 可将风险提升，但 `readOnlyHint=true` 不能
  降低 P0 等级，也不能获得 plan 直通或整工具 allow。所有第三方 MCP 按 P0 逐次确认；
  只有 Host 注入的 OfficialCua capability group 作为可信例外。
  `concurrentSafe/idempotent` 等非权限语义的自报不在本 spec 范围。

## 3. P0 门控的判定次序（实现后）

`checkPermission` 既有次序不动，三处接线：

1. 项目/会话 allow 规则评估（`rule.project.allow`、`rule.session.allow`）：P0 无内容 allow
   不匹配（洞 2 评估侧）；Bash 走 `evaluateBashRules`（洞 3）——非 safe 命令永不匹配 allow。
   于是 P0 的放行只剩：Bash safe 命令（内容/整工具规则均要求 safe）、显式内容规则命中。
2. 未命中放行 → 落入既有 build/edit 分支：js → `mode.build.highRisk` 逐次确认；所有普通
   MCP（无论 `readOnlyHint`）→ `mode.build.sideEffect` 逐次确认。
3. plan 模式：写入（非 readOnly）一律 deny（洞 1a/1b 修复后无旁路）。

审计：permission-flow 的 `tool.permission.evaluated` 结构化日志携带 ruleId/mode/toolName，
即 P0 逐次确认与 P2 免确认的审计事件载体（P2 覆盖行为 ruleId=`memory.file.markdown`
可检索）。

## 4. 验收映射（A31 素材）

| ID | 场景 | 断言 | 测试 |
| --- | --- | --- | --- |
| S03-P0-1 | Bash 整工具 allow + 重定向命令 | deny→ask（不放行） | `bash-command-rule-evaluator` 测试 |
| S03-P0-2 | Bash 整工具 allow + safe 命令 | allow（既有体验保留） | 同上 |
| S03-P0-3 | js 无内容 allow 规则（项目/会话） | 不匹配，落到 highRisk ask | `permission service` 测试 |
| S03-P0-4 | 第三方 MCP（无论 readOnlyHint）无内容 allow 规则 | 不匹配 | 同上 |
| S03-P0-5 | CUA 能力组整工具规则 | 照旧匹配（宿主验证豁免） | 同上 |
| S03-P0-6 | P0 工具「总是允许」建议 | 无内容 → 空建议；CUA 不变 | `permission-suggestions` 测试 |
| S03-P0-7 | 持久化边界收到 P0 无内容 allow | 丢弃 + warn 审计 | `permission-rules-persistence` 测试 |
| S03-P1-8 | plan 模式普通 MCP（无论 readOnlyHint） | deny（仅 Host 验证能力可走只读快速路径） | `permission service` 测试 |
| S03-P1-9 | plan 模式 memory md 写入 | deny 保持（覆盖器不翻转 deny） | `memory-file-permission` 测试 |
| S03-P2-10 | 非 plan 模式 memory md 写入 | allow（P2 免确认保留） | 同上 |

## 5. 生效与回滚

- 全部改动在 `apps/drora-cli/packages/core`（五个既有文件的最小接线 + 一个新模块 + 测试），
  不触碰 `specs/obsidian-knowledge.md` 的 NO-GO 状态，不翻转 `writePathEnabled`。
- 回滚 = revert 本 spec 对应的提交（单包改动，无跨包契约变更，无持久化迁移）。


## 6. 2026-10-17 correction: MCP annotations are not authorization

The earlier wording that `readOnlyHint=true` was trusted "only in the tightening direction" was incorrect: allowing a server-authored hint to lower the permission tier made an untrusted MCP descriptor a bypass for plan mode and whole-tool persistent allow. The implementation now classifies all non-Host-verified MCP tools as P0 regardless of `readOnlyHint`, prevents that hint from taking build/plan read-only fast paths, and does not display third-party MCP tools as low risk solely because of the hint. The verified `OfficialCua` capability group remains the host-attested exception. Regression tests cover the self-reported-read-only bypass and the trusted CUA exception.
