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

export function createBroadcastAnnouncementClaimAdapter(
  broadcastService: Pick<IBroadcastService, "acquireClaim" | "releaseClaim"> | null | undefined,
): VoiceAnnouncementClaimPort {
  const active = new Map<VoiceAnnouncementLease, boolean>();
  const acquire = async (key: string): Promise<VoiceAnnouncementLease | null> => {
    const result = await broadcastService?.acquireClaim(key);
    if (result && result.status !== "acquired" && result.status !== "unavailable") return null;
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
