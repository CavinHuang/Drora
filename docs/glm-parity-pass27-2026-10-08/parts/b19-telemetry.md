# b19 遥测/usage/诊断域对拍报告（J1）

- 真值：`D:\software\zcode\resources\glm\zcode.cjs`（0.16.9，以下偏移均为字节 offset）
- 我方：`feat/migrate-remote-and-pet`（基线新鲜，ahead 14 / behind 0）
- 方法：只读 grep -o / grep -ob / dd 定长取样，未改任何代码
- 结论速览：REAL-GAP 2（P1×1 域）、EXTRA 0、SHAPE-DIFF 0 实锤、OPEN-QUESTION 2

## §1 OTel 面

**结论：除 client_signing 三件套外全对齐，且为同构移植。**

装配结构逐项一致（真值 13.778M–13.799M 区段 ↔ 我方 `apps/drora-cli/packages/telemetry/src/otlp-exporter.ts`）：

| 项 | 真值 | 我方 | 证据 |
|---|---|---|---|
| scope 名/版本 | `getTracer/Meter("@zcode/cli-agent-telemetry", String(6))` | `@drora/cli-agent-telemetry`, `TELEMETRY_SCHEMA_VERSION=6` | GT 13780017；contracts/src/telemetry/agent-execution.ts:4 |
| 采样 | `ParentBasedSampler(TraceIdRatioBasedSampler(Czo=.1))` | 同构，`AGENT_TRACE_SAMPLE_RATIO=0.1` | GT 13779484 附近 |
| metric 导出 | OTLP GZIP + `DELTA` temporality，`metricHeaders??headers`，间隔 `Izo=3e5` | 逐项同 | GT 13779300；otlp-exporter.ts:77-90 |
| BSP | `scheduledDelayMillis:5e3`、timeout `??3e3` | 同 | GT 13788 区段；otlp-exporter.ts:63-68 |
| ContextManager | ALS，注册失败即 disable | 同 | otlp-exporter.ts:96-102 |

resource/span 属性改名 `zcode.*` → `drora.*` 逐一确认：真值 165 个 `zcode.*` 键与我方 `drora.*` 键集合精确差集 = 仅缺
`drora.model_attempt.client_signing` / `client_signing_error_kind` / `client_signing_unsigned_reason`（→§5）。
`zcode.chatglm.site`/`zcode.cjs`/`zcode.json` 为 URL/文件名，非遥测，正确排除。

metric 仪器 16 个全对应（8 duration histogram + call.attempts histogram + tokens/stream_stall/creation_drop/abandoned counters + time_to_first 系列 + stream_max_idle + command.first_output）；histogram 边界逐组一致：
`[1,5,10,30,60,300,600]`（turn）、`[.25,1,2,5,10,30,60,120]`（model.*.duration）、`[.01,.05,.1,.5,1,5,30,120,300,600]`×4（compaction/detached/step/command）、`[.25,.5,1,2,5,10,30,60]`（time_to_first）、`[1,2,3,5,8]`（call.attempts）。

exporter 配置解析：真值函数名表 `resolveOtlpTraceEndpoint/resolveOtlpMetricEndpoint/parseOtlpHeaders/prepareModelTelemetryEnv/createPreparedOwner/resolveTelemetryIdentity/normalizeTelemetryDeviceMid` 与我方 `bootstrap.ts` 导出同名同构；常量 `p7a=5*6e4`（锁 stale 5min）、`f7a`/`m7a` 正则逐字符一致。**历史 OTEL headers split 截断案已修复形态对齐**：我方 `parseOtlpHeaders` 用 `indexOf("=")+slice`（值含 `=` 不截断）+ `safeDecode`（bootstrap.ts:103-114），GT 走 SDK `parseKeyPairsIntoRecord`。

TTFT 跨进程观测链路已移植：`LOCAL_TTFT_BUCKETS_MS=[1,5,10,20,50,100,200,500,1e3,2e3,5e3,1e4,3e4,6e4,3e5]`、stage 枚举（renderer_prepare/command_admission/execution_wait/request_prepare/model_request/output_return）、clock 校准、channel `zcode:report-local-ttft-batch` → 我方 `drora:report-local-ttft-batch`（packages/shared/src/localTtft.ts；bootstrap/src/drora-protocol-v4/local-ttft*.ts）。

## §2 usage 统计

**结论：完全对齐，同一移植源（真值内部函数名与我方源码命名一一对应）。**

- RPC：真值 method `usageStats:"usage/stats"`、`sessionUsage:"session/usage"`（GT 786800 附近）；channel 枚举 `UsageStats:"usage-stats"`（GT 909937）。我方 `server.ts:714` 注册 sessionUsage、`server-operations.ts:1768` getUsageStats。
- `getUsageStats` 语义一致：range `{"7d":7,"30d":30}`、`all→since=0`、默认 30 天、timeZone 默认 UTC、空 store 回退空快照（GT kRn@14490287 ↔ server-operations.ts:1766-1820）。
- 快照构建 `buildAppUsageSnapshot` ↔ GT `cRn`@14439187 字段级一致：summary 20 字段（cacheHitRate 分母=total input 或 cacheCreation+cacheRead、modelErrorRate、toolErrorRate、activeDays/currentStreakDays/longestStreakDays 扫描方向 end→start、peakDayTokens、favoriteModel=models[0]）、heatmap 7 天周格 null padding、dailyModelUsage、models share、tools errorRate/avgDurationMs、`source:"agent-db"`。
- fold SQL：`queryAppUsage` ↔ GT `Xkr`：9 条 SQL（totals/turnTotals/longestSession/toolTotals/models/tools/days/turnDays/toolDays/dayModels）逐字节一致；`avg()` 浮点直通两侧一致。**历史"tool_usage fold 收原始事件型 + AVG 浮点直通"基线维持对齐**。
- 写入方：`recordModelUsageFact` / `recordTurnUsageFact` / `recordToolUsageFromEvent`（core/src/runtime/methods/usage-observability.ts）。**turn_usage 聚合列已非恒 0**：modelRequestCount=ModelRequest 事件数、toolCallCount/toolErrorCount 由 Scheduled/Error 事件集合计算、tokens 由 createModelUsageSummaryFromEvents——历史案已修复。
- tool_usage fold 原始事件型：Scheduled/PermissionRequested/Resolved/Denied/Started/Progress/Result/Error 逐事件 upsert（usage-observability.ts:202-333），与 GT `Ykr` 语义同。
- retention 30 天一致（GT `eas=30` ↔ USAGE_RETENTION_DAYS=30）；`upsert*` 冲突合并列（coalesce/min/max）逐列一致。
- `queryTaskUsage` 增量 input 基线（main_turn/subagent/workflow_child 三源、compaction 后 baseline 降档）↔ GT `Qkr`/`ias` 同构。
- **usage.delta fact 已发布**（conversation-telemetry-facts.ts:578，isStepUsageModelComplete 门控主轮+subagent，sidecar/compact/tool_internal 不外送），字段 requestId/providerId/modelId/providerKind/providerHostname+input/output/total/reasoning/cacheRead/cacheWrite ↔ GT `Jes` schema@1151578 与运行时发布点@14158138（`UGa` 过滤）一致。**历史"全仓零发布"案已消除**。真值无 `usage.completed` fact（grep 命中均为 SQL 列名 `turn_usage.completed_at`），我方亦无，无 GAP。
- conversation fact kind 10:10 对齐：turn.started / turn.terminal / model.request.status / stream.chunk / tool.lifecycle / permission.lifecycle / subagent.lifecycle / compaction.terminal / usage.delta / workflow.lifecycle（GT kind 字面量全集 ↔ 我方 facts+workflow-facts）。

## §3 rollout/model-io 诊断日志

**结论：完全对齐（常量、目录、轮转、脱敏、压缩同构）。**

- 写盘位置：真值 `~/.zcode/cli/rollout`（生产）/`debug`（开发）→ 我方 `~/.drora/cli/rollout|debug`（adapters/src/model/runner-debug.ts:589-591）。
- 文件名：`model-io-<sessionId清洗|no-session>.jsonl`，segment 非字母数字折叠 `-`、限长 80，两侧一致（GT `QFs` ↔ sanitizeFileSegment）。
- 常量一致：目录保留 3 个文件（`VFs=3`）、生产单文件 64MB（`HFs`）、debug 256MB（`GFs`）、生产 baseline 64 条（`JFs`）、debug 256 条（`KFs`）。
- 开关：`shouldRecordModelIO`=运行环境≠test（GT `Kst`=NODE_ENV≠test）；`isDevelopmentModelIOEnv`；`modelIoFullRetentionEnabled` 设置默认 false（GT app-runtime-preferences `default(!1)`，真值 720280），我方经 runner.ts 全链路注入。
- 超限重置：`modelIOReset:{maxFileBytes,previousFileBytes,reason:"session_file_size_limit"}` 标记与重写语义一致；失败记录 preserveFullBodyMessages 一致。
- 脱敏：`sanitizeModelIODebugRecord` image/video data URL redact 同构（GT `RWr/MFs/PWr`）。
- delta 压缩：指纹（首/尾+0.25/0.5/0.75 采样）判定 delta/tail/full ↔ GT `i4s/n4s` 同构；我方额外有失败流式聚合 1s 有界等待（runner-debug.ts:395-461，防 abort 循环等待，本地修复）。

## §4 事件遥测计数

- span events 12 个：我方 9 个全对齐（permission_requested/permission_decided/first_output/termination_requested/fallback_selected/first_provider_event/first_content/first_text/stream_stalled），缺 3 个 client_signing_*（→§5）。
- event store 日志：`event_store.appended` 双方都有（GT 13169136/13170346）；**events append summary（100 条阈值聚合 + payloadKinds 分布）在真值同点存在**（GT 13169787-13170648 payloadKinds/"append summary"），我方 events.ts:149-232 为其移植。历史"live 残叶"未复现：16 个 metric 仪器、10 个 fact kind、9 个 span event 均无我方独有多余项。
- 我方无 telemetry CLI 子命令，真值亦无（bundle 内 `telemetry disable/enable/reset` 命中均为 atlas CLI 补全数据与 tsserver，非 zcode 自身）。

## §5 批4 移交项裁决（7 个日志标记）

真值位置与触发条件全部定位：

**model.client_signing（客户端请求签名观测，coding-plan 签名子系统）**
| 标记 | 级别 | 触发 | 偏移 |
|---|---|---|---|
| `model.client_signing.feature_gate` | info/warn | 签名特性门查询返回（enabled/disabled/unavailable，含 cacheable/httpStatus/failure） | 3722100 附近 |
| `model.client_signing.unsigned_sent` | info | 无签名发送（含 access_mode 跳过，provider 维度去重） | 3722760 |
| `model.client_signing.sink_failed` | warn | model_client_signing 观测发布 statusSink 失败 | 3942760 |
| （动态 kind）signed_sent=debug / handshake_failed=warn / verify_rejected=warn / bypass_entered=warn / request_failed_closed=warn | — | `model.client_signing.${kind}` switch 分发 | 3721930 |

配套 span 面：3 属性（client_signing=signed/unsigned/failed、unsigned_reason、error_kind）+ 3 span events（client_signing_handshake_failed / verify_rejected / bypass_entered，GT 13301983 区段）+ status sink `model_client_signing` 发布（GT `OLs` publishClientSigningObservations）。

**model.provider_endpoint_routing（ProviderEndpointRoutingService）**
| 标记 | 级别 | 触发 | 偏移 |
|---|---|---|---|
| `.matched` | debug | 请求 URL 按 from→to 映射改写命中（sourceHost/Path→targetHost/Path+traceId） | 4065900 |
| `.snapshot_updated` | info | 路由快照内容变化（mappingCount） | 4067000 |
| `.snapshot_refreshed` | debug | 快照刷新但内容未变 | 4067050 |
| `.refresh_failed` | warn | 配置拉取失败，进入 `failureCooldownMs=30s` 冷却 | 4067350 |

服务参数：configUrl 源自 `codingPlanSignature.configUrl`，映射 ≤256 条，请求超时/成功 TTL 可配，快照共享刷新（beginRefresh/waitForSharedRefresh）。

**裁决：两个子域在我方全仓（packages+apps，排除 dist/node_modules）零对应物**——`clientSigning|codingPlanSignature|ProviderEndpointRouting` 均 0 命中。我方 `telemetry/src/provider-endpoint.ts` 仅为 OTel 属性脱敏器（provider_origin/route），不是路由服务。7 个日志标记 + 3 属性 + 3 span events + sink kind 整体 REAL-GAP，属"coding-plan 客户端签名 + 端点路由"功能域缺失的遥测投影。

## §6 差集三分类表

| # | 分类 | 级别 | 项 | 真值证据 | 我方 |
|---|---|---|---|---|---|
| 1 | REAL-GAP | P1 | client signing 遥测面：3 span 属性 + 3 span events + sink `model_client_signing` + `model.client_signing.*` 日志族（feature_gate/unsigned_sent/sink_failed/signed_sent/handshake_failed/verify_rejected/bypass_entered/request_failed_closed） | GT 3722012 / 3942720 / 13301983 | 全仓 0 命中（功能域未迁移） |
| 2 | REAL-GAP | P2 | ProviderEndpointRoutingService：`.matched/.snapshot_updated/.snapshot_refreshed/.refresh_failed` 4 标记 + 路由快照刷新机制 | GT 4065900–4067525 | 仅 provider-endpoint.ts 脱敏器，无路由 |
| 3 | EXTRA | — | 无 | 16 仪器/10 kind/9 event 逐一核对 | 无多余项 |
| 4 | SHAPE-DIFF | — | 无实锤 | 常量/SQL/JSONL 格式逐项一致 | — |

历史基线复核：usage-stats fold 对齐=维持；turn_usage 恒 0=已修复；OTEL headers split 截断=已修复；rollout=model-io=对齐；usage.delta 零发布=已修复（无 usage.completed fact，两侧一致）；events live 残叶=未复现。

## §7 OPEN-QUESTION

1. metricViews 基数限制：我方 4 个 cardinalityView（limit 250）+ 13 个 histogramView；GT `Azo()` view 集合未逐项反编译（bucket 值全部对上，view 条目数与 cardinalityLimit 数值未逐一取证）。低风险。
2. `zcode.execution.query_id` 等 12 个 execution.* 属性我方均有键名，但运行时赋值覆盖率（如 launch_surface 各取值）未做动态验证——静态只读范围外。
