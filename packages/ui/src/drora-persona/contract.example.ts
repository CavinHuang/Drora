import type { PersonaApplicationWorkspaceTarget, PersonaControlAvailability } from "./contract.js";

/** 本地 workspace 目标示例；远程目标（带 workspaceIdentity/remoteSessionId）不得传入。 */
export const example: PersonaApplicationWorkspaceTarget = { workspacePath: "/repo" };

/** 能力门结果词汇：checking（探测中）/ available（hello 确认）/ unavailable（缺失或失败）。 */
export const exampleAvailabilities: readonly PersonaControlAvailability[] = [
  "checking",
  "available",
  "unavailable",
];
