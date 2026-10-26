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

describe("createBroadcastAnnouncementClaimAdapter (§9.8 concrete leases)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("returns the actual lease and releases it idempotently", async () => {
    const { service, leases } = makeBroadcastService();
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    const lease = await adapter.acquire("k");
    expect(lease).toBe(leases[0]);
    adapter.release(lease!);
    adapter.release(lease!);
    expect(service.releaseClaim).toHaveBeenCalledTimes(1);
    expect(service.releaseClaim).toHaveBeenCalledWith(lease);
  });
  it("reports busy as null", async () => {
    const { service, setMode } = makeBroadcastService();
    setMode("busy");
    await expect(createBroadcastAnnouncementClaimAdapter(service).acquire("k")).resolves.toBeNull();
  });
  it.each(["unavailable", "absent"] as const)("uses explicit local leases for %s", async (mode) => {
    const { service, setMode } = makeBroadcastService();
    setMode("unavailable");
    const adapter = createBroadcastAnnouncementClaimAdapter(mode === "absent" ? null : service);
    const lease = await adapter.acquire("k");
    expect(lease?.key).toBe("k");
    const renewed = await adapter.renew(lease!);
    expect(renewed).not.toBeNull();
    expect(renewed).not.toBe(lease);
    adapter.release(renewed!);
    expect(service.releaseClaim).not.toHaveBeenCalled();
  });
  it("releases the previous reservation before renewing, stale release cannot touch the new token", async () => {
    const { service, leases, releaseCalls } = makeBroadcastService();
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    const old = await adapter.acquire("k");
    const current = await adapter.renew(old!);
    expect(releaseCalls).toEqual([leases[0]]);
    expect(current).toBe(leases[1]);
    adapter.release(old!);
    expect(releaseCalls).toEqual([leases[0]]);
    adapter.release(current!);
    expect(releaseCalls).toEqual(leases);
  });
  it("losing renewal returns null and a released lease cannot be renewed", async () => {
    const { service, setMode } = makeBroadcastService();
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    const old = await adapter.acquire("k");
    setMode("busy");
    await expect(adapter.renew(old!)).resolves.toBeNull();
    await expect(adapter.renew(old!)).resolves.toBeNull();
    expect(service.acquireClaim).toHaveBeenCalledTimes(2);
    adapter.release(old!);
    expect(service.releaseClaim).toHaveBeenCalledTimes(1);
  });
  it("a late old acquire is released by its own lease, never the newer lease", async () => {
    const { service, leases, releaseCalls } = makeBroadcastService();
    const acquireReal = service.acquireClaim;
    let resolveOld: ((value: Awaited<ReturnType<typeof acquireReal>>) => void) | undefined;
    service.acquireClaim = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementation(acquireReal);
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    const oldPromise = adapter.acquire("k");
    const current = await adapter.acquire("k");
    const old = { key: "k", token: "late-old" };
    resolveOld?.({ status: "acquired", lease: old });
    const late = await oldPromise;
    adapter.release(late!);
    expect(releaseCalls).toEqual([old]);
    adapter.release(current!);
    expect(releaseCalls).toEqual([old, leases[0]]);
  });
});
