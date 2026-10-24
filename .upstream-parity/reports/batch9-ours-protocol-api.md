# Batch 9 —— 我方进程协议（drora-protocol/RPC）与模型 API 客户端清单

日期：2026-10-19。只读调研，对照基线为 batch7 官方 bundle 结论（ZCode Protocol v1 / v4 wireVersion=3 / 凭据 AES-256-GCM / ai-sdk 内嵌 / 重试 11 次 2s×2 封顶 60s / 流空闲 600s / `app-server --stdio` / MCP ProcessTreeStdioClientTransport+Windows Job Object / node-repl broker named pipe+token / attach 单客户端 subscribe(afterSeq,includeSnapshot) 20MB / contextWindow 取 provider 规则 properties 默认 200k）。本文只写当前检出的 Drora 源码事实，不写任何凭据值。

---

## 1. 协议形态

### 1.1 分帧 / 信封

- **NDJSON 分帧**：`DroraProtocolNdjsonConnection`（`apps/drora-cli/packages/bootstrap/src/drora-protocol/transport.ts:67`）。逐行 `JSON.stringify(message) + "\n"`（transport.ts:112），按 `\n` 切帧（transport.ts:118-130）。与官方 `ZCodeProtocolNdjsonConnection` 同构（改名后同源）。
- **信封四型**：`{id, method, params, trace?}` request、`{method, params, trace?}` notification、`{id, result}` response、`{id, error:{code,message,data?}}` error（`packages/shared/src/drora-protocol/index.ts:396-443`）。非 JSON-RPC 2.0 信封但沿用其错误码族。
- **trace 支持**：`droraProtocolTraceSchema = {traceId?, parentId?, spanId?, traceparent?}`（`packages/shared/src/drora-protocol/trace.ts:3-11`），request/notification 均可携带。
- **EOF 语义**：EOF 后 100ms drain 保留半关闭响应（`PROTOCOL_EOF_DRAIN_MS`，transport.ts:27,142）。

### 1.2 版本

- `"Drora Protocol" v1`：`DRORA_PROTOCOL_NAME/DRORA_PROTOCOL_VERSION`（drora-protocol/index.ts:118-119）——对应官方 "ZCode Protocol" v1。
- V4 wire `wireVersion=3`：`V4_WIRE_PROTOCOL_VERSION = 3`（`packages/shared/src/drora-protocol-v4/core.ts:8`；`drora-protocol/index.ts:121` 同值并存），与官方 v4 wireVersion=3 一致。V4 projection snapshot 独立用 protocolVersion=1（core.ts:7 注释）。

### 1.3 方法表规模（对比官方 120 v1 + 30 v4 + 15 命令 + 8 通知 + 25 事件 + ~20 反向）

| 维度 | 我方数量 | 出处 |
| --- | --- | --- |
| legacy v1 方法 | **100** | `droraProtocolMethods`（drora-protocol/index.ts:4146-4281） |
| legacy 服务端通知 | **8** | `droraProtocolNotifications`（index.ts:445-454）：startup/storageState、interaction/providerRuntimeHeadersCancelled、process/mcpTelemetry、process/mcpResourceSamples、process/toolExecResource、plugins/operationProgress、process/resourceSample、process/networkRequests |
| legacy session 事件 | **25** | `droraSessionEventSchema` 联合（index.ts:1793 附近）：session.created/resumed/updated/titleUpdated/closed、turn.started/steerQueued/steerDrained/completed/failed、message.upserted/removed、part.started/delta/upserted/removed、model.streaming、tool.updated、permission.requested/resolved、userInput.requested/resolved、checkpoint.created、rewind.triggered、streamRecovery.updated |
| V4 方法 | **31** | `V4_METHODS`（drora-protocol-v4/transport.ts:332-384）：v4/connection/flow、v4/controller/{subscribe,resync,unsubscribe}、v4/conversation/{subscribe,resync,unsubscribe,rowsRange,plans,fileChanges,backgroundBashOutput,fileRewindPreview,workflowRunEvents,workflowRuns,workflowRunArtifacts,workflowRunArtifactData,workflowRunArtifactRead,workflowRunWorkspace,workflowRunNodeResult,usage,attachmentRead,attachmentStat}、v4/usage/stats、v4/attachment/{begin,chunk,commit,abort,read,previewSource}、v4/commands/query、v4/command |
| V4 通知 | **4** | `V4_NOTIFICATIONS`（transport.ts:407-415）：v4/conversation/frame、v4/telemetry/event、v4/telemetry/local-ttft、v4/cua/permission-observation |
| V4 命令 | **35** | `commandPayloadSchemas`（drora-protocol-v4/command.ts:45-284）：createSession、createSelectionSideSession、sendText、sendGoalCommand、stop、compact、forkAssistant、applyFileRewind、editUserQuery、retryTurn、setAssistantFeedback、setHighspeedMetrics、sendQueuedNow、editQueueItem、reorderQueueItem、deleteQueueItem、setAutoDrain、resolveInteraction、respondWorkspaceHookReview、toggleWorkspaceHookReviewItem、revokeWorkspaceHookTrust、requestWorkspaceHookReview、snoozeInteractionAutoResolution、switchModelConfig、switchCollaborationMode、setFollowupMode、pauseGoal、resumeGoal、cancelBackgroundWork、resumeWorkflowRun、startSavedWorkflow、amendWorkflowRunSettings、renameSession、deleteSession、discardSharedContext |
| 存储 preparation 私有控制帧 | 4 | `droraStoragePreparationFrameSchema`（index.ts:4382-4395）：startup/storagePath、storagePrepared、storageState、storagePathReady |

对照：官方 120 v1 ≈ 我方 100（部分官方词在我方已判死并删：session/steer、session/rewind、prompt/enhance、plugins/marketplace/list 等全簇，见 index.ts:22-33 删除边界注释）；官方 30 v4 ≈ 31；官方 15 命令 vs 我方 35（3.15.x 后我方 V4 命令面更宽，见 §8）；通知 8=8；事件 25=25。

### 1.4 错误码

- JSON-RPC 同族字面量直接使用：-32700 parse error、-32600 invalid message（bootstrap/drora-protocol/transport.ts:257,263）、-32601 method not found（bootstrap/drora-protocol/server.ts:817）、-32602 invalid params（server-operations.ts:1275 等）、-32603 internal（server.ts:823）。
- 自定义段：`droraProtocolErrorCodes.sessionUnavailable = -32004`（drora-protocol/index.ts:125-127）；server→client 反向请求失败码 `PROTOCOL_CLIENT_REQUEST_ERROR_CODES = {noClientAttached:-32020, cancelled:-32021, timedOut:-32022}`（bootstrap/drora-protocol/server-types.ts:202-209）。与官方"非 JSON-RPC 2.0 但沿用错误码"一致。

### 1.5 处理队列 / 取消旁路 / 背压 / 心跳

- **单处理队列 + 取消旁路**：普通请求串行 `processing` 链；`sessionStop`、`workspaceCancelGenerateText` 与 17 个 MCP App 并发方法走旁路（等 `lastQueuedMessageStarted` 后立即执行，不排队）（bootstrap/drora-protocol/transport.ts:219-244,272-282；并发方法集合 transport.ts:30-48）。`process/networkCapture` 通知也无旁路直通（transport.ts:197-208）。与官方"单处理队列+取消类旁路"一致。
- **响应时序**：response 写出前一次性 take post-response outbox（subscribe 的 initial snapshot 在 response 行之后按 owned notification 发出，transport.ts:284-310）。
- **背压**：v4 有显式流控方法 `v4/connection/flow`（state = saturated/drained/closed，transport.ts:394-405）；观测通知在 stdout `writableLength ≥ 256KiB` 时丢弃（transport.ts:102-110）；V4 限额 `PROTOCOL_V4_LIMITS`（core.ts:65-104）：物理帧 1MiB、逻辑帧组装 16MiB/1024 分片/30s 超时、订阅缓冲 500 ops·1MiB、事件保留 2000/session、附件 20MiB·512KiB chunk；wire 分片带 crc32 checksum + base64（drora-protocol-v4/wire.ts:7-43）。relay 链路另有限制：物理帧 1MiB、重放缓冲 8MiB、ACK grace 45s、水位 1MiB/256KiB（packages/relay-client/src/clock.ts:6-7、packages/shared/src/relay-wire/constants.ts:9-15、replayBuffer.ts:88-89）。
- **心跳**：协议层无心跳（全仓 bootstrap/drora-protocol* 无 heartbeat/ping 实现），与官方一致；流活性由模型流空闲超时兜底（见 §4.4）。
- **stdio 鉴权**：无握手鉴权帧；启动期仅 storage preparation 私有控制帧与 `runtime/capabilities` 方法（drora-protocol/index.ts:4147）。与官方"stdio 无握手鉴权"一致。

## 2. 反向调用（agent→host，对应官方 requestClient ~20 方法）

- 机制：CLI server 持有 `requestClient(method, params, resultSchema, options)`（bootstrap/drora-protocol/server.ts:245-307,905），失败按 §1.4 的 -32020/-32021/-32022 翻译。
- **请求类 7 个**（`droraProtocolMethods`）：
  1. `interaction/requestPermission`（index.ts:4271）——权限弹窗；
  2. `interaction/requestUserInput`（4272，params index.ts:2726-2740：questions/origin/schema，响应 accept/decline/cancel+content）；
  3. `interaction/requestProviderRuntimeHeaders`（4273，params index.ts:2752-2771：modelSelection+providerId+accountAccess+reason，响应 requestAuth{apiKey,apiKeyId,accountScope,headers}，index.ts:2788-2813）——对应官方"模型请求前向客户端要 provider 头"；
  4. `interaction/requestOfficialMcpAuthHeaders`（4274，index.ts:2822-2859：agent 无身份权威，host 解析 Coding Plan 凭证回传身份头，零 UI）；
  5. `interaction/browserList` / 6. `interaction/browserExecute`（4276-4277，agent 发起、host 转给 main 的 CDP executor）；
  7. `knowledge/search`（4280，VaultSearch 工具反向检索；host 无 knowledge 服务时回 -32603 结构化不可用，-32601 视为能力差异降级，bootstrap/drora-protocol/vault-search-port.ts:39-41）。
- 取消旁路通知：`interaction/providerRuntimeHeadersCancelled`（index.ts:447、2777-2786）。
- 超时：provider 头请求 **180s**（`PROVIDER_RUNTIME_HEADERS_TIMEOUT_MS = 180_000`，bootstrap/drora-protocol/provider-runtime-headers.ts:17），超时回 -32022——与官方 180s 一致。
- 对照官方 ~20 反向方法：我方集合更小（官方多出的多为 UI/IDE 集成面），核心四类（权限/用户输入/provider 头/MCP 身份头）齐全。

## 3. 凭据存储

### 3.1 文件与加密

- 路径：`~/.drora/v2/credentials.json`（`resolveSharedDroraCredentialsPath`，apps/drora-cli/packages/adapters/src/auth/shared-credentials.ts:280-290；`DRORA_DATA_BASE_DIR` env 可覆盖）。对应官方 `~/.zcode/v2/credentials.json`，v2 目录同源。
- 加密：AES-256-GCM，`enc:v1:` 前缀 + `iv.authTag.ciphertext`（base64url，iv 12B/tag 16B）；密钥 = SHA256(`DRORA_CREDENTIAL_SECRET`)；env 未配置时 fallback secret = `drora-credential-fallback:{platform}:{homedir}:{username}`（apps/drora-cli/packages/adapters/src/auth/credential-cipher.ts:4-8,83-101）。对应官方 `SHA256(ZCODE_CREDENTIAL_SECRET)`，仅 env 键与 fallback 串改名。services 侧有一份等价实现（packages/services/src/credential/providers/credentialCipherProvider.ts:6-9）。
- 写入安全：`withFileLock` 覆盖 read-modify-write + 原子私有写 + 损坏文件先备份再抛错（shared-credentials.ts:292-331）。
- 键：`oauth:active_provider`、`oauth:bigmodel|zai:{access_token,refresh_token,user_info}`、legacy `drorajwttoken`（shared-credentials.ts:15-24）。

### 3.2 OAuth 设备码 / 轮询链路

- `POST {base}/oauth/cli/init`（body {provider}，Bearer pollToken 32B 随机 hex）→ `{authorize_url, expires_at, flow_id, poll_interval_sec}`；`GET {base}/oauth/cli/poll/{flowId}` → pending/failed/ready{token,user,access_token,refresh_token}（apps/drora-cli/packages/adapters/src/auth/cli-oauth.ts:75-125,123-125）。默认 base `https://zcode.z.ai/api/v1`（cli-oauth.ts:4）——与官方 `/api/v1/oauth/cli/init|poll/{flowId}` 同路径（品牌域按 `specs/drora-rename.md` 豁免）。
- provider 集合：zai / bigmodel（cli-oauth.ts:5；bigmodel 走 `/login` 授权页，bigmodel-oauth.ts:5）。

### 3.3 business token 兑换与 coding-plan 取钥

- zai business token：`POST https://api.z.ai/api/auth/z/login {token}`，进程内 `ZaiBusinessTokenCache`（未知 TTL 兜底 300s，按 expires_in 缓存，401 由 owner 判定 invalidate，重试上限 2 次）（coding-plan-api-key.ts:16,19,122-140；zai-business-token-cache.ts:5,64-78）。与官方"zai 走 api.z.ai/api/auth/z/login"一致。
- coding-plan 短期 Token：`ProjectAccessTokenClient`（packages/shared/src/project-access-token-client.ts:73）——`GET {origin}/api/biz/customer/getCustomerInfo` 定位组织/项目，`GET/POST {origin}/api/biz/v1/organization/{org}/projects/{proj}/api_keys` 复用或创建 `drora-api-key`/`drora-team-api-key`（usageScene=CODING_PLAN）（project-access-token-client.ts:236-317）。**未还原官方 V4 签名 `get_sign_key`**——我方走 api_keys 创建/复用路径，为与官方的有意分歧（或缺口，需批次对照时标注）。
- bigmodel JWT：`bigmodelStartPlanDroraJwt.ts`（packages/services/src/model-provider/）。

## 4. API 客户端

### 4.1 栈与 SSE 解析

- **内嵌 ai-sdk**：`AiSdkModelExecution` 按 provider kind 构造 `createOpenAI`(responses) / `createAnthropic` / `createOpenAICompatible`（apps/drora-cli/packages/adapters/src/model/model-execution.ts:316-341），每请求冻结 Provider 快照（endpoint/header/key，model-execution.ts:188-273）。
- **anthropic thinking/signature**：`anthropic-stream-compat.ts` 处理 `content_block_start/delta/stop`、`signature_delta` 修补（187,290-345）；签名校验 400 时流未提交则原流替换重试、已提交则修历史后重试（runner-stream.ts:192-197、runner-generate.ts:370,467-469、reasoning-history-normalization.ts:83-88）。与官方"delta 含 thinking/signature"一致。
- **compaction**：compact 依赖 raw chunk 观察流边界（`includeRawChunks`/`preserveProviderStreamBoundaries`，runner-options.ts:153-158），compact 摘要走独立模型请求（core/src/runtime/methods/compact-summary-model-request.ts）。
- **openai reasoning**：reasoning-start/reasoning-delta 事件归一化（runner-normalization.ts:88-97），usage 从 `chunk.totalUsage` 归一化（16-30：input/output/total/cacheRead/cacheWrite/reasoning tokens）。reasoning_content 由 openai-compatible SDK 映射进 reasoning parts。
- **usage 常开**：无开关，streamText 结果/finish 事件恒带 usage 并入 token 统计；协议侧 turn.completed 带 usage+cacheStats（drora-protocol/index.ts:1578-1608）。

### 4.2 GLM thinking + effort 注入（声明式 option map，单一出处）

`config/provider/drora-builtin.json` `config.modelConfigRules`（JSON 串内 DSL，由 packages/model-option-map 编译执行）：

- anthropic-messages 族（对 `.*`）：`reasoningLevel=="disabled" ? {thinking:{type:"disabled"}} : {thinking:{type:"adaptive"}, output_config:{effort: reasoningLevel=="enabled" ? "high" : reasoningLevel}}`。
- openai-chat-completions 族：`{thinking:{type: disabled|none?"disabled":"enabled"}, enable_thinking, reasoning_effort, reasoning:{effort}}`；openai-responses 族：`{reasoning:{effort}}`。
- GLM-5.3 规则 `modelMatch ".*glm-5\\.3(?:-flash)?..."` 的 reasoningLevel 取值仅 `["low","high","max"]`（无 disabled）→ **GLM-5.3 恒发 thinking + output_config.effort**（type 为 `adaptive`，官方为 `enabled`，值面差异见 §8）。

### 4.3 重试策略参数（对比官方 11 次 2s×2 封顶 60s 抖动）

- 默认：`maxAttempts = 10+1 = 11`、baseDelay 2s、backoff ×2、cap 60s、jitter true（apps/drora-cli/packages/adapters/src/model/retry-policy.ts:13-30）。env 覆盖 `DRORA_MODEL_RETRY_MAX_RETRIES/BASE_DELAY_MS/BACKOFF_FACTOR/MAX_DELAY_MS`（retry-policy.ts:18-21）。**与官方逐项一致**；另有 retry budget 收敛（retry-budget.ts `resolveRetryOptionsForBudget`）。
- **429 Retry-After**：`retry-after-ms` 优先、`retry-after` 次之；`x-should-retry=false` 时 Retry-After 只作诊断不驱动等待；delay 采用"合理才采纳"（uncapped 之内）（failure-inspection.ts:290-301、runner-retry.ts:43-51,90-106,235-247）。
- **401/403**：分类为鉴权失败（failure-classifier.ts:207,391）；401 且属 project-token 拒绝（individual/team-coding-plan/off-peak 模式）→ **一次性刷新 PAT 重试**，携带 `expectedAccountScope`+`rejectedProjectTokenFingerprint` 保证不串账号（account-request-retry.ts:63-108）；Off-Peak 逐请求向原账号 owner 刷新（runner.ts:186-216、off-peak-request-auth.ts）。无跨模型降级（无 fallback model 链）。
- 流空错误计数与 `MODEL_STREAM_IDLE_TIMEOUT` 归一化重试（stream-idle-timeout.ts:26-55）。

### 4.4 流空闲超时

- 默认 **600_000ms（10min）**，每次重试 +30s（`MODEL_STREAM_IDLE_TIMEOUT_RETRY_INCREMENT_MS`）（packages/apps contracts/src/config/index.ts:290-298、apps/drora-cli/packages/adapters/src/model/stream-idle-timeout.ts:5-24）。与官方"流空闲 600s"一致；协议层无心跳时由它兜底。

## 5. 模型路由

- **Provider/模型注册表**：`packages/provider`——`ProviderConfigResolver.resolve`（packages/provider/src/resolver.ts:182-339）按 owned order 合并 builtin + personal，模型级叠加 `effectiveModelRules.resolve` 与 `droraBuiltinModelRules.resolve`。
- **ModelConfigRules.resolve 等价实现**：同名类 `ModelConfigRules`（packages/provider/src/config/model-config.ts:366-410），规则类型 exact/template-model/model-api/provider-site，正则 `modelMatch`+`apiTypeMatch` 顺序 overlay——与官方同名机制对齐。
- **内置规则出处**：`config/provider/drora-builtin.json`（providerConfigRules + modelConfigRules）。默认 contextWindow=**200000**（`".*"` 首规则 properties），`[1m]` 后缀与 glm-5.3 规则 → 1,000,000；GLM-5.3 maxOutputTokens 128k、GLM-5 64k。与官方"contextWindow 取 provider 规则 properties（默认 200k）"一致。
- **provider 模板**：zai-coding-plan（anthropic-messages, https://api.z.ai/api/anthropic）、zai-standard-api（openai-chat-completions, /api/paas/v4）、bigmodel 双形态、openrouter 等，builtinModelIds 含 GLM-5.3/GLM-5.3-Flash 等。
- **/model 模型集**：`app.listModels()`（apps/drora-cli/packages/cli/src/command-center/handlers/model.ts:14），选项来自上述注册表 resolvedProviders；`/model main` 保留当前模型仅重置推理档到目录默认（model.ts:36-44）；成功后 `rememberCurrentModelSelection` 写个人偏好端口（model.ts:48，specs/upstream-v3.15.1-migration.md:130-132 的回归决定）。
- 选项注入执行面：`packages/model-option-map`（compiler/evaluator）把 reasoningLevel/maxOutputTokens 编译成请求体 merge patch，经 `createModelOptionMapFetch` 在 fetch 层应用（model-execution.ts:306-314）。

## 6. attach / lease

- **legacy 订阅**：`session/subscribe {sessionId, deliveryKind, afterSeq?, includeSnapshot}`（drora-protocol/index.ts:1845-1852），`deliveryKind ∈ {"desktop-continuous","web-remote-replayable"}`（drora-protocol-legacy-types.ts:14）——attach 单客户端 + afterSeq + snapshot 语义与官方一致。
- **V4 订阅**：`v4/conversation/subscribe` 带 `connectionId + clientMode(desktop-continuous|web-remote-replayable) + legacyTaskIds≤200 + workflowRunDeltas`（drora-protocol-v4/transport.ts:418-438）；response 仅 ACK，initial snapshot/resume 走 response 后 owned notification（transport.ts:440-447）。两种链路语义分离、同一任务所有者（specs/upstream-v3.15.1-migration.md:53-83 状态所有者表）。
- **snapshot 上限**：legacy `droraSessionStateSnapshotSchema`（index.ts:1361-1376）无协议字节上限；字节护栏在发送边界——V4 物理帧 1MiB/逻辑组装 16MiB（core.ts:66-71）、附件 20MiB（attachmentMaxBytes，core.ts:85）、请求帧估算拒绝 >1MiB（droraAgentService.ts:678-679）、relay 重放缓冲 8MiB。官方"attach 20MB 上限"在我方对应为附件/帧限额族，无单一快照 20MB 常量。
- **task-run-lease 等价物**：`TaskRunLease` acquire/release/result 走 desktop main 通道 `task-run-lease-acquire/release/result`（packages/shared/src/channels.ts:764-766）；所有者是 main 的 `taskRealtimeBus`（leases Map + ownerHostId，owner 丢失 → `releaseLeasesForHost` 并发 snapshot invalidation "stream_mirror_owner_lost"，packages/desktop/src/main/taskRealtimeBus.ts:1,128,198-200,319-330）；services 侧端口 `acquireTaskRunLease/releaseTaskRunLease`（packages/services/src/session/sessionRealtimePort.ts:19-22）。owner/lease、跨 Host 路由、stale run 防护保留（AGENTS.md 要求项均有着落）。

## 7. 进程

- **宿主→Agent**：host 进程 spawn `[node] apps/drora-cli/packages/cli/dist/drora.cjs app-server --stdio`（packages/services/src/drora-agent/droraAgentProcessManager.ts:360-406，373 行；开发态走 tsx main.ts 同参数）——与官方 `app-server --stdio` 同命令面。桌面 Host 本身是 Electron `utilityProcess.fork`（packages/desktop/src/main/desktopHostProcess.ts:284）。
- **MCP**：`ProcessTreeStdioClientTransport extends StdioClientTransport`（apps/drora-cli/packages/adapters/src/mcp/stdio-transport.ts:47）+ Windows Job Object（同目录 windows-job-object.ts，createJobObject/assign/terminate，:138-190）——与官方同名组件一致。
- **node-repl broker**：Windows named pipe `\\.\pipe\drora-node-repl-{uuid}` / 其他平台 UDS `{tmpdir}/znr-{uuid}.sock`；socket path+token 经 MCP env 注入（`NODE_REPL_BROWSER_BROKER_SOCKET_ENV/TOKEN_ENV`），请求 timingSafeEqual 校验 token（apps/drora-cli/packages/bootstrap/src/app/node-repl-browser-broker.ts:80-94,162-172）。与官方 named pipe/UDS + token env 一致。CUA permission broker 走独立 socket env（node-repl-host/src/server.ts:375-379）。

## 8. 版本差标注与差异清单（3.15.x 新增不算 gap）

1. **有意分歧/待甄别**：
   - coding-plan 取钥走 `api_keys` 创建/复用，无官方 V4 签名 `get_sign_key`（§3.3）——需对照官方 3.15.x 判断是缺口还是先于该机制的分叉。
   - GLM anthropic-messages 的 thinking type 用 `adaptive`（官方观察为 `enabled`）（§4.2）——值面差异，行为待对拍。
2. **超出基线（多为 3.15.x 后演进或我方扩展，不计 gap）**：V4 命令 35 个（官方批次口径 15）；V4 附件事务/工作流 run 查询族/usage 查询族；`v4/connection/flow` 显式背压；workspace-hook-review 命令族；highspeed/modelExecution 执行材料；team 命令族（TEAM_LIMITS）。
3. **规模差异**：legacy 方法 100 vs 官方 120——差异主要来自我方已删除的死词簇（steer/rewind/prompt-enhance 等，drora-protocol/index.ts:22-33），属清理而非缺口；反向方法 7 vs 官方 ~20，核心四类齐全。
4. **一致项**（逐参数）：NDJSON/信封/trace、wireVersion=3、错误码族、单队列+取消旁路、无心跳+600s 空闲、180s provider 头、credentials.json AES-256-GCM+SHA256(secret)、OAuth cli/init|poll、zai business token 兑换、重试 11 次 2s×2 cap60s 抖动、429 Retry-After、401 PAT 刷新一次、usage 常开、contextWindow 默认 200k、app-server --stdio、ProcessTreeStdioClientTransport+Job Object、node-repl pipe+token、subscribe(afterSeq,includeSnapshot) 双 delivery 语义。
