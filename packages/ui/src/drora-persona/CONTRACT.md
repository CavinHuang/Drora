# ui-drora-persona

Drora 人格（Persona P0）设置分区：身份五字段受控编辑、确定性预览、应用情况查询与执行许可 E 开关。

设计基线：`specs/drora-persona-system.md` §5/§10 与 `docs/design/drora-persona-data-contracts-2026-10-29.md` §1.1/§2/§3。

## 边界

- 入口由 SettingsPage 按 `hello.capabilities.personaControlV1`（`usePersonaControlAvailability`）+ 本地桌面连接门控；手机远控 / 独立 Web / 旧 Host 不出现入口。该位只表示 Host 注册了管理路由，进入分区后仍以 `getPersonaOverview` 确认目标本地 CLI 支持与服务状态。
- 「已保存」（服务 coreRevision）、「已应用/已省略」（`getPersonaApplication` 对指定会话/轮的运行时事实，重启即 not_available）、「不可用」（旧 CLI/存储故障）是三件事；本模块不互相冒充、不伪造冷历史。
- 草稿是 UI 局部状态；CAS `revision_conflict` 保留草稿并给出「已保存 vs 草稿」比较，不静默 last-write-wins；跨窗口以服务 revision 为权威，focus/显式刷新重读。
- E 开关经原 Settings 保存通道（AppSettings.personaEnabled），文案必须说明「用于新建或真正重新加载的会话」并附隐私说明；只打开页面不初始化、不启用执行/学习。
- 无会话管理：管理方法经本机 Host 的 CLI 控制连接代理；不调用 session/create、不生成占位会话、不绑定远程 workspace。应用情况查询只面向本地 workspace（远程目标由 SettingsPage 置空）。
- 只开放五个受控字段（displayName/selfDescription/warmth/directness/humor）；不提供任意 system prompt 编辑。previewPersona 为本地确定性编译，零模型请求、零存储访问。
