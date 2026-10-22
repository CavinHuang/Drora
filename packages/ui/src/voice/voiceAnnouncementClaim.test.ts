import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBroadcastAnnouncementClaimAdapter } from "./voiceAnnouncementClaim.js";
import type { BroadcastClaimLease, IBroadcastService } from "@drora/services";

/**
 * BroadcastHub claim 适配守护（specs/voice-agent-integration.md §3.5）：
 * acquire = 5s TTL reservation；renew = release 旧 lease 后 re-acquire（Main 无 renew
 * 原语，commitClaim 的永久语义被 spec §3.5-1 明确拒绝）；busy = 被抢；unavailable =
 * 无仲裁面降级为持有。
 */

function makeBroadcastService() {
  const leases: BroadcastClaimLease[] = [];
  let mode: "acquired" | "busy" | "unavailable" = "acquired";
  const releaseCalls: BroadcastClaimLease[] = [];
  const service = {
    acquireClaim: vi.fn(async () => {
      if (mode === "acquired") {
        const lease: BroadcastClaimLease = { key: "k", token: `t-${leases.length + 1}` };
        leases.push(lease);
        return { status: "acquired", lease } as const;
      }
      if (mode === "busy") {
        return { status: "busy", retryAfterMs: 250 } as const;
      }
      return { status: "unavailable" } as const;
    }),
    releaseClaim: vi.fn(async (lease: BroadcastClaimLease) => {
      releaseCalls.push(lease);
    }),
    commitClaim: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    tryClaim: vi.fn(async () => true),
    onMessage: (() => () => undefined) as unknown as IBroadcastService["onMessage"],
  };
  return {
    service: service as unknown as IBroadcastService & typeof service,
    leases,
    releaseCalls,
    setMode: (next: "acquired" | "busy" | "unavailable") => {
      mode = next;
    },
  };
}

describe("createBroadcastAnnouncementClaimAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acquires a reservation and keeps the lease for release", async () => {
    const { service, leases } = makeBroadcastService();
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    await expect(adapter.acquire("k")).resolves.toBe(true);
    expect(leases).toHaveLength(1);
    adapter.release("k");
    expect(service.releaseClaim).toHaveBeenCalledWith(leases[0]);
  });

  it("reports busy as not acquired (他窗持有 → 未持有者静默)", async () => {
    const { service, setMode } = makeBroadcastService();
    setMode("busy");
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    await expect(adapter.acquire("k")).resolves.toBe(false);
  });

  it("degrades unavailable (无广播面) to holding", async () => {
    const { service, setMode } = makeBroadcastService();
    setMode("unavailable");
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    await expect(adapter.acquire("k")).resolves.toBe(true);
    await expect(adapter.renew("k")).resolves.toBe(true);
  });

  it("renews by releasing the old lease then re-acquiring (FD-2 周期续约)", async () => {
    const { service, leases, releaseCalls } = makeBroadcastService();
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    await adapter.acquire("k");
    await expect(adapter.renew("k")).resolves.toBe(true);
    // 先 release 旧 reservation，再拿新 lease（token 递增）。
    expect(releaseCalls).toEqual([leases[0]]);
    expect(leases[1]?.token).toBe("t-2");
  });

  it("returns false when the re-acquire after release loses the race (§3.5-3 renew=false)", async () => {
    const { service, setMode } = makeBroadcastService();
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    await adapter.acquire("k");
    setMode("busy");
    await expect(adapter.renew("k")).resolves.toBe(false);
    // renew 已 release 旧 lease；输掉竞争后本地不再持有 lease，
    // 显式 release 不再触发第二次 releaseClaim。
    service.releaseClaim.mockClear();
    adapter.release("k");
    expect(service.releaseClaim).not.toHaveBeenCalled();
  });

  it("degrades to a no-op port when there is no broadcast service", async () => {
    const adapter = createBroadcastAnnouncementClaimAdapter(null);
    await expect(adapter.acquire("k")).resolves.toBe(true);
    await expect(adapter.renew("k")).resolves.toBe(true);
    expect(() => adapter.release("k")).not.toThrow();
  });
});
