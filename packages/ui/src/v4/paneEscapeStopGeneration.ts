/**
 * SessionPane 窗口级 Esc 停止生成监听（specs/voice-agent-integration.md §4.4 / §9.9.4-L3）。
 *
 * 从 SessionPane.tsx 提取（可测性：注册条件与 handler 守卫的覆盖缺口需要组件外断言）。
 * §9.9.4-L3：注册条件收窄为 focused && !readOnly && sessionId（去 canStop 前置）——
 * 旧前置使无任务态（canStop=false）整个窗口监听不注册，录音中但无任务运行 + 焦点在
 * 对话区（composer 外）时 Esc 死键，§4.4 优先级 3 的语音优先消费随之失效。
 * 停生成分支的 canStop 改为 handler 内现值守卫（经 canStopRef 读，注册不随快照抖动
 * 重挂）：canStop=false 时原样 return（不 preventDefault、不 handleStop），保持
 * §4.4 优先级 4「无任务态无消费者 → Esc 无动作」的现状语义。
 */
import { useEffect } from "react";
import { shouldIgnoreEscapeForStopGeneration } from "@/v4/composer/escapeStop.js";
import { consumeVoiceRecordingEscape } from "@/store/voiceSessionStore.js";

export interface PaneEscapeStopGenerationParams {
  focused: boolean;
  readOnly: boolean;
  sessionId: string | null;
  /** §9.9.4-L3：canStop 现值读取（经 ref；undefined 视为 false——快照未就绪）。 */
  canStopRef: () => boolean | undefined;
  /** 本 pane DOM 归属（面板打开时按 DOM 隔离窗口 Esc）。 */
  paneRef: React.RefObject<HTMLElement | null>;
  /** Shell 授权主区接收对话外 Esc 时为 true。 */
  allowEscapeStopOutsidePane: boolean;
  handleStop: (source: "escape") => void;
}

export function usePaneEscapeStopGeneration({
  focused,
  readOnly,
  sessionId,
  canStopRef,
  paneRef,
  allowEscapeStopOutsidePane,
  handleStop,
}: PaneEscapeStopGenerationParams): void {
  useEffect(() => {
    // §9.9.4-L3：注册条件去 canStop 前置（无任务态也注册——录音 Esc 优先消费可达）。
    if (!focused || readOnly) return;
    if (!sessionId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!paneRef.current) return;
      if (!allowEscapeStopOutsidePane && !event.composedPath().includes(paneRef.current)) return;
      if (shouldIgnoreEscapeForStopGeneration(event)) return;
      // 语音录音态优先（§4.4 优先级 3）：录音中/请求麦克风中 Esc 停录音/取消请求且
      // 任务不中断（零 v4 stop）；焦点在对话区（composer 外）时由本监听消费。
      // mention/dialog 优先消费者已由上方 defaultPrevented 检查排除。
      if (consumeVoiceRecordingEscape()) {
        event.preventDefault();
        return;
      }
      // §9.9.4-L3：停生成分支 canStop 现值守卫（后置）——无任务态原样 return
      //（不 preventDefault、不 handleStop，§4.4 优先级 4 语义不变）。
      if (!canStopRef()) {
        return;
      }
      event.preventDefault();
      handleStop("escape");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // canStop 经 ref 读：注册不随快照抖动重挂（旧 deps 含 snapshot?.control.canStop）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowEscapeStopOutsidePane, focused, readOnly, sessionId, canStopRef, paneRef]);
}
