# shared-contracts

一页以内。只写类型与测试表达不了的三样：模块存在的意图、不变量、与其它模块的交集在哪个 hook 点处理。

意图：跨进程/跨包契约字面量的单一出处（AGENTS.md「契约键单一出处」）；生产方与消费方
引用同一常量，禁止两处独立写字面量。

不变量：

- 改名任何键前先全链 grep 生产与消费（AGENTS.md）；wire 面 schema（如 input-intent 的
  kind literal）以 z.literal(常量) 引用，不允许重复字面量。
- 行为阈值、打断词表等 renderer 行为参数不进本模块（spec §2.1 冻结边界，归 ui/voice）。
- VOICE_SETTINGS_KEYS 八键与 validationAppSettings schema 字段名的 parity 由单测钉住
  （contract.test.ts：persisted/patch 两 schema 字段名集合 === 值集合 + §6.1 默认值抽查）。
- persona.ts（specs/drora-persona-system.md §4；数据合同 §1/§2/§3）：管理错误码封闭枚举、
  receipt scope/resultCode 词汇、库位置键（可信 getCliStorageRoot 下 personas/persona.sqlite）、
  schema/template/compiler 版本常量与 P0 逻辑管理 API 输入输出严格类型只在此定义；
  personaControlV1/personaEnabled 能力位与 persona/* wire 方法名在切片 C 随协议注册时
  与生产消费两侧一起进本模块（合同 §4.1），不提前发明尚无生产方的键。

与其它模块的交集：

- shared（根 barrel）：src/index.ts re-export 本模块 desktopPet.ts / voice.ts / persona.ts；
- shared（drora-protocol-v4）：input-intent.ts 引用 VOICE_INPUT_SOURCE_KIND；
- voice（ui）：VOICE_BROADCAST_CLAIM_KEY.announcement 为播报 claim 键；
- persona（cli，切片 B）：PersonaAppService 与 adapters 独立库仓储引用 persona.ts 常量与
  类型；cli-persona-domain 的 PersonaCore 与 PersonaEditableCore 的结构对齐由服务侧
  parity 断言钉住。
