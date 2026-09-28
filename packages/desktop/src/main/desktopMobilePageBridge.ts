// 移动端手机页动作翻译层（LAN 直连与 relay 云中继共用的单一实现）。
// 手机页 v1 协议帧 → 窗口 Host 服务调用（IDroraTaskService/IDroraSessionService），
// 返回 v1 应答帧负载（{type:"taskList"|"timeline"|"events"|"accepted", ...}）。
// 两端共用本模块，禁止在 LAN/relay 各自复制第二份翻译逻辑（spec: mobile-web-remote.md）。
import type { IDroraSessionService, IDroraTaskService } from "@drora/services";
import { randomUUID } from "node:crypto";

/** 手机页已鉴权动作帧（不含 hello/resume 等传输层握手帧）。 */
export type MobilePageActionFrame =
  | { type: "list" }
  | { type: "open"; taskId: string }
  | { type: "send"; taskId: string; content: string }
  | {
      type: "permission";
      taskId: string;
      runId?: string;
      requestId: string;
      optionId: string;
      decision: "allow" | "deny" | "escalate" | "modify";
    }
  | { type: "stop"; taskId: string }
  | { type: "events"; taskId: string; afterSeq: number };

export interface MobilePageWorkspace {
  workspacePath: string;
  workspaceIdentity?: string;
}

export async function serveMobilePageAction(params: {
  task: IDroraTaskService;
  session: IDroraSessionService;
  frame: MobilePageActionFrame;
  workspace: MobilePageWorkspace;
}): Promise<Record<string, unknown>> {
  const { frame } = params;
  const { task, session } = params;
  const { workspacePath, workspaceIdentity } = params.workspace;
  switch (frame.type) {
    case "list": {
      const tasks = await task.listTasks({ workspacePath, workspaceIdentity });
      return {
        type: "taskList",
        tasks: tasks.map((meta) => ({
          taskId: meta.taskId,
          title: meta.title,
          status: meta.status,
          updatedAt: meta.updatedAt,
        })),
      };
    }
    case "open": {
      const messages = await session.readSessionMessages({
        sessionId: frame.taskId,
        workspacePath,
        workspaceIdentity,
        limit: 200,
      });
      return { type: "timeline", taskId: frame.taskId, messages };
    }
    case "send": {
      const content = frame.content.trim();
      if (!content) return { type: "accepted", taskId: frame.taskId };
      await task.sendPrompt({
        taskId: frame.taskId,
        workspacePath,
        workspaceIdentity,
        traceId: randomUUID(),
        content,
        clientMode: "web-remote-replayable",
        clientLabel: "mobile-web",
      });
      return { type: "accepted", taskId: frame.taskId };
    }
    case "permission": {
      await task.respondPermission({
        taskId: frame.taskId,
        workspacePath,
        workspaceIdentity,
        runId: frame.runId,
        requestId: frame.requestId,
        optionId: frame.optionId,
        response: { decision: frame.decision },
      });
      return { type: "permission-ack", taskId: frame.taskId, requestId: frame.requestId };
    }
    case "stop": {
      await task.stopGeneration({ taskId: frame.taskId, workspacePath, workspaceIdentity });
      return { type: "stopped", taskId: frame.taskId };
    }
    case "events": {
      // readSessionEvents 直接返回事件数组（DroraSessionEvent[]）。
      const events = await session.readSessionEvents({
        sessionId: frame.taskId,
        workspacePath,
        workspaceIdentity,
        afterSeq: frame.afterSeq,
        limit: 200,
      });
      const lastEvent = events[events.length - 1];
      return {
        type: "events",
        taskId: frame.taskId,
        events,
        lastSeq: lastEvent && typeof lastEvent.seq === "number" ? lastEvent.seq : frame.afterSeq,
        hasMore: events.length >= 200,
      };
    }
  }
}
