// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  CommandAck,
  CommandEnvelope,
  TeamHistoryResult,
} from "@drora/shared/drora-protocol-v4";

import { useTeamHistory, type TeamHistoryConnection } from "@/hooks/useTeamHistory.js";

/**
 * useTeamHistory 的 refreshKey 活性缝测试（specs/agents-team.md §21 A5 测试①，2026-10-24）：
 * 此前查询一次后停帧，团队跑动中新 journal 事件必须手动点「回最新」才出现——
 * refreshKey（TeamProcessPanel 的投影侧活性信号 teamProcessActivitySignal）抬升
 * 必须触发当前页重查；且页只是一份服务端查询结果，切队/切会话时旧 ACK 不得
 * 覆盖新 source。stub connection（照仓库既有 hook 测试形态，注入 sendCommand）。
 */

const SESSION_ID = "session_lead_1";

/** 构造可过 teamHistoryResultSchema 的最小 accepted ACK（queryTeamHistory 会 safeParse ack.result）。 */
function historyAck(teamId: string, throughSeq: number): CommandAck {
  const result = {
    type: "getTeamHistory",
    teamId,
    events: [{ seq: 1, at: "2026-10-24T08:00:00.000Z", kind: "team_created" }],
    throughSeq,
    skippedEntries: 0,
  } as unknown as TeamHistoryResult;
  return {
    commandId: `cmd_${teamId}_${String(throughSeq)}`,
    status: "accepted",
    revisionAtDecision: 7,
    result,
  } as CommandAck;
}

async function flush(): Promise<void> {
  // 初查链路：effect → queryTeamHistory（async sendCommand）→ safeParse → setState，
  // 两轮微任务足够跑穿；不足会以「调用次数少一」的形式在断言处显形。
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useTeamHistory（§21 A5 活性缝）", () => {
  it("refreshKey 抬升触发当前页重查（teamId/connection 不变时 sendCommand 再次发送）", async () => {
    const envelopes: CommandEnvelope[] = [];
    const sendCommand = vi.fn(async (envelope: CommandEnvelope): Promise<CommandAck> => {
      envelopes.push(envelope);
      return historyAck("team_1", 3);
    });
    const connection: TeamHistoryConnection = { sessionId: SESSION_ID, sendCommand };

    const hook = renderHook(({ refreshKey }) => useTeamHistory("team_1", connection, refreshKey), {
      initialProps: { refreshKey: "sig-1" },
    });
    await flush();
    expect(hook.result.current.data?.teamId).toBe("team_1");
    expect(hook.result.current.loading).toBe(false);
    expect(sendCommand).toHaveBeenCalledTimes(1);

    // §21 A5：投影侧活动边缘（送达翻转/无板 halt）只抬升信号，teamId 与 connection 不变。
    hook.rerender({ refreshKey: "sig-2" });
    await flush();
    expect(sendCommand).toHaveBeenCalledTimes(2);
    // 重查的是当前页：第二问仍是裸 { teamId } 载荷（未带 beforeSeq/throughSeq 翻页游标）。
    expect(envelopes[1]?.type).toBe("getTeamHistory");
    expect(envelopes[1]?.payload).toStrictEqual({ teamId: "team_1" });
    expect(hook.result.current.data?.teamId).toBe("team_1");
    hook.unmount();
  });

  it("切队后旧 ACK 迟到不得覆盖新 source 的当前页", async () => {
    let resolveTeamA: ((ack: CommandAck) => void) | undefined;
    const pendingTeamA = new Promise<CommandAck>((resolve) => {
      resolveTeamA = resolve;
    });
    const sendCommand = vi.fn(async (envelope: CommandEnvelope): Promise<CommandAck> => {
      const teamId = (envelope.payload as { teamId: string }).teamId;
      return teamId === "team_a" ? pendingTeamA : Promise.resolve(historyAck("team_b", 5));
    });
    const connection: TeamHistoryConnection = { sessionId: SESSION_ID, sendCommand };

    const hook = renderHook(({ teamId }) => useTeamHistory(teamId, connection), {
      initialProps: { teamId: "team_a" },
    });
    await flush();
    // team_a 查询在途（ACK 未回）。
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(hook.result.current.loading).toBe(true);
    expect(hook.result.current.data).toBeUndefined();

    // 切队：source 变为 team_b，其 ACK 即时结算。
    hook.rerender({ teamId: "team_b" });
    await flush();
    expect(hook.result.current.data?.teamId).toBe("team_b");
    expect(hook.result.current.loading).toBe(false);

    // 旧 ACK（team_a）迟到：effect 清理已置 current=false，不得写回 state。
    await act(async () => {
      resolveTeamA?.(historyAck("team_a", 9));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.data?.teamId).toBe("team_b");
    expect(hook.result.current.error).toBe(false);
    hook.unmount();
  });
});
