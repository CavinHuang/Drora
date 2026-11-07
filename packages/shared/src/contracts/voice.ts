/**
 * 语音 Agent 跨进程契约常量（specs/voice-agent-integration.md §2.1，Phase 0 契约先行）。
 *
 * 契约键单一出处（AGENTS.md）：以下字面量只在此定义一次，生产方与消费方引用同一常量；
 * 改名任何一侧前先全链 grep 生产与消费。结构照 contracts/desktopPet.ts 先例
 * （对象常量 + 嵌套 channel 命名）。
 *
 * 明确不进本文件（§2.1 冻结）：行为阈值（录音超时、简报限流窗口、claim 续约间隔、
 * lastDictation TTL）是 renderer 行为参数而非跨进程契约键，放
 * packages/ui/src/voice/voiceTuning.ts；打断词表放 packages/ui/src/voice/interruptionWords.ts
 * （UI 交互判定，不进 wire）。
 */

import { z } from "zod";

/** wire 契约：input-intent source kind 字面量。drora-protocol-v4/input-intent.ts 的
 *  voiceInputSourceSchema 以 z.literal(VOICE_INPUT_SOURCE_KIND) 引用，禁止两处独立写字面量。 */
export const VOICE_INPUT_SOURCE_KIND = "voice";

/** appSettings 持久化键（validationAppSettings.ts schema 字段名与此一一对应，
 *  由 parity 单测钉住；specs/voice-agent-integration.md §6.1）。
 *
 * 模型能力收敛（specs/model-capabilities.md §3.3，批次二）：引擎选择与厂商档
 * （asrEngine/vendorBaseUrl/asrVendorModel/ttsEngine/ttsVendorModel/ttsVendorVoice
 * 六键）迁入模型能力档案（contracts/modelCapabilities.ts asr/tts 条目）；本表收窄为
 * 纯行为偏好 9 键（spec §0 澄清：行为偏好不是模型配置，留在语音分区）。 */
export const VOICE_SETTINGS_KEYS = {
  composerEntryHidden: "voiceComposerEntryHidden",
  announcementEnabled: "voiceAnnouncementEnabled",
  announcementVoice: "voiceAnnouncementVoice",
  announcementRate: "voiceAnnouncementRate",
  dictationLang: "voiceDictationLang",
  // §9.7.5：播报语言键；"" = 自动 = UI locale（现状语义原样保留为缺省）。
  announcementLang: "voiceAnnouncementLang",
  // §9.7.8：persona 显示键——唯一消费方 = 设置面 Select 显示派生（运行时零读路径，
  // 消费只读四个底层键；未知 id 自然回落「自定义」）。
  personaId: "voicePersonaId",
  toolBriefEnabled: "voiceToolBriefEnabled",
  privacyDisclosureAcknowledged: "voicePrivacyDisclosureAcknowledged",
  // §5.5.1：长按听写持键（VOICE_DICTATION_HOLD_KEYS 单一出处；默认 off）。
  dictationHoldKey: "voiceDictationHoldKey",
  // §5.5.2：remote 腿长按期间 webSpeech 实时预览（混合流式）。
  dictationHybridPreview: "voiceDictationHybridPreview",
} as const;

/** 跨窗口 claim 键（经既有 BroadcastHub 通用 claim 通道，Main 不解析语义）。 */
export const VOICE_BROADCAST_CLAIM_KEY = {
  announcement: "drora:voice-announcement-claim",
  /**
   * 预留键（FD-7 / EG-7 keptOpen）：Phase 1 零生产/消费方，唯一潜在消费方 EG-7
   * （spec §10）；随 EG-7 裁决启用或移除。Phase 0 的 dep:refs 同源断言不覆盖本键（§9.1）。
   */
  mic: "drora:voice-mic-claim",
} as const;

// ---------------------------------------------------------------------------
// 语音厂商出站代理（specs/model-capabilities.md §15.8，2026-11-06 用户裁定「代理根治」）
// ---------------------------------------------------------------------------

/** 火山引擎（豆包语音）host——协议识别（cloudTtsAdapter.isVolcanoTtsEndpoint）与代理白名单共用的单一出处。 */
export const VOICE_VENDOR_HOST_VOLCANO = "openspeech.bytedance.com";

/**
 * 允许经桌面主进程代理出站的厂商 host 白名单（specs/model-capabilities.md §15.8）。
 *
 * 契约键单一出处：isVolcanoTtsEndpoint 的协议识别与 voiceVendorRegistry 火山模板
 * matchHost 均引用本表（经 VOICE_VENDOR_HOST_VOLCANO），禁止多处独立写字面量；
 * 未来厂商撞 CORS = 本表加一项，renderer/main 两端自动生效。
 *
 * 背景：火山单 API Key 仅 `X-Api-Key` 一个鉴权槽位，且不在其 CORS 预检白名单
 * （2026-11-06 curl 实测，spec §15.8 探针矩阵），浏览器 renderer 直连不可修复——
 * 唯一出路是桌面 main 经 net.fetch 代理（main 不受 CORS 约束）。
 */
export const VOICE_VENDOR_PROXY_ALLOWED_HOSTS = [VOICE_VENDOR_HOST_VOLCANO] as const;

/** url host 是否允许经桌面代理出站（解析失败 = false，fail-closed）。 */
export function isVoiceVendorProxyAllowedUrl(url: string): boolean {
  try {
    return (VOICE_VENDOR_PROXY_ALLOWED_HOSTS as readonly string[]).includes(new URL(url).host);
  } catch {
    return false;
  }
}

/** 代理硬边界（main 侧强制执行；renderer 侧仅作提示，不重复校验）。 */
export const VOICE_VENDOR_PROXY_LIMITS = {
  /** 请求 JSON 文本上限（对齐 relay-v2 body 硬闸量级；TTS 句文本远小于此）。 */
  maxRequestBodyChars: 64 * 1024,
  /** 响应 base64 上限（≈17.6MB 解码后音频；句级 TTS 远小于此）。 */
  maxResponseBodyBase64Chars: 24 * 1024 * 1024,
  /** main 侧 net.fetch 硬超时（AbortSignal 不跨 IPC，main 自带兜底）。 */
  requestTimeoutMs: 60_000,
} as const;

/** 代理请求载荷（renderer → main；headers 值经 main 二次键过滤）。 */
export interface VoiceVendorProxyFetchRequest {
  url: string;
  headers: Record<string, string>;
  /** 请求体 JSON 文本（TTS 两分支均 JSON；上传类 ASR multipart 不入代理 v1）。 */
  body: string;
}

/** 代理响应载荷（main → renderer；body 统一 base64，NDJSON 文本与 mp3 二进制都安全）。 */
export interface VoiceVendorProxyFetchResponse {
  ok: boolean;
  status: number;
  contentType: string | null;
  bodyBase64: string;
}

/**
 * 长按听写持键枚举（§5.5.1 单一出处；validationAppSettings z.enum / protocol wire /
 * 捕获层匹配 / 设置 Select 全部引用此处）。
 * - "off"：默认关。
 * - "fn"：macOS 🌐，需系统设置「按下 🌐 键时=无操作」。
 * - "right-meta"：右 ⌘（推荐——事件可靠、零字符输出、听写工具通行约定）。
 * - "right-alt"：右 ⌥（备选）。
 * 左侧修饰键不触发（左右侧经 event.code 精确区分）。
 */
export const VOICE_DICTATION_HOLD_KEYS = ["off", "fn", "right-meta", "right-alt"] as const;
export type VoiceDictationHoldKey = (typeof VOICE_DICTATION_HOLD_KEYS)[number];

// ---------------------------------------------------------------------------
// 真流式播报（specs/model-capabilities.md §16，2026-11-06 用户裁定「直接立项 B」）
// ---------------------------------------------------------------------------

/**
 * 流式代理三通道（specs/model-capabilities.md §16.2）：
 * Start（invoke，载荷复用 VoiceVendorProxyFetchRequest + 同一 schema/校验/limits）→
 * Chunk（main 经 webContents.send 推帧）→ Abort（invoke，取消并摘 GC 表）。
 * main 逐行读 net.fetch body（NDJSON `{code,data}`），每行立即推 `data` 帧；
 * EOF/`code 20000000` 推 `done`；非 2xx/网络异常/超限/校验失败推 `error`（errorMessage
 * 不含 apiKey）。chunk base64 只承载音频分片，上限沿 §15.8 LIMITS。
 */
export type VoiceVendorProxyStreamChunkKind = "data" | "done" | "error";

/** main → renderer 推送帧（seq 单调递增；renderer 侧断号 fail-closed 按句 error）。 */
export interface VoiceVendorProxyStreamChunkFrame {
  streamId: string;
  seq: number;
  kind: VoiceVendorProxyStreamChunkKind;
  /** kind="data" 时的音频 base64 分片（NDJSON data 字段原样转发）。 */
  base64Chunk?: string;
  /** kind="error" 时的 HTTP status（非 2xx 路径）。 */
  status?: number;
  /** kind="error" 时的稳定错误消息（不含 apiKey/Authorization）。 */
  errorMessage?: string;
}

/** Start 载荷校验复用整段 voiceVendorProxyFetchRequestSchema（同白名单/https/limits），无独立 schema。 */
export const voiceVendorProxyStreamAbortSchema = z
  .object({ streamId: z.string().min(1) })
  .strict();

export interface VoiceVendorProxyStreamAbortRequest {
  streamId: string;
}

/** main abort 通道入口校验（失败 throw）。 */
export function parseVoiceVendorProxyStreamAbortRequest(
  payload: unknown,
): VoiceVendorProxyStreamAbortRequest {
  return voiceVendorProxyStreamAbortSchema.parse(payload);
}

/** 流式响应上限（沿 §15.8 量级：累计解码字节闸 + 单流时长闸；main 侧强制）。 */
export const VOICE_VENDOR_PROXY_STREAM_LIMITS = {
  /** 单流累计音频字节上限（24MiB，与整段响应闸同量级）。 */
  maxStreamBytes: 24 * 1024 * 1024,
  /** 单流最长寿命 ms（沿 §15.8 60s；含排队与传输）。 */
  streamTimeoutMs: 60_000,
} as const;


export const voiceVendorProxyFetchRequestSchema = z
  .object({
    url: z.string().refine(isVoiceVendorProxyAllowedUrl, "url host not in vendor proxy allowlist"),
    headers: z.record(z.string(), z.string()),
    body: z.string().max(VOICE_VENDOR_PROXY_LIMITS.maxRequestBodyChars),
  })
  .strict();

/** main handler 入口校验（失败 throw，renderer 侧还原为网络异常语义）。 */
export function parseVoiceVendorProxyRequest(payload: unknown): VoiceVendorProxyFetchRequest {
  return voiceVendorProxyFetchRequestSchema.parse(payload);
}

/**
 * main 侧 header 键过滤白名单（防御纵深：renderer 载荷可被伪造，main 不信任）。
 * 放行语音两分支实际需要的键：火山 x-api-* 族 + OpenAI 兼容族 authorization/content-type。
 */
export function isVoiceVendorProxyAllowedHeaderKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized === "content-type" ||
    normalized === "authorization" ||
    normalized.startsWith("x-api-")
  );
}

// ---------------------------------------------------------------------------
// 豆包流式 ASR（specs/voice-agent-integration.md §9.6.10，2026-11-07 立项，按 Proma 架构）
// ---------------------------------------------------------------------------

/** sauc 流式 ASR 的 WS 端点模式（async=bigmodel_async 服务端攒句；duplex=bigmodel 实时）。 */
export type DoubaoAsrEndpointMode = "async" | "duplex";

/** ASR 专用复合凭据（卡 apiKey = "AppID:AccessToken"，冒号分隔；与 §15.9 TTS 单 Key 无涉）。 */
export interface DoubaoAsrCredentials {
  appId: string;
  accessKey: string;
}

/** 复合凭据解析：空串/缺段 = null（fail-closed，无出站）。 */
export function parseDoubaoAsrCredentials(apiKey: string): DoubaoAsrCredentials | null {
  const trimmed = apiKey.trim();
  if (!trimmed) return null;
  const sep = trimmed.indexOf(":");
  if (sep <= 0 || sep >= trimmed.length - 1) return null;
  return { appId: trimmed.slice(0, sep).trim(), accessKey: trimmed.slice(sep + 1).trim() };
}

/** sauc 资源 ID 单一出处（端点模式后缀由 modelId 预设承载）。 */
export const DOUBAO_ASR_RESOURCE_ID = "volc.seedasr.sauc.duration";

/** 流式 ASR 硬边界（main 强制）。 */
export const VOICE_ASR_STREAM_LIMITS = {
  /** 会话时长上限（对齐录音上限族）。 */
  sessionTimeoutMs: 60_000,
  /** 单帧 PCM 上限（200ms@16k16bit=6400B，取 8KB 上取整余量）。 */
  maxChunkBytes: 8192,
} as const;

export interface VoiceAsrStreamStartRequest {
  appId: string;
  accessKey: string;
  resourceId: string;
  endpointMode: DoubaoAsrEndpointMode;
  /** BCP-47 源（voiceDictationLang；空串=端点默认）。 */
  language: string;
}

export interface VoiceAsrStreamAudioChunk {
  streamId: string;
  /** 16k/16bit/单声道 PCM。 */
  pcm: ArrayBuffer;
  isLast: boolean;
}

export interface VoiceAsrStreamTranscriptFrame {
  streamId: string;
  text: string;
  isFinal: boolean;
}

export type VoiceAsrStreamStatus = "ended" | "error";

export interface VoiceAsrStreamStateFrame {
  streamId: string;
  status: VoiceAsrStreamStatus;
  errorMessage?: string;
}

export const voiceAsrStreamStartRequestSchema = z
  .object({
    appId: z.string().min(1),
    accessKey: z.string().min(1),
    resourceId: z.string().min(1),
    endpointMode: z.enum(["async", "duplex"]),
    language: z.string(),
  })
  .strict();

/** main Start 入口校验（失败 throw，renderer 还原为错误出腿）。 */
export function parseVoiceAsrStreamStartRequest(payload: unknown): VoiceAsrStreamStartRequest {
  return voiceAsrStreamStartRequestSchema.parse(payload);
}

export const voiceAsrStreamAudioChunkSchema = z.object({
  streamId: z.string().min(1),
  isLast: z.boolean(),
});

export const voiceAsrStreamAbortSchema = z
  .object({ streamId: z.string().min(1) })
  .strict();
