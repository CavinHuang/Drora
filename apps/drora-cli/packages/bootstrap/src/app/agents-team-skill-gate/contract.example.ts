import type { SkillPort } from "@drora/contracts";
import { gateAgentsTeamSkillPort } from "./contract.js";

/**
 * 用法示例：bootstrap skills.ts 在 skillPort 组装处的接线形态。
 * enabled 由 resolveAgentsTeamEnabled(fileConfig agentsTeam.enabled ?? env) 裁决
 * （本模块不读配置，保持纯函数可测）。
 */
export function example(skillPort: SkillPort, agentsTeamEnabled: boolean): SkillPort {
  return gateAgentsTeamSkillPort(skillPort, agentsTeamEnabled);
}
