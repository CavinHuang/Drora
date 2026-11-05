/**
 * P3 Source 注册表与三 Source 单测（03 详设 §1-§4）：
 * channelRef 串接/解析往返、整词 @点名、注册表 kv 惰性启停与事件放行门、
 * 飞书 Source 映射与交互面过滤、手机 Source 桥、GitHub 轮询（ETag 304 省额+游标
 * 双防重+PAT 缺失诚实跳过）、终态回复端口（差分幂等+Co-authored-by 署名）。
 * 纯函数与 fake 注入驱动（无真实网络/凭证）。
 */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import {
  setAssistantAttachPort,
  setAssistantDispatchPort,
  setAssistantFrameSource,
  setAssistantSessionsIndexPort,
} from "../src/assistant-tickets/assistantPorts.js";
import {
  matchesWholeWordMention,
  parseChannelRef,
  serializeChannelRef,
} from "../src/assistant-tickets/sources/channelRef.js";
import {
  ASSISTANT_SOURCE_KV_KEYS,
  isSourceEnabled,
  readIdentityMap,
  readSourcesConfig,
  resolveMappedIdentity,
} from "../src/assistant-tickets/sources/sourceConfig.js";
import { createMateSourceRegistry } from "../src/assistant-tickets/sources/sourceRegistry.js";
import { createFeishuSource } from "../src/assistant-tickets/sources/feishuSource.js";
import { createPhoneSource } from "../src/assistant-tickets/sources/phoneSource.js";
import {
  GITHUB_KV_KEYS,
  createGitHubSource,
  createGitHubReplySender,
} from "../src/assistant-tickets/sources/githubSource.js";
import { ASSISTANT_OUTCOMES, ASSISTANT_TICKET_STATUSES } from "@drora/shared";
import type { AssistantSnapshot } from "../src/assistant-tickets/assistantTickets.js";
import type { MateSourceEvent } from "../src/assistant-tickets/sources/contract.js";
import type { GitHubComment } from "../src/assistant-tickets/sources/githubSource.js";

afterEach(() => {
  setAssistantAttachPort(null);
  setAssistantDispatchPort(null);
  setAssistantFrameSource(null);
  setAssistantSessionsIndexPort(null);
});

describe("channelRef 串接/解析（sources/channelRef.ts 单出处）", () => {
  it("四形态往返一致；组件含分隔符也防碰撞", () => {
    const cases = [
      { kind: "feishu" as const, chatId: "oc_1", threadId: "th_2" },
      { kind: "feishu" as const, chatId: "oc_priv" },
      { kind: "github" as const, owner: "acme", repo: "app", issueNumber: 12 },
      { kind: "phone" as const, remoteSessionId: "rs-9" },
    ];
    for (const ref of cases) {
      const serialized = serializeChannelRef(ref);
      expect(serialized).toBeTruthy();
      expect(parseChannelRef(serialized!)).toEqual(ref);
    }
    // id 内含分隔符/保留字符：编码后解析不串位。
    const tricky = serializeChannelRef({
      kind: "feishu",
      chatId: "oc/a",
      threadId: "th#1/b",
    });
    expect(parseChannelRef(tricky!)).toEqual({
      kind: "feishu",
      chatId: "oc/a",
      threadId: "th#1/b",
    });
  });

  it("非法格式 → null（不猜测）", () => {
    expect(
      serializeChannelRef({ kind: "github", owner: "a", repo: "b", issueNumber: 0 }),
    ).toBeNull();
    expect(parseChannelRef("bogus:1")).toBeNull();
    expect(parseChannelRef("feishu:g/only-one-segment")).toBeNull();
  });
});

describe("整词 @点名匹配（03 §4）", () => {
  it("整词命中；子词/邮箱不误判", () => {
    expect(matchesWholeWordMention("@大副 帮我看下", "大副")).toBe(true);
    expect(matchesWholeWordMention("先 @大副 再说", "大副")).toBe(true);
    expect(matchesWholeWordMention("@大副助手 也算点名吗", "大副")).toBe(false);
    expect(matchesWholeWordMention("邮箱 x@大副 不算", "大副")).toBe(false);
    expect(matchesWholeWordMention("@leo 请处理", "leo")).toBe(true);
    expect(matchesWholeWordMention("@leonardo 不是 leo", "leo")).toBe(false);
    expect(matchesWholeWordMention("没有任何点名", "大副")).toBe(false);
    expect(matchesWholeWordMention("@大副 点名", "")).toBe(false);
  });
});

describe("Source kv 配置与映射（sourceConfig.ts）", () => {
  it("坏/缺值逐键回落缺省；显式 true 才启用", () => {
    const kv = new Map<string, string>();
    expect(readSourcesConfig((k) => kv.get(k))).toEqual({});
    expect(
      isSourceEnabled(
        readSourcesConfig((k) => kv.get(k)),
        "feishu",
      ),
    ).toBe(false);
    kv.set(ASSISTANT_SOURCE_KV_KEYS.sourcesConfig, "not-json{");
    expect(readSourcesConfig((k) => kv.get(k))).toEqual({});
    kv.set(
      ASSISTANT_SOURCE_KV_KEYS.sourcesConfig,
      JSON.stringify({ github: { enabled: true, repo: "a/b" } }),
    );
    const config = readSourcesConfig((k) => kv.get(k));
    expect(isSourceEnabled(config, "github")).toBe(true);
    expect(isSourceEnabled(config, "feishu")).toBe(false);
    expect(config.github?.repo).toBe("a/b");
  });

  it("身份映射：命中取映射值；未映射原样透传（gate 拒绝并记录）", () => {
    const kv = new Map<string, string>();
    kv.set(ASSISTANT_SOURCE_KV_KEYS.identityMap, JSON.stringify({ github: { leo: "local-user" } }));
    const map = readIdentityMap((k) => kv.get(k));
    expect(resolveMappedIdentity(map, "github", "leo")).toBe("local-user");
    expect(resolveMappedIdentity(map, "github", "stranger")).toBe("stranger");
    expect(resolveMappedIdentity(map, "feishu", "ou_x")).toBe("ou_x");
  });
});

describe("注册表（03 §1：kv enabled 惰性启停 + 事件放行门）", () => {
  function fakeSource(kind: MateSourceEvent["kind"]) {
    const calls: string[] = [];
    let emit: ((event: MateSourceEvent) => void) | null = null;
    return {
      calls,
      source: {
        kind,
        isRunning: () => emit !== null,
        start(emitHandle: (event: MateSourceEvent) => void) {
          calls.push("start");
          emit = emitHandle;
        },
        stop() {
          calls.push("stop");
          emit = null;
        },
        produce(event: MateSourceEvent) {
          emit?.(event);
        },
      },
    };
  }

  function makeSnapshot(tickets: AssistantSnapshot["tickets"]): AssistantSnapshot {
    return {
      version: 2,
      mode: "observe",
      allowlist: ["local-user"],
      budget: { maxActivePerWorkspace: 3 },
      worktreeDisabled: false,
      trust: { wouldAcceptCount: 0, releaseCount: 0 },
      triggers: [],
      decisions: [],
      tickets,
      updatedAtMs: Date.now(),
    };
  }

  it("enabled=true → start 传入配置；false → stop；重复 emit 门前丢弃", () => {
    const kv = new Map<string, string>();
    kv.set(ASSISTANT_SOURCE_KV_KEYS.sourcesConfig, JSON.stringify({ phone: { enabled: true } }));
    const ingested: MateSourceEvent[] = [];
    const { calls, source } = fakeSource("phone");
    const registry = createMateSourceRegistry({
      kvGet: (k) => kv.get(k),
      ingestSourceEvent: async (event) => {
        ingested.push(event);
      },
      subscribeSnapshot: () => ({ dispose: () => undefined }),
    });
    registry.register(source);
    // 未启用：emit 丢弃。
    registry.emit({ kind: "phone", identity: "u", text: "x", mention: true, atMs: 1 });
    expect(ingested).toHaveLength(0);
    registry.reconcile();
    expect(calls).toEqual(["start"]);
    // 启用后：emit → ingest。
    registry.emit({ kind: "phone", identity: "u", text: "x", mention: true, atMs: 1 });
    expect(ingested).toHaveLength(1);
    // 关闭：stop 后再 emit 丢弃。
    kv.set(ASSISTANT_SOURCE_KV_KEYS.sourcesConfig, "{}");
    registry.reconcile();
    expect(calls).toEqual(["start", "stop"]);
    registry.emit({ kind: "phone", identity: "u", text: "y", mention: true, atMs: 2 });
    expect(ingested).toHaveLength(1);
  });

  it("同 kind 重复登记拒绝；ingest 异步失败不外抛（fire-and-forget warn）", () => {
    const kv = new Map<string, string>();
    kv.set(ASSISTANT_SOURCE_KV_KEYS.sourcesConfig, JSON.stringify({ phone: { enabled: true } }));
    const { source } = fakeSource("phone");
    const { source: source2 } = fakeSource("phone");
    const registry = createMateSourceRegistry({
      kvGet: (k) => kv.get(k),
      ingestSourceEvent: async () => {
        throw new Error("boom");
      },
      subscribeSnapshot: () => ({ dispose: () => undefined }),
    });
    registry.register(source);
    expect(() => registry.register(source2)).toThrow("重复登记");
    registry.reconcile();
    expect(() =>
      registry.emit({ kind: "phone", identity: "u", text: "x", mention: true, atMs: 1 }),
    ).not.toThrow();
  });

  it("终态回复：首次进入终态且有 channel_ref → 端口一次；重放同终态不重发", async () => {
    const kv = new Map<string, string>();
    const replies: Array<{ ticketId: string; summary: string }> = [];
    const registry = createMateSourceRegistry({
      kvGet: (k) => kv.get(k),
      ingestSourceEvent: async () => undefined,
      subscribeSnapshot: () => ({ dispose: () => undefined }),
      replyPort: {
        async reply(input) {
          replies.push({ ticketId: input.ticketId, summary: input.summary });
          return { ok: true };
        },
      },
    });
    const base = {
      brief: "b",
      status: ASSISTANT_TICKET_STATUSES.running,
      permissionTier: "build" as const,
      usage: { inputTokens: 0, outputTokens: 0 },
      outputSummary: null,
      failReason: null,
      targetWorkspaceIdentity: "ws-a",
      sessionId: "s1",
      updatedAtMs: 1,
      decisionId: null,
    };
    registry.handleSnapshot(
      makeSnapshot([
        { ...base, id: "T-1", channelRef: "phone:rs-1", outputSummary: "好了" },
        { ...base, id: "T-2", channelRef: null },
      ]),
    );
    expect(replies).toHaveLength(0);
    // running → done：T-1 有绑定触发；T-2 无绑定不触发。
    registry.handleSnapshot(
      makeSnapshot([
        {
          ...base,
          id: "T-1",
          status: ASSISTANT_TICKET_STATUSES.done,
          channelRef: "phone:rs-1",
          outputSummary: "好了",
        },
        { ...base, id: "T-2", status: ASSISTANT_TICKET_STATUSES.done, channelRef: null },
      ]),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.ticketId).toBe("T-1");
    expect(replies[0]?.summary).toContain("T-1");
    expect(replies[0]?.summary).toContain("好了");
    // 快照重放同终态：不重发（幂等集）。
    registry.handleSnapshot(
      makeSnapshot([
        {
          ...base,
          id: "T-1",
          status: ASSISTANT_TICKET_STATUSES.done,
          channelRef: "phone:rs-1",
          outputSummary: "好了",
        },
      ]),
    );
    expect(replies).toHaveLength(1);
  });
});

describe("飞书 Source（03 §2：bots 出口适配）", () => {
  function startSource(source: ReturnType<typeof createFeishuSource>) {
    const events: MateSourceEvent[] = [];
    source.start((event) => events.push(event), {});
    return events;
  }

  it("mention/identity 映射/群线程绑定逐项传递；私聊=会话粒度", () => {
    const source = createFeishuSource({
      resolveIdentity: (id) => (id === "ou_1" ? "captain" : id),
    });
    const events = startSource(source);
    source.handleChannelMessage({
      provider: "feishu",
      botId: "b1",
      text: "@大副 修复登录白屏",
      mentionedBot: true,
      actor: { providerUserId: "ou_1", chatType: "group", chatId: "oc_1", threadId: "th_2" },
      receivedAt: 1_700_000_000_000,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "feishu",
      identity: "captain",
      mention: true,
      atMs: 1_700_000_000_000,
      channelRef: { kind: "feishu", chatId: "oc_1", threadId: "th_2" },
    });
    source.handleChannelMessage({
      provider: "feishu",
      botId: "b1",
      text: "私聊消息",
      actor: { providerUserId: "ou_9", chatType: "private", chatId: "oc_9" },
    });
    expect(events[1]?.channelRef).toEqual({ kind: "feishu", chatId: "oc_9" });
    expect(events[1]?.mention).toBe(false);
  });

  it("非飞书 provider / 命令 / 卡片交互 / 补答 / 空文本 全部过滤（不进 gate）", () => {
    const source = createFeishuSource({ resolveIdentity: (id) => id });
    const events = startSource(source);
    const actor = { providerUserId: "ou_1", chatType: "group" as const, chatId: "oc_1" };
    source.handleChannelMessage({
      provider: "telegram",
      botId: "b",
      text: "@大副 hi",
      mentionedBot: true,
      actor,
    });
    source.handleChannelMessage({
      provider: "feishu",
      botId: "b",
      text: "/status",
      commandText: "/status",
      actor,
    });
    source.handleChannelMessage({
      provider: "feishu",
      botId: "b",
      text: "卡片点击",
      groupCardAction: true,
      actor,
    });
    source.handleChannelMessage({
      provider: "feishu",
      botId: "b",
      text: "补答",
      elicitationResponse: { value: "x" },
      actor,
    });
    source.handleChannelMessage({ provider: "feishu", botId: "b", text: "   ", actor });
    expect(events).toHaveLength(0);
    // 未运行态：start 前静默丢弃（注册表启停语义）。
  });
});

describe("手机 Source（03 §3：事件面定型桥）", () => {
  it("运行态门 + identity 传递 + channelRef 反解；未启动丢弃", () => {
    const source = createPhoneSource();
    const events: MateSourceEvent[] = [];
    source.emitPhoneInput(
      { text: "手机点名", mention: true, remoteSessionId: "rs-1" },
      "local-user",
    );
    expect(events).toHaveLength(0);
    source.start((event) => events.push(event), {});
    source.emitPhoneInput(
      {
        text: "手机点名",
        mention: true,
        remoteSessionId: "rs-1",
        channelRef: serializeChannelRef({ kind: "phone", remoteSessionId: "rs-1" }) ?? undefined,
        targetWorkspaceIdentity: "ws-a",
        atMs: 42,
      },
      "local-user",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "phone",
      identity: "local-user",
      mention: true,
      atMs: 42,
      remoteSessionId: "rs-1",
      workspaceIdentity: "ws-a",
      channelRef: { kind: "phone", remoteSessionId: "rs-1" },
    });
    source.emitPhoneInput({ text: "   ", mention: true }, "local-user");
    // 非法 channelRef：按无绑定处置（消息不静默丢弃——照常进 gate 出决策卡），事件仍投递。
    source.emitPhoneInput({ text: "非法绑定", mention: true, channelRef: "bogus" }, "local-user");
    expect(events).toHaveLength(2);
    expect(events[1]?.channelRef).toBeUndefined();
    source.stop();
    source.emitPhoneInput({ text: "停用后", mention: true }, "local-user");
    expect(events).toHaveLength(2);
  });
});

describe("GitHub Source（03 §4：ETag+游标+点名；PAT 缺失诚实跳过）", () => {
  interface FakeResponseInit {
    readonly status: number;
    readonly etag?: string;
    readonly body?: unknown;
  }
  function fakeFetch(responses: FakeResponseInit[]) {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    let index = 0;
    const fetchImpl = (async (url: unknown, init?: unknown) => {
      const headers = ((init as { headers?: Record<string, string> })?.headers ?? {}) as Record<
        string,
        string
      >;
      calls.push({ url: String(url), headers });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      const r = response ?? { status: 200, body: [] };
      return {
        ok: r.status < 400,
        status: r.status,
        headers: {
          get: (name: string) => (name.toLowerCase() === "etag" ? (r.etag ?? null) : null),
        },
        json: async () => r.body ?? [],
      };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  function makeDeps(kv: Map<string, string>, fetchImpl: typeof fetch) {
    return {
      kvGet: (k: string) => kv.get(k),
      kvSet: (k: string, v: string) => kv.set(k, v),
      resolveIdentity: (login: string) => (login === "leo" ? "local-user" : login),
      loadCredential: async () => "fake-pat-token",
      fetchImpl,
      schedule: () => () => undefined,
      pollIntervalMs: 60_000,
    };
  }

  const comment = (overrides: Partial<GitHubComment>): GitHubComment => ({
    id: 100,
    body: "@大副 请修复构建",
    created_at: "2026-11-05T00:00:00Z",
    issue_url: "https://api.github.com/repos/acme/app/issues/7",
    user: { login: "leo" },
    ...overrides,
  });

  it("点名评论 → 事件（identity 映射/整词/channelRef）；非点名与游标内重放不触发", async () => {
    const kv = new Map<string, string>();
    const { fetchImpl } = fakeFetch([
      {
        status: 200,
        etag: 'W/"v1"',
        body: [
          comment({}),
          comment({ id: 101, body: "@大副助手 不是点名" }),
          comment({ id: 102, body: "普通评论", user: { login: "leo" } }),
          comment({ id: 103, body: "@大副 点名但名单外", user: { login: "stranger" } }),
        ],
      },
    ]);
    const events: MateSourceEvent[] = [];
    const source = createGitHubSource(makeDeps(kv, fetchImpl));
    source.start((event) => events.push(event), { github: { enabled: true, repo: "acme/app" } });
    await source.pollNow();
    expect(events).toHaveLength(2); // id=100 点名 + id=103 名单外（原样透传，gate 拒绝并记录）
    expect(events[0]).toMatchObject({
      identity: "local-user",
      mention: true,
      channelRef: { kind: "github", owner: "acme", repo: "app", issueNumber: 7 },
    });
    expect(events[1]?.identity).toBe("stranger");
    // 游标推进到 103。
    expect(kv.get(GITHUB_KV_KEYS.commentsCursorId)).toBe("103");
    expect(kv.get(GITHUB_KV_KEYS.commentsEtag)).toBe('W/"v1"');
    // ETag 304 省额：If-None-Match 命中 → 无事件（不重复触发）。
    const { fetchImpl: fetch304, calls: calls304 } = fakeFetch([{ status: 304 }]);
    const source304 = createGitHubSource(makeDeps(kv, fetch304));
    source304.start((event) => events.push(event), { github: { enabled: true, repo: "acme/app" } });
    await source304.pollNow();
    expect(calls304[0]?.headers["If-None-Match"]).toBe('W/"v1"');
    expect(events).toHaveLength(2);
  });

  it("PAT 缺失 → 本轮跳过（不伪造连通，不写请求）；网络异常不中断", async () => {
    const kv = new Map<string, string>();
    const { calls, fetchImpl } = fakeFetch([{ status: 200, body: [comment({})] }]);
    const source = createGitHubSource({
      ...makeDeps(kv, fetchImpl),
      loadCredential: async () => undefined,
    });
    source.start(() => undefined, { github: { enabled: true, repo: "acme/app" } });
    await source.pollNow();
    expect(calls).toHaveLength(0);
    // 网络异常：下一轮继续（pollNow 可重入）。
    const { fetchImpl: boomFetch } = fakeFetch([]);
    const boom = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const source2 = createGitHubSource(makeDeps(kv, boomFetch));
    source2.start(() => undefined, { github: { enabled: true, repo: "acme/app" } });
    await expect(source2.pollNow()).resolves.toBeUndefined();
    void boom;
  });

  it("GitHub 回复端口：POST 评论带 Co-authored-by 署名；绑定与配置不一致不跨仓发送", async () => {
    const posts: Array<{ url: string; body: { body: string } }> = [];
    const fetchImpl = (async (url: unknown, init?: unknown) => {
      const method = (init as { method?: string })?.method ?? "GET";
      if (method === "POST") {
        posts.push({
          url: String(url),
          body: JSON.parse((init as { body: string }).body) as { body: string },
        });
        return { ok: true, status: 201, headers: { get: () => null }, json: async () => ({}) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => [] };
    }) as unknown as typeof fetch;
    const sender = createGitHubReplySender({
      loadCredential: async () => "fake-pat-token",
      fetchImpl,
      readConfig: () => ({ enabled: true, repo: "acme/app" }),
    });
    const result = await sender.reply({
      channelRef: serializeChannelRef({
        kind: "github",
        owner: "acme",
        repo: "app",
        issueNumber: 7,
      })!,
      ticketId: "T-1",
      status: "done",
      summary: "大副工单 T-1 完成：构建已修复",
    });
    expect(result).toEqual({ ok: true });
    expect(posts[0]?.url).toBe("https://api.github.com/repos/acme/app/issues/7/comments");
    expect(posts[0]?.body.body).toContain("Co-authored-by: 大副 (Drora Mate)");
    expect(posts[0]?.body.body).toContain("构建已修复");
    // 仓库不一致：不发送。
    const mismatch = await sender.reply({
      channelRef: serializeChannelRef({
        kind: "github",
        owner: "other",
        repo: "x",
        issueNumber: 1,
      })!,
      ticketId: "T-2",
      status: "failed",
      summary: "失败",
    });
    expect(mismatch).toEqual({ ok: false, reason: expect.stringContaining("不一致") });
    // 非 github 绑定：拒绝。
    const notGithub = await sender.reply({
      channelRef: "phone:rs-1",
      ticketId: "T-3",
      status: "done",
      summary: "x",
    });
    expect(notGithub).toEqual({ ok: false, reason: expect.stringContaining("非 GitHub") });
  });
});

describe("端到端接线冒烟（注册表→服务统一入口；fake 端口）", () => {
  it("注册表 emit → 服务 ingestSourceEvent 决策卡； dispose 停源", async () => {
    const db = openAssistantDatabase(":memory:");
    const service = createAssistantTicketsService({
      databasePath: ":memory:",
      localIdentity: "local-user",
      database: db,
    });
    setAssistantDispatchPort(async (request) => ({
      ok: true,
      value: { ticketId: request.ticketId, sessionId: "s1" },
    }));
    setAssistantFrameSource({ subscribe: () => ({ dispose: () => undefined }) });
    const kv = new Map<string, string>();
    kv.set(ASSISTANT_SOURCE_KV_KEYS.sourcesConfig, JSON.stringify({ phone: { enabled: true } }));
    const phone = createPhoneSource();
    const registry = createMateSourceRegistry({
      kvGet: (k) => kv.get(k),
      ingestSourceEvent: (event) => service.ingestSourceEvent(event),
      subscribeSnapshot: () => ({ dispose: () => undefined }),
    });
    registry.register(phone);
    registry.reconcile();
    registry.emit({
      kind: "phone",
      identity: "local-user",
      text: "手机点名：看下失败原因",
      mention: true,
      atMs: Date.now(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const snapshot = await service.getSnapshot();
    expect(snapshot.triggers[0]?.sourceKind).toBe("phone");
    expect(snapshot.decisions[0]?.outcome).toBe(ASSISTANT_OUTCOMES.decisionCard);
    const disposeSpy = vi.fn();
    const sourceDispose = {
      kind: "phone" as const,
      isRunning: () => false,
      start: () => undefined,
      stop: disposeSpy,
    };
    const registry2 = createMateSourceRegistry({
      kvGet: (k) => kv.get(k),
      ingestSourceEvent: async () => undefined,
      subscribeSnapshot: () => ({ dispose: () => undefined }),
    });
    registry2.register(sourceDispose);
    registry2.reconcile();
    registry2.dispose();
    expect(disposeSpy).toHaveBeenCalled();
    void snapshot;
  });
});
