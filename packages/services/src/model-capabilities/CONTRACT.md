# services-model-capabilities

一页以内。只写类型与测试表达不了的三样：模块存在的意图、不变量、与其它模块的交集在哪个 hook 点处理。

意图：模型能力档案 `~/.drora/v2/model_capabilities.json`（specs/model-capabilities.md §3/§4）的唯一所有者。五类
能力端点/开关（decision-jev、embedding、asr、tts、image-generation）收敛到单文件；apiKey 一律走
`ICredentialService`（加密），绝不进档案文件、不进 onDidChange 载荷、不进日志。

不变量：

- 契约单一出处：文件名、purpose 枚举、凭据键、档案 zod schema、旧键迁移映射只在
  `@drora/shared` 的 `contracts/modelCapabilities.ts` 定义；本模块与消费方（Jev 装配、
  embedding 端口、语音适配器、UI 表单）引用同一常量。
- 写路径唯一：只有 `update(patch)`（文件锁内重读-合并-zod 校验-原子写盘 → 凭据写删 →
  onDidChange 广播）。多窗口 Host 并发 update 经共享文件锁不丢字段；凭据写失败向上抛
  （档案已生效 + 旧凭据 = fail-closed 不出站，调用方可重试）。
- 读 fail-closed：文件缺失 = 全默认；坏 JSON/坏 schema（含未来 schemaVersion 与预留
  embedding mode:"remote"）按内容确定性备份（`*.corrupt-<hash>.bak`）后降级全默认，
  绝不因档案损坏阻断初始化。
- 迁移一次性（spec §3.3）：首次 get 触发 AppSettings 14 旧键 + 旧凭据 5 键 → 档案 + 新
  凭据键（voice 单键双写 asr+tts 同值）；`migratedFromLegacySettings: true` 幂等标记；
  旧设置键删除必须 Host 进程内直调 settingService（RPC patch 吞 undefined 删不掉键）；
  逐字段解析异常按「旧值缺失」处理，不阻断。
- 迁移顺序不变式（合规修复 2026-11-04）：**幂等标记落盘成功后才清理旧设置键**（两文件
  可独立失败，落盘失败时保留全部旧键，下次启动重迁移收敛到同一档案值）；**新凭据键写
  成功才删对应旧凭据键**（voice 双写两腿都成功才删旧键）——任一写失败保留旧源幂等重试，
  杜绝半迁移状态丢配置/丢 API key。
- 生效语义归消费方：Jev 装配与 embedding 端口经 `assembleDroraKnowledgeHost` 的动态源
  每 stage/refresh 重读快照（签名清缓存、refreshDecisionConfig 热路径不变）；本模块
  只广播事实，不主动通知任何消费方刷新。

与其它模块的交集：

- services（node.ts）：`createLocalServices` 接收并注册 `IModelCapabilitiesService`
  （通道 `model-capabilities`；desktop 本地 Host 唯一装配，未注入不注册）。
- services（drora-extensions/knowledgeHost.ts）：Jev configSource 与 knowledgeSemanticSource
  从 settingService 切到本服务快照（specs/model-capabilities.md §9 批次一）。
- shared（contracts/modelCapabilities.ts）：schema/常量所有权的另一半；`knowledge-jev.ts`
  是批次一兼容 shim，批次二删除。
- UI（批次二落地）：`useModelCapabilities` hook 经通道读快照/写 update；语音适配器数据源
  从 useSettings 切本服务。跨窗口写由「get 每次重读盘」兜底，onDidChange 仅覆盖本 Host
  内变更。
