// 流式听写悬浮指示窗 preload（specs/voice-agent-integration.md §5.5 二次增补）：
// 最小桥——ipcRenderer 直订 Transcript/State 推送 + requestStop invoke 回 main。
// 通道名与主 preload 同源（PlatformChannels）；独立窗口无 Drora preload，此文件单独存在。
const { contextBridge, ipcRenderer } = require("electron");

const CH = {
  Transcript: "drora:voice-asr-stream-transcript",
  State: "drora:voice-asr-stream-state",
  Start: "drora:voice-asr-stream-start",
  Audio: "drora:voice-asr-stream-audio",
  Abort: "drora:voice-asr-stream-abort",
};

contextBridge.exposeInMainWorld("voiceTranscriptBridge", {
  onTranscript: (handler) => {
    const fn = (_e, frame) => handler(frame);
    ipcRenderer.on(CH.Transcript, fn);
    return () => ipcRenderer.removeListener(CH.Transcript, fn);
  },
  onState: (handler) => {
    const fn = (_e, frame) => handler(frame);
    ipcRenderer.on(CH.State, fn);
    return () => ipcRenderer.removeListener(CH.State, fn);
  },
  requestStop: () => {
    // v1：指示窗不持 streamId（renderer 持），停止 = 通知主窗 renderer 的停止按钮逻辑。
    // 主窗经 BroadcastChannel 监听（voice-transcript-stop）。
    ipcRenderer.send("drora:voice-transcript-stop-request");
  },
  onShow: (handler) => {
    const fn = (_e, payload) => handler(payload);
    ipcRenderer.on("drora:voice-transcript-show", fn);
    return () => ipcRenderer.removeListener("drora:voice-transcript-show", fn);
  },
  onHide: (handler) => {
    const fn = (_e, payload) => handler(payload);
    ipcRenderer.on("drora:voice-transcript-hide", fn);
    return () => ipcRenderer.removeListener("drora:voice-transcript-hide", fn);
  },
});
