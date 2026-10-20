import { useEffect, useMemo, useState } from "react";
import {
  TEAM_HISTORY_QUERY,
  teamHistoryResultSchema,
  type CommandAck,
  type CommandEnvelope,
  type TeamHistoryResult,
} from "@drora/shared/drora-protocol-v4";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import { logger } from "@/logger.js";

export interface TeamHistoryConnection {
  sessionId: string;
  sendCommand: (envelope: CommandEnvelope) => Promise<CommandAck>;
}
const EMPTY_CURSOR: { beforeSeq?: number; throughSeq?: number } = {};

/** 页只是一份服务端查询结果；切队/切会话/翻页时旧 ACK 不得覆盖当前页。 */
export function useTeamHistory(teamId: string, connection?: TeamHistoryConnection) {
  const sessionId = connection?.sessionId,
    send = connection?.sendCommand;
  const source = useMemo(() => ({ teamId, sessionId, send }), [teamId, sessionId, send]);
  const [pageCursor, setCursor] = useState({ source, cursor: EMPTY_CURSOR });
  const cursor = pageCursor.source === source ? pageCursor.cursor : EMPTY_CURSOR;
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{
    loading: boolean;
    data?: TeamHistoryResult;
    error: boolean;
    source: typeof source;
  }>({
    loading: true,
    error: false,
    source,
  });
  useEffect(() => {
    let current = true;
    if (!send || !sessionId) {
      setState({ loading: false, error: true, source });
      return;
    }
    setState({ loading: true, error: false, source });
    const envelope = createCommandEnvelope({
      type: TEAM_HISTORY_QUERY,
      sessionId,
      payload: { teamId, ...cursor },
    });
    void send(envelope)
      .then((ack) => {
        if (!current) return;
        const parsed = teamHistoryResultSchema.safeParse(ack.result);
        if (
          (ack.status !== "accepted" && ack.status !== "duplicate") ||
          !parsed.success ||
          parsed.data.teamId !== teamId
        ) {
          setState({ loading: false, error: true, source });
          return;
        }
        setState({ loading: false, error: false, data: parsed.data, source });
      })
      .catch((error) => {
        if (!current) return;
        logger.warn("[team-history] 历史查询失败", { sessionId, teamId, error });
        setState({ loading: false, error: true, source });
      });
    return () => {
      current = false;
    };
  }, [source, cursor, refresh]);
  // 中文依据：同名 team 也可能来自另一会话或 transport；渲染期即隔离旧页与游标，不能等 effect 再清空。
  const visible =
    state.source === source ? state : { loading: true, error: false, data: undefined };
  return {
    ...visible,
    older:
      visible.data?.nextBeforeSeq !== undefined
        ? () =>
            setCursor({
              source,
              cursor: {
                beforeSeq: visible.data!.nextBeforeSeq!,
                throughSeq: visible.data!.throughSeq,
              },
            })
        : undefined,
    latest: () => {
      setCursor({ source, cursor: EMPTY_CURSOR });
      setRefresh((value) => value + 1);
    },
    retry: () => setRefresh((value) => value + 1),
  };
}
