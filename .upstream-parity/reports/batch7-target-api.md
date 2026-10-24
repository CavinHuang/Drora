# Batch 7：官方 ZCode 模型 API 客户端 / Streaming / 模型路由调研

- 调研对象：`D:/software/zcode/resources/glm/zcode.cjs`（15,127,039 字节，esbuild bundle，2025-10-13 构建）
- 辅助对象：`D:/software/zcode/resources/glm/provider/zcode-builtin.json`（schemaVersion 1，revision 30）
- 定位手段：`grep -o` + `r(fn,"保留名")`；证据以「保留名 / 字节偏移 / 片段」记录。
- 安全声明：本文只记录字段名、URL、常量与结构，不含任何真实凭据；OAuth client_id 仅以打码形式引用。

---

## 1. API 端点与鉴权

### 1.1 端点常量（bundle 内嵌，字节偏移 ~770,000 区域）

| 常量（混淆名） | 值 | 用途 |
| --- | --- | --- |
| `gne` | `https://zcode.z.ai` | ZCode 端点 origin（CLI OAuth、官方插件、relay） |
| `Aet` | `https://zcode.chatglm.site` | 备用/测试 origin |
| `Yfr` | `http://localhost:3000` | 开发 origin |
| `Xfr` | `https://bigmodel.cn` | BigModel 生产业务 origin |
| `Qfr` | `https://dev.bigmodel.cn` | BigModel 测试 origin |
| `emr` | `https://chat.z.ai` | Z.AI OAuth origin（生产） |
| `tmr` | `https://zai-test.chatglm.site` | Z.AI OAuth origin（测试） |
| `nmr` | `https://api.z.ai` | Z.AI 业务 base URL（生产） |
| `rmr` | `https://api.chatglm.site` | 业务 base URL（测试） |
| `smr` | `wss://zcode.z.ai/ws` | Web 远控 relay WebSocket |
| `Iso` | `https://api.z.ai` | CodingPlanApiKeyResolver 的 zai 家族登录端点 |
| `Cta` | `https://zcode.z.ai/api/v1` | CLI OAuth 设备码流程 base |
| `omr` / `imr` | `client_P8X5…（打码）` / `client_Rzng…（打码）` | Z.AI OAuth 公开 client_id（生产/测试） |
| `azs` | `cl_HYy…（打码）` | 另一处 OAuth client_id（vercel-oidc 库，MCP 远程 JWT 场景） |

模型 API 的 baseUrl 不写死在 bundle，而来自 provider 配置（见 §3）：
- `https://api.z.ai/api/anthropic`（zai coding plan / API 模板，`anthropic-messages`）
- `https://open.bigmodel.cn/api/anthropic`（bigmodel coding plan / API 模板，`anthropic-messages`）
- `https://api.z.ai/api/paas/v4`、`https://open.bigmodel.cn/api/paas/v4`（`openai-chat-completions`）
- Start Plan / Off-peak：`https://zcode.z.ai/api/v1/zcode-plan/anthropic`、`https://zcode.z.ai/api/v1/off-peak/anthropic`
- 第三方模板：moonshot `https://api.moonshot.cn/anthropic`、minimax `https://api.minimaxi.com/anthropic`、deepseek `https://api.deepseek.com/anthropic`、qwen `https://dashscope.aliyuncs.com/apps/anthropic`（intl 为 openai 兼容）、xiaomi `https://api.xiaomimimo.com/anthropic`、openai/anthropic/xai/openrouter/opencode zen 等。
- 环境覆盖键：`ZAI_OAUTH_ORIGIN`、`ZAI_BUSINESS_BASE_URL`、`ZAI_OAUTH_CLIENT_ID`、`ZAI_PRODUCTION_OAUTH_CLIENT_ID`、`ZAI_TEST_*`、`BIGMODEL_API_BASE_URL`、`BIGMODEL_PRODUCTION_API_BASE_URL`、`ZCODE_DATA_BASE_DIR`（保留名 `resolveZaiOAuthOrigin` / `resolveZaiBusinessBaseUrl` / `resolveBigModelApiOrigin`）。

URL 拼装（保留名 `buildRuntimeZCodeEndpointUrls`，字节 ~770,600）：`apiBaseUrl = ${origin}/api/v1`、`remoteUrl=${origin}/remote/{v3|v4}`、`webRemoteCallbackUrl=${origin}/web-remote/callback`。

### 1.2 模型请求路径与请求头

- `anthropic-messages`：`normalizeAnthropicBaseURL`（保留名 `QUs`）把 baseUrl 归一化为以 `/v1` 结尾（`https://api.z.ai/api/anthropic` → `…/api/anthropic/v1`），最终请求 `${baseURL}/messages`（ai-sdk anthropic provider，`buildRequestUrl` 缺省 `${this.config.baseURL}/messages`，字节 ~3,570,106）。
- `openai-chat-completions`：ai-sdk openai-compatible provider，`stream_options:{include_usage:!0}` 常开（`includeUsage:!0`）。
- `openai-responses`：ai-sdk openai provider `.responses`。
- 工厂（保留名 `toAiSdkProviderConfig` / `KUs`）：`apiType → kind` 映射 `anthropic-messages→anthropic`、`openai-responses→openai`、`openai-chat-completions→openai-compatible`；`apiKey` 仅在 `access.type!=="zhipu-account"` 时直接下发；`providerOptions.apiFormat = api.type`。
- 鉴权头（保留名 `withAnthropicAuthorizationHeader` / `YUs`）：若 headers 无 `Authorization`，注入 `Authorization: Bearer ${apiKey}`；否则 ai-sdk anthropic 缺省为 `x-api-key`（附 `anthropic-version: 2023-06-01`，`ai-sdk/anthropic/<ver>` UA）。
- 头清洗：`withoutModelAuthHeaders`（`DJr`）剔除 `authorization`/`x-api-key`；`withoutModelQuerySourceHeader`（`Ilt`）剔除 `x-zcode-query-source`；`mergeModelRequestHeaders`（`Nfn`）大小写不敏感合并。脱敏集 `sanitizeModelNetworkHeaders` 覆盖 `authorization、x-api-key、api-key、openai-api-key、x-off-peak-ticket-id、cookie、proxy-authorization` 等。
- 端点路由头（保留名 `createProviderEndpointRoutingSourceHeaders` / `Boi`）：携带 `appVersion、arch、clientLanguage(Intl locale)、clientTimezone、deviceMid(读 ~/.zcode/v2/telemetry-state.json 的 deviceMid 字段)、endpointOrigin、osVersion、platform、releaseChannel、sourceTitle`，另有 `X-ZCode-App-Version`、`x-api-key-id`（business 解析返回的 apiKeyId 透传）。

### 1.3 CLI OAuth 登录（`login [zai|bigmodel]`，保留名 `loginZCodeCli` / `Ooi`）

设备码风格流程（保留名 `createCliOAuthClient` / `Rso`，base `https://zcode.z.ai/api/v1`）：

1. `createCliOAuthPollToken`（`Dso`）：`crypto.randomBytes(32).toString("hex")` 生成 pollToken。
2. `init`：`POST /oauth/cli/init`，头 `Authorization: Bearer <pollToken>`、`Content-Type: application/json`，body `{provider:"zai"|"bigmodel"}`；响应 envelope `{code:0,msg,data}`，`data={flow_id, authorize_url(必须 https), expires_at, poll_interval_sec}`（`parseInitData` / `Rta`）。
3. 打开浏览器访问 `authorize_url`（可 `--no-browser`）。
4. 轮询 `pollUntilReady`（`Poi`）：`GET /oauth/cli/poll/{flowId}`（Bearer pollToken）；`status: pending|failed|ready`；总超时 300s（`Wlc=300*1e3`，`auth_timeout`），轮询间隔取 `max(1s, poll_interval_sec)`；HTTP 408/429/5xx 可继续轮询，其余错误直接抛出（`CliOAuthError` 带 `businessCode`/`httpStatus`）。
5. `ready` 数据（`parseReadyData` / `Ota`）：`{token(ZCode JWT), user{user_id,email,name,avatar}, accessToken, refreshToken?}`，其中 access/refresh token 在响应的 `<family>` 键下（`data.zai.access_token` 或 `data.bigmodel.access_token`，兼容 camelCase）。
6. 凭据写入（`createSharedZCodeCredentialStore` / `rN`）：
   - zai：`saveZaiLoginCredentials({accessToken, jwtToken, user})`；
   - bigmodel：`saveMany({activeProvider, zcodeJwtToken, bigmodelAccessToken, bigmodelRefreshToken?, bigmodelUserInfo})`。
7. `resolveCodingPlanMaterial`（`Klc`）解析 `organizationId/projectId`；bigmodel 的账号身份 = `sha256(JSON.stringify([organizationId,projectId])).hex 前 24`（`createStandaloneAccountIdentityFromSecret` / `LNn`）。
8. `persistStandaloneCodingPlanConnection`（`jNn`）写个人 provider 配置并把默认模型设为 `mainModel = "<providerId>/<modelId>"`（modelId 取 provider 规则 `builtinModelIds[0]`）。

**凭据文件**（保留名 `resolveSharedZCodeCredentialsPath` / `Vta`）：`${ZCODE_DATA_BASE_DIR|$HOME}/.zcode/v2/credentials.json`，JSON 对象、值全为字符串。键（保留名常量表 `$b`）：
`oauth:active_provider`、`oauth:zai:access_token`、`oauth:zai:refresh_token`、`oauth:zai:user_info`、`oauth:bigmodel:access_token`、`oauth:bigmodel:refresh_token`、`oauth:bigmodel:user_info`、`zcodejwttoken`，以及登录后追加的 `account-provider:<id>:identity`、`account-provider:<id>:auth-source`（`oauth`|`manual`）、`account-provider:coding-plan:<id>:account:<identity>:api-key`。
文件读写有锁（`mutateRawCredentialRecord`）+ 变更通知（`onDidChange`）+ 损坏备份提示。

**静态加密**（保留名 `createZCodeCredentialCipher` / `Lso`）：前缀 `enc:v1:`，AES-256-GCM，IV 12B、tag 16B、base64url 三段 `iv.tag.ct`；密钥 = `sha256(ZCODE_CREDENTIAL_SECRET || "zcode-credential-fallback:{platform}:{homedir}:{username}")`（`resolveCredentialSecret`）。

Webview 侧 localStorage 镜像键（ rewards/授权注入脚本 `Jps`）：`oauth:<provider>:access_token`、`zcodejwttoken`；可信 webview origin 白名单 `isTrustedCodingPlanWebviewOrigin`。

### 1.4 每次模型请求前的凭据解析（CodingPlanApiKeyResolver，保留名 `createCodingPlanApiKeyResolver` / `fpt`）

- zai 家族：`POST https://api.z.ai/api/auth/z/login`，JSON body `{token:<accessToken>}` → `{token:<businessToken>}`；失败重试 2 次（`kta=2`）。
- bigmodel 家族：经 `origin=https://bigmodel.cn` 的 project-token 解析器（`_he` 类，路径含 `/api/biz/*`），重试 1 次（`xta=1`）；业务请求 401 时若 Authorization 与缓存 business token 相同则 `invalidate`；404 → code 404；429/5xx → 抛可重试 `F3`（network_error 类）；其它非 2xx → `CodingPlanApiKeyError("project_token_request_failed")`；业务请求超时 15s（`Tta=15e3`）、响应上限 64KiB（`maxResponseBytes:65536`）。
- 输出 `{token, apiKeyId?, organizationId?, projectId?}`；`refreshBeforeModelRequest`（保留名 `Coi` 内）在**每次模型请求前**执行：读凭据 → 计算 accountScope（sha256 of `[providerId, accountType, identity, accessToken]`）→ `resolveMaterial` → 返回 `requestAuth:{apiKey, apiKeyId?, accountScope?}`；scope 失配或凭据被替换 → `project_token_scope_invalidated` 并清空缓存。
- `auth-source=manual` 时直接使用 `account-provider:coding-plan:...:api-key` 凭据，不走 OAuth 兑换。

### 1.5 官方请求签名 V4（start-plan / off-peak / coding-plan 端点）

- 判定（保留名 `TUs`）：`zhipu-coding-plan-api-key`、`zhipu-account(individual/team-coding-plan)` 或 base URL host 属于 `{api.chatglm.site, zcode.chatglm.site}` 时启用；start-plan/off-peak/highspeed 显式**不**签名。
- 实现：`ClientRequestSigningV4Manager`（`blt`）+ `OfficialRequestSecurity`（`Ifn`）→ `createFetch({apiKey, baseURL, clientVersion, providerId}, transport)`；sign key 端点 `get_sign_key`（`yUs`）、路径 `/api/paas/c1f3a7e2/v2/client`（`vUs`），key 缓存按 `providerId→origin`，密钥 16B（`_Jr=16`，nonce/参数 8B `SUs=8`）；错误 `ClientRequestSigningV4Error` 支持 fail-open（`failOpenEligible`）。
- 观测事件名 `model.client_signing.<kind>`。

### 1.6 MCP 远程 JWT（`zcode_official`）

- MCP server 配置 `auth:{type:"zcode_official",provider:"jwt_token"}`（`Nno` 校验）→ 请求头注入 `Authorization`（映射表 `Hfr`：`authorization` / `X-Bigmodel-Authorization` / `Bigmodel-Target-Type` / `Bigmodel-Organization` / `Bigmodel-Project`），JWT 来源即 `zcodejwttoken` 凭据；关联命名空间 `com.zcode/official-mcp-auth`。
- `vercel.com/.well-known/openid-configuration` 的 OIDC 发现与 `vercel auth.json`（`getVercelDataDir/auth.json`，字段 `token/expiresAt/refreshToken`）来自内嵌 vercel-oidc 库，服务 MCP/远程场景，与主登录流分离。

### 1.7 子进程 env 注入（对照）

`CLAUDE_SESSION_ID`、`CLAUDE_PROJECT_DIR`、`CLAUDE_CODE_SESSION_ID`、`CLAUDE_PLUGIN_ROOT`、`CLAUDE_PLUGIN_DATA`、`CLAUDE_SKILL_DIR` 等仅作为 hook/插件/MCP 子进程 env 注入；模型链路 env 只有 ai-sdk anthropic 的 `ANTHROPIC_API_KEY` 兜底（未配置 apiKey 时）。

---

## 2. 流式协议（SSE）

bundle 内嵌 Vercel AI SDK 全家桶（anthropic / openai / openai-compatible），SSE 解析在其内部：

- 行解析（字节 ~3,780,930，`pUs`）：`split(/\r\n|\n|\r/)` → 取 `data:` 前缀行、去一个空格 → 多行 join("\n")；事件分隔 `/\r\n\r\n|\n\n|\r\r/`（`JUs`）；`event: content_block_delta` + `data: {json}`。
- Anthropic 事件 schema（zod）：`message_start`（含 usage）、`content_block_start`、`content_block_delta`（delta 类型：`input_json_delta{partial_json}`、`text_delta{text}`、`thinking_delta{thinking}`、`signature_delta{signature}`、`compaction_delta{content?}`、`citations_delta{citation}`…）、`content_block_stop`、`message_delta`（stop_reason/usage）、`ping`、`error`；块类型含 `redacted_thinking`。`compaction_delta` 为非官方扩展（服务端压缩流）。
- OpenAI-compatible 流：`choices[0].delta`，`reasoning_content ?? reasoning` → 首次发 `reasoning-start{id:"reasoning-0"}` 后持续 `reasoning-delta`；非流式回退 `message.reasoning_content ?? message.reasoning`、`tool_calls` 数组按 `index` 拼接；finish_reason 映射 `unified+raw`。
- usage：流末尾 `include_usage` chunk / anthropic `message_delta.usage`；转换保留名 `convertAnthropicMessagesUsage`（`PVr`，支持 `iterations[]`（type `compaction|message`）聚合 input/output）、`convertOpenAICompatibleChatUsage`、`convertOpenAIResponsesUsage`、`normalizeUsage`（`A$`，拆 `inputTokens/outputTokens/totalTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens` + `serverToolUse{web_search_requests,web_fetch_requests}`）。
- 业务错误 SSE 拦截（保留名 `createProviderBusinessErrorFetch` / `e5s` + `createProviderBusinessErrorSseResponse` / `o5s` + `createProviderBusinessErrorSseTransform` / `i5s`）：对非 ok 或 JSON 响应嗅探（content-type 含 json，或 content-length ≤ 64KB `ENe=64e3`）读取 body，解析 `{success:false, code/providerCode, error_code, msg…}`（`ANe`）→ 抛 `ProviderBusinessError`（`z2`，携带 providerCode/providerId/providerRequestId/responseBodySummary/responseStatus/statusCode）；SSE 中途业务错误经 transform 拦截。
- 请求体（anthropic，ai-sdk 构建）：`model、max_tokens、temperature、top_k、top_p、stop_sequences、thinking{type:enabled|adaptive, budget_tokens?, display?}、output_config{effort?, task_budget{type,total,remaining?}, format{json_schema}}、speed、inference_geo、cache_control、metadata{user_id}、mcpServers、tools（含 provider tool 名映射 anthropic.*_*）、betas`；thinking 是否发送由 provider 规则的 optionSpecs 决定（见 §3.3）。`metadata.user_id` 会被 `[REDACTED]` 化（`redactAnthropicRequestMetadata`）。
- 流空闲超时：`ModelStreamIdleTimeoutError`（code `MODEL_STREAM_IDLE_TIMEOUT`），基础 600,000ms（`JH=6e5`，`Fm.modelStream.idleTimeoutMs`），每 retry +30s（`resolveModelStreamIdleTimeoutMs` / `KJr`，`y5s=3e4`）；空闲即 abort 流。
- 流事件 UI 管线：`start/text-start/text-delta/text-end/reasoning-start/reasoning-delta/reasoning-end/tool_input_start/delta/end/finish/source/error/raw`；`isRetrySafePreludeStreamEvent`（`Zeo`）判定"重试安全前导事件"（start/*_start/空 delta）。

---

## 3. 模型路由

### 3.1 provider 配置体系（provider/zcode-builtin.json revision 30 + 个人配置）

- `templateRules` 20 条（模板）：`zai-api`、`zai-standard-api`、`bigmodel-api`、`bigmodel-standard-api`、`moonshot-kimi`、`minimax`、`deepseek`、`qwen-alibaba-model-studio-cn/-intl`、`xiaomi-mimo`、`openai`、`anthropic`、`xai`、`openrouter`、`opencode-go-chat/-go-messages/-go-responses`、`opencode-zen-responses/-messages/-chat`。每条含 `access{type, apiKeyManagementUrl}`、`api{type, baseUrl}`、`builtinModelIds`、`logo`。
- `providerRules` 8 条（账号计划，providerId `account:*`）：
  - `account:zai-individual-coding-plan` / `zai-team-coding-plan`：group zai-family，模型 `[GLM-5.3, GLM-5.3-Flash]`，`https://api.z.ai/api/anthropic`
  - `account:zai-start-plan`：模型 `[GLM-5.3-Flash, GLM-5.2, GLM-5-Turbo]`，`https://zcode.z.ai/api/v1/zcode-plan/anthropic`
  - `account:bigmodel-individual-coding-plan` / `bigmodel-team-coding-plan`：`https://open.bigmodel.cn/api/anthropic`
  - `account:bigmodel-start-plan`：同 start-plan 模型集
  - `account:zai-offpeak-idle-plan` / `bigmodel-offpeak-idle-plan`：`visibility:"hidden"`，mode off-peak，`https://zcode.z.ai/api/v1/off-peak/anthropic`
  - access 类型 `zhipu-account{mode, accountType}`。
- `modelConfigRules` 5 组 478 条：`modelRules`(84) / `modelApiRules`(72) / `providerSiteRules`(52) / `templateModelRules`(244) / `builtinProviderModelRules`(26)。
- 消费（保留名 `ModelConfigRules.resolve` / `FA.resolve`）：按规则类型匹配 —— `manual-provider-model`/`provider-model`（providerId+modelId 精确）、`template-model`（templateId+modelId 精确）、`model`（`modelMatch` 正则，大小写不敏感全串匹配 `matchesRule`/`sKt`）、`model-api`（+`apiTypeMatch`）、`provider-site`（+`apiTypeMatch`+`baseUrlMatch`，baseUrl 先 `normalizeBaseURLForRuleMatch`）；命中后 `ModelConfig.overlay` 五层叠加，产出 `enabled、properties{contextWindow、inputFormat、outputFormat、supportsToolCall、supportsJsonSchemaOutput、supportsNativeWebSearch、supportsMidConversationSystem、requiresMfjsToolSchema}、optionSpecs{reasoningLevel{values,map}、maxOutputTokens{max,map}}`。
- 个人 provider 配置存于 credentials.json 同目录（`persistStandaloneCodingPlanConnection`：`dirname(credentials)/<个人配置文件>`，env 键 `Rne` 可覆盖），含 `providers/models/personalModelIds/modelOrder`。

### 3.2 /model 命令与 ListModels

- `handleModelCommand`（`Api`，字节 ~7,604,000 区域）：`/model`（无参或 list）→ `app.listModels()` 输出 `Current model: …` 列表（`formatModelList`，含 `providerId/modelId (label; providerLabel) [disabledReason]`）+ 提示 `/effort <level>`；`/model <provider/model>` → `resolveTuiModelSelection`（`$_c`）校验存在性/disabledReason/reasoning level 后 `app.setModel({providerId, modelId, options:{reasoningLevel}})`。
- 选择串规范（`formatModelPickerValue` / `u7`、`parseModelPickerValue` / `_C`）：`providerId/modelId` 或 `providerId/modelId$<reasoningLevel>`（分隔符 `BRe="$"`）。
- ListModels 数据源：provider 配置（builtin catalog + 个人配置）∩ ModelConfigRules 解析结果；每项含 `providerId、modelId、providerLabel、label、description、reasoningLevels、defaultReasoningLevel、contextWindow、disabledReason、current`；disabledReason 来自规则 `enabled:false`/授权缺失。TUI 有 `thoughtLevel`（`getThoughtLevel/setThoughtLevel`）与 `/effort` 联动。
- 遗留迁移：`migrateLegacyOfficialGlmModelId`（`Lte`）、`migrateLegacyModelProviderId`（`l7`）。

### 3.3 reasoningLevel → GLM 专属参数（全部由 provider 规则 map 注入，非硬编码）

optionSpecs.map 是一段表达式（`compileModelOptionMap` 编译，JSON merge patch 语义，`applyOrderedJsonMergePatches`），按当前 reasoningLevel 求值后**直接 patch 到原始请求体**（传输层 `CJr` 捕获+改写）。GLM 关键规则（`modelApiRules`）：

- `glm-5.3(-flash)`（anthropic-messages）：`{"thinking":{"type":"enabled"},"output_config":{"effort":reasoningLevel}}` —— reasoningLevel 取值 `low|medium|high`（GLM-5.3 无 disabled 档）。
- `glm-5` / `glm-5-turbo` / `glm-5.1` / `glm-5.1-highspeed` / `glm-4.7*` / `glm-4.6` / `glm-4.5(-air)` / `glm-5v-turbo`：`{"thinking":{"type": reasoningLevel=="enabled" ? "enabled":"disabled"}}`。
- `GLM-5.2`：disabled→`thinking{type:"disabled"}`；否则 `thinking{type:"enabled"} + output_config{effort}`。
- 通用 anthropic 兜底：disabled→`thinking{type:"disabled"}`，否则 `thinking{type:"adaptive"} + output_config{effort: enabled?"high":level}`。
- openai-chat-completions 兜底（GLM 系）：注入 `thinking{type:…}、enable_thinking<bool>、reasoning_effort、reasoning{effort}`（GLM 常用 `enable_thinking` + `reasoning_effort`，即官方 "do_sample/温度" 类自由参数之外的 thinking 开关；bundle 中无 `do_sample` 字面量）。
- `maxOutputTokens.map` = `{"max_tokens": maxOutputTokens}`。
- 典型 GLM 上下文窗口规则：GLM-5.3 系 200k（默认兜底 `cve=2e5`），opencode zen 站点 GLM-5.3-Flash 1M（`providerSiteRules`，支持图片/视频/PDF）。
- Start-Plan 模型 GLM-5.3-Flash/GLM-5.2/GLM-5-Turbo 与 off-peak 计划均走 zcode.z.ai 签名/免签名端点（见 §1.5）。

---

## 4. 重试与降级

- 重试参数（`resolveAiSdkModelRetryOptions` / `JJr`，默认 `PNe`）：`maxAttempts:11、backoffFactor:2、baseDelayMs:2000、maxDelayMs:60000、jitter:true`；env 覆盖 `ZCODE_MODEL_RETRY_MAX_RETRIES`（+1 得 attempts）、`ZCODE_MODEL_RETRY_BASE_DELAY_MS`、`ZCODE_MODEL_RETRY_BACKOFF_FACTOR`、`ZCODE_MODEL_RETRY_MAX_DELAY_MS`。
- 退避（`calculateRetryDelay` / `Moe`）：`baseDelay * factor^(attempt-1)` 封顶 60s；若 provider `retry-after-ms`/`retry-after` 合法（`isReasonableRetryAfterMs`：0≤ms≤5min 或小于计算延迟）则直接采用；否则 jitter = `round(delay*(0.5+random*0.5))`（50%–100%）。`x-should-retry: false|0` 阻断重试（`isShouldRetryHeaderFalse`）；来源归类 `retryAfterSource`。
- 重试判定（provider 错误 → 失败对象，`Wmn` 等）：
  - 429 → `ModelRateLimited`，retryable=true（RateLimited）
  - 5xx → `ModelRequestFailed`，retryable=true（ServerError）
  - 401/403 → `ProviderNotConfigured`（AuthFailed），**不重试**，retryReason=AuthRefresh
  - 404 → `ModelNotFound`，不重试；400/422 → `InvalidModelRequest`，不重试（上下文超限 `ModelContextExceeded` 也不重试，触发 auto-compact）
  - 超时/网络（ECONNRESET/EPIPE 等）→ retryable；业务错误码表：`1006`→AuthFailed、`3007`→AuthFailed、`3008`→RateLimited 等（`uut` 映射表）
  - 取消（Cancelled）永不重试。
- 认证刷新重试：AuthFailed 类错误在重试循环中以 `retryReason:AuthRefresh` `continue`——下一次尝试前 `refreshBeforeModelRequest` 重新解析 business token（§1.4），等于"刷新凭据后原模型重试"，**无跨模型降级/fallback 模型链**（未发现 fallback model 机制；`resolveSessionFallbackModelSelection` 仅是 V4 输入准入的模型选择回读）。
- Thinking 签名拒绝修复：`isThinkingSignatureRejection`（`SHs`）检测 provider 拒绝 thinking 签名 → `repairReasoningHistoryAfterSignatureRejection`（`Jut`）/`removeRejectedReasoning`（`bHs`）剔除被拒 reasoning 块后以 `retryReason:ReasoningSignatureRepair` 重试。
- 断流续传语义：`canRetryStreamFailure`（`$Hs`）——`preserveProviderStreamBoundaries=true` 时，ECONNRESET/EPIPE/CONNECTIONCLOSED 或空闲超时**允许带边界重试**（`emittedRetryBoundaryEvent` 跟踪 anthropic raw 事件 `message_start/content_block_start/delta/stop`，`isRawProviderRetryBoundaryEvent`）；否则仅当失败发生在 response body 之前可重试。空完成重试 `scheduleEmptyCompletionRetry`（`$ut`）；快照重放 `prepareSnapshotForRetry`、compact 媒体投影 `projectCompactMediaForRetry`。重试期间发布 `model_retry_scheduled` 事件（`publishRetryScheduledStatus`，attempt/delayMs/reason…），最终计入 usage 表 `retry_count`。
- 超时：业务/HTTP 层 15s（§1.4）；流空闲 600s+30s/retry；单请求网络超时来自 `network.timeout` 配置（`Moi`）。

---

## 5. Usage 统计（SQLite 三表，迁移 `0010_usage_observability`，appVersion 0.15.0）

- **model_usage**（按"每次模型请求尝试"一行）：`id PK、logical_request_id、attempt_index、session_id(FK session)、turn_id、trace_id、span_id、assistant_message_id、parent_user_message_id、query_source、provider_id、model_id、variant、agent、mode、task_type、status(running|completed|error|cancelled)、started_at、first_token_at、completed_at、duration_ms、time_to_first_token_ms、finish_reason、tool_call_count、input_tokens、output_tokens、reasoning_tokens、cache_creation_input_tokens、cache_read_input_tokens、provider_total_tokens、computed_total_tokens、retry_count、retryable、cancelled_by_user、context_exceeded、error_type/error_code/error_message、raw_usage_json、provider_metadata_json`。索引：`(started_at,provider_id,model_id)`、`(session_id,turn_id)`、`trace_id`、`query_source`。
- **turn_usage**（PK `(session_id,turn_id)`）：turn 级聚合 `model_request_count、model_retry_count、tool_call_count、tool_error_count` + token 汇总 + 首模型开始/首 token 时间。
- **tool_usage**：`tool_call_id、tool_name、side_effect_scope、read_only、destructive、approval_status、status、duration_ms、time_to_first_output_ms、exit_code、output_bytes/stdout_bytes/stderr_bytes、truncated…`。
- 写入点：`recordModelUsage`（`p2r`，`insert into model_usage …`，`computed_total_tokens` 缺省 = input+cacheCreation+cacheRead+output）在每次模型请求尝试收尾（成功/失败/取消）调用（调用点 `a1`，字节 ~1,596,000 区域的调用侧 ~4,000,000 区域）；`upsertTurnUsage`（`f2r`）与 `recordToolUsageFromEvent`（`IMo`）分别维护另两表；保留 TTL 清理（`delete … where started_at < ?`，`vOe`）。
- 统计口径：usage 来自 ai-sdk 归一化（§2）——input=total(含 cacheRead+cacheWrite)，reasoning_tokens 取 `outputTokenDetails.reasoningTokens`（anthropic 由 thinking delta 汇总）；`computed_total_tokens` 为本地合成值，`provider_total_tokens` 为 provider 报告值，两者分列。报表聚合（`getUsageStats`/`buildAppUsageSnapshot`）按 started_at 天切片、按 model_id 分组。上下文窗口口径（`getModelUsageInputWindowTokens`）结合 cacheRead/baseline 修正。
- **contextWindow 来源**：provider 规则 `properties.contextWindow`（ModelConfigRules.resolve 输出，默认兜底 200,000）；list_models 与 auto-compact 均消费该值。

### auto-compact 阈值（常量，字节 ~5,014,300）

`默认 contextWindow=200_000（cve）、默认 maxOutputTokens=32_000（Epo）、outputReserve=min(maxOut,21_000)（oda）、buffer=13_000（Apo）、thresholdPercent=100（Ppo）、连续失败熔断=3（Rpo）`；阈值 = effectiveContextWindow − outputReserve − buffer = contextWindow − min(maxOut,21k) − 13k（`A4e`/`Mht`，与批次 1 结论一致）；`tokenSource: estimate|provider`，provider 路径用 `cacheRead/baseTokenCount/incrementalTokenCount` 修正。

---

## 6. Thinking / Reasoning

- 流式：anthropic `thinking_delta` → `reasoning-start/reasoning-delta`（providerMetadata 携带签名增量 `signature_delta`）；openai-compatible `delta.reasoning_content ?? delta.reasoning`（单块 `reasoning-0`）。
- 持久化：assistant 消息 parts 中 `type:"reasoning"` 保存 `{text, providerMetadata{anthropic:{signature|redactedData}}}`（`normalizeReasoning`/`Rut`）；回传请求时 `providerOptionsForReasoningBlock`（`mQr`）：anthropic 保留签名，非 anthropic 或无签名 → `anthropic:{signature:""}` 置空；`redacted_thinking` 以 `redactedData` 存取；跨模型会话 `removeCrossModelReasoning`（`wHs`）、`filterReasoningBlocks`（`Heo`）、`isSignedOrRedactedReasoning`（`Geo`）过滤。
- 修复链：签名被 provider 拒绝 → 剔除/重试（§4）；`sanitizeJsonThinkingBlocks`（`aUs`）、`rewriteAnthropicJsonThinkingResponse`（`oUs`）处理 JSON 模式下的 thinking 响应改写。
- UI：设置项 `messageStream.showReasoning` 默认值迁移（`migrateMessageStreamShowReasoningDefault`）；TUI `thoughtLevel` 与 `/effort` 切换 reasoningLevel；`assistantReasoningFromParts`（`bla`）聚合渲染。
- GLM-5.3 anthropic 通道恒发 `thinking{type:"enabled"}` + `output_config.effort`，故推理内容始终存在且经 thinking_delta 流回，签名随 `signature_delta` 拼接。

---

## 7. 关键证据索引（字节偏移摘录）

| 主题 | 位置/保留名 |
| --- | --- |
| ModelConfigRules.resolve | ~"FA=class e{static{r(this,\"ModelConfigRules\")}"；`matchesRule`/`normalizeBaseURLForRuleMatch` |
| 凭据加密 | `createZCodeCredentialCipher`（`enc:v1:`、aes-256-gcm）、`resolveCredentialSecret` |
| 凭据文件 | `resolveSharedZCodeCredentialsPath` → `.zcode/v2/credentials.json` |
| CLI OAuth | `createCliOAuthClient`/`parseInitData`/`pollUntilReady`/`loginZCodeCli`，base `https://zcode.z.ai/api/v1` |
| business token | `createCodingPlanApiKeyResolver`，`https://api.z.ai/api/auth/z/login`，kta=2/xta=1，15s 超时 |
| 签名 V4 | `ClientRequestSigningV4Manager`，`get_sign_key`、`/api/paas/c1f3a7e2/v2/client` |
| 重试默认 | `resolveAiSdkModelRetryOptions` PNe={2s,×2,60s,11,jitter} |
| Retry-After | `parseRetryAfterMs`、`calculateRetryDelay`、`x-should-retry` |
| 流空闲超时 | `resolveModelStreamIdleTimeoutMs`，JH=600s，+30s/retry |
| auto-compact | `getAutoCompactOutputReserveTokens`，cve=2e5/Epo=32e3/oda=21e3/Apo=13e3 |
| usage DDL | 迁移 `0010_usage_observability`（model_usage/turn_usage/tool_usage 全 DDL） |
| usage 写入 | `recordModelUsage`(insert into model_usage)、调用点 `a1`（attempt 级） |
| SSE 解析 | `pUs`（data: 行），anthropic delta schema（thinking/signature/compaction/citations） |
| thinking map | provider JSON `modelApiRules`（glm-5.3 → thinking enabled + output_config.effort） |
| /model 命令 | `handleModelCommand`、`resolveTuiModelSelection`、`formatModelPickerValue`（`$` 分隔 reasoningLevel） |

## 8. 与 Drora 的对齐提示（供后续批次参考）

- 契约键：`x-zcode-query-source`、`X-ZCode-App-Version`、`x-api-key-id`、`x-off-peak-ticket-id`（脱敏/路由面）应纳入 parity 键对照。
- 鉴权双通道：OAuth 账号计划（business token 每请求刷新 + 签名 V4）与 API-key 模板（静态 key）——Drora 侧如仅实现静态 key，需明确"有意分歧"记录。
- 重试预算 env 键 `ZCODE_MODEL_RETRY_*` 四件套与流空闲超时可作行为对齐锚点。
- `compaction_delta`、`iterations.usage`、`output_config.effort/task_budget` 为上游私有扩展，复刻 SSE 层时需一并处理。
