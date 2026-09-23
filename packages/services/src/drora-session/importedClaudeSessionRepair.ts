import type { DroraSessionStateSnapshot } from "@drora/shared";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import { repairImportedClaudeSessionSnapshot } from "#src/session/claude-native/importedClaudeHistoryRepair.js";
import type { IDroraAgentService } from "#src/drora-agent/droraAgent.js";
import type {
  DroraSessionReadParams,
  DroraSessionResumeParams,
} from "#src/drora-session/droraSession.js";

const logger = createServiceLogger("drora-session-service");

export async function repairEmptyImportedClaudeSessionSnapshot(params: {
  agentService: IDroraAgentService;
  snapshot: DroraSessionStateSnapshot;
  target: DroraSessionResumeParams | DroraSessionReadParams;
}): Promise<DroraSessionStateSnapshot> {
  const repaired = await repairImportedClaudeSessionSnapshot({
    snapshot: params.snapshot,
    target: {
      workspacePath: params.target.workspacePath,
      workspaceIdentity: params.target.workspaceIdentity,
      taskId: params.target.sessionId,
      ...("mcpServers" in params.target && params.target.mcpServers
        ? { mcpServers: params.target.mcpServers }
        : {}),
    },
    createSession: (input) => params.agentService.createSession(input),
    onRepair: (history) => {
      logger.warn(
        undefined,
        `[drora-session-service] Claude 导入 session 历史异常，按 ${history.source} 回填 taskId=${params.target.sessionId}`,
      );
    },
  });
  return repaired ?? params.snapshot;
}
