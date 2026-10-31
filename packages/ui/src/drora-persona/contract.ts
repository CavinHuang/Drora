/**
 * ui-drora-persona 对外契约：调用方要想正确调用就必须知道的一切都写在这里；
 * 其余对外不可见（PersonaApplicationArea 是分区内部实现，不经此契约外泄）。
 *
 * 设计依据：specs/drora-persona-system.md §10（交互与多端）、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §1.1/§2/§3。
 */

/** Drora 资料管理入口的能力门结果（hello.capabilities.personaControlV1 探测）。 */
export type PersonaControlAvailability = "checking" | "available" | "unavailable";

/** 应用情况查询的本地 workspace 路由目标；远程 workspace（identity/remoteSessionId）不传。 */
export interface PersonaApplicationWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
}
