# b09 上下文压缩链对拍（auto/manual compact、microcompact、阈值与触发）

真值 = zcode.cjs（0.16.9，偏移均指 D:\software\zcode\resources\glm\zcode.cjs 字节偏移）；
我方 = feat/migrate-remote-and-pet，入口 apps/drora-cli/packages/core/src/compact/、
packages/core/src/runtime/methods/{compact,compact-active,microcompact,compact-persistence}.ts、
packages/contracts/src/compact/index.ts。结论先行：压缩链是逐函数保真移植，
26 个关键函数名（shouldAutoCompact…recoverInterruptedCompactTimelines）在真值 r(fn,"name")
注册表中全部命中，常量、事件名、持久化键、提示词逐字一致；仅 1 处 REAL-GAP、1 处 SHAPE-DIFF。

## §1 auto compact

- 常量完全一致（真值 4904200 区，压缩名 r(...) 保真）：
  真值 Jge=2e5 / Wno=32e3 / cZs=21e3 / $dt=2e4 / Vno=13e3 / Hno=100 / Gno=3
  ⇔ 我方 policy.ts:6-14（200k 窗 / 32k 输出预留 / preflight 21k / summary 20k / buffer 13k / 阈值百分比 100 / 熔断 3）。
- 阈值：effectiveWindow = window − min(outputReserve,window)，threshold = effectiveWindow − buffer。
  真值 Rhn/Dhn/ANe（4903220）与我方 policy.ts:67-88 同构。默认数值阈值 = 200000−21000−13000 = 166k。
  历史基线"149.4k"本轮未复现，两侧现行判定均一致；thresholdPercent=100 仅上报不参与判定。
- token 计数：provider_usage 优先（base= contextUsageTokens??inputTokens，+本地增量），真值 Yxn（13024990）
  与我方 compact.ts:313-340 同构，增量起点 contextUsage 缺省时含 assistant 本身。
- 触发时机：turn loop 每个模型步、模型请求前；先 microcompact 再 autoCompact；
  phase = step0→PreRequest 否则 MidTurn。真值 13047357 与我方 turn-loop.ts:67-103 一致。
- 保护窗口：rapid-refill 熔断（toolTurns<3 递增、≥3 阻断，抛错带 max 3/3）真值 Z_t（12851900）
  ⇔ 我方 turn-loop-state.ts:154-186；连续失败熔断 maxConsecutiveFailures=3 两侧一致。
- auto 失败重试：AUTO_COMPACT_MAX_ATTEMPTS 真值 jPo=3，同 operationId 下发 retrying，第 3 次落 failed。

## §2 microcompact

- 开关名 `compact.microcompact.enabled`，缺省关：真值 C1a `enabled:e.microcompact?.enabled===!0`（13079644）
  ⇔ 我方 microcompact.ts(methods):111；外层 `compact?.enabled===!1` 直接 return 两侧一致（EPo 头，13078050）。
- 缺省阈值：min(floor(autoThreshold×0.9), autoThreshold−2000)，真值 Xno=.9/Qno=2e3（4906870 区）
  ⇔ 我方 microcompact.ts:17-18,77-81。
- 触发：idle>60min（TimeBased）或 est≥threshold（TokenPressure）；keep 5 组（Zno=5）、
  minTokenSavings 256（Yno）、可清理工具表 Read/Bash/Grep/Glob/WebFetch/WebSearch/Edit/Write/ApplyPatch
  （ero，4906900）、清理文案 "[Old tool result content cleared]"、错误结果默认跳过、
  media（image/video/file）保护——含 video（真值 mZs 4906600 ⇔ 我方 microcompact.ts:249-256）。
- 落账：MicrocompactBoundary 事件（session event，真值 1236717 枚举）payload
  trigger/strategy/pre/post/tokensSaved/cleared/kept 双侧一致；先 replaceMessages 再 appendEvent，
  copy-on-write 仅改被清 tool result，两侧一致（真值 13079000 ⇔ 我方 methods/microcompact.ts:73-89）。

## §3 manual compact

- 入口三路一致：/compact（可带 instructions，parseCompactCommand 真值 yko 12675434 ⇔ 我方 helpers/commands.ts:5）；
  v4 `compact` 命令（commandKind:"compact"，payload 空，无 instructions 变体）——真值 uKa（14377550）
  与我方 bootstrap goal-compact.ts:56-118 逐段一致（compactOperationLock、restoreWarning、
  enqueue/guide/choice 入队、manualCompactControllers WeakSet、后台跑 /compact）；旧协议 compactSession
  RPC（含 already_running、instructions）两侧同在（真值 JKo/cXa 14524400 ⇔ 我方 server-operations.ts:2020）。
- 执行：executeManualCompact→compactActiveConversation，trigger Manual/phase StandaloneTurn/reason
  UserRequested，TurnStarted `inputVisibility:"model-only"`，手动 maxAttempts=1（auto=3）。
  真值 KAo（13020600）⇔ 我方 methods/compact.ts:45-182。
- 摘要轮：模型=当前会话 selection；maxOutput=min(模型上限,20k)（真值 G1a ⇔ 我方 cap…:716-725）；
  工具>100 时摘空（$1a=100）；prompt 逐字一致（tZs/rZs/nZs，4895700 区 ⇔ 我方 compact/prompt.ts，
  9 段结构 + security verbatim 条款 + analysis/summary 标签 + NO_TOOLS 前后缀）。
- prompt-too-long 三级退路一致：preserved 重选 → 截断 fallback（仅 manual/reactive）→ 重试上限 3；
  标记 "[earlier conversation truncated…]"（4902747）与文案 "Conversation too long to compact…"（4902806）同。
- 遥测：operationId=`cmp_${uuid}`（13088569）进 modelCall（operation:"context_compaction"）、
  timeline、agentTelemetry.compaction（13087278）——历史"缺 operationId 全丢"已不成立。
- append-only 半成品案已消亡：两侧均为原地 replaceMessages + readFileState.clear（13091400 区）。

## §4 skip 判定

- 决策 skip：disabled / not_enough_messages / circuit_breaker / below_threshold（真值 4904100 区）。
- not_enough_messages：过滤 context prefix（system + `<system-reminder>` 开头 user）后
  ≥2 assistant 轮且含 assistant 消息；真值 Hge/Phn（4901080）⇔ 我方 manual.ts:61-75——
  历史"真值跑摘要轮我方 skip"残叶已收敛，两侧判定逐字一致。
- manual skip：健康 no-op，落 skipped timeline + "Context is up to date; no compression needed"（13088932）。
- auto 另有 rapid_refill_blocked 短路（先于 compact 调用抛错）；output-token 续跑不影响 compact 调用。

## §5 产物与重放

- boundary：buildManualCompactBoundary 双侧逐字段一致（summarySource:"model"、
  willRetriggerNextTurn=truePost≥threshold、preservedSegment{head,anchor=summaryId,tail}、
  keptMessageCount 仅 groupsPreserved>0 时写）。真值 jdt（4901150）⇔ 我方 manual.ts:77-100。
- summary 消息："This session is being continued from a previous conversation…" + 可选
  transcriptPath/recentMessagesPreserved/replStateCleared/suppressFollowup 后缀，逐字一致（4893735）。
- 落账键名：compaction part（auto/trigger/phase/compactReason/tail_start_id/compactBoundary/operationId…）
  + timelineType:"context_compaction" timeline part（13179325），⇔ 我方 compact-persistence.ts:85-154；
  summary message semantics kind:"compact_summary"、post-compact reminder 独立 message、失败回滚
  removeMessage 兜底，均一致（13184873 cleanup_failed）。
- resume 重放：recoverInterruptedCompactTimelines 把 started/retrying 收敛为 completed（有 boundary）/
  interrupted，按 operationId 配对 boundary；isCompactPreservableSessionMessage（providerVisibility
  hidden/含 compaction part/assistant error 排除）与 compactActiveSessionMessages 保留段回插锚点
  （anchor+1，找不到插 1）双侧一致（4816800 区 ⇔ 我方 agent/compact-session.ts）。
- TTFT 观测：observeLocalTtftCompaction 以 `compact:${operationId}` 记 detail，上限 64（Ez=64），
  interrupted→cancelled 映射一致（14145500 区 ⇔ 我方 local-ttft-compaction.ts）。

## §6 差集三分类表

| # | 分类 | 级别 | 点位 | 真值证据 | 我方证据 | 说明 |
|---|------|------|------|----------|----------|------|
| 1 | REAL-GAP | P3 | compact 成功尾部缺 memory-recall 重置 | compactActiveConversation 尾 `readFileState.clear(),hyt(this)`（~13091800）；hyt=abort memoryRecallPrefetch+重置 memoryRecallState（12966948） | compact-active.ts:625-631 仅 clear() 后返回；全仓无 memoryRecallState | 本质是 memory-recall 特性整链缺失（他域），压缩链内表现为少一次状态复位；compact 语义本身不受影响 |
| 2 | SHAPE-DIFF | P3 | 遥测指标命名空间 | `zcode.context.compaction.duration` 等 zcode.*（13275828） | telemetry/agent-metrics.ts:62 `drora.context.compaction.duration` | 全局品牌重命名 zcode.*→drora.*，非 compact 行为差异；跨系统聚合时指标名不同 |
| 3 | EXTRA | — | — | — | — | 未发现我方独有行为 |

计数：REAL-GAP 1（P3×1）/ EXTRA 0 / SHAPE-DIFF 1（P3×1）。无 P1/P2。

## §7 OPEN-QUESTION

1. 历史基线"阈值基数 149.4k"未能在现行 bundle 复现；现行两侧推导均为 166k（200k−21k−13k）。
   149.4k 疑为旧版常量或特定模型 contextWindow（如 180k 级）派生值，建议在模型 contextWindow
   映射表域（非本域）确认后归档。
2. 真值 compact 尾部 `hyt` 所属 memory-recall 链的缺失范围与影响面归 E-memory 域调查员核实；
   本域仅确认 compact 尾部该调用点缺失（若 memory-recall 后续补齐，需同步补这一调用）。
