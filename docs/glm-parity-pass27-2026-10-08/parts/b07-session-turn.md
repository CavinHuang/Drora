# pass27 D1 对拍报告：会话/回合状态机（b07）

- 真值：D:\software\zcode\resources\glm\zcode.cjs（0.16.9，14,820,819 字节，单行 CJS）
- 我方：D:\workspace\projects\Drora @ feat/migrate-remote-and-pet（基线新鲜，ahead 14）
- 我方 apps/drora-cli package.json version = "0.16.9"，与真值同版本号；本域代码为逐函数移植，重测结论以 bundle 偏移证据为准。
- 方法：grep -ob 定位 → node 按偏移截取 ≤4000 字节窗口；关键 token 双向计数；`event:` 日志标记与 zcode_protocol/drora_protocol 命名空间全集差集。

## §1 回合状态机

结论：与真值完全同源（1:1）。

| 项 | 真值证据（偏移） | 我方证据 | 结果 |
| --- | --- | --- | --- |
| TurnPhase 枚举 10 态 idle/processing_input/awaiting_model_response/streaming/scheduling_tools/executing_tools/aggregating_results/awaiting_permission/completing/error | @4795310（Zl={...}） | core/src/agent/turn-state.ts:25-36 | 一致 |
| 迁移表（含 Completing/Error→Idle，终态 isTerminalPhase=Completing‖Error） | @4794640-4795100 | turn-state.ts:230-263 | 逐项一致 |
| TurnMachineImpl 全方法（start/startModelRequest/receiveModelResponse/scheduleTools/queuePendingInput/drainPendingInputs/requestPermission/resolvePermission/complete/fail/getNextPhase/isComplete） | @4795850-4799200 | core/src/agent/turn-machine.ts:68-344 | 逐方法一致（含错误文案 "Must be in ProcessingInput or AggregatingResults phase"） |
| InvalidTurnPhase 错误抛出（recoverable:true） | @1299286, @4795993 | turn-machine.ts:92-104 | 一致 |
| TurnResultType success/cancelled/error_max_turns/error_max_budget/error_during_execution/error_max_tool_calls | @751700（zod enum） | turn-state.ts:149-156 | 一致 |
| CoreErrorType 30 项（SessionNotFound…Cancelled/UnknownError） | @1299267-1300020 | contracts/src/errors/index.ts:9-50 | 逐项一致 |
| abort/cancel 路径：createTurnAbortScope/throwIfTurnAborted/createTurnFailureError/createTurnCancelledError/appendTurnOutcomeEvent/isTurnCancellationError（含 MODEL_REQUEST_CANCELLED、cause 链深 6、WeakSet 防环） | @12732274(W4e)/@12733100-12735008 | core/src/runtime/helpers/turn-errors.ts | 逐函数一致 |
| 取消收口：TurnCancelled → TurnComplete(resultType:"cancelled")（非 TurnError），TurnError 携带 turnPhase/inputId | @12733500（nie） | turn-errors.ts:143-216 | 一致 |

## §2 输入通道语义

结论：v4 CommandInbox admission 与 runtime steer/queue 全部同源。

| 项 | 真值证据 | 我方证据 | 结果 |
| --- | --- | --- | --- |
| CommandInbox 类（inFlight/liveInputs/settled/admissionSeq/keyGates/sessionGates，两级 gate） | @14175700（uxt class CommandInbox） | bootstrap/src/drora-protocol-v4/command-inbox.ts | 结构一致 |
| ack 状态集 accepted/rejected/stale/duplicate/noop/failed；retryAck（failed 不被 duplicate 覆盖） | @1145230（Ues schema）；@14179xxx（retryAck） | command-inbox.ts:449-452 | 一致 |
| reasonCode：proto.invalidPayload / proto.sessionNotFound / proto.missingBaseRevision / proto.staleLogEpoch / proto.staleRevision / fault.command.queryUnavailable | @14175800-14179800 | command-inbox.ts:123,319,333,347,359,460 | 一致 |
| CAS 命令集 15 项（applyFileRewind…resumeGoal）与 row-target 5 项 | @1144263（cYt/lYt） | shared/src/drora-protocol-v4/command.ts:296-317 | 逐项一致 |
| parseCommandEnvelope 内嵌 CAS 校验（"CAS commands require baseRevision and baseLogEpoch"） | @1139418 | command.ts:344-364 | 一致（decide 的 missingBaseRevision 分支双方同为防御性死分支） |
| 幂等表 LRU 512/session（fc.idempotencyTablePerSession=512），key gate `\0` 分隔，全局桶 "@global" | @647224, @14179800 | command-inbox.ts:73,491 | 一致 |
| steer 拒绝序：empty_input → input_too_large(>200_000 B) → no_active_turn → expected_turn_mismatch → turn_not_steerable；busy 时排队不拒绝（返回 queued） | @12821968(z1o)/@12822200-12823000；tkn=2e5 @12688480 | core/src/runtime/methods/steering.ts:57-199；MAX_TURN_STEER_INPUT_BYTES=200_000（runtime/helpers/steering.ts:11） | 一致 |
| queue 容量上限：双方均无上限（无 queueFull/maxQueueLength 概念）；autoDrain=false 时 held（pendingInputs.length>0 → queueAutoDrain=false） | @1281100 附近 | steering.ts:1015-1038 | 一致 |
| queue 单项操作 sendQueuedNow/edit/reorder/delete/setAutoDrain/setFollowupMode；v4 handler（含 queue_auto_drain_resumed 回调） | @14394620-14395000 | bootstrap v4 commands handlers | 一致 |
| steering 模块 36 函数名单（reserveTurnStart/pendingInputReservations/fallbackPendingGuidesToQueue/discardHeldPendingInputById/discardPersistedPendingSteerInputs 等） | @12840700-12841888（r() 注册表） | steering.ts 全文 | 逐函数一致（含日志文案 "Failed to sweep admitted session inputs on resume"） |
| savedWorkflowStart busy 拒绝：hasActiveOrQueuedTurnWork → {ok:false,reason:"session_busy"}；词表 invalid_name/not_found/invalid_args/compile_failed/session_busy/start_failed | @12811100；@1144090（eAc） | shared command.ts:265+ | 一致 |

## §3 mode 体系

结论：同源。

| 项 | 真值证据 | 我方证据 | 结果 |
| --- | --- | --- | --- |
| CollaborationMode = plan/build/edit/yolo/auto；SessionStatus = idle/running/waiting/paused/completed/error | @651000（$j/UZe） | contracts/src/interfaces/session.port.ts:32-33 | 一致 |
| intent 子集 mode ∈ build/edit/plan/yolo（无 auto） | @14393400（IJo=new Set） | session.port.ts:292 | 一致 |
| 切换链：switchCollaborationMode → app.runtime.setExecutionState({mode,planEnabled})；followupMode 仅非 "queue" 才 setFollowupMode | @14393300（kKa） | core/src/runtime/methods/config.ts:40-44；bootstrap model-config.ts | 一致 |
| setMode 持久化：localSettingStore.saveProjectPermissionMode({mode,projectID})；事件 "session.mode.updated" / "local_setting.permission_mode.write_failed"；返回 {mode,previousMode,traceId} | @13868900（tZo） | bootstrap/src/app/session-facade.ts:424-457 | 一致 |
| emitModeChanged 载荷 {mode:getMode(),planEnabled,previousMode,source:"command"} | @12837325（pIo） | steering.ts:1118-1138 | 一致 |
| SessionModeChanged yolo 授权细化 schema：permissionGrant{interactionId,queueItemIds}，reducer 将对应 queue 项 intent.mode 改写 yolo | @1411765（Zet）；reducer @1285200 | contracts session.events.ts:641-649；event-reducer | 一致 |
| plan 协议：EnterPlanMode 无弹窗 allow（ruleId tool.plan.enter）；ExitPlanMode 仅 plan 态可用（mode.plan.exitOnly） | @5088420（aso） | core/src/permission/plan-mode-policy.ts | 一致 |
| plan_approval 反馈升级：ExitPlanMode deny+reasonSource=plan_approval_feedback → followUpUserInput + modelContent "The plan was not approved by the user."；无反馈 → turnControl{reason:"plan_exit_denied",stopTurnAfterResult} | @12576200（Ewn）；常量 Cva/Eva @12577111 | core/src/tool/executor/turn-control.ts:44-98 | 一致（含默认文案 `Permission denied for ${tool}`） |
| workflow refine 同构升级（workflow_refine_feedback，无停轮分支） | @12576600（jSo/Dva） | turn-control.ts:107-144 | 一致 |
| mode 偏好作用域：项目级持久化（saveProjectPermissionMode），无 per-session mode DB 列 | @13868900 | session-facade.ts:428 | 一致 |

## §4 生命周期与事件序列

结论：同源。

| 项 | 真值证据 | 我方证据 | 结果 |
| --- | --- | --- | --- |
| SessionEventType 79 成员枚举（顺序、拼写逐项一致） | @1234184-1234800（lt={...}） | contracts/src/events/session.events.ts:83-174 | 一致 |
| 死枚举成员 Interrupt/Cancel/Resume/Error：双方均声明但零发射零消费 | grep lt.Interrupt/lt.Cancel/lt.Resume/lt.Error = 0 | grep SessionEventType.Interrupt/Cancel/Resume = 0 | 一致（同为死成员，非差异） |
| SessionCreated 载荷 {mode,planEnabled(??mode==="plan"),contextWindow}；reducer status→idle | @1285050（reducer handlers） | event-reducer.ts | 一致 |
| SessionResumed 载荷 {directory,interruptedToolCount,messageCount,partCount,recoveredCompactTimelineCount,recoveredSteerInputCount,resumedTodoCount,resumedTarget}；resume 序：恢复→discardPersistedPendingSteerInputs→SessionResumed→sessionStartHooks("resume") | @12983000 | core/src/runtime/methods/resume.ts:235-258 | 一致 |
| 会话操作面：createSession/createSelectionSideSession/forkAssistant/renameSession/deleteSession/discardSharedContext 等 33 命令 | @1139550（egr 键表） | shared command.ts:44-243 | 逐项一致 |
| seq 形状：wire 事件 {deliveryKind,eventId,payload,seq=sequenceNumber,sessionId,timestamp,traceId,turnId,type}；内存 store latestSequenceNumber 单调分配 | @1284100（$xt）；@1295500 | in-memory-session-event-store.ts；session.events.ts:79 | 一致 |
| 事件留存：瞬态 4 类（ModelStreaming/ToolCallProgress/StreamingToolLedgerUpdated/ModelNetworkStatus）、turn-window 滞后一 turn 淘汰、时间兜底 grace=120s、unbounded 模式 | @1293000-1294000（irs/G_r=12e4） | contracts/src/events/session-event-retention.ts | 一致 |
| 事件留存上限 eventRetentionPerSession=2000；PROTOCOL_V4_LIMITS 全部 31 项数值一致（attachmentPreview* 经 VIDEO_INPUT_MAX_BYTES=30MiB 折算后同值） | @647224 附近 | shared/src/drora-protocol-v4/core.ts:64-97 | 一致 |
| 取消后队列语义：TurnCancelled 且 preserveQueueAutoDrainOnCancel≠true → queueAutoDrain=false + queueExternalDrainActive=false（compact turn 同路径） | @13021800 | compact.ts / turn-errors.ts | 一致 |
| 投影类型映射 session.closed/turn.steerQueued/turn.completed/turn.failed 等 | @14431200（jZa） | bootstrap/src/drora-protocol/session-mapper.ts:1485+ | 一致 |

## §5 差集三分类

| # | 分类 | 级别 | 项 | 真值证据 | 我方证据 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | SHAPE-DIFF | P3 | 外部 turn fault 标记重命名 `zcode.externalTurnFault` → `drora.externalTurnFault`（字段 zcodeTurnFault → droraTurnFault） | @12735008（Lxo）、@12732253 | core/src/runtime/helpers/turn-errors.ts:25,36 | 刻意品牌化改名；语义（宿主强制 TurnError 落盘）完全一致。外部宿主若按旧标记注入会退化为普通 UnknownError，迁移时需同步 |
| 2 | SHAPE-DIFF | P3 | 日志命名空间 `zcode_protocol.*` → `drora_protocol.*` | 41 个 zcode_protocol.* 标记 | 37+ 个 drora_protocol.* 标记 | 归一化后差集为空（截断伪差除外），1:1 对应 |
| 3 | EXTRA（域外备注） | P3 | 7 个 model.* 日志标记我方缺失：model.client_signing.{feature_gate,sink_failed,unsigned_sent}、model.provider_endpoint_routing.{matched,refresh_failed,snapshot_refreshed,snapshot_updated} | @grep event:"model.*" | 全仓 src 无 | 属模型网络域（D-other 域），非会话/回合机；列此备查 |

- REAL-GAP：本域 0 项。
- EXTRA：本域 0 项（域外备注 1 项）。
- SHAPE-DIFF：2 项，均 P3、均为有意重命名，无行为差异。

## §6 OPEN-QUESTION

1. 基线记录中的 "sessionModeLedger 三写点三逐出点"：真值 0.16.9 与我方当前 src 均无该名字（grep=0）。疑为旧版本概念或 UI 侧（packages/ui store）概念在 CLI 域的误记；本域事实由 SessionModeChanged 事件 + reducer 承载。待与 UI 域对拍员核对。
2. 真值 `Lt` 常量区 @1234800（Tns=4096, Kgr=500, Ins=256e3, "\u2026"）疑为 inputPreview 截断 500 / inputSize 上界 4096(?) / 256e3(?)；我方 previewInput 亦为 500（helpers），4096/256e3 的消费点未逐一追认，建议 D2/D3 侧复核其对应常量名。
3. 真值 `answer` 命令（resolveInteraction 的 answer 载荷）与 plan_approval 弹窗的端到端交互序列未做运行时级重放验证（静态对拍已确认 schema 一致）；如需闭环建议补一条 E2E 场景（ExitPlanMode deny→feedback steer→同轮 user message）。
