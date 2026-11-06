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
import { VOICE_VENDOR_HOST_VOLCANO } from "@drora/shared";
import { createStreamingPlayback } from "./voiceStreamingPlayback.js";
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

/** 流式播放器缺省工厂：createStreamingPlayback 包装为 adapter 播放形状（interrupt→stop）。 */
const defaultStreamPlaybackFactory = (): CloudTtsStreamingPlayback => {
  const player = createStreamingPlayback();
  return {
    appendChunk: (b64) => player.appendChunk(b64),
    finish: () => player.finish(),
    fail: (error) => player.fail(error),
    failNow: (error) => player.failNow(error),
    handle: {
      completed: player.handle.completed,
      stop: () => player.handle.interrupt(),
    },
  };
};

/** §16 流式代理端口（platform 三方法聚合；可选注入——缺席回退整段路径）。 */
export interface VoiceTtsStreamPort {
  start(request: {
    url: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<{ streamId: string }>;
  onChunk(handler: (frame: import("@drora/shared").VoiceVendorProxyStreamChunkFrame) => void): () => void;
  abort(payload: { streamId: string }): Promise<void>;
}

/** 流式播放器形状（createStreamingPlayback 返回子集；测试注入 fake）。 */
export interface CloudTtsStreamingPlayback {
  appendChunk(base64: string): void;
  finish(): void;
  fail(error: Error): void;
  /** 硬失败（§16 审查修复）：无条件停播 + completed("error")——断号 fail-closed 专用。 */
  failNow(error: Error): void;
  handle: CloudTtsPlaybackHandle;
}

/** DI deps 注入形状（测试 mock HTTP/播放消费）。@lintignore */
export interface CloudTtsAdapterDeps {
  /** 厂商档（异步：apiKey 经凭据服务读取后注入）；null/字段缺失 = 档不完整。 */
  getVendorConfig(): Promise<RemoteTtsVendorConfig | null>;
  /** 缺省 globalThis.fetch；测试注入 mock HTTP（不发真实厂商请求）。 */
  fetch?(input: string, init: RequestInit): Promise<ResponseLike>;
  /** 缺省 HTMLAudioElement + objectURL 播放；测试注入 fake。 */
  playBlob?(blob: Blob): CloudTtsPlaybackHandle;
  /** §16 流式三通道（platform 聚合）；缺席 = 火山也走整段（Web/手机/旧 bridge）。 */
  stream?: VoiceTtsStreamPort;
  /** 流式播放器工厂；缺省 createStreamingPlayback；测试注入 fake。 */
  streamPlaybackFactory?: () => CloudTtsStreamingPlayback;
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

/** 火山引擎 TTS 端点识别（§14）：baseUrl host 指向豆包语音开放接口（§15.8 起引用 shared 单一出处）。 */
export function isVolcanoTtsEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host === VOICE_VENDOR_HOST_VOLCANO;
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

/** 乘数语速（0.25–4）→ 火山 speech_rate [-50, 100]（1 = 0）。 */
export function toVolcanoSpeechRate(rate: number | undefined): number {
  const raw = Math.round(((rate ?? 1) - 1) * 100);
  return Math.min(100, Math.max(-50, raw));
}

/**
 * §14 火山分支合成：POST {baseUrl}/api/v3/tts/unidirectional（NDJSON 流），
 * 逐行收集 base64 分片拼成 mp3 Blob。失败抛错（调用方统一 warn + settle error）。
 * 凭据（§15.9 裁剪后唯一形态）：新版控制台单 API Key，恒 `X-Api-Key` 单头；空白
 * fail-closed。旧版 `AppID:Access Token` 复合模式已移除，无冒号分派。
 */
const VOLCANO_UNIDIRECTIONAL_PATH = "/api/v3/tts/unidirectional";

/** §16 请求构造单一出处：整段与流式两路径共用（headers/凭据校验 fail-closed）。 */
function volcanoRequestHeaders(config: RemoteTtsVendorConfig): Record<string, string> {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    // 稳定英文标识（表单层 toast 直显；en-US 用户也会看到）——语义=key 缺失。
    throw new Error("volcano tts api key is required (new-console single API key)");
  }
  // §15.9：凭据恒 X-Api-Key 单头；X-Api-Key 不在火山 CORS 白名单（2026-11-06 探针
  // 实证）——白名单厂商经桌面主进程代理出站（§15.8/§16 流式），直连仅为非白名单保留。
  return {
    "Content-Type": "application/json",
    "X-Api-Key": apiKey,
    "X-Api-Resource-Id": inferVolcanoResourceId(config.model),
    "X-Api-Request-Id": crypto.randomUUID(),
  };
}

/** §16 请求体构造单一出处（整段/流式同形）。 */
function volcanoRequestBody(config: RemoteTtsVendorConfig, text: string, rate?: number): string {
  return JSON.stringify({
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
  });
}

/**
 * §16 真流式合成-播放编排：Start 订阅分片帧 → 帧缓冲攒批渐进播放 → done 结算。
 * seq 断号 fail-closed（abort + interrupt + error）；error 帧交 player（无音频→error、
 * 已播宽容播完）；上游失败经 handle.completed 以 "error" 结算 → speak 路径统一回落计数。
 */
function speakVolcanoStreaming(
  config: RemoteTtsVendorConfig,
  text: string,
  stream: VoiceTtsStreamPort,
  createPlayer: () => CloudTtsStreamingPlayback,
  rate?: number,
): CloudTtsPlaybackHandle {
  const player = createPlayer();
  let streamId: string | null = null;
  let expectedSeq = 0;
  /** 本流已 fail-closed 终止：忽略后续帧（防重复结算/abort）。 */
  let streamPoisoned = false;
  /** completed 已结算（含 cancel/interrupt/正常完成）：start 迟到返回时补 abort 防僵尸流。 */
  let finalized = false;
  const unsubscribe = stream.onChunk((frame) => {
    if (streamId == null || frame.streamId !== streamId || streamPoisoned) {
      return;
    }
    if (frame.seq !== expectedSeq) {
      // 断号 = 流完整性破坏：硬失败（§16 审查修复——宽容 stop 会结算 "end" 归零回落计数，
      // 必须走 failNow 无条件 "error"，回落计数照旧）。
      streamPoisoned = true;
      void stream.abort({ streamId }).catch(() => undefined);
      player.failNow(new Error("voice vendor proxy stream out of order"));
      return;
    }
    expectedSeq += 1;
    if (frame.kind === "data" && frame.base64Chunk != null) {
      player.appendChunk(frame.base64Chunk);
    } else if (frame.kind === "done") {
      player.finish();
    } else if (frame.kind === "error") {
      player.fail(new Error(frame.errorMessage ?? "voice vendor proxy stream failed"));
    }
  });
  void stream
    .start({
      url: `${config.baseUrl.replace(/\/+$/u, "")}${VOLCANO_UNIDIRECTIONAL_PATH}`,
      headers: volcanoRequestHeaders(config),
      body: volcanoRequestBody(config, text, rate),
    })
    .then(({ streamId: id }) => {
      streamId = id;
      // Start 迟到（cancel/interrupt 先发生）：立即 abort 防僵尸流跑满 60s 硬闸。
      if (finalized) {
        void stream.abort({ streamId: id }).catch(() => undefined);
      }
    })
    .catch((error: unknown) => {
      logger.warn("voice.tts", "cloud tts stream start failed", {
        type: error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : undefined,
      });
      player.fail(error instanceof Error ? error : new Error("voice vendor proxy stream start failed"));
    });
  return {
    completed: player.handle.completed.finally(() => {
      finalized = true;
      unsubscribe();
      if (streamId != null) {
        void stream.abort({ streamId }).catch(() => undefined);
      }
    }),
    stop: () => {
      finalized = true;
      player.handle.stop();
      if (streamId != null) {
        void stream.abort({ streamId }).catch(() => undefined);
      }
    },
  };
}

/**
 * 厂商错误体细节提取（§15.7 OpenAI 分支同款逻辑抽公共——§16 后记补：火山分支此前
 * 漏接导致 401/403 时 toast 只见 status 不见厂商原因）。text 为可选方法（火山分支
 * 约定），先判存在再 await；截 500 字符防超长体；JSON 解析失败回退纯 status。
 * 隐私边界不变：零日志，消息只含厂商响应体细节，不拼 apiKey/Authorization。
 */
async function extractVendorErrorDetail(response: ResponseLike): Promise<string> {
  if (!response.text) {
    return "";
  }
  try {
    const raw = (await response.text()).slice(0, 500);
    const parsed = JSON.parse(raw) as {
      error?: { message?: unknown } | string;
      message?: unknown;
      header?: { message?: unknown; code?: unknown };
    };
    const errorMessage =
      typeof parsed.error === "object" && parsed.error !== null
        ? parsed.error.message
        : undefined;
    const headerMessage = typeof parsed.header?.message === "string" ? parsed.header.message : undefined;
    const headerCode = parsed.header?.code;
    const detail =
      (typeof errorMessage === "string" ? errorMessage : undefined) ??
      headerMessage ??
      (typeof parsed.message === "string" ? parsed.message : undefined) ??
      (typeof parsed.error === "string" ? parsed.error : undefined) ??
      "";
    // 火山错误体形如 {header:{code,message}}——code 有诊断价值（如 45000030 服务未授权）一并带上。
    const codeSuffix = typeof headerCode === "number" ? ` (code ${headerCode})` : "";
    return detail || codeSuffix ? `${detail}${codeSuffix}` : "";
  } catch {
    return ""; // 解析/读文本失败：忽略细节，保留纯 status 消息。
  }
}

async function synthesizeVolcano(
  config: RemoteTtsVendorConfig,
  text: string,
  doFetch: (input: string, init: RequestInit) => Promise<ResponseLike>,
  signal: AbortSignal,
  /** 乘数语速（0.25–4）→ speech_rate [-50,100]（§14.3 映射；§15 审查修复此前恒 0 丢弃偏好）。 */
  rate?: number,
): Promise<Blob> {
  const response = await doFetch(
    `${config.baseUrl.replace(/\/+$/u, "")}${VOLCANO_UNIDIRECTIONAL_PATH}`,
    {
      method: "POST",
      headers: volcanoRequestHeaders(config),
      body: volcanoRequestBody(config, text, rate),
      credentials: "omit",
      redirect: "error",
      signal,
    },
  );
  if (!response.ok) {
    // §16 后记补：火山分支此前漏接错误体解析（§15.7 只补了 OpenAI 分支）——
    // 401/403 时 toast 只见 status 不见厂商原因（如 45000030 服务未授权）。
    const detail = await extractVendorErrorDetail(response);
    throw new Error(`volcano tts request rejected: ${response.status}${detail ? `: ${detail}` : ""}`);
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
        try {
          await speakBody();
        } catch (error) {
          // 兜底（§16 审查修复）：流式播放器构造同步 throw / getVendorConfig reject
          // 等未预期异常若逃出会让句子永不结算（planner 卡死）——统一按句 error。
          if (!cancelled) {
            logger.warn("voice.tts", "cloud tts speak chain failed", {
              type: error instanceof Error ? error.name : "unknown",
              message: error instanceof Error ? error.message : undefined,
            });
            settle(handle, "error");
          }
        }
      })();

      async function speakBody(): Promise<void> {
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
        // §16：火山 + 平台流式通道存在 → 真流式（分片渐进播放，completed 即整句结算）；
        // 其余（非白名单/通道缺席/Web/手机）→ 整段路径零变化。
        if (isVolcanoTtsEndpoint(config.baseUrl) && deps.stream) {
          playback = speakVolcanoStreaming(
            config,
            u.text,
            deps.stream,
            deps.streamPlaybackFactory ?? defaultStreamPlaybackFactory,
            u.rate,
          );
        } else {
          let blob: Blob;
          try {
            // §14：火山引擎卡走自有 v3 协议分支（整段）；其余维持 OpenAI 兼容 /audio/speech。
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
        }
        const outcome = await playback.completed;
        if (cancelled) {
          return;
        }
        if (outcome === "error") {
          // 流式失败可观测性（§16 二审补）：error 帧/断号/解码失败在连败阈值前至少有逐句 warn。
          logger.warn("voice.tts", "cloud tts streaming sentence failed; counting toward fallback", {
            type: "stream_error",
          });
        }
        settle(handle, outcome === "error" ? "error" : "end");
      }
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
