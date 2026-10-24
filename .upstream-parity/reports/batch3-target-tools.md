# 批次 3：官方 bundle 内置工具（tool）系统完整调研

来源：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 字节，esbuild bundle）。
全部结论来自本仓批次 3 只读 grep / `tail -c +<offset>` 切片，字节偏移为文件内绝对偏移。
仅品牌改名注意：bundle 内字符串多为 "ZCode"，与 Drora 对应。

---

## 0. 方法与关键 grep 命令

```bash
# 工具注册表定位（42 处）
grep -bo 'metadata:{name:' zcode.cjs
# 工具描述 schema（zod，G=zod 命名空间）
grep -bo 'Vrt=\|XDe=\|con=\|Brt=\|Urt=\|\$rt=\|qrt=\|Wrt=\|Krt=\|Jrt=\|Vhe=\|rot=\|oot=\|yon=\|fEr=\|Grt=\|not=\|tot='
# 命名函数清单（全文件 21154 处 r(fn,"name") 注册）
grep -o 'r([A-Za-z_$]*,"[^"]*[Tt]ool[A-Za-z]*")'
grep -o 'r([A-Za-z_$]*,"[^"]*[Pp]ermission[A-Za-z]*")'
grep -o 'r([A-Za-z_$]*,"[^"]*[Hh]ook[A-Za-z]*")'
```

工具定义统一形态（以 Bash @7446609 为例）：

```
{capability:"...", metadata:{name,description,readOnly,destructive,concurrentSafe,timeoutMs,
 maxOutputBytes,sideEffectScope,riskLevel,needsApproval}, handler, formatModelContent,
 inputSchema, outputSchema, runtimeInputSchema, runtimeOutputSchema,
 permission:{permission,reason,riskLevel,sideEffectScope,needsApproval,patternSources,
 alwaysAllowPatternSources,denyPriority},
 resultBudget:{maxInlineBytes,maxModelBytes,strategy:"artifact"|"truncate",preview,artifact},
 timeout:{defaultMs,maxMs,allowCallOverride,cleanupGraceMs|kind:"none"},
 cancellation:{supported,cleanup,userVisibleMessage},
 trace:{required,propagateToAdapters,recordInput,recordOutput}}
```

注意：官方**没有** `checkPermissions`/`isConcurrencySafe`/`canUseTool`（计数 0），对应物是
`needsApproval` / `concurrentSafe` / `readOnly` / `destructive` / `permissionService.checkPermission`。

---

## 1. 工具全清单（注册表 `dCn` @12702767，42 项 / 41 个名字）

注册入口 `Ise`=registerBuiltInTools @12700876，条件开关：
`includeAgent`(Agent+Task)、`includeSkill`(默认开)、`includeSendMessage`(默认关)、
`includeRespondToCoordinator`(默认关)、`includeSubmitResult`(默认关)、`includeEscalate`(默认关)、
`includeWorkflow`(默认关)、`includeAutomation`(Cron*，默认关)、`includeOffPeak`(默认关)、
`includeNodeRepl`(js，默认关)、`includeDynamicWorkflow`(动态工作流族默认开)、
`embeddedSearchEnabled`(开启时跳过 Glob/Grep)。

| # | 工具名 | 偏移 | 权限键 permission | readOnly | concurrentSafe | destructive | sideEffectScope | riskLevel | needsApproval | 默认注册 |
|---|--------|------|------------------|----------|----------------|-------------|-----------------|-----------|---------------|----------|
| 1 | Read | 5239290 | read | 1 | 1 | 0 | none | low | 0 | 开 |
| 2 | Write | 7334397 | edit | 0 | 0 | 0 | workspace | medium | 1 | 开 |
| 3 | Edit | 7349039 | edit | 0 | 0 | 0 | workspace | medium | 1 | 开 |
| 4 | Bash | 7446609 | bash | 0 | 0 | 0 | system | high | 1 | 开 |
| 5 | Glob | 7668834 | read | 1 | 1 | 0 | none | low | 0 | 开 |
| 6 | Grep | 7673092 | read | 1 | 1 | 0 | none | low | 0 | 开 |
| 7 | WebFetch | 7702617 | webfetch | 1 | 1 | 0 | network | medium | 1 | 开 |
| 8 | WebSearch | 7709504 | (继承 _Er，network) | 1 | 1 | 0 | network | low | 0 | 开 |
| 9 | Agent | 7715811 | subagent | 1 | 1 | 0 | session | low | 0 | includeAgent |
| 10 | Task | (Agent 别名) | subagent | 1 | 1 | 0 | session | low | 0 | providerVisible:!1 |
| 11 | Skill | 7718556 | skill | - | - | - | - | - | - | 开 |
| 12 | TodoRead | 7721816 | todo.read | 1 | 1 | 0 | none | low | 0 | 开 |
| 13 | TodoWrite | 7722833 | todo.write | 0 | 0 | 0 | session | low | 0 | 开 |
| 14 | CronCreate | 7726384 | (cron) | 0 | - | - | - | - | 1 | 关 |
| 15 | CronList | 7730408 | (cron) | 1 | 1 | 0 | none | low | 0 | 关 |
| 16 | CronUpdate | 7731299 | (cron) | - | - | - | - | - | - | 关 |
| 17 | CronDelete | 7733813 | (cron) | 0 | 0 | 1 | workspace | medium | 1 | 关 |
| 18 | OffPeakCreate | 7737514 | (offpeak) | 0 | - | - | - | - | 1 | 关 |
| 19 | OffPeakList | 7740314 | (offpeak) | 1 | 1 | 0 | none | low | 0 | 关 |
| 20 | EnterPlanMode | 7752204 | plan.enter（Wxo 工厂，needsApproval:!1） | 0 | 0 | 0 | session | low | 0 | 开 |
| 21 | ExitPlanMode | 7752917 | plan.exit | 0 | 0 | 0 | session | low | 1 | 开 |
| 22 | AskUserQuestion | 7757111 | userInteraction.askQuestion | 1 | 1 | 0 | userInteraction | low | 1 | 开 |
| 23 | SendMessage | 7760178 | agent.message.send | 0 | 1 | 0 | session | low | 0 | 关 |
| 24 | RespondToCoordinator | 7762373 | agent.message.respond | - | - | - | - | - | - | 关 |
| 25 | submit_result | 7764160 | (workflow) | 0 | 0 | - | - | - | - | 关 |
| 26 | escalate | 7768638 | (workflow) | 0 | 1 | 0 | session | low | 0 | 关 |
| 27 | TaskOutput | 12606280 | (task) | 1 | 1 | 0 | none | low | 0 | 开 |
| 28 | TaskStop | 12609376 | (task) | 0 | 1 | 0 | session | low | 0 | 开 |
| 29 | ReadSessionContext | 12629536 | (topic) | 1 | 1 | 0 | none | low | 0 | 开 |
| 30 | ReplyToChannel | 5218753 | channel.reply（特判预批准，见 §3） | - | - | - | network | medium | 0 | 开 |
| 31 | CreateWorkflow | 12582562 | (workflow) | 0 | 1 | 0 | none | low | 1 | 动态族默认开 |
| 32 | FillWorkflowHole | 12597558 | (workflow) | 0 | 1 | 0 | none | low | 1 | 动态族默认开 |
| 33 | AmendWorkflow | 12648109 | (workflow) | 0 | 1 | 0 | none | low | 1 | 动态族默认开 |
| 34 | SaveWorkflow | 12653099 | (workflow) | 0 | 0 | 0 | workspace | medium | 1 | 动态族默认开 |
| 35 | ListSavedWorkflows | 12656542 | (workflow) | 1 | 1 | 0 | none | low | 0 | 动态族默认开 |
| 36 | ListModels | 12660321 | (model) | 1 | 1 | 0 | none | low | 0 | 动态族默认开 |
| 37 | EvalWorkflowSnippet | 12664943 | (workflow) | 0 | 1 | 0 | workspace | low | 1 | 动态族默认开 |
| 38 | ListWorkflowRuns | 12669827 | (workflow) | 1 | 1 | 0 | none | low | 0 | 动态族默认开 |
| 39 | GetWorkflowRun | 12693217 | (workflow) | 1 | 1 | 0 | none | low | 0 | 动态族默认开 |
| 40 | ResumeWorkflowRun | 12699292 | (workflow) | 0 | 1 | 0 | none | low | 0 | 动态族默认开 |
| 41 | ResolveWorkflowQuestion | 7772189 | (workflow) | 0 | 1 | 0 | none | low | 0 | 动态族默认开 |
| 42 | js | 7666555 | (node_repl 特判 high) | 0 | 0 | 0 | system | high | 1 | 关 |

动态工作流族集合 `dRo` @12702840：CreateWorkflow(cy), AmendWorkflow(W0), SaveWorkflow(ure),
ListSavedWorkflows(ige), ListModels(age), EvalWorkflowSnippet(pre), ListWorkflowRuns(nge),
GetWorkflowRun(uge), ResumeWorkflowRun(X3), ResolveWorkflowQuestion(lG), FillWorkflowHole(_M)。

工具族分类表 `Sds` @1001890（subagent 投影用）：
Read:file-read, Write/Edit/ApplyPatch:file-write, Bash:shell, Glob/Grep/WebFetch/WebSearch/web_search:search,
TodoRead/TodoWrite:todo, GoalRead:goal, ReadSessionContext:session-context, AskUserQuestion:ask-user-question,
SendMessage/RespondToCoordinator:message, TaskOutput/TaskStop:task-control, js/js_reset/js_add_node_module_dir:node-repl,
Agent/Task:agent, Skill:skill, CreateWorkflow/AmendWorkflow/FillWorkflowHole/submit_result:workflow。
仅出现在族表、无内置注册表条目的名字：`ApplyPatch`、`GoalRead`、`js_reset`、`js_add_node_module_dir`、`web_search`（兼容名/保留名/provider 内生名）。

"Memory"(@4987717)与"Skills"(@4942597)不是工具，是 system/meta_user 上下文注入块（source:"memory"/"skills"）。

---

## 2. 各工具 input schema（zod `G.object`，`runtimeInputSchema` 为准）

### Read（`con` ← `D1r.superRefine(f_s)`，D1r 定义在 D1r= 附近 @~1400215）
- file_path: string（absolute path to the file to read）
- offset: number（The line number to start reading from）
- limit: number（The number of lines to read）
- pages: string（PDF 页范围，e.g. "1-5"）（由 superRefine(f_s) = validateReadInputSemantics 做语义校验）
输出 g_s：{type:"text", filePath, content, numLines, startLine, totalLines, sizeBytes?, bytesRead?, truncated?, truncatedByTokenCap?, partialViewNotice?}

### Write（`Brt` @1404123）
- file_path: string — "The absolute path to the file to write (must be absolute, not relative)" (required)
- content: string — "The content to write to the file" (required)

### Edit（`Urt` @1405343）
- file_path: string — "The absolute path to the file to modify" (required)
- old_string: string — "The text to replace" (required)
- new_string: string — "The text to replace it with (must be different from old_string)" (required)
- replace_all: boolean, default false — "Replace all occurrences of old_string (default false)"

### Bash（`XDe` @1408530）
- command: string — "The command to execute" (required)
- timeout: number optional（semantic number, 字符串数字也接受）— "Optional timeout in milliseconds (max 600000)"
- description: string optional — 简短命令描述
- run_in_background: boolean optional — "Set to true to run this command in the background."
- dangerouslyDisableSandbox: boolean optional — "Set this to true to dangerously override sandbox mode and run commands without sandboxing."
超时配置 `v8` @7439698：defaultTimeoutMs=12e4(2min)，maxTimeoutMs=6e5(10min)；maxOutputBytes=1e7；
resultBudget{maxInlineBytes:3e4, maxModelBytes:3e4, strategy:"artifact", preview tail, artifact session}；
timeout.allowCallOverride:!0，cleanupGraceMs:6e3；cancellation.cleanup:"bestEffort"。
输出 `tG`：stdout/stderr/status(completed|failed|timed_out|cancelled|spawn_error|backgrounded)/exitCode/signal/
timedOut/cancelled/stdoutTruncated/stderrBytes.../backgroundTaskId/dangerouslyDisableSandbox/persistedOutputPath 等。

### Glob（`$rt` @1411633）
- pattern: string — "The glob pattern to match files against" (required)
- path: string optional — 默认 cwd；"DO NOT enter \"undefined\" or \"null\" - simply omit it"
描述 sTa："Fast file pattern matching. Supports glob patterns like \"**/*.js\"... sorted by modification time."

### Grep（`qrt` @1412267）
- pattern: string (required) — "The regular expression pattern to search for in file contents"
- path: string optional — "File or directory to search in (rg PATH). Defaults to current working directory."
- glob: string optional — 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob'
- output_mode: enum(content|files_with_matches|count) optional, 默认 files_with_matches
- -B/-A/-C/context: number optional；-n: boolean（默认 true）；-i: boolean；-o: boolean；head_limit: number
描述 uTa："Content search built on ripgrep. Prefer this over `grep`/`rg` via Bash — results integrate with the permission UI and file links."

### WebFetch（`Wrt` @1415296）
- url: string.url (required) — "The URL to fetch content from"
- prompt: string (required) — "The prompt to run on the fetched content"
metadata：timeoutMs=6e4(allowCallOverride:!1)，maxOutputBytes=1e5，strategy artifact。
输出 `_on`：{url, finalUrl, status, statusText, contentType, bytes, durationMs, result, cacheHit, redirects[], artifactUri?, artifactPath?, truncated}

### WebSearch（`fEr` @1442429 + extend `mEr`）
- query: string min 2 (required) — "The search query to use"
- allowed_domains: string[] optional — "Only include search results from these domains"
- blocked_domains: string[] optional — "Never include search results from these domains"
- maxUses: number 1..yys optional（runtime 版）— provider-native 搜索次数；allowed/blocked 互斥 refine
描述为动态 getter `_Ia()`（按 provider 是否支持 native web search 变化）。

### Agent（`Vrt` @1416070；描述 `mxo`=buildAgentProviderDescription @~7714000，按 provider 动态生成）
- description: string (required) — "A short (3-5 word) description of the task"
- prompt: string (required) — "The task for the agent to perform"
- subagent_type: string optional — "The type of specialized agent to use for this task"
- run_in_background: boolean optional — "Set to true to run this agent in the background. You will be notified when it completes."
输出：completed{status, agentId, agentType, description, prompt, content[{type:"text",text}], totalToolUseCount, totalDurationMs, totalTokens?, usage?}
| async_launched{status:"async_launched", isAsync:true, agentId, agentType, description, prompt, childSessionId, backgroundTaskId, outputFile, canReadOutputFile}
诊断码 `z7`：SUBAGENT_UNAVAILABLE:"agent_subagent_unavailable", BACKGROUND_UNAVAILABLE:"agent_background_unavailable", UNKNOWN_AGENT_TYPE:"agent_unknown_type", CHILD_RUNTIME_FAILED:"agent_child_runtime_failed"。

### Skill（`yon` @1416680 附近）
- skill: string (required) — "The name of a skill from the available-skills list. Do not guess names."
- args: string optional — "Optional arguments for the skill"
（union 第二形态 {name, args} 为兼容；transform 成 {args}）。handler `RIa`=skillHandler @7717470：
skillPort.loadSkill(...) → 返回 `<skill_content name="...">` 包裹的正文 + baseDirectory；展开 `${...}` 上下文变量（DIa=expandSkillContextVariables）。

### TodoRead（`Jrt`）：空对象 {}。
### TodoWrite（`Krt` @1418394）
- todos: TodoItem[] (required) — "The complete updated todo list. At most one item may be in_progress at a time."
TodoItem `Grt` @1418044：{content: string min1 "Brief description of the task", status: enum(pending|in_progress|completed), priority: enum(high|medium|low)}

### EnterPlanMode（`tot`）：空对象 {}。输出含 previousMode/mode: enum(["plan","build","edit","yolo","guarded","auto"])。

### ExitPlanMode（`not` @1430151）
- plan: string min1 (required) — 完整计划文本（与官方 CC 相同的 plan 参数）
- allowedPrompts: [{tool: enum(["Bash"]), prompt: string}] optional — "Prompt-based permissions needed to implement the plan..."
输出 {plan, approved:true, previousMode, mode}。

### AskUserQuestion（`Vhe` @1434279）
- questions: Question[1..4] (required)；Question `zCr` @1432592：{question, header(≤12 chars), options(2..4 个 {label, description, preview?}), multiSelect(default false)}
- answers: record(string) optional — 权限组件回填
- annotations: record optional；metadata optional
superRefine 校验 option label 唯一等。

### SendMessage（`rot` @1435772）
- to: string 1..200 — "Recipient: local agent ID returned by Agent (format agent_<uuid>)."
- summary: string 1..200 — "A 5-10 word summary shown as a preview in the UI."
- message: string min1 — "Plain text message content"
输出 {status: success|failed, messageId, agentId?, delivery?: queued|steered|resumed_background, error?, ...}

### RespondToCoordinator（`oot` @1436496）
- summary: string 1..200 (required)
- message: string min1 (required)

### TaskOutput（`eOe` @1438138）
- task_id: string (required)；block: boolean default true；timeout: number 0..6e5 default 3e4

### 其余（ReadSessionContext/工作流族/Cron*/OffPeak*/escalate/submit_result/js）
- js：{code: string, timeout_ms: number ≤12e4}
- escalate：{reason/taskId 等会话升级字段}（@7768638 handler S1a）
- submit_result：经 Wyt(submitResultSchema) 工厂按 ask 注入 result schema（"Submit the structured result for the current ask"）

---

## 3. 执行管线

### 3.1 单次工具调用：`YRo`=executeToolCall @12756972 → `$Ro`=runToolCallWithTelemetry → `WOa`=executeToolCallImpl
顺序（全部带命名函数证据）：
1. registry.get(name)（`JRo`=resolveToolEntryModelContract 按 model 解析条目；未注册 → ToolNotFound `<tool_use_error>No such tool available`）。
2. `Kfo`=prepareInitialToolExecutionInput：JSON 字符串归一化 + `runtimeInputSchema.safeParse`（Zfo）。
3. `Ffo`=validateInitialModelToolInput + entry.validateInput + entry.resolveInput。
4. `agt`=runPreToolUseHooks @5100617：hookEventName:"PreToolUse"，matchValue=toolName（matcher `Cho`=matchesHookMatcher）；
   返回 {permissionBehavior:"allow"|"ask"|..., updatedInput, additionalContexts, preventContinuation, stopReason}。
   deny → 直接返回 permission denied 结果，source:"hook.PreToolUse"，不再执行。
5. `nmo`=applyPreToolPermissionDecision @5103232：hook allow → 强制 allow（ruleId:"hook.PreToolUse.allow"）；hook ask → 强制 ask。
6. guarded 模式：`pgt` 重写 input（cwd 固定工作目录）。
7. `_gt`=resolveToolPermission @5121345（权限主循环，见 3.2）。
8. `zfo`=emitToolCallStarted；超时预算 `mmo`：timeout.defaultMs ?? metadata.timeoutMs ?? runtime 默认；call 级 timeout_ms/timeout 覆盖需 timeout.allowCallOverride；上限 maxMs；+cleanupGraceMs；`hgt`=ToolDeadline（可 pause/resume，模型请求排队时暂停计时）。
9. handler 执行（注入 ports：executionPort/fileSystemPort/httpClientPort/subagentPort/skillPort/workflowPort/artifactStore/sessionStore/...，见 WOa 大对象）。
10. 结果经 resultBudget（strategy "artifact"→artifactStore 会话留存+preview；"truncate"→截断）、`HNe`=createToolModelOutput / entry.toModelOutput → 模型内容；图片压缩/文本化（`igt`）。
11. `emo`=runPostToolUseHooks（PostToolUse，带 toolResponse/toolResultPreview/artifactRefs）；失败走 `tmo`=runPostToolUseFailureHooks（PostToolUseFailure，带 error+isInterrupt）。

### 3.2 权限引擎：`iN`=PermissionService @5209600 附近（checkPermission @5110824 实体、调用点 @5121907）
主循环 `_gt`（@5121345）：
`Smo`=loadProjectPermissionRuleset（失败→StorageError deny）→ `permissionService.checkPermission(request, capability, projectRules, policy)` →
`dgt`=applyMemoryFilePermission → decision:
- allowed → 放行（permissionWaitMs 累计）
- deny → `Vfo`=emitPermissionDenied + denied 结果
- ask → `omo`=resolveToolApproval（prepareApproval 预览 gate）→ `_mo`=requestPermissionResponse（发 perm_<uuid> 请求，runHooks 时先跑 `Qfo`=runPermissionRequestHooks；hook 可 deny/allow/modify(updatedInput→重新走 umo=recheckPermissionHookModifiedInput)）→ `Wfo`=emitPermissionResolved → permissionUpdates 经 `wmo` 持久化（user-once/always-allow）→ rewrite/complete。

checkPermission 决策序（ruleId 证据）：
1. `Zho`=resolvePlanModeTransitionPermission（plan 进入/退出转换特判）
2. requiresUserInteraction → ask "tool.userInteraction"（disallowedTools 则 deny）
3. plan 模式 + guarded userApprovalRule → ask（approvalMode:"user-once"）
4. alwaysAsk → checkAlwaysAsk（session rules allow→"rule.session.allow"；AmendWorkflow/FillWorkflowHole 属主→"rule.session.workflowOwner"；否则 ask "tool.alwaysAsk"）
5. mode yolo/guarded（非 plan）→ allow "mode.yolo"（"Yolo mode bypasses permission prompts"）
6. mode auto → deny "mode.auto.unimplemented"（"Auto mode is reserved but not implemented yet"）
7. disallowedTools → deny "rule.disallowedTools"
8. project rules deny → deny "rule.project.deny"；ask → ask "rule.project.ask"
9. ReplyToChannel 特判预批准 → allow "tool.channelReply.preapproved"
10. plan 模式 → checkPlanMode：readOnly&&!destructive→allow "mode.plan.readOnly"；MCP 非破坏→allow "mode.plan.mcp"；allowedInPlanMode+session+低险→allow "mode.plan.explicitSessionCapability"；否则 deny "mode.plan.nonReadOnly"
11. project rules allow → allow "rule.project.allow"
12. WebFetch 预批准域名（`ije`=isWebFetchPreapprovedUrl，文档站白名单：huggingface.co/docs、kaggle、vercel 等）→ allow "tool.webfetch.preapproved"
13. 工作流草稿文件 → allow "tool.workflowDraft.preapproved"
14. allowedTools → allow "rule.allowedTools"
15. mode edit → checkEditMode：edit+workspace → allow "mode.edit.fileEdit"；否则 checkBuildMode
16. checkBuildMode：readOnly→allow "mode.build.readOnly"；critical→ask；high（除非 autoApproveHighRisk）→ask；session 低险→allow "mode.build.sessionState"；有副作用→ask "mode.build.sideEffect"；否则 allow "mode.build.lowRisk"

规则匹配：`matchesRuleContent` 前缀 `:*` 通配 + `*` glob（Ngt）；主体字段顺序 ["command","url","file_path","path","pattern","patch_text"]；Write 规则同时匹配 Edit（matchesRuleToolName）。

### 3.3 权限模式
外部模式集合 `kps` @1025461：{acceptEdits, auto, bypassPermissions, default, dontAsk, plan}（agent profile frontmatter）。
内部会话模式枚举 @784750：["default","yolo","guarded","plan","edit","acceptEdits","auto","dontAsk","bypassPermissions","autoEdit","build"]。
映射 `$4a` @13113600：bypassPermissions/dontAsk→**yolo**；acceptEdits→**edit**；auto→auto；plan→plan；default→继承（`cnn`=inheritPermissionMode）。
行为差异：
- yolo/guarded：全部 allow（guarded 保留 dangerous-command user-once 审批与 cwd 重写）
- plan：只读白名单（见 checkPlanMode）
- edit：文件编辑放行，其余走 build 逻辑
- build（默认）：readOnly 放行、high/critical risk ask、副作用 ask
- auto：保留未实现（deny）
- Bash 只读命令自动降级：`Uwa`=resolveBashPermissionCapability @7439790 —— 命中只读命令模式（cat/head/tail/sed -n/grep 等，解析函数 uwa/dwa/pwa/fwa/mwa @2711 附近）→ capability 改 {readOnly:!0, needsApproval:!1, riskLevel:"low", sideEffectScope:"none"}

### 3.4 并发调度
`Gfo`=executeToolSchedule @5092020：模型一次输出的 tool_use 按 `parallelGroups` 分组串行批间/批内并发（`Hfo`=executeToolBatch，maxConcurrency 切片）；
`concurrentSafe:!1` 的工具（Bash/Write/Edit/TodoWrite 等）每批单工具；某工具返回 turnControl.stopTurnAfterResult → 其余未执行工具取消（"Tool cancelled because a previous tool result requested a turn stop."）。

---

## 4. 特殊工具深挖

### Agent（subagent）
- handler `TIa`=agentHandler @7714866：`subagent_type ?? aCr.GeneralPurpose`；内置类型 `aCr` @1416013={GeneralPurpose:"general-purpose", Explore:"Explore"}；
  自定义类型来自 `.zcode/agents/*.md` frontmatter（描述原文："Each agent type's model, reasoning effort, and tools come from its definition (`.zcode/agents/*.md` frontmatter)."）；
  解析器 `Ene`=parseAgentProfileFromMarkdown @1025461（color/permission mode/tools/model 字段，kps 同处校验）。
- 执行经 `subagentPort.launch({sessionId, turnId, parentToolCallId, agentType, description, prompt, callerCanReadOutputFile, runInBackground})`；timeout.kind:"none"（不限时）；取消消息 "Agent was cancelled before the subagent returned findings or background launch completed"。
- **Task 是 Agent 的 Claude Code 兼容别名**：`hxo` @7715900 = {...Xie, name:"Task"(uve), providerVisible:!1, capability:"Claude Code-compatible alias for launching a ZCode subagent"}——描述前缀 "Use this when plugin instructions ask for the Task tool."。子代理工具过滤 `Ese`=filterSubagentChildToolNames；SendMessage 用 agent_<uuid> 续聊，新 Agent 全新上下文。
- 动态 workflow 提示注入：MTn=createAgentToolEntry({dynamicWorkflowEnabled})。

### TodoRead/TodoWrite 持久化
handler `MIa`=todoWriteHandler @7721319：`sessionStore.readTodos({sessionID})` → `sessionStore.updateTodos({sessionID, todos})`，返回 {oldTodos, todos, summary}。
持久化在 SessionStorePort（SQLite 行式；`VAr`=decodeTodoRow、快照恢复 `whc`=readSnapshotTodos @14806720 附近）。会话恢复提示 "resume_goal_state" attachment @13183624。无独立 JSON 文件。

### WebFetch
handler `YTa`=webFetchHandler @7701697：15 分钟缓存（`Eko`=getWebFetchCache/`Ako`=putWebFetchCache，cacheHit 字段）；
SSRF 防护 `Fko`=isWebFetchIpLiteral + `Lko`=assertWebFetchLiteralEgress；重定向链记录 redirects[]；
可读内容转 markdown + 小模型按 prompt 作答；截断 truncated + 会话 artifact。文档站白名单直接放行权限。
HTTP 适配 `hB`=createNodeWebFetchHttpClientAdapter。

### WebSearch
handler `yIa`=webSearchHandler @7708525：**provider-native**——要求 `model.properties.supportsNativeWebSearch`，
否则 ConfigurationError "Current model does not support native WebSearch"；内部发一次 streamText（system "You are an assistant for performing a web search tool use."），maxOutputTokens min(4096, model 上限)，携带 provider 原生 web_search 工具契约（`vIa`=createProviderNativeWebSearchContract）；汇总 results/sources/summary/webSearchRequests/usage。

### Bash
- shell 选择：`iks`=inferWindowsGitBashPathsFromGitExe、`resolveEffectiveWindowsBashShellSelection`/`resolveEffectivePosixBashShellSelection`、`_Or`=createWindowsCmdProvider（cmd 兜底）、`zsn`=posixShellKind；
  `Jwa`=commandShellKind @7443529：display.name 含 powershell/zsh/bash → 对应 kind，dialect cmd/posix→cmd/sh。
- 执行链 `YSo`=executeBashHandler / `zwa`=bashHandler / `$wa`=createBashHandler @7446300；执行适配 executionPort；POSIX 路径处理 `Fwa="posix"`。
- 环境注入 `Cge`=applyNetworkEgressEnv @2181318 附近：HTTP_PROXY/HTTPS_PROXY/ALL_PROXY、NO_PROXY、CA 证书族（NODE_EXTRA_CA_CERTS/SSL_CERT_FILE/REQUESTS_CA_BUNDLE/CURL_CA_BUNDLE/GIT_SSL_CAINFO）；win32 大小写不敏感 env 覆盖。
- 后台化输出：backgroundTaskId/outputFile（IIa=canReadBackgroundOutputFile 判断调用方是否有 Read/Bash）。

### EnterPlanMode/ExitPlanMode/AskUserQuestion/Skill
- EnterPlanMode→sessionModePort 切 plan（permission Wxo("plan.enter")，needsApproval:!1）；输出回传 previousMode/mode。
- ExitPlanMode 携带完整 plan + allowedPrompts（Bash 语义级授权 FCr）；needsApproval:!0 → 走用户批准 UI（对应 AGENTS.md 中 plan 工作流）。`zdc`=isExitPlanModeToolName、`ytn`=isTodoPlanToolName 用于 plan 状态投影。
- AskUserQuestion：permission "userInteraction.askQuestion"；requiresUserInteraction:!0 → PermissionService 直接 ask（tool.userInteraction）；答案由权限组件回填 answers。
- Skill：skillPort.loadSkill，内容以 `<skill_content name="...">` 注入 + baseDirectory 说明；Skills 上下文注入块 @4942597 把可用技能清单注入 meta_user。

---

## 5. MCP 工具接入

- 命名 `aD`=toMcpToolName @12741951：`e.name ?? \`mcp__${N8(serverName)}__${N8(toolName)}\``；
  `N8`=toModelVisibleMcpNamePart：非 [a-zA-Z0-9_-] 折叠为 "_"，空 → "unknown"。官方 CUA 前缀 `mcp__plugin_zcode-cua_computer-use__`。
- 注册 `bs(`$bt`)=registerMcpTools @12744430：allowedTools/disallowedTools 过滤（支持 `mcp__*` 通配）。
- 物化差异（UCn @12745200）：
  - concurrentSafe = annotations.readOnlyHint===true || idempotentHint===true
  - readOnly = readOnlyHint；destructive = destructiveHint
  - riskLevel：node_repl js 或 destructive→"high"；readOnlyHint→"low"；否则"medium"
  - sideEffectScope：node_repl js→"system"，其余→"network"
  - needsApproval 恒 true；permission:"mcp"，reason "MCP tool <server>/<tool> executes through an external server"，patternSources:["toolName","input","network"]
  - resultBudget：官方 CUA→256KB inline/truncate；node_repl→1MB inline/64KB model/artifact；默认→100KB inline/50KB model/truncate
  - timeout：`t.timeoutMs ?? vOa(=3e4 默认 30s)`，allowCallOverride:!1
  - providerVisible:!1（除非 `_`=`TDe(t)` 可见性列表含 "model"）
  - handler → `n.callTool({serverName, toolName, arguments, trace, runtimeScope, workspacePath, remoteSessionId, workspaceIdentity→workspaceKey})`——贯穿 workspaceIdentity 身份。
- plan 模式下 MCP 工具特判：非破坏性 MCP 工具 allow（"mode.plan.mcp"，`isMcpToolCapability`: permissionName==="mcp"）。
- MCP Apps（LCn @12745200 附近）：ui 工具改名为 modelName、仅 app 打开时可用（"(Tool provided by the <server> app page; available only while the app is open.)"）。

---

## 6. 结论要点（对照 Drora）

1. 官方 3.14.x subagent 工具名确认为 **Agent**；"Task" 仅是 providerVisible:!1 的 CC 兼容别名（描述明说给插件指令用）。
2. 权限标记词汇与 Drora 现状不同：官方是 metadata.readOnly/destructive/concurrentSafe/needsApproval + permission.permission 类别键（read/edit/bash/webfetch/subagent/skill/todo.*/plan.*/agent.message.*/userInteraction.askQuestion/mcp/channel.reply），无 checkPermissions/canUseTool。
3. hook 事件全集：SessionStart/UserPromptSubmit/PreToolUse/PermissionRequest/PostToolUse/PostToolUseFailure/Stop（@694269/@737860）。PermissionRequest hook 是 ask 阶段专属，可在批准前 deny/allow/modify input。
4. 权限模式官方名实为 yolo/guarded/plan/edit/build(+auto 保留未实现)；CC 名 bypassPermissions/dontAsk/acceptEdits 是入口别名。
5. 官方执行管线没有 runtime 侧 CommandInbox admission 之外的 UI 概念；工具并发由 parallelGroups + concurrentSafe 决定，与 Drora 的 owner/lease 语义不冲突但词汇不同。
