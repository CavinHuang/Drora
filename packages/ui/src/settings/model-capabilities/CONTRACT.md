# ui-model-capabilities

模型能力档案的设置表单模块（specs/model-capabilities.md §5「UI 信息架构」）。
模型设置页（ModelProviderSection）左导航第三分组「模型能力」的五个条目表单：
知识评分（decision-jev）/ 语义嵌入（embedding）/ 语音识别（asr）/ 语音合成（tts）/
图像生成（image-generation）。

## 契约

- **唯一数据源**：`packages/ui/src/hooks/useModelCapabilities.ts`（档案服务
  `ModelCapabilitiesService` 的唯一 UI 读路径：读快照 + onDidChange 订阅 + update
  唯一写路径）。本模块不读 AppSettings 旧键、不直写档案文件、不建第二状态源。
- **入口**：
  - `ModelCapabilityDetail({ purpose })`——model-provider-section `Detail.tsx` 选中
    `capability:*` 节点时渲染；按 purpose 分派五个条目表单。
  - `capabilityNav.ts`——`useModelProviderNavigation` 构造 capabilities 分组消费的
    静态目录（节点 key、i18n 键、固定顺序 = shared `MODEL_CAPABILITY_PURPOSES`）。
- **服务边界**：档案服务只在 desktop 本地 Host 注册；服务缺席（远端 workspace
  ServiceProvider 等）时详情呈现不可用态（fail-closed），不降级读写 AppSettings。
- **凭据**：apiKey 只经档案服务 `update` 的 credentials 面（留空保存即删除，明文
  不回显；存在性态经 credentialService.load 只读探测）。
- **Host 面**：embedding 状态面/下载与 Jev 连接测试沿用 `knowledgeIndexService`
  既有 RPC（getSemanticStatus/downloadSemanticModel/testJevConnection/
  refreshDecisionConfig），语义与轮询节奏不变（§5.1）。
- **层**：app（UI 表单编排；依赖 ui 组件基座/shared 契约/services 接口类型）。

## 不在本模块

- 档案服务实现与迁移（services-model-capabilities 模块，批次一）。
- generate_image 工具链路（批次三；本模块只落图像生成档案配置面）。
- 语音行为偏好（VoiceSection 瘦身后保留；模型/端点/凭据配置才进本模块，spec §0）。
