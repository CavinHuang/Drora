# b20-dwf：dynamic-workflow 域静态对拍（J2）

- 真值：D:\software\zcode\resources\glm\zcode.cjs（0.16.9）
- 我方：feat/migrate-remote-and-pet @Drora（基线新鲜，ahead 14 / behind 0）
- 方法：bundle grep/offset 取证 + 我方源码逐件对照；两个 dwf 包实际跑 `pnpm typecheck` 通过
- 与 B1 分工：`Workflow` 工具条目缺失归 B1，本报告不重复；本报告覆盖 schema 形状、存储、运行时、事件、开关

## §1 工具 schema（真值 10 个灰度在册工具 + escalate）

十个工具名与真值逐字一致：CreateWorkflow / AmendWorkflow / SaveWorkflow / ListSavedWorkflows / ListModels / EvalWorkflowSnippet / ListWorkflowRuns / GetWorkflowRun / ResumeWorkflowRun / ResolveWorkflowQuestion（真值 Lte/Mv/Q_/nme/ome/jte/Qfe/ame/u3/lH）。

| 工具 | 真值 schema | 我方 | 结论 |
| --- | --- | --- | --- |
| CreateWorkflow | Nbr：name/script/saved{name,args,path,scope}/path/args/max_concurrency/subagent_model，strict；运行时 Nte 扩 saved.draft + script_line_offset | contracts/src/tools/create-workflow.ts:84-166 同构，回填字段同样不入模型 JSON schema | 一致 |
| AmendWorkflow | Wbr：run_id/script/path/name/max_concurrency(null)/subagent_model(null)；运行时 l3 + predecessor{name,status,stop_reason,owned_by_this_session,script_inherited} + script_line_offset，strict | contracts/src/tools/amend-workflow.ts:29-155 逐字段同（含 isAmendWorkflowOwnedPredecessor 谓词） | 一致 |
| SaveWorkflow | Fte：name(max64)/description/whenToUse/args/script/script_path/scope(必填)/path/overwrite/shadowing | contracts/src/tools/save-workflow.ts 同构 | 一致 |
| ListSavedWorkflows | 入参 {} strict；出参 workflows[]+invalid[] | contracts/src/tools/list-saved-workflows.ts | 一致 |
| ListModels | {} strict；行含 id/providerId/modelId/providerLabel/reasoningLevels/defaultReasoningLevel/contextWindow/disabledReason | contracts/src/tools/list-models.ts | 一致 |
| EvalWorkflowSnippet | Bte：code/path/timeoutMs(min 1e3, max 6e5)；出参 ok/diagnostics/logs(max 2048 字)/response/durationMs；超时常量 iwn=66e4、kgt=24e3 | eval-workflow-snippet.ts（60_000/600_000/1_000、2048、660_000、24_000） | 一致 |
| ListWorkflowRuns | limit 钳位 preprocess 1..50 默认 20；statuses 枚举同；行含 labelSource/possiblyInterrupted/resumedFrom/supersededBy | contracts/src/tools/list-workflow-runs.ts | 一致 |
| GetWorkflowRun | 出参 zte：summary(max400)/usage/actors/logTail/phases(≤32)/subagents(≤64)/health/result/error/pendingQuestions/artifacts(kind 六枚举含 board/metrics) | contracts/src/tools/get-workflow-run.ts + get-workflow-run-roster.ts（health 含 cachedSteps/leftoverRunning/pendingQuestionsKnown 等，逐字段同） | 一致 |
| ResumeWorkflowRun | run_id strict；出参 ok:true/runId/response/status:"backgrounded"/backgroundTaskId | contracts/src/tools/resume-workflow-run.ts | 一致 |
| ResolveWorkflowQuestion | question_id+answer strict；出参 ok/qid/response | contracts/src/tools/resolve-workflow-question.ts | 一致 |
| escalate（actor 通道） | question/context strict；出参 status(answered/refused)/message/qid/reason(budget_exhausted,no_active_ask) | contracts/src/tools/escalate.ts | 一致 |

配套常量也一致：diagnostics 上限 100 / message 2048（aH=100, iRe=2048）、causality graph 载荷（steps 64/lanes 32/participants 64/handoffs 256/types 8/phases 32/phaseEdges 128、Cis=["ask","world-read"]）、display 载荷（logTail 40×1024、actors 32、result 4000、runs 50——真值 qte/lme/vQt/lRe/SSr）、编译超时 15s（KSn=15e3 = CREATE_WORKFLOW_TIMEOUT_MS）、结果预算 24 000 字节（_gt=kgt）、kind 映射 CreateWorkflow/AmendWorkflow→local_dynamic_workflow。

## §2 存储面

- sqlite 四表：真值 0019 迁移（offset 1469838）与我方 `adapters/src/storage/session-store/migrations.ts:811-886` 的 dwf_run / dwf_actor / dwf_node / dwf_event **DDL 逐列逐索引一致**（含 5 个 CHECK 枚举、unique(run_id,site_id,ordinal)、三个索引、json_extract 表达式索引、无 FK 的 text 会话列）。0019 依赖迁移基线已在本分支落地。
- saved workflow 文件：`.dwf.ts` 扩展名、名字 pattern `/^[A-Za-z0-9_.-]+$/u`、max 64、目录 `<cwd>/.drora/workflows` 与 `~/.drora/workflows`（真值 `.zcode/...`，品牌改名）。frontmatter 块注释 + YAML，键序固定 description→whenToUse→args，终止行 `*/`，bodyLineOffset 语义一致（真值 Q_e/Coe）。
- 草稿布局：`<cwd>/.drora/workflow-drafts`（真值 `.zcode/workflow-drafts`）；slug 规则逐条一致（drop pattern `/[^\p{L}\p{N}_.-]/gu`、空白折叠、max 64、兜底 "workflow"、重试 1..1000 `-N` 后缀、`wx` 旗标、目录 .gitignore `*`；真值 OB/Lma/eye/Nma=1e3）。草稿免确认判定（Edit/Write + 目录内纯路径判定）同构。
- run 入口文件存档：`<cwd>/.drora/workflow-runs/<safeRunId>.mjs`，写不进回落 `os.tmpdir()/drora-workflow-runs`（真值 `zcode-workflow-runs`）+ entry_file_fallback 警告，同构。

## §3 运行时

- 编译（typecheck）：`@drora/dynamic-workflow` 与 `@drora/dynamic-workflow-runtime` 两包 `pnpm typecheck` 实跑通过（2026-10-08）。
- 子进程 spawn：`process.execPath` + 缺省 `--max-old-space-size=N` 或 SEA `argsPrefix`（隐藏子命令 `__drora-dwf-child`，真值 `__zcode-dwf-child`）、`ELECTRON_RUN_AS_NODE=1` 注入、stdio 三 pipe、payload 只走入口文件不走 argv——与真值 $je/rAn 逐项一致。**256MB 内存帽在场**（DEFAULT_MAX_OLD_SPACE_MB=256，真值 uqa 同值），历史缺口已闭合；入口文件内 `v8.setFlagsFromString` best-effort + `execArgv` 探测 + realpath 自启判定，与真值 tAn 逐行同构。
- child protocol：NDJSON 消息族 create-actor / request{ask,world-read,publish-artifact} / event{report,declare-artifact,phase-entered,log} / complete / response 完全一致；BOOTSTRAP shim（local#N 句柄、r#N 请求号、__pending、错误线形态 name/message/code/violations/finalText）、运行期禁令（Date.now/argless new Date/Math.random）逐行一致。harness 侧 11 个 sink 方法与 abort 归一（model/user/interrupted/superseded）一致。
- 引擎并发自适应常量同值（0.75 / +1 / 4 次 / floor 1 / idle 3e5）；`setMaxConcurrency` 控制面、concurrencyCeiling() 端口、`retuned` 输出块一致。

## §4 事件面

- 进度事件：`DynamicWorkflowRunProgress → "dynamic_workflow_run_progress"` 会话事件名与载荷（runId/toolCallId/sequence/eventType/payload/truncated/actorSessionId/launchInputId）同构；后台任务 kind `local_dynamic_workflow` 及与工具名互映一致。
- journal 事件族：run-launched/run-started/actor-created/node-*/usage-updated/log/report/phase-entered/run-settled 两侧同名；`phaseNames`/`phaseAlongside` 随 run-launched 提交（createWorkflowPhaseNames/Alongside 与真值 c3/cH/Bbr 同一算法）。
- escalation：`dwfq-<片段>-<seq>` 铸 id（片段 8/16/全串递进、注册表查重、全占用抛 DriverError）与真值 AWa/Hqo 逐句一致；`escalate` 出参 refusal 理由、ResolveWorkflowQuestion 回答通道、qidToSession/pendingEscalations/escalationRegistry 结构一致。
- workflow_child 工具面：actor 禁用名单 [AskUserQuestion, EnterPlanMode, ExitPlanMode, CreateWorkflow, AmendWorkflow, ReadSessionContext, ResolveWorkflowQuestion]（真值 MVa，逐项同）；subagent_child allowlist 补回 RespondToCoordinator（真值 iF）一致。

## §5 开关与灰度

- 偏好名 `dynamicWorkflowEnabled`（boolean optional）两侧同名；判定同为 fail-open `enabled !== false`（真值 P_t；我方 handlers/index.ts:257 只在显式 false 下架）。
- 灰度下架名单：十个工具名逐字一致（我方 DYNAMIC_WORKFLOW_TOOL_NAMES = 真值 Dya）。旧的 `Workflow` 工具**不在**名单（真值注释同义）——条目缺失本身归 B1。
- 关闭态联动：`dynamic-workflows` 技能随灰度门一起禁用（我方 create-app.ts:753-757 collectDynamicWorkflowDisabledSkillPaths = 真值 M$o($)）；Agent/Task 描述随门切换（我方 createAgentToolEntry dynamicWorkflowEnabled = 真值 prompt 侧 `dynamicWorkflowEnabled===!1?[]:[workflow 指令行]`）。
- 门源：我方结论缓存在 appRuntimePreferences，由 Host `/client/configs` 的 dynamicWorkflow.mode 推（drora-protocol/dynamic-workflow-policy.ts）；真值侧同名偏好直连 config——CLI 面语义一致，宿主侧来源是产品差异（OPEN-QUESTION Q1）。

## §6 差集三分类

| # | 分类 | 级别 | 内容 | 证据 |
| --- | --- | --- | --- | --- |
| D1 | SHAPE-DIFF | P3 | 品牌改名一族：`/\.zcode/`→`/\.drora/`、`.zcode/workflow-drafts`→`.drora/workflow-drafts`、`__zcode-dwf-child`→`__drora-dwf-child`、`/* zcode-workflow`→`/* drora-workflow`、入口头注释 @zcode→@drora、tmpdir 回落 `zcode-workflow-runs`→`drora-workflow-runs` | 真值 1383536/7690293 等 vs contracts/src/tools/saved-workflow.ts:4-14、dwf-child-command.ts:2、child-entry-file.ts:47-52 |
| D2 | SHAPE-DIFF | P3 | 隐蔽改名连带：模型可见文案里的块标记同步改为 `drora-workflow`（CREATE_WORKFLOW_ARGS_WITHOUT_PATH_ERROR / SAVE_WORKFLOW_SENTINEL_IN_SCRIPT_ERROR），与真值字符串仅此一词之差 | create-workflow.ts:25、save-workflow.ts:17 vs 真值 1385640 |
| D3 | OPEN（归 B1） | P1 | `Workflow` 工具条目缺失（本域只确认 handlers/index.ts:70,136 注释、真值含该工具门控位；条目面归 B1 报告） | handlers/index.ts:70 |

REAL-GAP：0（本域未发现缺失行为）。EXTRA：0（未发现真值没有而我方多出的行为；`retuned`、`possiblyInterrupted`、health 块等均真值同在）。

## §7 OPEN-QUESTION

- Q1：灰度门的取数来源——真值 30 处 dynamicWorkflowEnabled 未见 Host `/client/configs` 推送链，我方由桌面 Host 决策后推给 CLI。CLI 面行为等价，宿主侧来源差异是否在桌面域（J 其他成员）核对范围，待确认。
- Q2：真值 EvalWorkflowSnippet 输出 schema 的 logs 数组未在 zod 层限条数（仅单条 2048），我方同样 schema 不限、service 侧截 100 条。两侧策略一致，但 100 这个数在真值 bundle 中未定位到对应常量（可能内联），未逐字验证。
- Q3：引擎并发自适应的数值常量（0.75/4/3e5）在真值混淆体中只能数值侧证（`.75`×4、`3e5`×10），未逐常量定位归属；结构（sink 方法集、epoch 阻尼接口）已确认一致。
