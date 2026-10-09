# B3 工具注册面对拍报告（pass27 · 2026-10-08）

- 真值：`D:\software\zcode\resources\glm\zcode.cjs`（0.16.9，单行 CJS bundle，14.8MB；偏移均为字节 offset）
- 我方：`D:\workspace\projects\Drora`（feat/migrate-remote-and-pet），域 `apps/drora-cli`
- 方法：`grep -ob`/`grep -o` 短窗口取材；注册表以 `lwn=[...]`（offset 12534105）与 `metadata:{name:...}` 双策略交叉；schema 以 `ds()` 源 zod 变量解引用。

## 结论速览

| 分类 | 计数 | 明细 |
| --- | --- | --- |
| REAL-GAP | 1 | `Workflow` 工具条目缺失（P1） |
| EXTRA | 0 | 注册面无多余条目；契约层 2 个未注册契约（P3 备注） |
| SHAPE-DIFF | 0 | 抽样 24 工具 schema 形状全对齐 |

---

## §1 真值工具全集

### 1.1 静态注册表 `lwn`（offset 12534105，`registerBuiltInTools`），共 40 条目

17 个字面名 + 22 个变量名（已解引用）+ 1 个工厂条目：

Read、Write、Edit、Bash、Glob、Grep、WebFetch、WebSearch（`get description()` 动态描述）、TodoRead、TodoWrite、CronCreate、CronList、CronUpdate、CronDelete、OffPeakCreate、OffPeakList、EnterPlanMode、ExitPlanMode、AskUserQuestion、SendMessage、RespondToCoordinator、submit_result、escalate、TaskOutput、TaskStop、ReadSessionContext、Agent、Task、Skill、js、CreateWorkflow、AmendWorkflow、SaveWorkflow、EvalWorkflowSnippet、ListWorkflowRuns、GetWorkflowRun、ResumeWorkflowRun、ResolveWorkflowQuestion、ListSavedWorkflows、ListModels。

### 1.2 别名（同 bundle 证据）

- `Task` = Agent 的 Claude Code 兼容别名条目，`providerVisible:!1`（offset 7595189）。
- `TaskStop` aliases `["KillShell","KillBash"]`（offset 7661972）。
- `TaskOutput` aliases `["AgentOutputTool","BashOutputTool","AgentOutput","BashOutput"]`（offset 1374368），描述以 `DEPRECATED:` 开头。

### 1.3 门控条目（registerBuiltInTools 过滤链，offset 12531900–12533100）

顺序：embeddedSearch 隐藏 Glob/Grep → allowedTools → disallowedTools → Agent/Task（includeAgent）→ Skill（includeSkill!==false）→ SendMessage → RespondToCoordinator → submit_result（includeSubmitResult）→ escalate（includeEscalate）→ **Workflow（includeWorkflow=!!workflowPort，offset 13205452）** → Cron*（includeAutomation）→ OffPeak*（includeOffPeak）→ 10 个 dwf 工具（includeDynamicWorkflow===false 下架）→ js（includeNodeRepl）。

`Workflow` 是**运行时门控的真实工具**（offset 4936660/4953469/13165734 共 8 处按名引用），不在 `lwn` 静态数组内，构造点未在 bundle 中找到（见 §6）。

### 1.4 仅见兼容/排序名单、未注册的名字（双方均不注册，非缺口）

- 能力类别名单 `Zpr`/`WYi`（offset 970349）：`ApplyPatch`、`GoalRead`、`web_search`（provider 原生小写）、`js_reset`、`js_add_node_module_dir`、`mcp__node_repl__js{,_reset,_add_node_module_dir}` —— `js_reset`/`js_add_node_module_dir` 在真值全 bundle 各仅出现 1 次，无条目无定义。
- provider 可见排序集 `Awa`（offset 12767837，31 名）：另含 `EnterWorktree`、`ExitWorktree`、`LSP`、`NotebookEdit`、`ScheduleWakeup`、`TaskCreate`、`TaskGet`、`TaskList`、`TaskUpdate` —— 各仅出现 1 次，纯前向兼容命名。
- provider 原生映射：`WebSearch→web_search`（`providerToolName`，offset 1380296，`fallback:"disabled"`）；WebFetch 无 provider 原生映射。
- `Monitor`：`monitor_mcp` 后台任务类型名（offset 13165971），非注册工具。
- `QMt`/`INt`（offset 10772841/10822205）为 LSP 重构动作名，与 CLI 工具面无关。

## §2 我方全集

- 注册数组：`apps/drora-cli/packages/core/src/tool/handlers/index.ts` `builtInTools`（L76–137），**40 条目**，名称常量（`packages/contracts/src/tools/*.ts` 的 `*_TOOL_NAME`）与真值逐一相同，含 `submit_result`/`escalate` 小写。
- 过滤链：同文件 `registerBuiltInTools`（L195–269），门控集合与顺序和真值一致（含 embeddedSearch Glob/Grep、Skill/SendMessage/RespondToCoordinator/submit_result/escalate/Workflow/Cron*/OffPeak*/10 个 dwf/js 门、`submitResultSchema` typed 工厂、Agent/Task/EnterPlanMode/js 分支工厂）。
- `DYNAMIC_WORKFLOW_TOOL_NAMES` 10 名与真值 `Dya` 集一致。
- 别名：`task-stop.ts:97` `["KillShell","KillBash"]`；`contracts/src/tools/task-output.ts:5` 四个别名；`compat.ts` Agent/Task 互认 + `ApplyPatch→[Write,Edit]` hookMatcher 映射，均与真值同构。
- `provider-visible-order.ts` 31 名排序集与真值 `Awa` 逐字一致。
- Task 条目 `providerVisible: false`（`handlers/agent.ts:293,309`）。

## §3 差集三分类

| # | 工具 | 分类 | 级别 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | `Workflow` | REAL-GAP | **P1** | 真值：workflowPort 在场即注册（offset 13205452 `includeWorkflow:!!t.workflowPort`；过滤链 12532682）。我方：`handlers/index.ts:70` import 注释 `// import { workflowToolEntry } from "./workflow.js"`、L136 条目注释、L238 仅存门控分支；但 `packages/bootstrap/src/app/create-app.ts:771` **无条件注入** `workflowPort: scriptWorkflowFacade.workflowPort`（runtime-tools.ts:66 推导 `includeWorkflow=true`），且端口/后台任务类型（`background.ts:435,452`）、受限轮名单（`turn-loop-state.ts:34` 含 "Workflow"）全在。即：端口在场、门常开、条目不存在——模型永远拿不到该工具，脚本工作流主链路对模型不可达。 |
| 2 | `ApplyPatch` 契约 | EXTRA（契约层） | P3 | `contracts/src/tools/apply-patch.ts` 存在但条目注释（index.ts:80）。真值同样不注册，仅兼容名单同名。无行为差。 |
| 3 | `workflow.ts` 契约 | EXTRA（契约层） | P3 | `contracts/src/tools/workflow.ts` 存在（未注册条目）。关联 #1。 |

SHAPE-DIFF：0（抽样见 §4）。

## §4 schema 逐工具形状差（抽样 24 工具，全部对齐）

以下每项核对属性集/必填/枚举/默认/strict 性，全部一致；差异栏留空即零差：

| 工具 | 真值形状（offset） | 我方 | 差 |
| --- | --- | --- | --- |
| Bash | strict；command 必填；timeout/description/run_in_background/dangerouslyDisableSandbox 可选；semanticNumber/semanticBoolean（1346059） | `contracts/tools/bash.ts:34-45` | 无 |
| Read | file_path 必填 + offset/limit；图片模型扩展 `pages`；非 strict（1337244，条件式 `$yr`/`QQe`） | `contracts/tools/read.ts:69-97` | 无 |
| Write | file_path+content 必填，非 strict（1341652） | `contracts/tools/write.ts` | 无 |
| Edit | file_path/old_string/new_string 必填 + replace_all（semanticBoolean 预处理 default false）（1342872） | `contracts/tools/edit.ts:22-36` | 无 |
| Glob | pattern 必填 + path 可选，非 strict（1349162） | `contracts/tools/glob.ts` | 无 |
| Grep | pattern/path/glob/output_mode/"-B"/"-A"/"-C"/context/"-n"/"-i"/"-o"/type/head_limit/offset/multiline（~1350280） | `contracts/tools/grep.ts:22-112` 全 15 属性 | 无 |
| WebFetch | url(url())+prompt 必填（1354000 段） | `contracts/tools/webfetch.ts:14-15` | 无 |
| WebSearch | strict；query min2 + allowed_domains/blocked_domains；runtime 扩展 maxUses（1380296 段） | `contracts/tools/websearch.ts:14-24` | 无 |
| TodoRead/TodoWrite | 空 strict / todos{content,status(enum),priority(enum)} strict（1355332 段） | `contracts/tools/todo.ts:27-57` | 无 |
| CronCreate/Update/Delete/List | strict；cron 可选+delayMinutes 互斥 refine 链 / id+cron?+prompt?+title 必填 / {id} / 空（1360609–1363307） | `contracts/tools/automation.ts:34-134` | 无 |
| OffPeakCreate/List | strict；title/prompt/permissionMode(enum)/model/thoughtLevel；List 空（1366192 段） | `contracts/tools/off-peak.ts:13-40` | 无 |
| EnterPlanMode/ExitPlanMode | 空 strict / {plan min1 max2e4, allowedPrompts?}+**catchall(unknown)**（1366440–1367486） | `contracts/tools/plan-mode.ts:15,48-68` catchall 一致 | 无 |
| AskUserQuestion | strict+superRefine（question/header/options 2-4{label,description,preview?}/multiSelect default false；HTML preview 校验）；`nis` 把 multiSelect 补进 required（1369246–1371594） | `contracts/tools/ask-user-question.ts:50-206`，`withRequiredDefaultedMultiSelect` 同名同实现 | 无 |
| SendMessage/RespondToCoordinator | {to,summary,message} / {summary max200,message max2e4} strict（1373087/1373392） | `contracts/tools/send-message.ts`、`respond-to-coordinator.ts` | 无 |
| escalate/ResolveWorkflowQuestion | {question,context?} / {question_id,answer} strict（1401320/1401617 段） | `escalate.ts`、`resolve-workflow-question.ts` | 无 |
| TaskOutput | {task_id,block default true,timeout default 3e4 max 6e5} strict + provider required 覆盖 `["task_id","block","timeout"]`（1375453） | `contracts/tools/task-output.ts:27-39` | 无 |
| TaskStop | {task_id?,shell_id?(deprecated)} strict（1376255） | `contracts/tools/task-stop.ts` | 无 |
| ReadSessionContext | sessionId `^sess_…` regex + query min1 max4000 + strategy enum(relevant/handoff) + maxTokens（1376435 段） | `contracts/tools/read-session-context.ts` | 无 |
| Agent/Task | description/prompt/subagent_type?/run_in_background?（1353599）；Task 同构换描述+providerVisible:false（7595189） | `contracts/tools/agent.ts:19-27`、`handlers/agent.ts` | 无 |
| Skill | {skill,args?} + 旧 {name,args} union transform（1354991） | `contracts/tools/skill.ts:10-25` | 无 |
| js | strict {code,timeout_ms? max 12e4,title 必填 min1 max120}（1347988）；描述工厂 browserUseEnabled 附加段（7529432 `umo`） | `contracts/tools/node-repl.ts`、`handlers/node-repl.ts:299-304` 逐字一致 | 无 |
| CreateWorkflow/AmendWorkflow/SaveWorkflow/List*/Get*/Resume*/Resolve* | 逐变量核对（1386181–1401067） | `contracts/tools/create-workflow.ts` 等 9 文件 | 无 |
| ListModels | 空 strict；输出 {id,providerId,modelId,providerLabel?,reasoningLevels,…}（1394903 段） | `contracts/tools/list-models.ts` | 无 |
| submit_result | 工厂条目 `xFe=Kht(schema)`（7644634），typed 声明门 `submitResultSchema`（12533500 段） | `createSubmitResultToolEntry`（index.ts:281） | 无（内部 schema 未逐字节比对，见 §6） |

描述文本抽样（P3）：Bash（`kyn` 超时文案）、WebSearch（动态月份 `Xda`，offset 1369046 段）、TaskOutput（`DEPRECATED:` 全文）、js（`umo` 持久 REPL 文案 + browser-use 附加段）、Task（"Claude Code-compatible alias…"）、AskUserQuestion（options 描述）——我方均逐字或逐段一致。

## §5 动态注册通道对照

| 通道 | 真值 | 我方 | 结论 |
| --- | --- | --- | --- |
| 静态注册表 | `lwn` 40 条目 + `Hoe`（registerBuiltInTools） | `builtInTools` 40 条目 + `registerBuiltInTools` | 对齐（除 §3#1） |
| MCP 桥 | `mcp__<server>__<tool>` 命名；node_repl 特判（`mcpPresentation.serverName==="node_repl"`，offset 12586949；`w6e="mcp__node_repl__js"` offset 13061960）；`monitor_mcp`→Monitor | `core/src/mcp/name.ts:8` 同命名；`mcp/image-normalization.ts:39` node_repl 特判；`background.ts:455-456` Monitor | 对齐 |
| Computer Use | `mcp__computer-use__` + 拼写别名 `mcp__computer_use__`；`zcode:permission-capability:official_cua`（offset 650627 段） | `core/src/mcp/index.ts:46-47` 双前缀同款 | 对齐 |
| provider 原生 | WebSearch→web_search、fallback:"disabled"（1380296）；`code_execution`/`str_replace_editor` 为 provider 侧工具类型，非 CLI 注册 | `contracts/tools/websearch.ts:119-120`、`ProviderNativeToolSpec`（contract.ts:81-84） | 对齐 |
| 插件 | 无 `registerPluginTool` 通道；browser-use 经 `includeBrowserUse`/`agent.browsers` 注入 js 描述（offset 7485924） | `includeNodeRepl`/`includeBrowserUse` 由 browser-use 插件推导（runtime-tools.ts），js 描述同一开关 | 对齐 |
| Workflow 门控条目 | workflowPort 在场即有 `Workflow` 工具 | 端口在、门在、**条目缺** | **REAL-GAP P1（§3#1）** |
| node_repl 服务器工具面 | 兼容名单含 `js_reset`/`js_add_node_module_dir`（各 1 次，无定义） | `node-repl-host` 0.6.0 有据收敛到只剩 `js`（`tool-contract.ts:13-19`：零调用、fresh-kernel 空操作） | 非缺口：真值同样未注册 |

## §6 OPEN-QUESTION

1. **真值 `Workflow` 条目的构造点与输入 schema**：bundle 内 8 处按名引用但未见 `metadata:{name:"Workflow"}` 字面注册（疑运行时经 workflowPort 装配）。补齐 §3#1 前需先确定真值该条目的 schema/描述/权限形状——建议用真值 CLI 实跑 `workflowPort` 场景抓 tools/list 确认。
2. **submit_result typed 工厂 `Kht` 的内部 schema**：双方机制一致（端口注入 schema 生成 `{result:<schema>}` 声明），未逐字节比对动态生成结果。
3. **node_repl MCP 服务器（真值侧）**：`mcp__node_repl__js` 的 MCP 呈现描述/超时来自独立服务器进程，不在本 bundle；无法对拍（我方 fresh-kernel 60s 默认 vs 核心 js 条目 30s 属不同层，非注册面差异）。
4. **`GoalRead`**：真值兼容名单有、我方无对应名单项；双方均不注册，无行为影响，是否需要在兼容名单补名待产品决定。
