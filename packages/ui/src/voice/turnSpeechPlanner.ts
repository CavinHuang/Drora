/**
 * 播报规划器（specs/voice-agent-integration.md §2.3 / §3.2 播报腿 / §3.3 顺延规则 /
 * §4.7 句粒度暂停续播 / §3.5 单播报者 claim）。
 *
 * 职责边界：规划器只做「句队列规划 + tts/claim 驱动」；播报腿状态的单一所有者是
 * packages/ui/src/store/voiceSessionStore.ts（§3.1），规划器经 AnnouncementLegControl
 * 受控迁移面写入（本文件定义端口，createVoiceSessionAnnouncementControl 提供按 store
 * actions 的适配）。权限内容播报（uninterruptible 段的产生）属 Phase 1b，届时经
 * control.setUninterruptible 置位，打断词通道守卫已在 store 侧生效（§3.3）。
 *
 * 对 §2.3 画出签名的 additive 扩展（记录于批次 deviations）：
 * - deps.announcementControl：§3.1 冻结播报腿状态所有者为 voiceSessionStore，规划器必须
 *   经受控面写状态；§2.3 deps 未列出该写入通道。
 * - deps.getAnnouncementVoiceConfig：§6.1 音色/语速键 + 播报语言跟随 locale（§2.3
 *   VoiceTtsUtterance.lang 必填）需要设置读取入口。
 * - deps.cancelTask：§2.3 requestCancelTask 注释「发既有 v4 stop」需要停止分发入口
 *   （Phase 1b 接线既有 stop 面并带 expectedForegroundExecutionId，§4.3 层③）。
 * - TurnSpeechPlanner.dispose：§3.5-4 窗口关闭（Composer 卸载）是 release 时机之一，
 *   需要清理续约定时器与 claim。
 */

import { VOICE_BROADCAST_CLAIM_KEY } from "@drora/shared";
import { logger } from "@/logger.js";
import type {
  VoiceAnnouncementClaimPort,
  VoiceAnnouncementLease,
} from "./voiceAnnouncementClaim.js";
import {
  VOICE_CANCELLING_FALLBACK_TIMEOUT_MS,
  VOICE_CLAIM_RENEW_INTERVAL_MS,
} from "./voiceTuning.js";
import type { VoiceAnnouncementLegState } from "@/store/voiceSessionStore.js";
import type { VoiceTtsHandle, VoiceTtsPort } from "./voiceTtsPort.js";

import { splitTurnIntoSentences } from "./turnSpeechText.js";
export { buildTurnSpeechText, splitTurnIntoSentences } from "./turnSpeechText.js";
export {
  createVoiceSessionAnnouncementControl,
  type AnnouncementLegControl,
} from "./voiceAnnouncementControl.js";
import type { AnnouncementLegControl } from "./voiceAnnouncementControl.js";

export interface TurnSpeechPlannerDeps {
  getFocusedTurnTail(sessionId: string | null): { turnId: string; text: string } | null;
  tts: VoiceTtsPort;
  claim: VoiceAnnouncementClaimPort;
  /** 照 taskNotificationPreferences.ts:33 reader 收口先例：设置关闭后运行时行为一致。 */
  isAnnouncementEnabled(): boolean;
  announcementControl: AnnouncementLegControl;
  /**
   * §6.1 音色/语速 + 播报语言（§9.7.5 lang 键 / §9.7.3 vendorVoice 双轨）；
   * 缺省跟随 navigator.language（系统默认音色/厂商默认音色/语速 1）。
   */
  getAnnouncementVoiceConfig?(): {
    lang: string;
    voice?: string;
    vendorVoice?: string;
    rate?: number;
  };
  /** 层③「停掉任务」→ 既有 v4 stop（带 expectedForegroundExecutionId）；Phase 1b 接线。 */
  cancelTask?(): void;
  /** 权限开始播放前重验，已处理的 pending 请求不能再读出。 */
  isPermissionPending?(permissionId: string): boolean;
  /** 录音是 episode 事实，不能把逐句 injecting 微态当作结束。 */
  isRecording?(): boolean;
  /** claim 续约间隔（§3.5-1：间隔 < TTL/2）；缺省 voiceTuning，测试可缩短。 */
  claimRenewIntervalMs?: number;
  /** Cancelling 兜底（§3.3：5s）；缺省 voiceTuning，测试可缩短。 */
  cancellingFallbackTimeoutMs?: number;
}

export interface TurnSpeechPlanner {
  isAnnouncementOwner(): boolean;
  /** focused 会话轮尾终态就绪（TurnComplete）时调用；内部判定 claim/互斥/顺延规则。 */
  consumeTurnTail(turnTail: { turnId: string; text: string }): void;
  /** 输入腿进入 Recording：当前句播完即停（句粒度，§4.7 裁决）。 */
  notifyUserRecordingStarted(): void;
  /** 输入腿退出 Recording：轮尾仍最新 → 句边界续播；已更新 → 作废只播最新。 */
  notifyUserRecordingEnded(): void;
  /** 点按播报指示停止按钮（层①载体，非 TID_V4_STOP——§3.3 FD-1）：任何播报态立即 cancel 回 AnnIdle，不取消任务。 */
  notifyStopPressed(): void;
  /** ASR final 命中打断词表：层①停播报不续播（uninterruptible 段外）。 */
  notifyInterruptWordHit(): void;
  /** 「停掉任务」命中：层③，发既有 v4 stop（带 expectedForegroundExecutionId）。 */
  requestCancelTask(): void;
  /**
   * 任务被任何停止面取消（TID_V4_STOP / Esc 停止生成——§3.3 FD-1）：播报同步静音经
   * Cancelling 回 AnnIdle；不重复发 v4 stop（停止面已经发过）。additive 于 §2.3。
   */
  notifyExternalTaskStop(): void;
  /**
   * 权限请求内容段（§4.1 播级 / FD-3 优先级 权限>正文）：正在播正文时当前句播完即
   * 插队（句粒度让位），整段标记 uninterruptible（§3.3），连续段背靠背连播；
   * AnnIdle 时立即起播。text 由调用方按 §4.1 截断（200 字符 + 尾缀）。
   */
  consumePermissionSegment(segment: { permissionId: string; text: string }): void;
  /**
   * 工具简报句（§4.2 / FD-3 优先级最低）：仅 AnnIdle 或正文句间且无待播权限段时插播；
   * 录音中（annPaused/未暂停的 recording）/权限段播报中/段间句隙/权限待插队列非空/
   * Cancelling → 丢弃。uninterruptible 不置位（简报可被打断词通道打断）。
   */
  consumeBriefSegment(briefId: string, text: string): void;
  /** Composer 卸载/窗口关闭（§3.5-4 release 时机）：停播、清定时器、release claim。 */
  dispose(): void;
}

function defaultAnnouncementLang(): string {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en-US";
}

export function createTurnSpeechPlanner(deps: TurnSpeechPlannerDeps): TurnSpeechPlanner {
  const claimKey = VOICE_BROADCAST_CLAIM_KEY.announcement;
  const claimRenewIntervalMs = deps.claimRenewIntervalMs ?? VOICE_CLAIM_RENEW_INTERVAL_MS;
  const cancellingFallbackTimeoutMs =
    deps.cancellingFallbackTimeoutMs ?? VOICE_CANCELLING_FALLBACK_TIMEOUT_MS;
  const control = deps.announcementControl;

  /** 当前播报句队列（规划器内部瞬态；句序号与阶段的所有权在 store，§3.1）。 */
  let sentences: string[] = [];
  /** 在播轮尾的 turnId（§3.2 AnnPaused 恢复时与 focused 最新轮尾比对「仍最新」）。 */
  let announcedTurnId: string | null = null;
  let activeHandle: VoiceTtsHandle | null = null;
  let recording = false;
  let disposed = false;
  let intentGeneration = 0;
  let activeLease: VoiceAnnouncementLease | null = null;
  let renewing = false;
  const isRecording = () => deps.isRecording?.() ?? recording;
  const isValid = (generation: number) =>
    !disposed &&
    generation === intentGeneration &&
    control.isOwner() &&
    deps.isAnnouncementEnabled();
  let pendingTail: { turnId: string; text: string } | null = null;
  let claimRenewTimer: ReturnType<typeof setInterval> | null = null;
  let cancellingFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * FD-3 权限段：待插队段（句界拼接）+ 已播 id 去重 + 当前 uninterruptible 窗口
   * [start, end)（句子下标区间；null = 无权限段在播/待播）。
   */
  let pendingPermissionSegments: { permissionId: string; sentences: string[] }[] = [];
  const announcedPermissionIds = new Set<string>();
  /** §4.2 工具简报待插段（FD-3 最低优先级；仅正文句间且无待播权限段插播）。 */
  let pendingBriefSegments: { briefId: string; sentences: string[] }[] = [];
  const announcedBriefIds = new Set<string>();
  let permissionWindow: { start: number; end: number } | null = null;
  /**
   * 轮尾起播链在飞标记：TurnComplete 与权限 pending 常在同一 snapshot 提交内到达，
   * 轮尾 ensureClaimAndSpeak 是异步链——权限段排空等待其在飞结束，再按相位决定
   * 「句界拼接（speaking）或立即起播（annIdle）」，避免双链竞争造成权限段/正文丢失。
   */
  let turnStartInFlight = false;
  let permissionDrainScheduled = false;
  let briefDrainScheduled = false;
  let startChain = Promise.resolve();
  const prunePermissions = () => {
    pendingPermissionSegments = pendingPermissionSegments.filter(
      (segment) => deps.isPermissionPending?.(segment.permissionId) !== false,
    );
  };

  /**
   * 句边界调度：①权限段（FD-3 最高，正文剩余句之前整段插队、uninterruptible 闭合）；
   * ②工具简报（§4.2 最低）：仅当**无待播权限段**时拼在正文余句之前（正文句间插播）；
   * 权限段待插时简报保留，随权限播完后的句界/空闲排空再插（§4.2-5 段间句隙不插）。
   */
  const spliceScheduledSegmentsAtBoundary = (index: number): void => {
    prunePermissions();
    // 权限段专用起播时也要守住整段窗口，不能把 pending 简报插到它的第一句之前。
    if (permissionWindow && index >= permissionWindow.start && index < permissionWindow.end) return;
    const permissionSentences: string[] = [];
    for (const segment of pendingPermissionSegments) {
      permissionSentences.push(...segment.sentences);
    }
    pendingPermissionSegments = [];
    if (permissionSentences.length > 0) {
      sentences.splice(index, 0, ...permissionSentences);
      permissionWindow = { start: index, end: index + permissionSentences.length };
      // §3.3 uninterruptible：整段闭合（段 = 一次权限请求的完整播报；连续段背靠背）。
      control.setUninterruptible(true);
    }
    const briefSentences: string[] = [];
    if (permissionSentences.length === 0) {
      for (const segment of pendingBriefSegments) {
        briefSentences.push(...segment.sentences);
      }
      pendingBriefSegments = [];
    }
    if (briefSentences.length > 0) {
      sentences.splice(index + permissionSentences.length, 0, ...briefSentences);
    }
    if (permissionSentences.length > 0 || briefSentences.length > 0) {
      control.extendSentenceCount(sentences.length);
    }
  };

  /**
   * §4.2 简报插播（FD-3 最低优先级）：仅 AnnIdle（独立单句起播，权限段优先排空）或
   * Speaking 期正文句间且无待播权限段（句界拼接在正文余句之前、权限段之后）。
   * 其余相位（annPaused 录音让位/cancelling/权限段待插队列非空/权限窗内）→ 丢弃。
   */
  const consumeBriefSegmentInternal = (briefId: string, sentencesForBrief: string[]): void => {
    if (announcedBriefIds.has(briefId)) {
      return;
    }
    announcedBriefIds.add(briefId);
    if (sentencesForBrief.length === 0) {
      return;
    }
    const leg = control.snapshot();
    if (leg.phase === "cancelling") {
      return;
    }
    if (leg.phase === "annIdle" && !isRecording()) {
      // AnnIdle 空闲插播：权限 pending 优先排空后再到简报（microtask 串行，§9.6.7-1）。
      pendingBriefSegments.push({ briefId, sentences: sentencesForBrief });
      scheduleBriefDrain();
      return;
    }
    if (leg.phase === "speaking" && !isRecording()) {
      // 正文句间插播点：句界拼接时权限段优先、简报在其后（§4.2-5 段间句隙不插简报）。
      pendingBriefSegments.push({ briefId, sentences: sentencesForBrief });
      return;
    }
    // annPaused（录音让位）/recording：丢弃（§4.2-5 未列插播点；避免与用户语音叠音）。
  };

  const scheduleBriefDrain = (): void => {
    if (briefDrainScheduled) {
      return;
    }
    briefDrainScheduled = true;
    queueMicrotask(() => {
      briefDrainScheduled = false;
      drainPendingBriefFromIdle();
    });
  };

  /** AnnIdle 段排空待播简报（FD-3：权限 pending 优先排空后再到简报）。 */
  const drainPendingBriefFromIdle = (): void => {
    if (disposed || isRecording() || !deps.isAnnouncementEnabled()) return;
    if (pendingBriefSegments.length === 0) {
      return;
    }
    if (turnStartInFlight || control.snapshot().phase !== "annIdle") {
      return;
    }
    if (pendingPermissionSegments.length > 0) {
      // 权限段优先：先排权限（同为 annIdle 起播），简报留待其播完后的句界/排空。
      schedulePermissionDrain();
      scheduleBriefDrain();
      return;
    }
    const drained: string[] = [];
    for (const segment of pendingBriefSegments) {
      drained.push(...segment.sentences);
    }
    pendingBriefSegments = [];
    if (drained.length === 0) {
      return;
    }
    ensureClaimAndSpeak(null, drained, { uninterruptibleLength: 0 });
  };

  const speakCurrent = (leg: VoiceAnnouncementLegState): void => {
    // 权限段/简报只在句边界拼接（当前句播完后的下一句起点）。
    spliceScheduledSegmentsAtBoundary(leg.sentenceIndex);
    const window = permissionWindow;
    // uninterruptible 只覆盖权限句区间：回到正文/简报外的句子即恢复可打断（§3.3 界定）。
    control.setUninterruptible(
      window != null && leg.sentenceIndex >= window.start && leg.sentenceIndex < window.end,
    );
    const text = sentences[leg.sentenceIndex];
    if (text == null) {
      // 队列与状态失步防御：回 AnnIdle（release）而不是播空。
      logger.warn("voice.tts", "sentence queue out of sync; falling back to AnnIdle");
      deps.tts.cancel();
      control.cancelAnnouncement("tailSuperseded");
      stopRenewLoopAndRelease();
      return;
    }
    const config = deps.getAnnouncementVoiceConfig?.();
    activeHandle = deps.tts.speak({
      text,
      lang: config?.lang ?? defaultAnnouncementLang(),
      voice: config?.voice,
      vendorVoice: config?.vendorVoice,
      rate: config?.rate,
    });
  };

  const startRenewLoop = (): void => {
    if (claimRenewTimer != null) {
      return;
    }
    // §3.5-1：Speaking 与 AnnPaused 全程持 claim 周期续约（FD-2：AnnPaused 是持约态）。
    claimRenewTimer = setInterval(() => {
      if (renewing || !activeLease || !control.isOwner() || disposed) return;
      const previous = activeLease;
      // 续约属于 owner/具体 lease 的生命周期；同 owner 换正文不应废弃仍有效的续约。
      const renewalCurrent = () =>
        !disposed && control.isOwner() && activeLease === previous && deps.isAnnouncementEnabled();
      renewing = true;
      void deps.claim
        .renew(previous)
        .then((renewed) => {
          // F4：旧续约只能释放自己返回的 token，不能覆盖新 owner 的相位或 lease。
          if (!renewalCurrent()) {
            if (renewed) deps.claim.release(renewed);
            return;
          }
          activeLease = renewed;
          if (!renewed) {
            activeHandle = null;
            deps.tts.cancel();
            control.cancelAnnouncement("claimLost");
            stopRenewLoopAndRelease();
            logger.warn("voice.tts", "announcement claim lost; reverting to AnnIdle");
          }
        })
        .catch(() => {
          if (!renewalCurrent()) return;
          activeHandle = null;
          deps.tts.cancel();
          control.cancelAnnouncement("claimLost");
          stopRenewLoopAndRelease();
        })
        .finally(() => {
          renewing = false;
        });
    }, claimRenewIntervalMs);
  };

  const stopRenewLoop = (): void => {
    if (claimRenewTimer != null) {
      clearInterval(claimRenewTimer);
      claimRenewTimer = null;
    }
  };

  const stopRenewLoopAndRelease = (): void => {
    stopRenewLoop();
    if (activeLease) deps.claim.release(activeLease);
    activeLease = null;
    control.releaseOwner();
  };

  const clearCancellingFallbackTimer = (): void => {
    if (cancellingFallbackTimer != null) {
      clearTimeout(cancellingFallbackTimer);
      cancellingFallbackTimer = null;
    }
  };

  const unsubscribeDone = deps.tts.onDone((handle, reason) => {
    if (disposed || !control.isOwner()) return;
    if (activeHandle == null || handle.utteranceId !== activeHandle.utteranceId) {
      return; // 迟到的旧句结算（替换/取消后）忽略。
    }
    activeHandle = null;
    if (reason === "cancelled") {
      return; // 本地 cancel 路径已驱动状态迁移（stopPressed/interruptWord/claimLost/替换）。
    }
    if (reason === "error") {
      // §7.1：播放失败吞异常落 warn；跳过坏句继续推进（可恢复，不升级 error）。
      logger.warn("voice.tts", "sentence playback failed; advancing to next sentence");
    }
    const leg = control.sentenceCompleted();
    if (!leg) {
      return;
    }
    if (leg.phase === "speaking") {
      speakCurrent(leg);
    } else if (leg.phase === "annIdle") {
      // 队列播完：离开播报态即解除 uninterruptible（残留 true 会误锁下一轮打断词通道）。
      control.setUninterruptible(false);
      stopRenewLoopAndRelease();
      // 正文队列已尽但仍欠权限段/简报（最后一句播报中到达）→ AnnIdle 起播排空
      //（FD-3：权限先、简报后）。
      drainPendingPermissionFromIdle();
      drainPendingBriefFromIdle();
    }
    // annPaused：claim 保留（FD-2），等录音结束经 resumeSpeaking 续播。
  });

  /** claim 就绪后起播（§3.5-2 空窗即抢；§3.2 进入条件守卫在 store 侧）。turnId=null = 权限段专用起播。 */
  const ensureClaimAndSpeak = (
    turnId: string | null,
    queue: string[],
    opts?: {
      uninterruptibleLength?: number;
      permissionSegments?: typeof pendingPermissionSegments;
    },
  ): void => {
    if (!queue.length || disposed || isRecording() || !deps.isAnnouncementEnabled()) return;
    if (!control.tryAcquireOwner()) return;
    const generation = ++intentGeneration;
    turnStartInFlight = true;
    // F4：获取链串行，旧 lease 回收后才允许下一意图获取，避免 token 被迟到结果覆盖。
    startChain = startChain.then(async () => {
      let acquired: VoiceAnnouncementLease | null = null;
      try {
        if (
          disposed ||
          generation !== intentGeneration ||
          isRecording() ||
          !deps.isAnnouncementEnabled() ||
          !control.tryAcquireOwner()
        )
          return;
        acquired = activeLease ?? (await deps.claim.acquire(claimKey));
        if (!isValid(generation) || isRecording()) {
          if (isValid(generation) && isRecording()) {
            if (turnId !== null) pendingTail = { turnId, text: queue.join("") };
            if (opts?.permissionSegments)
              pendingPermissionSegments.unshift(...opts.permissionSegments);
          }
          if (acquired && acquired !== activeLease) deps.claim.release(acquired);
          return;
        }
        if (!acquired) return;
        activeLease = acquired;
        // 权限在 claim 往返期间也可能已被处理，必须在真正出声前再核验。
        if (opts?.permissionSegments) {
          queue = opts.permissionSegments
            .filter((segment) => deps.isPermissionPending?.(segment.permissionId) !== false)
            .flatMap((segment) => segment.sentences);
          if (!queue.length) return;
        }
        control.setClaimHeld(true);
        if (!control.startSpeaking(queue.length)) {
          // acquire 与起播之间输入腿进入 Recording 等竞态：立即放弃并释放，不长期持 claim。
          control.setClaimHeld(false);
          stopRenewLoopAndRelease();
          return;
        }
        sentences = queue;
        announcedTurnId = turnId;
        if (opts?.uninterruptibleLength != null && opts.uninterruptibleLength > 0) {
          // 权限段专用起播：整段 uninterruptible（§3.3，段 = 一次权限请求的完整播报）。
          permissionWindow = { start: 0, end: Math.min(opts.uninterruptibleLength, queue.length) };
          control.setUninterruptible(true);
        } else {
          permissionWindow = null;
        }
        startRenewLoop();
        speakCurrent(control.snapshot());
      } catch {
        if (isValid(generation)) {
          activeHandle = null;
          deps.tts.cancel();
          control.cancelAnnouncement("claimLost");
          logger.warn("voice.tts", "announcement claim request failed");
        }
      } finally {
        if (generation === intentGeneration) {
          turnStartInFlight = false;
          if (control.snapshot().phase === "annIdle") stopRenewLoopAndRelease();
          schedulePermissionDrain();
          scheduleBriefDrain();
        }
      }
    });
  };

  /**
   * AnnIdle 段排空待播权限段（FD-3 权限不丢）：仅当无轮尾起播链在飞且相位仍是 AnnIdle；
   * speaking 期的 pending 由句界拼接消费，链在飞则等待 onDone 的 annIdle 排空。
   */
  const drainPendingPermissionFromIdle = (): void => {
    prunePermissions();
    if (disposed || isRecording() || !deps.isAnnouncementEnabled()) return;
    if (pendingPermissionSegments.length === 0) {
      return;
    }
    if (turnStartInFlight || control.snapshot().phase !== "annIdle") {
      return;
    }
    const drained: string[] = [];
    const permissionSegments = pendingPermissionSegments;
    for (const segment of pendingPermissionSegments) {
      drained.push(...segment.sentences);
    }
    pendingPermissionSegments = [];
    if (drained.length === 0) {
      return;
    }
    ensureClaimAndSpeak(null, drained, {
      uninterruptibleLength: drained.length,
      permissionSegments,
    });
  };

  const schedulePermissionDrain = (): void => {
    if (permissionDrainScheduled) {
      return;
    }
    permissionDrainScheduled = true;
    queueMicrotask(() => {
      permissionDrainScheduled = false;
      drainPendingPermissionFromIdle();
    });
  };

  return {
    consumeTurnTail(turnTail) {
      if (disposed || !deps.isAnnouncementEnabled()) {
        return;
      }
      // Cancelling 终态判定先于 Recording 顺延：录音中任务被取消时 TurnComplete
      // (cancelled) 仍是完成信号（否则 Cancelling 被顺延吞掉、5s 兜底前播报腿卡死）。
      const leg = control.snapshot();
      if (leg.phase === "cancelling") {
        // TurnComplete(cancelled) 完成信号：回 AnnIdle 且不再播（§3.2 Cancelling 出边）。
        clearCancellingFallbackTimer();
        control.settleTaskCancel();
        stopRenewLoopAndRelease();
        return;
      }
      if (isRecording()) {
        // §3.3 顺延规则：Recording 期间轮尾就绪不立即播，不排队多轮（只留最新）。
        pendingTail = turnTail;
        return;
      }
      if (leg.phase === "annPaused") {
        // 录音未结束时不应到达（consumeTurnTail 在 recording=true 时已改道顺延）；防御性忽略。
        pendingTail = turnTail;
        return;
      }
      if (leg.phase === "speaking") {
        // 「作废旧轮尾只播最新」（§3.3）：cancel 当前句；迟到的 cancelled 结算被 activeHandle 屏蔽。
        deps.tts.cancel();
      }
      const queue = splitTurnIntoSentences(turnTail.text);
      if (queue.length === 0) {
        return;
      }
      ensureClaimAndSpeak(turnTail.turnId, queue);
    },

    notifyUserRecordingStarted() {
      recording = true;
      if (control.snapshot().phase === "speaking") {
        // §4.7：暂停请求当前句播完时生效（最坏一句时长延迟），不立即 cancel 当前句。
        control.markPauseRequested();
      }
    },

    notifyUserRecordingEnded() {
      recording = false;
      const leg = control.snapshot();
      if (leg.phase === "annPaused") {
        // §3.2 AnnPaused→Speaking 前置：轮尾仍最新（focused 最新轮尾与在播轮尾/顺延轮尾比对）。
        const latest = deps.getFocusedTurnTail(null);
        const referenceTurnId = pendingTail?.turnId ?? announcedTurnId;
        const stillCurrent =
          latest != null && referenceTurnId != null && latest.turnId === referenceTurnId;
        if (!pendingTail && stillCurrent) {
          // 无新轮尾且在播轮尾仍最新：自下一句边界续播（claim 仍持有；renew=false 已先回 AnnIdle）。
          pendingTail = null;
          if (control.resumeSpeaking()) {
            speakCurrent(control.snapshot());
          }
          return;
        }
        // 轮尾已更新/有顺延新轮尾/focused 已切换：作废在播队列，「改播最新」经 AnnIdle→Speaking
        //（§3.2 注）；focused 消失则只回 AnnIdle 不播（§3.4 播报跟随 focused）。
        pendingTail = null;
        control.cancelAnnouncement("tailSuperseded");
        stopRenewLoopAndRelease();
        if (latest) {
          const queue = splitTurnIntoSentences(latest.text);
          if (queue.length > 0) {
            ensureClaimAndSpeak(latest.turnId, queue);
          }
        }
        return;
      }
      if (leg.phase === "speaking") {
        // 录音短于一句即结束：撤销未生效的暂停请求，正常续播。
        control.clearPauseRequested();
        pendingTail = null;
        return;
      }
      if (leg.phase === "annIdle" && pendingTail) {
        // 顺延起播（§3.3：录音结束时该轮尾仍最新 → 起播；已更新 → 只播最新）。
        const latest = deps.getFocusedTurnTail(null);
        pendingTail = null;
        if (latest) {
          const queue = splitTurnIntoSentences(latest.text);
          if (queue.length > 0) {
            ensureClaimAndSpeak(latest.turnId, queue);
          }
        }
      }
      // F5：没有正文轮尾时，录音中积压的权限段也必须在资源释放后排空。
      schedulePermissionDrain();
      scheduleBriefDrain();
    },

    notifyStopPressed() {
      intentGeneration += 1;
      turnStartInFlight = false;
      // §3.3 FD-1：任何播报态（含 uninterruptible 段、AnnPaused、Cancelling）立即静音回
      // AnnIdle；零协议、不取消任务（层①唯一点按载体是 TID_VOICE_ANN_STOP，Phase 1b）。
      pendingTail = null;
      announcedTurnId = null;
      activeHandle = null;
      pendingPermissionSegments = [];
      pendingBriefSegments = [];
      permissionWindow = null;
      if (control.isOwner()) deps.tts.cancel();
      control.cancelAnnouncement("stopPressed");
      clearCancellingFallbackTimer();
      stopRenewLoopAndRelease();
    },

    notifyInterruptWordHit() {
      // §3.3/§4.3 层①：uninterruptible 段内拒绝（store 守卫返回 null，本地态不动）；
      // 命中即停且不续播（AnnPaused 被命中 = 作废续播意图）。
      const next = control.cancelAnnouncement("interruptWord");
      if (!next) {
        return;
      }
      pendingTail = null;
      announcedTurnId = null;
      activeHandle = null;
      pendingPermissionSegments = [];
      pendingBriefSegments = [];
      permissionWindow = null;
      deps.tts.cancel();
      stopRenewLoopAndRelease();
    },

    consumePermissionSegment(segment) {
      if (deps.isPermissionPending?.(segment.permissionId) === false) return;
      if (disposed || !deps.isAnnouncementEnabled()) {
        return;
      }
      if (announcedPermissionIds.has(segment.permissionId)) {
        return; // 同一权限请求只播一次。
      }
      announcedPermissionIds.add(segment.permissionId);
      if (control.snapshot().phase === "cancelling") {
        return; // Cancelling 段不新增播报内容。
      }
      const sentencesForSegment = splitTurnIntoSentences(segment.text);
      if (sentencesForSegment.length === 0) {
        return;
      }
      const leg = control.snapshot();
      if (leg.phase === "speaking" || leg.phase === "annPaused") {
        // FD-3 句粒度让位：当前句播完后在下一句边界整段插队（AnnPaused 则等续播边界）。
        // 连续段在 splicePermissionAtBoundary 内背靠背拼接，段间句隙不开放正文。
        pendingPermissionSegments.push({
          permissionId: segment.permissionId,
          sentences: sentencesForSegment,
        });
        return;
      }
      if (isRecording()) {
        // 录音中到达：暂存，录音结束的续播边界先播权限段（FD-3 权限 > 正文）。
        pendingPermissionSegments.push({
          permissionId: segment.permissionId,
          sentences: sentencesForSegment,
        });
        return;
      }
      // AnnIdle：入队并微任务排空（与轮尾起播链串行——同帧到达时等待链落地后按相位
      // 决定「句界拼接或立即起播」，§4.1 权限 > 正文）。正文轮尾不受影响。
      pendingPermissionSegments.push({
        permissionId: segment.permissionId,
        sentences: sentencesForSegment,
      });
      schedulePermissionDrain();
    },

    consumeBriefSegment(briefId, text) {
      if (disposed || !deps.isAnnouncementEnabled()) return;
      consumeBriefSegmentInternal(briefId, splitTurnIntoSentences(text));
    },

    requestCancelTask() {
      intentGeneration += 1;
      turnStartInFlight = false;
      stopRenewLoop();
      const leg = control.snapshot();
      if (leg.phase === "annIdle") stopRenewLoopAndRelease();
      if (leg.phase === "speaking" || leg.phase === "annPaused") {
        // 播报同步静音（§3.2 Speaking/AnnPaused→Cancelling；§4.3 层③）。
        activeHandle = null;
        pendingPermissionSegments = [];
        pendingBriefSegments = [];
        permissionWindow = null;
        deps.tts.cancel();
        control.beginTaskCancel();
        clearCancellingFallbackTimer();
        // §3.3 Cancelling 兜底：5s 内无 TurnComplete 即回 AnnIdle + warn（取消结果未知，
        // UI 回落显示任务实际状态）。
        cancellingFallbackTimer = setTimeout(() => {
          cancellingFallbackTimer = null;
          const settled = control.settleTaskCancel();
          if (settled) {
            logger.warn(
              "voice.tts",
              "cancelling fallback timeout without TurnComplete; UI falls back to actual task state",
            );
            stopRenewLoopAndRelease();
          }
        }, cancellingFallbackTimeoutMs);
      }
      // 层③发既有 v4 stop（带 expectedForegroundExecutionId），与播报态无关——播报
      // 关闭/AnnIdle 时仍可取消任务；§9.8 总线已按绑定目标选出唯一处理者。
      // SessionPane 保留 canStop 与 expectedForegroundExecutionId，负责能力/stale run 校验。
      deps.cancelTask?.();
    },

    notifyExternalTaskStop() {
      intentGeneration += 1;
      turnStartInFlight = false;
      stopRenewLoop();
      // §3.3 FD-1：任务被既有停止面（TID_V4_STOP / Esc 停止生成）取消——播报同步静音经
      // Cancelling 回 AnnIdle；不重复发 v4 stop（停止面已发过，guard.stopTargetChanged
      // 命中是 noop 无 ACK，5s 兜底由 requestCancelTask 同款定时器覆盖）。
      const leg = control.snapshot();
      if (leg.phase !== "speaking" && leg.phase !== "annPaused") {
        if (leg.phase === "annIdle") stopRenewLoopAndRelease();
        return;
      }
      activeHandle = null;
      pendingPermissionSegments = [];
      pendingBriefSegments = [];
      permissionWindow = null;
      deps.tts.cancel();
      control.beginTaskCancel();
      clearCancellingFallbackTimer();
      cancellingFallbackTimer = setTimeout(() => {
        cancellingFallbackTimer = null;
        const settled = control.settleTaskCancel();
        if (settled) {
          logger.warn(
            "voice.tts",
            "cancelling fallback timeout without TurnComplete; UI falls back to actual task state",
          );
          stopRenewLoopAndRelease();
        }
      }, cancellingFallbackTimeoutMs);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      intentGeneration += 1;
      unsubscribeDone();
      recording = false;
      pendingTail = null;
      announcedTurnId = null;
      activeHandle = null;
      pendingPermissionSegments = [];
      pendingBriefSegments = [];
      permissionWindow = null;
      // F3：非持有 pane 卸载不能触发引擎级 cancel，更不能清掉别人的全局相位。
      if (control.isOwner()) deps.tts.cancel();
      control.cancelAnnouncement("stopPressed");
      clearCancellingFallbackTimer();
      stopRenewLoopAndRelease();
    },
    isAnnouncementOwner: () => !disposed && control.isOwner(),
  };
}
