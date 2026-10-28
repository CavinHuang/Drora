import { useEffect, useMemo, useState } from "react";
import { teamHistoryResultSchema, type TeamHistoryResult } from "@drora/shared/drora-protocol-v4";
import { queryTeamHistory, type TeamHistoryConnection } from "@/team/commands.js";

// TeamHistoryConnection 的定义与历史查询的发送收口在 team/commands.ts（§19 契约 6
// 低危项，2026-10-23）：TEAM_HISTORY_QUERY 是 team 域第九条 wire 命令，此前信封在本
// hook 内直构、ACK 不进 commandAckObservability 环形缓冲——八命令补观测环的同一理由
// （AT-01 实证 probe 不到 ACK）对历史查询同样成立。此处保留类型再导出，既有消费面
// （TeamStagedEditorConnected/TeamPanel/TeamApprovalDock 的 sendCommand 签名）不动。

export type { TeamHistoryConnection };

const EMPTY_CURSOR: { beforeSeq?: number; throughSeq?: number } = {};

/**
 * 页只是一份服务端查询结果；切队/切会话/翻页时旧 ACK 不得覆盖当前页。
 *
 * `refreshKey`（specs/agents-team.md §19 契约 6 活性缝，2026-10-23）：照
 * useWorkflowRunJournalSummaries 的同名先例——调用方传「投影 team 键的单调信号」
 * （看板计数/最大任务 updatedAt/尾窗末条消息 id），团队跑动中任一活动边缘抬升它，
 * 当前页自动重查；此前查询一次后停帧，新 journal 事件必须手动点「回最新」才出现
 * （workflow 目录页实测修过的同款 bug）。手动「回最新」保留为兜底。
 */
export function useTeamHistory(
  teamId: string,
  connection?: TeamHistoryConnection,
  refreshKey?: number | string,
) {
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
    void queryTeamHistory({ sessionId, sendCommand: send }, teamId, cursor).then((outcome) => {
      if (!current) return;
      if (!outcome.ok || outcome.data?.teamId !== teamId) {
        setState({ loading: false, error: true, source });
        return;
      }
      setState({ loading: false, error: false, data: outcome.data, source });
    });
    return () => {
      current = false;
    };
  }, [source, cursor, refresh, refreshKey, teamId]);
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
