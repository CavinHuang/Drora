// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createCloudTtsAdapter } from "./cloudTtsAdapter.js";

/**
 * 火山真流式播报契约（specs/model-capabilities.md §16）：流式分支帧编排（data/done/error/
 * seq 断号 fail-closed）、通道缺席回退整段、回落计数等价性。整段路径契约见 cloudTtsAdapter.test.ts。
 */
// 从 cloudTtsAdapter.test.ts 原位拆出（max-file-lines 800 上限）。

describe("火山真流式播报（specs/model-capabilities.md §16）", () => {
  const VOLCANO_BASE = "https://openspeech.bytedance.com";
  const CONFIG = {
    baseUrl: VOLCANO_BASE,
    model: "zh_female_wanwanxiaohe_moon_bigtts",
    apiKey: "tlk-new-console-key",
  };

  function makeStreamPort() {
    const handlers = new Set<(frame: import("@drora/shared").VoiceVendorProxyStreamChunkFrame) => void>();
    const started: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const aborted: string[] = [];
    return {
      handlers,
      started,
      aborted,
      start: vi.fn(async (request: { url: string; headers: Record<string, string>; body: string }) => {
        started.push(request);
        return { streamId: "s-1" };
      }),
      onChunk: (handler: (frame: import("@drora/shared").VoiceVendorProxyStreamChunkFrame) => void) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      abort: vi.fn(async (payload: { streamId: string }) => {
        aborted.push(payload.streamId);
      }),
      emit(frame: import("@drora/shared").VoiceVendorProxyStreamChunkFrame) {
        for (const handler of handlers) {
          handler(frame);
        }
      },
    };
  }

  function makePlayerFactory() {
    const players: Array<{
      appended: string[];
      finished: boolean;
      failedWith: Error | null;
      interrupted: boolean;
      complete: (outcome: "end" | "error") => void;
    }> = [];
    const factory = () => {
      let resolveFn: (outcome: "end" | "error") => void = () => {};
      const completed = new Promise<"end" | "error">((r) => {
        resolveFn = r;
      });
      const player = {
        appended: [] as string[],
        playedAny: false,
        finished: false,
        failedWith: null as Error | null,
        interrupted: false,
        completed: false,
        complete: resolveFn,
      };
      players.push(player);
      return {
        appendChunk: (b64: string) => {
          player.appended.push(b64);
          player.playedAny = true;
        },
        finish: () => {
          player.finished = true;
        },
        fail: (error: Error) => {
          player.failedWith = error;
          // 镜像生产 fail 语义：未播 → 硬失败 error；已播 → 宽容 end。
          if (!player.completed) {
            player.completed = true;
            resolveFn(player.playedAny ? "end" : "error");
          }
        },
        // 镜像生产 failNow：无条件结算 error（§16 审查修复——断号必须 error 不归零回落计数）。
        failNow: (error: Error) => {
          player.failedWith = error;
          player.interrupted = true;
          if (!player.completed) {
            player.completed = true;
            resolveFn("error");
          }
        },
        handle: {
          completed,
          stop: () => {
            player.interrupted = true;
            // 镜像生产 interrupt 语义：立即结算 end（宽容中断）。
            if (!player.completed) {
              player.completed = true;
              resolveFn("end");
            }
          },
        },
      };
    };
    return { factory, players };
  }

  it("流式路径：data 分片喂 player、done 触发 finish、播完 settle end", async () => {
    vi.useFakeTimers();
    try {
      const port = makeStreamPort();
      const { factory, players } = makePlayerFactory();
      const adapter = createCloudTtsAdapter({
        getVendorConfig: async () => CONFIG,
        stream: port as never,
        streamPlaybackFactory: factory as never,
      });
      const doneReasons: string[] = [];
      adapter.onDone((_h, reason) => doneReasons.push(reason));
      adapter.speak({ text: "你好", lang: "zh-CN" });
      await vi.advanceTimersByTimeAsync(0);
      expect(port.started).toHaveLength(1);
      expect(port.started[0]!.url).toBe(`${VOLCANO_BASE}/api/v3/tts/unidirectional`);
      port.emit({ streamId: "s-1", seq: 0, kind: "data", base64Chunk: "YWJj" });
      port.emit({ streamId: "s-1", seq: 1, kind: "data", base64Chunk: "ZGVm" });
      port.emit({ streamId: "s-1", seq: 2, kind: "done" });
      expect(players[0]!.appended).toEqual(["YWJj", "ZGVm"]);
      expect(players[0]!.finished).toBe(true);
      players[0]!.complete("end");
      await vi.advanceTimersByTimeAsync(0);
      expect(doneReasons).toEqual(["end"]);
      // 结束后 abort 上游（流生命周期收尾；settle 的 cancelFn 与 completed.finally
      // 各 abort 一次，幂等无害——main GC 表已摘则静默）。
      expect(port.aborted).toContain("s-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("error 帧 → player.fail；从未播出 → settle error 进回落计数", async () => {
    vi.useFakeTimers();
    try {
      const port = makeStreamPort();
      const { factory, players } = makePlayerFactory();
      const adapter = createCloudTtsAdapter({
        getVendorConfig: async () => CONFIG,
        stream: port as never,
        streamPlaybackFactory: factory as never,
      });
      const doneReasons: string[] = [];
      adapter.onDone((_h, reason) => doneReasons.push(reason));
      adapter.speak({ text: "你好", lang: "zh-CN" });
      await vi.advanceTimersByTimeAsync(0);
      port.emit({ streamId: "s-1", seq: 0, kind: "error", status: 401, errorMessage: "Invalid X-Api-Key" });
      expect(players[0]!.failedWith?.message).toBe("Invalid X-Api-Key");
      // fail（宽容）在未播时直接 error 结算 → onDone(error)（回落计数路径）。
      await vi.advanceTimersByTimeAsync(0);
      expect(doneReasons).toEqual(["error"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("seq 断号 → fail-closed：abort 上游 + interrupt + fail", async () => {
    vi.useFakeTimers();
    try {
      const port = makeStreamPort();
      const { factory, players } = makePlayerFactory();
      const adapter = createCloudTtsAdapter({
        getVendorConfig: async () => CONFIG,
        stream: port as never,
        streamPlaybackFactory: factory as never,
      });
      adapter.speak({ text: "你好", lang: "zh-CN" });
      await vi.advanceTimersByTimeAsync(0);
      port.emit({ streamId: "s-1", seq: 0, kind: "data", base64Chunk: "YWJj" });
      const doneReasons: string[] = [];
      adapter.onDone((_h, reason) => doneReasons.push(reason));
      port.emit({ streamId: "s-1", seq: 5, kind: "data", base64Chunk: "ZGVm" }); // 断号
      expect(port.aborted).toContain("s-1");
      expect(players[0]!.interrupted).toBe(true);
      expect(players[0]!.failedWith?.message).toContain("out of order");
      // §16.5 关键断言：断号必须结算 error（回落计数照旧），不得宽容 end。
      await vi.advanceTimersByTimeAsync(0);
      expect(doneReasons).toEqual(["error"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("通道缺席（deps.stream 未注入）→ 回退整段路径（fetch 被调用）", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        [
          JSON.stringify({ code: 0, data: Buffer.from("hi").toString("base64") }),
          JSON.stringify({ code: 20000000, message: "success" }),
        ].join("\n"),
    }));
    const adapter = createCloudTtsAdapter({
      getVendorConfig: async () => CONFIG,
      fetch: fetchMock as never,
      playBlob: () => {
        let resolveFn: (outcome: "end" | "error") => void = () => {};
        return {
          completed: new Promise<"end" | "error">((r) => {
            resolveFn = r;
          }),
          stop: () => resolveFn("end"),
        };
      },
    });
    adapter.speak({ text: "你好", lang: "zh-CN" });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const request = (fetchMock.mock.calls[0] as unknown as [string, RequestInit] | undefined)?.[0];
    expect(request).toBe(`${VOLCANO_BASE}/api/v3/tts/unidirectional`);
  });
});