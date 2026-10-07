// 移动端手机页动作翻译层（LAN 直连与 relay 云中继共用的单一实现）。
// 手机页 v1 协议帧 → 窗口 Host 服务调用（IDroraTaskService/IDroraSessionService），
// 返回 v1 应答帧负载（{type:"taskList"|"timeline"|"events"|"accepted", ...}）。
// 两端共用本模块，禁止在 LAN/relay 各自复制第二份翻译逻辑（spec: mobile-web-remote.md）。
import type { IDroraSessionService, IDroraTaskService } from "@drora/services";
import { getConversationMessageProjectionPolicy, type DroraMessageWithParts } from "@drora/shared";
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

/**
 * 手机页时间线投影（2026-09-29 schema 漂移修复配套）：readSessionMessages 返回
 * Drora Protocol 声明契约形状（DroraMessageWithParts），其中混有 runtime 注入的
 * model-only 上下文（compact summary、goal 续跑、后台通知等）。这里复用 PC 侧同一
 * 投影判据（getConversationMessageProjectionPolicy）只保留用户可见对话面，
 * LAN/relay 两端共用，避免手机页复制第二份过滤逻辑。
 */
const TIMELINE_MAX_BYTES = 900_000;

/**
 * R2 页 v1 帧无 rpc-frame 分片：整条 drora-page-response 受 relay 1MiB 物理帧
 * 上限约束（实测 1110524B 超限整帧丢弃→手机端永远等不到 timeline）。超限时
 * 从最旧端裁剪、保留最新消息（对话语义最新优先），留 ~100KB 余量给信封。
 */
function capTimelineBytes(messages: DroraMessageWithParts[]): DroraMessageWithParts[] {
  const serialized = Buffer.byteLength(JSON.stringify(messages), "utf8");
  if (serialized <= TIMELINE_MAX_BYTES) return messages;
  let size = 2;
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const add = Buffer.byteLength(JSON.stringify(messages[i]), "utf8") + (count > 0 ? 1 : 0);
    if (size + add > TIMELINE_MAX_BYTES) break;
    size += add;
    count += 1;
  }
  if (count === 0) return [];
  return messages.slice(messages.length - count);
}

function visibleTimelineMessages(messages: DroraMessageWithParts[]): DroraMessageWithParts[] {
  return messages.filter((message) => {
    // 协议边界防御：info 缺失的畸形行不投影（正常路径 schema 已保证 info 必填）。
    if (!message.info) return false;
    const policy = getConversationMessageProjectionPolicy(message);
    if (policy === "realUserInput" || policy === "visibleAssistant") {
      return message.info.semantics?.uiVisibility !== "debug";
    }
    return false;
  });
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
      // 冷会话激活：历史任务的会话不在 agent runtime 注册表时 readSessionMessages
      // 直接报 sessionUnavailable（requireSession 只读活跃注册表）。桌面 App 打开
      // 历史任务经 v4 gateway 冷恢复；手机页 v1 帧没有订阅面，这里用任务级
      // resumeTask 等价激活（幂等：已活跃任务恢复为 no-op），再读消息。
      await task.resumeTask({ taskId: frame.taskId, workspacePath, workspaceIdentity });
      const messages = await session.readSessionMessages({
        sessionId: frame.taskId,
        workspacePath,
        workspaceIdentity,
        limit: 200,
      });
      return {
        type: "timeline",
        taskId: frame.taskId,
        messages: capTimelineBytes(visibleTimelineMessages(messages)),
      };
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
