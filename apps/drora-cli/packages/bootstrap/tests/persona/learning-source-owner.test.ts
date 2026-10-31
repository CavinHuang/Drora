/**
 * P1b 来源 owner 生产适配器（`learning-source-owner.ts`）验证语义：
 * - 成功持久边界必须是 assistant 消息（合同 §6「源 owner 必须能够证明成功持久边界」）。
 *   通知端在 compact 后可能以 latestConversationMessageId 兜底，而 compact summary 行是
 *   role=user 的合成消息（core compact-active.ts）；不校验角色会把边界之后的人类消息
 *   并入抽取窗口。评审修复钉住：非 assistant 边界一律 missing（缺证据即跳过）。
 * - 正常路径（真实人类用户消息＋assistant 边界）不受角色断言影响。
 */
import { describe, expect, it } from "vitest";
import type { SessionId, SessionStorePort } from "@drora/contracts";
import { createSessionStoreLearningSourceOwner } from "../../src/app/drora-persona/learning-source-owner.js";

const WORKSPACE_KEY = "D:/workspace/example";

function userMessage(overrides?: {
  readonly id?: string;
  readonly created?: number;
  readonly synthetic?: boolean;
}) {
  return {
    info: {
      id: overrides?.id ?? "msg-user-1",
      sessionID: "session-1" as SessionId,
      role: "user" as const,
      time: { created: overrides?.created ?? 100 },
      agent: "main",
      ...(overrides?.synthetic === true ? { synthetic: true as const } : {}),
    },
    parts: [{ id: "part-1", type: "text", text: "请以后都用中文回复我" }],
  };
}

function assistantMessage(overrides?: { readonly id?: string; readonly created?: number }) {
  return {
    info: {
      id: overrides?.id ?? "msg-assistant-1",
      sessionID: "session-1" as SessionId,
      role: "assistant" as const,
      time: { created: overrides?.created ?? 200 },
      parentID: "msg-user-1" as const,
      mode: "build",
      agent: "main",
      path: { cwd: WORKSPACE_KEY, root: WORKSPACE_KEY },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts: [{ id: "part-2", type: "text", text: "好的，之后用中文。" }],
  };
}

function stubStore(messages: ReturnType<typeof userMessage | typeof assistantMessage>[]): SessionStorePort {
  const session = {
    id: "session-1",
    directory: WORKSPACE_KEY,
    time: { created: 0, updated: 1 },
  };
  return {
    getSession: async () => session,
    messages: async () => messages,
  } as unknown as SessionStorePort;
}

const owner = createSessionStoreLearningSourceOwner;

describe("persona 来源 owner 生产适配器：成功边界角色断言", () => {
  it("边界消息是 assistant：真实人类用户消息先于边界 → verified", async () => {
    const adapter = owner({ sessionStore: stubStore([userMessage(), assistantMessage()]) });
    const outcome = await adapter.verifyLearningSource({
      workspaceKey: WORKSPACE_KEY,
      sessionId: "session-1",
      boundary: { userMessageId: "msg-user-1", boundaryMessageId: "msg-assistant-1" },
    });
    expect(outcome).toMatchObject({
      status: "verified",
      sourceRevision: "msg-assistant-1",
    });
  });

  it.each([
    { case: "compact summary 兜底（role=user 合成消息）", boundaryMessageId: "msg-summary-1" },
    { case: "边界本身是另一条人类消息", boundaryMessageId: "msg-user-2" },
  ] as const)("边界消息不是 assistant（%s）→ missing，不签发 verified", async ({ boundaryMessageId }) => {
    const adapter = owner({
      sessionStore: stubStore([
        userMessage(),
        assistantMessage(),
        userMessage({ id: "msg-user-2", created: 250 }),
        userMessage({ id: "msg-summary-1", created: 300, synthetic: true }),
      ]),
    });
    const outcome = await adapter.verifyLearningSource({
      workspaceKey: WORKSPACE_KEY,
      sessionId: "session-1",
      boundary: { userMessageId: "msg-user-1", boundaryMessageId },
    });
    expect(outcome).toEqual({ status: "missing" });
  });
});
