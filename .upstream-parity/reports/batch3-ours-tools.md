# Batch3（我方）CLI 内置工具系统清单

调研对象：`apps/drora-cli/packages/`（core / contracts / bootstrap / shared）。
对比基线：官方 ZCode v3.15.1 源码（`specs/upstream-v3.15.1-migration.md` 固定基线 `aac4755…`）；本机对比 bundle 为 3.14.3（旧于对齐基线）。
方法：只读 grep + 源码阅读。除本报告外无文件改动。所有路径均相对 `apps/drora-cli/packages/`，标注为 `文件:行`。

---

## 1. 工具注册体系

- 注册表：`core/src/tool/registry.ts:30`（`ToolRegistryImpl`），支持 alias（canonical 优先、冲突拒绝，`registry.ts:34-71`）；`toContracts()`（`registry.ts:104-129`）过滤 `providerVisible !== false` 后投影为 `ModelToolContract`，并把 `metadata.modelInstructions` 追加为 provider 描述的 "Usage:" 段（`registry.ts:132-139`）。
- 内置工具清单：`core/src/tool/handlers/index.ts:79-148`（`builtInTools` 数组）。
- 装配：`registerBuiltInTools`（`handlers/index.ts:214-291`）按门控过滤注册；`resolveBuiltInToolEntryForBranch`（`handlers/index.ts:293-330`）为 Bash/Agent/Task/EnterPlanMode/js/submit_result 生成带分支描述的实例。
- MCP 工具：`core/src/mcp/index.ts:86`（`registerMcpTools`），回合边界增量刷新 `core/src/runtime/methods/mcp.ts:203`（`refreshMcpToolsIfChanged`）。

## 2. 内置工具全名单

"标记"列格式：readOnly / destructive / concurrentSafe / needsApproval / permission 名。除注明外均出自各 handler 的 `metadata`+`permission` 字段（行号为 entry 定义处）。

### 2.1 常开（无门控）

| 工具 | 定义位置（name 行） | input schema（contracts/src/tools/） | 标记 |
| --- | --- | --- | --- |
| Read | `core/src/tool/handlers/read.ts:468` | read.ts:65 `file_path, offset?, limit?, pages?（PDF）` | true/false/true/false；`read`（read.ts:492）；maxOutput 256KB（read.ts:19） |
| Write | `write.ts:214` | write.ts:15 `file_path, content` | false/false/false/true；`edit`（write.ts:232） |
| Edit | `edit.ts:257` | edit.ts:18 `file_path, old_string, new_string, replace_all?` | false/false/false/true；`edit`（edit.ts:275） |
| Bash | `bash.ts:495` | bash.ts:34 `command, timeout?, description?, run_in_background?, dangerouslyDisableSandbox?` | false/false/false/true；`bash`（bash.ts:517）；只读命令判定 `bash-readonly-policy*.ts` |
| Glob | `glob.ts:87` | glob.ts:14 `pattern, path?` | true/false/true/false；`read`（glob.ts:105） |
| Grep | `grep.ts:143` | grep.ts:22 `pattern, path?, glob?, output_mode?, -A/-B/-C/-n?…` | true/false/true/false；`read`（grep.ts:161） |
| WebFetch | `webfetch.ts:199` | webfetch.ts:13 `url, prompt` | true/false/true/true；`webfetch`（webfetch.ts:217） |
| WebSearch | `websearch.ts:132` | `query, allowed_domains?, blocked_domains?` | true/false/true/false；provider 原生变体 `web_search`（websearch.ts:157-172，仅内部用） |
| TodoRead | `todo.ts:77` | todo.ts:34 `{}`（strict） | true/false/true/false；`todo.read` |
| TodoWrite | `todo.ts:134` | todo.ts:26 `todos[]`（content/status/priority） | true/false/false/false；`todo.write`（注意 metadata.readOnly=true） |
| EnterPlanMode | `plan-mode.ts:110` | plan-mode.ts（contracts）`{}+可选分支说明` | false/false/false/false |
| ExitPlanMode | `plan-mode.ts:157` | 同上 | false/false/false/true |
| AskUserQuestion | `ask-user-question.ts:76` | ask-user-question.ts `questions[]：question, header, options(2-4), multiSelect?, annotations?` | true/false/true/true；`userInteraction.askQuestion` |
| Skill | `skill.ts:104` | skill.ts:9 `skill, args?`（兼容旧 `name`，union 归一） | true（标记）/…/false；`skill`（skill.ts:139） |
| TaskOutput | `task-output.ts:91` | task-output.ts:27 `task_id, block=true, timeout=30000` | true/false/true/false；`taskOutput` |
| TaskStop | `task-stop.ts`（TASK_STOP_TOOL_NAME，contracts task-stop.ts:4） | task-stop.ts:8 `task_id?, shell_id?(deprecated)` | ；`backgroundTask.stop`（task-stop.ts:118） |
| ReadSessionContext | `read-session-context.ts:163` | read-session-context.ts:16 `sessionId?, query, strategy?(relevant/handoff/topic), cursor?, attachment?, maxTokens?` | ；`session.context.read`（read-session-context.ts:191） |
| ReplyToChannel | `reply-to-channel.ts:54` | `parts[]`（text/mention/mentionName + candidateRef） | ；`channel.reply`（reply-to-channel.ts:122）；已有授权会话有预批规则（permission/service.ts:195-210） |
| Agent | `agent.ts:217`（描述构建 `agent.ts:90-119`） | contracts/tools/agent.ts:18 `description, prompt, subagent_type?, run_in_background?` | true/false/true/false；`subagent`（agent.ts:236-246，needsApproval=false）；超时 kind:none（agent.ts:260）；预算 120KB artifact（agent.ts:20,247） |
| Task | `agent.ts:280`（= Agent 的 Claude Code 兼容别名，`providerVisible:false`） | 同 Agent | 同 Agent |

### 2.2 门控注册（includeXxx，见 handlers/index.ts:236-284）

| 工具 | 门控 | 定义 | 权限名 |
| --- | --- | --- | --- |
| CronCreate / CronList / CronUpdate / CronDelete | includeAutomation | `cron.ts:189/253/297/349` | create/update needsApproval=true；list `automation.read`（cron.ts:270） |
| OffPeakCreate / OffPeakList | includeOffPeak | `off-peak.ts:186/237` | create true；list `offpeak.read` |
| VaultSearch | includeVaultSearch（VaultSearchPort 注入，handlers/index.ts:97-99 注释） | `vault-search.ts:59`；schema `query(1-512)`（contracts/tools/vault-search.ts:17-22） | `vault.read` |
| SendMessage | includeSendMessage | `send-message.ts:88`；schema `to, summary, content`（contracts/tools/send-message.ts:9-23） | `agent.message.send` |
| RespondToCoordinator | includeRespondToCoordinator | `respond-to-coordinator.ts`（contracts tools/respond-to-coordinator.ts:4） | `agent.message.respond` |
| submit_result | includeSubmitResult（+可选 typed schema） | `submit-result.ts`（contracts tools/submit-result.ts:11 名为小写 `submit_result`） | `workflow.submitResult`；concurrentSafe=false 串行组（submit-result.ts:87-90）；timeout kind:none |
| escalate | includeEscalate | `escalate.ts:98` | `workflow.escalate`；timeout kind:none |
| js（node_repl） | includeNodeRepl（官方 browser-use 插件启用，handlers/index.ts:204-205） | `node-repl.ts:370`；schema contracts/tools/node-repl.ts:7 `code, timeout_ms?, title` | `node_repl`（node-repl.ts:387） |

### 2.3 动态工作流灰度门（includeDynamicWorkflow，显式 false 才下架；handlers/index.ts:158-170）

11 个：CreateWorkflow、AmendWorkflow、SaveWorkflow、ListSavedWorkflows、ListModels、EvalWorkflowSnippet、ListWorkflowRuns、GetWorkflowRun、ResumeWorkflowRun、ResolveWorkflowQuestion、FillWorkflowHole（名字常量在 `contracts/src/tools/create-workflow.ts:13` 等）。写侧 alwaysAsk（CreateWorkflow/AmendWorkflow/SaveWorkflow/FillWorkflowHole），读侧无 gate。**版本差：见 §6。**

### 2.4 其余非 builtInTools 的工具面

- Team 工具（agents-team 自研）：TeamTaskList / TeamTaskGet / TeamTaskCreate / TeamTaskClaim / TeamTaskUpdate / TeamSendMessage，`core/src/team/team-tools.ts:134/155/173/224/250/307`，由成员 runtime 自建注册表注入（member-runtime.ts:205），不走 builtInTools。
- MCP 工具：见 §5。
- 已定义未注册：ApplyPatch（`handlers/apply-patch.ts`，在 builtInTools 中被注释，handlers/index.ts:83；hook 别名 ApplyPatch→Write/Edit 见 `core/src/tool/compat.ts:9`）；GoalRead（`handlers/target.ts:29` targetReadToolEntry，未入 builtInTools）；provider 原生 `web_search`（websearch.ts:157，仅作为 provider 内部转发，非模型可见注册项）；旧 `Workflow` 工具（handlers/workflow.ts，import 已注释 handlers/index.ts:73,147）。

## 3. subagent 工具命名与 agent 类型机制

- **主名是 `Agent`，`Task` 是别名**：`core/src/tool/compat.ts:1-2`（`AGENT_TOOL_NAME="Agent"`、`TASK_TOOL_NAME="Task"`）。两者都注册（handlers/index.ts:115-116），但 Task `providerVisible:false`（agent.ts:286）且描述整段内嵌 Agent 描述（agent.ts:287-292）——即 provider 契约里只见 Agent；Task 仅承接显式点名"Task 工具"的插件指令。`isSubagentDispatchToolName` 对两者等价（compat.ts:12-14）；hook matcher 互为别名（compat.ts:6-10）。注册门：includeAgent 未开则两者都不注册（handlers/index.ts:236-238）。
- **输入 schema**（`contracts/src/tools/agent.ts:18-33`）：`description`（3-5 词）、`prompt`、`subagent_type?`、`run_in_background?`。有意不暴露调用级 model（agent.ts:25-27 注释：模型 override 由 Settings/Markdown profile 统一决定）。输出 oneOf completed / async_launched（agent.ts:22-81 + 94-107）。
- **agent 类型来源**：
  1. 内置两个：`general-purpose`（`core/src/subagent/general-purpose.ts:5`，tools `*`，injectAgentsMd=true）与 `Explore`（`explore.ts:5`，只读，tools `["Bash","Glob","Grep","Read","WebFetch","WebSearch","TodoWrite"]`，`profile.ts:39-52`）；`normalizeAgentProfiles`（`profile.ts:74-100`）合并内置+外部 profile，同名覆盖内置（内置 Explore 同名覆盖保护 `profile.ts:54-60`）。
  2. Markdown profile：用户级 `<storageRoot>/agents`、项目级 `.drora/agents/`（`bootstrap/src/subagents.ts:54-55`），frontmatter 解析 `packages/shared/src/subagent-profile-parser.ts:33`（name/description/tools/model/permissionMode/memory；项目级 profile 不允许 permissionMode，parser:64）。
  3. 插件 agents：`<plugin>/agents/*.md`（`bootstrap/src/subagents.ts:100-103`）。
  - 类型清单经 system-reminder 增量下发：`core/src/subagent/listing.ts:5-19`（"Available agent types for the Agent tool:" + delta added/removed + 并发提示）。
- **与官方 3.14 Agent/Task 的关系**：输入 schema 与官方 Agent 工具同构（description/prompt/subagent_type/run_in_background），Task 别名保证官方/CC 风格插件指令可用——属**对齐 + 兼容扩展**。`.drora/agents/*.md` frontmatter 机制是 Drora 扩展的 profile 化（官方 3.14.3 是内置 agent 定义；本项目以文件定义替代），agents-team（`specs/agents-team.md:18-19`）经穷尽 grep 证实官方 3.14.3/3.15.1 均无 team 协议面，属**纯自研增量**（teammate 复用 `subagent_child` taskType，工具面 TeamTask*/TeamSendMessage 为自建注册表）。

## 4. 权限检查链

- **模式定义**：`CollaborationMode = "plan" | "build" | "edit" | "yolo" | "guarded" | "auto"`（`contracts/src/interfaces/session.port.ts:36`）；guarded 父模式对子 yolo 的收紧 `inheritPermissionMode`（session.port.ts:41-43）。官方风格名（default/acceptEdits/dontAsk/bypassPermissions/autoEdit）只在协议入口归一映射为内部模式：cron automation `bootstrap/src/drora-protocol/automation-port.ts:233-253`（acceptEdits/default→build，bypassPermissions/dontAsk→yolo）；`bootstrap/dist/subagent-runtime-config.d.ts:56` 类型面接受官方名。
- **判定链主函数**：`PermissionService.checkPermission`（`core/src/permission/service.ts:96-267`）。顺序：plan-mode transition（plan-mode-policy）→ requiresUserInteraction ask → Plan 优先于 Guarded 的 userApprovalRule（user-once，service.ts:152-160）→ alwaysAsk `checkAlwaysAsk`（service.ts:164）→ `mode=yolo/guarded`（非 plan）直接 allow（service.ts:167-169）→ `mode=auto` 保留 deny 未实现（service.ts:171-177）→ disallowedTools deny → 项目规则 deny/ask（`matchesProjectRules`，service.ts:269+；P0 写向量 allow 规则不匹配的 S03 不变量，service.ts:322-343；Bash 内容级评估器走 rulePolicy.evaluateRules，service.ts:278-284）→ ReplyToChannel 预批（service.ts:195-210）→ plan `checkPlanMode` → 项目 allow → WebFetch 预批 URL（`core/src/tool/webfetch-preapproved.ts`）→ workflow 草稿免确认（`core/src/permission/workflow-draft-path.ts`）→ allowedTools 放行（P0 写目标除外，`write-tier-policy.ts` isP0WriteTarget）→ `checkEditMode` / `checkBuildMode` 兜底。
- **调用点**：`resolveToolPermission`（`core/src/tool/executor/permission-flow.ts:44-341`）——加载项目规则（:64）→ 循环内 `checkPermission`（:98-112）→ PreToolUse hook 决议叠加（`applyPreToolPermissionDecision`，:113-115）→ memory 文件规则（:117-124）→ deny/ask 分支；ask 时 `resolveToolApproval`（approval-gate.ts）决定弹窗，`requestPermissionResponse`（permission-request.ts）→ broker：`ManualPermissionBroker` / `DenyPermissionBroker`（`core/src/permission/broker.ts:18,27`）→ `interpretPermissionResponse`（permission-response.ts）→ hook modify 输入重判 `recheckPermissionHookModifiedInput`（permission-input-recheck.ts）→ `applyGrantedPermissionUpdates` 持久化（permission-rules-persistence.ts）。guarded 模式下输入在权限前深快照（call-runner.ts:311 `snapshotPermissionInput`）。
- **Hooks**：事件名定义 `contracts/src/hooks/index.ts:10-13`（PreToolUse/PostToolUse/PostToolUseFailure 等）、信任门 `contracts/src/hooks/workspace-hook-trust.ts:12-15,191-194`。调用点全在 `core/src/tool/executor/`：PreToolUse 在权限之前（call-runner.ts:252，`hook-flow.ts:16`；deny → `source:"hook.PreToolUse"` 错误，call-runner.ts:259-273）；hook 改写输入后重新校验（call-runner.ts:282-306）；PostToolUse 在 serializeOutput 之后（call-runner.ts:503，`hook-flow.ts:125`）；PostToolUseFailure（call-runner.ts:593，`hook-flow.ts:159`）。

## 5. MCP 工具

- **命名物化**：`mcp__<server>__<tool>`，非法字符清洗为 `_`，空段落 `unknown`（`core/src/mcp/name.ts:3-17`）。官方 CUA server 经 authority 验证后投影规范主名 `mcp__computer-use__*` 并挂 provider 拼写别名（`mcp/index.ts:57-58,113-121,145-158`），deny/allow 规则新旧名都匹配（index.ts:99-105）。
- **权限**：`permission:"mcp"`，needsApproval 恒 true（index.ts:165,208-216）；`readOnlyHint/destructiveHint` 是服务端自报，只作展示，不降低第三方 MCP 风险档（index.ts:138-148，specs/agent-write-safety.md §5 口径）；宿主 node_repl `js` sideEffectScope=system、risk=high（index.ts:132-133）；allowedTools 命中普通 MCP 的整工具 allow 不生效（permission/service.ts:322-343）。
- **超时**：默认 30s（`MCP_TOOL_TIMEOUT_MS`，mcp/index.ts:45），descriptor.timeoutMs 可覆盖，`allowCallOverride:false`（index.ts:218-221）。
- **结果预算**：普通 MCP maxInline 100KB / maxModel 50KB truncate head；node_repl js artifact 策略（1MB inline / 64KB model tail）；官方 CUA 256KB 且受 `modelContentProtection` 原子帧保护（index.ts:167-191 + call-runner.ts:488-495）。

## 6. 执行管线（顺序）

1. **输入 admission**：v4 协议 command → `CommandInbox.handle`（`bootstrap/src/drora-protocol-v4/command-inbox.ts:102`）：in-flight/live/settled 三态分离（:20-28 注释），per-session FIFO `AsyncGateRegistry` 串行 gate（:76-101），CAS 校验 epoch+revision（:41-45），`admissionSeq` 为权威顺序，执行完 `settle` 才释放 gate（:66-69）。gateway 装配 `v4-gateway.ts:624,673`。
2. **模型流式请求**：`executeTurn`（`runtime/methods/turn.ts:81`）→ `runRegularTurnLoop`（turn-loop.ts:44）→ `runModelBackedTurnStep`（turn-model-step.ts:94）→ `runModelTextRequest`（methods/model.ts:35，媒体投影/预算在请求前完成）。
3. **流中执行**：`createStreamingToolCoordinator`（streaming-tool-coordinator.ts:43）——`modelStreaming:"on"` 且工具满足 `readOnly && concurrentSafe && !destructive && !needsApproval && !requiresUserInteraction && sideEffectScope==="none"` 才流中执行（:362-385）。
4. **工具解析与调度**：`executeToolCallsForModelStep`（turn-tools.ts:30，含流中结果合并）→ `scheduleTools`（methods/tools.ts:38）→ `ToolScheduler.schedule`（`core/src/tool/scheduler.ts:60-83`）：拓扑排序 + 按依赖分层并行分组，`DEFAULT_MAX_CONCURRENCY=10`（scheduler.ts:48），READ_ONLY_TOOLS 基线集（scheduler.ts:233-243）；并行组执行 `executeToolBatch`（executor/batch-runner.ts:24-40，组内 Promise.all、maxConcurrency 分批）。
5. **单工具执行**：`executeToolCall`（executor/call-runner.ts:66；别名归一到 canonical :77-79）→ 初始 schema 校验（:201-214）→ 工具语义校验 validateInput（:217-233）→ `resolveInput` 归一为"执行事实"（:235-257，刻意在 hook 前）→ PreToolUse hooks（:252）→ guarded 输入快照（:311）→ `resolveToolPermission`（:312）→ `emitToolCallStarted`（:359）→ `executeWithTimeout` 执行 handler（:491-493）→ `validateOutput`（:488）→ `serializeOutput`（resultBudget 截断/落 artifact，:494；截断后缀 `result-serialization.ts:201`）→ PostToolUse hooks（:503）→ display/telemetry → `emitToolCallResult`。
6. **子代理**：Agent handler → `context.subagentPort.launch`（agent.ts:204-214）→ `createExploreSubagentPort`/通用 port（`core/src/subagent/runner.ts:133,144-173`）→ 子 runtime；后台 run_in_background 返回 async_launched + outputFile（agent.ts:146-164）。

## 7. 版本差标注（官方 3.14.3 没有、3.15.1 有——不算 gap）

依据 `specs/upstream-v3.15.1-migration.md`（对齐基线 3.15.1，其中"Gen UI、MCP Apps、Visualize、Bot、工作流"已采用官方公开实现）：

1. **动态工作流 11 工具**（§2.3 全部）：3.15.x 官方公开实现，3.14.3 bundle 无。灰度门 `includeDynamicWorkflow` 是发行装配差异，非自研重复实现。
2. **CommandInbox v4 串行 admission**（§6.1）：迁移表"输入排队"一行明示已采用官方行为，共用单一实现（migration spec 表格第 2 行）。
3. **Task 别名 / Agent 主名**：待甄别项——官方 Claude Code 2.x 系（对应 3.15.x）以 Agent 为主名、Task 为兼容别名；3.14.3 bundle 大概率只认 Task。对拍 bundle 时注意 providerVisible=false 的 Task 不入 provider 契约，属我方兼容层。

## 8. 疑点 / 待对拍

- `TodoWrite`/`Skill` 的 `metadata.readOnly=true`（todo.ts:140、skill.ts:108 附近）与官方对这类工具的标记口径需对拍（skill 实际会执行外部内容）。
- `GoalRead`（target.ts:29）与 `ApplyPatch`（handlers/apply-patch.ts）已实现但未入 builtInTools：确认是官方同款休眠资产还是自研残留。
- `web_search`（provider 原生）与 `WebSearch` 的关系、以及 `normalizeToolNameAlias`（tool/tool-visibility.ts:1-3）把 web_search 归一为 WebSearch 的规则覆盖面，需与 3.14.3 bundle 的 provider-native search 对拍。
- 官方 3.14.3 bundle 侧的同类清单见 batch3 官方报告；本报告的"版本差"结论以 bundle 字面量对齐脚本 `scripts/check-bundle-key-parity.mjs` 复核为准。
