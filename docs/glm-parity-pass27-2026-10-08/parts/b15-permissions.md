# b15 权限/审批域对拍报告（pass27，2026-10-08）

真值 = `D:\software\zcode\resources\glm\zcode.cjs`（0.16.9）。我方 = `apps/drora-cli`（feat/migrate-remote-and-pet）。
偏移均为 bundle 内字节偏移（`grep -ob`/node 截窗取得）；我方一律 `文件:行`。

## §1 判定链

**结论：1:1，无差距。**

- 入口：我方 `core/src/tool/executor/permission-flow.ts:41 resolveToolPermission` ≈ 真值 `Noo@5002317`。
  流程逐段一致：加载项目规则 → `checkPermission` → PreToolUse hook 覆盖 → memory-file 修正 → deny 短路 → approval-gate → emit requested → hook/broker 竞速（我方 `permission-responder-race.ts`，修注释所述"确认窗死亡"竞速）→ modify 输入重查 → 项目/会话规则落库。
- 决策源优先级（我方 `core/src/permission/service.ts:97` ≈ 真值 `UM 类 checkPermission@5092664`）：
  planModeTransition → requiresUserInteraction（disallowedTools 硬禁优先）→ alwaysAsk（`checkAlwaysAsk`：auto deny → disallowedTools → 项目 deny → 会话 allow → ownedWorkflowAmend → ask）→ yolo → auto（unimplemented deny）→ disallowedTools → 项目 deny → 项目 ask → plan → 项目 allow → WebFetch 预批 → workflow 草稿免确认 → allowedTools → edit → build。
  ruleId 字符串（`mode.yolo`/`rule.project.*`/`rule.session.allow`/`rule.session.workflowOwner`/`tool.webfetch.preapproved`/`tool.workflowDraft.preapproved`/`mode.build.*`/`mode.plan.*`/`mode.edit.fileEdit`/`mode.auto.unimplemented`/`tool.alwaysAsk`/`tool.userInteraction`）逐一相同。
- `resolveCapability`、`result()` 形状（allowed/escalated/alwaysAsk 旗标）、readOnly/write/destructive 三个硬编码集合、capability merge（真值 `HNe@4993020`）均一致。
- 规则持久化：sessionStore `getProjectPermission(projectID)` / `saveProjectPermission`；`applyPermissionUpdates` 仅 addRules + `toolName\0ruleContent` 去重（真值 `bpt/iXs@4996590` ≈ 我方 `permission-rules.ts`）。会话级 grant 纯内存、不落盘，两边一致。

## §2 规则引擎（bash）

**结论：逻辑 1:1；历史两项 bug（kind 枚举、`:*` 复合穿透）均已确认修复，无翻案。**

- `evaluateBashRules`：我方 `tool/handlers/bash-command-rule-evaluator.ts:13` ≈ 真值 `Cpo@7298240`。空 ruleContent 放行 → 精确命令命中放行 → unsafe 拒绝 → allow 用 requiredSubjectGroups every-match，deny/ask 用 allSubjectGroups some-match。`:*` 前缀匹配 `subject===prefix||prefix+" "||prefix+"\t"`（`Ipo` ≈ `matchesInvocationRule`），复合命令（`&&`/管道拆解后）不会因单段命中而整体放行——V4-PR 穿透不可复现。
- 稳定前缀推导：高风险根命令 16 个、wrapper 表（command/env/nohup/sudo/time）、script actions（bun/deno/npm/pnpm/yarn）、TARGET(just/make)、PYTHON(py/python3/py)、family depth（aws/az/docker/gcloud/kubectl）逐项相同（真值 `ica/sca/cca/lca/uca/dca@7298+` ≈ 我方 `bash-command-permission-policy.ts:19-83`）。
- 建议 rules：`MAX_SUGGESTED_RULES=5`（真值 `Apo=5`）、超限回退精确命令、`${prefix}:*` 形态一致；双 subject（raw + stablePrefix）一致（真值 `Ppo`）。
- 通用匹配：`wildcardToRegExp`、WebFetch `domain:` subject、subject 键序 `command,url,file_path,path,pattern,patch_text`、`Write` 命中 `Edit` 规则的兼容、official_cua 规则仅信 capabilityGroup 均一致（真值 `zpt/BQs/lso`、`matchesRuleScope`）。

## §3 交互审批

**结论：1:1。选项 kind 枚举历史 bug 已修复（双方 4 值闭集语义）。**

- 选项构建：我方 `bootstrap/src/permission-options.ts:37` ≈ 真值 `y9@14194982`。
  `allow_once`（Allow once）→ `session-always-allow`（kind `allow_session`、optionId `allowSession`、无 permissionUpdates，broker 应答侧合成 `sessionPermissionUpdates`）→ `allow_always`（optionId `allow_project`，official CUA 文案变体）→ `deny`（长文案 `PERMISSION_DENIED_BY_USER_CONTENT`）；`no-always-allow` 裁掉 always 项。逐字段相同。
- v4 应答归一：我方 `drora-protocol/interaction-broker.ts:147` ≈ 真值 `VZa@14442783`。Refine 特判（仅 CreateWorkflow/AmendWorkflow、freeText 非空 → deny + `workflow_refine_feedback`）→ optionId 精确命中 → `allowAlways`/`allowOnce` 兜底 → 未知一律 deny；deny+freeText 携 `preserveReasonFormatting`。legacy 选项降级（`toLegacyPermissionOptionsPolicy` ≈ `Jbe`）一致。
- 三路审批 + v4 Refine + 会话变体全部对上；v4 投影 optionId/kind 映射（allow_once→allowOnce 等）见 `product-projection.ts:3173-3198` ≈ 真值@14250640。
- plan_approval 同链路：走 `interactionRequestUserInput`，schema `{interaction:"plan_approval",toolName}`、题干 "Review this implementation plan."、选项 approve（我方 `interaction-broker.ts:39-40,286,326` ≈ 真值 `oKo/lRn/kJa@14199594`）；freeText → deny + `plan_approval_feedback` reasonSource。
- 超时/重发：`permissionTimeoutMs` 双方均可选透传、无内建缺省（真值 `defaultTimeoutMs??3e5` 属后台任务通知，与权限无关）；等待期按 1000ms 重发登记（真值 `qZa=1e3` ≈ 我方 `interaction-broker.ts:41`）。
- hook 竞速与 fullAccess：PreToolUse allow 覆盖仅在 `!alwaysAsk`（真值 `_oo@4991031` ≈ 我方 `hook-flow.ts:195`）；PermissionRequest hook 并发竞速、hook 故障只退赛不替用户拒绝——两侧同构。fullAccess 应答（`commitPermissionFullAccess` + `waitForPermissionGrantCommit`）与授予后恢复（WeakMap 记录未发布事务、pendingInputs intent→yolo、`permissionFullAccessPending`）均一致（真值 `Ywn@~787k` ≈ 我方 `runtime/permission-full-access.ts:94-95`、`runtime/permission-grant-recovery.ts`）。
- `canUseTool`：真值 0 次、我方 0 处，双方均无此 API。

## §4 网络敏感面

**结论：1:1。**

- allowSensitive（MCP 配置模板插值，非 HTTP header 过滤）：headers 允许敏感 env/user_config，command/args/cwd/url 禁止；`user_config.*.sensitive` 未开 allowSensitive 即抛错（真值 `AC@4146180` ≈ 我方 `adapters/src/plugins/mcp.ts:220-320`，含 220/254/316 的 true/false 位点一一对应）。
- WebFetch 预批：82 个域名集合逐项 diff 为空；路径前缀表 4 项（wordpress.org `/documentation`、huggingface.co/kaggle/vercel `/docs`）一致（真值 `cLe/qQs@5091k` ≈ 我方 `core/src/tool/webfetch-preapproved.ts:86`）。

## §5 bypassPermissions/yolo 与模式联动

- 主链 `mode==="yolo" && !planEnabled → allow "mode.yolo"`，且 yolo 先于 disallowedTools——两侧同序（同为有意行为）。`auto` 保留未实现 deny，两侧一致。
- 配置文件 `permission` schema 逐字段相同：mode 五值 `plan/build/edit/yolo/auto` + allowedTools/disallowedTools/autoApproveHighRisk/allowMediumRiskInAuto（真值 `z6s@4080658` ≈ 我方 `adapters/src/config/schema.ts:13-19`）。

**REAL-GAP 如下（§6）。**

## §6 差集三分类

| ID | 分类 | 级别 | 差异 | 真值证据 | 我方证据 | 影响 |
| --- | --- | --- | --- | --- | --- | --- |
| RG-1 | REAL-GAP | P2 | agent profile `permissionMode` 合法集仅 `auto\|plan`，缺 `bypassPermissions/dontAsk→yolo`、`acceptEdits→edit` 映射；真值 6 值集合并归一 | `dpa=new Set([...6 值...])@7587711`、`Txa=resolveSubagentPermissionMode@12917625`（case bypass/dontAsk→yolo、acceptEdits→edit） | `core/src/subagent/profile.ts:16`（`VALID_PERMISSION_MODES={auto,plan}`）、`core/src/runtime/methods/subagent.ts:478-488` | 非探索子代理声明 `bypassPermissions/dontAsk` 时真值跑 yolo、我方静默丢弃回退父模式（我方更保守；行为面不一致） |
| RG-2 | REAL-GAP | P2 | automation（cron 任务）模式 wire 枚举与归一：真值接受 `dontAsk/bypassPermissions→yolo`、`default→build`；我方 schema 直接拒收 | `uYa@14453515`（归一）、`dzi=10 值枚举@804546` | `bootstrap/src/drora-protocol/automation-port.ts:225-244`（default 分支 never）、`packages/shared/src/drora-task-mode-schema.ts:6`（6 值闭集） | 配置了 dontAsk/bypassPermissions/default 的定时任务在我方 wire 层校验失败，真值可归一运行 |
| SD-1 | SHAPE-DIFF | P3 | `DroraPermissionOption.kind`、`DroraPermissionRequest.kind` 建模为开集 `string`；真值为内部闭集常量（allow_once/allow_session/allow_always/deny/custom） | `Gbe="allow_session"` 等常量@14196753 | `packages/shared/src/drora-task-types-core.ts:620,645` | 产出值完全兼容，仅类型面偏松（拼写错无编译期拦截） |

EXTRA（我方多出）：**0 项** —— canUseTool、flag、schema 字段均未发现真值不存在的权限面。

## §7 OPEN-QUESTION

1. bash 命令注册表数据表（我方 `generated/bash-command-registry.ts` 1.9MB ≈ 真值 `smt`）逻辑一致但**数据未逐条对拍**，存在生成物漂移可能；建议另行脚本化 diff。
2. `permissionTimeoutMs` 双方运行时均无缺省值；桌面/TUI 上层是否注入默认超时未在本次域内取证。
3. 真值 agent profile 还接受字面 `default`（Txa `default/undefined → explore?yolo:fallback`）；我方未收。归入 RG-1 还是单列，待产品确认目标语义。
4. 历史基线"权限卡 a11y press 边界"属 GUI 层，不在本 CLI 域取证范围，未重测。
