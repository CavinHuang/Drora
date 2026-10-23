# agents-team-skill-gate

agents-team 技能的灰度门（specs/agents-team.md §17 契约 1）：bundled agents-team 技能教模型
调用 TeamSpawn 等团队工具，工具由 hub 装配注册并受同一道灰度门控制。门关时若技能仍可发现，
模型会拿到「调 TeamSpawn」的说明书却没有工具，只能即兴扮演团队（session_76d145bb 实证）。
本模块在 skillPort 组装处（bootstrap skills.ts，单一咽喉点）把发现与加载双侧一并关死——
「教工具的技能与工具同生共死」。

## 对外契约

- `filterAgentsTeamSkillOutcome(outcome, enabled)`：门关时从发现结果剔除 bundled 来源的
  agents-team（`totalDiscovered` 保持全集口径，剔除是呈现层过滤）；只按
  `source === "bundled"` 且名字匹配，用户/项目/插件同名技能不误伤。门开时原样返回同一引用。
- `gateAgentsTeamSkillPort(port, enabled)`：门关时包装端口——发现走过滤；加载委托底层解析后
  核验来源，仅当解析结果确为 bundled 来源的 agents-team 时以「Skill not found」稳定拒绝
  （不能按请求名直接拒绝：loadSkill 只带名字，同名用户技能经发现顺序优先接位）。门开时
  原样返回同一端口，零包装开销。

## 裁决来源

调用方（bootstrap skills.ts）以与 create-app.ts 同一函数裁决：
`resolveAgentsTeamEnabled(fileConfig agentsTeam.enabled ?? env DRORA_AGENTS_TEAM=1)`。
本模块不读配置——enabled 由调用方传入，保持纯函数可测。
