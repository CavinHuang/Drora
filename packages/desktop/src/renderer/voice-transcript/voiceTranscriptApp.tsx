/**
 * 流式听写悬浮指示窗渲染入口（specs/voice-agent-integration.md §5.5 二次增补）：
 * 独立透明 BrowserWindow（focusable:false/showInactive，不抢焦点）；数据面 =
 * main 直接转发 Transcript/State 帧（window.voiceTranscriptBridge）。
 *
 * 布局复刻窗口内浮层（VoiceTranscriptOverlay v2 视觉）：声波/等待指示 + partial
 * 大字 + 光标 + 元信息行；主题（暗/亮）由主窗经 bridge 通知（v1 跟随系统 prefers）。
 */
import * as React from "react";
import { createRoot } from "react-dom/client";

interface TranscriptFrame {
  streamId: string;
  text: string;
  isFinal: boolean;
}
interface StateFrame {
  streamId: string;
  status: "ended" | "error";
  errorMessage?: string;
}

/** 桥形状（preload 注入到 window；缺省会话=空态）。 */
interface Bridge {
  onTranscript(handler: (frame: TranscriptFrame) => void): () => void;
  onState(handler: (frame: StateFrame) => void): () => void;
  /** 停止请求中继回主窗 renderer（经 main 路由到听写 owner）。 */
  requestStop(): void;
  onShow(handler: () => void): () => void;
  onHide(handler: () => void): () => void;
}
const bridge =
  (window as unknown as { voiceTranscriptBridge?: Bridge }).voiceTranscriptBridge ?? null;

function WaveBars() {
  return (
    <span aria-hidden className="flex h-4 items-end gap-[3px]">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full animate-[voice-wave_1.2s_ease-in-out_infinite]"
          style={{
            animationDelay: `${i * 0.15}s`,
            height: "5px",
            background: "rgba(120,140,255,0.75)",
          }}
        />
      ))}
    </span>
  );
}

function VoiceTranscriptApp() {
  const [partial, setPartial] = React.useState("");
  const [phase, setPhase] = React.useState<"idle" | "recording" | "error">("idle");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!bridge) return;
    const unsubs = [
      bridge.onTranscript((frame) => {
        if (frame.text.trim().length > 0) setPartial(frame.text.trim());
      }),
      bridge.onState((frame) => {
        if (frame.status === "error") {
          setPhase("error");
          setErrorMessage(frame.errorMessage ?? "语音服务不可用");
        } else {
          setPhase("idle");
        }
      }),
      bridge.onShow(() => {
        setPartial("");
        setPhase("recording");
        setErrorMessage(null);
      }),
      bridge.onHide(() => setPhase("idle")),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);
  const visible = phase !== "idle" || errorMessage != null;
  return (
    <div style={{ display: visible ? "block" : "none" }} data-testid="voice-transcript-indicator">
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(24,26,32,0.82)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
          color: "#e8eaf0",
          animation: "voice-rise 150ms ease-out",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px 8px" }}>
          {phase === "recording" ? <WaveBars /> : null}
          <p
            style={{
              margin: 0,
              minWidth: 0,
              flex: 1,
              fontSize: 17,
              lineHeight: 1.6,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            data-testid="voice-transcript-indicator-partial"
          >
            {errorMessage != null ? (
              <span style={{ fontSize: 13, color: "#f2b8b5" }}>{errorMessage}</span>
            ) : (
              partial || <span style={{ color: "rgba(232,234,240,0.45)" }}>正在聆听，请说话…</span>
            )}
            {phase === "recording" ? (
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: 2,
                  height: "1.1em",
                  marginLeft: 4,
                  transform: "translateY(3px)",
                  background: "rgba(120,140,255,0.85)",
                  animation: "voice-caret 1s step-end infinite",
                }}
              />
            ) : null}
          </p>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 20px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <span style={{ fontSize: 11, color: "rgba(232,234,240,0.45)" }}>
            {/* §5.5.1 auto 模式：短按免提继续（再按一下结束）、长按松开结束——两种肌肉记忆并存。 */}
            {errorMessage != null
              ? "流式语音识别"
              : "正在聆听 · 再按一下结束（按住说话则松开结束）"}
          </span>
          {phase === "recording" ? (
            <button
              type="button"
              onClick={() => bridge?.requestStop()}
              style={{
                border: "none",
                background: "transparent",
                color: "rgba(232,234,240,0.55)",
                fontSize: 11,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              ✕ 停止听写
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<VoiceTranscriptApp />);
}
