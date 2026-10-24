# Batch 7：官方 ZCode app-server/agent-server stdio 协议与进程调度调研

- 调研对象：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 字节，esbuild bundle）
- 定位手段：`grep -o`（LC_ALL=C）+ `r(fn,"保留名")` + `grep -bo` 字节偏移；证据以「保留名 / 偏移 / 片段」记录。
- 安全声明：只记录字段名、常量与结构，不含任何真实凭据。

---

## 1. 协议骨架

### 1.1 总体形态：NDJSON 分帧的 ZCode Protocol（两代方法族共存于同一流）

- **分帧**：NDJSON（换行分隔 JSON）。发送端 `output.write(JSON.stringify(msg)+"\n")`；接收端按 `\n` 切 buffer、逐行 `JSON.parse`（保留名 `ZCodeProtocolNdjsonConnection`，混淆名 `KEt`，偏移 ~14,973,888）。
- **协议名与版本**（shared 契约常量）：
  - `zet = "ZCode Protocol"`（ZCODE_PROTOCOL_NAME）
  - `$et = 1`（ZCODE_PROTOCOL_VERSION）
  - `hYi = 3`（ZCODE_PROTOCOL_V4_WIRE_VERSION；v4 帧内 `protocolVersion/wireVersion` 字面量 `hF = 3`）
- **消息信封**（`PXt = union([Umr,zmr,$mr,qmr])`，全部 `.strict()`）：
  - 请求：`{ id, method, params?, trace? }`
  - 通知：`{ method, params?, trace? }`
  - 成功响应：`{ id, result }`
  - 错误响应：`{ id, error: { code:int, message, data? } }`
  - **不是标准 JSON-RPC 2.0**：无 `jsonrpc:"2.0"` 字段，自带 `trace` 字段；但错误码沿用 JSON-RPC 惯例（bundle 内的 `jsonrpc:"2.0"` 代码全部属于 MCP SDK 段，勿混淆）。
- **错误类**：`uu = ProtocolRequestError { code, data, name:"ProtocolRequestError" }`。
- **错误码表**（全量枚举 `uu(-3xxxx` 与常量表）：

| 码 | 常量/来源 | 含义 |
| --- | --- | --- |
| -32700 | 字面量 | Parse error（JSON 解析失败，`sendError("parse-error",-32700,...)`） |
| -32600 | 字面量 | Invalid ZCode Protocol message（schema 校验失败，附 issues）；亦用于 workspace generate 重复操作 |
| -32601 | 字面量 | Method not found |
| -32602 | 字面量 | Invalid params（含 duplicate sampling operationId、MCP App 绑定不匹配等） |
| -32603 | 字面量 | Internal error（如 "v4 gateway is not initialized"） |
| -32000 | 字面量 `-32e3` | MCP UI sampling cancelled / Sampling busy |
| -32001 | 字面量 | MCP App connection unavailable |
| -32003 | 字面量 | 无 session store 时禁止导入历史 / 共享上下文导入需要原子会话存储 |
| -32004 | `bne.sessionUnavailable` | Session is not active / not found |
| -32009 | 字面量 | Session state revision mismatch（乐观并发校验失败） |
| -32010 | 字面量 | prompt 已在运行（busy 拒绝）；subagent 会话只读（reasonCode guard.subagentReadOnly） |
| -32018 | 字面量 | Account Provider Config runtime 未配置 |
| -32020 | `QZ.noClientAttached` | 服务端发起请求时无客户端 attach |
| -32021 | `QZ.cancelled` | 服务端发起的客户端请求被取消 |
| -32022 | `QZ.timedOut` / `pai` | 客户端请求超时（provider runtime headers 复用此码） |
| -32031 | 字面量 | 背景任务取消不被当前 runtime 支持 / provider 头未应用 / 恢复警告 |
| -32042 等 | MCP SDK `Mu` 枚举 | MCP 段专用（UrlElicitationRequired 等） |

### 1.2 串行化、旁路与背压（KEt 类实现）

- **单一处理队列**：`processing` promise 链严格串行；`lastQueuedMessageStarted` 保证排队消息顺序。
- **旁路集合（不排队，立即执行）**：
  - `session/stop`、`workspace/cancelGenerateText`（取消类请求必须旁路，防死锁）
  - `L0c = { mcp/readResource, mcp/uiOpenInstance, mcp/uiCloseInstance, mcp/uiValidateInstance, mcp/uiCallTool, mcp/uiSampling, mcp/uiCancelSampling, mcp/uiCancelCall, mcp/uiReadResource, ... }`（MCP UI 低延迟族）
  - 通知 `process/networkCapture`（校验通过直接处理，不等队列）
- **背压**：发送 `process/networkRequests` 通知时若 `output.writableLength >= 256*1024` 直接丢弃（网络遥测可牺牲）。
- **post-response outbox**：请求处理期间产生的通知先入 `postResponseOutbox`，响应发出后按批 flush（`takePostResponseBatch(id)`），保证"先响应后事件"的确定性顺序。
- **关闭**：stdin `end/close` → 排空剩余 buffer → 通知 transport closed → `drainTimer = 100ms`（`N0c`）后 finish；fatal 错误直接 fail。运行时关停 `idi/cleanupProtocolRuntime`：总预算 1200ms（`F0c`）、单步 400ms（`j0c`），顺序：sampler → mcp_telemetry → sessions shutdown → projections dispose → node_repl_browser_broker / mcp / mcp_pool 并行 → session_store / provider_registry / telemetry 并行。
- **心跳**：**无协议层 ping/heartbeat**。连接存活完全依赖 stdio 管道；流式停滞用事件兜底（内部事件 `streamRecovery.updated`、进度子事件 `kind:"stall"` 携带 `sinceMs/reason/cap`）。模型流空闲超时默认 10 分钟（`JH=6e5`，配置键 `modelStream.idleTimeoutMs`）。

### 1.3 握手

- v1 方法族**没有显式 initialize/鉴权握手**：spawn 后客户端直接发请求（进程由可信宿主拉起，鉴权在 HTTP 出口层）。
- v4 层有 hello 帧（见 §5.3）。
- MCP 子协议握手用 `server/discover`（现代 era）或 `initialize`（legacy），含版本协商（`EraNegotiationFailed`），属 MCP SDK 段。

---

## 2. 方法与通知全表

### 2.1 客户端 → 服务端：v1 方法注册表（`ii`，完整）

分发点：`ZCodeProtocolAgentServer.dispatchRequest` 的 `switch(t.method)`；未匹配抛 `-32601 Method not found`。

**runtime / session 生命周期**
| 方法 | 处理函数（保留名链） | 备注 |
| --- | --- | --- |
| `runtime/capabilities` | 内联 | 返回 `{independentPlanState:true}` |
| `computer-use/operation-event` | — | CU 操作事件 |
| `session/create` | `lci`（核心 `dci`） | 支持 importedHistory（需 session store，否则 -32003）；model/thoughtLevel 不支持时降级并 warn |
| `session/resume` | `pci` | |
| `session/list` | `fci` | |
| `session/read` | `mci` | params 含 `deliveryKind?/messageLimit?/contentProfile:"index"?`；index 只回索引 |
| `session/messages` | `hci` | |
| `session/events` | `gci` | |
| `session/subscribe` | `_ci` | attach 主通道，见 §5.2 |
| `session/send` | `yci` | busy 时 -32010；expectedRevision 乐观并发（-32009）；subagent 只读 |
| `session/stop` | `wci` | 旁路执行 |
| `session/cancelBackgroundTask` | `kci` | 不支持时 -32031 |
| `session/fork` | `Sci` | |
| `session/compact` | `vci` | |
| `session/goal` | `bci` | |
| `session/setModel` | `xci` | |
| `session/setThoughtLevel` | `Tci` | |
| `session/setMode` | `Ici` | |
| `session/close` | `Cci` | |
| `session/debug` | `cii` | |
| `session/usage` | `FFn` | |
| `session/subagents` | `LEt` | |
| `session/requestRuntimePreferences` | — | **服务端→客户端**反向使用（requestClient） |

**workspace / provider**
`workspace/readPresentation`(gai)、`workspace/hooks/trustGrant`（接受后向同 workspaceKey 全部活跃会话广播 reloadWorkspaceHookTrust）、`workspace/updateInteractionPreferences`、`workspace/updateModelIoPreferences`、`workspace/updateOffPeakToolPolicy`、`workspace/updateDynamicWorkflowPolicy`、`workspace/generateText`（AbortController 按 operationId 登记，重复 -32600）、`workspace/cancelGenerateText`（旁路）、`provider/updateAccountConfig`、`provider/testModelConnectivity`。

**MCP**
`mcp/list`、`mcp/readResource`（旁路）及 `mcp/ui*` 全族：uiOpenInstance / uiCloseInstance / uiValidateInstance / uiSampling / uiCancelSampling / uiCallTool / uiCancelCall / uiReadResource / uiListResources / uiListResourceTemplates / uiSubscribeResource / uiUnsubscribeResource / uiRegisterAppTools / uiUnregisterAppTools / uiClaimAppToolCall / uiResolveAppToolCall（多数旁路执行）。

**plugins / skills / workflows**
`plugins/list`、`plugins/referenceCatalog`、`plugins/referenceCatalogWithCategory`、`plugins/listUiSurfaces`、`plugins/resolveSuggestedReference`、`plugins/setEnabled`、`plugins/overview`、`plugins/marketplace/add|remove|update`、`plugins/install`（AbortController）、`plugins/cancelOperation`、`plugins/uninstall`、`plugins/update`、`plugins/restoreBuiltin`、`plugins/configure`、`plugins/resetConfig`、`plugins/validate`、`plugins/describe`、`skills/referenceCatalog`、`workflows/list|get|updateMeta|delete|runs|move|save|forRun`。

**automation / offPeak / usage / process / interaction**
`automation/create|update|delete|list|checkTaskBinding`、`offPeak/create|list`、`usage/stats`、`process/childProcesses`（来自 mcpTelemetry.listProcesses）、`process/networkCapture`（通知形态）、`interaction/requestPermission`、`interaction/requestUserInput`、`interaction/requestProviderRuntimeHeaders`、`interaction/requestOfficialMcpAuthHeaders`、`interaction/browserList`、`interaction/browserExecute`、`topic/resource/read`、`topic/resource/cancel`、`bot/channel/reply`。

### 2.2 客户端 → 服务端：v4 方法族（`Sg`，完整）

| 方法 | 用途 |
| --- | --- |
| `v4/connection/flow` | 设置连接 flow 状态（`setConnectionFlowState`） |
| `v4/controller/subscribe` / `resync` / `unsubscribe` | 控制器投影订阅 |
| `v4/conversation/subscribe` / `resync` / `unsubscribe` | 会话投影订阅（topic 可为会话索引保留主题） |
| `v4/conversation/rowsRange` | 行范围查询（`queryCommands` 所在网关） |
| `v4/conversation/plans` / `fileChanges` / `backgroundBashOutput` / `fileRewindPreview` / `workflowRunEvents` / `workflowRuns` / `workflowRunArtifacts` / `workflowRunArtifactData` / `workflowRunArtifactRead` / `workflowRunWorkspace` / `workflowRunNodeResult` / `usage` | 会话投影只读查询 |
| `v4/attachment/begin` / `chunk` / `commit` / `abort` / `read` / `previewSource` | 附件上传（begin/chunk/commit 协议） |
| `v4/conversation/attachmentRead` / `attachmentStat` | 附件读取 |
| `v4/usage/stats` | 使用统计 |
| `v4/commands/query` | 命令幂等查询（`PersistentCommandIndex`，时钟可比对） |
| `v4/command` | v4 会话命令执行入口 |

**v4 命令类型**（`znn` 白名单 + 分发表）：`applyFileRewind, forkAssistant, editUserQuery, retryTurn, setAssistantFeedback, sendQueuedNow, editQueueItem, reorderQueueItem, deleteQueueItem, setAutoDrain, switchModelConfig, switchCollaborationMode, setFollowupMode, pauseGoal, resumeGoal`；另有 `resumeGoal`、`createSelectionSideSession`、`interrupt` 参与 admission（`Xui` 判定 + sessionId 必须可解析）。命令带 `baseRevision/commandId/issuedAt/payload/sessionId/type`，幂等键 `commandId`；auto-drain 由网关以 `clientId:"v4-auto-drain"` 代发 `sendQueuedNow`（失败暂停队列 `setAutoDrain(false)`）。
**附件限额**：`attachmentMaxBytes 20MB`、chunk 512KB、preview 30MB、stat 上限 2GB、命令 pending TTL 1440min、幂等表每会话 512 条、conversation query 超时 10s。

### 2.3 服务端 → 客户端：通知（`sT` 注册表，完整）

| 方法 | 内容 |
| --- | --- |
| `startup/storageState` | SQLite 启动进度（schemaVersion 1：attemptId/sequence/databaseId/databaseKind(session,tasks-index)/phase(checking,waiting_for_lock,migrating,committing,ready,failed)/migration/elapsedMs/errorCode） |
| `interaction/providerRuntimeHeadersCancelled` | 鉴权头请求被取消/超时（-32022） |
| `process/mcpTelemetry` | MCP 资源遥测（kind 过滤 `memory` 不发） |
| `process/mcpResourceSamples` | MCP 进程树采样结果 |
| `process/toolExecResource` | 工具执行资源事件（onToolExecResource 直发） |
| `plugins/operationProgress` | 插件操作进度 |
| `process/resourceSample` | 进程资源采样 |
| `process/networkRequests` | 网络遥测批（背压丢弃型） |

**会话事件通知 `session/event`**（`notify({method:"session/event",params})`）：
- 信封（`xhr`）：`{ eventId, sessionId, turnId?, seq:int≥0, traceId?, timestamp, deliveryKind }`；deliveryKind ∈ `desktop-continuous | web-remote-replayable`（`kH`）。
- v1 wire 事件 kind（`LYi` 判别联合）：`turn-started` / `turn-completed` / `turn-failed` / `tool-scheduled`（含 toolCallId/toolName/computerUse?）/ `tool-started` / `session-closed`（信封 `rhe`：eventId+sequenceNumber）。
- v4 事件 type（`L_(type,payload)`，25 种全表）：`session.created / session.resumed / session.updated / session.titleUpdated / session.closed / turn.started / turn.steerQueued / turn.steerDrained / turn.completed / turn.failed / message.upserted / message.removed / part.started / part.delta / part.upserted / part.removed / model.streaming / tool.updated / permission.requested / permission.resolved / userInput.requested / userInput.resolved / checkpoint.created / rewind.triggered / streamRecovery.updated`。
- 内部领域事件（`FYi` 枚举）与上表一致，发送前可被过滤（`zcode_protocol.session_event.filtered`）。

### 2.4 服务端 → 客户端：反向请求（`requestClient`）

机制：`requestClient(method, params, resultSchema, {signal, timeoutMs})`；`pendingClientRequests` 按 `nextClientRequestId` 递增分配 id；无客户端 attach → -32020；取消 → -32021；超时 → -32022。全部调用点（即客户端必须实现的服务端发起请求）：

| 方法 | 次数 | 场景 |
| --- | --- | --- |
| `interaction/requestPermission` | 1 | 权限请求（input/reason/requestId/riskLevel/sessionId/origin?/options/toolCallId/toolName/turnId） |
| `interaction/requestUserInput` | 3 | 用户输入（AskUserQuestion 类） |
| `interaction/requestProviderRuntimeHeaders` | 1 | 模型请求前向宿主要鉴权头（超时 180s，`tmc=18e4`） |
| `interaction/requestOfficialMcpAuthHeaders` | 1 | 官方 MCP OAuth 头 |
| `interaction/browserList` / `browserExecute` | 1/3 | 浏览器控制 |
| `automation/create|update|delete|list|checkTaskBinding` | 5 | 自动化任务落宿主 |
| `offPeak/create|list` | 3 | 错峰任务 |
| `sessionRequestRuntimePreferences`（`session/requestRuntimePreferences`） | 1 | 运行时偏好 |
| `subagents/readRuntimeConfig`（`subagents/readRuntimeConfig`） | 1 | 子代理运行时配置 |
| `topic/resource/read` / `cancel`、`bot/channel/reply` | 3 | Bot 频道 |

---

## 3. 鉴权

### 3.1 RPC/HTTP 头（shared 契约，bundle 内定义于同一模块）

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `Qcs`（ZCODE_RPC_CLIENT_MODE_HEADER） | `x-zcode-rpc-client-mode` | stdio 路径内未见消费；供远程链路声明客户端模式（desktop-continuous / web-remote-replayable） |
| `els`（ZCODE_RPC_HOST_CAPABILITY_HEADER） | `x-zcode-rpc-host-capability` | 宿主能力声明 |
| `tls` 枚举 | host capability 值 | `database-startup-control, init-local, connect-remote-workspace, cancel-remote-workspace-connect, bind-remote-workspace-context, dispose-remote-workspace-session, attach-service-port, detach-service-port, dispose, broadcast, broadcast-claim-result, task-realtime-deliver, task-run-lease-result, task-owner-command-deliver, task-owner-command-result, bot-remote-workspace-reconnect-result, bot-remote-workspace-connection-status-result, bot-remote-workspace-runtime-port, session-message-deliver, session-message-delivery-result, feedback-log-archive-result, cron-run, off-peak-run, browser-execute-result, local-media-preview-path-authorize-result, plugin-sandbox-register-result, cua-pip-focus-changed, provider-provi…`（截断） |
| 出站 source headers | `x-zcode-app-version / x-zcode-query-source / x-zcode-session-type / x-zcode-trace-id`（另有通用 `x-request-id/x-session-id/x-query-id`） | `Boi/buildCliZCodeSourceHeaders` 构造：appVersion、arch、clientLanguage、clientTimezone、deviceMid、endpointOrigin、osVersion、platform、releaseChannel、sourceTitle；session-type 取值 `sess_`/`subagent_agent_`/`query_` 前缀体系，id 校验 `/^[A-Za-z0-9_.:-]{1,128}$/` |
| `clientMode` 字段值 | `desktop-continuous | web-remote-replayable` | 亦作 deliveryProfile `continuous | replayable`（trusted client 校验两者一致） |

**要点：stdio 协议本身无鉴权 challenge**——信任来自"宿主进程 spawn + 本机管道"；鉴权发生在模型/远程出口（source headers + OAuth）。

### 3.2 凭据存储（`~/.zcode/v2/credentials.json`）

- 路径：`Vta()` = `join(baseDir ?? env.ZCODE_DATA_BASE_DIR ?? homedir, ".zcode", "v2", "credentials.json")`。
- **无 keytar**（grep 0 命中）；自实现加密 JSON store（读-改-写 `H$`，含 `onDidChange` 订阅）。
- 加密：AES-256-GCM（`Mso="aes-256-gcm"`，IV 12B `Nso`，tag `Nta`），密文格式 `enc:v1:<iv b64url>.<tag b64url>.<ct b64url>`（前缀 `V0n="enc:v1:"`）。
- 密钥：SHA-256（`jta`）of `env.ZCODE_CREDENTIAL_SECRET`（`Lta`）；缺省 fallback 串 `zcode-credential-fallback:<platform>:<homedir>:<username>`（`Bta`）。
- 键名（`$b`）：`oauth:active_provider, oauth:bigmodel:access_token, oauth:bigmodel:refresh_token, oauth:bigmodel:user_info, oauth:zai:access_token, oauth:zai:refresh_token, oauth:zai:user_info, zcodejwttoken`；`saveZaiLoginCredentials` 原子写四键。
- CLI OAuth 设备码流：base `https://zcode.z.ai/api/v1`（`Cta`），`CliOAuthError`；init 返回 authorize_url/flow_id/poll_interval_sec，poll ready 返回 token+access_token(+refresh_token)+user。

### 3.3 运行时鉴权头端口（桌面下发模式）

`mai/createProviderRuntimeHeadersPort`：每次模型请求前 `requestClient("interaction/requestProviderRuntimeHeaders", {requestId:`${sessionId}:provider-runtime-headers:${uuid}`, sessionId, turnId, workspace, modelSelection:{providerId,modelId}, providerId, accountAccess?, expectedAccountScope?, rejectedProjectTokenFingerprint?, reason}, …, {timeoutMs:180000})`；取消/超时 → 通知 `interaction/providerRuntimeHeadersCancelled`；`headersApplied=false` → -32031。**即：CLI 自身可不带 token，由宿主（桌面/远控端）按请求注入 provider 头**；官方 MCP 亦有无 auth 时自动回 401/`not_authenticated`(1006)/`coding_plan_required`(3101) 的分类（连接失败码解析处）。

---

## 4. 进程调度拓扑

### 4.1 CLI 子命令与入口分流

- `main(vbc)` → parseArgs 特判：`positionals[0] === "app-server" | "agent-server"` 且无 -p/--target/help/version → serve。
- `switch(xAt(positionals))` 中 `case "agent-server": case "app-server":` **完全同路径** → `_bc/runZCodeProtocolCommand` → `runZCodeProtocolAgent`（`hdi`）。
- `--surface terminal|desktop` → presentationSurface `terminal | zcode_desktop`（`normalizePresentationSurface`；`--surface` 仅允许与 -p/--target/app-server/agent-server 同用）；`Clc()` 按 argv 是否含 app-server/agent-server 推断默认 sourceTitle `electron | cli`。
- `--prepare-storage` → 仅做 `Woi`（SQLite 启动状态经 `startup/storageState` 通知回报，input/output 仍接 stdin/stdout）。
- 其他相关子命令：`tui`、`login`/`logout`、`doctor`、`plugin-host <server-path> [-- <args>]`（`xPe/isPluginHostInvocation`：以 `process.argv=[execPath, serverPath, ...]` 动态 import 插件 server 的 `main()`；持有 CUA broker 凭据时强制校验只能拉起受信共享 node_repl host，env 校验 `pluginAuthority` + broker socket + `cfe==="1"`）。
- 信号处理：`registerCliShutdownHandlers`（win32: SIGINT/SIGTERM；其余 + SIGHUP），cleanup 预算 2000ms，退出码映射 SIGHUP:129/SIGINT:130/SIGTERM:143，退出 watchdog 1000ms。

### 4.2 glm 二进制被宿主拉起的方式（本 bundle 即 glm）

- 描述符 `yyr`（`tts()/getGlmBinaryDescriptor`）：`{binaryKind:"native-binary", binaryEnvVar:"GLM_BINARY_PATH", bundledResourceDir:"glm", version:"0.13.3", spawnArgs:["app-server","--stdio"], nativeConfigDir:".zcode/cli", nativeConfigFileName:"config.json", resolveEntrySegments: resolvePlatformBinaryName("zcode-agent",…), missingBinaryMessage:"[ZCode Agent] glm binary 未找到，请设置 ZCODE_AGENT_WORKDIR、GLM_BINARY_PATH 或先准备 GLM 运行时资源"}`。
- 即宿主（Drora desktop / GLM 宿主）spawn `glm app-server --stdio`，协议即本文 §1–§3；`~/.zcode/cli/config.json` 为其原生配置。bundle 内不含 spawn 自己的代码（spawn 方在宿主）。

### 4.3 服务端内部"端口"（adapter 意义，非 TCP）

- `providerEndpointRoutingPort`：`eUe/resolveProcessProviderEndpointRoutingPort` —— 按_endpointOrigin_ 缓存的 provider 路由 adapter（Uhn），带 sourceHeaders 工厂与 proxy/noProxy/caCert HTTP client。**不是本地监听端口**。
- `browserControlPort = CEt(context)`：浏览器控制 port（供 interaction/browser* 与 node-repl broker 转发）。
- `mcpPort`/`mcpPortFactory`：`w.acquireLease({leaseId:"protocol-settings"})`、每会话 `acquireLease({leaseId:sessionId, sessionId})` —— MCP 端口租借。
- `nodeReplBrowserBroker`：见 4.4。

### 4.4 node-repl 浏览器代理（本地 IPC）

- `iCt/createNodeReplBrowserBroker`：本机 HTTP server 监听 **Windows named pipe** `\\.\pipe\zcode-node-repl-<uuid>`（`Bcc`）或 **unix socket** `$TMPDIR/znr-<uuid>.sock`；`server.unref()`。
- 鉴权：32 字节 hex token（`randomBytes(32)`），请求 token 用 `timingSafeEqual` 比对；不匹配即拒绝。
- 协议：请求 JSON `{id, op:"list"|"execute", sessionId, turnId, browserId?, browserGeneration?, command?, trace?}`，响应 NDJSON 单行 `{id, ok, browsers?|error?}`。
- 下发方式：`_Nn` 把 env 注入 node_repl 的 stdio transport：`ZCODE_NODE_REPL_BROWSER_BROKER_SOCKET`（`Atn`）+ `ZCODE_NODE_REPL_BROWSER_BROKER_TOKEN`（`Ptn`），仅当 transport.type==="stdio" 且 mcpId `node_repl`。

### 4.5 MCP stdio 子进程管理

- `YFe/StdioClientTransport`（MCP SDK）+ `NJ/ProcessTreeStdioClientTransport` 扩展：
  - `requestMetaProvider` — send 前 merge `_meta`（`Qaa/mergeRequestMeta`）；
  - **Windows Job Object**：start 时按 pid `windowsJobObjectFactory(pid)`，`_dispose` 先 `terminate()` 再 close，随后整树 kill（`Vmt(pid)` 兜底）——保证 MCP 子进程树不残留；
  - `processExit/processAlive` 记录退出信息。
- 资源采样：`ado/createMcpResourceTelemetry` 每 **5 分钟**（`Vet=5*6e4`）采样活跃 MCP 实例的进程树（pid→rss/cpuTime/uptime），按 mcpId 聚合 → `process/mcpResourceSamples`。
- elicitations/notifications：`vii/requestMcpElicitation`、`dFn/handleMcpNotification` 经 protocol 层转发到客户端；`McpUiSamplingCalls` 管理 sampling（-32000 busy/cancelled）。

### 4.6 会话驻留池（进程内调度）

- `GEt`（sessionResidentPool）：`targetCount` / `highWaterCount`（缺省 max(16,target)）/ `idleTimeoutMs`；`Iii/…` host 提供 readResidencyFacts/isEligible/deactivate；超水位按 `eligibleSinceAt+lastUsedAt` 淘汰（`rebalanceResidentSessions`），操作期间 `acquireOperation` 计数保护；`P0c=1e4` 相关节流。事件存储修剪 `pruneSessionEventStores`、v4 分离子发布者修剪 `pruneDetachedChildPublishers`。

---

## 5. 多客户端 attach / snapshot / lease

### 5.1 单客户端 attach（stdio 面）

- `connectClient`：设置 `messageSink`、清 `clientDisconnectError`；**同时只允许一个客户端**——`requestClient` 无 sink 即抛 -32020 `noClientAttached`。
- `disconnectClient(err)`：置 `clientDisconnectError`，拒绝全部 `pendingClientRequests`，`networkCapture.setCaptureId(null)`。
- 多客户端扩展发生在宿主层（desktop host attachment / relay），不在 app-server stdio。

### 5.2 attach 通道：`session/subscribe` + snapshot

- 请求：`{sessionId, deliveryKind, afterSeq?, includeSnapshot?}`。
- 响应：`{eventSeq, events[], sessionId, snapshot?}` —— `afterSeq` 事件回放（`RFn`）+ 当前 seq（`cci`）+ 可选全量快照。
- snapshot：`gj/buildSessionSnapshot`，**预算 `sfc = 20*1024*1024`（20MB）**；`session/read` 支持按 `deliveryKind`、`messageLimit`、`contentProfile:"index"` 取索引。
- 事件续传由每事件 `seq`（xhr.seq）保证幂等续放；订阅切换 deliveryKind 直接改写记录（`o.deliveryKind=…`）。

### 5.3 v4 多客户端 wire（hello / fragment / recovery）

- 客户端 hello（`Fzc`）：`{kind:"clientHello", protocolVersion:3, clientId, clientKind?:"desktop"|"web"|"mobileRemote"|"mobileApp", appVersion, capabilities:{workspaceHookReviewUi?, workflowRunDeltas?, independentPlanState?}}`。
- 服务端 hello（`Lzc`）：`{kind:"hello", protocolVersion:3, connectionId, clientMode:"desktop-continuous"|"web-remote-replayable", deliveryProfile:"continuous"|"replayable", serverTime, capabilities, auth:{userId?}}`。
- 订阅帧（`Gnt/Jnt`）：`{wireVersion:3, kind:"complete"|"fragment", deliveryKind:"initial"|"online"|"recovery", logicalFrameId, logicalFrameOrdinal, topic, subscriptionId, frame}` —— initial=首帧全量、online=增量、recovery=断线恢复；fragment/complete 支持大帧分片。deliveryProfile 与 clientMode 需一致（superRefine "trusted client must match"）。

### 5.4 broadcast claim（跨宿主互斥）

- `broadcast-claim-request {requestId, key≤1024}` → `broadcast-claim-result {requestId, status:"acquired", claimToken} | {status:"busy", retryAfterMs} | …` → `broadcast-claim-commit {key, claimToken}` / `broadcast-claim-release {key, claimToken}`。token 化两段提交。

### 5.5 task-run-lease（任务运行租约，ownerHostId）

- acquire 请求（`CYt = efr.extend({leaseRequestId}).strict()`）：`{workspacePath, workspaceIdentity?, workspaceKey, taskId, runId, traceId, ownerClientId?, ownerDeviceLabel?, leaseRequestId}`（`Wme/met` superRefine 做 workspace/task 校验）。
- 结果（`EYt` 判别联合）：`{leaseRequestId, acquired:true, ownerHostId}` 或 `{leaseRequestId, acquired:false, ownerHostId, reason:"owned_by_other_host"}`。
- release：`H0r = het`（同 efr 结构，`task-run-lease-release`）。
- 相关宿主消息族（`tls` 能力名 + wire type）：`task-realtime-publish/deliver`、`task-stream-op-publish`、`task-owner-command-request/deliver/result`、`session-message-send-requested/route-announce/deliver-result`、`bot-remote-workspace-reconnect/connection-status/runtime-port`、`cron-run/off-peak-run/scheduler-wake`、`browser-execute-request`、`local-media-preview-path-authorize-request`、`plugin-sandbox-register-request`、`network-telemetry-batch`、`provider-provisioning-source-changed/execution-result`。任务流镜像批 `task_stream_mirror_batch` 带 `batchSeq/fromSeq/toSeq` + ownerClientId/ownerDeviceLabel。
- 会话驻留与 lease 协同：命令 admission `admitCommandInput` 对 `resumeGoal/sendQueuedNow/forkAssistant/createSelectionSideSession` 等要求 sessionId 可解析；`discardAdmittedOnLoad` 决定加载会话时是否丢弃已 admit 未执行命令。

---

## 6. 证据锚点（偏移为 `grep -bo` 字节偏移）

| 结论 | 保留名 | 偏移/位置 |
| --- | --- | --- |
| 协议名/版本 | `zet="ZCode Protocol"`, `$et=1`, `hYi=3`, `bne={sessionUnavailable:-32004}` | ~770k 区域（常量区） |
| NDJSON 连接 | `KEt = ZCodeProtocolNdjsonConnection` | 14,973,888（`start(){this.options.input.on("data"`） |
| 消息信封 | `PXt=union([Umr,zmr,$mr,qmr])`（request/notification/response/error，strict，带 trace） | 紧邻 `sT` 定义 |
| v1 方法注册表 | `ii={runtimeCapabilities…}`（~120 方法） | 分发表 `switch` 前定义 |
| 分发 switch | `ZCodeProtocolAgentServer（JEt）.dispatchRequest` | `case ii.sessionCreate` ~15.0M |
| 服务端通知表 | `sT={storageStartup…processNetworkRequests}` | 紧邻 `PXt` |
| v4 方法表 | `Sg={connectionFlow:"v4/connection/flow"…}` | — |
| v4 命令白名单 | `znn=new Set([…])` | — |
| 反向请求 | `requestClient(t,n,o,i)`、`QZ={noClientAttached:-32020,cancelled:-32021,timedOut:-32022}` | — |
| 鉴权头端口 | `mai/createProviderRuntimeHeadersPort`、`tmc=18e4`、`pai=-32022` | — |
| 凭据 | `Vta`（credentials.json）、`$b` 键表、`Mso/Nso/V0n`（AES-256-GCM enc:v1:）、`Lta="ZCODE_CREDENTIAL_SECRET"` | — |
| CLI OAuth | `Cta="https://zcode.z.ai/api/v1"`、`nN/CliOAuthError` | — |
| glm 描述符 | `yyr={…spawnArgs:["app-server","--stdio"]…}`、`tts/getGlmBinaryDescriptor` | — |
| app-server 分流 | `case"agent-server":case"app-server":return await _bc(…)`、`hdi/runZCodeProtocolAgent`、`normalizePresentationSurface` | — |
| plugin-host | `xPe/isPluginHostInvocation`、`rZe/runPluginHostCommand`、`N7i` usage | — |
| node-repl broker | `iCt`（HTTP over named pipe/UDS）、`Bcc`（路径）、`Atn/Ptn`（env 键）、`Ucc`（token 校验） | — |
| MCP stdio | `YFe/StdioClientTransport`、`NJ/ProcessTreeStdioClientTransport`（Windows Job Object）、`ado/createMcpResourceTelemetry`（`Vet=5*6e4`） | — |
| 快照 | `sfc=20*1024*1024`、`BLn/buildSessionSnapshot` | — |
| v4 wire 帧 | `Fzc/clientHello`、`Lzc/hello`、`Gnt/Jnt`（complete/fragment, deliveryKind initial/online/recovery, wireVersion:hF=3） | — |
| lease/broadcast | `CYt/EYt/H0r`（ownerHostId）、`uen/Zgr/U0r/z0r/$0r`（broadcast claim） | — |
| 驻留池 | `GEt`（targetCount/highWaterCount/idleTimeoutMs）、`P0c=1e4` | — |
| 默认配置 | `Fm={modelStream.idleTimeoutMs:6e5, permission.mode:"build", storage.dir:"~/.zcode"…}`、`JH=6e5` | — |

## 7. 与 Drora 对照要点（供 parity 甄别）

1. **协议形态**：Drora 的 drora-protocol 若按 JSON-RPC 2.0 信封实现，与官方 `{id,method,params,trace}` 无 `jsonrpc` 字段的信封不同；错误码语义（-32004/-32010/-32020~-32022/-32031 等）值得对齐。
2. **busy 拒绝在 server**：官方 `session/send` 直接 -32010 拒绝 + `expectedRevision` 乐观并发；Drora 的 `CommandInbox` 串行 admission 语义需与之区分（AGENTS.md 已要求保留 owner/lease 边界）。
3. **鉴权头宿主下发**：`interaction/requestProviderRuntimeHeaders`（180s 超时、可取消通知）是官方"CLI 不持 token"的关键机制，Drora 的 IPlatformService/凭据方案可对照。
4. **attach 语义**：单客户端 stdio + `session/subscribe(afterSeq, includeSnapshot)` + v4 `initial/online/recovery` 三态投递，对应 Drora 的 desktop-continuous 与 web-remote-replayable 双链路命名（官方同名）。
5. **lease/broadcast 在宿主层**：`task-run-lease-acquire/release`（ownerHostId、owned_by_other_host）与 broadcast-claim token 属宿主 attachment/relay 消息族，不占 app-server stdio 方法表。
