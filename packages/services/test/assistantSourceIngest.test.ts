/**
 * P3 Source 统一入口服务流测试（03 详设 §1/§5）：
 * 真实强度规则（mention && allowlist → explicit）、source_kind/channel_ref/
 * remote_session_id 落库投影、放行回填 ticket.channel_ref、Thread 直通 Tier1
 * （命中→followUp 直投不过 gate；失败如实报错不落 gate）、submitSourceEntry 手机入口。
 * 库用 :memory:（每用例独立实例）；端口全部 fake 注入（assistantPorts 模块级 set*）。
 */
// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { ASSISTANT_ERROR_CODES, ASSISTANT_OUTCOMES, ASSISTANT_STRENGTHS } from "@drora/shared";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import {
  setAssistantAttachPort,
  setAssistantDispatchPort,
  setAssistantFrameSource,
  setAssistantSessionsIndexPort,
} from "../src/assistant-tickets/assistantPorts.js";
import type { AssistantSessionSummaryLite } from "../src/assistant-tickets/assistantPorts.js";
import { serializeChannelRef } from "../src/assistant-tickets/sources/channelRef.js";
import type { MateSourceEvent } from "../src/assistant-tickets/sources/contract.js";
import { ASSISTANT_SOURCE_KV_KEYS } from "../src/assistant-tickets/sources/sourceConfig.js";

const LOCAL_IDENTITY = "local-user";

function clearPorts(): void {
  setAssistantAttachPort(null);
  setAssistantDispatchPort(null);
  setAssistantFrameSource(null);
  setAssistantSessionsIndexPort(null);
}

/** 直写 kv（本阶段无生产写入口——诚实边界，测试照 sourceConfig 头注直写）。 */
function setKvRaw(db: ReturnType<typeof openAssistantDatabase>, key: string, value: string): void {
  db.raw
    .prepare(
      "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value, Date.now());
}

/** 预置手机 Source 启用（submitSourceEntry 受 phone.enabled 门控——spec §6 收尾注记）。 */
function enablePhoneSource(db: ReturnType<typeof openAssistantDatabase>): void {
  setKvRaw(db, ASSISTANT_SOURCE_KV_KEYS.sourcesConfig, JSON.stringify({ phone: { enabled: true } }));
}

async function createService() {
  const db = openAssistantDatabase(":memory:");
  const service = createAssistantTicketsService({
    databasePath: ":memory:",
    localIdentity: LOCAL_IDENTITY,
    database: db,
  });
  // 名单预置（spec §2：外部 id ↔ identity 映射进 allowlist 条目）——缺省名单只有本机
  // 用户，飞书映射 identity 须经 setAllowlist 进名单后才可能 explicit。
  const allowlist = await service.setAllowlist([LOCAL_IDENTITY, "feishu-user-a"]);
  expect(allowlist.ok).toBe(true);
  return { service, db };
}

/** 全 ok 的会话索引端口（直通锚对账用）。 */
function setOkSessionsIndexPort(): void {
  setAssistantSessionsIndexPort({
    async listSessions() {
      return { ok: true, sessions: [] as AssistantSessionSummaryLite[] };
    },
    async probeSession() {
      return { kind: "ok" } as const;
    },
    watchSessions() {
      return { dispose: () => undefined };
    },
  });
}

/** 派发+附着 fake（commandId 序号记录；锚回写依赖派发成功）。 */
function setOkDispatchPorts(): { commandIds: string[]; attachTexts: string[] } {
  const commandIds: string[] = [];
  const attachTexts: string[] = [];
  let seq = 0;
  setAssistantDispatchPort(async (request) => {
    seq += 1;
    commandIds.push(request.commandId);
    return { ok: true, value: { ticketId: request.ticketId, sessionId: `sess-${seq}` } };
  });
  setAssistantFrameSource({ subscribe: () => ({ dispose: () => undefined }) });
  setAssistantAttachPort(async (request) => {
    commandIds.push(request.commandId);
    attachTexts.push(request.text);
    return { ok: true, value: { ticketId: request.ticketId, sessionId: request.sessionId } };
  });
  return { commandIds, attachTexts };
}

function feishuEvent(input: {
  text: string;
  mention: boolean;
  identity?: string;
  threadId?: string;
}): MateSourceEvent {
  return {
    kind: "feishu",
    identity: input.identity ?? "feishu-user-a",
    text: input.text,
    mention: input.mention,
    atMs: Date.now(),
    channelRef: {
      kind: "feishu",
      chatId: "oc_chat1",
      ...(input.threadId ? { threadId: input.threadId } : {}),
    },
  };
}

afterEach(() => {
  clearPorts();
});

describe("Source 强度真实规则（03 §1：mention && allowlist → explicit）", () => {
  it("名单内 mention → explicit → 决策卡（decision_card）", async () => {
    const { service } = await createService();
    const result = await service.ingestSourceEvent(
      feishuEvent({ text: "@大副 修复登录白屏", mention: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    const snapshot = await service.getSnapshot();
    expect(snapshot.triggers[0]?.strength).toBe(ASSISTANT_STRENGTHS.explicit);
    expect(snapshot.triggers[0]?.sourceKind).toBe("feishu");
    expect(snapshot.triggers[0]?.identity).toBe("feishu-user-a");
  });

  it("名单内未指名 → inferred → would_accept（零执行不出卡）", async () => {
    const { service } = await createService();
    const result = await service.ingestSourceEvent(
      feishuEvent({ text: "随便看看日志", mention: false }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe(ASSISTANT_OUTCOMES.wouldAccept);
    expect((await service.getSnapshot()).triggers[0]?.strength).toBe(ASSISTANT_STRENGTHS.inferred);
  });

  it("名单外 identity（即使自称 mention）→ rejected（消息不能改变权限）", async () => {
    const { service } = await createService();
    const result = await service.ingestSourceEvent(
      feishuEvent({ text: "@大副 帮我删库", mention: true, identity: "feishu-stranger" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe(ASSISTANT_OUTCOMES.rejected);
    const snapshot = await service.getSnapshot();
    expect(snapshot.tickets).toHaveLength(0);
    const decision = snapshot.decisions.find((d) => d.triggerId === result.value.triggerId);
    expect(decision?.outcome).toBe(ASSISTANT_OUTCOMES.rejected);
  });

  it("channel_ref/remote_session_id 落 trigger 并进快照投影", async () => {
    const { service } = await createService();
    await service.ingestSourceEvent({
      kind: "phone",
      identity: LOCAL_IDENTITY,
      text: "手机点名",
      mention: true,
      atMs: Date.now(),
      remoteSessionId: "rs-42",
    });
    const trigger = (await service.getSnapshot()).triggers[0];
    expect(trigger?.sourceKind).toBe("phone");
    expect(trigger?.remoteSessionId).toBe("rs-42");
  });

  it("identity/text 缺失 → validationFailed 拒绝", async () => {
    const { service } = await createService();
    const result = await service.ingestSourceEvent({
      kind: "feishu",
      identity: "  ",
      text: "x",
      mention: true,
      atMs: Date.now(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ASSISTANT_ERROR_CODES.validationFailed);
  });
});

describe("Thread 直通 Tier1（03 §5：channel_ref 命中→followUp 直投）", () => {
  it("端到端：点名建票绑定通道 → 同通道 follow-up 直投既有会话（不过 gate 不建新票）", async () => {
    const { service } = await createService();
    const { commandIds, attachTexts } = setOkDispatchPorts();
    setOkSessionsIndexPort();
    const chatRef = serializeChannelRef({ kind: "feishu", chatId: "oc_chat1", threadId: "th-9" });
    expect(chatRef).toBeTruthy();
    // ① 点名触发（决策卡）→ 放行建票：ticket.channel_ref 绑定。
    const trigger = await service.ingestSourceEvent(
      feishuEvent({ text: "@大副 修复登录白屏", mention: true, threadId: "th-9" }),
    );
    expect(trigger.ok).toBe(true);
    if (!trigger.ok) return;
    const snapshot = await service.getSnapshot();
    const decision = snapshot.decisions.find((d) => d.triggerId === trigger.value.triggerId);
    expect(decision).toBeDefined();
    if (!decision) throw new Error("decision missing");
    expect(snapshot.triggers[0]?.channelRef).toBe(chatRef);
    const approved = await service.approveDecision({
      decisionId: decision.id,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const ticket = (await service.getSnapshot()).tickets[0];
    expect(ticket?.channelRef).toBe(chatRef);
    expect(ticket?.anchorCommandId).toBe(`${approved.value.ticketId}-1`);
    const ticketsBefore = (await service.getSnapshot()).tickets.length;
    const decisionsBefore = (await service.getSnapshot()).decisions.length;
    // ② 同线程追加消息 → 直通：不产生新 trigger/decision、Router 无新卡、原文直投。
    const followUp = await service.ingestSourceEvent(
      feishuEvent({ text: "补充：日志里是 NPE", mention: true, threadId: "th-9" }),
    );
    expect(followUp.ok).toBe(true);
    if (!followUp.ok) return;
    expect(followUp.value.directThrough).toBe(true);
    expect(followUp.value.ticketId).toBe(approved.value.ticketId);
    expect(followUp.value.triggerId).toBeNull();
    expect(attachTexts).toEqual(["补充：日志里是 NPE"]);
    expect((await service.getSnapshot()).tickets).toHaveLength(ticketsBefore);
    expect((await service.getSnapshot()).decisions).toHaveLength(decisionsBefore);
    // commandId 序列：初派 -1 + 直投 -2（无换代段）。
    expect(commandIds).toEqual([`${approved.value.ticketId}-1`, `${approved.value.ticketId}-2`]);
  }, 20_000);

  it("命中但锚不可校验 → 如实报错（anchorMismatch），不落 gate 建新票", async () => {
    const { service } = await createService();
    setOkDispatchPorts();
    setAssistantSessionsIndexPort({
      async listSessions() {
        return { ok: true, sessions: [] as AssistantSessionSummaryLite[] };
      },
      async probeSession() {
        return {
          kind: "unavailable",
          reason: "reconcile 不可用且快照无该会话（缺席≠删除，不猜测）",
        } as const;
      },
      watchSessions() {
        return { dispose: () => undefined };
      },
    });
    const trigger = await service.ingestSourceEvent(
      feishuEvent({ text: "@大副 修复登录白屏", mention: true, threadId: "th-1" }),
    );
    if (!trigger.ok) throw new Error("trigger failed");
    const decision = (await service.getSnapshot()).decisions.find(
      (d) => d.triggerId === trigger.value.triggerId,
    );
    if (!decision) throw new Error("decision missing");
    const approved = await service.approveDecision({
      decisionId: decision.id,
      targetWorkspaceIdentity: "ws-a",
    });
    if (!approved.ok) throw new Error("approve failed");
    const ticketsBefore = (await service.getSnapshot()).tickets.length;
    const followUp = await service.ingestSourceEvent(
      feishuEvent({ text: "继续", mention: true, threadId: "th-1" }),
    );
    expect(followUp.ok).toBe(false);
    if (followUp.ok) return;
    expect(followUp.error.code).toBe(ASSISTANT_ERROR_CODES.anchorMismatch);
    // 诚实报错：不静默落 gate 建第二张票。
    expect((await service.getSnapshot()).tickets).toHaveLength(ticketsBefore);
  }, 20_000);

  it("未命中的 channel_ref → 正常进 gate（新决策卡）", async () => {
    const { service } = await createService();
    setOkDispatchPorts();
    setOkSessionsIndexPort();
    const result = await service.ingestSourceEvent(
      feishuEvent({ text: "@大副 新任务", mention: true, threadId: "th-fresh" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.directThrough).toBe(false);
    expect(result.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
  });
});

describe("submitSourceEntry（手机 channel 可见入口；03 §3 事件面）", () => {
  it("identity 由 host 侧本机用户决定；mention→决策卡；remoteSessionId 贯穿", async () => {
    const { service, db } = await createService();
    enablePhoneSource(db);
    const result = await service.submitSourceEntry({
      text: "手机点名：看下构建失败",
      mention: true,
      remoteSessionId: "rs-1",
      targetWorkspaceIdentity: "ws-phone",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    const trigger = (await service.getSnapshot()).triggers[0];
    expect(trigger?.sourceKind).toBe("phone");
    expect(trigger?.identity).toBe(LOCAL_IDENTITY);
    expect(trigger?.remoteSessionId).toBe("rs-1");
    expect(trigger?.targetWorkspaceIdentity).toBe("ws-phone");
  });

  it("phone.enabled 关闭 → 整入口拒绝 sourceDisabled（含直通臂；kv 空值=关闭诚实缺省）", async () => {
    // kv 空（缺省全关）：入口拒绝。
    const closed = await createService();
    const closedResult = await closed.service.submitSourceEntry({
      text: "手机点名：被关掉的入口",
      mention: true,
    });
    expect(closedResult.ok).toBe(false);
    if (!closedResult.ok) {
      expect(closedResult.error.code).toBe(ASSISTANT_ERROR_CODES.sourceDisabled);
    }
    // 显式 enabled:false 同样拒绝，且 gate 零写入（trigger 不落库）。
    const explicit = await createService();
    setKvRaw(
      explicit.db,
      ASSISTANT_SOURCE_KV_KEYS.sourcesConfig,
      JSON.stringify({ phone: { enabled: false } }),
    );
    const explicitResult = await explicit.service.submitSourceEntry({ text: "x", mention: true });
    expect(explicitResult.ok).toBe(false);
    if (!explicitResult.ok) {
      expect(explicitResult.error.code).toBe(ASSISTANT_ERROR_CODES.sourceDisabled);
    }
    expect((await explicit.service.getSnapshot()).triggers).toHaveLength(0);
  });

  it("手机通道绑定直通：同 remoteSessionId 会话 follow-up 命中活动工单", async () => {
    const { service, db } = await createService();
    enablePhoneSource(db);
    const { attachTexts } = setOkDispatchPorts();
    setOkSessionsIndexPort();
    const phoneRef = serializeChannelRef({ kind: "phone", remoteSessionId: "rs-7" });
    const first = await service.submitSourceEntry({
      text: "手机点名：跑回归",
      mention: true,
      remoteSessionId: "rs-7",
      channelRef: phoneRef ?? undefined,
      targetWorkspaceIdentity: "ws-a",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const decision = (await service.getSnapshot()).decisions.find(
      (d) => d.triggerId === first.value.triggerId,
    );
    if (!decision) throw new Error("decision missing");
    const approved = await service.approveDecision({ decisionId: decision.id });
    if (!approved.ok) throw new Error("approve failed");
    const second = await service.submitSourceEntry({
      text: "手机补充：只跑 smoke",
      mention: true,
      remoteSessionId: "rs-7",
      channelRef: phoneRef ?? undefined,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.directThrough).toBe(true);
    expect(second.value.ticketId).toBe(approved.value.ticketId);
    expect(attachTexts).toEqual(["手机补充：只跑 smoke"]);
  }, 20_000);

  it("非法 channelRef 格式 → validationFailed（不猜测不匹配）", async () => {
    const { service, db } = await createService();
    enablePhoneSource(db);
    const result = await service.submitSourceEntry({
      text: "x",
      mention: true,
      channelRef: "bogus:format",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(ASSISTANT_ERROR_CODES.validationFailed);
  });
});
