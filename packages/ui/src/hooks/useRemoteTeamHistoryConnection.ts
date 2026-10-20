import { useMemo } from "react";
import { useOptionalServices } from "./useServices.js";
import type { TeamHistoryConnection } from "./useTeamHistory.js";

/** 手机宿主已按 attachment 注入服务代理；查询复用它，不再创建桥或会话。 */
export function useRemoteTeamHistoryConnection({
  workspacePath,
  workspaceIdentity,
  sessionId,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
}): TeamHistoryConnection | undefined {
  const agent = useOptionalServices()?.droraAgentService;
  const identity = workspaceIdentity?.trim() || undefined;
  // 中文依据：服务代理或 scope 变化必须更换 connection，使历史 hook 丢弃旧 attachment 的 ACK。
  return useMemo<TeamHistoryConnection | undefined>(() => {
    if (!agent) return undefined;
    return {
      sessionId,
      sendCommand: (envelope) =>
        agent.sendConversationCommandV4({
          workspacePath,
          ...(identity ? { workspaceIdentity: identity } : {}),
          envelope,
        }),
    };
  }, [agent, workspacePath, identity, sessionId]);
}
