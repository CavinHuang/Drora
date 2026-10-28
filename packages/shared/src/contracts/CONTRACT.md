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

与其它模块的交集：

- shared（根 barrel）：src/index.ts re-export 本模块 desktopPet.ts / voice.ts；
- shared（drora-protocol-v4）：input-intent.ts 引用 VOICE_INPUT_SOURCE_KIND；
- voice（ui）：VOICE_BROADCAST_CLAIM_KEY.announcement 为播报 claim 键。
