/**
 * 听写 episode 编排（spec §5 / §9.8.1）。store 是状态所有者；本 hook 只持 ASR
 * 资源与异步代际。Esc/错误/卸载统一丢弃式释放，逐句 injecting 不结束录音 episode。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDroraSessionStore } from "@/store/droraSessionStore.js";
import { useVoiceSessionStore, type VoiceDictationNoticeCode } from "@/store/voiceSessionStore.js";
import { logger } from "@/logger.js";
import { classifyVoiceDictationFinal } from "./interruptionWords.js";
import { dispatchVoiceCommand, type VoiceCommandTarget } from "./voiceCommandBus.js";
import { registerVoiceRecordingAbort } from "./voiceRecordingControl.js";
import { createRemoteAsrAdapter } from "./remoteAsrAdapter.js";
import { isVoiceVendorConfigComplete, resolveAsrEngineChoice } from "./resolveAsrAdapter.js";
import { createWebSpeechAsrAdapter } from "./webSpeechAsrAdapter.js";
import type { VoiceAsrPort, VoiceAsrSession } from "./voiceAsrPort.js";
import { VoiceAsrError } from "./voiceAsrPort.js";
import { VOICE_REQUESTING_MIC_TIMEOUT_MS } from "./voiceTuning.js";

export interface UseVoiceDictationParams {
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  lang: string;
  requestStart: () => boolean;
  asrEngine?: "webSpeech" | "remote";
  vendor?: { baseUrl: string; model: string };
  getVendorApiKey?: () => Promise<string | null>;
  /**
   * §9.9.3-M9：入口可见性（useVoiceComposerEntry 汇聚 voiceComposerEntryState 纯函数
   * 的 view.visible）。true→false 沿（录音中把入口设回隐藏）= 持有者定向停止：
   * recording 态 abort 引擎 + cleanupSession + store 出腿（partial 丢弃、无 notice
   *——隐藏入口是用户显式动作）；requestingMic 态 cancelMicRequest + generation 失效。
   * 非持有者实例零动作（不停别人的录音，FD-6 边界同源）。缺省 true（不门控）。
   * 不卸载 hooks：真实卸载语义（含迟到授权资源释放）由 §9.8.1 终止清理定义且幂等，
   * 本条接入同一清理序列（abortEpisode），不建第二条卸载路径。
   */
  entryVisible?: boolean;
}
export interface VoiceDictationController {
  /** 点按 mic：idle→RequestingMic（经隐私门）/ 录音中→手动停止 / requestingMic 中→持有者取消。 */
  toggleMic: () => void;
  /**
   * §9.9.4-L6：本入口实例标识（FD-6 owner 判定输入）——Entry 以
   * `recordingOwnerEntryId === dictation.entryId` 区分「持有者的点按=停止/取消」与
   * 「第二入口的点按=no-op+脉冲」，停止图标/预览条/脉冲/sr-only 指示同轨。
   */
  entryId: string;
}
let voiceEntrySequence = 0;

export function useVoiceDictation(params: UseVoiceDictationParams): VoiceDictationController {
  const webSpeechAdapter = useMemo(() => createWebSpeechAsrAdapter(), []);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const entryIdRef = useRef<string | null>(null);
  if (entryIdRef.current === null) entryIdRef.current = `voice-entry-${++voiceEntrySequence}`;
  const entryId = entryIdRef.current;
  const generationRef = useRef(0);
  const sessionRef = useRef<VoiceAsrSession | null>(null);
  const unsubscribersRef = useRef<(() => void)[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppingRef = useRef(false);
  const targetRef = useRef<(VoiceCommandTarget & { lang: string }) | null>(null);

  const cleanupSession = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    for (const unsubscribe of unsubscribersRef.current) unsubscribe();
    unsubscribersRef.current = [];
    sessionRef.current = null;
    stoppingRef.current = false;
  }, []);

  const abortEpisode = useCallback(
    (notice?: VoiceDictationNoticeCode) => {
      const session = sessionRef.current;
      generationRef.current += 1;
      // 先退订/失效，再停引擎：同步 error/end 回调也不能复活旧 episode 或注入 final。
      cleanupSession();
      session?.abort();
      targetRef.current = null;
      const state = useVoiceSessionStore.getState();
      if (state.recordingOwnerEntryId !== entryId) return;
      if (state.inputLeg === "requestingMic") {
        if (notice && notice !== "sessionGone") state.failMicRequest(notice);
        else state.cancelMicRequest();
      } else {
        state.abortRecording(notice);
      }
    },
    [cleanupSession, entryId],
  );

  useEffect(
    () => registerVoiceRecordingAbort(entryId, () => abortEpisode()),
    [abortEpisode, entryId],
  );
  const workspaceKey = params.workspaceIdentity?.trim() || params.workspacePath;
  useEffect(
    () => () => abortEpisode("sessionGone"),
    [abortEpisode, workspaceKey, params.sessionId],
  );

  // §9.9.3-M9：入口隐藏（true→false 沿）= 持有者定向停止——录音中把
  // voiceComposerEntryHidden 设回隐藏时，入口组件 return null 后录音腿仍在拾音、
  // 预览条/停止按钮一并消失（无入口的继续拾音）。定向停止而非卸载 hooks：
  // 可见性判定收口在 voiceComposerEntryState 纯函数（useVoiceComposerEntry 汇聚），
  // 父级条件渲染会复制门控逻辑成第二判定源。
  // 融合：清理序列复用 §9.8.1 abortEpisode（generation 失效 + abort 引擎 +
  // cleanupSession + store 出腿，幂等）；recording 态 abortRecording 无 notice
  //（隐藏入口是用户显式动作：partial 丢弃、零提示），requestingMic 态经
  // abortEpisode 落 cancelMicRequest（§9.9.4-L1 同款取消语义）。
  const entryVisibleRef = useRef(params.entryVisible ?? true);
  useEffect(() => {
    const entryVisible = paramsRef.current.entryVisible ?? true;
    const wasVisible = entryVisibleRef.current;
    entryVisibleRef.current = entryVisible;
    if (!wasVisible || entryVisible) {
      return; // 仅 true→false 沿触发；false→true（重新显示）不自动开录。
    }
    const state = useVoiceSessionStore.getState();
    if (state.recordingOwnerEntryId !== entryId) {
      return; // 非持有者零动作：他人 pane 入口隐藏不停别人的录音（FD-6 边界同源）。
    }
    abortEpisode();
    logger.info("voice.entry", "voice entry hidden; stopping recording");
  }, [params.entryVisible, entryId, abortEpisode]);

  const handleFinal = useCallback(
    (text: string, resumeRecording = true) => {
      const state = useVoiceSessionStore.getState();
      const target = targetRef.current;
      if (!target || state.inputLeg !== "recording" || state.recordingOwnerEntryId !== entryId)
        return;
      const decision = classifyVoiceDictationFinal(text, target.lang);
      if (decision.action !== "inject") {
        // §7.1 voice.asr debug：只记命中与否，不记转写原文。
        logger.debug("voice.asr", `interrupt word hit: ${decision.action}`);
        dispatchVoiceCommand(
          decision.action === "cancelTask" ? "cancelTask" : "stopAnnouncement",
          target,
        );
        if (!resumeRecording) state.stopRecording();
        return;
      }
      if (text.trim().length === 0) return;
      if (!state.commitFinal(text)) return;
      try {
        useDroraSessionStore
          .getState()
          .requestComposerTextInsert(
            target.workspacePath,
            text,
            target.workspaceIdentity,
            undefined,
            "append",
            target.sessionId,
          );
      } finally {
        useVoiceSessionStore.getState().finishInjection({ resumeRecording });
      }
    },
    [entryId],
  );

  const toggleMic = useCallback(() => {
    const state = useVoiceSessionStore.getState();
    const current = paramsRef.current;
    if (state.inputLeg !== "idle") {
      // §9.9.4-L1：RequestingMic→Idle 用户取消出边（§3.2 冻结图的零调用方边落地）——
      // 持有者再点按 = 取消本次请求（不等 10s 超时）；generation 同步失效使迟到的
      // start() 结果被既有守卫丢弃（§9.8.1 迟到授权释放同向）。非持有者点按维持
      // store 拒绝（不代取消他人的请求，FD-6 边界同源）。经 abortEpisode 统一清理
      //（含 requestingMic 超时计时器回收），不建第二条取消路径。
      if (state.inputLeg === "requestingMic" && state.recordingOwnerEntryId === entryId) {
        abortEpisode();
        logger.info("voice.entry", "mic request cancelled by holder press");
        return;
      }
      if (state.inputLeg !== "recording" || state.recordingOwnerEntryId !== entryId) {
        state.startMicRequest(current.sessionId, entryId);
        return;
      }
      if (stoppingRef.current) return;
      const session = sessionRef.current;
      if (!session) {
        abortEpisode();
        return;
      }
      stoppingRef.current = true;
      const generation = generationRef.current;
      // 点按停止保留订阅到结算：remote final 走 onFinal，Web Speech flush 走返回值。
      void session
        .stop()
        .then(({ final }) => {
          if (generation !== generationRef.current) return;
          if (final.trim()) handleFinal(final, false);
          cleanupSession();
          targetRef.current = null;
          const latest = useVoiceSessionStore.getState();
          if (latest.recordingOwnerEntryId === entryId) latest.stopRecording();
        })
        .catch(() => {
          if (generation === generationRef.current) abortEpisode("network");
        });
      return;
    }
    if (!current.requestStart() || !state.startMicRequest(current.sessionId, entryId)) return;
    const generation = ++generationRef.current;
    const target = {
      workspacePath: current.workspacePath,
      workspaceIdentity: current.workspaceIdentity,
      sessionId: current.sessionId,
      lang: current.lang,
    };
    targetRef.current = target;
    timerRef.current = setTimeout(() => {
      if (generation !== generationRef.current) return;
      abortEpisode("requestingMicTimeout");
      logger.info("voice.entry", "requesting mic timed out; back to idle");
    }, VOICE_REQUESTING_MIC_TIMEOUT_MS);

    void (async () => {
      let adapter: VoiceAsrPort = webSpeechAdapter;
      try {
        if (current.asrEngine === "remote") {
          const apiKey = (await current.getVendorApiKey?.().catch(() => null)) ?? "";
          if (generation !== generationRef.current) return;
          // 本次录音固定厂商配置，避免设置热更把已录音频发到另一处理方。
          const config = {
            baseUrl: current.vendor?.baseUrl ?? "",
            model: current.vendor?.model ?? "",
            apiKey,
          };
          const remote = createRemoteAsrAdapter({ getVendorConfig: () => config });
          const choice = resolveAsrEngineChoice({
            engine: "remote",
            vendorConfigComplete: isVoiceVendorConfigComplete(config),
            remoteSupported: remote.isSupported(),
            webSpeechSupported: webSpeechAdapter.isSupported(),
          });
          if (choice === null) {
            abortEpisode("device");
            return;
          }
          if (choice === "remote") adapter = remote;
        }
      } catch (error) {
        // §9.9.4-L10：选型/适配器创建异常（「choice=null」语义：选型链无法给出适配器，
        // 如构造 throw/凭据读取异常外溢）此前是未处理 rejection——store 悬在
        // requestingMic 至 10s 超时且零日志。现 catch：§7.1 voice.asr **error** 槽位
        //（「适配器创建失败致入口不可用」）+ VoiceAsrError code 映射 + abortEpisode
        // 即时出腿（generation 失效 + failMicRequest + cleanupSession，不悬 10s）。
        if (generation !== generationRef.current) return;
        const code =
          error instanceof VoiceAsrError
            ? error.code
            : ((error as { code?: string }).code ?? "device");
        logger.error("voice.asr", "asr adapter selection failed; mic entry unavailable", {
          code,
        });
        abortEpisode(
          code === "not-allowed" || code === "service-not-allowed"
            ? "permission"
            : code === "network"
              ? "network"
              : "device",
        );
        return;
      }
      const start = async (): Promise<VoiceAsrSession> => {
        try {
          return await adapter.start({ lang: target.lang });
        } catch (error) {
          if (generation !== generationRef.current) throw error;
          if (adapter !== webSpeechAdapter && webSpeechAdapter.isSupported()) {
            logger.warn("voice.asr", "remote start failed; falling back to webSpeech");
            adapter = webSpeechAdapter;
            return adapter.start({ lang: target.lang });
          }
          throw error;
        }
      };
      try {
        if (generation !== generationRef.current) return;
        const session = await start();
        if (generation !== generationRef.current) {
          session.abort();
          return;
        }
        sessionRef.current = session;
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = null;
        unsubscribersRef.current = [
          session.onFinal((text) => {
            if (generation === generationRef.current) handleFinal(text);
          }),
          adapter.onPartial((text) => {
            if (generation === generationRef.current)
              useVoiceSessionStore.getState().setPartial(text);
          }),
          session.onError((error) => {
            if (generation !== generationRef.current) return;
            abortEpisode(
              error.code === "not-allowed" || error.code === "service-not-allowed"
                ? "permission"
                : error.code === "network"
                  ? "network"
                  : error.code === "audio-capture"
                    ? "device"
                    : "aborted",
            );
          }),
        ];
        useVoiceSessionStore.getState().beginRecording();
      } catch (error) {
        if (generation !== generationRef.current) return;
        const code = (error as { code?: string }).code;
        abortEpisode(
          code === "not-allowed" || code === "service-not-allowed"
            ? "permission"
            : code === "network"
              ? "network"
              : code === "aborted"
                ? "aborted"
                : "device",
        );
        // §9.9.4-L10：start 失败日志槽位归 voice.asr warn——§7.1 voice.entry warn 槽位
        // 语义是「权限拒绝后的再次尝试、sendText 携带 source 被旧 CLI 拒收」，ASR
        // 起录失败属可恢复错误码且回退树已处理。
        logger.warn("voice.asr", `asr start failed: ${code ?? "unknown"}`);
      }
    })();
  }, [abortEpisode, cleanupSession, entryId, handleFinal, webSpeechAdapter]);
  return { toggleMic, entryId };
}
