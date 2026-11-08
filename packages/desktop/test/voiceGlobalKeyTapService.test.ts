import { describe, expect, it, vi } from "vitest";
import {
  createVoiceGlobalKeyTapService,
  parseKeyTapLine,
  type KeyTapProcessLike,
} from "../src/main/voiceGlobalKeyTapService.js";

/**
 * §5.6 系统级听写触发服务契约（specs/voice-agent-integration.md §5.6）：helper 行协议
 * 解析（listening/trigger/denied）；生命周期（开关启停/denied 不重启/意外退出指数退避/
 * listening 清零重试计数）；target 路由（Drora 聚焦=composer，否则=global）。
 */

interface FakeChild {
  stdout: { push(line: string): void };
  emitError(error: Error): void;
  emitClose(code: number): void;
  killed: boolean;
  child: KeyTapProcessLike;
}

function fakeChild(): FakeChild {
  const listeners = {
    error: [] as Array<(e: Error) => void>,
    close: [] as Array<(c: number | null) => void>,
  };
  const fake: FakeChild = {
    stdout: { push: () => undefined },
    emitError: (error) => listeners.error.forEach((cb) => cb(error)),
    emitClose: (code) => listeners.close.forEach((cb) => cb(code)),
    killed: false,
    child: null as unknown as KeyTapProcessLike,
  };
  fake.child = {
    once: (event: "error" | "close", cb: never) => {
      (listeners[event] as unknown[]).push(cb);
    },
    kill: () => {
      fake.killed = true;
    },
    stdout: null as unknown as NodeJS.ReadableStream,
  };
  return fake;
}

function makeDeps(overrides: Partial<Parameters<typeof createVoiceGlobalKeyTapService>[0]> = {}) {
  const children: FakeChild[] = [];
  const triggers: Array<{ target: string }> = [];
  const states: Array<{ status: string }> = [];
  const deps = {
    spawnHelper: () => {
      const child = fakeChild();
      children.push(child);
      return child.child;
    },
    readLines: (child: KeyTapProcessLike, onLine: (line: string) => void) => {
      const fake = children.find((c) => c.child === child)!;
      fake.stdout.push = (line) => onLine(line);
    },
    resolveTarget: () => "global" as const,
    sendTrigger: (event: { target: string }) => triggers.push(event),
    sendState: (frame: { status: string }) => states.push(frame),
    restartDelaysMs: [10, 20, 40],
    ...overrides,
  };
  return { deps, children, triggers, states };
}

describe("key-tap 行协议解析", () => {
  it("listening/trigger/denied 三事件；非 JSON 与未知事件忽略", () => {
    expect(parseKeyTapLine('{"event":"listening"}')).toEqual({ event: "listening" });
    expect(parseKeyTapLine('{"event":"trigger"}')).toEqual({ event: "trigger" });
    expect(parseKeyTapLine('{"event":"denied"}')).toEqual({ event: "denied" });
    expect(parseKeyTapLine("not json")).toBeNull();
    expect(parseKeyTapLine('{"event":"other"}')).toBeNull();
  });
});

describe("触发服务生命周期", () => {
  it("trigger → 按前台判定 target 推送；listening → 状态帧", () => {
    const { deps, children, triggers, states } = makeDeps();
    const service = createVoiceGlobalKeyTapService(deps);
    service.start();
    children[0]!.stdout.push('{"event":"listening"}');
    children[0]!.stdout.push('{"event":"trigger"}');
    expect(triggers).toEqual([{ target: "global" }]);
    expect(states).toEqual([{ status: "listening" }]);
    service.stop();
    expect(children[0]!.killed).toBe(true);
  });

  it("denied → 状态 denied 且不再重启（授权后由用户重开）", async () => {
    const { deps, children, states } = makeDeps();
    const service = createVoiceGlobalKeyTapService(deps);
    service.start();
    children[0]!.stdout.push('{"event":"denied"}');
    children[0]!.emitClose(2);
    await new Promise((resolve) => setTimeout(resolve, 60)); // 超过全部退避延迟
    expect(children).toHaveLength(1); // 无重启
    expect(states).toEqual([{ status: "denied" }]);
    expect(service.isRunning()).toBe(false);
  });

  it("意外退出 → 指数退避重启；listening 后计数清零", async () => {
    const { deps, children } = makeDeps();
    const service = createVoiceGlobalKeyTapService(deps);
    service.start();
    children[0]!.stdout.push('{"event":"listening"}');
    children[0]!.emitClose(1); // 意外退出 → 10ms 后重启
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(children).toHaveLength(2);
    children[1]!.stdout.push('{"event":"listening"}'); // 计数清零
    children[1]!.emitClose(1);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(children).toHaveLength(3); // 又从第一档退避开始
    service.stop();
  });

  it("start 幂等；stop 后不重启", async () => {
    const { deps, children } = makeDeps();
    const service = createVoiceGlobalKeyTapService(deps);
    service.start();
    service.start();
    expect(children).toHaveLength(1);
    service.stop();
    children[0]!.emitClose(1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(children).toHaveLength(1); // 已停：不重启
  });
});
