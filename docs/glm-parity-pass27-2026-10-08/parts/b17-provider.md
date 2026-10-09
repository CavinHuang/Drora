# b17 provider/AI SDK 层对拍报告（pass27，2026-10-08）

真值 = `D:\software\zcode\resources\glm\zcode.cjs`（0.16.9）+ `provider/zcode-builtin.json`（revision 30）。
我方 = `D:\workspace\projects\Drora`（feat/migrate-remote-and-pet）。
证据格式：`bundle@偏移` 或 `文件:行`。引文 ≤20 字。

---

## §1 内置 provider 目录 diff

对比对象：
- 真值 `provider/zcode-builtin.json`（188476 B，schemaVersion 1，revision 30）
- 我方 `apps/drora-cli/packages/cli/dist/provider/drora-builtin.json`（键序规范化后 99067 字符 vs 真值 99067）

结构完全同构：`config.providerConfigRules{templateRules×20, providerRules×8}` + `config.modelConfigRules{modelRules×84, modelApiRules×70, providerSiteRules×52, templateModelRules×246, builtinProviderModelRules×26}`。

**全量递归 diff 仅 3 处**，全在 `providerSiteRules[].baseUrlMatch`：

| 数组下标 | 真值 | 我方 | 影响 |
| --- | --- | --- | --- |
| [28] | `https://zcode\.z\.ai/api/v1/zcode-plan/anthropic/?` | `https://drora\.z\.ai/...` | 站点规则永不命中（见下） |
| [35] | 同上 | 同上 | 同上 |
| [36] | `https://zcode\.z\.ai/api/v1/off-peak/anthropic/?` | `https://drora\.z\.ai/...` | 同上 |

三条规则挂载的能力（真值 JSON 内证据）：
- [28] `modelMatch:".*"`、无 apiTypeMatch → `properties.inputFormat={supportsImage:true,supportsVideo:true}`
- [35] `apiTypeMatch:"anthropic-messages"` → `supportsNativeWebSearch:true` + `supportsMidConversationSystem:true`
- [36] `apiTypeMatch:"anthropic-messages"` → `supportsNativeWebSearch:false` + `supportsMidConversationSystem:true`

影响链（我方）：
- 我方 `packages/provider/src/config/model-config.ts:415-419` 按 `baseUrlMatch` 匹配 provider 的 `api.baseUrl`；
- 我方目录内 providerRules 的 start/off-peak baseUrl 仍是 `https://zcode.z.ai/api/v1/zcode-plan|off-peak/anthropic`（与真值逐字节相同）；
- ⇒ 这 3 条站点规则在我方**永不命中**：start-plan/off-peak 的 GLM 模型丢失图片/视频输入声明与 native web search 能力位（回落 modelRules[0] 的 `supportsImage:false` 默认）；`supportsNativeWebSearch` 缺 true 后，WebSearch 原生工具在 anthropic 路径会抛 InvalidModelRequest（`apps/drora-cli/packages/adapters/src/model/tool-transform.ts:258-262`）。
- 判定：**REAL-GAP P1**（目录被半截改品牌：域名替换只做了匹配正则、没改 providerRules 的真实 baseUrl，二者自相矛盾）。drora.z.ai 在真值 bundle 中不存在；我方仓内也没有任何其他 drora.z.ai 引用。

其余目录字段（providerId/模板清单/api.type/baseUrl/builtinModelIds/optionSpecs DSL/manual 规则 schema）逐字段一致：
- 8 个 provider：zai individual/team/start、bigmodel individual/team/start、zai/bigmodel off-peak（hidden）；start/off-peak baseUrl 指 zcode.z.ai 代理，individual/team 直连官方端点。
- 20 个模板：zai/bigmodel（anthropic-messages + standard openai-chat-completions）、moonshot/minimax/deepseek/qwen/xiaomi（anthropic-messages）、openai/xai（openai-responses）、openrouter（anthropic-messages）、opencode go/zen 三态。
- optionSpecs DSL（thinking/enable_thinking/reasoning/max_tokens/max_completion_tokens/max_output_tokens、speed）两侧同串。

## §2 请求序列化

我方 `apps/drora-cli/packages/adapters/src/model/` 与真值 @3699k-3726k 的 AiSdkModelExecution 同源（函数名逐一对应：`toAiSdkProviderConfig/applyModelRequestAuth/withAnthropicAuthorizationHeader/hasHeader/normalizeAnthropicBaseURL/createProviderBusinessErrorFetch/readProviderBusinessFailureFromBody/...`，truth@3725300-3726700）。providerKind 条件化装配一致：openai→responses、anthropic、openai-compatible（chat-completions，includeUsage+supportsStructuredOutputs）。

五叶重测结果：
1. `metadata.user_id`：✅ 一致。真值 `MLs`=JSON{device_id:deviceMid, account_uuid:"", session_id}（truth@3945645）；我方 `anthropic-request-metadata.ts:7-16` 同形同源（deviceMid 走 `ensureCliDeviceMid`）；redaction（[REDACTED] 双路径）也一致（truth@3945910 / 我方 :34-84）。
2. `cache_control`（顶层）：两侧同为 SDK 能力位、均无调用方主动赋值（builtin 目录 0 次出现 cache_control），等价休眠。✅
3. `system` 形状：✅ 一致。truth `restoreMidConversationSystemStringContent`（truth@3701300 一带）≈ 我方 `anthropic-stream-compat.ts:28-56`，同名单同逻辑；流式 thinking 签名兼容/suppress tool_result/signature_delta 补帧、非流式无签名 thinking 剔除逐函数同名（truth LPs/MPs @3700822-3701142 ≈ 我方 :119-302）。
4. `max_tokens`：✅ 一致。经 option-map（`{'max_tokens': maxOutputTokens}` / `max_completion_tokens` / `max_output_tokens`）按 apiType 条件化；JSON 同源（§1），patch 边界一致（我方 `model-option-map-fetch.ts` fail-closed 与 truth GUr/qPs 同形，truth@3702400 一带）。
5. `thinking/reasoning`：✅ 一致。anthropic `thinking.type=disabled|adaptive`（+output_config.effort）、chat-completions `thinking+enable_thinking`、responses `reasoning.effort`，全部来自同一份内置目录 DSL。

其他序列化点：
- providerOptions：truth zod schema 含 thinking/cacheControl{ttl}/metadata.userId/mcpServers/container{skills}（truth@3470300-3470500）；我方 stock `@ai-sdk/anthropic@3.0.81` dist 同样支持全部键（grep 命中 user_id/inference_geo/mcp_servers/container/context_management/cache_control）。我方 `runner-options.ts:209-230` 的 anthropic.metadata.userId 注入与 truth vWr 同形。
- **REAL-GAP P3**：truth anthropic 兼容层多一组 `restoreMemorySelectorMessageBoundaries`/`isMemorySelectorOutput`/`hasTextPrefix`（truth@3701200 一带，`Available memories:` 前缀拆分 + selected_memories 输出判定）；我方 `anthropic-stream-compat.ts` 无此组。我方记忆机制（core/src/memory、context/sections/memory.ts）不使用该 wire 形状，当前无行为差；仅在对齐真值记忆选择器时需要补。
- openai-responses JSON 兼容（msg_ id 合成 + annotations 规范化）：✅ 逐函数一致（truth VUr/UPs @3702300 ≈ 我方 `openai-responses-json-compat.ts`）。

## §3 签名/握手链

**真值有完整 ClientRequestSigningV4，我方为零。REAL-GAP P1。**

真值证据：
- 七头：`X-Client-Ts/X-Client-Version/X-Client-Sig/X-Session-Id/X-Client-Nonce/X-App-Id/X-Client-Pow`（truth@853350-854000，X-App-Id="zcode"）。
- 握手：`GET {origin}/api/paas/c1f3a7e2/v2/client`，op=`get_sign_key`（truth@848100），返回经 HKDF（盐 `WD_CLIENT_SIGN_KDF_SALT`）+ ed25519 私钥解密（truth@846700-848000）；apiKey 为 `id.secret` 形（`resolveCredential` 按 separator 拆分，truth@856700）。
- PoW：SHA-256 前导零，powBits=8，counter hex8，appId+sessionId 参与（truth@846500-846700 `createClientRequestProofOfWork`）。
- 开闭门：`CodingPlanSignatureFeatureGate` GET `/api/v1/agent/configs`，读 `data.codingPlanSignature`，TTL 1h、timeout 15s（truth@843500-844300）。
- 判定面：`requiresClientRequestSigning`（truth@3711997）= zhipu-coding-plan-api-key / zhipu-account(individual|team) / baseURL 属 z.ai、bigmodel 域（wXe，truth@958600）或主机 ∈ {api.chatglm.site, zcode.chatglm.site}（rRs，truth@3718900）；start-plan/off-peak zhipu-account 明确免签（access_mode 分支仅记日志，truth@3722850）。
- 韧性：签名失败重试 2 次后进 bypass（verify_refresh_exhausted），handshake 失败 fail-open（truth@851500-853000）；共享 key cache `AiSdkClientRequestSigningState`（truth@3719000）。
- clientVersion 取自请求头 `X-ZCode-App-Version`（truth@3725400 fRs）。

我方证据：全仓 grep `X-Client-Sig|get_sign_key|c1f3a7e2|X-Client-Pow|ClientRequestSigning|signBusinessMessage` → 0 命中（`apps/drora-cli/packages/*`，排除 dist/node_modules）。`model-execution.ts` 的 fetch 链 = gateway → proxy fetch，无签名环。

影响：签名由服务端 feature gate 控制；gate 关闭时真值也走 unsigned。但 gate 一旦对 coding-plan 端点开启，我方全部官方套餐请求会被网关拒签（3007 类校验已有先例，我方 `model-execution.ts:450` 注释可证服务端有安全校验）。这是与真值最大的行为差。

归因头（x-request-id/x-zcode-session-type/x-zcode-trace-id/x-query-id/x-session-id/x-opencode-session）✅ 完全一致（truth@3938150 xst ≈ 我方 `runner-attribution.ts:27-46`，含 opencode.ai/zen/go/v1 条件）。

默认头：HTTP-Referer/User-Agent/X-Title/X-Release-Channel/X-Client-Language/X-Client-Timezone/平台头 ✅ 同构（truth iHo/nHo @14081k ≈ 我方 `model-config.ts:47-66` + `runtime-platform-headers.ts`）。**SHAPE-DIFF P3**：真值 `User-Agent: ZCode/<v>`、`X-ZCode-App-Version`、`X-ZCode-Agent: glm`；我方 `Drora/<v>`、`X-Drora-App-Version`、`X-Drora-Agent`（model-config.ts:57,58,63），但 `X-Title` 仍保留 `Z Code@`（:59）——改名不彻底；若服务端按 X-ZCode-App-Version 读版本（签名 clientVersion 即如此），我方版本头不可见。

## §4 韧性执行器

| 项 | 真值 | 我方 | 结论 |
| --- | --- | --- | --- |
| 重试默认 | backoff 2 / base 2000ms / jitter / maxAttempts 11 / maxDelay 60s（truth@3726800 EDe） | 同值（retry-policy.ts:13-30） | ✅ |
| env 覆盖 | ZCODE_MODEL_RETRY_{MAX_RETRIES(+1),BASE_DELAY_MS,BACKOFF_FACTOR,MAX_DELAY_MS} | DRORA_MODEL_RETRY_*（同名逻辑） | ✅（改名） |
| retry-after | 上限 5min、`x-should-retry`、`retry-after-ms` 解析（truth@4010000 m4s） | runner-retry.ts:15,101-106,239-246 同 | ✅ |
| 空补全重试 | 1 次、ServerError（truth@4010330 lOe/S4s） | empty-completion-retry.ts:12 `EMPTY_COMPLETION_MAX_RETRIES=1` | ✅ |
| off-peak | 3102/3001=票据过期、3105/429=排队 min(Retry-After,5min)/60s、marker `off-peak-ticket-expired`（truth@3933700 KDe, iLs/sLs/aLs） | offpeak-retry.ts 逐值相同 | ✅ |
| 流空闲超时 | 600000ms（truth@1301736 YV） | contracts/config/index.ts:284 同值 | ✅ |
| SSE 业务错误 | 200 SSE error frame 抛 ProviderBusinessError、保留响应头（truth hRs/vRs） | model-execution.ts:680-890 同 | ✅ |
| endpointRoutingPort | 请求期按服务端 proxyEndpoint mapping 重写 URL（truth@3709296 Ban、schema @4064700、CLI 注入 @14094400） | 无 | **REAL-GAP P2**（可选注入，缺省 no-op；企业路由场景失效） |
| AI SDK 层重试 | maxRetries:0，重试全部在自有 runner | 同（runner-options.ts:92,150） | ✅ |

## §5 模型选择门

- reasoningLevel 门：两侧 optionSpecs.values（如 glm-5 族 `["disabled","enabled"]`）来自同一内置目录；`compileModelOptionMaps` 要求 effective value 否则抛错（truth@529300 Otr ≈ 我方 packages/model-option-map/src/compiler.ts:50,87）。✅
- 旧级改名表：真值 dmr 数组 25 条（truth@1063900，glm-5→off、GLM-5.2→nothink…）与我方 `@drora/provider-node/src/legacy-reasoning-level-renames.ts` 25 条逐条相同（含顺序）。✅
- manual 模型：truth 有 manualProviderModel/clearManualModelConfig（truth@533071,536929）；我方 `packages/provider/src/config/model-config.ts:396-399,425-456` 同构（manual-provider-model 规则 + 推荐配置覆盖）。✅
- env 种模门（0.16.9）：`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`/`ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE`/`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`（truth@1067300）、个人文件名 `provider_config.json`、SEA 资产键 `zcode-provider/zcode-builtin.json`（truth@1069400）；我方 DRORA_* 三键、同名 provider_config.json（provider-node runtime-paths.ts:1-5）、`drora-provider/drora-builtin.json`（cli/src/provider-runtime-env.ts:18）。✅（纯改名，SHAPE-DIFF）
- endpoint-scoped 目录源：truth `EndpointScopedZCodeBuiltinSource`（truth@596204）≈ 我方 endpoint-scoped-drora-builtin-source.ts。✅
- 自定义/ghost 供应商标识：truth 有 `custom:`（CUSTOM_MODEL_VALUE_PREFIX）与 `ghost:`（buildGhostSupplierIdentity，truth@959000-961500，用于 telemetry supplier 归因）；我方 provider/provider-node 无对应物。**REAL-GAP P3**（遥测归因损失，非请求行为）。
- 官方套餐判定 cee（zai/bigmodel individual/team/start，truth@959100 后）≈ 我方 account-provider-resolution 的 zhipu-account access。✅（结构级）

## §6 容器技能序列化裁决（批7 G2 遗留）

真值 `{type:"skill_reference",skill_id,version}`（@3541837）位于 **inlined @ai-sdk/openai 的 responses 实现**（3.42M–3.62M 区间），完整形状：providerOptions `openai.shell` → environment `containerAuto{file_ids,memory_limit,network_policy,skills[]}` / `containerReference`（truth@3573100 zod、@3541400 序列化、@3601950 doGenerate 消费）。同区还有 openai.provider 工具族映射：code_interpreter/file_search/image_generation/local_shell/shell/web_search/mcp/apply_patch/tool_search（truth@3597900）。

裁决：**该叶属 SDK 层休眠能力，不是核心请求路径差异。**
- 归属：仅 providerKind=openai（api.type=openai-responses：openai/xai/opencode-zen/go responses 模板）的请求、且显式声明 `openai.shell` 工具时才可能触发；两侧核心层（tool 注册与 ModelToolContract→toAiSdkTools）都从未构造该工具（真值全部命中都在 SDK 区间；我方全仓 0 命中 openai.shell/container）。
- 我方等价物：stock `@ai-sdk/openai@3.0.65` dist 自带同一能力（grep container_auto/skill_reference/openai.shell/network_policy 全命中），我方 provider-native 工具目前只映射 WebSearch（tool-transform.ts:245-262）。
- 真实影响：今天为零（双侧都不发该请求）；若未来接 OpenAI 容器 shell/技能，需要在我方 tool-transform 补 provider-native 映射，而不是序列化层。
- 分类：**SHAPE-DIFF / 非缺口（NOT-A-GAP）**，P3 备案。

## §7 差集三分类表

| # | 分类 | 等级 | 项 | 证据 |
| --- | --- | --- | --- | --- |
| G1 | REAL-GAP | **P1** | ClientRequestSigningV4 全链缺失：handshake `/api/paas/c1f3a7e2/v2/client`、get_sign_key、ed25519+HKDF、PoW(8bit)、七头、feature gate `/api/v1/agent/configs`、bypass/重试 2 次、共享 key cache、按 provider/access/domain 的判定面 | truth@846500-857000, 3711997, 3718900, 843500；我方 grep 全 0 |
| G2 | REAL-GAP | **P1** | 内置目录 siteRules[28][35][36] baseUrlMatch 被改 `zcode.z.ai`→`drora.z.ai`，与 providerRules 真实 baseUrl（zcode.z.ai）失配 ⇒ start/off-peak 丢 inputFormat 图片/视频与 supportsNativeWebSearch | 目录 diff（§1）；我方 model-config.ts:417；tool-transform.ts:258 |
| G3 | REAL-GAP | P2 | endpointRoutingPort 动态端点路由（服务端 proxyEndpoint mapping）缺失 | truth@3709296, 4064700, 14094400 |
| G4 | REAL-GAP | P3 | anthropic 兼容层缺 restoreMemorySelectorMessageBoundaries（selected_memories 记忆前缀拆分） | truth@3701200 区；我方 anthropic-stream-compat.ts |
| G5 | REAL-GAP | P3 | custom:/ghost: 供应商标识与 telemetry supplier 归因缺失 | truth@959000-961500, CUSTOM_MODEL_VALUE_PREFIX @1002700 区 |
| E1 | EXTRA | P2 | 官方 individual/team 端点重定向到平台网关 `/api/v1/ultra/...`、`/api/v1/ultra-zai/...`（真值直连官方端点，bundle 无 ultra 路径；行为替换而非纯新增） | official-coding-plan-gateway.ts:22-31；truth grep "ultra" 0 命中、api/anthropic 0 命中 |
| E2 | EXTRA | P3 | `access_mode` 免签观察日志、provider 业务错误 SSE transform 的 providerRequestId 二次读取等移植期加固（真值同名函数的等价或超集，无行为面冲突） | model-execution.ts 与 truth hRs 对照 |
| S1 | SHAPE-DIFF | P3 | env 键与资产键改名：ZCODE_*→DRORA_*（retry 4 键、builtin/personal config file、BASE_URL/ENDPOINT_ORIGIN/ENV）、zcode-provider/→drora-provider/、zcode-builtin.json→drora-builtin.json | retry-policy.ts:18-21；runtime-paths.ts:1-5；provider-runtime-env.ts:18 |
| S2 | SHAPE-DIFF | P3 | 默认头品牌：User-Agent Drora/、X-Drora-App-Version、X-Drora-Agent；但 X-Title 残留 `Z Code@`（改名不彻底，服务端若读 X-ZCode-App-Version 则我方版本不可见） | model-config.ts:57-63 |
| S3 | SHAPE-DIFF | P3 | 容器技能序列化＝两侧 SDK 均具备、核心均未启用（§6） | truth@3541400；我方 @ai-sdk/openai dist |

计数：REAL-GAP 5（P1×2、P2×1、P3×2）；EXTRA 2（P2×1、P3×1）；SHAPE-DIFF 3（P3×3）。

## §8 OPEN-QUESTION

1. **Q1（挂 G1）**：签名 feature gate（/api/v1/agent/configs 的 codingPlanSignature）当前线上是否已开启？若开启，我方 coding-plan 请求现网应已被拒（3007）；若未开启，G1 是"定时炸弹"而非现行故障。需运行时取证。
2. **Q2（挂 E1）**：zcode.z.ai 网关是否真实存在 `/api/v1/ultra/anthropic/v1/messages`、`/api/v1/ultra-zai/anthropic/v1/messages` 路由（Drora 平台新增），还是我方单方面假设？真值 0.16.9 客户端直连官方端点，无法从 bundle 证实服务端路由。
3. **Q3（挂 G2）**：`drora.z.ai` 是否为规划的独立代理域名（未来 DNS/网关上线后 siteRules 才生效）？若是，providerRules baseUrl 也应同步改，现在处于半截状态。
4. **Q4**：truth 内置目录远端刷新协议（Built-in 刷新 reporter，truth@1067400 区；我方 drora-builtin-remote-synchronizer 的 fetchRelease）的 URL、revision 协商与缓存失效细节本次未逐字节对拍，待下一批。
5. **Q5**：truth `speed`/`inferenceGeo` providerOptions 的上游赋值面（builtin 目录 speed×17 仅在 modelMatch/DSL 命中名）我方已同源；但 truth 3470300 schema 中 `mcpServers`（type:"url"+authorizationToken）的调用方装配是否存在于核心层，未完整追迹（SDK 区间外无命中，倾向休眠，与 §6 同判）。
