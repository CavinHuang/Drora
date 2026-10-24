/**
 * 单播报者 claim 端口（specs/voice-agent-integration.md §2.3 / §3.5）。
 *
 * 走既有 BroadcastHub 通用 claim 通道（reserve/commit/release 三消息 + TTL 过期清理，
 * packages/desktop/src/main/broadcastHub.ts:24-25/:64-92），零新协议。本文件只定义端口；
 * BroadcastHub 适配实现属 Phase 1b（§9.3 voiceAnnouncementClaim.ts 装配），届时
 * acquire = reserve+commit，renew = 周期续约（VOICE_CLAIM_RENEW_INTERVAL_MS），
 * release 时机 = AnnIdle / 播报开关关闭 / 窗口关闭三处（§3.5-4）。
 */

export interface VoiceAnnouncementClaimPort {
  /** reserve+commit；false = 他窗持有。key = VOICE_BROADCAST_CLAIM_KEY.announcement。 */
  acquire(key: string): Promise<boolean>;
  /** 续约；false = 已被抢，调用方必须立即 tts.cancel() 回 AnnIdle（以 claim 为准校正本地态）。 */
  renew(key: string): Promise<boolean>;
  release(key: string): void;
}

// ── BroadcastHub 适配（specs §3.5，Phase 1b 装配）──

import type { BroadcastClaimLease, IBroadcastService } from "@drora/services";

/**
 * 照 packages/desktop/src/main/broadcastHub.ts:24-25/:89-166 的 reservation 语义适配
 * VoiceAnnouncementClaimPort：
 * - acquire = acquireClaim（5s TTL reservation，first-wins）；
 * - renew = release 旧 reservation 后立刻 re-acquire——Main 侧没有 renew 原语，且
 *   commitClaim 是「应用进程生命周期内永久」语义，正是 spec §3.5-1 明确拒绝的
 *   「窗口崩溃泄漏 claim → 所有窗口永久静音」形态；release+acquire 有毫秒级空窗，
 *   空窗被他窗抢走即 renew=false（以 claim 为准校正本地态，§3.5-3）；
 * - unavailable（无 Host 桥，如纯 Web 单窗口）降级为获取成功：单窗口无仲裁对象。
 */
export function createBroadcastAnnouncementClaimAdapter(
  broadcastService: Pick<IBroadcastService, "acquireClaim" | "releaseClaim"> | null | undefined,
): VoiceAnnouncementClaimPort {
  const leaseByKey = new Map<string, BroadcastClaimLease>();
  return {
    async acquire(key) {
      if (!broadcastService) {
        return true; // 无广播面：单窗口降级，直接视为持有。
      }
      const result = await broadcastService.acquireClaim(key);
      if (result.status === "acquired") {
        leaseByKey.set(key, result.lease);
        return true;
      }
      // committed/unavailable：committed 不会出现（本适配从不 commit）；unavailable
      // = 无仲裁面，降级为持有。busy = 他窗持有。
      return result.status === "unavailable";
    },
    async renew(key) {
      if (!broadcastService) {
        return true;
      }
      const previous = leaseByKey.get(key);
      if (previous) {
        // 先释放旧 reservation 再抢新 reservation（见头注：Main 无 renew 原语）。
        // release 失败不阻塞重抢：TTL 5s 兜底回收。
        try {
          await broadcastService.releaseClaim(previous);
        } catch {
          // 忽略：旧 lease 过期后 release 是 no-op。
        }
      }
      const result = await broadcastService.acquireClaim(key);
      if (result.status === "acquired") {
        leaseByKey.set(key, result.lease);
        return true;
      }
      leaseByKey.delete(key);
      return result.status === "unavailable";
    },
    release(key) {
      const lease = leaseByKey.get(key);
      leaseByKey.delete(key);
      if (lease && broadcastService) {
        void broadcastService.releaseClaim(lease).catch(() => {
          // 释放失败不阻塞 UI：TTL 兜底回收（§3.5-4 窗口崩溃同理）。
        });
      }
    },
  };
}
