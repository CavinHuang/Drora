# ui-drora-persona

Drora 人格（Persona P0 + P1a + P1b 学习管理）设置分区：身份五字段受控编辑、确定性预览、应用情况查询、执行许可 E 开关、P1a 交流默认（四键显式保存/忘记、U 使用许可、只读 JSON 导出），以及 P1b 有限学习管理（L 开关、来源状态列表、争议提示、解除抑制）。

设计基线：`specs/drora-persona-system.md` §5/§8/§9/§10 与 `docs/design/drora-persona-data-contracts-2026-10-29.md` §1.1/§1.2/§2/§3/§4.2/§6/§7/§8。

## 边界

- 入口由 SettingsPage 按 `hello.capabilities.personaControlV1`（`usePersonaControlAvailability`）+ 本地桌面连接门控；手机远控 / 独立 Web / 旧 Host 不出现入口。该位只表示 Host 注册了管理路由，进入分区后仍以 `getPersonaOverview` 确认目标本地 CLI 支持与服务状态。
- 「已保存」（服务 coreRevision）、「已应用/已省略」（`getPersonaApplication` 对指定会话/轮的运行时事实，重启即 not_available）、「不可用」（旧 CLI/存储故障）是三件事；本模块不互相冒充、不伪造冷历史。
- 草稿是 UI 局部状态；CAS `revision_conflict` 保留草稿并给出「已保存 vs 草稿」比较，不静默 last-write-wins；跨窗口以服务 revision 为权威，focus/显式刷新重读。
- E 开关经原 Settings 保存通道（AppSettings.personaEnabled），文案必须说明「用于新建或真正重新加载的会话」并附隐私说明；只打开页面不初始化、不启用执行/学习。
- 无会话管理：管理方法经本机 Host 的 CLI 控制连接代理；不调用 session/create、不生成占位会话、不绑定远程 workspace。应用情况查询只面向本地 workspace（远程目标由 SettingsPage 置空）。
- 只开放五个受控字段（displayName/selfDescription/warmth/directness/humor）；不提供任意 system prompt 编辑。previewPersona 为本地确定性编译，零模型请求、零存储访问。
- P1a 交流默认（PersonaPreferencesSection/usePersonaPreferences）：四键各自独立保存/忘记，CAS `revision_conflict` 保留草稿并重读比较，`outcome_unknown` 保留同一 mutationId 幂等回放（PM53）；忘记是逻辑撤销，确认文案写明清除范围（应用内该键的值与候选），不承诺介质擦除、不声称删除聊天记录/项目记忆/诊断。
- U/L 使用策略：当前值经 `getPersonaLearningOverview` 读侧展示（服务权威；读取失败按「当前生效值未知」降级，不发明数值）；两态按钮各自显式提交 setPersonalPolicy，开启 L＝`usePreferences:true + autoLearn:true` 一次提交（学习前置＝U&&L），关闭 L 保持概览观察到的 U 值（概览缺席时禁用，不猜测发请求）；关闭 U 经级联确认对话框（同事务关 L、撤租约、清未提交候选/负载——合同 §4.2；重开 U 不恢复 L）；冲突后重新预读概览的 policyRevision 并由用户显式重试。
- P1b 来源状态（PersonaSourceStatus）：来源类别（settings/extraction）、认识状态（explicit/inferred）、争议（disputed）、抑制（autoSuppressed）与待确认候选是分立事实，分行/分徽标如实展示，不合并成综合状态。争议只提示经保存/忘记解决（合同 §8），不提供「解除争议」按钮；抑制经 `allowLearningForKey` 解除（CAS 携带该键当前 keyGeneration；generation++ 只接受之后的新机会）。学习只覆盖四类交流默认：无虚构经历页；预算上界引用 shared `PERSONA_LEARNING_BUDGET`，进程内计数如实标注「本进程」。
- 导出（preparePersonaExport → IPlatformService.saveFile）是只读快照：uninitialized 显示「尚无资料」且不为导出初始化；取消/失败如实提示，只有 saveFile success 才显示已保存；不自动重试、不上传。
