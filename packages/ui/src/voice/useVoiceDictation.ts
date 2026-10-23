/**
 * 听写运行时（specs/voice-agent-integration.md §5.1–§5.4 / §3.2 输入腿）。
 *
 * 职责：驱动 webSpeechAsrAdapter 会话生命周期与 voiceSessionStore 输入腿迁移，把
 * partial 限定在预览条、逐句 final 经 composerTextInsertRequest(mode="append",
 * targetSessionId=绑定会话) 定向注入、打断词命中的 final 消费为命令（不注入）。
 * UI 判定一律在 voiceComposerEntryState 纯函数；本 hook 只做编排，不复制分支。
 *
 * 注入分发契约（§3.1）：composer 正文唯一写入 = composerTextInsertRequest 通道；
 * requestComposerTextInsert 返回 requestId（单向递增），无回执——注入后乐观
 * finishInjection()，final 已暂存 lastDictation（§5.4 两条失败路径同覆盖）。
 * 打断词命中的 final 经 voiceCommandBus 送达播报规划器（§4.3 层①/层③接线）。
 * mic 跨窗口互斥不在此实现：spec §3.5-5/FD-7 冻结「Phase 1 仅产品约定 + 窗口内互斥，
 * VOICE_BROADCAST_CLAIM_KEY.mic 零生产/消费方（EG-7 keptOpen）」，跨窗口仲裁 Phase 2。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDroraSessionStore } from "@/store/droraSessionStore.js";
import { useVoiceSessionStore } from "@/store/voiceSessionStore.js";
import { logger } from "@/logger.js";
import { classifyVoiceDictationFinal } from "./interruptionWords.js";
import { dispatchVoiceCommand } from "./voiceCommandBus.js";
import { createRemoteAsrAdapter } from "./remoteAsrAdapter.js";
import { resolveAsrEngineChoice } from "./resolveAsrAdapter.js";
import { createWebSpeechAsrAdapter } from "./webSpeechAsrAdapter.js";
import type { VoiceAsrPort, VoiceAsrSession } from "./voiceAsrPort.js";
import { VOICE_REQUESTING_MIC_TIMEOUT_MS } from "./voiceTuning.js";

/** hook 参数形状（V4ComposerVoiceEntry 接线用）。@lintignore */
export interface UseVoiceDictationParams {
  /** mic 入口所在会话（按下即捕获为绑定；录音期间不变，§3.4）。草稿 composer 为 null。 */
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 听写语言（已按设置/locale 解析；空串时由调用方兜底 locale）。 */
  lang: string;
  /** 请求开始听写（已过隐私确认门）；返回 false = 门拦截本次动作（FD-5 中止语义）。 */
  requestStart: () => boolean;
  /**
   * §9.6.6 引擎选型（additive，缺省 "webSpeech"：Phase 1a 行为逐字段不变）。
   * engine="remote" 且厂商档完整时以 remoteAsrAdapter 起录；档不完整回退 webSpeech +
   * info，remote start 失败本次以 webSpeech 起录 + warn（回退发生在用户手势同一动作内）。
   */
  asrEngine?: "webSpeech" | "remote";
  /** 厂商档非秘密配置（§9.6.2）；engine=remote 时与 getVendorApiKey 一起参与完整判定。 */
  vendor?: { baseUrl: string; model: string };
  /** 厂商档 apiKey 读取（经凭据服务 VOICE_VENDOR_CREDENTIAL_KEY；null/空 = 档不完整）。 */
  getVendorApiKey?: () => Promise<string | null>;
}

let voiceEntrySequence = 0;

/** hook 返回控制器形状（V4ComposerVoiceEntry 消费）。@lintignore */
export interface VoiceDictationController {
  /** 点按 mic：idle→RequestingMic（经隐私门）/ 录音中→手动停止。 */
  toggleMic: () => void;
}

export function useVoiceDictation({
  sessionId,
  workspacePath,
  workspaceIdentity,
  lang,
  requestStart,
  asrEngine = "webSpeech",
  vendor,
  getVendorApiKey,
}: UseVoiceDictationParams): VoiceDictationController {
  const webSpeechAdapter = useMemo(() => createWebSpeechAsrAdapter(), []);
  const vendorRef = useRef(vendor);
  vendorRef.current = vendor;
  const getVendorApiKeyRef = useRef(getVendorApiKey);
  getVendorApiKeyRef.current = getVendorApiKey;
  const asrEngineRef = useRef(asrEngine);
  asrEngineRef.current = asrEngine;
  // §9.6.6：remote 适配器惰性创建（settings 关闭/缺省场景零构造开销；单实例保会话语义）。
  const remoteAdapterRef = useRef<ReturnType<typeof createRemoteAsrAdapter> | null>(null);
  const pickAsrAdapter = useCallback(async (): Promise<VoiceAsrPort> => {
    const engine = asrEngineRef.current;
    if (engine !== "remote") {
      return webSpeechAdapter;
    }
    if (!remoteAdapterRef.current) {
      remoteAdapterRef.current = createRemoteAsrAdapter({
        getVendorConfig: () => {
          const vendorConfig = vendorRef.current;
          if (!vendorConfig) {
            return null;
          }
          // 厂商档三元组的 apiKey 分量在 runAsrSelection 内读取后暂存本轮闭包；
          // 录音期间设置热更由 §9.6.4 的「档不完整 → network」出边兜底。
          return { ...vendorConfig, apiKey: pendingApiKeyRef.current ?? "" };
        },
      });
    }
    const vendorConfig = vendorRef.current;
    const apiKey = (await getVendorApiKeyRef.current?.().catch(() => null)) ?? null;
    pendingApiKeyRef.current = apiKey;
    const choice = resolveAsrEngineChoice({
      engine: "remote",
      vendorConfigComplete:
        Boolean(vendorConfig?.baseUrl.trim()) &&
        Boolean(vendorConfig?.model.trim()) &&
        Boolean(apiKey?.trim()),
      remoteSupported: remoteAdapterRef.current.isSupported(),
      webSpeechSupported: webSpeechAdapter.isSupported(),
    });
    if (choice === "webSpeech") {
      // §7.1 voice.asr info：适配器选择结果（§9.6.6 档不完整分支）。
      logger.info("voice.asr", "asr selection resolved: webSpeech (remote vendor incomplete)");
      return webSpeechAdapter;
    }
    return remoteAdapterRef.current;
  }, [webSpeechAdapter]);
  // FD-6 入口实例标识：同会话主/辅 pane 双入口以实例区分「持有者点按=停止」与
  // 「第二入口点按=no-op+脉冲」，仅靠 sessionId 无法区分（spec §3.3 原场景）。
  const entryIdRef = useRef(`voice-entry-${(voiceEntrySequence += 1)}`);
  const entryId = entryIdRef.current;
  // 会话代际：RequestingMic 超时/绑定会话关闭后，迟到的 start() 结果必须丢弃。
  const generationRef = useRef(0);
  const sessionRef = useRef<VoiceAsrSession | null>(null);
  const unsubscribeFinalRef = useRef<(() => void) | null>(null);
  const unsubscribePartialRef = useRef<(() => void) | null>(null);
  const unsubscribeErrorRef = useRef<(() => void) | null>(null);
  // §5.3：权限对话框被忽略/折叠 → 10s 超时自动回 Idle + 轻提示。
  const requestingMicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestStartRef = useRef(requestStart);
  const langRef = useRef(lang);
  const pendingApiKeyRef = useRef<string | null>(null);
  requestStartRef.current = requestStart;
  langRef.current = lang;

  const cleanupSession = useCallback(() => {
    if (requestingMicTimerRef.current != null) {
      clearTimeout(requestingMicTimerRef.current);
      requestingMicTimerRef.current = null;
    }
    unsubscribeFinalRef.current?.();
    unsubscribeFinalRef.current = null;
    unsubscribePartialRef.current?.();
    unsubscribePartialRef.current = null;
    unsubscribeErrorRef.current?.();
    unsubscribeErrorRef.current = null;
    sessionRef.current = null;
  }, []);
  useEffect(() => {
    return useVoiceSessionStore.subscribe((state) => {
      const timer = requestingMicTimerRef.current;
      if (state.inputLeg === "requestingMic" && timer == null) {
        requestingMicTimerRef.current = setTimeout(() => {
          requestingMicTimerRef.current = null;
          const current = useVoiceSessionStore.getState();
          if (current.inputLeg !== "requestingMic") {
            return;
          }
          generationRef.current += 1;
          current.failMicRequest("requestingMicTimeout");
          logger.info("voice.entry", "requesting mic timed out; back to idle");
        }, VOICE_REQUESTING_MIC_TIMEOUT_MS);
        return;
      }
      if (state.inputLeg !== "requestingMic" && timer != null) {
        clearTimeout(timer);
        requestingMicTimerRef.current = null;
      }
    });
  }, []);

  // 绑定会话生命周期（§3.3）：composer 卸载 = 绑定会话关闭/删除/归档 → 强制停录音、
  // partial 丢弃、轻提示；final 未注入的已由乐观 finishInjection 进 lastDictation。
  // 卸载边界只看挂载时的绑定目标（录音期间绑定不变 §3.4），经 ref 读取避免闭包过期，
  // 也让清理 effect 保持空依赖。
  const mountedSessionIdRef = useRef(sessionId);
  mountedSessionIdRef.current = sessionId;
  useEffect(() => {
    return () => {
      generationRef.current += 1;
      sessionRef.current?.abort();
      cleanupSession();
      const state = useVoiceSessionStore.getState();
      const mountedSessionId = mountedSessionIdRef.current;
      if (state.boundSessionId !== null && state.boundSessionId === mountedSessionId) {
        state.notifyBoundSessionClosed();
      }
    };
  }, [cleanupSession]);

  // 逐句 final：打断词命中 → 消费为命令不注入（§5.1 打断词命中优先）；否则乐观注入。
  // resumeRecording：句间乐观微态回 Recording（episode 继续）；手动停止的 flush 段传
  // false——该句注入后 episode 结束回 Idle。
  const handleSentenceFinal = useCallback(
    (text: string, options?: { resumeRecording?: boolean }) => {
      const store = useVoiceSessionStore.getState();
      if (store.inputLeg !== "recording") {
        return;
      }
      const decision = classifyVoiceDictationFinal(text, langRef.current);
      if (decision.action !== "inject") {
        // §7.1 voice.asr debug：只记命中与否，不记转写原文。
        logger.debug("voice.asr", `interrupt word hit: ${decision.action}`);
        // §4.3 三层打断接线（§9.3 验收）：命中的 final 不注入 composer，经命令总线送达
        // 播报规划器——层① stopAnnouncement（uninterruptible 段外生效）/ 层③ cancelTask
        // （发既有 v4 stop，带 expectedForegroundExecutionId，由 SessionPane 命令面执行）。
        // cancelTask 为无条件分发（§4.3/§9.6.8 busy 验收）：多 pane 双发由 handleStop 的
        // canStop 守卫与 guard.stopTargetChanged 防误杀兜底，不在 dispatch 侧 gate。
        if (decision.action === "interruptAnnouncement") {
          dispatchVoiceCommand("stopAnnouncement");
        } else if (decision.action === "cancelTask") {
          dispatchVoiceCommand("cancelTask");
        }
        // 命中命令的 final 也不落入正文；手动停止路径的 episode 在此结束。
        if (options?.resumeRecording === false) {
          store.stopRecording();
        }
        return;
      }
      if (!store.commitFinal(text)) {
        return;
      }
      // mode="append" + targetSessionId=绑定会话（§3.4 消费门定向）；requestId 单向
      // 递增由 workspace slice 维护。多句连说：乐观离 injecting 后立即回归 Recording
      //（录音腿句间不回 Idle，§5.1/§5.2）。
      try {
        useDroraSessionStore
          .getState()
          .requestComposerTextInsert(
            workspacePath,
            text,
            workspaceIdentity,
            undefined,
            "append",
            sessionId,
          );
      } finally {
        useVoiceSessionStore
          .getState()
          .finishInjection({ resumeRecording: options?.resumeRecording !== false });
      }
    },
    [sessionId, workspaceIdentity, workspacePath],
  );

  const toggleMic = useCallback(() => {
    const state = useVoiceSessionStore.getState();
    if (state.inputLeg === "recording") {
      if (state.recordingOwnerEntryId !== entryId) {
        // §3.3/FD-6：录音腿由其他入口实例持有（同会话主/辅 pane 或他会话）——本入口
        // 点按是「第二点按」，走 store 拒绝 + 脉冲高亮持有者；绝不停掉别人的录音，
        // 也不进入停止分支（本实例未持有 ASR 会话，误入会只重置 store 造成引擎泄漏）。
        state.startMicRequest(sessionId, entryId);
        return;
      }
      // 本入口持有录音腿：手动停止（点按）。订阅保留至 stop() 结算之后——远程批量
      // 形态的 final 经 onFinal 交付（§9.6.8-S2），提前退订会静默丢弃已上传音频的
      // 转写文本；webSpeech 的停止 flush 段进 stop() 内部 buffer 不走 onFinal，不受影响。
      const session = sessionRef.current;
      const generation = generationRef.current;
      if (!session) {
        state.stopRecording();
        return;
      }
      void session.stop().then(({ final }: { final: string }) => {
        if (generation !== generationRef.current) {
          // 会话已被超时/卸载废弃：迟到的结算丢弃，此时统一清理。
          cleanupSession();
          return;
        }
        unsubscribeFinalRef.current?.();
        unsubscribeFinalRef.current = null;
        unsubscribePartialRef.current?.();
        unsubscribePartialRef.current = null;
        unsubscribeErrorRef.current?.();
        unsubscribeErrorRef.current = null;
        sessionRef.current = null;
        if (useVoiceSessionStore.getState().inputLeg === "recording" && final.trim().length > 0) {
          handleSentenceFinal(final, { resumeRecording: false });
          return;
        }
        if (useVoiceSessionStore.getState().inputLeg === "recording") {
          useVoiceSessionStore.getState().stopRecording();
        }
      });
      return;
    }
    if (state.inputLeg !== "idle") {
      // §3.3/FD-6 同会话双 mic 入口互斥：他人（或他 pane）已在录音/请求/注入时，第二
      // 入口点按一律 no-op——经 store 拒绝（recording 态递增 recordingPulseSeq 触发
      // 持有者指示短暂高亮），绝不进入停止分支停掉别人的录音。
      state.startMicRequest(sessionId, entryId);
      return;
    }
    // FD-5 兜底门：入口可见但 acknowledged=false → 先披露；确认后中止本次动作，
    // 再次显式点按才开始（「确认即连续开录」被 spec 明确禁止）。
    if (!requestStartRef.current()) {
      return;
    }
    if (!state.startMicRequest(sessionId, entryId)) {
      return;
    }
    const generation = ++generationRef.current;
    const activeSessionId = sessionId;
    void (async () => {
      // §9.6.6 选型：engine=remote 且档完整 → remote；否则 webSpeech（Phase 1a 路径零变化）。
      let runAdapter: VoiceAsrPort = await pickAsrAdapter();
      const startOn = async (target: VoiceAsrPort): Promise<VoiceAsrSession | null> =>
        target.start({ lang: langRef.current }).catch((error: unknown) => {
          if (generation !== generationRef.current) {
            return null;
          }
          const code = (error as { code?: string }).code;
          // §9.6.6 W3：remote start 失败（预检/网络）→ 本次点按以 webSpeech 起录 + warn；
          // 回退发生在用户手势同一动作内，不构成 §5.3 自动重启。webSpeech 再失败走正常出边。
          if (target !== webSpeechAdapter) {
            logger.warn("voice.asr", "remote start failed; falling back to webSpeech for this press", {
              code: code ?? "unknown",
            });
            runAdapter = webSpeechAdapter;
            return startOn(webSpeechAdapter);
          }
          useVoiceSessionStore
            .getState()
            .failMicRequest(
              code === "not-allowed" || code === "service-not-allowed"
                ? "permission"
                : code === "network"
                  ? "network"
                  : code === "aborted"
                    ? "aborted"
                    : "device",
            );
          logger.warn("voice.entry", `asr start failed: ${code ?? "unknown"}`);
          cleanupSession();
          return null;
        });
      const session = await startOn(runAdapter);
      if (!session) {
        return;
      }
      if (generation !== generationRef.current) {
        // 超时/卸载后授权迟到：立即丢弃式停止，绝不进入录音态。
        session.abort();
        return;
      }
      const current = useVoiceSessionStore.getState();
      if (current.inputLeg !== "requestingMic") {
        session.abort();
        return;
      }
      sessionRef.current = session;
      unsubscribeFinalRef.current = session.onFinal(handleSentenceFinal);
      // §9.2：partial 只进听写预览条（store.partialText），不写 composer 正文、不进协议。
      // 端口级订阅：webSpeech 逐字发射；remote 批量形态永不发射（§9.6.4，预览条空转）。
      unsubscribePartialRef.current = runAdapter.onPartial((text) => {
        const partialState = useVoiceSessionStore.getState();
        if (partialState.inputLeg === "recording") {
          partialState.setPartial(text);
        }
      });
      unsubscribeErrorRef.current = session.onError((error) => {
        const errorState = useVoiceSessionStore.getState();
        if (errorState.boundSessionId !== activeSessionId) {
          return;
        }
        // §5.3：not-allowed/service-not-allowed → 权限提示；network → 保留已注入文本；
        // audio-capture → 设备提示；aborted/no-speech → 同静音超时。一律不自动重启。
        errorState.abortRecording(
          error.code === "not-allowed" || error.code === "service-not-allowed"
            ? "permission"
            : error.code === "network"
              ? "network"
              : error.code === "audio-capture"
                ? "device"
                : "aborted",
        );
        logger.warn("voice.entry", `asr error: ${error.code}`);
      });
      current.beginRecording();
    })();
  }, [cleanupSession, handleSentenceFinal, pickAsrAdapter, sessionId, webSpeechAdapter]);

  return { toggleMic };
}
