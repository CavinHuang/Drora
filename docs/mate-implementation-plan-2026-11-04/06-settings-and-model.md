# 06 · 设置中心与模型选择（2026-11-06 批）

## 0. 背景与范围

运行链可用性审查（05 报告 §6 遗留「Source 配置写入口」等）确认：budget/信任门阈值/watchdog 间隔/Source 配置/身份映射五类参数生产无写入口（kv 手改），且手改后 Source 启停需等下一次快照推送；模型无选择能力（Router 与 Mode A/B worker 全走 CLI 缺省模型）。本批交付：

1. **设置中心**：上述五类参数全部收进 MateConfigSection（大副设置页），经服务统一写入口（channel 可见 setter）落 kv——单一写者纪律不变（服务仍是唯一生产写者）。
2. **模型选择**：大副模型偏好（providerId+modelId+可选 reasoningLevel），作用于 Router 大副会话与 Mode A/B 新建 worker 会话（v4 createSession `config.modelSelection` 原生字段）；Mode C 附着既有会话不动其模型；清除=回落 CLI 缺省。

## 1. 契约与键（单出处）

- `ASSISTANT_KV_KEYS` 扩展：`trustGateMinRate: "trust_gate_min_rate"`（已有读点，本批补写入口）、`trustGateMinSamples: "trust_gate_min_samples"`、`watchdogIntervalMs: "watchdog_interval_ms"`、`modelPreference: "model_preference"`（值=modelSelectionSchema JSON；空串=已清除）。
- `ASSISTANT_SOURCE_KV_KEYS`（source_config/source_identity_map）不变——写入口从「装配层手改」改为服务 setter。
- contracts 新增 `ASSISTANT_CONFIG_LIMITS`（bounds 单出处，服务校验与 UI 输入同源）：
  - budget 1–10；trustGateMinRate 0.5–1；trustGateMinSamples 5–100；watchdogInterval 5–1440 分钟（服务内换算 ms 落 kv，读侧 watchdog 不变）；identityMap ≤50 条。

## 2. 服务接口（channel 面，configActions.ts 拆分件）

`setBudget({maxActivePerWorkspace})` / `setTrustGateThresholds({minRate?, minSamples?})` / `setWatchdogIntervalMinutes({minutes})` / `setSourcesConfig(MateSourcesConfig)` / `setSourceIdentityMap(Record) / `setModelPreference(ModelSelection | null)`。

统一纪律：入参 bounds/结构 fail-closed 校验（越界/坏结构 → `validationFailed`，不猜测收敛）；kv 事务写 + `publish()`——**publish 即触发 sourceRegistry reconcile（F3 顺修：配置改动即时生效，不再等下一次推送）**；返回 `AssistantResult`。

校验细则：github `enabled=true` 时 `repo` 须匹配 `owner/repo` 且 `mentionName` 非空；identityMap 键值 trim 非空、≤50 条；modelPreference 过 `modelSelectionSchema.safeParse`。

## 3. 快照投影（AssistantConfigView 扩展）

`trustGateThresholds {minRate,minSamples}` / `watchdogIntervalMinutes` / `modelPreference | null` / `sourcesConfig` / `identityMap`（界 50 条）。读侧坏值逐键回落缺省（readAssistantConfig 纪律不变）。

## 4. 模型接线（node.ts）

- `assistantCreateRouterSession` 与 dispatch port（Mode A/B）的 createSession envelope `payload.config` 增 `modelSelection`（读 `model_preference` kv，缺省不带字段=现行为）。
- **不热切已存在会话的模型**：偏好变更对下一次建会话生效（Router 轮转/换代、新工单派发）；已运行会话维持原模型——诚实边界，不做在途 setModel（避免对运行中会话引入第二条模型写路径）。

## 5. UI（MateConfigSection 分区扩展）

- **模型区**（新组件 `MateModelPreference.tsx`）：复用 workflow 子代理模型选择的同一清单构建（`useModelSelectionView`+`buildRegistryModelSelectGroups`+`encodeCustomModelValue`——「两处选同一件事就该是同一份清单」先例）；清除入口；当前偏好缺席显示「CLI 缺省」。
- **高级区**：软预算/信任门两阈值/watchdog 间隔四个数字输入（draft-dirty 纪律照配额先例，同源 bounds 校验）。
- **Source 区**（新组件 `MateSourceSettings.tsx`）：三开关 + GitHub repo/mentionName 输入 + 身份映射行编辑（增删行）；GitHub PAT 仍走 credentialService（凭据不进 kv/UI，注记指引）。
- i18n 双语全量；tab 上下文 `workspaceKey` 透传（模型清单 resolution 用）。

## 6. 验收

- 服务：configActions 单测（bounds 矩阵/坏结构/github 联动校验/identityMap 上限/modelPreference zod/publish 触发/kv 落值/投影回落）。
- UI：mateStore 动作单测 + i18n 守卫键；浏览器验收资产 MSA13（设置面写入闭环：模型偏好+Source 开关+阈值→快照回显；fixture service 扩 setters）。
- 门禁：typecheck/lint/architecture:check/fork-isolated/drora 定向 + verify:pre-push。

## 7. 登记与边界

- spec §11/§14 同步修订；两份 CONTRACT.md 登记新接口面；coverage matrix 登记 MSA13。
- 不做：手机/Web 端设置面（面板本体桌面限定不变）；`/mate` 直达；Source 凭据 UI（PAT 管理属 credentialService 域）；auto/off 切换语义（auto 单向不可逆是 spec §6 设计）。
