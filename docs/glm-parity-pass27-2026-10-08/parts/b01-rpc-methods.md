# b01 RPC wire 方法面对拍（pass27, 2026-10-08）

- 真值：`D:\software\zcode\resources\glm\zcode.cjs`（0.16.9）。偏移均指该文件字节偏移。
- 我方：`D:\workspace\projects\Drora`（feat/migrate-remote-and-pet，3cecb3c3）。
- 方法：双策略交叉枚举（常量表 `key:"slash/name"` 全扫 + `case` 分发表全扫 + `m.literal(...)` 联合枚举），再集合求差。
- 结论速览：**方法名层面 v1/v4 全集与真值完全一致；未发现 REAL-GAP 与 EXTRA**。差异集中在命名品牌、错误码注册形态与 MCP 层错误码三处（P3）。

## §1 真值方法面全集

### §1.1 v1 域（"ZCode Protocol"，版本 1；偏移 741361 附近 `protocol:{name:"ZCode Protocol",version:1}`）

A. 服务端处理（客户端→CLI 请求，`case va.*` 分发，59 个；偏移 14659585 起为 v4 段、14667243 为 `sf(-32601` 兜底）：

- session（20）：create、list、resume、read、messages、events、debug、subscribe、send、stop、cancelBackgroundTask、fork、compact、goal、close、setModel、setThoughtLevel、setMode、usage、subagents
- workspace（8）：readPresentation、hooks/trustGrant、updateInteractionPreferences、updateModelIoPreferences、updateOffPeakToolPolicy、updateDynamicWorkflowPolicy、generateText、cancelGenerateText
- provider（2）：updateAccountConfig、testModelConnectivity
- plugins（18）：list、referenceCatalog、referenceCatalogWithCategory、resolveSuggestedReference、setEnabled、overview、marketplace/add、marketplace/remove、marketplace/update、install、cancelOperation、uninstall、update、restoreBuiltin、configure、resetConfig、validate、describe
- skills（1）：skills/referenceCatalog
- workflows（6）：list、get、updateMeta、delete、runs、move
- 其他（4）：mcp/list、usage/stats、process/childProcesses、runtime/capabilities（返回 `{independentPlanState:true}`）

B. 反向请求（CLI→客户端，`requestClient(va.*)`，14 个，调用点计数见括号）：
automation/create、update、checkTaskBinding、list(2)、delete(5 个 automation 共 6 调用点)；offPeak/create、list(2)；interaction/requestPermission、requestUserInput(2)、requestProviderRuntimeHeaders、requestOfficialMcpAuthHeaders、browserList、browserExecute(3)；session/requestRuntimePreferences。证据：automation 群 `requestClient(va.automationCreate,...)`（偏移 14451000 区段）；offPeak 同区段；interaction 见 interaction-broker。

C. 服务端通知（CLI→客户端 notify，`BR` 表 7 个；偏移 735907）：
startup/storageState、interaction/providerRuntimeHeadersCancelled、process/mcpTelemetry、process/mcpResourceSamples、process/toolExecResource、plugins/operationProgress、process/resourceSample。

D. startup 握手族（4 个；`GUi` 联合 + `JUi` 应答，偏移 ~787500）：
startup/storagePath、startup/storagePrepared、startup/storageState（请求/通知联合）；startup/storagePathReady（应答，`m.literal`）。

E. 事件推送方法：`session/event`（notify 推送 legacy 订阅者；`e.notify({method:"session/event",params})`）。

v1 合计：59 + 14 + 7 + 4 + 1 = 85 个 wire 方法字符串（其中 va 常量表 64 键）。

排除说明：bundle 中另有 `tools/list`、`resources/read`、`elicitation/create`、`server/discover`、`subscriptions/listen`、`completion/complete`、`sampling/createMessage`、`notifications/initialized` 等字面量，上下文均为 MCP 传输/SDK（`jsonrpc:"2.0"`、`io.modelcontextprotocol/*`），非应用 RPC 面，不计入。

### §1.2 v4 域

A. 客户端→CLI（`h0` 表 31 项；定义偏移 1123127–1124249）：
connection/flow；controller/subscribe、resync、unsubscribe；conversation/subscribe、resync、unsubscribe、rowsRange、plans、fileChanges、backgroundBashOutput、fileRewindPreview、workflowRunEvents、workflowRuns、workflowRunArtifacts、workflowRunArtifactData、workflowRunArtifactRead、workflowRunWorkspace、workflowRunNodeResult、usage、attachmentRead、attachmentStat；usage/stats；attachment/begin、chunk、commit、abort、read、previewSource；commands/query、command。

实际 `case h0.*` 分发 28 个（偏移 14659585 起）；**controller/subscribe|resync|unsubscribe 仅声明、无分发、无调用点**（各自全 bundle 仅出现 1 次，均在 h0 定义内）。

B. CLI→客户端推送（`jV` 表 4 个；偏移 1124881）：
v4/conversation/frame、v4/telemetry/event、v4/telemetry/local-ttft、v4/cua/permission-observation。

C. 其他 v4 字面量（非方法）：`v4/shared_context_import`、`v4/command_fact`、`v4/fork_start_failure` 为本地持久化/事实类型；`v4-auto-drain` 为 clientId 常量。

## §2 我方全集

- v1 常量表：`packages/shared/src/drora-protocol/index.ts:3564-3666`（64 键，与真值 va 一一对应）；通知表 `index.ts:336-342`（7 键 = BR）；startup 联合 `index.ts:3703-3715`（4 项）；`session/event` 推送在 `apps/drora-cli/packages/bootstrap/src/drora-protocol/server-operations.ts:771,778,3123`。
- v1 分发：`apps/drora-cli/packages/bootstrap/src/drora-protocol/server.ts`，`case droraProtocolMethods.*` 共 59 个（:678 起）；`runtime/capabilities` 返回 `{independentPlanState:true}`（:678-679）。
- 反向请求：automation-port.ts / offpeak-port.ts / interaction-broker.ts / server-operations.ts:3178，14 个方法、调用点计数与真值相同（automationList×2、offPeakList×2、interactionBrowserExecute×3、requestUserInput×2，其余×1）。
- v4 常量表：`packages/shared/src/drora-protocol-v4/transport.ts:327-365`（`V4_METHODS`，31 项 + 4 推送，与 h0/jV 全同）；分发 28 个（bootstrap/drora-protocol-v4/v4-gateway.ts 及 server 桥），controller 三方法同样仅声明未分发（全仓无调用方）。
- 传输：`apps/drora-cli/packages/bootstrap/src/drora-protocol/transport.ts`（NDJSON 连接）。

集合运算（`grep` 导出后 `sort -u` + `diff`，已去除 CRLF 干扰）：
- v1 方法全集（含 startup、session/event）：真值 85 = 我方 85，**差集为空**。
- `case` 分发表：59 = 59，**IDENTICAL**。
- v4 方法全集：35 = 35，**SETS-IDENTICAL**。
- 反向请求 14 = 14；通知 7 = 7；startup 4 = 4。

## §3 差集三分类

| 分类 | 条目 | 级别 | 证据 |
| --- | --- | --- | --- |
| REAL-GAP | （无） | — | §2 三组 diff 均为空 |
| EXTRA | （无） | — | 同上 |
| SHAPE-DIFF-1 | 快照内协议名/品牌：真值 `name:"ZCode Protocol",version:1` vs 我方 `"Drora Protocol",version:1`（`index.ts:73-74,1020-1021`）。字段/版本号同形，仅字面量改名，疑为整库 rebrand 的有意行为 | P3 | 真值偏移 741361 `protocol:{name:m.literal(gYe)`；`gYe="ZCode Protocol"` |
| SHAPE-DIFF-2 | 错误码注册形态：真值有命名枚举（含 `ResourceNotFound=-32002`、`MissingRequiredClientCapability=-32021`、`UnsupportedProtocolVersion=-32022`、`UrlElicitationRequired=-32042`）；我方仅命名 `sessionUnavailable=-32004`（`index.ts:80-82`），其余为散落字面量（值面一致，见 §4） | P3 | 真值枚举 `-32002]="ResourceNotFound"` 等 |
| SHAPE-DIFF-3 | MCP 客户端层错误码 `-32002/-32042` 我方源码零出现；真值用于 MCP 错误映射（`mcpBrand`、`UrlElicitationRequiredError`）。属 MCP 适配层而非应用 RPC 面，但映射语义是否存在等价物未验证 | P3 | 真值 `if(t===Du.ResourceNotFound)` 上下文 |

## §4 错误码 / 事件 / 反向请求面对照

### §4.1 错误码（16 个，双侧一致，除注明外）

| 码 | 语义 | 真值证据 | 我方证据 |
| --- | --- | --- | --- |
| -32700 | Parse error（id 用字符串 `"parse-error"`） | `sendError("parse-error",-32700,...)` | transport.ts:209 |
| -32600 | Invalid message / operation 冲突（data 带 issues） | `sendError("invalid-message",-32600,...)`；generate 重复 operation 抛同码 | transport.ts:215 |
| -32601 | Method not found（分发兜底） | `sf(-32601,"Method not found: ...)`（14667243） | server.ts 分发 default |
| -32602 | Invalid params（thoughtLevel 必填等） | `sf(-32602,"thoughtLevel is required")` | server-operations.ts:1252,2697 |
| -32603 | internal / v4 gateway 未初始化 | `sf(-32603,"v4 gateway is not initialized")` | server-types.ts:253,266 |
| -32002 | ResourceNotFound（MCP 层） | 枚举映射 | 无（见 SHAPE-DIFF-3） |
| -32003 | 共享上下文导入需 session store / 原子性 | `sf(-32003,"Cannot import session history...` | server-operations.ts:1007,1031 |
| -32004 | sessionUnavailable（命名常量 `$ee`） | `$ee={sessionUnavailable:-32004}` | index.ts:81；server-types.ts:324 |
| -32009 | 会话状态版本冲突（data 带 actual/expected） | `sf(-32009,"Session state revision mismatch"` | server-types.ts:235 |
| -32010 | 冲突：prompt 已在跑 / subagent 只读 / admission 拒绝 | 14492354 等多处 | server-operations.ts:1923,1937,2439,2800 |
| -32018 | Account Provider Config runtime 未配置 | `sf(-32018,...)` | account-provider-config.ts:24 |
| -32020 | 无客户端挂接（反向请求不可达）；文档另标注 HeaderMismatch | `sf(-32020,"No ZCode Protocol client is attached...` | server.ts:815 |
| -32021 | MissingRequiredClientCapability | 枚举映射 | server.ts:834 |
| -32022 | UnsupportedProtocolVersion（运行时偏好降级路径） | `-32022]="UnsupportedProtocolVersion"` | server-operations.ts:3208 |
| -32031 | restoreWarning / 后台任务取消不支持 | `sf(-32031,...)` | server-operations.ts:1940,2036,2664 |
| -32042 | UrlElicitationRequired（MCP 层） | 枚举映射 | 无（见 SHAPE-DIFF-3） |

补充：真值 `-32001` 仅出现在 MCP 探测分类集合 `new Set([-32001,-32020,-32021])`，非应用 RPC 抛出码；`-32768/-32769` 为无关位运算。取消类旁路（见 §4.4）依赖 `-32601` 能力探测回退（automation 绑定检查先试 checkTaskBinding、遇 -32601 回退 list），我方同构（server-operations.ts:3212-3220）。

### §4.2 事件类型

- 会话事件（session/event 的 type 枚举，25 项）：真值 `L5i=m.enum([...])`（偏移 748643）= 我方 `droraSessionEventTypeSchema`（index.ts:1101-1127），**逐项同序全同**：session.created/resumed/updated/titleUpdated/closed、turn.started/steerQueued/steerDrained/completed/failed、message.upserted/removed、part.started/delta/upserted/removed、model.streaming、tool.updated、permission.requested/resolved、userInput.requested/resolved、checkpoint.created、rewind.triggered、streamRecovery.updated。每类 payload 由 discriminatedUnion 逐一定义（真值 `eGt`，我方 index.ts:1446-1486），`state.updated`（scope: server/workspace/session）双侧均有（真值偏移 755972；我方 index.ts:1486）。
- legacy 快照事件 union（6 项 kebab-case）：turn-started/turn-completed/turn-failed/tool-scheduled/tool-started/session-closed，双侧全同（真值 748140；我方 index.ts:1059-1096）。
- 流式增量 kind（13 项）：start、finish、error、text_start/delta/end、reasoning_start/delta/end、tool_input_start/delta/end、tool_call，双侧全同（真值 `fsr` 枚举；我方 index.ts:988-1002）。
- 事件信封：`{eventId,sessionId,turnId?,seq,traceId?,timestamp,deliveryKind?}` strict，双侧同形（真值 `hsr`；我方 index.ts:1037-1046）。`deliveryKind` 枚举同为 `["desktop-continuous","web-remote-replayable"]`（真值 `kV`；我方 drora-protocol-legacy-types.ts:14）。
- v4 推送 4 方法名全同（§1.2B/§2）。

### §4.3 反向请求

14 个方法、方向（CLI→客户端）、逐方法调用点计数（含 automationList/offPeakList×2、browserExecute×3、requestUserInput×2）双侧一致（§1.1B vs §2）。

### §4.4 信封与帧形状

- 分帧：NDJSON，逐行 `JSON.stringify(msg)+"\n"`；读侧按 `\n` 切分、trim、空行跳过。双侧同（真值 `ZCodeProtocolNdjsonConnection`，偏移 14670688；我方 transport.ts:91-101）。
- 信封 4 变体（union，strict）：请求 `{id:string|int,method,params?,trace?}`；通知 `{method,params?,trace?}`；应答 `{id,result}`；错误应答 `{id,error:{code:int,message,data?}}`。`trace={traceId?,parentId?,spanId?,traceparent?}`。双侧逐字段同形（真值 `qir/Wir/Vir/Hir`，偏移 735526；我方 index.ts:273-320）。无 `jsonrpc` 字段（bundle 中 `jsonrpc:"2.0"` 均属 MCP SDK）。
- 串行化与旁路：消息默认串行处理；`id+method` 且 method ∈ {session/stop, workspace/cancelGenerateText} 的请求旁路排队优先执行——双侧同构（真值 `shouldBypassProcessingQueue`；我方 transport.ts:224-231）。
- 应答后 outbox：v4 subscribe/resync 的 initialWires 挂在应答后的 postResponse outbox，帧以 `{method:"v4/conversation/frame",params}` 推送，双侧同构（真值 `postResponseOutbox`；我方 takePostResponseBatch 装配同形）。
- v4 连接握手：`clientMode` 枚举 `["desktop-continuous","web-remote-replayable"]`，双侧同（真值 `uQe`；我方 drora-protocol-v4/transport.ts:46,424,514）。

## §5 OPEN-QUESTION

1. **controller/subscribe|resync|unsubscribe 用途**：双侧都仅声明（各只出现 1 次）、无分发、无调用方。是预留的远端控制通道还是死常量，bundle 内无法定论；不构成差距，但语义未定。
2. **-32002/-32042 的我方等价物**：真值在 MCP 客户端错误映射中消费这两个码；我方 MCP 适配（drora-protocol/protocol-mcp-config.ts 等）是否以别的码/方式表达 ResourceNotFound 与 UrlElicitationRequired，未在本 pass 验证（归 MCP 域调查员更合适）。
3. **v4 行级 payload 深形状**：本 pass 只对到方法名与信封层；`v4/conversation/frame` 内 rows/row schema（真值 `Vj` 等）与快照 ePe 深结构未逐字段比对，建议归 A2/A3 域。
4. **协议名字面量改名**（"ZCode Protocol"→"Drora Protocol"）是否会影响与真值桌面端（electron host sourceTitle:"electron"）互操作，属产品决策，未验证。

### 附：关键证据偏移索引（真值）

| 偏移 | 内容（≤20 字摘） |
| --- | --- |
| 735526 | 信封 4 变体 qir 定义 |
| 735907 | BR 通知常量表 |
| 741361 | protocol name/version 字面量 |
| 748140/748643 | legacy 事件 union / 25 事件枚举 |
| 755972 | state.updated 事件 |
| 782000–787600 | va 常量表与 startup 族 |
| 1123127–1124881 | h0 v4 表与 jV 推送表 |
| 14451000 区段 | automation/offPeak 反向调用 |
| 14492354 | sf(-32010 冲突码现场 |
| 14659585 | case h0 v4 分发 |
| 14667243 | case va 兜底 sf(-32601 |
| 14670688 | NDJSON 连接类 |
