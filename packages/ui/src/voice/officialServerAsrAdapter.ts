/**
 * 官方服务端 ASR 适配器（specs/voice-agent-integration.md §11 收编整合，2026-11-15
 * 用户裁定 D6 升级）：VoiceAsrPort 第 4 实现（engine="official"）。
 *
 * 收编形态：官方 v3.18.0 语音输入链路（packages/ui/src/voice-input/ +
 * packages/services/src/voice-input/）零改动，本适配器以注入句柄桥接其服务端
 * realtime ASR（drora-server WS 协议，pcm_s16le/16k/mono）；采集复用本模块
 * pcmStreamCapture（与豆包 sauc 流式同格式同源自研件，16k/16bit/mono PCM16，
 * 架构上 voice 模块不得 deep-import 官方 voice-input 内部件，官方 startPcmCapture
 * 保持仅供官方链路自用）；权限预检复用官方 microphone.ensureAccess——句柄与预检
 * 由装配点（useVoiceEntrySupport，engine=official 时）从 useBaseWorkspaceServices
 * 与 platform 直传，本文件零 import 官方实现。
 *
 * 事件映射（官方 VoiceInputEvent → VoiceAsrPort 契约）：
 * - result（整段快照，替换不追加）→ onPartial（预览条实时滚字，§5.1 partial 永不进正文）；
 * - completed（服务端终稿优化文本）→ onFinal 恰一次 + stop() resolve {final:""}
 *   （对齐 remoteAsrAdapter 批量交付契约：终稿只走 onFinal 一次，stop 恒空串防双交付）；
 * - error → §11.2 错误码映射（network/proxy/rate_limited/unavailable/upstream_timeout/
 *   failed→network；unauthorized→service-not-allowed；audio_limit_exceeded→aborted；
 *   audio_too_short→no-speech）经 onError 上抛，§5.3 处置（保留已注入文本+提示、
 *   不自动重启）由消费方 useVoiceDictation 既有链承担。
 *
 * 混合流式预览不适用（引擎自身流式，§9.6.10 豆包同款先例）。
 */

import { logger } from "@/logger.js";
import { startPcmStreamCapture, type PcmStreamDeps, type PcmStreamHandle } from "./pcmStreamCapture.js";
import { VOICE_OFFICIAL_ASR_STOP_SETTLE_TIMEOUT_MS } from "./voiceTuning.js";
import { mapGetUserMediaError } from "./webSpeechAsrAdapter.js";
import { VoiceAsrError, type VoiceAsrErrorCode } from "./voiceAsrPort.js";
import type { VoiceAsrPort, VoiceAsrSession } from "./voiceAsrPort.js";

/**
 * 官方引擎事件（结构镜像 services/src/voice-input/contract.ts 的 VoiceInputEvent；
 * error.code 在官方侧是收窄枚举，此处放宽为 string——映射函数对其余值统一兜底
 * "network"，不依赖官方枚举成员清单，上游加码零改动）。
 */
export type OfficialServerAsrEvent =
  | { attemptId: string; type: "started" }
  | { attemptId: string; type: "result"; text: string }
  | { attemptId: string; type: "completed"; text: string }
  | { attemptId: string; type: "error"; code: string };

/**
 * 官方引擎句柄（结构即官方 IVoiceInputService，services/src/voice-input/contract.ts；
 * 装配点传真实服务对象，测试传 fake——依赖倒置，适配器不感知 RPC 层）。
 */
export interface OfficialServerAsrEngineHandle {
  start(params: { attemptId: string; language: "zh-CN" | "en-US" }): Promise<void>;
  sendAudio(params: { attemptId: string; chunk: Uint8Array }): Promise<void>;
  finish(params: { attemptId: string }): Promise<void>;
  cancel(params: { attemptId: string }): Promise<void>;
  onEvent(listener: (event: OfficialServerAsrEvent) => void): { dispose(): void };
}

/** 官方错误码 → §5.3 错误码映射（单一出处，测试直测）。 */
export function mapOfficialServerAsrErrorCode(code: string): VoiceAsrErrorCode {
  switch (code) {
    case "unauthorized":
      // 登录/token 失效：权限族提示（服务未授权），非网络族。
      return "service-not-allowed";
    case "audio_limit_exceeded":
      // 服务端时长上限：丢弃式收尾（aborted 同族，不提示网络故障）。
      return "aborted";
    case "audio_too_short":
      // 音频过短=静音族（§5.3「同静音超时处理」）。
      return "no-speech";
    case "network":
    case "proxy":
    case "rate_limited":
    case "unavailable":
    case "upstream_timeout":
    case "failed":
    default:
      // 服务不可用族统一 network（保留已注入文本+「语音服务不可用」提示）；
      // 未知码（上游新增）兜底 network，语义最接近且不误报权限。
      return "network";
  }
}

/** BCP-47 → 官方服务 language 双值枚举（镜像官方 useComposerVoiceInput 的映射）。 */
export function resolveOfficialAsrLanguage(lang: string): "zh-CN" | "en-US" {
  return lang.startsWith("zh") ? "zh-CN" : "en-US";
}

export interface OfficialServerAsrAdapterDeps {
  /** 官方引擎句柄（装配点注入真实 voiceInputService）。 */
  handle: OfficialServerAsrEngineHandle;
  /**
   * 系统级麦克风权限预检（官方 microphone.ensureAccess；denied → not-allowed
   * fail-closed，granted/unsupported 放行——与官方 useComposerVoiceInput begin()
   * 同一预检语义：unsupported 时由 getUserMedia 后续失败归类）。
   */
  ensureMicAccess?: () => Promise<"granted" | "denied" | "unsupported">;
  /** 采集 deps（缺省 window 系；测试注入 fake，与豆包适配器同款 DI 形态）。 */
  pcmDeps?: PcmStreamDeps;
  /** 采集工厂（缺省 startPcmStreamCapture；同模块 DI，测试注入 fake）。 */
  startCapture?: typeof startPcmStreamCapture;
  /** stop 终稿等待窗口；缺省 VOICE_OFFICIAL_ASR_STOP_SETTLE_TIMEOUT_MS。 */
  stopSettleTimeoutMs?: number;
}

export function createOfficialServerAsrAdapter(deps: OfficialServerAsrAdapterDeps): VoiceAsrPort {
  const partialSubscribers = new Set<(text: string) => void>();
  return {
    isSupported: () => true, // 句柄在场即支持（装配点保证已过可用性判定）；权限/服务失败在 start fail-closed。
    onPartial(cb: (text: string) => void): () => void {
      partialSubscribers.add(cb);
      return () => {
        partialSubscribers.delete(cb);
      };
    },
    async start({ lang }: { lang: string }): Promise<VoiceAsrSession> {
      // 权限预检（官方链路同位）：denied → 不开麦、不建会话，直接 fail-closed。
      const access = await deps.ensureMicAccess?.().catch(() => "unsupported" as const);
      if (access === "denied") {
        throw new VoiceAsrError("not-allowed", "official asr microphone permission denied");
      }

      const attemptId = crypto.randomUUID();
      const finalSubscribers = new Set<(text: string) => void>();
      const errorSubscribers = new Set<(error: VoiceAsrError) => void>();
      let capture: PcmStreamHandle | null = null;
      let settled = false;
      let stopResolve: ((value: { final: string }) => void) | null = null;
      let stopSettleTimer: ReturnType<typeof setTimeout> | null = null;
      let deliveredFinal = false;

      const subscription = deps.handle.onEvent((event) => {
        if (event.attemptId !== attemptId || settled) return;
        switch (event.type) {
          case "started":
            // started 前的音频由官方服务按顺序缓存（service 注释原语义），无需本地缓冲。
            return;
          case "result":
            // 整段快照 → 预览条 partial（§5.1 永不进正文/协议）。
            if (event.text.trim().length > 0) {
              for (const cb of Array.from(partialSubscribers)) cb(event.text);
            }
            return;
          case "completed": {
            // 终稿恰一次（批量交付契约）：onFinal 一次 + stop() 空串结算。
            const text = event.text.trim();
            if (text.length > 0 && !deliveredFinal) {
              deliveredFinal = true;
              for (const cb of Array.from(finalSubscribers)) cb(text);
            }
            finishStop();
            return;
          }
          case "error":
            fail(mapOfficialServerAsrErrorCode(event.code), `official asr error: ${event.code}`);
            return;
        }
      });

      const cleanup = () => {
        subscription.dispose();
        if (stopSettleTimer != null) clearTimeout(stopSettleTimer);
        stopSettleTimer = null;
      };

      const finishStop = () => {
        // completed / 超时统一结算 stop()：恒空串（终稿已走 onFinal，防双交付）。
        // 服务端主动 completed（非 stop 路径，如服务侧会话结束）同样到达这里：
        // 采集一并释放，录音腿由消费方点停/守卫收尾。
        settled = true;
        cleanup();
        capture?.stop(); // 服务端主动 completed：同步停采集释放设备。
        capture = null;
        const resolve = stopResolve;
        stopResolve = null;
        resolve?.({ final: "" });
      };

      const fail = (code: VoiceAsrErrorCode, message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        capture?.stop(); // 丢弃式停采集（remainder 弃，不产生 final）。
        capture = null;
        // 官方服务对未知/已结束 attempt 忽略 cancel，无条件发送（官方 fail 同款）。
        void deps.handle.cancel({ attemptId }).catch(() => undefined);
        const resolve = stopResolve;
        stopResolve = null;
        resolve?.({ final: "" });
        const error = new VoiceAsrError(code, message);
        for (const cb of Array.from(errorSubscribers)) cb(error);
      };

      // 并行启动（官方顺序原则：服务会话先建，started 前到达的音频由官方服务
      // 按顺序缓存；采集与建会话可并行，块在句柄就位即上行——与豆包并行启动
      // 修复同型，避免启动链串行拖长 pressStop 取消窗口）。
      const capturePromise = (deps.startCapture ?? startPcmStreamCapture)((chunk) => {
        if (settled) return;
        void deps.handle.sendAudio({ attemptId, chunk: new Uint8Array(chunk) });
      }, deps.pcmDeps);
      try {
        await deps.handle.start({
          attemptId,
          language: resolveOfficialAsrLanguage(lang),
        });
        capture = await capturePromise;
      } catch (error) {
        // getUserMedia 失败归类沿用自研 webSpeech 映射；先撤服务会话再上抛。
        capturePromise.then((cap) => cap.stop()).catch(() => undefined);
        const mapped = mapGetUserMediaError(error);
        fail(mapped.code, mapped.message);
        throw mapped;
      }

      return {
        onFinal(cb: (text: string) => void): () => void {
          finalSubscribers.add(cb);
          return () => {
            finalSubscribers.delete(cb);
          };
        },
        onError(cb: (error: VoiceAsrError) => void): () => void {
          errorSubscribers.add(cb);
          return () => {
            errorSubscribers.delete(cb);
          };
        },
        async stop(): Promise<{ final: string }> {
          if (settled) return { final: "" };
          if (capture) {
            // 停采集：remainder（不足一块的尾块）显式上行后再 finish——同一 RPC
            // 通道按调用顺序送达，finish 一定排在尾块之后（官方链路同语义）。
            const { remainder } = capture.stop();
            capture = null;
            if (remainder && remainder.byteLength > 0 && !settled) {
              void deps.handle.sendAudio({ attemptId, chunk: new Uint8Array(remainder) });
            }
            logger.debug("voice.asr", "official asr capture stopped");
          }
          if (settled) return { final: "" };
          await deps.handle.finish({ attemptId }).catch(() => undefined);
          if (settled) return { final: "" };
          return new Promise<{ final: string }>((resolve) => {
            stopResolve = resolve;
            stopSettleTimer = setTimeout(() => {
              // 终稿等待超时：按 network 出腿（对齐 remoteAsrAdapter 上传失败语义），
              // stop() 同步空串结算防停止链悬挂（fail 内部 settled 守卫幂等）。
              fail("network", "official asr stop settle timeout");
            }, deps.stopSettleTimeoutMs ?? VOICE_OFFICIAL_ASR_STOP_SETTLE_TIMEOUT_MS);
          });
        },
        abort(): void {
          if (settled) {
            cleanup();
            return;
          }
          settled = true;
          cleanup();
          capture?.stop(); // 丢弃式停采集（remainder 弃）。
          capture = null;
          // 取消式停止：官方服务不再发本 attempt 事件（cancel 语义）。
          void deps.handle.cancel({ attemptId }).catch(() => undefined);
          const resolve = stopResolve;
          stopResolve = null;
          resolve?.({ final: "" });
        },
      };
    },
  };
}
