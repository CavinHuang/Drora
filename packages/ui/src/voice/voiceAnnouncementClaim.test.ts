import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBroadcastAnnouncementClaimAdapter } from "./voiceAnnouncementClaim.js";
import type { BroadcastClaimLease, IBroadcastService } from "@drora/services";

/**
 * BroadcastHub claim 适配守护（specs/voice-agent-integration.md §3.5 / §9.9.3-L7）：
 * acquire = 5s TTL reservation；renew = release 旧 lease 后 re-acquire（Main 无 renew
 * 原语，commitClaim 的永久语义被 spec §3.5-1 明确拒绝）；busy = 被抢；
 * unavailable = 请求超时/传输失败 → **不持有**（乐观持有 = Main 可能已把同一 key
 * 授予另一窗口 = 双窗叠音，broadcastService.ts:185-196 自述语义）；真正的无仲裁面
 * = service 缺席（null）才降级持有。
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
  // 融合：§9.9.3-L7 裁决改变 unavailable 行为——经由非空 service 的 unavailable
  //（请求超时/传输失败）一律不持有（乐观持有 = Main 可能已把同一 key 授予另一窗口
  // = 双窗叠音）；仅 service 缺席（真正的无仲裁面）保留 §9.8 的本地 lease 降级持有。
  // HEAD 原「unavailable 乐观降级」用例按裁决改写断言；回退实现（乐观降级）即红。
  it("does NOT hold on unavailable from a live service (§9.9.3-L7 超时/传输失败不乐观持有)", async () => {
    const { service, setMode } = makeBroadcastService();
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    const old = await adapter.acquire("k");
    expect(old).not.toBeNull();
    setMode("unavailable");
    await expect(adapter.acquire("k")).resolves.toBeNull();
    // renew 侧（release 旧 lease 后 re-acquire 落空）同样返回 null → 调用方走 claimLost 链。
    await expect(adapter.renew(old!)).resolves.toBeNull();
  });

  it("uses explicit local leases when the service is absent (§9.8 无仲裁面降级持有)", async () => {
    const adapter = createBroadcastAnnouncementClaimAdapter(null);
    const lease = await adapter.acquire("k");
    expect(lease?.key).toBe("k");
    const renewed = await adapter.renew(lease!);
    expect(renewed).not.toBeNull();
    expect(renewed).not.toBe(lease);
    adapter.release(renewed!);
  });

  it("renews by releasing the old lease then re-acquiring (FD-2 周期续约)", async () => {
    const { service, leases, releaseCalls } = makeBroadcastService();
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    const old = await adapter.acquire("k");
    const next = await adapter.renew(old!);
    // 先 release 旧 reservation，再拿新 lease（token 递增）。
    expect(releaseCalls).toEqual([leases[0]]);
    expect(leases[1]?.token).toBe("t-2");
    expect(next).toBe(leases[1]);
  });

  it("returns null when the re-acquire after release loses the race (§3.5-3 renew=null)", async () => {
    const { service, setMode } = makeBroadcastService();
    const adapter = createBroadcastAnnouncementClaimAdapter(service);
    const old = await adapter.acquire("k");
    setMode("busy");
    await expect(adapter.renew(old!)).resolves.toBeNull();
    // renew 已 release 旧 lease；输掉竞争后本地不再持有 lease，
    // 显式 release 不再触发第二次 releaseClaim。
    service.releaseClaim.mockClear();
    adapter.release(old!);
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
