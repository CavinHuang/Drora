/**
 * 云 TTS 适配器（specs/voice-agent-integration.md §9.6.5 v1 逐句批量，§9.6.1 OpenAI
 * 兼容音频端点族）：`speak(u)` → `POST {baseUrl}/audio/speech`（JSON：model/input/
 * voice/speed），响应二进制音频在 renderer 解码播放；实现既有 VoiceTtsPort（零改动），
 * 句切分/排队/暂停续播全部归 turnSpeechPlanner。
 *
 * 映射（§9.6.5-1 / §6.1 既有配置）：model=voiceTtsVendorModel（wiring 注入）、
 * input=u.text、voice=u.voice ?? 缺省（voiceAnnouncementVoice 作为厂商音色 id）、
 * speed=u.rate ?? 1 映射端点 speed 0.25–4（越界钳制）；u.lang v1 不映射（默认厂商
 * 模型自判定语种）。
 *
 * 失败语义（§9.6.5-3）：单句合成/播放失败 = 跳过坏句（onDone("error") 交由 planner
 * 推进）+ voice.tts warn，不在播报中途换系统引擎重播同一句；连续
 * VOICE_TTS_CLOUD_CONSECUTIVE_FAILURES 句失败 → onConsecutiveFailures 回调一次
 * （wiring 据此中止本轮播报回 AnnIdle + 会话内回落 speechSynthesis + warn）。
 *
 * 隐私边界（§7.1 延伸）：任何日志不落 apiKey/Authorization 头/合成文本。
 */

import { logger } from "@/logger.js";
import { VOICE_TTS_CLOUD_CONSECUTIVE_FAILURES } from "./voiceTuning.js";
import type { VoiceTtsDoneReason, VoiceTtsHandle, VoiceTtsPort, VoiceTtsUtterance } from "./voiceTtsPort.js";

/** 厂商档三元组（wiring 从 appSettings+凭据服务组装注入，无具名 import）。@lintignore */
export interface RemoteTtsVendorConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ResponseLike {
  ok: boolean;
  status: number;
  blob(): Promise<Blob>;
}

/** 二进制音频播放抽象（缺省 HTMLAudioElement + objectURL；测试注入 fake）。 */
export interface CloudTtsPlaybackHandle {
  /** resolve = 自然播完（"end"）；"error" = 播放失败。 */
  completed: Promise<"end" | "error">;
  /** 立即停止（cancel 路径）；completed 以 "end" 结算（cancelled 语义由适配器统一发）。 */
  stop(): void;
}

/** DI fetch 形状（测试 mock HTTP 用）。@lintignore */
export type CloudTtsFetch = (input: string, init: RequestInit) => Promise<ResponseLike>;

/** DI deps 注入形状（测试 mock HTTP/播放消费）。@lintignore */
export interface CloudTtsAdapterDeps {
  /** 厂商档（异步：apiKey 经凭据服务读取后注入）；null/字段缺失 = 档不完整。 */
  getVendorConfig(): Promise<RemoteTtsVendorConfig | null>;
  /** 缺省 globalThis.fetch；测试注入 mock HTTP（不发真实厂商请求）。 */
  fetch?(input: string, init: RequestInit): Promise<ResponseLike>;
  /** 缺省 HTMLAudioElement + objectURL 播放；测试注入 fake。 */
  playBlob?(blob: Blob): CloudTtsPlaybackHandle;
  /** 连续失败阈值，缺省 voiceTuning 值；测试可缩短。 */
  consecutiveFailuresThreshold?: number;
}

/** 端口 + 回落信号（wiring 消费 onConsecutiveFailures；协议形状导出）。@lintignore */
export interface CloudTtsPort extends VoiceTtsPort {
  /** 连续失败达阈值时 fire 一次（wiring：中止本轮回 AnnIdle + 会话内回落 speechSynthesis + warn）。 */
  onConsecutiveFailures(cb: () => void): () => void;
}

export function clampTtsSpeed(rate: number | undefined): number {
  const raw = rate ?? 1;
  if (!Number.isFinite(raw)) {
    return 1;
  }
  return Math.min(4, Math.max(0.25, raw));
}

export function resolveTtsEngineChoice(inputs: {
  engine: "system" | "cloud";
  vendorConfigComplete: boolean;
}): "system" | "cloud" {
  // §9.6.5-2：voiceTtsEngine="cloud" 且 TTS 厂商档完整 → cloud；否则 speechSynthesis。
  if (inputs.engine === "cloud" && inputs.vendorConfigComplete) {
    return "cloud";
  }
  return "system";
}

export function createCloudTtsAdapter(deps: CloudTtsAdapterDeps): CloudTtsPort {
  const doFetch = deps.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const threshold = deps.consecutiveFailuresThreshold ?? VOICE_TTS_CLOUD_CONSECUTIVE_FAILURES;

  const doneSubscribers = new Set<(handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => void>();
  const failureSubscribers = new Set<() => void>();
  /** utteranceId → 结算函数（幂等：cancel 与请求/播放完成竞争时只结算一次）。 */
  const active = new Map<string, (reason: VoiceTtsDoneReason) => void>();
  let consecutiveFailures = 0;
  let utteranceCounter = 0;

  const emitDone = (handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => {
    for (const cb of Array.from(doneSubscribers)) {
      cb(handle, reason);
    }
  };

  const settle = (handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => {
    const cancelFn = active.get(handle.utteranceId);
    if (!cancelFn) {
      return; // 已结算（幂等）：cancel 与请求/播放完成竞争时后到方丢弃。
    }
    active.delete(handle.utteranceId);
    cancelFn(reason);
    emitDone(handle, reason);
    if (reason === "error") {
      consecutiveFailures += 1;
      if (consecutiveFailures >= threshold) {
        consecutiveFailures = 0;
        logger.warn(
          "voice.tts",
          `cloud tts failed ${threshold} consecutive sentences; aborting this announcement and falling back to speechSynthesis`,
        );
        for (const cb of Array.from(failureSubscribers)) {
          cb();
        }
      }
      return;
    }
    // 自然播完/取消都清零计数（取消是用户手势不是厂商故障）。
    consecutiveFailures = 0;
  };

  const defaultPlayBlob = (blob: Blob): CloudTtsPlaybackHandle => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const completed = new Promise<"end" | "error">((resolve) => {
      audio.addEventListener("ended", () => resolve("end"), { once: true });
      audio.addEventListener("error", () => resolve("error"), { once: true });
    });
    void audio.play().catch(() => undefined);
    return {
      completed,
      stop: () => {
        audio.pause();
        audio.removeAttribute("src");
        URL.revokeObjectURL(url);
      },
    };
  };

  const playBlob = deps.playBlob ?? defaultPlayBlob;

  return {
    speak(u: VoiceTtsUtterance): VoiceTtsHandle {
      const utteranceId = `cloud-tts-${(utteranceCounter += 1)}`;
      const handle: VoiceTtsHandle = { utteranceId };
      const abortController = new AbortController();
      let playback: CloudTtsPlaybackHandle | null = null;
      let cancelled = false;
      // 取消执行器：中止请求/播放；done 事件由 settle() 统一 emit（含 cancelled）。
      active.set(utteranceId, () => {
        cancelled = true;
        abortController.abort();
        playback?.stop();
      });
      void (async () => {
        const config = await deps.getVendorConfig();
        if (cancelled) {
          return;
        }
        if (!config || !config.baseUrl.trim() || !config.model.trim() || !config.apiKey.trim()) {
          // 档在会话内被清空：按单句失败走回落计数（wiring 会话内回落兜底）。
          logger.warn("voice.tts", "cloud tts vendor config incomplete; sentence skipped");
          settle(handle, "error");
          return;
        }
        let blob: Blob;
        try {
          const body: Record<string, unknown> = {
            model: config.model,
            input: u.text,
            speed: clampTtsSpeed(u.rate),
          };
          if (u.voice) {
            body.voice = u.voice;
          }
          const response = await doFetch(`${config.baseUrl.replace(/\/+$/u, "")}/audio/speech`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            credentials: "omit",
            redirect: "error",
            signal: abortController.signal,
          });
          if (!response.ok) {
            logger.warn("voice.tts", "cloud tts request rejected", { status: response.status });
            settle(handle, "error");
            return;
          }
          blob = await response.blob();
        } catch (error) {
          if (cancelled) {
            return; // 用户取消路径已结算（或本句已被跳过结算）。
          }
          logger.warn("voice.tts", "cloud tts request failed", {
            type: error instanceof Error ? error.name : "unknown",
          });
          settle(handle, "error");
          return;
        }
        if (cancelled) {
          return;
        }
        playback = playBlob(blob);
        const outcome = await playback.completed;
        if (cancelled) {
          return;
        }
        settle(handle, outcome === "error" ? "error" : "end");
      })();
      return handle;
    },
    cancel(): void {
      // 全停（§2.3）：中止合成请求/播放并把全部在途句结算为 cancelled。
      for (const [utteranceId, cancelFn] of Array.from(active)) {
        active.delete(utteranceId);
        cancelFn("cancelled");
        emitDone({ utteranceId }, "cancelled");
      }
    },
    onDone(cb: (handle: VoiceTtsHandle, reason: VoiceTtsDoneReason) => void): () => void {
      doneSubscribers.add(cb);
      return () => {
        doneSubscribers.delete(cb);
      };
    },
    onConsecutiveFailures(cb: () => void): () => void {
      failureSubscribers.add(cb);
      return () => {
        failureSubscribers.delete(cb);
      };
    },
  };
}

