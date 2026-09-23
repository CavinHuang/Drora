/**
 * Drora Agent Slash Commands 便捷 hook
 *
 * 返回当前 workspace 下 Agent 广播的可用 slash commands 列表。
 */
import { useDroraSessionStore, selectWorkspaceDroraState } from "../store/droraSessionStore.js";

export function useSlashCommands(workspacePath: string, workspaceIdentity?: string) {
  return useDroraSessionStore(
    (state) => selectWorkspaceDroraState(state, workspacePath, workspaceIdentity).slashCommands,
  );
}
