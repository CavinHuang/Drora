/**
 * 跨窗口播报 reservation（spec §3.5 / §9.8.2）。
 * 每次获取返回具体 lease，旧意图只能释放自己的 lease，不按 key 改写/释放新意图。
 */
import type { BroadcastClaimLease, IBroadcastService } from "@drora/services";
export type VoiceAnnouncementLease = Readonly<BroadcastClaimLease>;
export interface VoiceAnnouncementClaimPort {
  acquire(key: string): Promise<VoiceAnnouncementLease | null>;
  renew(lease: VoiceAnnouncementLease): Promise<VoiceAnnouncementLease | null>;
  release(lease: VoiceAnnouncementLease): void;
}
let localLeaseSequence = 0;

/**
 * 照 packages/desktop/src/main/broadcastHub.ts:24-25/:89-166 的 reservation 语义适配
 * VoiceAnnouncementClaimPort（§9.8.2 lease 凭证形态）：
 * - acquire = acquireClaim（5s TTL reservation，first-wins）；
 * - renew = release 旧 reservation 后立刻 re-acquire——Main 侧没有 renew 原语，且
 *   commitClaim 是「应用进程生命周期内永久」语义，正是 spec §3.5-1 明确拒绝的
 *   「窗口崩溃泄漏 claim → 所有窗口永久静音」形态；release+acquire 有毫秒级空窗，
 *   空窗被他窗抢走即 renew=null（以 claim 为准校正本地态，§3.5-3）；
 * - §9.9.3-L7 unavailable 二分：经由非空 broadcastService 出现的 unavailable 只能是
 *   请求超时/传输失败（broadcastService.ts:185-196 自述「claim 超时不能乐观播放；
 *   Main 可能已把同一 key 授予另一窗口」）——一律不持有（返回 null），防双窗叠音；
 *   真正的「无仲裁面」= broadcastService 缺席（result 为 undefined，单窗口无仲裁
 *   对象，降级持有 local lease）。已知代价：host 桥启动竞态下首次播报可能静默一次
 *   （2s 超时窗），以 claim 真值为准，不做乐观播放、不加超时重试掩盖。
 *   融合：§9.8 lease 骨架 + §9.9-L7 unavailable 拒绝语义（原 HEAD 把 unavailable
 *   当作可降级持有，违反 §3.5-3「以 claim 为准」，本处收紧）。
 */
export function createBroadcastAnnouncementClaimAdapter(
  broadcastService: Pick<IBroadcastService, "acquireClaim" | "releaseClaim"> | null | undefined,
): VoiceAnnouncementClaimPort {
  const active = new Map<VoiceAnnouncementLease, boolean>();
  const acquire = async (key: string): Promise<VoiceAnnouncementLease | null> => {
    const result = await broadcastService?.acquireClaim(key);
    // 融合：§9.9.3-L7——busy（他窗持有）与 unavailable（超时/传输失败）都不持有；
    // 唯一降级持有面是 broadcastService 缺席（result 为 undefined 的下方分支）。
    if (result && result.status !== "acquired") return null;
    const remote = result?.status === "acquired";
    const lease = remote ? result.lease : { key, token: `local-voice-${++localLeaseSequence}` };
    active.set(lease, remote);
    return lease;
  };
  const release = async (lease: VoiceAnnouncementLease): Promise<void> => {
    const remote = active.get(lease);
    if (!active.delete(lease)) return;
    if (remote && broadcastService) {
      try {
        await broadcastService.releaseClaim(lease);
      } catch {
        /* TTL 回收失败的 reservation，不能误释放别的 token。 */
      }
    }
  };
  return {
    // 融合：保留 §9.8.2 lease 凭证形态（旧意图只能释放自己的 lease）；
    // §9.9-L7 的 unavailable 拒绝已并入上方 acquire 实现。
    acquire,
    async renew(lease) {
      if (!active.has(lease)) return null;
      await release(lease);
      return acquire(lease.key);
    },
    release(lease) {
      void release(lease);
    },
  };
}
