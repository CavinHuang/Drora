# 批次 5：官方 bundle 会话运行时与持久化机制调研报告

- 目标文件：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 字节，esbuild 单文件 bundle）
- 调研方式：只读 grep/dd 取证；所有函数名均来自 bundle 内 `r(fn,"保留名")` 注册点。
- 日期：2026-10-19

---

## 1. sessionStore 全貌：SQLite 单引擎（node:sqlite DatabaseSync）

### 1.1 实现类与入口

| 保留名 | 符号 | 说明 |
| --- | --- | --- |
| `SqliteSessionStore` | `mG`（class，`r(this,"SqliteSessionStore")`，offset≈1617869） | 唯一会话存储实现 |
| `openStartupSqliteSessionStore` | `Zot` | 启动入口，`new mG(...)` |
| `openStartup`（static） | `mG.openStartup` | 先开库再 `DPr(db,dbPath)` 跑迁移；外层日志 `bootstrap.app.startup.sqlite_migration.started/completed`（stage=`migrate_session_db`） |
| `getSessionDbPath` | `vae` / `_in()` | `join(homedir(), ".zcode", "cli", "db", "db.sqlite")` |
| `closeSessionStore` / `openStartupSessionStore` | `YIt` / `LYo` | bootstrap 关闭/打开钩子 |

摘录（构造函数）：

```js
b2r=require("node:sqlite");
this.dbPath=t.dbPath??_in();
this.db=new b2r.DatabaseSync(this.dbPath,{timeout:o})   // node:sqlite 同步 API
throw new FF(`Failed to open SQLite session database at ${this.dbPath}`,{kind:"open_failed"})
```

- 配置默认值：`storage:{dir:"~/.zcode",sessionDbPath:"~/.zcode/cli/db/db.sqlite"}`；`storage.dir` 可被 `~/.zcode/cli/config.json` 或 `ZCODE_STORAGE_DIR` 覆盖。
- 写入前统一走 `throwBeforeWrite()`（`sqliteOpen/sqliteRun` 故障注入探针，`createStorageFsFaultInjector`）。
- 诊断命令行支持 `debugCounts`（`WPr`）、`debugMigrationIds`（`qPr`）。

### 1.2 库文件路径

- `~/.zcode/cli/db/db.sqlite`（含 WAL 等由 node:sqlite 自管）。
- 同目录族：`cli/artifacts`（工具产物/checkpoint 快照）、`cli/image-cache`、`cli/pdf-cache`、`cli/video-cache`、`cli/exec`（exec 输出）、`cli/sessions/<sessionId>/workflows/<name>`、`cli/log`、`cli/workflows`（工作流文件 journal）、`security/workspace-hook-trust-v1.json`、`memories/projects/<slug>-<hash16>/memory`（项目记忆）。
- `~/.zcode/v2/`：`telemetry-state.json`、`credentials.json`、`agents-state.json`（应用级状态，与 cli/ 分离）。

### 1.3 表结构（22 个 migration，`sqlite_master` 校验 + `schema_migration` 表）

migration 清单（`{appVersion,id}`）：`0001_base_session_store` → `0022_backfilled_session_reasoning`。关键 DDL 摘录：

- `session`：`id, project_id, workspace_id, parent_id, slug, directory, path, title, version, share_url, summary_additions/deletions/files/diffs, revert, permission, time_created/updated/compacting/archived`。`time_compacting` 列持久化 compact 进行中状态；`revert` 列存 rewind 状态；`parent_id` 支撑 fork/子会话。
- `message`：`id, session_id→session(on delete cascade), time_created, time_updated, data(text JSON)`，索引 `(session_id,time_created,id)`。
- `part`：`id, message_id→message(cascade), session_id, time_created/updated, data`，索引 `(message_id,id)`、`(session_id)`。消息与 part 分表，part 独立更新。
- `todo`：`session_id, content, status, priority, position`，主键 `(session_id, position)` —— TodoWrite/TodoRead 直接落库。
- `session_entry`：`id, session_id, type, time_created/updated, data` —— 通用事件/条目存储（如 `v4/command_fact`、compact timeline、workflow 激活等）。
- `session_input`（0016 建、0017 重建）：**CommandInbox 持久台账**。`id, session_id, kind, delivery in('startNow','guide','queue'), payload, admitted_sequence, promoted_sequence, promoted_message_id, status in('admitted','promoted','cancelled','discarded'), status_reason`；索引 `(session_id,admitted_sequence)`、`(session_id,status)`。
- `session_target` / `session_target_next`（0004/0005）：目标（objective）管理，含 `status in('active','paused','complete'|+'budget_limited')`、`token_budget`、`tokens_used`、`time_used_seconds` 及 0013 的 `active_input_id, active_run_started_at, active_run_last_seen_at`（**运行心跳/陈旧运行恢复字段**）。
- `local_setting`（0002）：`scope, scope_id, namespace, key, value, schema_version, time_created/updated`，主键 `(scope,scope_id,namespace,key)`；0003 把旧 `permission` 表数据 backfill 进来（`scope='project', namespace='permission', key='ruleset'`）。权限模式：`getProjectPermissionMode`（`TRr`）读 `namespace='permission', key='mode'`，值为 `JSON {mode}`；`saveProjectPermissionMode`（`IRr`）写回。
- `input_history`（0001 建，0006 加 attachments）：`project_id, session_id, text, kind, time_created`，按项目+时间索引（输入历史召回 `recallPreviousInputHistory`）。
- 用途观测表（0010）：`model_usage`、`turn_usage`、`tool_usage`（`recordModelUsage/upsertTurnUsage/upsertToolUsage/pruneUsage/queryAppUsage/queryTaskUsage`）。
- 脚本工作流（0007/0008）：`workflow_definition`（含 source/enabled、scope）、`workflow_run`（`status in pending/running/paused/completed/failed/cancelled`、`budget_total/budget_spent`、`script_hash/args_hash`、`parent_session_id`）、`workflow_activity`（`call_path/attempt/input_hash` 缓存）。
- 动态工作流 journal（0019）：`dwf_run`（`caps_max_concurrency`、`spent_tokens`、`resumed_from`、`script_hash`）、`dwf_actor`（`site_id/ordinal/persona_json/resolved_model/session_id`）、`dwf_node`（`kind in('ask','world-read','world-run','report','artifact')`、`input_hash`、`result_json`）、`dwf_event`。
- 其余：`session_task_link`、`session_trace_id`（0012）、`session_title_metadata`（0009）、`provider_model_selection`（0020/0021）。

### 1.4 SqliteSessionStore 方法面（约 60 个 async 方法）

`createSession, createForkedSessionWithMetadata, commitForkBundle, getSession, updateSession, listSessions, readCurrent, messages, messageWithParts, saveMessage, savePart, removeMessage/removePart, saveSessionEntry, sessionEntries, readTodos, updateTodos, saveSessionInput, updateSessionInputs, promoteSessionInput, markSessionInputPromoted, settleSessionInput, listSessionInputs, getSessionInputById, createTarget/setTarget/readTarget/clearTarget, startTargetRun, heartbeatTargetRun, finishTargetRun, recoverInterruptedTargetRun, accountTargetUsage, updateTargetStatus, updateTargetSummaryTitle, cloneTargetForFork, setRevert/clearRevert, getProjectPermission/saveProjectPermission/getProjectPermissionMode/saveProjectPermissionMode, commitPermissionFullAccess, recordInputHistory/recallPreviousInputHistory, recordModelUsage/upsertTurnUsage/upsertToolUsage/pruneUsage/queryAppUsage/queryTaskUsage, upsertScriptWorkflowDefinition/createScriptWorkflowRun/updateScriptWorkflowRun/getScriptWorkflowRun/listScriptWorkflowRuns/createScriptWorkflowActivity/updateScriptWorkflowActivity/findCachedScriptWorkflowActivity/listScriptWorkflowActivities/appendScriptWorkflowEvent/listScriptWorkflowEvents, createSessionTaskLink, workflowJournalStore()（dwf journal）, readArtifactFile/writeToolResultArtifact/writeToolResultBinaryArtifact/readToolResultBinaryArtifact/statToolResultArtifact/writeDerivedMediaAttachment, repairRemoteSessionPaths, repairLegacyRemoteSessionWorkspace, claimLegacySessionWorkspace, transitionSharedContextImport, commitSharedContextImportBundle, close`。

底层 helper 一律是 `function xPr(db,t)` 形式（如 `gOe`=createSession、`vM`=saveSessionEntry、`uG`=sessionEntries、`aPr/cPr/lPr/uPr`=target run 族、`t2r`=promoteSessionInput）。

> 结论：官方**没有文件型会话存储**；SQLite 是唯一权威会话存储。文件系统只承载二进制/大产物（artifact store）、工作流文件 journal、日志与缓存。

---

## 2. 会话生命周期

### 2.1 ID 体系（`createSessionId` 等保留名）

```js
function zv(e){return `sess_${e??crypto.randomUUID()}`}   // createSessionId
function zA(e){return `turn_${e??crypto.randomUUID()}`}   // createTurnId
function PI(e){return `evt_${e??crypto.randomUUID()}`}    // createEventId
function _De(e){return `tool_${e??crypto.randomUUID()}`}  // createToolCallId
function Ll(e){return `msg_${e??swr()}`}                  // createMessageId
function Fl(e){return `part_${e??swr()}`}                 // createPartId
function yDe(e){return `proj_${e??crypto.randomUUID()}`}  // createProjectId
function swr(){return `${Date.now().toString(36)}_${crypto.randomUUID()}`} // 可排序 id 段
```

- sessionId 格式 `sess_<uuid>`；mailbox 适配器用 `/^sess_[A-Za-z0-9._-]+$/` 严格校验。
- message/part id 带 base36 时间戳前缀，天然可排序。

### 2.2 写入时机：逐消息、逐 part 即时持久化

- `persistMessage`（`OBo`）→ `sessionStore.saveMessage(msg, trace)`，日志 `session.message.persisted`；`persistAssistantMessage`（`DBo`）、`persistUserPrompt`（`ABo`）、`persistSyntheticUserNotice(PBo/RBo)`、`persistCompactSummary`（`IBo`）、`persistCompactReminderMessage`（`kBa`）。
- `persistPart`（`MBo`）→ `savePart`，日志 `session.part.persisted`；part 级别即时写（流式工具输出、pending tool part `persistPendingToolPart`、compact timeline part 等）。
- 事件面：`eventStore.getEvents(sessionId)` + `eventReducer.reduce(events)` 重建状态；durable 事件经 `persistDurableSessionEvent`（`gBa`）追加；协议事件类型见 `nt.*`（SessionCreated/SessionResumed/TurnStarted/TurnComplete/ModelStreaming/ToolCall*/PermissionRequested/CheckpointCreated/RewindTriggered/StreamRecovery* 等），映射为协议事件名 `session.created/turn.started/message.upserted/checkpoint.created/rewind.triggered/streamRecovery.updated`。
- turn 结束落 `persistHighspeedTimingOnTurnTerminal`；每次请求用量经 `upsertTurnUsage` 入库。

### 2.3 resume 路径

- `resumeFromStore`（`Ajo`）：`getSession` → 归档检查（`time_archived` 非空即 SessionNotFound）→ `pBe()` 修复会话路径（`repairRemoteSessionPaths`，失败降级内存修复，事件 `session.path_repair.persist_failed`）→ `messages(sessionID)` 载入持久消息 → 恢复 `revert` 状态（targetMessageID/createdMessageID/keptMessageIDs/branchCutAfterMessageID/branchGeneration）→ `extractPersistedEnvInfo`（`$ja`）→ `restoreSessionShellEnvironmentSelectionForResume`（`nNo`）。
- bootstrap 层有 `prepareResume`、`zcode_protocol.session.resume_started/resume_persisted_missing` 日志与 `boundedResumeDiagnostics`（`nri`）。
- 其他 resume 侧函数：`activateSessionForResume`（`DFn`）、`syncPersistedSessionTitleForResume`（`Uja`）、`readSessionTodosForContext`（`Pjo`）、`readSessionTargetForContext`（`Rjo`）、`resolveBashShellSnapshotForResume`（`VMo`）、`recoverInterruptedTargetRun`、`recoverInterruptedCompactTimelines`（`TBo`）、`restoreDynamicWorkflowActivationOnResume`（`jNo`）、`reconcileWorkflowSnapshotForResume`（`_Se`）。

### 2.4 rewind / checkpoint 语义（重要判定）

- 命令：`parseRewindCommand`（`CDo`）、`parseMessageRewindArgs`（`xDo`）、`rewindScopeFromCommand`（`VMa`）、执行 `executeRewindCommand`（`g3o`）。
- **两类 rewind**：
  - 会话 rewind：`rewindConversationToMessage`（`T3o`）、`rewindToMessage`（`S3o`）、`applyConversationRewindPlan`（`C3o`）、`buildConversationRewindPlan`（`I3o`）、`applyRewindBranch`（`eci`）、`rewindCascadeToMessage`/`rewindWorkspaceCascadeToMessage`。
  - 工作区 rewind：`rewindWorkspaceToMessage`（`k3o`）、`rewindWorkspaceToCheckpoint`（`y3o`）、`buildWorkspaceFileRewindPlan`（`K3o`）、`applyWorkspaceFileRewind`（`J3o`）、`previewWorkspaceFileRewind`（`G3o`）、`compensateFileRewindJournal`（`V3a`，补偿日志）。
- **checkpoint 是"文件改动前快照"工件**：`parseWorkspaceCheckpointArtifact`（`f2`）的 schema：`{version:1, kind:"workspace_file_before_change", createdAt, toolCallId, toolName, files:[{path, existedBefore, beforeContent, afterContent?, afterContentLength?, structuredPatch[]} ]}`。每个破坏性工具调用前经 `emitFileMutationCheckpoint`（`tBo`）把改动前内容写入 **artifact store**（`zcode-artifact://<sessionId>/<artifactId>` URI，落在 `~/.zcode/cli/artifacts/<sessionId>/`）。
- checkpoint 引用结构：`{checkpointId, messageId, targetMessageId?, toolMessageId?, scope: conversation|workspace|both, snapshotRef(zcode-artifact URI), diffRef?, fileCount?, compactBoundaryId?, coveredByCompact?}`；恢复走 `artifactStore.readToolResultArtifact({uri: snapshotRef})` 再 `f2(JSON.parse)`。
- rewind 可行性判定：`evaluateRewindTarget`（`jhe`）返回 `strategy: active_chain|file_only|fork_required|unavailable`、`targetStatus: active_chain|covered_by_compact|missing`；compact 之后 workspace rewind 需 checkpoint（reason=`checkpoint_required_for_workspace_rewind`、`target_covered_by_compact_without_checkpoint`）。fork 必要时走 `forkWorkspaceFromCheckpoint`（`q3o`）、`commitForkBundle`、`createForkedSessionWithMetadata`（父会话写 `v4/command_fact` 条目保证 fork 幂等）。
- 持久化：`RewindTriggered`/`CheckpointCreated` 事件入 eventStore（`readSessionRewindEvents`、`parseRewindTriggeredPayload`、`persistWorkspaceCheckpointEntry/restoreWorkspaceCheckpointEntries`、`persistWorkspaceFileRewindEntry/restoreWorkspaceFileRewindEntries`）；session 行 `revert` 列存当前 revert 状态（`setRevert/clearRevert`）。

### 2.5 snapshot 1253 处的语义判定

1253 个 `snapshot` 命中是**多义混合**，按保留名归组：

1. **会话/会话快照（远程回放核心）**：`buildSessionSnapshot`（`BLn`，上限 `20*1024*1024` 字节）+ `mapSnapshotMessages`（`afc`）、`elideSessionSnapshotForIndex`（`Len`）、`createInitialConversationSnapshot`（`gsi`）、`createMutableConversationSnapshotAccumulator`（`qkr`）、`deriveZCodeTaskStatusFromSessionSnapshot`（`Wes`）、`taskSnapshotInvalidatedEventSchema`（协议）。用途：给远程客户端（手机 web-remote-replayable）一次性下发完整会话状态，事件做增量广播。**这是与 Drora "web-remote-replayable" 对应的官方机制**。
2. **shell init snapshot**：`ShellInitSnapshotManager`（`Fit`）、`shellInitSnapshotsDir`（`MMr`）、`createSnapshotFileName`（`Rxs`）、`cleanupStaleShellInitSnapshots`（`NMr`）、`persistSessionShellEnvironmentSnapshot`（`tNo`）——bash 启动环境快照脚本（导出 PATH 等），`ZCODE_SHELL_INIT_SNAPSHOT` 环境变量注入，与 Claude Code 的 shell snapshot 同构。
3. **上下文快照**：`buildPersistedContextSnapshot`（`xBa`）、`createContextBuilderFromSnapshot`（`p4o`）、`buildContextUsageSnapshot`（`J4o`）等 —— token 语境统计。
4. **工作流任务快照**：`getWorkflowTaskSnapshot`（`pei`）、`createRuntimeTaskSnapshot`（`ECn`）、`reconcileWorkflowSnapshotForResume`、`cancelWorkflowSnapshot`（`Jbt`）。
5. **git snapshot**：`resolveGitSnapshot`（`lOr`）—— 会话摘要用 git 状态。
6. 其余为打包库噪声（TS 编译器 `StringScriptSnapshot`、CDP DOM snapshot、发布版本 `snapshotFromRelease` 等）。

> 判定：官方 "snapshot" **不是**统一的文件系统/git 快照，而是"协议层会话状态快照 + 工具产物文件快照（checkpoint）+ shell 环境快照"三个不同机制共用一个词。checkpoint 的文件回滚依赖 artifact store 中的 before-content，而非 git。

---

## 3. 压缩与上下文管理

### 3.1 手动 /compact

`parseCompactCommand`（`IDo`）→ `startManualCompact`（`sLn`）→ `executeManualCompact`（`w6o`）→ `compactActiveConversation`（`m3o`）/`compactActiveConversationImpl`（`f3a`）。feature 开关 `features.compact`（默认 true）。

### 3.2 自动 compact（存在，绝对 token 阈值而非百分比）

保留名：`shouldAutoCompact`（`Mht`）、`getAutoCompactThreshold`（`A4e`）、`getAutoCompactOutputReserveTokens`（`Cbn`）、`getEffectiveContextWindowSize`（`Ibn`）、`autoCompactIfNeeded`（`k6o`，在 turn 执行路径中 reason=`ContextLimit` 调用）、`reactiveCompactAfterContextExceeded`（`T6o`，prompt-too-long 后被动补偿）、`isAutoCompactRetryableError`（`m3a`）、`autoCompactDecisionLogContext`（`nwe`）。

常量（offset≈5017735 附近同族）：

```js
cve=2e5        // 默认 contextWindow = 200,000
Epo=32e3       // 默认 maxOutputTokens = 32,000
oda=21e3       // 输出预留上限 = 21,000
Apo=13e3       // bufferTokens 默认 = 13,000
Ppo=100        // thresholdPercent = 100
```

公式：`outputReserve = min(maxOutputTokens ?? 32k, 21k)`；`effectiveWindow = contextWindow − outputReserve`；`threshold = effectiveWindow − bufferTokens(默认 13k)`；估算 token（`pP(messages)` 或 provider 侧 `tokenOverride`：base/cacheRead/cacheWrite/contextUsage/incremental）≥ threshold 即触发。**没有可配置的"百分比"参数**——阈值是绝对 token 数推导，与批次 4 结论一致（无 auto-compact 百分比配置，但自动 compact 机制本身存在）。

### 3.3 microcompact（存在）

- `microcompactIfNeeded`（`r3o`）、`resolveMicrocompactTrigger`（`sda`）两种触发：`TimeBased`（空闲 `idleThresholdMinutes` 默认 `ida=60` 分钟，且只在 assistant 完成后判定）与 `TokenPressure`（`estimatedTokenCount >= thresholdTokens`）。
- 默认阈值 `buildDefaultMicrocompactThreshold`（`Lht`）：`min(floor(window*0.9), window−2000)`（`Lpo=.9, Fpo=2e3`）。
- 清理对象：可压缩工具结果组 `collectCompactableToolResultGroups`（`ada`），默认工具集 `jpo=["Read","Bash","Grep","Glob","WebFetch","WebSearch","Edit","Write","ApplyPatch"]`，`clearErrorResults` 可选；本地变体 `maybeLocalMicrocompactMessages`（`Fht`）、`maybeLocalMicrocompactRuntimeEntries`（`IOo`）、`resolveLocalMicrocompactConfig`（`Y6a`）。
- 失败处理：`isCompactPromptTooLongRetryMarker`、`truncateCompactSummaryRequestEntriesAfterPromptTooLong`（`IEn`）、`selectCompactEntriesForInitialPromptTooLong`（`TEn`）、`truncateRuntimeEntriesForCompactRetry`（`jNa`）、`projectCompactMediaForRetry`（`DEn`）、`createCompactRapidRefillError`（`SSt`）。

### 3.4 compact 持久化与恢复

- 边界：`createCompactBoundaryId`（`Rht`）、`applyCompactBoundary`（`zrn`）、`parseCompactBoundaryPayload`（`VH`）、`isCompactBoundaryItem`（`$Tr`）、`isActiveCompactionBoundaryMessage`（`F3o`）。
- 时间线：`persistCompactTimeline`（`kBo`）/`persistCompactTimelineEvent`（`bBe`，存 session_entry）、`recoverInterruptedCompactTimelines`（`TBo`，resume 时恢复/终止 running 状态的 compact，`wBa`=isRecoverableRunningCompactTimelineStatus）。
- 摘要生成：`buildCompactPrompt`（`Tht`）、`runCompactSummaryModelRequest`（`l3o`）、`compactModelStream`（`i3a`）、`capCompactSummaryMaxOutputTokens`（`_3a`）、`persistCompactSummary`（`IBo`）；compact 期间 session 行 `time_compacting` 置位。
- 后处理：`buildPostCompactRuntimeEntries`（`TOo`）、`buildPostCompactReadStateEntry/ReminderEntries`（`vEn/bEn`，post-compact 读态提醒）、`removeCompactPersistenceMessagesBestEffort`（`EBo`）、`selectPersistedCompactTail`（`vOo`）。
- `sessionStore.messages` + 保留预算共同决定压缩选择（`hasEnoughRuntimeEntriesToCompact`、`hasEnoughMessagesToCompact`（`sve`）、`selectCompactEntries`（`M3e`））。

---

## 4. CommandInbox 与 admission

### 4.1 CommandInbox（`WCt`，`r(this,"CommandInbox")`，offset≈14451610）

字段：`host, inFlight(Map), liveInputs(Map), settled(Map), admissionSeq(Map), keyGates, sessionGates`。`AsyncGateRegistry`（`qCt`）提供 per-key promise 链式串行化。

`handle(envelope)` 决策流水：

1. `kDe` payload 校验失败 → ack `rejected/proto.invalidPayload`。
2. 幂等：in-flight 同 commandId 或 `lookupExact`（内存 settled → `host.lookupTranscriptCommand/lookupTimelineCommand/lookupChildCommand/lookupDiscardedCommand`）→ `retryAck`。
3. **revision/epoch 校验（stale 防护）**：`baseRevision !== host.getRevision(sessionId)` → `stale/proto.staleRevision`；`baseLogEpoch !== host.getLogEpoch` → `stale/proto.staleLogEpoch`（rewind/fork 等 log 纪元变更）；缺 `baseRevision` → `rejected/proto.missingBaseRevision`；session 不存在 → `proto.sessionNotFound`。
4. 行级目标校验 `validateRowTarget` + 自定义 `host.guard`（verdict: stale/reject/noop/allow）。
5. 通过则分配 `admissionSeq`（per-session 自增）、`admittedAt`、`queueItemId = fUe(commandId) = `queue_${commandId}``，返回 `{kind:"execute", ack:"accepted", admissionSeq, settle}`；settle 后写入 settled 缓存并释放 session gate。

内存清理：`clearSession`（仅当无 pinned 状态）、`disposeSession/deactivateSession`（`clearCommandInbox` 开关）。

### 4.2 持久化台账（session_input 表）

admission 成功后：

```js
await deps.sessionStore.saveSessionInput({
  id: queueItemId /* queue_<commandId> */, sessionID, kind,
  delivery: <startNow|guide|queue>, payload:{text, intent:{sourceCommandId,...}}, ...})
```

turn 消费时 `promoteSessionInput({id: sessionInputId, message...})` 写 `promoted_message_id`；`settleSessionInput`/`updateSessionInputs` 终态 `promoted/cancelled/discarded` + `status_reason`。busy/running 输入排队语义：delivery=`queue`（排队）、`guide`（引导）、`startNow`（立即）。

### 4.3 lease / owner 机制（验证 AGENTS.md 对应物）

1. **跨 Host 任务租约（wire 协议）**：`task-run-lease-acquire` / `task-run-lease-release` / `task-run-lease-result` / `task-owner-command-request|result` / `task-realtime-deliver|publish` / `task-stream-op-publish` / `broadcast-claim-release`。schema：`taskRunLeaseAcquireRequestSchema`（`CYt`：含 `leaseRequestId`、`baseRevision` superRefine 校验）、`taskRunLeaseResultSchema`（`EYt`：discriminated union `acquired:true` 时带 `ownerHostId`）、`taskRunLeaseTargetSchema`（`IYt`）。这是手机/远程客户端 → 桌面 Host 的 owner/lease 路由协议（与"外部 relay 只做鉴权配对转发、desktop 持有 attachment"的官方形态一致）。
2. **target run 心跳（SQLite，陈旧运行防护）**：`startTargetRun`（`aPr`）写 `active_input_id + active_run_started_at + active_run_last_seen_at`；`heartbeatTargetRun`（`cPr`）推进 `last_seen_at`（带 `max()` 防回退）；`finishTargetRun`（`lPr`）按精确 `active_input_id + active_run_started_at` 条件清零并累计 `tokens_used/time_used_seconds`（超 `token_budget` → `budget_limited`）；`recoverInterruptedTargetRun`（`uPr`）在 resume 发现未闭合 run 时结算耗时并把 status 置 `paused`。
3. **文件锁（非会话 lease）**：`FileWorkspaceHookTrustStore` 的 `acquireLock`（`wx` 独占 + `{pid,startTime,token}` JSON + `removeStaleLock`（`removeStaleLockMs` 默认 30s，进程存活探测 `process.kill(pid,0)` + 进程启动时间比对 `jbs=2s` 容差，win32 用 PowerShell 查 StartTime））。
4. **MCP OAuth 授权租约**：`tryAcquireAuthorizationLease`（`Cuo`，`.authz` 文件锁）、`acquireForegroundPromotionLease`/`releaseForegroundPromotionLease`（`_Fo/yFo`）。

---

## 5. mailbox 目录（`~/.zcode/mailbox`）

- 构造：`sessionMailboxPort = f8o({rootDir: K0(env.ZCODE_MAILBOX_ROOT ?? "~/.zcode/mailbox")})`（`f8o`=`createNodeSessionMailboxAdapter`）。
- 实现 `NodeSessionMailboxAdapter`（`WPn`）：
  - `drainUnread({sessionId, limit=20})`：列 `<root>/<toSessionId>/unread/*.json` 排序取前 limit 条，逐条 parse 后 `rename` 到 `.../read/`（原子消费）。
  - `sessionDir` 强校验 `/^sess_[A-Za-z0-9._-]+$/` + relative 路径防穿越（`Session mailbox path escapes root`）。
  - envelope：`{version:1, messageId, fromSessionId, toSessionId, content, createdAt}`（`parseEnvelope`（`r8a`）严格校验）。
- **消费侧**：`createSessionMailboxHookRegistrations`（`Pgt`）注册内建 hook（事件 `UserPromptSubmit` / `PostToolUse` / `Stop`，descriptor `source:"builtin.sessionMailbox.drain"`）。PostToolUse 时若有 `enqueuePendingInput` 则把每条消息排队为 pending input（origin=`mailbox`，来源分类 `subagent_message/subagent → mailbox`）；否则在 hook 输出注入 `<session-message source="mailbox" message_id=... from_session=... created_at=...>` 上下文（`formatMailboxMessages`（`Fho`），含 "For reference only. Verify against raw source before acting." 提示语，属性 HTML 转义）。
- **写入侧不在 CLI bundle 内**（bundle 仅 drain；桌面端/其他会话直接向 `unread/` 落 JSON 文件）。用途判定：**跨会话/子代理→主会话的信箱**（subagent 消息、后台结果回投），不是用户级通知系统。

---

## 6. plans / agents / workflows 子目录

### 6.1 plans（工作区内，非 ~/.zcode）

- 路径：`<workspaceRoot>/.zcode/plans/plan-<sanitizeSessionId(sessionId)>.md`（`Nxo`；`HIa` 白名单 `[^A-Za-z0-9._-]→'-'`）。
- 写入者：ExitPlanMode 审批流 `Lxo`：plan 非空校验 → `fileSystemPort.writeTextFile({atomic:true, createParents:true})`；批准后 `readApprovedPlanFileReferenceEntry`（`Fxo`）在后续 turn 注入 `plan_file_reference` 附件（"A pla..." 前缀的引用块）。

### 6.2 agents（`~/.zcode/agents`）

- `subagentOutputRootDir = join(cliStorageRoot,"agents")` —— 子代理输出根目录。
- 状态文件 `~/.zcode/v2/agents-state.json`（`vlc` 读取 `pluginAgentModelSelectionOverrides` 等；启动清理 `FJt(join(storageRoot,"agents"))`）。
- 定义加载：workspace `.zcode/agents/*.md`（agent 定义 markdown，与 `.zcode/skills`、`.zcode/commands` 同族；插件内 `agents/` 目录亦然，见 `.zcode-plugin-seed.json` 目录集）；磁盘占用分类 `subagentTranscripts` 属清理类目。
- dwf actor（动态工作流子代理）的 session 关联则在 SQLite `dwf_actor.session_id`。

### 6.3 workflows（`~/.zcode/cli/workflows`）

- `kdo = join(homedir(),".zcode","cli","workflows")`；`NodeWorkflowStore`（`kvn`，文件型，全部 `.json`/NDJSON）：
  - `writeSnapshot/readRun`（`snapshotPath(runId)`，schema `oon`）、`appendEvent/readEvents`（`eventsPath(runId)`，事件 schema `ion`）、`appendGraphRecord`（graphPath）、`writeArtifact/writeReport`（`runRoot/<sanitized>/report.md`）、`upsertIndex/readIndex/listRuns/readLatestRun`（index 按 cwd/kind 过滤、updatedAt 排序）。
- 与 SQLite 分工：`workflow_definition/workflow_run/workflow_activity` 表存脚本工作流定义与缓存活动（`upsertScriptWorkflowDefinition` 等），`dwf_run/dwf_actor/dwf_node/dwf_event` 表存动态工作流 journal；文件 store 承载运行期事件流与产物快照。另有 per-session 工作流输出目录 `~/.zcode/cli/sessions/<sessionId>/workflows/<name>`（`vei`）。

---

## 7. 其他与 Drora 对齐相关的确认点

- 权限模式持久化：`local_setting(scope='project', scope_id=projectID, namespace='permission', key='mode', value=JSON {mode})`；规则集 `key='ruleset'`。`commitPermissionFullAccess` 以 session entry 记录（key 模板 `${sessionId}:permission-full-access:<...>`）。
- feature 开关：`features:{compact,rewind,subagent,memory,skill,mcp}` 默认全 true，由 feature store（`hs.FeatureCompact` 等）覆盖。
- Todo：`readTodos/updateTodos` 直读 SQLite `todo` 表（TodoRead/TodoWrite 工具端口 `sessionStore` 必配，缺失报 `SessionStorePort is not configured for TodoRead/TodoWrite`）。
- 项目记忆：`resolveProjectMemoryRoot`（`P4e`）= `<cliStorageRoot>/memories/projects/<slug>-<sha256(identity|path)[0..16]>/memory`；workspaceIdentity 非空用 `project` 前缀+identity hash，否则用路径 slug+path hash（win32 路径小写归一）。
- 输入历史：`input_history` 表按 project 记录，`recallPreviousInputHistory` 支撑上翻召回。
- fork：`createForkedSessionWithMetadata` 事务内先查父会话 `v4/command_fact` 条目（`id=v4_command_fact:child:<parentSessionId>:<sourceCommandId>`）保证 fork 幂等，子会话 `parentID` 指回父会话。

## 8. 验证命令备忘

```bash
grep -ob 'r(this,"SqliteSessionStore")' zcode.cjs          # 1617869
grep -ob 'r(this,"CommandInbox")' zcode.cjs                # 14451610
grep -o '{appVersion:"[^"]*",id:"[^"]*"' zcode.cjs          # 22 migrations
grep -o 'create table if not exists [a-z_]*' zcode.cjs      # 24 tables
grep -o 'features:{compact:[^}]*}' zcode.cjs                # feature flags
grep -o 'Lpo=.9,Fpo=2e3,jpo=\[[^]]*\]' zcode.cjs            # microcompact 常量
```
