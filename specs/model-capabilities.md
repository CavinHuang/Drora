# Drora 模型能力档案与模型设置页收敛 Spec

- 日期：2026-11-04
- 状态：**已实施并收口**（2026-11-04 同日批次一至三施工完成、逐批合规审查均「通过」、独立评审 mustFix 0；批次四勾验完成）。MC-1..MC-8、MC-10 自动化测试面全绿；MC-9 与 MC-5/MC-10 的浏览器/真机验收面待人工执行。终局门禁 typecheck / lint / architecture:check / test:drora 通过；fmt:check 与 CLI typecheck/build 未过（既有基线与并行工作所致，详见 §11 实施记录）。
- 输入材料：2026-11-03/04 四轮只读调查（模型设置页现状、Jev/System One 链路、embedding/语音/画图配置盘点、CLI 工具注册与凭据通道先例）+ 2026-11-04 三项用户裁定。
- 证据约定：文中 `path:line` 为 2026-11-03/04 调查在本仓检出源码上实际读取所得；行号随实现漂移以符号名为准。

## 0. 用户裁定（2026-11-04，冻结）

| #   | 裁定              | 内容                                                                                                                                                   |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | 收敛深度 = 方案 C | UI 聚合 + 自研「模型能力档案」数据层；**官方 provider 体系（packages/provider、provider-node、drora-builtin.json、CDN 同步）零改动**，上游同步零分歧面 |
| D-2 | 原分区完全合并    | Jev 开关、语义检索开关、语音引擎选择**也**搬进模型设置页；knowledge 分区整体消失；voice 分区瘦身为纯行为偏好                                           |
| D-3 | 画图完整链路      | 档案 + UI + agent 内置文生图工具，本次一次做完                                                                                                         |

执行口径澄清（依 D-2 原意）：「完全合并」针对**模型/端点/凭据配置与引擎档**。语音分区的纯行为偏好（播报开关、语速 `voiceAnnouncementRate`、播报语言、系统音色、听写语言、入口显隐、persona 显示、工具简报、隐私披露确认）不是模型配置，留在语音分区；塞进模型设置页属于产品错误归类。

## 1. 背景与问题

五类模型配置现状（调查实证）：

| 配置                   | 当前 UI                             | 存储                                                                                                  | 协议                                                            | 生效时机                         |
| ---------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| 聊天模型               | 模型设置分区 `ModelProviderSection` | `~/.drora/v2/provider_config.json`（apiKey 明文）                                                     | anthropic-messages / openai-chat-completions / openai-responses | agent 子进程 env 注入，新会话    |
| System One（Jev 评分） | 知识问答分区                        | AppSettings `knowledgeJev*` 7 键 + `credentials.json` 3 加密键                                        | `POST {baseURL}/v1/systemone`（openrouter `/decisions`）        | 每 stage 解析 + 签名清缓存，即时 |
| Embedding              | 知识问答分区（开关+下载状态面）     | `knowledgeSemanticEnabled`；模型=本地资产 `~/.drora/knowledge/models/bge-small-zh-v1.5`               | 本地 ONNX（onnxruntime-node）                                   | 端口热切换                       |
| 语音 ASR/TTS           | 语音分区                            | AppSettings `voice*`（15 键，`packages/shared/src/contracts/voice.ts:20-43`）+ `voice:vendor:api-key` | OpenAI 兼容 `/audio/transcriptions`、`/audio/speech`            | 渲染进程适配器，即时             |
| 图像生成               | **不存在**                          | —                                                                                                     | （本次新增，OpenAI images 兼容）                                | —                                |

问题：入口分散（四个分区）、同一供应商凭据多处重复输入（openrouter key 在聊天 provider 与 Jev 各一份）、凭据安全语义不一致（provider 明文 vs 其他加密）、图像生成无落点（`create-pet` 技能目前明确依赖「用户自备图像生成工具」并在缺席时报告能力缺失）。

## 2. 冻结决策总览

| #   | 决策                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | 新建自研「模型能力档案」：单一文件 `~/.drora/v2/model_capabilities.json` + 凭据统一走 `ICredentialService`（加密）。唯一所有者 = services 层新档案服务                                               |
| F-2 | 官方 provider schema、`provider_config.json`、`drora-builtin.json`、provisioning 面零改动；模型能力档案是纯自研叠加                                                                                  |
| F-3 | 契约单一出处：`packages/shared/src/contracts/modelCapabilities.ts`（purpose 常量、档案 schema、凭据键、迁移映射）                                                                                    |
| F-4 | 功能开关（Jev 开关、语义开关、ASR/TTS 引擎选择）随端点配置一并进档案条目；语音行为偏好留 AppSettings（见 §0 澄清）                                                                                   |
| F-5 | 图像生成 = agent 内置工具 `generate_image`（VaultSearch 同构：CLI 工具壳 → 反向 RPC → **Host 出站**，凭据零出 Host）                                                                                 |
| F-6 | 图像生成协议 = OpenAI images 兼容：`POST {baseUrl}/images/generations`，baseUrl 含版本段（如 `https://open.bigmodel.cn/api/paas/v4`、`https://api.openai.com/v1`），与 voice 厂商档 baseUrl 语义一致 |
| F-7 | 旧键一次性迁移（AppSettings 14 键删除 + 凭据 5 键迁移），迁移后旧键清理，不做降级兼容（桌面整包单向发版）                                                                                            |
| F-8 | 不做清单：provider 用途维度（方案 A）、provider apiKey 明文改造（独立议题，见 OQ-4）、远程 embedding 端点实现（schema 预留 fail-closed）、图像 edit/variation、n>1 批量生成、画图测试连接（见 OQ-2） |

## 3. 契约与数据模型

### 3.1 `packages/shared/src/contracts/modelCapabilities.ts`（新，契约键单一出处）

```ts
/** 档案持久化文件名（存 getAppConfigDir() = ~/.drora/v2/）。 */
export const MODEL_CAPABILITIES_FILE_NAME = "model_capabilities.json";

/** purpose 枚举（条目固定五类，顺序即 UI 呈现顺序）。 */
export const MODEL_CAPABILITY_PURPOSES = [
  "decision-jev", // 知识评分（System One 线协议）
  "embedding", // 语义嵌入（V1 仅本地形态）
  "asr", // 语音识别
  "tts", // 语音合成
  "image-generation", // 图像生成（本次新增）
] as const;

/** 凭据键。decision-jev 按 providerKind 分键（迁自此前三键并存语义，
 *  切换供应商不丢 key）；asr/tts 各自独立（迁自单键双写）。 */
export const modelCapabilityCredentialKey = {
  decisionJev: (providerKind: KnowledgeJevProvider) =>
    `model-capabilities:decision-jev:${providerKind}:api-key`,
  asr: "model-capabilities:asr:api-key",
  tts: "model-capabilities:tts:api-key",
  imageGeneration: "model-capabilities:image-generation:api-key",
} as const;
```

`KNOWLEDGE_JEV_PROVIDERS`（`packages/shared/src/knowledge-jev.ts:23`）迁移并入本契约；原 `KNOWLEDGE_JEV_*_CREDENTIAL_KEY` 三常量删除，改名前全链 grep 生产与消费（AGENTS.md 契约键规则）。

### 3.2 档案 schema（zod，shared 定义、services 持久化时校验）

```ts
modelCapabilitiesFileSchema = z.object({
  schemaVersion: z.literal(1),
  capabilities: z.object({
    "decision-jev": z.object({
      enabled: z.boolean().default(false),
      providerKind: z.enum(["typesafe", "openrouter", "ai-gateway"]).catch("typesafe"),
      // 三供应商共用一对可选字段；解析时按 providerKind 取（与现 jevAssembly 语义一致）：
      // typesafe: baseUrl（空=官方默认 https://api.typesafe.ai）
      // openrouter / ai-gateway: baseUrl（空=内置默认）+ modelId 必填
      baseUrl: z.string().default(""),
      modelId: z.string().default(""),
    }),
    embedding: z.object({
      enabled: z.boolean().default(false),
      mode: z.literal("local"), // "remote" 为 schema 预留，V1 解析器 fail-closed 拒绝
      localModelId: z.literal("local-bge-small-zh-v1.5-int8"),
    }),
    asr: z.object({
      engine: z.enum(["webSpeech", "remote"]).default("webSpeech"),
      baseUrl: z.string().default(""), // engine=remote 时必填（https 强制，localhost 例外，照 voiceVendorBaseUrl 校验）
      modelId: z.string().default(""),
    }),
    tts: z.object({
      engine: z.enum(["system", "cloud"]).default("system"),
      baseUrl: z.string().default(""),
      modelId: z.string().default(""),
      voice: z.string().default(""),
    }),
    "image-generation": z.object({
      enabled: z.boolean().default(false),
      baseUrl: z.string().default(""), // enabled=true 时必填（https 强制）
      modelId: z.string().default(""), // enabled=true 时必填（如 cogview-4-flash、dall-e-3）
    }),
  }),
});
```

非敏感字段（baseUrl、modelId、engine、enabled）进档案文件明文；apiKey 一律不进档案文件，只在 credentialService。

### 3.3 旧键迁移映射（一次性，F-7）

| 旧位置                                                                                                          | 新位置                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `knowledgeJevEnabled`                                                                                           | `capabilities["decision-jev"].enabled`                                                                                     |
| `knowledgeJevProvider`                                                                                          | `.providerKind`                                                                                                            |
| `knowledgeJevBaseUrl`                                                                                           | `.baseUrl`（typesafe 激活时）                                                                                              |
| `knowledgeJevOpenrouterBaseUrl` / `knowledgeJevAiGatewayBaseUrl`                                                | `.baseUrl`（对应激活时）                                                                                                   |
| `knowledgeJevOpenrouterModel` / `knowledgeJevAiGatewayModel`                                                    | `.modelId`（对应激活时）                                                                                                   |
| `knowledgeSemanticEnabled`                                                                                      | `capabilities.embedding.enabled`                                                                                           |
| `voiceAsrEngine`                                                                                                | `capabilities.asr.engine`                                                                                                  |
| `voiceVendorBaseUrl`                                                                                            | `capabilities.asr.baseUrl` **与** `capabilities.tts.baseUrl`（双写同值；此后两腿独立演化——原共用约束解除，属有意语义改进） |
| `voiceAsrVendorModel`                                                                                           | `capabilities.asr.modelId`                                                                                                 |
| `voiceTtsEngine`                                                                                                | `capabilities.tts.engine`                                                                                                  |
| `voiceTtsVendorModel`                                                                                           | `capabilities.tts.modelId`                                                                                                 |
| `voiceTtsVendorVoice`                                                                                           | `capabilities.tts.voice`                                                                                                   |
| 凭据 `knowledge-jev:typesafe-api-key` / `knowledge-jev:openrouter-api-key` / `knowledge-jev:ai-gateway-api-key` | `model-capabilities:decision-jev:{kind}:api-key` 三键一一对应迁移                                                          |
| 凭据 `voice:vendor:api-key`                                                                                     | `model-capabilities:asr:api-key` 与 `model-capabilities:tts:api-key` 双写同值                                              |

迁移规则：档案服务首次初始化时执行；写 `migratedFromLegacySettings: true` 标记（档案文件内字段）后旧 AppSettings 键与旧凭据键删除；迁移幂等（标记已存在即跳过）；迁移解析异常按「旧值缺失」处理，不阻断（fail-closed 到各能力默认关闭态）。

实现口径（批次二落地补充）：

- **迁移源读原始 setting.json**：批次二把 14 键从 appSettings schema 删除后，`settingService.get()` 的 z.object 解析会 strip 掉文件里的旧键——迁移源改为读原始文件（`readRawLegacyAppSettings`，settingService 模块内同一路径解析规则的单一出处导出；经档案服务 deps 注入、缺省用该导出，测试可隔离）。运行时读路径仍只经 `settingService.get()`。
- **旧键物理清理 = 空补丁整写一次**：patch schema 同样 strip 未知键，「按键传 undefined」不再可达；清理改为 `settingService.update({})`——写锁内以 appSettingsSchema 重解析当前值（strip 掉旧键）后原子写回，setting.json 中旧键随即物理消失。删除仍以标记落盘成功为前提（顺序不变式不变）。
- **persona 云音色双存储**（§5.2）：persona 点选 builtin 的物化写从「appSettings 五键」改为成对写——appSettings 四行为键（voicePersonaId/voiceAnnouncementVoice/voiceAnnouncementRate/voiceAnnouncementLang）+ 档案 `tts.voice`（`buildVoicePersonaCapabilityPatch`）；显示派生判定同步读两存储（`resolveVoicePersonaSelection(settings, ttsVendorVoice)`）。

**AppSettings 删除键清单（14 键）**：`knowledgeJevEnabled`、`knowledgeJevProvider`、`knowledgeJevBaseUrl`、`knowledgeJevOpenrouterModel`、`knowledgeJevOpenrouterBaseUrl`、`knowledgeJevAiGatewayModel`、`knowledgeJevAiGatewayBaseUrl`、`knowledgeSemanticEnabled`、`voiceAsrEngine`、`voiceVendorBaseUrl`、`voiceAsrVendorModel`、`voiceTtsEngine`、`voiceTtsVendorModel`、`voiceTtsVendorVoice`。`validationAppSettings.ts` schema 与 `VOICE_SETTINGS_KEYS` parity 单测同步收窄（voice 契约留 9 键：composerEntryHidden、announcementEnabled/Voice/Rate/Lang、dictationLang、personaId、toolBriefEnabled、privacyDisclosureAcknowledged）。

## 4. 状态所有者与事件顺序

**唯一所有者**：`ModelCapabilitiesService`（`packages/services/src/model-capabilities/`，自研模块，架构 adopt 登记）。读快照 + `onDidChange` 订阅；写路径只有 `update(patch)`（zod 校验 → 档案原子写盘 → 凭据变更写 credentialService → 广播）。

```
写入（唯一路径）
  模型设置页表单 ──▶ IModelCapabilitiesService.update(patch)
                       │ zod 校验 → 原子写 model_capabilities.json
                       │ apiKey 字段 → ICredentialService（加密）
                       ▼
                 onDidChange(capabilities) 广播
      ┌──────────────┬───────────────┬────────────────┬───────────────┐
      ▼              ▼               ▼                ▼               ▼
 Host: Jev 装配   Host: embedding  UI: useModel-    Host: 画图服务   （其余 UI 表单
 configSource 重读 端口热切换       Capabilities     （每次请求读     仅回显）
 （签名变更即清    （沿用既有        hook → 语音      快照，天然最新）
  缓存，下一个     refreshDecision- 适配器下一次
  决策 stage 生效） Config 路径）      调用生效）
```

生效时机（UI 各条目须如实标注，不谎称统一）：

| purpose          | 生效语义                                                                   |
| ---------------- | -------------------------------------------------------------------------- |
| decision-jev     | 即时（下一次决策 stage；签名清缓存机制照搬 `jevDynamicProvider.ts:22-49`） |
| embedding        | 即时（端口热切换；已索引向量按 `model_id` 隔离，既有语义不变）             |
| asr / tts        | 即时（下一次听写/播报；渲染进程经 hook 订阅）                              |
| image-generation | 即时（每次工具调用经反向 RPC 取快照）                                      |

服务通道：`ServiceChannels.ModelCapabilities = "model-capabilities"`（`packages/shared/src/channels.ts` 新增）；UI 经新 hook `useModelCapabilities`（与 `useModelProviders` 同构，符合「组件经 hooks 访问服务」）。语音适配器（UI 包）的 `RemoteAsrVendorConfig`/`RemoteTtsVendorConfig` 数据源从 useSettings 改为该 hook；引擎回退树（remote→webSpeech、cloud→system）语义不变。

## 5. UI 信息架构（模型设置页收敛）

### 5.1 导航与条目

`ModelProviderSection` 左导航（`useModelProviderNavigation.ts`）新增第三分组 **「模型能力」**（id `capabilities`，置于 preset/custom 供应商分组之后；固定顺序、**不参与 dnd 排序**）。五个条目与表单：

| 条目     | 表单内容                                                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 知识评分 | Jev 开关；provider Select（typesafe/openrouter/ai-gateway）；按 kind 显隐 baseUrl（typesafe）/ baseUrl+modelId（远程两家）；ApiKeyInput（按 kind 分键）；测试连接（沿用 `testJevConnection` RPC 与结果分类文案） |
| 语义嵌入 | 语义开关；本地模型说明行 + 四态状态面 + 下载/重试（自 `KnowledgeSettingsSection.tsx:264-320` 迁入，轮询节奏不变）                                                                                                |
| 语音识别 | 引擎 Select（系统听写/厂商端点）；engine=remote 时显 baseUrl + 模型 id + ApiKeyInput                                                                                                                             |
| 语音合成 | 引擎 Select（系统语音/云端）；engine=cloud 时显 baseUrl + 模型 id + 音色 + ApiKeyInput                                                                                                                           |
| 图像生成 | 开关；baseUrl（含常用预设 datalist：OpenAI / 智谱开放平台 / 自填）+ 模型 id + ApiKeyInput                                                                                                                        |

复用现有组件族：连接区模式（baseUrl 输入 + 行内 https 校验警告）抽自 `ProviderCardSections.tsx`；`ApiKeyInput` 改造为可指定凭据键 + 保存回调（留空保存即删除，沿用 `ApiKeyRow` 语义）。

### 5.2 原分区处置

- **knowledge 分区整体删除**：`KnowledgeSettingsSection.tsx` 删除；`settingsPageConfig.ts` 移除注册与桌面门控分支；`SettingsPage.tsx` 渲染分支删除；knowledge i18n 键清理（保留 VaultView 侧 `vault.ask.banner.*` 等运行时消费键）。VaultView `jevOff` 横幅的「去设置」入口随之改跳模型设置页（Jev 开关现址；`vault.ask.banner.jevOff.*` 文案不变）。
- **voice 分区瘦身**：`VoiceSection.tsx` 删除厂商档/引擎区（engine Select、baseUrl、ASR/TTS 模型、音色、apiKey 行及其 i18n），保留行为偏好区（播报开关/语言/语速/系统音色预览、听写语言、入口显隐、persona、工具简报、隐私披露）；分区描述文案改为指向模型设置页。
- 遥测：`userActionTraceCatalog.ts` 新增能力档案动作（toggle/save 类，逐条目），knowledge/voice 旧动作键清理。
- test-ids：`packages/shared/src/test-ids.ts` 新增 `TID_MODEL_CAPABILITY_*`；E2E 同步。

## 6. 图像生成完整链路（F-5/F-6）

### 6.1 架构（VaultSearch 同构，凭据零出 Host）

```
agent 会话
  └─ generate_image 工具（core，恒注册，shouldDefer: true）
       └─ imageGenerationPort（contracts 接口）
            └─ bootstrap: 反向 RPC modelCapability/generateImage（stdio JSON-RPC）
                 └─ Host: imageGenerationService
                      ├─ 读档案快照（enabled/baseUrl/modelId 校验，fail-closed）
                      ├─ 读凭据（credentialService 解密；凭据不落 runtime、不进日志、不进 CLI）
                      └─ 出站 POST {baseUrl}/images/generations（Bearer key）
                           └─ b64_json 优先；仅 url 时 Host 下载（≤20MiB，content-type 须 image/*）
                 ◀─ { imageBase64, contentType, bytes }
       └─ writeToolResultBinaryArtifact（retention "session"）
       └─ ≤200KiB 追加 node_repl_images display（照 image-normalization 先例）；
          否则 text 块写绝对路径（"Image saved to: <path>"，照 persistBrowserScreenshotArtifact）
```

### 6.2 工具契约

- `apps/drora-cli/packages/contracts/src/tools/generate-image.ts`：Input `{ prompt: string(min1, max 4000), size?: string }`（size 自由字符串 + 常用预设说明，不强校验枚举——各家取值集不同）；n 固定 1（F-8）；Output 含 `{ artifactPath, contentType, bytes }` + 错误分类。
- `core/src/tool/handlers/generate-image.ts`：ToolEntry + `shouldDefer: true`（照 `vault-search.ts:75`）；端口缺席/档案未启用/未配置 → 结构化 `ConfigurationError`（文案含「在模型设置页 → 图像生成配置」指引）。
- 注册：`builtInTools` 数组 + `runtime-tools.ts` 门。照 VaultSearch「恒注入 + 运行时错误语义」双层兜底（`server-operations.ts:3622` 先例），不做 include 布尔门。
- 权限：出站 + 潜在计费，走权限确认；粒度对齐现有出站类工具（WebFetch）的 permission 形态，实现时以其为准（见 OQ-2）。

### 6.3 协议与错误语义

- 请求 `{ model, prompt, size?, n: 1 }`，`Authorization: Bearer <key>`；Host 侧超时 180s（生成类接口慢于聊天）。
- 响应 `data[0].b64_json || data[0].url`；base64 载荷上限 8MiB（超出 → 工具报错并提示换小尺寸，防 stdio 大帧风险，OQ-5 实测后可调）。
- 错误分类照 `testJevConnection` 风格：401/403 认证失败文案、429 限流、4xx/5xx 原文透传、坏 JSON/坏 content-type 结构化报错。fail-closed：档案 enabled=false、baseUrl/modelId/key 缺失 → 不出站。
- 新 RPC 方法：`droraProtocolMethods` 增加 `modelCapabilityGenerateImage: "modelCapability/generateImage"`（Host 侧处理器照 `knowledge/search` 在 `droraAgentService.ts` 的分发模式；旧 Host 返回 -32601 时 CLI 翻译为固定不可用文案，照 `vault-search-port.ts`）。

### 6.4 create-pet 兼容

工具以真实 schema 注册即满足 `create-pet` SKILL.md 的发现条件（「Prefer a dedicated image-generation skill… otherwise use an enabled tool with its actual schema」）；工具落地成本地文件后技能自行复制进 job `output_path`，无额外耦合。

## 7. 上游对齐登记

- 官方 provider 体系（schema/registry/facades/provider-node/CDN 同步/provisioning）**零改动**；模型能力档案是纯自研叠加，符合「模块化、可跟踪」原则。
- 自研新增面：shared 契约 `modelCapabilities.ts`、services `model-capabilities` 模块（架构 adopt）、channels 新通道、`drora-protocol` 新 RPC 方法（自研扩展区）、CLI `generate_image` 工具、UI 收敛与 knowledge 分区删除（knowledge/voice 分区均为自研，无上游冲突）。
- `specs/drora-divergence-ledger.md` 不需新增条目（无官方行为分歧；本 spec 自身即决策记录）。

## 8. 验收场景（MC 系列）

| ID    | 场景                      | 通过标准                                                                                                       | 状态（2026-11-04 批次四收口勾验）                                                                                                                                               |
| ----- | ------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MC-1  | 档案服务读写              | update → 文件原子落盘 → onDidChange 收到新快照；坏 JSON 启动降级为全默认 + 备份原文件                          | ✅ 已过（`modelCapabilitiesService.test.ts`，含坏 JSON 降级 + `.corrupt-*.bak` 备份断言）                                                                                       |
| MC-2  | 迁移幂等                  | 含旧 knowledgeJev*/voice* 键的 setting.json + 旧凭据 → 初始化后档案值一一对应、旧键删除、二次启动不重复迁移    | ✅ 已过（`modelCapabilitiesMigration.test.ts` 6 用例 + `modelCapabilitiesService.test.ts` 5 用例；迁移侧含 3 条顺序不变式回归。§12 勘误：此前把两文件合计 11 误记到单文件名下） |
| MC-3  | Jev 热切换                | 模型设置页改 baseUrl → 不重启，下一次检索决策打新端点（沿用 `knowledgeJevHotReload.test.ts` 模式改数据源断言） | ✅ 已过（`knowledgeJevHotReload.test.ts` 改数据源后全绿；knowledgeJev 系列 + contract + host 7 文件 42 用例全过）                                                               |
| MC-4  | fail-closed               | Jev 关/缺 key、embedding 关、asr/tts 引擎非 remote、画图未配置 → 各消费方零出站，错误/关闭文案结构化           | ✅ 已过（`modelCapabilitiesImageGeneration.test.ts` 11/11 零出站断言；Jev 缺配置返回 null、embedding 关/null 纯词法均有零出站断言）                                             |
| MC-5  | UI 收敛                   | 模型设置页五条目可见可存；knowledge 分区消失；voice 分区仅剩行为偏好；双语 i18n 无缺 key                       | ✅ 组件级已过（ModelCapabilityDetail + capabilityNav 20/20、settingsPageConfig/VoiceSection、i18n parity 差集为空）；**浏览器 GUI 验收待人工**（WebdriverIO 环境不可用未执行）  |
| MC-6  | generate_image 正常链     | mock 端点返回 b64 → artifact 落盘（session retention）+ 路径 text 块 + ≤200KiB 时 display；消息流可见图片      | ✅ 已过（core `generate-image-handler.test.ts` 8/8 + services 11/11 b64/url 双路径；display 投影回归 70/70）                                                                    |
| MC-7  | generate_image 不可用语义 | 档案未启用/Host 缺处理器（-32601）→ 结构化 ConfigurationError，含设置页指引                                    | ✅ 已过（bootstrap `generate-image-port.test.ts` 5/5：-32601 翻译/透传/parse 防漂移；services disabled + not_configured 含设置页指引）                                          |
| MC-8  | generate_image 错误分类   | 401/429/5xx/坏载荷各自文案；>8MiB 拒绝                                                                         | ✅ 已过（services 11/11：401/403/429/4xx/5xx 透传 + 坏 JSON + 8MiB/20MiB 超限 + 网络异常 + 凭据不进文案）                                                                       |
| MC-9  | create-pet 集成           | 配置画图后 create-pet 流程经 generate_image 产出宠物图（浏览器验收或手工脚本）                                 | ☐ **未执行**（真机/浏览器验收未做；静态兼容性依据已记录：工具以真实 schema 注册满足技能发现条件，见 §11 批次三）——**待人工验收**                                                |
| MC-10 | 语音引擎切换              | 模型设置页切 ASR 引擎 → 下一次听写走新引擎；回退树（remote 失败→webSpeech）不回归                              | ✅ 单测面已过（voicePersonas / interruptCommandFlow / useVoiceAnnouncement.wiring / voiceComposerEntryState 全绿，回退树纯函数语义未动）；**真实听写/播报浏览器实测待人工**     |

测试落点：services 层档案/迁移/画图服务单测（drora 双显式清单）；CLI core 工具 handler 测试（`tests/`，vitest）；UI settings 组件测试；既有 `knowledgeJev*` 系列测试改数据源后保持全绿。

## 9. 分批实施计划

1. **批次 1（数据层）**：shared 契约 + services 档案服务（含迁移、订阅、channel）+ Jev 装配 / embedding 端口切换数据源（旧测试改造）。
2. **批次 2（UI 收敛）**：模型设置页「模型能力」分组五条目 + knowledge 分区删除 + voice 分区瘦身 + i18n/遥测/test-ids + 语音适配器改 hook。
3. **批次 3（画图链路）**：contracts schema + core 工具 + bootstrap 端口 + drora-protocol 方法 + Host 画图服务 + 错误语义。
4. **批次 4（收口）**：MC 全量勾验、typecheck/lint/architecture:check、双语复查、spec 状态更新。

## 10. 开放问题

| #    | 问题                                                                         | 处置                                                     |
| ---- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| OQ-1 | 画图 baseUrl 预设清单与默认建议（智谱 CogView-4-flash / OpenAI dall-e-3 等） | 实现批次 3 时与用户确认一次 datalist 内容                |
| OQ-2 | generate_image permission 粒度（每次确认 vs 首次确认 allowlist）             | 实现时对齐 WebFetch 现行形态，分歧再问                   |
| OQ-3 | 远程 embedding 端点（mode:"remote"）                                         | schema 预留、解析器 fail-closed，需求出现另立卡          |
| OQ-4 | provider apiKey 明文（provider_config.json）统一加密                         | 独立议题不进本次；档案侧已统一加密，作为未来对齐方向记录 |
| OQ-5 | stdio 反向 RPC 大载荷帧上限实测（8MiB base64）                               | 批次 3 实测，必要时降上限或分块                          |

> OQ 处置回写（2026-11-04）：OQ-1 按批次二实现为 OpenAI/智谱两组预设 datalist，未与用户二次确认内容；OQ-2 批次三落 WebFetch 同构形态、patternSources 用 toolName（见 §11 偏离 8）；OQ-5 真机实测未做，服务层已按 8MiB/20MiB 上限实现并有测试锁行为。

## 11. 实施记录（2026-11-04 收口）

四批次施工全部完成于 2026-11-04 同日。批次一/二/三逐批经合规审查均「通过」（mustFix 0 遗留）；独立评审八项实跑核验、mustFix 0、finding 7 条均无需修复处置。

### 11.1 批次概要

| 批次            | 范围（§9 计划对应）                                                                                                                                                                                                                                                                                                                                                                                                          | 规模         | 代表性验证（施工报告 + 审查复跑）                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 批次 1 数据层   | shared 契约 `modelCapabilities.ts`（purpose/档案 schema/凭据键/迁移映射单一出处）、services `model-capabilities` 模块（档案服务、一次性迁移、onDidChange 订阅、channel）、Jev 装配与 embedding 端口数据源切换、knowledgeJev 系列测试改造；合规两项 mustFix：标记落盘门控（markerPersisted）与凭据写成功才删旧键（saveCredentialOrWarn）                                                                                      | 30 文件      | MC 测试 2 文件 11 用例全过（含 3 条顺序不变式回归，chmod 0o500 真实构造标记落盘失败窗口）；全量 drora 537 文件 534 过（唯一失败 userActionTraceCatalog 系并行 persona 未提交工作，与本批无关） |
| 批次 2 UI 收敛  | 模型设置页「模型能力」第三分组（固定顺序不参与 dnd）五条目表单（全经 `useModelCapabilities` hook）、knowledge 分区整体删除（组件/注册/渲染分支/i18n 43×2 键/knowledge-jev shim 原子收尾）、voice 分区瘦身为纯行为偏好、AppSettings 14 键删除 + parity 单测、i18n 双语 80×2 新键、遥测 `settings.model_capabilities` 组 21 动作（§12 勘误：此前误记 22）、`TID_MODEL_CAPABILITY_*` 10 个、迁移源改造 readRawLegacyAppSettings | 约 70 文件   | 全量 drora 540 文件 4604 用例全过；fork-isolated 161 用例全过；i18n 双语键集 parity 差集为空；desktop e2e tsconfig tsc exit 0                                                                  |
| 批次 3 画图链路 | CLI contracts generate-image schema + 端口、core 工具 handler（shouldDefer、恒注入、artifact 落盘 + node_repl_images display 投影）、bootstrap 反向 RPC 端口（-32601 → ConfigurationError）、shared `modelCapability/generateImage` 方法 + schema、Host `imageGenerationService`（fail-closed、凭据零出 Host、OpenAI images 兼容出站）+ droraAgentService 分发 + node.ts 接线                                                | 30 文件      | core 8/8、bootstrap 5/5、services 11/11；回归 main-tool-pool 12/12、display/tool-search 70/70、分发相关 14/14；architecture:check 0 violations                                                 |
| 批次 4 收口     | MC 全量勾验（§8 状态列）、spec 状态行更新、本文实施记录、终局门禁复跑                                                                                                                                                                                                                                                                                                                                                        | 本 spec 文档 | 终局门禁见 11.2                                                                                                                                                                                |

### 11.2 终局门禁（2026-11-04，工作区含并行 persona 未提交改动）

| 门禁               | 结果      | 说明                                                                                                                                                                                       |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| typecheck          | ✅ exit 0 | 含 CLI bootstrap --noEmit；批次三期间曾被批次二 UI 中间态暂时挡，终局已复绿                                                                                                                |
| lint               | ✅ exit 0 | 0 errors；warnings 为既有基线                                                                                                                                                              |
| architecture:check | ✅ exit 0 | violations 0 / baseline 0 / new 0（新模块 services-model-capabilities、ui-model-capabilities 已 adopt 登记；4 个 CLI 新文件照 VaultSearch 先例例外登记）                                   |
| test:drora         | ✅ exit 0 | 540 清单文件全过（4604 用例）                                                                                                                                                              |
| fmt:check          | ❌ exit 1 | 工作区红基线（批次二盘点 85 文件失败、其中 61 个与本工作无关：persona 文档、zcode-cua、docs/voice-\* 等）；本工作侧 architecture-policy.yaml 因并行批次同文件追加未格式化，留统一 fmt 收口 |
| CLI typecheck      | ❌ exit 1 | turbo 2.9.14「Could not find turbo.json or turbo.jsonc」——与基线门禁完全一致（turbo.json 在 apps/drora-cli 在场且未修改）；CLI 真门禁以各包 build/tsc 为准，批次三分包全过                 |
| CLI build          | ❌ exit 1 | 同上 turbo 探测失败；contracts/core/bootstrap 各自 build(tsc) + tsc --noEmit 均 exit 0                                                                                                     |

### 11.3 与 spec 的偏离清单

1. **ApiKeyInput 未按 §5.1 原文改造**（批次二）：ApiKeyInput 是绑定 provider 表单状态机的纯受控输入，强加凭据键/保存语义会耦合 credentialService；改为新模块 `CapabilityFormParts.tsx` 复用其模式（password + 显隐）与 ApiKeyRow 语义（留空保存即删、存在性态、明文不回显），对既有 provider 表单零改动。
2. **迁移源改读原始 setting.json**（批次二，§3.3「实现口径」已回写）：schema 删 14 键后 `settingService.get()` 的 z.object 解析会 strip 旧键，迁移读不到旧值；新增 `readRawLegacyAppSettings` / `resolveAppSettingsFilePath` 导出（settingService 同一文件同一解析规则单一出处），经档案服务 deps 注入。
3. **旧键物理清理从「undefined 补丁」改「空补丁整写一次」**（批次二，§3.3 已回写）：patch schema 同样 strip 未知键；清理改为 `settingService.update({})` 写锁内重解析整写，旧键物理消失；删除仍以标记落盘成功为前提。
4. **旧凭据常量删除后旧键值降级为冻结字面量**（批次二）：`VOICE_VENDOR_CREDENTIAL_KEY` / `KNOWLEDGE_JEV_*` 三常量物理删除后，旧键值以 `MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS` 冻结字面量仅存于迁移表（单一出处）；批次一曾以 shim 过渡导出维持编译，批次二原子收尾。
5. **persona 云音色双存储**（批次二，§3.3 已回写）：物化写改为 appSettings 四行为键 + 档案 `tts.voice` 成对写（`buildVoicePersonaCapabilityPatch`），显示派生 `resolveVoicePersonaSelection` 双读。
6. **jevOff 横幅跳转目标**（批次二，§5.2 已记）：VaultView「去设置」改跳 modelProvider 分区而非 capability 深链（pending target 机制仅支持 coding plan id），`vault.ask.banner.jevOff.*` 文案未动。
7. **迁移删除顺序不变式强化**（批次一 mustFix，超出 §3.3 原句但符合意图）：标记落盘成功才清理旧 AppSettings/旧凭据键（markerPersisted 门控，落盘失败保留全部旧键、下次启动重迁移收敛同一档案值）；新凭据键写成功才删旧凭据键（decision-jev 三键逐一门控、voice 双写两腿都成功才删）；services 模块 CONTRACT.md 增「迁移顺序不变式」条目。
8. **generate_image permission patternSources 用 toolName**（批次三，OQ-2 处置）：形态逐字段对齐 WebFetch（needsApproval true / alwaysAllowPatternSources / denyPriority beforeAsk / riskLevel medium），唯 patternSources 用 toolName 而非 network——出站 baseUrl 是用户档案配置的固定端点、模型可控面只有 prompt 文本。
9. **恒注入无 include 门**（批次三，符合 §6.2 口径）：builtInTools 数组直入 + server-operations 恒注入端口，runtime-tools/impl/call-runner 全链接线；与 VaultSearch 的差异在 handlers/index.ts 注释说明。
10. **架构登记格式噪音**：architecture-policy.yaml 被 architecture:adopt 工具按自身 YAML 风格整文件重写（约 350 行括号空格重排），语义新增仅三处（services-model-capabilities 登记、services-drora-extensions requires、shared-contracts publicEntrypoints）；不手工回退格式噪音（同文件叠有并行 persona hunk，覆印风险），后续审读以语义三处为准。
11. **未做项**：MC-9 create-pet 真机/浏览器验收（未做，§8 已标待人工）；OQ-5 8MiB base64 stdio 帧真机实测（服务层已按 8MiB/20MiB 上限实现并有测试锁）；E2E voice-lifecycle 迁移新 TID 后仅 e2e tsconfig typecheck 通过，WebdriverIO 浏览器验收未执行（环境不可用）。
12. **既有问题（非本工作引入，未修）**：core 内 vaultSearchPort 传递链断裂（runtime-tools 传入 createToolExecutor，但 impl.ts 构造 deps 漏拷、call-runner 不读，VaultSearch context 恒 undefined），建议独立工单；CLI turbo typecheck/build 探测失败为基线问题（turbo.json 在场未改）。

### 11.4 逐批审查与独立评审结论

- **批次一：通过**。两项 mustFix 真实落地且逻辑闭环（markerPersisted 门控 + saveCredentialOrWarn 逐键/双腿门控，双重保险），3 条顺序不变式回归钉住；审查环境复跑 MC 测试 11 用例、knowledgeJev 系列 42 用例、architecture:check、oxlint、typecheck 全绿。
- **批次二：通过**。八项逐条实证：五条目字段符合 §5.1（七个 UI 文件全部仅经 hook）、knowledge 分区彻底删除（i18n 43×2 键 grep 实证）、voice 瘦身到位（旧凭据键引用清零、回退树语义未动）、14 键删除完整（parity 单测复跑通过、迁移源改造正确）、官方 provider 目录零改动、persona 未提交工作完好、i18n 双语 80+80 对等、测试全部复跑（全量 540 文件 4604 用例、fork-isolated 161/161）。如实说明：fmt:check 全仓红为既有基线、architecture-policy.yaml 留统一 fmt 收口；E2E 浏览器验收未执行。
- **批次三：通过**。七项逐条实证：链路形态严格符合 §6.1（凭据零出 Host）、shouldDefer + 恒注册全链接线完整、RPC 方法 + -32601 翻译、§6.3 全部落实（n:1、180s、b64 优先、≤20MiB url 下载、8MiB 上限、错误分类）、fail-closed 零出站、官方 provider 零改动、三层测试复跑全绿；分包替代验证全部复跑。如实报告：root typecheck 曾被批次二中间态挡、MC-2 迁移测试曾因批次二并行重构短暂红、MC-9 真机与 OQ-5 未做留批次四。
- **独立评审：mustFix 0，finding 7 条均无需修复处置**。八项实跑核验：上游零侵入（provider/provider-node/config 无匹配、被改文件无还原头）、契约键单一出处（新键字面量仅 shared/contracts/modelCapabilities.ts，生产/消费全走常量）、旧路径真死（14 旧键 + 旧凭据键字面量仅剩迁移表冻结值）、单一所有者（Host 唯一构造点单实例、文件锁内重读-合并-原子写）、fail-closed（三处零出站断言）、仓库规范（UI 全经 hook、无 console.\*、文件 IO 全异步、双语 8071=8071）、测试质量（MC-1..MC-8 断言真实，实跑 23 个相关测试文件 213 用例全绿）、spec 符合度（F-1..F-8 逐条无未声明偏离）。MC-9 属批次四收口项，如实说明未落地。

## 12. 审查修复记录（2026-11-04 第二轮，两波深审 + 对抗核查后实施）

背景：批次四收口后经两波独立深审（上游零侵入/spec 符合性/产品兑现 + 架构治理/规范安全/测试诚实性）与对抗核查轮，确认以下缺陷并当日修复。修复原则不变：官方 provider 体系零改动、模块化叠加。

| #             | 缺陷                                                                                                                                                                                                                                                                                                           | 修复                                                                                                                                                                                                                                                            | 拦截测试                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ND-1          | 桌面 renderer 的 `RemoteServiceAccess` 漏建 `IModelCapabilitiesService` 代理 getter——四齐一漏（Host 注册/accessor 声明/hook 消费齐，唯独代理缺），生产中五条目恒「不可用」、语音 asr/tts 档案消费恒缺省（组件测试因 mock hook 全绿）                                                                           | 构造器补 options 门控 getter（照 sourceServerManagementService 先例，远端 Host 不注册该 channel 故不裸加）+ `main.tsx` base 连接开启 + messageport options 透传                                                                                                 | `packages/client/test/remoteServiceAccess.test.ts`（3 用例：门控开建代理/缺省 undefined/先例不破）                                      |
| F-1           | `generate_image` 未登记 `DRORA_KNOWN_TOOL_NAMES` → identity unknown 落 fallback 卡，CLI 产出的 `node_repl_images` 展示载荷在消息流零消费（分享投影因按 display.kind 分流不受影响）                                                                                                                             | shared 登记工具名 + 新 `image-generation` family；UI 新增 `GenerateImageToolCallBlock`（复用 NodeReplImageGrid 渲染内联图、大图走路径文本）+ resolveRenderer 分支 + toolDisplay 策略 + i18n 双语                                                                | `apps/drora-cli/packages/core/tests/generate-image-tool-identity.test.ts`（builtInTools ⊂ known 表 parity，历史差集 28 名逐个具名豁免） |
| 取消不贯通    | 端口无 signal、requestClient 不传 options、handler 的 abortSignal 只接 artifact 写入——用户打断后 Host 计费出站跑满 180s                                                                                                                                                                                        | 端口接口加 `options.signal` → bootstrap 透传 `requestClient(..., { signal })` → handler 传 `context.abortSignal`；handler 测试断言 signal 透传                                                                                                                  | `generate-image-handler.test.ts` 更新（8/8）+ `generate-image-port.test.ts`（5/5）                                                      |
| F-2           | 权限弹窗对 generate_image 只显裸工具名（工具声明 `permission.reason` 运行时零消费、通用文案被过滤），用户批准出站计费操作无计费语境                                                                                                                                                                            | PermissionDialog 按工具名（normalizeDroraToolName 判定）补本地化出站/计费说明行 + 双语 i18n；**不动冻结的 display wire union**（新增 kind 会破坏旧客户端，tool-result-metadata 冻结警告明确 gate 事实走工具入参/UI 层）                                         | 既有 PermissionDialog 测试面 + 手工验收（弹窗形态待 GUI 验收一并）                                                                      |
| trim/逐键遥测 | 文本档行 onChange 直写：每击键一条遥测 trace + 一次全档案原子写/广播，且 save handler 的 trim 经快照回显回灌吞输入尾随空格                                                                                                                                                                                     | `CapabilityTextValueRow` 草稿化（与 baseUrl 行同形态）：本地草稿 + onBlur 提交（trim 只在提交时），五处调用方零改动                                                                                                                                             | `ModelCapabilityDetail.test.tsx` 更新（音色行断言改 blur 提交，20/20）                                                                  |
| F-5           | capability 无深链命名空间——jevOff 横幅等运行时入口只能跳模型设置分区级                                                                                                                                                                                                                                         | settingsNavigation intent 增 `modelCapabilityPurpose`（sessionStorage 键 + 事件 detail + 消费互斥语义：purpose 优先）；ModelProviderSection `applyModelProviderTarget` 认领 `capability:` 节点（非法 purpose 走 invalid 提示）；jevOff 横幅直达「知识评分」条目 | `packages/ui/test/settingsCapabilityDeepLink.test.ts`（3 用例：往返/互斥/供应商回归）                                                   |
| 清理          | legacyMigration 旧凭据删除失败完全静默；V4ComposerVoiceEntry.test mock 携带已删旧键未 mock useModelCapabilities；契约注释块重复；「八键」注释 ×5 未随 9 键同步；死导出 5 处（ModelCapabilitiesLegacySettingsKey/ModelCapabilityDetailEntryProps/CLI 三类型别名等）；生产方硬编码分组 id 绕过 NAV_GROUP_ID 常量 | 逐项修复（详见各文件 §12 注释）；contract.example.ts 为架构治理强制四件套工件**不删**（对抗核查推翻「死文件」误判）                                                                                                                                             | V4ComposerVoiceEntry 10/10；全量验证见下                                                                                                |

修复后验证（2026-11-04）：全仓 typecheck exit 0；UI 侧定向测试（模型能力 20/20、深链 3/3、V4 语音 10/10、client 代理 3/3）；CLI core parity 2/2 + handler 8/8 + bootstrap 端口 5/5。全量门禁见本轮工作记录。

登记为后续项（不属本轮缺陷）：

- **Host 侧取消协议扩展**：CLI 侧 signal 已终止 pending RPC，但 Host 出站 fetch 仍跑满 180s（计费面）——需 drora-protocol 取消通知（照 providerRuntimeHeadersCancelled 先例）从 Host 侧 abort 出站，另立工单。
- **jevAssembly 共享 credentialService 注入**：文档化有意缺省（功能等价、实例无缓存），后续装配优化时注入。
- **上游共享触点登记**：`settings/model-provider-section` 的本役加法与等价改写按 ledger 5 先例登记 `specs/drora-divergence-ledger.md` 台账 13。
- vaultSearchPort 传递链断裂（既有、非本役）：独立工单。

## 13. 供应商引用式重构（2026-11-05 定稿，用户裁定「可以」后实施）

### 13.1 背景与裁定

用户两轮追问确立的方向：**key 单点存储**——同供应商的 apiKey 不应在能力档案里录第二遍，直接复用官方模型管理（provider 体系）已保存的连接信息。2026-11-05 复核推翻了首轮「暂不做」裁定所依据的两笔账：

1. 「key 明文是安全降级」不成立——聊天 key 本就明文于 `provider_config.json`（官方设计，provider-bundled-persistence），能力 key 跟随走明文是**全仓一致**而非降级；加密是含聊天 key 的全仓独立议题。
2. 「等上游出官方多模态管理」是拖延——key 落在官方体系内，将来上游出任何新设计只需迁移路由表，key 一动不动，比现状（key 双存储）**更好迁移**。

### 13.2 目标形态（供应商即唯一连接层，能力即路由表）

```
官方模型管理（零 schema 改动，用官方自定义供应商现成能力）
  供应商卡 = baseUrl + apiKey（聊天/画图/语音共用，key 只此一份）
                    ▲ 出站时实时读取（provider facade 公开入口 / renderer 经 RPC 代理）
模型能力档案（自研 schema 改形）
  条目 = providerRef（指向 providerId）+ modelId + 可选 baseUrl 覆盖
  不再自含任何 apiKey 字段
```

### 13.3 范围裁定

| 能力                                                          | 处置                    |
| ------------------------------------------------------------- | ----------------------- |
| image-generation / asr / tts（标准端点形状）                  | **改引用式**            |
| decision-jev（System One 专用线协议，按 providerKind 分三键） | 维持自含现状（§3 原案） |
| embedding（本地 ONNX 资产，无端点无 key）                     | 不适用，不动            |

### 13.4 迁移与表单裁定（用户已确认）

- **存量迁移**：按条目 baseUrl 在官方模型管理**自动建自定义供应商卡**（无感迁移；卡名取条目用途，key 从旧凭据键导入），条目转 providerRef 后删旧键。
- **表单形态**：只给「选供应商」下拉 + 「去新建供应商」跳转，**不保留**手填 baseUrl/key 兜底形态（单形态，避免解析双分支）；仅留可选 baseUrl 覆盖（网关分域名边缘）。
- baseUrl 覆盖与 providerRef 的键值并存规则：**手填覆盖优先，留空继承供应商卡**。

### 13.5 改动面清单（实施依据）

1. 契约 `modelCapabilities.ts`：三条目改形（providerRef/modelId/baseUrlOverride），删自含 apiKey 语义与 asr/tts/image-generation 三凭据键定义；Jev 三键保留。
2. 解析层 `model-capabilities/`：连接信息经 providerSettingsFacade 公开入口读；供应商被删/无 key → 现行 fail-closed（not_configured）语义不变；迁移器：读旧键 → 自动建卡 → 条目转 providerRef → 删旧键（幂等标记沿用）。
3. Host 消费：imageGenerationService、node.ts 装配。
4. Renderer 消费：useVoiceComposerEntry/useVoiceAnnouncement 经 providerSettingsService RPC 代理读供应商连接（ND-1 修复已验证链路）；回退树不变。
5. UI：三表单改「供应商下拉 + modelId（+可选覆盖）」；供应商卡 detail 底部反向关联纯展示；i18n/遥测/test-ids 同规格补齐。
6. 注意点：聊天选择器会出现无模型的能力专用卡（空列表自然不误导）；供应商卡随 provisioning 面同步远端（对远端语音有利，key envelope 实现时核对 allowlist）。

### 13.6 实施记录（2026-11-05 当日完成）

- 契约：schemaVersion 1→2（三条目 providerRef/modelId/baseUrlOverride + migratedToProviderRef 标记）；凭据键收缩至 decision-jev；旧自含键冻结入迁移表 `MODEL_CAPABILITIES_LEGACY_CREDENTIAL_KEYS.selfContained`。
- 解析层：读取层 upgradeV1FileToV2（v1 自含 baseUrl 保底进 override 作迁移线索）；providerRefMigration（按 override+旧键自动建卡回填，标记落盘成功才删键）；createProviderCard 走 late-bind（Host 构造时序：档案服务先于 providerRuntime，attachProviderCardCreator 回填）。
- Host：imageGenerationService 依赖改 resolveProviderConnection（node.ts 经 providerSettingsFacade.getView 按 providerId 取卡，access api-key 判型）；§13 建卡器 createPersonalProvider+overlay（group:custom/api-key/openai-chat-completions）。
- Renderer：useVoiceComposerEntry/useVoiceAnnouncement 经 providerSettingsService.getView 解析（连接态 vendorConnection/cloudApiKeyRef 三态保留：未加载→system 首句、确认缺失→持续 system、已解析→cloud；回退树与连败回落零变化）；引擎签名 baseUrl 分量替换为 providerRef+override。
- UI：CapabilityProviderRefRow（下拉）+ useCapabilityProviderOptions（enabled 且 baseUrl+api-key 完整的卡）；三表单改「供应商+模型（+音色/覆盖）」，ApiKey 行删除；图像配置行不门控开关（v1 行为一致）；TID_MODEL_CAPABILITY_PROVIDER_SELECT 新增；i18n 双语 +10 键。
- 测试：services 三文件 §13 化（凭据断言→decision-jev 分键/自含冻结键；画图 mock credentialService→resolveProviderConnection）；wiring 18/18（providerConnectionControls 控制柄 get/set/hold/reset，门闩 connectionGate 承载 pending 三态）；表单 20/20（供应商 mock providers:[]）；override 行 testid 沿用原 base-url-input id（E2E 兼容）。
- 门禁终态：typecheck=0 / architecture=0 violations / lint=0 / test:drora 1874 过 7 跳 / 表单+catalog+i18n 34 绿。
