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
}
export interface VoiceDictationController {
  toggleMic: () => void;
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

  const handleFinal = useCallback(
    (text: string, resumeRecording = true) => {
      const state = useVoiceSessionStore.getState();
      const target = targetRef.current;
      if (!target || state.inputLeg !== "recording" || state.recordingOwnerEntryId !== entryId)
        return;
      const decision = classifyVoiceDictationFinal(text, target.lang);
      if (decision.action !== "inject") {
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
        logger.warn("voice.entry", `asr start failed: ${code ?? "unknown"}`);
      }
    })();
  }, [abortEpisode, cleanupSession, entryId, handleFinal, webSpeechAdapter]);
  return { toggleMic };
}
