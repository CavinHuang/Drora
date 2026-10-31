/**
 * worker 主循环消息串行化（CONTRACT.md「管理请求在飞时 close 会等待回执（在途请求
 * 完成后再关）」的机制保障，评审修复）：业务事务在 BUSY 退避的 sleep 处让出事件循环，
 * 逐消息 IIFE 并发模型下 close 的 store.close() 可在该窗口并发执行，把在飞请求打成
 * storage_unavailable。修复后每条消息链式接在前一条完成之后——本文件以受控 store 替身
 * （vi.mock openPersonaStore）确定性钉住：在飞请求挂起时 close 不执行；请求回执后
 * close 才关库、回执并退出。
 */
import { EventEmitter } from "node:events";
import type { MessagePort } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import type { PersonaWorkerOpenData, PersonaWorkerResponse } from "../../src/storage/persona/persona-store-worker-protocol.js";

const h = vi.hoisted(() => {
  const state: { store?: Record<string, unknown> } = {};
  return {
    state,
    openPersonaStore: vi.fn(async () => state.store),
  };
});

vi.mock("../../src/storage/persona/persona-store.js", () => ({
  openPersonaStore: h.openPersonaStore,
}));

import { runPersonaWorkerServer } from "../../src/storage/persona/persona-store-worker-main.js";

class MockPort extends EventEmitter {
  sent: PersonaWorkerResponse[] = [];
  closed = false;
  postMessage(message: PersonaWorkerResponse): void {
    this.sent.push(message);
  }
  close(): void {
    this.closed = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resultOf(port: MockPort, id: number): PersonaWorkerResponse | undefined {
  return port.sent.find((message) => message.kind === "result" && message.id === id);
}

describe("persona worker 主循环：close 等待在飞请求", () => {
  it("在飞请求挂起时 close 不执行；请求回执后 close 才关库并回执", async () => {
    let releaseSnapshot: (value: unknown) => void = () => {};
    let snapshotCalls = 0;
    const closeCalls: number[] = [];
    h.state.store = {
      readSnapshot: () => {
        snapshotCalls += 1;
        return new Promise((resolve) => {
          releaseSnapshot = resolve;
        });
      },
      close: async () => {
        closeCalls.push(snapshotCalls);
      },
    };
    const port = new MockPort();
    void runPersonaWorkerServer(port as unknown as MessagePort, {
      dbPath: "D:/tmp/persona.sqlite",
    } as PersonaWorkerOpenData);
    await vi.waitFor(() => {
      expect(port.sent.some((message) => message.kind === "ready")).toBe(true);
    });
    port.emit("message", { kind: "call", id: 1, op: "readSnapshot", input: undefined });
    await vi.waitFor(() => expect(snapshotCalls).toBe(1));
    // 在飞请求挂起期间发送 close（旧实现此刻会并发执行 store.close()）。
    port.emit("message", { kind: "close", id: 2 });
    await sleep(30);
    expect(closeCalls).toHaveLength(0);
    expect(resultOf(port, 2)).toBeUndefined();
    // 放行在飞请求：先回执请求，然后 close 才关库、回执并关闭端口。
    releaseSnapshot({ state: "uninitialized" });
    await vi.waitFor(() => expect(closeCalls).toEqual([1]));
    await vi.waitFor(() => {
      expect(resultOf(port, 2)).toMatchObject({ ok: true });
    });
    expect(port.closed).toBe(true);
    // 回执顺序：在飞请求的回执先于 close 回执。
    const requestResultIndex = port.sent.findIndex(
      (message) => message.kind === "result" && message.id === 1,
    );
    const closeResultIndex = port.sent.findIndex(
      (message) => message.kind === "result" && message.id === 2,
    );
    expect(requestResultIndex).toBeGreaterThanOrEqual(0);
    expect(closeResultIndex).toBeGreaterThan(requestResultIndex);
  });

  it("空闲时 close 立即关库、回执并退出（既有语义不变）", async () => {
    const closeCalls: number[] = [];
    h.state.store = {
      close: async () => {
        closeCalls.push(1);
      },
    };
    const port = new MockPort();
    void runPersonaWorkerServer(port as unknown as MessagePort, {
      dbPath: "D:/tmp/persona.sqlite",
    } as PersonaWorkerOpenData);
    await vi.waitFor(() => {
      expect(port.sent.some((message) => message.kind === "ready")).toBe(true);
    });
    port.emit("message", { kind: "close", id: 7 });
    await vi.waitFor(() => expect(closeCalls).toHaveLength(1));
    await vi.waitFor(() => {
      expect(resultOf(port, 7)).toMatchObject({ ok: true });
    });
    expect(port.closed).toBe(true);
  });
});
