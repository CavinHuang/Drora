# b06 子代理面对拍（真值 zcode.cjs 0.16.9 vs Drora @ feat/migrate-remote-and-pet）

调查员 C2 · 2026-10-08 · 只读对拍。
真值侧证据均为 `D:\software\zcode\resources\glm\zcode.cjs` 字节偏移（obfuscated minified，函数名经 `r()` 包装可读）。
我方证据均为仓库源码 file:line。品牌串 ZCode→Drora 为本仓库既定重命名，单列 SHAPE-DIFF 不计缺陷。

## §1 真值子代理类型全集

### 1.1 内置 profile（`$vn` normalizeAgentProfiles，偏移 ~7579100；内置名集 `fHa` 偏移 14079670）

| 类型 | 描述要点 | tools | color | injectAgentsMd | systemPrompt | model |
| --- | --- | --- | --- | --- | --- | --- |
| `general-purpose` | "General-purpose agent for researching…"（完整句与我方一致） | `["*"]` | blue | true | `Lvn()` buildGeneralPurposeSystemPrompt（~7575810） | 无默认；可被 `builtInModelSelectionOverrides` 覆盖（agents-state.json） |
| `Explore` | "Read-only search agent for broad fan-out searches…"（与我方一致，含 "medium"/"very thorough" 宽度指引） | `[Bash,Glob,Grep,Read,WebFetch,WebSearch,TodoWrite]` | cyan | false | 空串；运行时若 `trim()===""` 替换为 `jvn()` buildExploreAgentPrompt（~7576245） | 同上 |

- 历史 `alignment-probe`：0.16.9 全文 0 次命中，已移除；我方亦无。历史基线结论作废，以重测为准。
- `"Plan"` 仅 2 次命中且均为 plan-mode UI header（14199635 / 14446091），非 agent 类型。

### 1.2 自定义 profile
- user/project Markdown（`XVo` loadZCodeAgentProfiles，14075934）：roots = `<storageRoot>/agents`(user) + `<cwd>/.zcode/agents`(project)；`.md|.markdown` 递归排序读取；迁移函数 `Zqt`/`Kqt` 与我方 `migrateUserSubagentMarkdown`/`migrateSubagentStateFile` 同构。
- frontmatter 字段（`qvn` parseAgentProfileFromMarkdown，~7583900）：name、description（支持 `\n` 转义）、model（`uee` resolveProfileModelSelection）、color（8 色枚举）、permissionMode（**6 值**：acceptEdits/auto/bypassPermissions/default/dontAsk/plan，集合 `dpa` ~7587540；project 来源强制丢弃 `mHa`）、maxTurns（正整数）、memory（user/project/local）、tools、disallowedTools、skills、background（bool）、injectAgentsMd（bool）、mcpServers（父服务器名列表）。诊断码：agent_missing_frontmatter / agent_missing_required_frontmatter / agent_invalid_memory_scope / agent_invalid_mcp_servers。
- plugin profiles（`QVo`/`hHa`/`gHa`）：`<pluginRoot>/agents/<name>.md`，命名空间 `plugin:bare`，bare 别名唯一且不与保留名冲突时额外注册；冲突/歧义 → `agent_ambiguous_name` 诊断；`pluginAgentModelSelectionOverrides` 覆盖。
- 禁用面：`disabledAgentIds`（agents-state.json，仅 user 来源生效，`SHa` isDisabledUserProfile）。

### 1.3 类型解析（`gwn`/`zya`/`gSo`，12545301-12546600）
精确匹配 → 归一匹配（trim+NFKC+lowercase+去空白/连字符/下划线）→ 唯一命中采纳；多命中 → "Agent type 'x' is ambiguous — matches … — Use the exact name: …"（code `agent_unknown_type`）；无命中 → "Agent type 'x' not found. Available agents: …"（同 code）。请求的 agentType 随后收敛为 profile 规范名。

**我方对照**：`apps/drora-cli/packages/bootstrap/src/subagents.ts:49-337`（roots `.drora/agents`、迁移、plugin 命名空间、disabledAgentIds、state 读取全部同构）；`packages/core/src/subagent/runner.ts:701-793`（精确/归一/ambiguous/not_found 逐句一致，含错误文案与 `AgentErrorCode.UNKNOWN_AGENT_TYPE`）。`normalizeAgentProfiles`、两个内置 profile、`formatAgentProfilesForPrompt` 逐字段一致（`profile.ts:66-152`）。

## §2 提示词对照（默认分支 vs embedded 分支）

### 2.1 general-purpose（真值 `Lvn` vs 我方 `general-purpose.ts:7-24`）
逐行一致。唯一差异：首句 "agent for ZCode CLI" → "agent for Drora CLI"（品牌）。

### 2.2 Explore（真值 `jvn` vs 我方 `explore.ts:20-68`）
逐行一致（READ-ONLY 段 7 条禁令、strengths 3 条、Guidelines、快速返回 NOTE、并行工具调用指引、结尾句）。两处 embedded 条件变量一致：
- 搜索指引：embedded → "`find` via Bash"/"`grep` via Bash"；direct → Glob/Grep。
- Bash 只读命令清单：embedded 含 `grep`，direct 不含（`ls, git status, git log, git diff, find[, grep], cat, head, tail`）。
品牌差异："You are ZCode Explore…" → "You are Drora Explore…"。

### 2.3 Agent/Task 工具描述（真值 `who` 7587820 vs 我方 `handlers/agent.ts:91-126`）
逐行一致：标题句、profiles 列表注入（Explore 用 `formatExploreAllowedToolsForAgentDescription`，direct/embedded 工具序一致：Glob,Grep,Read,Bash,WebFetch,WebSearch,TodoWrite / embedded 去掉前两者）、subagent_type 缺省说明、"## When to use" 段、4 条 bullet、`dynamicWorkflowEnabled===false` 时剔除 CreateWorkflow 强制 bullet 的条件分支一致。

### 2.4 结果渲染（真值 `kpa` 7589560 vs 我方 `agent.ts:130-172`）
completed：正文拼接/空输出占位、`agentId: … (use SendMessage with to: '…')`、`<usage>`（subagent_tokens/tool_uses/duration_ms）一致；async_launched：三分支文案（canReadOutputFile 含 output_file 指引）逐句一致。

### 2.5 子代理 system 段（真值 `Nya`/`pSo`/`fSo` 12532990-12537000 vs 我方 `system-prompt.ts`、`context-builder.ts:106-163`）
段序一致：CLI prefix（`hNe`↔`buildCliPrefixSection`）→ "Subagent Agent Prompt"（单换行左边界）→ "Subagent Notes"（双换行左边界；5 条 Notes 逐句一致）→ "Subagent Environment"（env 块 + "You are powered by the model named …" 行，条件一致）→ userInstructions（injectAgentsMd!==false）→ currentDate → skills；system 段均带 `cacheControl:{type:"ephemeral"}`；meta_user 拆 skills_listing/context_prefix 一致。

### 2.6 SendMessage 描述与格式化（真值 `tfa`/`ofa` 7636900-7636500 vs 我方 `send-message.ts:25-35,142-152`）
描述块、格式化三分支（message 优先 / success+delivery / failed）逐句一致。

特征词清单（字节级核对通过）：`gold-plate`、`READ-ONLY MODE`、`heredocs`、`very thorough`、`fan-out searches`、`coordinator_input`、`tool_subagent_`、`agent_unknown_type`、`async_launched`、`(Subagent completed but returned no output.)`。

## §3 子代理运行时语义

真值端口 `kwn`（12538567，`r(kwn,"createExploreSubagentPort")`）vs 我方 `subagent/runner.ts:131`：

| 语义 | 真值 | 我方 | 结论 |
| --- | --- | --- | --- |
| launch 分派 | `run_in_background===true \|\| profile.background===true` → start；`modelOverride.background==="deny"` → BACKGROUND_UNAVAILABLE（"Idle-time tasks do not support background agents…"） | 同（runner.ts:141-171） | 一致 |
| 不活动超时 | `inactivityTimeoutMs ?? YV`，YV=6e5（1301736） | `DEFAULT_MODEL_STREAM_IDLE_TIMEOUT_MS`=600_000（contracts/config/index.ts:284；runner.ts:214） | 一致 |
| 前台自动转后台 | `autoBackgroundMs`（截断正整数 `Bya`）；`modelOverride` 在场时不启用；到点 `requestBackground` | 同（runner.ts:653-698） | 一致 |
| maxTurns | `profile.maxTurns ?? config.subagents.maxTurns ?? 4`（~12914321） | 同（runtime/methods/subagent.ts:269） | 一致 |
| 并发 | 无子代理专属上限；随父消息多 tool_use 并行 + `toolConcurrency.maxConcurrency` 调度 | 同 | 一致 |
| Agent 工具超时 | `timeout:{kind:"none"}`，cancellation bestEffort（~7594100） | 同（agent.ts:267-273） | 一致 |
| 结果形状 | completed：`{status,agentId,agentType,description,prompt,content:[{type:"text",text}],totalToolUseCount,totalDurationMs,totalTokens?,usage?}`；async_launched：`{status:"async_launched",isAsync:true,agentId,agentType,description,prompt,childSessionId,backgroundTaskId,outputFile,canReadOutputFile}`（1353496-1354452） | contracts/tools/agent.ts:44-70 逐字段一致 | 一致 |
| 错误码 | `agent_subagent_unavailable / agent_background_unavailable / agent_unknown_type / agent_child_runtime_failed`（1354852） | 同（contracts/tools/agent.ts:131-136） | 一致 |
| 进度事件 | `subagent_spawned`（含 allowedTools/model）/`subagent_message`/`subagent_stopped`（事件枚举 ~1236970）；child 工具事件镜像至父，toolCallId 改写 `tool_subagent_<agentId>_<childToolCallId>`，附 agentId/agentType/childSessionId/childToolCallId/description/parentToolCallId/source，schedule.dependencies/executionOrder/parallelGroups 同步改写（`bCo` 12888760） | 同（runner.ts:234-368；tool-event-mirror.ts:38-134） | 一致 |
| permission 事件镜像 | PermissionRequested/Resolved/Denied 三类镜像，Requested 带 origin（`Ygt`） | 同（tool-event-mirror.ts:60-78；interaction-origin.ts） | 一致 |
| 父回合等待 | Agent handler `await subagentPort.launch(...)`，前台阻塞父回合；后台经 runtime command queue 投递 `task-notification` | 同（agent.ts:211；background-notifications.ts） | 一致 |
| 后台产物 | `<outputRootDir ?? tmpdir()/zcode-agents>/<sessionId>/<agentId>/{metadata.json,output.txt,task.output}`（`_So` ~12546480） | 同，目录为 `drora-agents`（runner.ts:808-815） | 一致（品牌） |
| 完成通知 | local_agent 通知形状 + summary `Agent <type> task "<desc>" <status>.`（`Egt`/`jya` 12535550） | 同（completion-notification.ts:21-51） | 一致 |
| 取消收尾 | finally：`sealBackgroundTaskNotifications({reason: cancelled?"subagent_cancelled":"subagent_terminal"})`；cancelled 再 `cancelRunningRuntimeBackgroundTasks`（~12916400） | 同（subagent.ts:407-419） | 一致 |
| 禁止嵌套 | child config `subagents:{enabled:!1, backgroundBashMaxMs}`（默认 36e5，`aCa` 13210500）+ 注册期隐藏 Agent/Task | 同（subagent.ts:284-287；runtime-tools.ts:26） | 一致 |
| SendMessage | 10s 超时/4096B/`agent.message.send`/off-peak 轮禁用（`Jvn` 7612778，hint "Spawn a new foreground Agent…"）；续跑完成 agent → 后台 resume（`resumed_background`） | 同（send-message.ts；runner.ts:925-1089） | 一致 |
| RespondToCoordinator | 仅 `taskType==="subagent_child"` 且端口在场注册；child allowlist 末尾恒追加（`gxn`）；workflow 协调器回包端口 `TCo` | 同（subagent.ts:308-314,541-548） | 一致 |
| model 解析 | profileSelection > modelOverride > 继承父 Active Model；`hasConcreteModel` 抑制继承 | 同（subagent.ts:100-111；helpers/subagent-selection.ts） | 一致 |
| agent 记忆 | `RCo` persistent memory prompt 拼入 agentPrompt；project memory root 排除 subagent_child（`zCo` 12923000 附近） | 同（persistent-memory.ts；subagent.ts:131-143） | 一致 |
| telemetry | causation：background→`linked_root`，前台→`child` | 同（subagent.ts:295） | 一致 |

## §4 工具面限制

真值 `Ixa` resolveSubagentToolAllowlist（12917761）vs 我方 `subagent.ts:490-548`：
1. 强制剔除：`EnterPlanMode`/`ExitPlanMode`（真值 `Gz`/`Uy` 1366624-1366643；我方 tool-policy.ts:4-7）+ profile.disallowedTools + config.toolDisallowlist。
2. `allowedTools` 含 `*`/空：父 registry 全部工具（剔除 `permission==="mcp"` 注册项）+ MCP 子工具（父 toolAllowlist 过滤 `Cxa`），再剔除 Agent/Task（真值 `d$`=isAgentToolName，`vZs=new Set(["Agent","Task"])`；我方 `isSubagentDispatchToolName`，compat.ts:2-14）与禁用名单。
3. 显式 `allowedTools`：仅按禁用名单过滤（不剔除 Agent/Task 一项——两侧同此行为）。
4. 末尾恒追加 `RespondToCoordinator`（`gxn`）。
5. 注册期门（真值 `Hoe` ~12532240 vs 我方 handlers/index.ts:195-269）：embedded→隐藏 Glob/Grep；includeAgent/includeSkill/includeSendMessage/includeRespondToCoordinator/includeSubmitResult/includeEscalate/includeWorkflow/includeAutomation/includeOffPeak/includeDynamicWorkflow/includeNodeRepl 逐项一致；Bash/submit_result/Agent/Task/EnterPlanMode/js 分支化参数一致。
6. Explore 只读：独立空配置 PermissionService（真值 `new UM(_$)`，`_$={allowedTools:new Set,…}` 5099110；我方 `new PermissionService(defaultPermissionConfig)`，permission/service.ts:682-687）；permissionMode 映射（真值 `Txa` 12917539）：bypassPermissions/dontAsk→yolo、acceptEdits→edit、auto→auto、plan→plan、缺省→Explore?yolo:父模式 —— 我方仅覆盖 auto/plan/缺省（见 §5 GAP-1）。
7. Skill 过滤：FilteredSkillPort 禁 official CUA skill（含唯一官方名模糊命中）、白名单外拒绝、歧义要求 qualified name —— 逐句一致（真值 `yxn` ~12921130 vs 我方 subagent.ts:724-832）。
8. MCP 借用：child 复用父 startup snapshot，`mcpServers` 指定未连接服务器 → "Required MCP server is not connected: …"；required tool 不在快照 → 对应错误 —— 一致（真值 `Axa`/`Rxa`/`_xn` vs 我方 subagent.ts:557-707）。
9. SubagentSpawned.allowedTools：Explore→`getAllowedTools()`（embedded 感知），profile.skills 非空且未禁 Skill 时补入 "Skill"（真值 `Swn` 12564173 vs 我方 runner.ts:2124-2137）——一致。

## §5 差集三分类

| # | 分类 | 级别 | 差异 | 真值证据 | 我方证据 |
| --- | --- | --- | --- | --- | --- |
| GAP-1 | REAL-GAP | P2 | profile frontmatter `permissionMode` 接收集：真值 6 值（acceptEdits→edit，bypassPermissions/dontAsk→yolo，default→Explore?yolo:父，auto，plan），我方仅 `auto\|plan`（`AgentPermissionMode`），其余值静默丢弃回退父模式。用户级自定义 agent 写 `acceptEdits` 等在真值生效、我方不生效。child runtime 本身支持 edit/yolo（`CollaborationMode`），仅解析层+映射层收窄 | `dpa=new Set(["acceptEdits","auto","bypassPermissions",…` ~7587540；`Txa` 12917539 | profile.ts:16,62,320-325；subagent.ts:473-488；session.port.ts:32 |
| GAP-2 | SHAPE-DIFF | P3 | 品牌串（既定重命名，非缺陷）：`agent for ZCode CLI`→`Drora CLI`；`ZCode Explore`→`Drora Explore`；`zcode-agents`→`drora-agents`；`` `zcode-${agentType}` ``→`drora-${agentType}`；`.zcode/agents`→`.drora/agents`；storage `~/.zcode`→Drora 对应 | 7575810/7576245/12546480/~12914200/14075934/1301780 | general-purpose.ts:9、explore.ts:35、runner.ts:809、subagent.ts:268、bootstrap/subagents.ts:55-57 |
| GAP-3 | EXTRA | P3 | 我方多出 legacy 包装 `buildExploreSystemPrompt`/`LegacyExploreSystemPromptOptions`（仅转发 embedded 参数，无行为差异）与 UI 展示辅助 `agentProfileDisplayName`（真值 bundle 未见等价物） | — | explore.ts:70-72；profile.ts:336-338 |

无其他 REAL-GAP：Task/Agent schema、双提示词、双分支描述、输出形状/渲染、事件镜像、超时/转后台/maxTurns、SendMessage、RespondToCoordinator、Skill/MCP 过滤、注册门、profile 加载（含 plugin/disabledAgentIds/model overrides）全部逐特征一致。

## §6 OPEN-QUESTION

1. GAP-1 是有意安全收紧还是迁移遗漏？我方注释仅论证"project 来源不可提权"（bootstrap/subagents.ts:115-124），未解释 parse 层整体收窄到 auto|plan。若为有意决策，应补 spec 并在文档标注与真值的行为分叉；若非，建议按真值 6 值集恢复（保留 project 丢弃逻辑）。
2. 真值 `config.subagents.autoBackgroundMs` 是否有 host 侧默认下发值：bundle 内仅见 normalize（`Bya`），未见字面默认；我方同样仅在显式配置时启用。两侧行为一致，但"真值产品默认是否开启自动转后台"无法从 bundle 确证。
3. 真值 `Ixa` 中 `d$(l)` 已确证为 isAgentToolName（Agent/Task），不存在额外隐藏工具集；此项无残留疑问（列出以闭环历史基线"子代理有工具面限制"的猜测）。
