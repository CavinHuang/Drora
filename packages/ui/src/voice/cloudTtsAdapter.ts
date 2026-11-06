/**
 * 云 TTS 适配器（specs/voice-agent-integration.md §9.6.5 v1 逐句批量，§9.6.1 OpenAI
 * 兼容音频端点族）：`speak(u)` → `POST {baseUrl}/audio/speech`（JSON：model/input/
 * voice/speed），响应二进制音频在 renderer 解码播放；实现既有 VoiceTtsPort（零改动），
 * 句切分/排队/暂停续播全部归 turnSpeechPlanner。
 *
 * 映射（§9.6.5-1 / §6.1 既有配置；云 voice 子句由 §9.7.3 取代）：
 * model=voiceTtsVendorModel（wiring 注入）、input=u.text、
 * voice=u.vendorVoice ?? 缺省省略（云音色独立键 voiceTtsVendorVoice，空 = 厂商默认）、
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
import type {
  VoiceTtsDoneReason,
  VoiceTtsHandle,
  VoiceTtsPort,
  VoiceTtsUtterance,
} from "./voiceTtsPort.js";

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
  /** 火山分支（§14）读 NDJSON 文本流用；既有 OpenAI 路径不需要。 */
  text?(): Promise<string>;
}

/** 二进制音频播放抽象（缺省 HTMLAudioElement + objectURL；测试注入 fake）。 */
export interface CloudTtsPlaybackHandle {
  /** resolve = 自然播完（"end"）；"error" = 播放失败。 */
  completed: Promise<"end" | "error">;
  /** 立即停止（cancel 路径）；completed 以 "end" 结算（cancelled 语义由适配器统一发）。 */
  stop(): void;
}

/** DI fetch 形状（测试 mock HTTP 与 synthesizeOnce opts.fetch 消费）。 */
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

/** 火山引擎 TTS 端点识别（§14）：baseUrl host 指向豆包语音开放接口。 */
export function isVolcanoTtsEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host === "openspeech.bytedance.com";
  } catch {
    return false;
  }
}

/**
 * 火山资源 ID 推断（§14，社区实现同规则）：uranus 系 = 2.0 大模型；S_ 前缀 =
 * 声音复刻；其余（含 moon_bigtts 台湾腔系）= 1.0。
 */
export function inferVolcanoResourceId(voiceType: string): string {
  if (voiceType.startsWith("S_")) {
    return "seed-icl-1.0";
  }
  if (voiceType.includes("uranus")) {
    return "seed-tts-2.0";
  }
  return "seed-tts-1.0";
}

/**
 * 火山凭据双形态解析（§14.2/§15）：含冒号 = 旧版控制台复合形态 `AppID:Access Token`；
 * 无冒号 = 新版控制台单 API Key。空串/纯空白 = null（fail-closed，无出站）。
 */
export type VolcanoCredential =
  | { mode: "composite"; appId: string; accessKey: string }
  | { mode: "single"; apiKey: string };

export function parseVolcanoCredentials(apiKey: string): VolcanoCredential | null {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return null;
  }
  const sep = trimmed.indexOf(":");
  if (sep < 0) {
    return { mode: "single", apiKey: trimmed };
  }
  const appId = trimmed.slice(0, sep).trim();
  const accessKey = trimmed.slice(sep + 1).trim();
  if (!appId || !accessKey) {
    return null;
  }
  return { mode: "composite", appId, accessKey };
}

/** 乘数语速（0.25–4）→ 火山 speech_rate [-50, 100]（1 = 0）。 */
export function toVolcanoSpeechRate(rate: number | undefined): number {
  const raw = Math.round(((rate ?? 1) - 1) * 100);
  return Math.min(100, Math.max(-50, raw));
}

/**
 * §14 火山分支合成：POST {baseUrl}/api/v3/tts/unidirectional（NDJSON 流），
 * 逐行收集 base64 分片拼成 mp3 Blob。失败抛错（调用方统一 warn + settle error）。
 */
async function synthesizeVolcano(
  config: RemoteTtsVendorConfig,
  text: string,
  doFetch: (input: string, init: RequestInit) => Promise<ResponseLike>,
  signal: AbortSignal,
  /** 乘数语速（0.25–4）→ speech_rate [-50,100]（§14.3 映射；§15 审查修复此前恒 0 丢弃偏好）。 */
  rate?: number,
): Promise<Blob> {
  const credentials = parseVolcanoCredentials(config.apiKey);
  if (!credentials) {
    // 稳定英文标识（表单层 toast 直显；en-US 用户也会看到）——语义=key 形态不合法。
    throw new Error(
      "volcano tts api key must be 'AppID:Access Token' (colon-separated) or a new-console API key",
    );
  }
  const requestId = crypto.randomUUID();
  // 凭据形态分派（§14.2）：复合 = 旧版双头；单值 = 新版 X-Api-Key。Resource-Id 两形态均必带。
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Api-Resource-Id": inferVolcanoResourceId(config.model),
    "X-Api-Request-Id": requestId,
  };
  // 头名勘误（2026-11-06 CORS 探针实证）：复合模式 App 侧头名是 X-Api-App-Key（官方
  // 文档与预检白名单一致），§14 初版误作 X-Api-App-Id——该名不在火山 CORS 白名单，
  // renderer 直连预检必死（复合模式自此一直不可用）。单 Key 头 X-Api-Key 同样不在
  // 白名单，renderer 直连不可用（主进程代理另行立项，spec §14.2 backlog）。
  if (credentials.mode === "composite") {
    headers["X-Api-App-Key"] = credentials.appId;
    headers["X-Api-Access-Key"] = credentials.accessKey;
  } else {
    headers["X-Api-Key"] = credentials.apiKey;
  }
  const response = await doFetch(
    `${config.baseUrl.replace(/\/+$/u, "")}/api/v3/tts/unidirectional`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        user: { uid: "drora-tts" },
        req_params: {
          text,
          speaker: config.model,
          audio_params: {
            format: "mp3",
            sample_rate: 24000,
            speech_rate: toVolcanoSpeechRate(rate),
          },
        },
      }),
      credentials: "omit",
      redirect: "error",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error(`volcano tts request rejected: ${response.status}`);
  }
  if (!response.text) {
    throw new Error("volcano tts fetch impl lacks text()");
  }
  const raw = await response.text();
  const chunks: Uint8Array[] = [];
  let ended = false;
  let lastError = "";
  for (const line of raw.split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }
    let parsed: { code?: number; message?: string; data?: string };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      continue;
    }
    const code = parsed.code ?? 0;
    if (code === 20000000) {
      ended = true;
      break;
    }
    if (code !== 0) {
      lastError = `${code}: ${parsed.message ?? "unknown"}`;
      continue;
    }
    if (parsed.data) {
      const bytes = Uint8Array.from(atob(parsed.data), (ch) => ch.charCodeAt(0));
      chunks.push(bytes);
    }
  }
  if (chunks.length === 0) {
    throw new Error(lastError ? `volcano tts error ${lastError}` : "volcano tts returned no audio");
  }
  // ended=false 但有分片：流被截断，仍播放已收到的部分（宽容语义，与 OpenAI 路径一致）。
  void ended;
  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}

/**
 * OpenAI 兼容 /audio/speech 分支（§9.6.1，从 speak 内联抽出供 synthesizeOnce 复用）。
 * 非 2xx 抛错（speak 路径 catch → settle error，语义不变）。
 */
async function synthesizeOpenAiCompatible(
  config: RemoteTtsVendorConfig,
  text: string,
  doFetch: (input: string, init: RequestInit) => Promise<ResponseLike>,
  signal: AbortSignal,
  opts?: { rate?: number; voice?: string },
): Promise<Blob> {
  const body: Record<string, unknown> = {
    model: config.model,
    input: text,
    speed: clampTtsSpeed(opts?.rate),
  };
  // §9.7.3：body.voice 读云音色独立命名空间；缺省省略字段 = 厂商默认音色。
  if (opts?.voice) {
    body.voice = opts.voice;
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
    signal,
  });
  if (!response.ok) {
    // §15 深审项3：此前非 2xx 只抛 status，厂商错误体里的 quota/invalid key 细节被丢弃，
    // 表单 toast 无法提示真实原因。读响应文本提取细节拼进消息：text 为可选方法（火山分支
    // 约定）先判存在再 await；截断前 500 字符防超长体撑爆 toast；JSON 解析失败（HTML/纯
    // 文本错误页）就忽略，回退纯 status 消息。隐私边界不变：零日志，消息只含厂商响应体
    // 细节，不拼 apiKey/Authorization。
    let detail = "";
    if (response.text) {
      try {
        const raw = (await response.text()).slice(0, 500);
        const parsed = JSON.parse(raw) as {
          error?: { message?: unknown } | string;
          message?: unknown;
        };
        // 厂商错误体形状不一：OpenAI 系 {error:{message}}、网关 {message}、少数 {error:"..."}。
        const errorMessage =
          typeof parsed.error === "object" && parsed.error !== null
            ? parsed.error.message
            : undefined;
        detail =
          (typeof errorMessage === "string" ? errorMessage : undefined) ??
          (typeof parsed.message === "string" ? parsed.message : undefined) ??
          (typeof parsed.error === "string" ? parsed.error : undefined) ??
          "";
      } catch {
        // 解析/读文本失败：忽略细节，保留纯 status 消息。
      }
    }
    throw new Error(`cloud tts request rejected: ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response.blob();
}

/**
 * 单次合成（§15 试听）：按 baseUrl 分派火山/OpenAI 分支，失败直接 throw（消息含厂商
 * status/凭据形态提示，供表单 toast 直显）。与播报链路互不干扰（独立 AbortController）。
 */
export async function synthesizeOnce(
  config: RemoteTtsVendorConfig,
  text: string,
  opts?: { voice?: string; rate?: number; fetch?: CloudTtsFetch; signal?: AbortSignal },
): Promise<Blob> {
  const doFetch = opts?.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const signal = opts?.signal ?? new AbortController().signal;
  if (isVolcanoTtsEndpoint(config.baseUrl)) {
    return synthesizeVolcano(config, text, doFetch, signal, opts?.rate);
  }
  return synthesizeOpenAiCompatible(config, text, doFetch, signal, opts);
}

/** Blob 播放（缺省实现，§15 试听与播报共用）：objectURL + HTMLAudioElement。 */
export function playTtsBlob(blob: Blob): CloudTtsPlaybackHandle {
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

  const playBlob = deps.playBlob ?? playTtsBlob;

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
          // §14：火山引擎卡（openspeech.bytedance.com）走自有 v3 协议分支；
          // 其余 baseUrl 维持 OpenAI 兼容 /audio/speech 形状。
          if (isVolcanoTtsEndpoint(config.baseUrl)) {
            blob = await synthesizeVolcano(config, u.text, doFetch, abortController.signal, u.rate);
          } else {
            // §9.7.3：云音色独立命名空间（u.vendorVoice）；u.voice（system 音色名）零消费。
            blob = await synthesizeOpenAiCompatible(
              config,
              u.text,
              doFetch,
              abortController.signal,
              {
                rate: u.rate,
                voice: u.vendorVoice,
              },
            );
          }
        } catch (error) {
          if (cancelled) {
            return; // 用户取消路径已结算（或本句已被跳过结算）。
          }
          logger.warn("voice.tts", "cloud tts request failed", {
            type: error instanceof Error ? error.name : "unknown",
            message: error instanceof Error ? error.message : undefined,
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
