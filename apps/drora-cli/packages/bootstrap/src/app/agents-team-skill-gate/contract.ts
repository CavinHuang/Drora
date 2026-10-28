import { AGENTS_TEAM_SKILL_NAME, type SkillLoadOutcome, type SkillPort } from "@drora/contracts";

/**
 * agents-team 技能的灰度门（specs/agents-team.md §17 契约 1）。
 *
 * bundled agents-team 技能教模型调用 TeamSpawn/TeamSendMessage 等团队工具，而这些工具
 * 由 hub 装配注册、受同一道灰度门（resolveAgentsTeamEnabled）控制。门关时若技能仍可发现，
 * 模型会拿到「调 TeamSpawn」的说明书却没有工具，只能即兴扮演团队（session_76d145bb 实证：
 * AskUserQuestion 假审批 + 谎称建队）。skillPort 有两个装配面，都要包门——bootstrap
 * skills.ts 覆盖 CLI/目录清单面（skills list/inspect、引用目录、草稿态 $ 目录），
 * create-app.ts 覆盖模型会话内的运行时端口（discoverSkillsForContext/loadSkill）；
 * 两处共用本契约，裁决单一出处 resolveAgentsTeamEnabled——「教工具的技能与工具同生
 * 共死」（bundled-skills.ts 头注原则）的灰度化。
 *
 * 只按 `source === "bundled"` 且名字匹配剔除：用户/项目/插件里的同名技能不误伤
 * （照 visualize-skill-gate 的纪律）。
 */
export function filterAgentsTeamSkillOutcome(
  outcome: SkillLoadOutcome,
  enabled: boolean,
): SkillLoadOutcome {
  if (enabled) {
    return outcome;
  }
  return {
    diagnostics: outcome.diagnostics,
    skills: outcome.skills.filter(
      (skill) => !(skill.source === "bundled" && skill.name === AGENTS_TEAM_SKILL_NAME),
    ),
    totalDiscovered: outcome.totalDiscovered,
  };
}

/**
 * 包一层 skillPort：门关时发现列表剔除 agents-team；加载委托底层解析后核验来源——
 * 仅当解析结果确为 bundled 来源的 agents-team 时以「Skill not found」稳定拒绝（措辞与
 * inspectDroraSkill 对缺失技能一致）。不能按请求名直接拒绝：loadSkill 只带名字，同名
 * 用户/项目/插件技能会经发现顺序优先接位，按名拦会误伤（§17 契约 1 的「不误伤」）。
 * 门开时原样返回，零包装开销。泛型 + spread 保住具体端口类型（NodeSkillAdapter 的
 * 额外成员），调用方（skills.ts 目录面、create-app.ts 运行时面）拿回的适配器不被降型。
 */
export function gateAgentsTeamSkillPort<T extends SkillPort>(port: T, enabled: boolean): T {
  if (enabled) {
    return port;
  }
  return {
    ...port,
    discoverSkills: async (request, options) =>
      filterAgentsTeamSkillOutcome(await port.discoverSkills(request, options), enabled),
    loadSkill: async (request, options) => {
      const loaded = await port.loadSkill(request, options);
      if (loaded.metadata.source === "bundled" && loaded.metadata.name === AGENTS_TEAM_SKILL_NAME) {
        throw new Error(`Skill not found: ${AGENTS_TEAM_SKILL_NAME}`);
      }
      return loaded;
    },
  };
}
