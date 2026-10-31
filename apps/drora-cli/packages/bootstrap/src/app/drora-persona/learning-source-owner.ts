/**
 * P1b 来源 owner 生产适配器（specs/drora-persona-system.md §8「原消息/Session Store owner」；
 * 数据合同 §6「源 owner 必须能够证明成功持久边界；仅有 lastOutcome、任意 assistant 或模型
 * 给出的 user 标签不够」）。只读：不写任何 session 数据，复用原 Project Memory extraction
 * 的分支事实机制（selectActiveConversationBranch + session revert 元数据，
 * core/src/runtime/helpers/project-memory-extraction.ts:53-62 同源语义）。
 *
 * 验证语义：
 * - 持久边界＝用户消息与最终 assistant 消息都以 durable 行存在于 owner 库且落在活动分支；
 *   缺任一即 "missing"（缺证据即跳过，不补造旧字段）。
 * - 活动分支＝session.revert 元数据选出的分支（rewind/branch cut 后旧分支消息不算有效）。
 * - workspaceKey 域＝session 的 workspaceID?.trim() || directory 与声明一致（PM10：
 *   同路径不同 identity 不串域）。
 * - 人类消息＝role=user、非 synthetic、无合成 source、user-visible 的 durable 文本
 *   （PM37：可信 owner 提供 role/origin；internal user 与 synthetic real_user 不算）。
 */
import type { SessionId, SessionStorePort } from "@drora/contracts";
import { selectActiveConversationBranch } from "@drora/contracts";
import type {
  PersonaLearningSourceOwnerPort,
  PersonaLearningSourceVerification,
} from "./learning-contract.js";

/** 有界人类消息窗口：owner 单次返回的条数上界（服务层还会做合计 code point 裁剪）。 */
const OWNER_WINDOW_MESSAGES_MAX = 32;

/**
 * persona 域把 sessionId 当 opaque string；SessionStorePort 的 SessionId 是 branded 型。
 * 本适配器是域边界的转换点（内容同一，只擦除品牌），不做任何格式改写。
 */
function asSessionId(sessionId: string): SessionId {
  return sessionId as SessionId;
}

function isRealHumanUserMessage(message: {
  info: { role: string; synthetic?: boolean; source?: string; visibility?: string };
}): boolean {
  return (
    message.info.role === "user" &&
    message.info.synthetic !== true &&
    message.info.source === undefined &&
    (message.info.visibility === undefined || message.info.visibility === "user-visible")
  );
}

function messageText(parts: ReadonlyArray<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

export function createSessionStoreLearningSourceOwner(input: {
  readonly sessionStore: SessionStorePort;
}): PersonaLearningSourceOwnerPort {
  const sessionStore = input.sessionStore;
  return {
    async verifyLearningSource(context): Promise<PersonaLearningSourceVerification> {
      let session;
      let messages;
      try {
        session = await sessionStore.getSession(asSessionId(context.sessionId));
        messages = await sessionStore.messages({ sessionID: asSessionId(context.sessionId) });
      } catch {
        return { status: "unavailable" };
      }
      if (!session) return { status: "missing" };
      // workspaceKey 域（合同 §6 workspaceKey＝workspaceIdentity?.trim() || workspacePath）。
      const sessionWorkspaceKey = session.workspaceID?.trim() || session.directory;
      if (sessionWorkspaceKey !== context.workspaceKey) {
        return { status: "workspace_mismatch" };
      }
      const active = selectActiveConversationBranch(messages, {
        branchCutAfterMessageId: session.revert?.branchCutAfterMessageID,
        rewindCreatedMessageId: session.revert?.createdMessageID,
        rewindKeptMessageIds: session.revert?.keptMessageIDs,
        rewindTargetMessageId: session.revert?.targetMessageID,
      });
      const userId = active.find((message) => message.info.id === context.boundary.userMessageId);
      const boundary = active.find(
        (message) => message.info.id === context.boundary.boundaryMessageId,
      );
      if (!userId || !boundary) return { status: "missing" };
      if (!isRealHumanUserMessage(userId)) return { status: "missing" };
      // 成功边界必须是 assistant 消息（本文件头「持久边界＝…最终 assistant 消息」；合同 §6
      // 「源 owner 必须能够证明成功持久边界」）。通知端在 compact 后可能以
      // latestConversationMessageId 兜底，而 compact summary 行是 role=user 的合成消息
      // （core compact-active.ts）；不校验角色会把边界之后的人类消息并入抽取窗口。
      if (boundary.info.role !== "assistant") return { status: "missing" };
      // 边界顺序：用户消息必须先于成功边界（消息边界合法性）。
      if (userId.info.time.created > boundary.info.time.created) {
        return { status: "branch_invalid" };
      }
      if (
        context.expectedSourceRevision !== undefined &&
        context.expectedSourceRevision !== context.boundary.boundaryMessageId
      ) {
        return { status: "missing" };
      }
      return {
        status: "verified",
        sourceRevision: context.boundary.boundaryMessageId,
        branchEvidence: session.revert ? `revert-boundary:${session.time.updated}` : "head",
      };
    },

    async readTurnHumanMessages(context): Promise<readonly string[] | undefined> {
      let messages;
      try {
        messages = await sessionStore.messages({ sessionID: asSessionId(context.sessionId) });
      } catch {
        return undefined;
      }
      let session;
      try {
        session = await sessionStore.getSession(asSessionId(context.sessionId));
      } catch {
        return undefined;
      }
      if (!session) return undefined;
      const active = selectActiveConversationBranch(messages, {
        branchCutAfterMessageId: session.revert?.branchCutAfterMessageID,
        rewindCreatedMessageId: session.revert?.createdMessageID,
        rewindKeptMessageIds: session.revert?.keptMessageIDs,
        rewindTargetMessageId: session.revert?.targetMessageID,
      });
      const startIndex = active.findIndex(
        (message) => message.info.id === context.boundary.userMessageId,
      );
      const endIndex = active.findIndex(
        (message) => message.info.id === context.boundary.boundaryMessageId,
      );
      if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return undefined;
      const texts: string[] = [];
      for (const message of active.slice(startIndex, endIndex + 1)) {
        if (!isRealHumanUserMessage(message)) continue;
        const text = messageText(message.parts);
        if (text.length > 0) texts.push(text);
        if (texts.length >= OWNER_WINDOW_MESSAGES_MAX) break;
      }
      return texts;
    },
  };
}
