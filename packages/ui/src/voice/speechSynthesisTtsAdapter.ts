/**
 * Chromium speechSynthesis TTS 适配器（specs/voice-agent-integration.md §9.3）。
 *
 * 仓内 speechSynthesis 零使用（spec 附录 B grep 核验），绿地实现；云 TTS 同端口后置换
 * （TV-3 keptOpen）。播放失败吞异常并落 voice.tts warn、不升级 error（§7.1：播放失败
 * 属可恢复；吞 autoplay 异常先例 taskNotificationSound.ts:19-42）。
 *
 * cancel() 语义：立即把所有在播 utterance 结算为 "cancelled" 并屏蔽引擎迟到的 end/error
 * 事件（以本地结算为准，规划器依赖确定性的句边界推进）。部分引擎 cancel 后不保证回调，
 * 本地立即结算保证 §3.3 FD-1「点按停止按钮立即回 AnnIdle」可测。
 */

import { logger } from "@/logger.js";
import type { VoiceTtsDoneReason, VoiceTtsHandle, VoiceTtsPort, VoiceTtsUtterance } from "./voiceTtsPort.js";

export interface SpeechSynthesisVoiceLike {
  readonly name: string;
  readonly lang: string;
}

export interface SpeechSynthesisUtteranceLike extends EventTarget {
  text: string;
  lang: string;
  voice: SpeechSynthesisVoiceLike | null;
  rate: number;
  volume: number;
}

export interface SpeechSynthesisErrorEventLike extends Event {
  readonly error: string;
}

export interface SpeechSynthesisLike {
  speak(utterance: SpeechSynthesisUtteranceLike): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoiceLike[];
}

export interface SpeechSynthesisTtsAdapterDeps {
  /** 缺省 window.speechSynthesis；测试注入 fake。 */
  getSpeechSynthesis?(): SpeechSynthesisLike | null;
  /** 缺省 new SpeechSynthesisUtterance(text)；测试注入 fake。 */
  createUtterance?(text: string): SpeechSynthesisUtteranceLike;
}

const CANCELLED_ERROR_CODES = new Set(["canceled", "interrupted"]);

export function createSpeechSynthesisTtsAdapter(deps: SpeechSynthesisTtsAdapterDeps = {}): VoiceTtsPort {
  const getSpeechSynthesis =
    deps.getSpeechSynthesis ??
    (() => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        return null;
      }
      return window.speechSynthesis as unknown as SpeechSynthesisLike;
    });
  const createUtterance =
    deps.createUtterance ??
    ((text: string) => {
      if (typeof SpeechSynthesisUtterance === "undefined") {
        throw new Error("SpeechSynthesisUtterance unavailable");
      }
      return new SpeechSynthesisUtterance(text) as unknown as SpeechSynthesisUtteranceLike;
    });

  const doneSubscribers = new Set<(handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => void>();
  /** utteranceId → 结算函数；cancel() 时全部以 cancelled 结算并屏蔽迟到事件。 */
  const active = new Map<string, (reason: VoiceTtsDoneReason) => void>();
  let utteranceCounter = 0;

  const emitDone = (handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => {
    // 快照后迭代：回调内可能退订。
    for (const cb of Array.from(doneSubscribers)) {
      cb(handle, reason);
    }
  };

  const settle = (handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => {
    const settleFn = active.get(handle.utteranceId);
    if (!settleFn) {
      return;
    }
    active.delete(handle.utteranceId);
    settleFn(reason);
  };

  return {
    speak(u: VoiceTtsUtterance): VoiceTtsHandle {
      const utteranceId = `voice-tts-${(utteranceCounter += 1)}`;
      const handle: VoiceTtsHandle = { utteranceId };
      const synthesis = getSpeechSynthesis();
      if (!synthesis) {
        logger.warn("voice.tts", "speechSynthesis unavailable, utterance dropped");
        // 吞异常语义（§7.1）：以 error 结算让规划器推进句边界，不向调用方抛出。
        emitDone(handle, "error");
        return handle;
      }

      let utterance: SpeechSynthesisUtteranceLike;
      try {
        utterance = createUtterance(u.text);
      } catch (error) {
        logger.warn("voice.tts", "utterance creation failed", error);
        emitDone(handle, "error");
        return handle;
      }
      utterance.text = u.text;
      utterance.lang = u.lang;
      utterance.rate = u.rate ?? 1;
      utterance.volume = 1;
      if (u.voice) {
        const matched = synthesis.getVoices().find((candidate) => candidate.name === u.voice);
        if (matched) {
          utterance.voice = matched;
        } else {
          // 音色名失效（系统音色集变化）：回落系统默认并 warn，不阻塞播报。
          logger.warn("voice.tts", `configured voice not found: ${u.voice}`);
        }
      }

      const onEnd = () => {
        utterance.removeEventListener("end", onEnd);
        utterance.removeEventListener("error", onError);
        settle(handle, "end");
      };
      const onError = (event: Event) => {
        utterance.removeEventListener("end", onEnd);
        utterance.removeEventListener("error", onError);
        const code = (event as SpeechSynthesisErrorEventLike).error;
        // canceled/interrupted = 本地 cancel 的引擎侧回声，按 cancelled 结算（通常已被
        // cancel() 先行结算，这里兜底）；其余按播放失败 warn + error 结算。
        const reason: VoiceTtsDoneReason = CANCELLED_ERROR_CODES.has(code) ? "cancelled" : "error";
        if (reason === "error") {
          logger.warn("voice.tts", `utterance failed: ${code}`);
        }
        settle(handle, reason);
      };
      utterance.addEventListener("end", onEnd);
      utterance.addEventListener("error", onError);
      active.set(utteranceId, (reason) => {
        utterance.removeEventListener("end", onEnd);
        utterance.removeEventListener("error", onError);
        emitDone(handle, reason);
      });

      try {
        synthesis.speak(utterance);
      } catch (error) {
        logger.warn("voice.tts", "speak() rejected", error);
        settle(handle, "error");
      }
      return handle;
    },
    cancel(): void {
      const synthesis = getSpeechSynthesis();
      if (synthesis) {
        try {
          synthesis.cancel();
        } catch (error) {
          logger.warn("voice.tts", "cancel() rejected", error);
        }
      }
      // 本地立即结算所有在播句为 cancelled；引擎迟到事件经 settle() 幂等屏蔽。
      // 快照后迭代：结算中会 delete，直接迭代原 Map 语义不清。
      for (const [utteranceId, settleFn] of Array.from(active)) {
        active.delete(utteranceId);
        settleFn("cancelled");
      }
    },
    onDone(cb: (handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => void): () => void {
      doneSubscribers.add(cb);
      return () => {
        doneSubscribers.delete(cb);
      };
    },
  };
}
