# B08 - checkpoints/rewind/快照恢复链 对拍报告（pass27, 2026-10-08）

真值 = `D:\software\zcode\resources\glm\zcode.cjs`（0.16.9）。我方 = `apps/drora-cli` + `packages/shared`（分支 feat/migrate-remote-and-pet）。
证据偏移均为 zcode.cjs 字节偏移；我方为 文件:行。全链重测，未沿用历史结论。

## §1 真值 checkpoint 面

**创建时机（重测确认：按文件修改，非按回合）**
- 每个成功的文件变更 tool result 闭合后触发 `emitFileMutationCheckpoint`（偏移 13157350 附近，`IRo`）：从 tool output 解析 `filePath+structuredPatch+originalFile`（`getFileMutationCheckpointCandidate`，12681330 附近 `xko`），逐次写 artifact 并发 `CheckpointCreated` 事件。非回合级、非消息级。
- 触发条件：`artifactStore` 已配置 且 `result.success`；解析失败/写失败仅 warn（`checkpoint.create.failed`），不中断回合。
- 事件 payload：`checkpointId=checkpoint_${uuid}`、`messageId`、`targetMessageId=messageId`、`toolMessageId`、`scope=workspace`、`snapshotRef=uri`、`diffRef=同 uri`、`fileCount:1`（13157600 附近）。每次一个文件。
- 同时累积 `currentTurnFileChanges`（`hTo`），供 turn 行 `fileChanges`/`canRewindFiles` 与按 turnId 的文件级 rewind 预览。

**存储结构**
- artifact JSON：`version:1, kind:"workspace_file_before_change", createdAt, toolCallId, toolName, files[{path, existedBefore, beforeContent(可 null), afterContent?, afterContentLength?, structuredPatch[]}]`（`Tko` stringify，1245300 附近）。
- contentType = `application/vnd.zcode.workspace-checkpoint+json`（12682704）；artifact store = `NodeToolArtifactStore`，落盘 `<root>/<sessionId>/<toolCallId>-tool-result-<uuid>.<ext>`，URI `zcode-artifact://<sessionId>/<artifactId>`（1561500-1563200）。
- 写入请求带 `retention:"session"` 元数据。
- 持久化：checkpoint 事件额外存 session entry（`persistWorkspaceCheckpointEntry`，12973400 附近），resume 时 `restoreWorkspaceCheckpointEntries` 按 sequenceNumber+created 排序回放、按 checkpointId 去重；file_summary_rewind 的 RewindTriggered 同样持久化回放（12974400 附近）。
- 投影：事件 reducer 把 `CheckpointCreated`→`lastCheckpoint`、`RewindTriggered`→`lastRewind`（1285500-1286000）。

**数量上限 / 清理策略**
- 创建无数量上限、无按天清理。全 bundle `retention` 47 处均只作写入元数据传递，无任何 `retention` 消费/清理路径；`deleteSession` 仅 closeSession（14400900-14402100），不删 artifact。
- 唯一的按天保留在 bash shell-snapshots（`retentionDays`，2132402 附近），与 checkpoint 无关。
- **历史"24h vs 30d 快照保留期"在 0.16.9 的 checkpoint 链中无对应实现**（无 86400/2592000 等数值出现在 rewind 链；86400 仅出现于 darwin 进程表解析）。
- `features.rewind` 配置键存在、默认 true（1300691/4118593），未发现运行时 gate 读取它禁用 rewind——声明未消费。

## §2 真值 rewind 面

**命令层**（`parseRewindCommand`，12675600-12677000；`executeRewindCommand`，13096000 附近）
- `/rewind`|`status`|`help`|`-h` → status；`/rewind latest`|`<checkpointId>` → apply（workspace 恢复）；`/rewind fork [id|latest]`；`/rewind <scope> <messageId>`（scope: conversation|message→conversation, code|workspace→workspace, both）；`/rewind cascade <scope> <messageId>` → cascade-message；`/fork [id|latest]` 独立命令。
- rewind 是一个完整 active turn：TurnStarted/TurnComplete 事件、turnNumber++、rebuildProjection；失败走 rewind.failed。

**可回退对象与级联**
- 三 scope：conversation（截断消息分支）/ workspace（恢复文件）/ both（先 workspace 后 conversation，拼两段 response，13104200 附近 `HPo`）。
- workspace→checkpoint（`rewindWorkspaceToCheckpoint`，13098754 附近 `qPo`）：查 CheckpointCreated（scope workspace|both）→ evaluate（策略 active_chain/file_only/unavailable）→ 读 artifact → 逐文件恢复 → 写 synthetic user notice + `messageHistory.addAttachment("rewind_notice")` → 发 RewindTriggered（payload 含 createdMessageId）。响应 "Rewound workspace to checkpoint X: restored N files."，file_only 时追加 "Workspace files were restored; conversation history stayed at the compacted context."。
- workspace 级联（`rewindWorkspaceToCheckpoints`/cascade，13104000-13108000）：目标消息命中多个 checkpoint 时按逆序逐个读、逐个恢复，响应 "Rewound workspace through N checkpoints to checkpoint X: restored M files."。
- conversation rewind（13108000-13113400，`YPo`/`XPo`/`Y1a`）：
  - 目标锚点重映射：scope 为 conversation/缺省且目标非 user prompt 时回退到最近 user prompt（`isRewindableUserPrompt`=role user 且非 summary）；reason 枚举 `target_message_not_found`/`target_message_is_not_user_prompt`/`conversation_rewind_requires_session_store`。
  - 级联范围：branch cut 游标 = 持久消息末尾，`keptMessageIDs`=保留前缀，`branchGeneration=(旧值??0)+1`，全部写入 `sessionStore.setRevert`（session.revert.{keptMessageIDs, branchCutAfterMessageID, branchGeneration, messageID, kind:"conversation_rewind", scope, targetMessageID}）。
  - **悬挂回合补偿（重测确认存在）**：`cancelRemovedBranchBackgroundTasks` 停掉 branchGeneration 匹配且 turnId ∈ removedTurnIds 的 running 后台任务，失败抛错；随后 `runtimeTaskRegistry.setActiveBranchGeneration`。
  - 派生状态重建：messageHistory.reset、按持久消息重建、readFileState 重建、cacheMiss、turnNumber 重算、currentTurnFileChanges 清空、autoCompactConsecutiveFailures=0。
  - conversation 的 RewindTriggered 额外带 `branchCutAfterMessageId` + `branchGeneration`。
- 不可用统一走 `finishUnavailableRewind`（strategy=unavailable，restoredSnapshotRef=void），reason 枚举：no_checkpoint_available / target_checkpoint_not_found / artifact_store_not_configured / file_system_port_not_configured / checkpoint_snapshot_unavailable / target_covered_by_compact_requires_fork 等（12681465 附近 `t_t`）。
- fork：`forkWorkspaceFromCheckpoint`（13143000 附近 `mRo`）与 `forkWorkspaceAtMessage`（13137600 附近 `lRo`）创建**新 session**（copySessionMessagesForFork + session_fork timeline separator + fork notice），发 `SessionForked`；fork-at-message 对每个 path 取首个 checkpoint 去重后恢复。`/rewind` 停留在当前会话，fork 换会话——两条链路明确分离。

**RPC 方法名与参数形状**
- 读：`v4/conversation/fileRewindPreview`（方法注册表 1123400 附近；参数含 sessionId、target{rowId}、baseLogEpoch、baseRevision，stale 校验 `proto.staleLogEpoch/staleRevision`）。
- 写（command schema，1142000-1146200）：`applyFileRewind{target}`、`editUserQuery{target,newText,attachments?,workspaceMode:"preserve"|"rewind"}`、`forkAssistant{target}`、`retryTurn{target}`；行守卫要求 turnHeader 行 `actions.canRewindFiles===true`（14207000 附近）。
- 响应：`{type:"applyFileRewind",applied,preview,response}`、`{type:"editUserQuery",disposition:"rewind"|"fork"|"blocked",sessionId,reasonCode?,preview?}`。
- 守卫 reasonCode：`guard.workspaceRewindUnsafeFiles` / `workspaceRewindIgnoredFiles` / `workspaceRewindUnavailable` / `workspaceRewindApplyConflict`（14385400-14386600 edit-retry 链）。
- 事件名映射：CheckpointCreated→`checkpoint.created`、RewindTriggered→`rewind.triggered`（14431400 附近）。
- TUI：`buildCheckpointSelection`/`checkpointToSelectionItem` checkpoint 选择器（14723171-14725400），command-center `/rewind`、`/fork` 无参时开选择器 limit 50（14737100-14738100）。

## §3 恢复链

- **/rewind workspace 恢复（qPo 路径）**：`restoreWorkspaceCheckpointFiles`（13137240 附近 `mTn`）逐文件：`!existedBefore||beforeContent===null` → `removeFile({missingOk:true})`（action=delete）；否则 `writeTextFile({content:beforeContent, createParents:true, atomic:true})`（action=restore）。**无冲突检测、无预览、直接覆写**——该路径语义就是"恢复到检查点"。
- **文件级 rewind（file_summary_rewind，turn 行/编辑重提）**：preview（13146500-13151000，`yRo`/`bRo`）：
  - checkpoint 选取：targetMessageIds → targetTurnId（含 `~` 复合 turn 排除）→ targetCheckpointId（`SIa`，13150400 附近）。
  - bash/shell/terminal 工具的 checkpoint 整体忽略 → `ignoredFiles`（reason=bash_ignored，`kIa`）。
  - afterContent 缺失时用 structuredPatch 对 beforeContent applyPatch(fuzzFactor:0) 重建（`wIa`）；不可重建 → unsafe（unsupported_checkpoint）。
  - 冲突策略：sha256 比对当前内容 vs 期望 afterContent，不一致 → unsafe（external_modified，附 currentHash/expectedHash）；读失败 → file_read_failed；artifact 读失败 → checkpoint_unreadable。
  - `canApply = safeFiles>0 && unsafeFiles==0`；不可 apply 时 operations=[]，**不部分执行**。
  - apply（`vRo`）：逐文件先记 journal（当前内容），再写；失败时 `compensateFileRewind` 按 journal 逆序恢复（13149800 附近 `bIa`），补偿失败升级 AggregateError；成功后执行 `commitAfterApply` 钩子再发 RewindTriggered（reason="file_summary_rewind"）。
- **排除清单**：bash/shell/terminal 类 checkpoint（bash_ignored）；除此之外只恢复 tool 触碰过的文件（artifact files 即全部范围），无 manifest、无全树拷贝。**历史"restoreSnapshotTree 把 manifest.json+after/ 覆写工作区"的险案在 0.16.9 不存在**：`restoreSnapshotTree` 0 命中，恢复仅基于 beforeContent/删除，bundle 中的 manifest.json 均属插件/技能种子。
- fork 恢复复用 `mTn`；多 checkpoint 按路径首见去重（`w.has(J.path)`）。

## §4 与 session 的关系

- 一切按 **sessionId** 绑定：事件（eventStore.getSessionId）、artifact（`zcode-artifact://<sessionId>/`）、持久 entry（sessionStore.saveSessionEntry{sessionID}）、revert 状态（session 记录上的 `revert` 字段）、resume 回放（per sessionID）。
- 真值 CLI 内无 workspaceIdentity 概念；/resume 按 sessionId 或 cwd。跨会话语义只通过 fork（child session 持 parentID，RewindTriggered 不跨会话）。
- conversation rewind 的 active-branch 裁剪（`selectActiveConversationBranch`，1245000 附近 `yA`）吃 session.revert 四元组，resume/cold projection/fork 共用。

## §5 差集三分类

| # | 分类 | 等级 | 内容 | 真值证据 | 我方证据 |
|---|------|------|------|----------|----------|
| 1 | SHAPE-DIFF | P3 | checkpoint contentType 品牌：`application/vnd.drora.workspace-checkpoint+json` vs 真值 `application/vnd.zcode.workspace-checkpoint+json`（rebrand，schema 解析不受影响） | offset 12682704 | core/src/runtime/helpers/rewind.ts:23 |
| 2 | SHAPE-DIFF | P3 | artifact URI scheme：`drora-artifact://` vs 真值 `zcode-artifact://`（NodeToolArtifactStore 逐行同构） | offset 1562690 | apps/drora-cli/packages/adapters/src/storage/index.ts:80 |
| 3 | EXTRA | P3 | 我方额外保留 drora-protocol(v1) 桌面桥也暴露 rewind/fileRewind 面（server.ts 路由 v4 方法），真值仅 v4+TUI 单面 | 全 bundle 仅一处 v4 注册表 | bootstrap/src/drora-protocol/server.ts:519 |
| 4 | SHAPE-DIFF | P3 | 真值 v4 行 schema 的 timelineMarker 联合含 `checkpointRestored{checkpointId}`、`retryNotice`、`goalSet` 成员；我方仅在 packages/shared rows.ts 镜像 schema，CLI product-projection 与真值同样不构造（真值各仅 1 处 schema 命中）→ 形状一致、双侧同为死成员 | offset 688519/688436 | packages/shared/src/drora-protocol-v4/rows.ts:383,389 |

**REAL-GAP：0 条。** checkpoint 创建（逐文件、success+artifactStore 门控、fileCount:1、事件 payload 全字段）、rewind 命令文法（status/fork/cascade/latest/scope 别名）、evaluate 策略机（含 `target_covered_by_compact_active_branch_rebuild`）、conversation rewind（remapAssistantAnchor、setRevert 四元组、branchGeneration、悬挂回合补偿、派生状态重建清单）、file_summary_rewind（preview 四类 unsafe/ignored、sha256 external_modified、journal 逆序补偿、commitAfterApply、`~` turn 守卫）、持久化 entry 回放去重、fork 双路径（checkpoint/message、路径首见去重、session_fork timeline）、v4 RPC（fileRewindPreview/applyFileRewind/editUserQuery workspaceMode/disposition/守卫 reasonCode）、TUI 选择器（limit 50、文案逐字一致）、checkpoint 列表字段（diffRef/preview/coveredByCompact/limit）——全部逐点对上。

**P1/P2：无。**

## §6 OPEN-QUESTION

1. **快照保留期数字（24h vs 30d）**：0.16.9 checkpoint/rewind 链无任何按天清理；`retention:"session"` 为双侧均未消费的惰性元数据。历史争论对象可能指 shell-snapshot（真值 retentionDays）或 session 事件保留，不属本域——建议在 D-存储域复核。
2. **artifact GC 边界**：双侧 deleteSession 均只 close 会话；session 目录下 artifact 是否由上层（桌面/存储域）清理，bundle 内未见，需运行时验证。
3. **`features.rewind` 消费点**：双侧均只存取配置（默认 true），未发现禁用 rewind 的运行时 gate；是否在更外层（host/协议 admission）生效无法从 bundle 静态确认。
4. **truth 选择器调用上限**：`buildCheckpointSelection` 的调用方 limit 50 与我方一致（14737400 处实证），但无法排除其他调用点用不同 limit。

## 附：我方对拍入口清单（全部为实证对读）

- contracts：`packages/contracts/src/rewind/index.ts`（schemas/evaluate/active-branch，与真值 1242700-1245100 逐字段同构）
- core：`runtime/helpers/rewind.ts`、`runtime/methods/rewind.ts`、`rewind-message.ts`、`file-rewind.ts`、`tools.ts:169`（emitFileMutationCheckpoint）、`turn-tools.ts:370`、`workspace-checkpoint-persistence.ts`、`workspace-fork.ts`、`session-fork.ts`、`workspace-checkpoints.ts`、`helpers/commands.ts:17`（parseRewindCommand）、`methods/resume.ts:191`
- bootstrap：`drora-protocol-v4/commands/handlers/file-rewind.ts`、`fork-edit-retry.ts:160-201`、`product-projection.ts:1268,1846`、`drora-protocol/server.ts:519`、`v4-bridge.ts:1748`
- cli：`command-center/create.ts:240-258`、`selections.ts:34`
- 协议：`packages/shared/src/drora-protocol-v4/command.ts:153-403`、`rows.ts:383-389`
- 适配器：`adapters/src/storage/index.ts:41`（NodeToolArtifactStore）、`adapters/src/config/index.ts:119-285`（features.rewind）
