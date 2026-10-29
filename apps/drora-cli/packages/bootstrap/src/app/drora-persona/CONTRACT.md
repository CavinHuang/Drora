# cli-persona-service

Persona 独立资料域的服务层与进程组合（specs/drora-persona-system.md §4「bootstrap/app/
drora-persona：惰性服务组合、捕获/取消/预算/降级」）。实现数据合同
docs/design/drora-persona-data-contracts-2026-10-29.md §3 的 P0 管理方法
（getPersonaOverview / initializePersona / getPersonaCore / updatePersonaCore /
resetPersonaCore / previewPersona＋内部 captureContribution），是独立库
（cli-persona-store）的唯一预期消费方。

## 所有权与边界

- PersonaAppService 是 authority/personaId/核心 revision 的服务 owner；设置草稿、执行
  许可 E（原 Settings）、会话轮内贡献（原 Runtime turn state）分属各自 owner，本模块不复制。
- 库路径只能由装配层从可信存储根解析（`resolvePersonaDatabasePath(getCliStorageRoot(...))`，
  字面量出处 shared `PERSONA_STORAGE_KEYS`）；不接受 project config `storage.dir` 或 cwd。
- 构造与绑定零 IO：首个显式管理调用才打开库（打开即迁移）；`getPersonaOverview` 未初始化
  时如实返回 `uninitialized`，不暗建会话/身份（PM19）。
- P0b 无执行许可 E（spec §5，切片 C 注册）：`captureContribution` 一律快速
  `omitted(permission_not_granted)`，不读库、不起 worker；signal 已取消返回 `cancelled`，
  不把 cancelled 伪装成 omitted。端口经 `AgentRuntimeDeps.personaCapturePort` 注入，
  注册不阻塞 runtime ready。

## 不变量

- 管理方法只以 `PersonaManagementResult` 值返回 shared `PERSONA_ERROR_CODES` 封闭枚举；
  环境级 `PersonaStoreError` 按 code 映射；未知异常归类 `storage_unavailable`。
  不抛裸字符串，不吞原 session/provider/权限错误（那些不经本服务）。
- 幂等：`requestDigest` 只由规范请求内容（op＋expectedRevision＋patch/reset 标记）决定；
  同 mutationId 同摘要回放先前终态，同 ID 异摘要 `mutation_conflict`；
  `expectedRevision` CAS 失败 `revision_conflict` 不写凭据；无内容变化 `unchanged`
  不新增 revision（PM06/53）。
- `previewPersona` 零副作用：不触碰存储端口、不请求模型、同输入同输出（PM20/47）。
  v1 情境词汇为空：任何显式 `situationId` 报 `validation_failed`，不发明假情境。
- 字段校验（未知键/NFC/trim/控制字符/code point 上限）由 cli-persona-domain 的
  `validatePersonaCoreFields` 归一化后落库；超限 `validation_failed`，不截断静默保存。
- 产品模板（`product-template.ts`）是随发行冻结的只读资产：版本字面量唯一出处
  shared `PERSONA_TEMPLATE_VERSION`/`PERSONA_COMPILER_VERSION`；模板超限是构建期错误
  （tests/persona 钉住最坏组合），运行期不截断、不静默换模板。
- 进程级单例（`getOrCreateDroraPersonaSystem`）：首个可信根绑定生效，不同根重绑定只告警；
  同根多进程共享靠库事务/CAS，不靠内存锁。schema_incompatible 打开失败是进程内终态，
  只停扩展，不降级写旧 schema。

## 交集 hook 点

- Runtime：`AgentRuntimeDeps.personaCapturePort`（core 既接缝）；资格表在
  cli-persona-domain，编排在 turn-loop，本模块只提供端口实现。
- 存储：`openPersonaStore`（cli-persona-store 契约端口），经 `openStore` 选项注入，
  测试可替换；生产不得绕过其迁移/事务语义。
- 协议/UI：P0 不注册 wire 方法与设置 UI（切片 C）；本模块现无 Host/协议消费方。
