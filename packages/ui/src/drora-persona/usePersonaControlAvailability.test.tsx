// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * usePersonaControlAvailability 门控守护（合同 §4.1 双层能力发现）：
 * - hello.capabilities.personaControlV1 === true 才 available；缺失（旧 Host）一律 unavailable；
 * - 平台门不满足时直接 unavailable，不发握手；
 * - 握手失败（Host 未就绪/断线）按 unavailable 降级，失败结果不缓存（重连可重试）；
 * - 不试发 persona 方法探测。
 */

const mocks = vi.hoisted(() => ({
  ensureHandshake: vi.fn(),
}));

vi.mock("@/v4/agentV4ConnectionHandshake.js", () => ({
  ensureAgentV4ConnectionHandshake: mocks.ensureHandshake,
}));

vi.mock("@/logger.js", () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { usePersonaControlAvailability } =
  await import("@/drora-persona/usePersonaControlAvailability.js");

const handshakeService = {
  helloConversationV4: vi.fn(),
  initializeConversationV4: vi.fn(),
};

function capabilities(personaControlV1?: boolean) {
  return {
    nativeDialogs: true,
    localTerminal: true,
    binaryFrames: false,
    compression: "none" as const,
    ...(personaControlV1 === undefined ? {} : { personaControlV1 }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePersonaControlAvailability", () => {
  it("hello 广告 personaControlV1=true 时可用", async () => {
    mocks.ensureHandshake.mockResolvedValue({ capabilities: capabilities(true) });
    const { result } = renderHook(() =>
      usePersonaControlAvailability({ service: handshakeService, enabled: true }),
    );
    expect(result.current).toBe("checking");
    await waitFor(() => {
      expect(result.current).toBe("available");
    });
    expect(mocks.ensureHandshake).toHaveBeenCalledTimes(1);
  });

  it("旧 Host 缺失该键等价于 false：入口关闭，原功能不受影响", async () => {
    mocks.ensureHandshake.mockResolvedValue({ capabilities: capabilities(undefined) });
    const { result } = renderHook(() =>
      usePersonaControlAvailability({ service: handshakeService, enabled: true }),
    );
    await waitFor(() => {
      expect(result.current).toBe("unavailable");
    });
  });

  it("平台门不满足时直接 unavailable，不发握手", async () => {
    const { result } = renderHook(() =>
      usePersonaControlAvailability({ service: handshakeService, enabled: false }),
    );
    expect(result.current).toBe("unavailable");
    expect(mocks.ensureHandshake).not.toHaveBeenCalled();
  });

  it("握手失败按 unavailable 降级；失败不缓存，重连后重新探测可恢复", async () => {
    mocks.ensureHandshake.mockRejectedValueOnce(new Error("host not ready"));
    const first = renderHook(() =>
      usePersonaControlAvailability({ service: handshakeService, enabled: true }),
    );
    await waitFor(() => {
      expect(first.result.current).toBe("unavailable");
    });
    first.unmount();
    // 重连后（同一服务对象、握手现在成功）重新探测：状态可用。
    mocks.ensureHandshake.mockResolvedValue({ capabilities: capabilities(true) });
    const second = renderHook(() =>
      usePersonaControlAvailability({ service: handshakeService, enabled: true }),
    );
    await waitFor(() => {
      expect(second.result.current).toBe("available");
    });
    second.unmount();
  });
});
