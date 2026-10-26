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
// 融合（§9.8+§9.9）：claim 端口取 §9.8 lease 凭证形态；模块拆分取 §9.9 max-file-lines
// 门禁形态（turnSpeechText / voiceAnnouncementControl / turnSpeechPlannerTypes 三件；
// 其中 voiceAnnouncementControl 以 §9.8.2 owner 凭证超集形态为准，见该文件头注）。
//（deps 接口随拆分迁 turnSpeechPlannerTypes.ts，claim 端口类型在该文件引入。）
import type { VoiceAnnouncementLease } from "./voiceAnnouncementClaim.js";
import { splitTurnIntoSentences } from "./turnSpeechText.js";
export { buildTurnSpeechText, splitTurnIntoSentences } from "./turnSpeechText.js";
export {
  createVoiceSessionAnnouncementControl,
  type AnnouncementLegControl,
} from "./voiceAnnouncementControl.js";
// 接口与实现分离（外部导入路径经 re-export 不变）：
export type { TurnSpeechPlanner, TurnSpeechPlannerDeps } from "./turnSpeechPlannerTypes.js";
import type { TurnSpeechPlanner, TurnSpeechPlannerDeps } from "./turnSpeechPlannerTypes.js";
import {
  VOICE_CANCELLING_FALLBACK_TIMEOUT_MS,
  VOICE_CLAIM_RENEW_INTERVAL_MS,
} from "./voiceTuning.js";
import type { VoiceAnnouncementLegState } from "@/store/voiceSessionStore.js";
import type { VoiceTtsHandle } from "./voiceTtsPort.js";

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
  /**
   * §9.9.3-L8：已播权限账本——deps 注入 store 适配（跨 pane 共享）优先；缺省实例级
   * Set 保持单 pane 语义不变（回退即红锚点：退回实例级则跨 pane 共享用例红）。
   */
  const announcedPermissionLedger =
    deps.announcedPermissionLedger ??
    (() => {
      const localAnnouncedPermissionIds = new Set<string>();
      return {
        has: (permissionId: string) => localAnnouncedPermissionIds.has(permissionId),
        mark: (permissionId: string) => {
          localAnnouncedPermissionIds.add(permissionId);
        },
      };
    })();
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
  let deferredTailDrainScheduled = false;
  /**
   * §9.8/F4/F5 形态：起播意图串行链 + 意图代数。startChain 保证同一时刻至多一条
   * 起播链在 claim 往返中（后到意图排队等待）；intentGeneration 每个新意图递增，
   * 排队/在飞旧链发现代数过期即放弃（最新意图胜出），停止面入口递增使全部在飞/
   * 排队链失效。
   * 融合：§9.9 同机制的「无 owner/lease 基线移植」由本 §9.8 原生形态覆盖
   *（intentGeneration 已在上方实例瞬态区声明，不重复）。
   */
  let startChain: Promise<void> = Promise.resolve();
  const prunePermissions = () => {
    pendingPermissionSegments = pendingPermissionSegments.filter(
      (segment) => deps.isPermissionPending?.(segment.permissionId) !== false,
    );
  };
  // 融合注：§9.9 侧的 deferExpiredStart 辅助函数不保留——其「过期起播意图内容不丢」
  //（轮尾转顺延 + 权限段 unshift 回队头）语义已由 §9.8 ensureClaimAndSpeak 的内联
  // defer 分支原生覆盖（见该处「融合」注），不复制第二份代码路径。

  /**
   * 句边界调度：①权限段（FD-3 最高，正文剩余句之前整段插队、uninterruptible 闭合）；
   * ②工具简报（§4.2 最低）：仅当**无待播权限段**时拼在正文余句之前（正文句间插播）；
   * 权限段待插时简报保留，随权限播完后的句界/空闲排空再插（§4.2-5 段间句隙不插）。
   */
  const spliceScheduledSegmentsAtBoundary = (index: number): void => {
    // §9.8/F5 形态：拼接点先修剪已处理的权限段（splice 与 drain 双侧复核——
    // 权限在排队期间被处理即不再插入，§9.8.2「开播前复核」）。
    prunePermissions();
    // §9.8/F5 形态：权限段专用起播的窗口内不做任何拼接——简报插进权限窗会破坏
    // 「段 = 一次权限请求的完整播报」的整段闭合（uninterruptible 区间被腰斩），
    // 简报留待窗口外的下一句界/AnnIdle 排空。
    if (permissionWindow && index >= permissionWindow.start && index < permissionWindow.end) {
      return;
    }
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

  /**
   * §3.3 Cancelling 兜底（5s 内无 TurnComplete 即回 AnnIdle + warn，取消结果未知，
   * UI 回落显示任务实际状态）——requestCancelTask 与 notifyExternalTaskStop 共用。
   */
  const startCancellingFallback = (): void => {
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
  };

  /**
   * 静音面共用局部清理（§3.3 FD-1）：作废在播句/待插权限/简报/权限窗并停当前句。
   * full=true（点按/打断词：作废续播意图）连轮尾身份与顺延轮尾一并清空；
   * false（Cancelling 面）保留 pendingTail/announcedTurnId——TurnComplete 仍是完成信号。
   * 融合：引擎 cancel 带 §9.8-F3 owner 守卫——非持有 pane 的停止面不得触发引擎级
   * cancel（speak/cancel 均为全局引擎副作用）；能走到 Cancelling/speaking 分支时
   * 本 planner 必为 owner，守卫仅拦截无相位的停止面入口。
   */
  const resetPlaybackLocals = (full: boolean): void => {
    if (full) {
      pendingTail = null;
      announcedTurnId = null;
    }
    activeHandle = null;
    pendingPermissionSegments = [];
    pendingBriefSegments = [];
    permissionWindow = null;
    if (control.isOwner()) deps.tts.cancel();
  };

  // §9.9.4-L9 订阅退订：dispose 退订 onDone（多 planner 实例共享同一 tts port 时
  // 不残留死监听）；§9.8 形态的 owner 前置守卫保留（非 owner 的结算直接忽略）。
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
    // §7.1/§9.9.4-L9 voice.tts debug 句界槽位（生产不落盘）：载荷只含 id/序号/计数，
    // 零播报文本（播报正文不落任何日志级别，§7.1 隐私边界）。
    logger.debug("voice.tts", "sentence.boundary", { index: leg.sentenceIndex, total: leg.sentenceCount });
    if (leg.phase === "annPaused") {
      // §4.7 句粒度暂停在句界生效：pause(effective) 时序槽位。
      logger.debug("voice.tts", "pause", { phase: "effective", index: leg.sentenceIndex });
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
      // §9.9.2-M3 顺延轮尾排空点：权限/简报排空后仍 AnnIdle → 起播录音期顺延的
      // 轮尾（微任务形态：让上方排空链的相位落地先于本检查，避免与在飞起播链竞争）。
      scheduleDeferredTailDrain();
    }
    // annPaused：claim 保留（FD-2），等录音结束经 resumeSpeaking 续播。
  });

  /**
   * claim 就绪后起播（§3.5-2 空窗即抢；§3.2 进入条件守卫在 store 侧）。turnId=null = 权限段专用起播。
   *
   * §9.8/F4/F5 形态（无 owner/lease 端口的基线移植）：起播意图经 startChain 串行执行
   * + intentGeneration 最新意图胜出——旧链在 claim 往返期间被更新意图/停止面取代时放弃，
   * 消除基线「同帧多条 drain 起播链并发、后落者静默替换前者」的双链竞争；claim await
   * 后复核相位/录音（过期则轮尾顺延 + 权限段 unshift 回队头，不丢内容）与权限 pending
   *（已处理段不出声）。
   */
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
          // 融合：§9.9-F5「过期起播意图内容不丢」（原 deferExpiredStart）由本 §9.8
          // 内联 defer 形态覆盖——轮尾转顺延（§3.3 只留最新）+ 权限段 unshift 回队头。
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
        // await 后权限复核（§9.8/F5）：claim 往返期间权限可能已被处理，以出声前的
        // 最新 pending 状态过滤；全部已处理时本意图作废——claim 归还交由 finally 的
        // AnnIdle release（§9.8 lease 形态，不按 key 释放）。
        let speakQueue = queue;
        if (opts?.permissionSegments) {
          speakQueue = opts.permissionSegments
            .filter((segment) => deps.isPermissionPending?.(segment.permissionId) !== false)
            .flatMap((segment) => segment.sentences);
          if (speakQueue.length === 0) return;
        }
        control.setClaimHeld(true);
        if (!control.startSpeaking(speakQueue.length)) {
          // acquire 与起播之间输入腿进入 Recording 等竞态：立即放弃并释放，不长期持 claim。
          control.setClaimHeld(false);
          stopRenewLoopAndRelease();
          return;
        }
        sentences = speakQueue;
        announcedTurnId = turnId;
        if (opts?.uninterruptibleLength != null && opts.uninterruptibleLength > 0) {
          // 权限段专用起播：整段 uninterruptible（§3.3，段 = 一次权限请求的完整播报）。
          permissionWindow = { start: 0, end: Math.min(opts.uninterruptibleLength, speakQueue.length) };
          control.setUninterruptible(true);
        } else {
          permissionWindow = null;
        }
        startRenewLoop();
        // §7.1/§9.9.4-L9 voice.tts debug 起播槽位（生产不落盘；零播报文本，turnId 是
        // 标识符非正文）。
        logger.debug("voice.tts", "turn.start", { turnId, sentenceCount: speakQueue.length });
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
          // 起播链落地后如有遗留权限段/简报（如轮尾起播竞胜）：再排一次空。
          schedulePermissionDrain();
          scheduleBriefDrain();
          // §9.9.2-M3：起播链放弃（claim 未得/竞态过期）后仍 AnnIdle 时，顺延轮尾经
          // 排空点起播——不因权限/简报排空链失败而滞留（落地为 Speaking 时排空守卫自挡）。
          scheduleDeferredTailDrain();
        }
      }
    });
  };

  /**
   * AnnIdle 段排空待播权限段（FD-3 权限不丢）：仅当无轮尾起播链在飞且相位仍是 AnnIdle；
   * speaking 期的 pending 由句界拼接消费，链在飞则等待 onDone 的 annIdle 排空。
   * §9.8/F5 形态：入口先修剪已处理段；排空起播携带原始段供 claim 往返后复核
   * （isPermissionPending 在 await 窗口内仍可能翻转为已处理）。
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
    prunePermissions();
    if (pendingPermissionSegments.length === 0) {
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

  /**
   * §9.9.2-M3 顺延轮尾排空点：AnnPaused 权限/简报段（null-turnId）续播期间保留的
   * 顺延轮尾（pendingTail），在权限/简报排空后的 AnnIdle 起播——重读
   * getFocusedTurnTail(null) 以最新为准（与 notifyUserRecordingEnded 的顺延起播同款
   * 新鲜度校验：仍最新 → 起播；已更新 → 只播最新；focused 消失 → 只清不起播，§3.4）。
   * FD-3 顺序：仍有待播权限/简报段时先排它们（排空链的 finally/onDone 会回到本函数）。
   */
  const drainDeferredTail = (): void => {
    if (pendingTail == null) {
      return;
    }
    // 融合：§9.9 原判本地 recording 标志；§9.8 引入 deps.isRecording（wiring 的
    // episode 真值，含 injecting 微态）后以 isRecording() 为准，本地标志仅作缺省回退。
    if (isRecording() || turnStartInFlight || control.snapshot().phase !== "annIdle") {
      return;
    }
    if (pendingPermissionSegments.length > 0 || pendingBriefSegments.length > 0) {
      // 权限/简报优先：本函数不越过它们，等其播完后的 AnnIdle 排空点再来。
      schedulePermissionDrain();
      scheduleBriefDrain();
      return;
    }
    const latest = deps.getFocusedTurnTail(null);
    pendingTail = null;
    if (latest == null) {
      return;
    }
    const queue = splitTurnIntoSentences(latest.text);
    if (queue.length > 0) {
      ensureClaimAndSpeak(latest.turnId, queue);
    }
  };

  const scheduleDeferredTailDrain = (): void => {
    if (deferredTailDrainScheduled) {
      return;
    }
    deferredTailDrainScheduled = true;
    queueMicrotask(() => {
      deferredTailDrainScheduled = false;
      drainDeferredTail();
    });
  };

  /**
   * §4.7 AnnPaused→Speaking 续播：§7.1/§9.9.4-L9 voice.tts debug resume 时序槽位
   * （生产不落盘；载荷只含句序号，零播报文本）。
   */
  const resumeFromAnnPaused = (): void => {
    // 融合（§9.9-H2 输入腿守卫）：recording/injecting 期间不得恢复播报。wiring 的
    // isRecording 是 episode 真值（含逐句 injecting 微态，§9.8 注），正常时序下
    // notifyUserRecordingEnded 仅在 episode 真结束时触发；此处复核防 wiring 缺席或
    // 本地标志陈旧时打穿互斥（§3.3 Recording 优先）。
    if (isRecording()) return;
    const leg = control.resumeSpeaking();
    if (leg) {
      logger.debug("voice.tts", "resume", { index: leg.sentenceIndex });
      speakCurrent(leg);
    }
  };

  /**
   * §9.9.2-M2/M3：作废在播内容改播 focused 最新轮尾——「作废旧轮尾只播最新」（§3.3）
   * 的单一 supersede 代码路径，供 AnnPaused「改播最新」段与 speaking 分支（录音短于
   * 一句结束且顺延轮尾在）共用，不复制第三份。tts.cancel 先停当前句（AnnPaused 句界
   * 已停时为无害 no-op）；focused 消失则只回 AnnIdle 不播（§3.4 播报跟随 focused）。
   * 融合：tts.cancel 带 §9.8-F3 owner 守卫——能走到 supersede 的调用点必在 owner
   * 分支内，守卫为无相位窗口的防御。
   */
  const supersedeWithFocusedLatest = (): void => {
    if (control.isOwner()) deps.tts.cancel();
    control.cancelAnnouncement("tailSuperseded");
    stopRenewLoopAndRelease();
    const latest = deps.getFocusedTurnTail(null);
    if (latest != null) {
      const queue = splitTurnIntoSentences(latest.text);
      if (queue.length > 0) {
        ensureClaimAndSpeak(latest.turnId, queue);
      }
    }
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
      // 融合：§9.8/F4 起播链互斥标记在 ensureClaimAndSpeak 内（排空链同样受互斥保护）。
      ensureClaimAndSpeak(turnTail.turnId, queue);
    },

    notifyUserRecordingStarted() {
      recording = true;
      if (control.snapshot().phase === "speaking") {
        // §4.7：暂停请求当前句播完时生效（最坏一句时长延迟），不立即 cancel 当前句。
        const leg = control.markPauseRequested();
        if (leg) {
          // §7.1/§9.9.4-L9 voice.tts debug 暂停请求槽位（句界未到、延迟生效）。
          logger.debug("voice.tts", "pause", { phase: "requested", index: leg.sentenceIndex });
        }
      }
    },

    notifyUserRecordingEnded() {
      recording = false;
      const leg = control.snapshot();
      if (leg.phase === "annPaused") {
        // §9.9.2-M3：在播队列无轮尾身份（announcedTurnId=null，权限/简报专用起播
        // ensureClaimAndSpeak(null,…) 的形态）时，「轮尾仍最新」比对无对象——null 不等
        // 于任何 turnId，stillCurrent 恒 false 是判定空缺而非裁决意图，原实现因此落
        // tailSuperseded 改播 latest 轮尾：被打断权限段剩余句永失（announcedPermissionIds
        // 已记不重播）且 latest 轮尾多为旧正文，重播无信息量。按 FD-3「权限段整段闭合、
        // 权限>正文」改为续播在播队列剩余句（句序号/permissionWindow/uninterruptible
        // 覆盖原样保留，句界拼接继续消费 pendingPermissionSegments）；顺延轮尾
        // （pendingTail）保留不清，待权限/简报排空后的 AnnIdle 排空点起播。
        if (announcedTurnId == null) {
          // 并行 §9.8/F5 兼容：续播前按 isPermissionPending 修剪待插队权限段——已处理
          // 的请求不复活进队列（prunePermissions 与 F5 同名同语义，合并直接叠加）。
          prunePermissions();
          resumeFromAnnPaused();
          // 续播失败（claim 被抢，renew=false 已先回 AnnIdle，§3.5-3）或 speakCurrent
          // 的队列失步防御回 AnnIdle 时，顺延轮尾不滞留：经排空点重试。
          if (control.snapshot().phase === "annIdle") {
            scheduleDeferredTailDrain();
          }
          return;
        }
        // §3.2 AnnPaused→Speaking 前置：轮尾仍最新（focused 最新轮尾与在播轮尾/顺延轮尾比对）。
        const latest = deps.getFocusedTurnTail(null);
        const referenceTurnId = pendingTail?.turnId ?? announcedTurnId;
        const stillCurrent =
          latest != null && referenceTurnId != null && latest.turnId === referenceTurnId;
        if (!pendingTail && stillCurrent) {
          // 无新轮尾且在播轮尾仍最新：自下一句边界续播（claim 仍持有；renew=false 已先回 AnnIdle）。
          pendingTail = null;
          resumeFromAnnPaused();
          return;
        }
        // 轮尾已更新/有顺延新轮尾/focused 已切换：作废在播队列，「改播最新」经 AnnIdle→Speaking
        //（§3.2 注）；focused 消失则只回 AnnIdle 不播（§3.4 播报跟随 focused）。
        pendingTail = null;
        supersedeWithFocusedLatest();
        return;
      }
      if (leg.phase === "speaking") {
        // 录音短于一句即结束：撤销未生效的暂停请求，正常续播（§4.7）。
        control.clearPauseRequested();
        if (pendingTail != null) {
          // §9.9.2-M2：顺延轮尾不再无条件丢弃——wiring 的 lastConsumedTurnRef 已在
          // consumeTurnTail 前标记消费（useVoiceAnnouncement），清空即该轮尾永不播，
          // 违反 §3.3 顺延规则冻结「录音结束时该轮尾仍最新 → 起播」。句界流程的 pause
          // 已被上方 clearPauseRequested 撤销、录音已结束无再触发点，唯一与冻结表一致
          // 的确定性归宿是与 consumeTurnTail speaking 分支同款的立即 supersede（「等下
          // 一句界再换」会引入冻结表中不存在的第二种 supersede 时序，不采，§9.9.5-2）。
          pendingTail = null;
          supersedeWithFocusedLatest();
        }
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
      // §9.8/F5：没有正文轮尾时，录音中积压的权限段/简报也必须在资源释放后排空；
      // §9.9.2-M3：顺延轮尾排空点排其后（微任务 FIFO 保 FD-3 顺序：权限→简报→正文）。
      schedulePermissionDrain();
      scheduleBriefDrain();
      scheduleDeferredTailDrain();
    },

    notifyStopPressed() {
      // §9.8/F4：作废全部在飞/排队起播链（停止面零协议即时静音，FD-1）；局部清理经
      // resetPlaybackLocals（§3.3 FD-1：任何播报态含 uninterruptible 段、AnnPaused、
      // Cancelling 立即静音回 AnnIdle；零协议、不取消任务——层①唯一点按载体是
      // TID_VOICE_ANN_STOP，Phase 1b）。
      intentGeneration += 1;
      turnStartInFlight = false;
      resetPlaybackLocals(true);
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
      // §9.8/F4：作废全部在飞/排队起播链（打断词命中 = 即时静音出口）。
      intentGeneration += 1;
      turnStartInFlight = false;
      // §7.1/§9.9.4-L9 voice.tts debug 打断时序槽位（打断词命中；零文本载荷）。
      logger.debug("voice.tts", "interrupt");
      resetPlaybackLocals(true);
      stopRenewLoopAndRelease();
    },

    consumePermissionSegment(segment) {
      // §9.8/F5：入口复核——请求已处理（非 pending）直接丢弃，不进队列不记账。
      if (deps.isPermissionPending?.(segment.permissionId) === false) return;
      if (disposed || !deps.isAnnouncementEnabled()) {
        return;
      }
      if (announcedPermissionLedger.has(segment.permissionId)) {
        return; // 同一权限请求只播一次（§9.9.3-L8：跨 pane 共享账本）。
      }
      announcedPermissionLedger.mark(segment.permissionId);
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
      // §9.8/F4：作废全部在飞/排队起播链（取消面与停止面同为即时静音出口）；
      // §9.8 形态入口即停续约循环（Cancelling 不再续约，settle 时统一 release）。
      intentGeneration += 1;
      turnStartInFlight = false;
      stopRenewLoop();
      const leg = control.snapshot();
      if (leg.phase === "annIdle") stopRenewLoopAndRelease();
      if (leg.phase === "speaking" || leg.phase === "annPaused") {
        // 播报同步静音（§3.2 Speaking/AnnPaused→Cancelling；§4.3 层③）。
        // §7.1/§9.9.4-L9 voice.tts debug 取消时序槽位（via=触发面；零文本载荷）。
        logger.debug("voice.tts", "cancel", { via: "voice" });
        resetPlaybackLocals(false);
        control.beginTaskCancel();
        // §3.3 Cancelling 兜底（共用 helper）。
        startCancellingFallback();
      }
      // 层③发既有 v4 stop（带 expectedForegroundExecutionId），与播报态无关——播报
      // 关闭/AnnIdle 时仍可取消任务；§9.8 总线已按绑定目标选出唯一处理者。
      // SessionPane 保留 canStop 与 expectedForegroundExecutionId，负责能力/stale run 校验。
      deps.cancelTask?.();
    },

    notifyExternalTaskStop() {
      // §9.8/F4：作废全部在飞/排队起播链（外部停止面；§3.3 FD-1：任务被既有停止面
      //（TID_V4_STOP / Esc 停止生成）取消——播报同步静音经 Cancelling 回 AnnIdle；
      // 不重复发 v4 stop（停止面已发过，guard.stopTargetChanged 命中是 noop 无 ACK，
      // 5s 兜底由 requestCancelTask 同款定时器覆盖）。
      intentGeneration += 1;
      turnStartInFlight = false;
      stopRenewLoop();
      const leg = control.snapshot();
      if (leg.phase !== "speaking" && leg.phase !== "annPaused") {
        if (leg.phase === "annIdle") stopRenewLoopAndRelease();
        return;
      }
      // §7.1/§9.9.4-L9 voice.tts debug 取消时序槽位（外部停止面；零文本载荷）。
      logger.debug("voice.tts", "cancel", { via: "external" });
      resetPlaybackLocals(false);
      control.beginTaskCancel();
      // §3.3 Cancelling 兜底（共用 helper）。
      startCancellingFallback();
    },

    dispose() {
      // 融合：§9.8 幂等守卫 + F4 作废在飞/排队起播链（卸载清理，§3.5-4）+ F3 owner
      // 守卫的引擎 cancel（经 resetPlaybackLocals 内的 isOwner 门）+ §9.9.4-L9 订阅退订。
      if (disposed) return;
      disposed = true;
      intentGeneration += 1;
      turnStartInFlight = false;
      recording = false;
      unsubscribeDone();
      resetPlaybackLocals(true);
      control.cancelAnnouncement("stopPressed");
      clearCancellingFallbackTimer();
      stopRenewLoopAndRelease();
    },
    // §9.8.2 owner 凭证查询（命令总线路由用；§9.9 基线形态无此方法，取 §9.8 形态）。
    isAnnouncementOwner: () => !disposed && control.isOwner(),
  };
}
