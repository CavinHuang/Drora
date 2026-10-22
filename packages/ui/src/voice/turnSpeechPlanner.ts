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
import type { VoiceAnnouncementClaimPort } from "./voiceAnnouncementClaim.js";
import {
  VOICE_CANCELLING_FALLBACK_TIMEOUT_MS,
  VOICE_CLAIM_RENEW_INTERVAL_MS,
  VOICE_MAX_SENTENCE_CHARS,
} from "./voiceTuning.js";
import type {
  VoiceAnnouncementLegState,
  VoiceSessionStoreActions,
  VoiceSessionStoreState,
} from "@/store/voiceSessionStore.js";
import type { VoiceTtsHandle, VoiceTtsPort } from "./voiceTtsPort.js";

/**
 * 轮尾正文聚合同源（§4.1 白名单）：assistantTextRows → 滤空 → join("\n\n")，
 * 与 assistantCopyText/复制文本同链（packages/ui/src/v4/assistantPreviewCards.ts:34-37）。
 * 规划器不建第二事件流、不建第二状态源——Phase 1b wiring 从 ConversationTurnGroup 同一
 * 投影取行后经本函数聚合，再作为 consumeTurnTail 输入。
 */
export function buildTurnSpeechText(assistantTextRows: readonly { text: string }[]): string {
  return assistantTextRows
    .map((row) => row.text)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

const SENTENCE_TERMINATORS = new Set(["。", "！", "？", "!", "?", "；", ";", "…", "\n"]);
/** 终止符后紧跟的收尾字符随句子归属（引号/括号不独立成句）。 */
const SENTENCE_CLOSERS = new Set(["」", "』", "）", "”", "’", "\"", "'"]);

/**
 * 句边界切分（§4.1「整段分句播」）。确定性规则：
 * 终止标点/换行处断句；`.` 夹在数字间不切（小数保护）；单段超长按 maxChars 硬切；
 * 输出 trim 后非空段。
 */
export function splitTurnIntoSentences(
  text: string,
  maxChars: number = VOICE_MAX_SENTENCE_CHARS,
): string[] {
  const segments: string[] = [];
  let current = "";
  const push = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      segments.push(trimmed);
    }
    current = "";
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char == null) {
      continue;
    }
    current += char;
    if (!SENTENCE_TERMINATORS.has(char)) {
      continue;
    }
    // 小数保护：'.' 前后均为数字时不切（3.14 / 1.5 倍）。
    if (char === "." && i > 0) {
      const prev = text[i - 1];
      const next = text[i + 1];
      if (prev != null && /\d/u.test(prev) && next != null && /\d/u.test(next)) {
        continue;
      }
    }
    // 收尾字符（引号/括号）随句归属。
    let j = i + 1;
    while (j < text.length) {
      const follower = text[j];
      if (follower == null || !SENTENCE_CLOSERS.has(follower)) {
        break;
      }
      current += follower;
      j += 1;
    }
    i = j - 1;
    push();
  }
  push();

  if (maxChars <= 0) {
    return segments;
  }
  // 超长硬切：无标点长段保持 utterance 有界（调参面 voiceTuning）。
  const bounded: string[] = [];
  for (const segment of segments) {
    if (segment.length <= maxChars) {
      bounded.push(segment);
      continue;
    }
    for (let offset = 0; offset < segment.length; offset += maxChars) {
      const chunk = segment.slice(offset, offset + maxChars).trim();
      if (chunk.length > 0) {
        bounded.push(chunk);
      }
    }
  }
  return bounded;
}

/** 播报腿受控迁移面（voiceSessionStore 单一所有者的写入端口，见文件头说明）。 */
export interface AnnouncementLegControl {
  snapshot(): VoiceAnnouncementLegState;
  startSpeaking(sentenceCount: number): VoiceAnnouncementLegState | null;
  /** 权限段句界拼接后同步句总数（§4.1 插队使队列长度变化；additive 于 §2.3）。 */
  extendSentenceCount(total: number): void;
  markPauseRequested(): VoiceAnnouncementLegState | null;
  clearPauseRequested(): VoiceAnnouncementLegState | null;
  sentenceCompleted(): VoiceAnnouncementLegState | null;
  resumeSpeaking(): VoiceAnnouncementLegState | null;
  cancelAnnouncement(
    source: "stopPressed" | "interruptWord" | "claimLost" | "tailSuperseded",
  ): VoiceAnnouncementLegState | null;
  beginTaskCancel(): VoiceAnnouncementLegState | null;
  settleTaskCancel(): VoiceAnnouncementLegState | null;
  setClaimHeld(held: boolean): void;
  setUninterruptible(uninterruptible: boolean): void;
}

export interface TurnSpeechPlannerDeps {
  getFocusedTurnTail(sessionId: string | null): { turnId: string; text: string } | null;
  tts: VoiceTtsPort;
  claim: VoiceAnnouncementClaimPort;
  /** 照 taskNotificationPreferences.ts:33 reader 收口先例：设置关闭后运行时行为一致。 */
  isAnnouncementEnabled(): boolean;
  announcementControl: AnnouncementLegControl;
  /** §6.1 音色/语速 + 播报语言；缺省跟随 navigator.language（系统默认音色/语速 1）。 */
  getAnnouncementVoiceConfig?(): { lang: string; voice?: string; rate?: number };
  /** 层③「停掉任务」→ 既有 v4 stop（带 expectedForegroundExecutionId）；Phase 1b 接线。 */
  cancelTask?(): void;
  /** claim 续约间隔（§3.5-1：间隔 < TTL/2）；缺省 voiceTuning，测试可缩短。 */
  claimRenewIntervalMs?: number;
  /** Cancelling 兜底（§3.3：5s）；缺省 voiceTuning，测试可缩短。 */
  cancellingFallbackTimeoutMs?: number;
}

export interface TurnSpeechPlanner {
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
  let pendingTail: { turnId: string; text: string } | null = null;
  let claimRenewTimer: ReturnType<typeof setInterval> | null = null;
  let cancellingFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * FD-3 权限段：待插队段（句界拼接）+ 已播 id 去重 + 当前 uninterruptible 窗口
   * [start, end)（句子下标区间；null = 无权限段在播/待播）。
   */
  let pendingPermissionSegments: { permissionId: string; sentences: string[] }[] = [];
  const announcedPermissionIds = new Set<string>();
  let permissionWindow: { start: number; end: number } | null = null;
  /**
   * 轮尾起播链在飞标记：TurnComplete 与权限 pending 常在同一 snapshot 提交内到达，
   * 轮尾 ensureClaimAndSpeak 是异步链——权限段排空等待其在飞结束，再按相位决定
   * 「句界拼接（speaking）或立即起播（annIdle）」，避免双链竞争造成权限段/正文丢失。
   */
  let turnStartInFlight = false;
  let permissionDrainScheduled = false;

  /** 句边界：有待播权限段则在正文剩余句之前整段插队（§4.1 当前句播完即插队）。 */
  const splicePermissionAtBoundary = (index: number): void => {
    if (pendingPermissionSegments.length === 0) {
      return;
    }
    const spliced: string[] = [];
    for (const segment of pendingPermissionSegments) {
      spliced.push(...segment.sentences);
    }
    pendingPermissionSegments = [];
    if (spliced.length === 0) {
      return;
    }
    sentences.splice(index, 0, ...spliced);
    permissionWindow = { start: index, end: index + spliced.length };
    // §3.3 uninterruptible：整段闭合（段 = 一次权限请求的完整播报；连续段背靠背）。
    control.setUninterruptible(true);
    control.extendSentenceCount(sentences.length);
  };

  const speakCurrent = (leg: VoiceAnnouncementLegState): void => {
    // 权限段只在句边界拼接（当前句播完后的下一句起点）。
    splicePermissionAtBoundary(leg.sentenceIndex);
    const window = permissionWindow;
    // uninterruptible 只覆盖权限句区间：回到正文句即恢复可打断（§3.3 界定）。
    control.setUninterruptible(window != null && leg.sentenceIndex >= window.start && leg.sentenceIndex < window.end);
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
      rate: config?.rate,
    });
  };

  const startRenewLoop = (): void => {
    if (claimRenewTimer != null) {
      return;
    }
    // §3.5-1：Speaking 与 AnnPaused 全程持 claim 周期续约（FD-2：AnnPaused 是持约态）。
    claimRenewTimer = setInterval(() => {
      void (async () => {
        if (!control.snapshot().claimHeld) {
          stopRenewLoop();
          return;
        }
        const renewed = await deps.claim.renew(claimKey);
        if (renewed) {
          return;
        }
        // §3.5-3 漂移校正以 claim 为准：立即 cancel 回 AnnIdle（AnnPaused 被抢则作废续播意图）。
        logger.warn("voice.tts", "announcement claim lost; reverting to AnnIdle");
        deps.tts.cancel();
        control.cancelAnnouncement("claimLost");
        stopRenewLoop();
      })();
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
    deps.claim.release(claimKey);
  };

  const clearCancellingFallbackTimer = (): void => {
    if (cancellingFallbackTimer != null) {
      clearTimeout(cancellingFallbackTimer);
      cancellingFallbackTimer = null;
    }
  };

  deps.tts.onDone((handle, reason) => {
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
      // 正文队列已尽但仍欠权限段（权限在最后一句播报中到达）→ AnnIdle 起播排空（FD-3）。
      drainPendingPermissionFromIdle();
    }
    // annPaused：claim 保留（FD-2），等录音结束经 resumeSpeaking 续播。
  });

  /** claim 就绪后起播（§3.5-2 空窗即抢；§3.2 进入条件守卫在 store 侧）。turnId=null = 权限段专用起播。 */
  const ensureClaimAndSpeak = (
    turnId: string | null,
    queue: string[],
    opts?: { uninterruptibleLength?: number },
  ): void => {
    if (queue.length === 0) {
      return;
    }
    void (async () => {
      try {
        const before = control.snapshot();
        if (before.phase === "cancelling" || before.phase === "annPaused" || recording) {
          return; // 竞态防御：起播意图已过期。
        }
        if (!before.claimHeld) {
          const acquired = await deps.claim.acquire(claimKey);
          if (!acquired) {
            // §3.3 单播报者：未持有者静默（Phase 1 从简，无「其他窗口播报中」指示）。
            logger.info("voice.tts", "announcement claim held by another window; staying silent");
            return;
          }
          control.setClaimHeld(true);
        }
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
      } finally {
        turnStartInFlight = false;
        // 起播链落地后如有遗留权限段（如轮尾起播竞胜）：再排一次空。
        schedulePermissionDrain();
      }
    })();
  };

  /**
   * AnnIdle 段排空待播权限段（FD-3 权限不丢）：仅当无轮尾起播链在飞且相位仍是 AnnIdle；
   * speaking 期的 pending 由句界拼接消费，链在飞则等待 onDone 的 annIdle 排空。
   */
  const drainPendingPermissionFromIdle = (): void => {
    if (pendingPermissionSegments.length === 0) {
      return;
    }
    if (turnStartInFlight || control.snapshot().phase !== "annIdle") {
      return;
    }
    const drained: string[] = [];
    for (const segment of pendingPermissionSegments) {
      drained.push(...segment.sentences);
    }
    pendingPermissionSegments = [];
    if (drained.length === 0) {
      return;
    }
    ensureClaimAndSpeak(null, drained, { uninterruptibleLength: drained.length });
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
      if (!deps.isAnnouncementEnabled()) {
        return;
      }
      // Cancelling 终态判定先于 Recording 顺延：录音中任务被取消时 TurnComplete
      // (cancelled) 仍是完成信号（否则 Cancelling 被顺延吞掉、5s 兜底前播报腿卡死）。
      const leg = control.snapshot();
      if (leg.phase === "cancelling") {
        // TurnComplete(cancelled) 完成信号：回 AnnIdle 且不再播（§3.2 Cancelling 出边）。
        clearCancellingFallbackTimer();
        control.settleTaskCancel();
        return;
      }
      if (recording) {
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
      turnStartInFlight = true;
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
    },

    notifyStopPressed() {
      // §3.3 FD-1：任何播报态（含 uninterruptible 段、AnnPaused、Cancelling）立即静音回
      // AnnIdle；零协议、不取消任务（层①唯一点按载体是 TID_VOICE_ANN_STOP，Phase 1b）。
      pendingTail = null;
      announcedTurnId = null;
      activeHandle = null;
      pendingPermissionSegments = [];
      permissionWindow = null;
      deps.tts.cancel();
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
      permissionWindow = null;
      deps.tts.cancel();
      stopRenewLoopAndRelease();
    },

    consumePermissionSegment(segment) {
      if (!deps.isAnnouncementEnabled()) {
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
        pendingPermissionSegments.push({ permissionId: segment.permissionId, sentences: sentencesForSegment });
        return;
      }
      if (recording) {
        // 录音中到达：暂存，录音结束的续播边界先播权限段（FD-3 权限 > 正文）。
        pendingPermissionSegments.push({ permissionId: segment.permissionId, sentences: sentencesForSegment });
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

    requestCancelTask() {
      const leg = control.snapshot();
      if (leg.phase === "speaking" || leg.phase === "annPaused") {
        // 播报同步静音（§3.2 Speaking/AnnPaused→Cancelling；§4.3 层③）。
        activeHandle = null;
        pendingPermissionSegments = [];
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
      // 关闭/AnnIdle 时口述「停掉任务」仍须生效（§4.3/§4.8）。语音命令总线会广播到
      // 全部已注册 planner：多 pane 双发由 SessionPane.handleStop 的 canStop 守卫逐
      // pane 挡住，同会话残余双发落在 guard.stopTargetChanged → V4CommandNoopError
      //（spec §4.3 明载的防误杀机制）。
      deps.cancelTask?.();
    },

    notifyExternalTaskStop() {
      // §3.3 FD-1：任务被既有停止面（TID_V4_STOP / Esc 停止生成）取消——播报同步静音经
      // Cancelling 回 AnnIdle；不重复发 v4 stop（停止面已发过，guard.stopTargetChanged
      // 命中是 noop 无 ACK，5s 兜底由 requestCancelTask 同款定时器覆盖）。
      const leg = control.snapshot();
      if (leg.phase !== "speaking" && leg.phase !== "annPaused") {
        return;
      }
      activeHandle = null;
      pendingPermissionSegments = [];
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
      recording = false;
      pendingTail = null;
      announcedTurnId = null;
      activeHandle = null;
      pendingPermissionSegments = [];
      permissionWindow = null;
      deps.tts.cancel();
      control.cancelAnnouncement("stopPressed");
      clearCancellingFallbackTimer();
      stopRenewLoopAndRelease();
    },
  };
}

/**
 * 播报腿控制面的 store 适配（Phase 1b wiring 用）：把 voiceSessionStore 的 guarded
 * actions 映射为 AnnouncementLegControl。类型引入为 type-only，不构成运行时环
 * （voiceSessionStore 只反向依赖 voice/voiceTuning 常量）。
 */
export function createVoiceSessionAnnouncementControl(store: {
  getState(): VoiceSessionStoreActions & VoiceSessionStoreState;
}): AnnouncementLegControl {
  const call = () => store.getState();
  return {
    snapshot: () => call().announcement,
    extendSentenceCount: (total) => call().setSentenceCount(total),
    startSpeaking: (sentenceCount) => call().startAnnouncement(sentenceCount),
    markPauseRequested: () => call().markPauseRequested(),
    clearPauseRequested: () => call().clearPauseRequested(),
    sentenceCompleted: () => call().sentenceCompleted(),
    resumeSpeaking: () => call().resumeAnnouncement(),
    cancelAnnouncement: (source) => call().cancelAnnouncement(source),
    beginTaskCancel: () => call().beginTaskCancel(),
    settleTaskCancel: () => call().settleTaskCancel(),
    setClaimHeld: (held) => call().setClaimHeld(held),
    setUninterruptible: (uninterruptible) => call().setUninterruptible(uninterruptible),
  };
}
