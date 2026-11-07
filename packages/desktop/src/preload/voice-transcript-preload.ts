// 流式听写悬浮指示窗 preload（specs/voice-agent-integration.md §5.5 二次增补）：
// 最小桥——ipcRenderer 直订 Transcript/State 推送 + requestStop invoke 回 main。
// 通道名与主 preload 同源（PlatformChannels）；独立窗口无 Drora preload，此文件单独存在。
import { contextBridge, ipcRenderer } from "electron";

// 通道字面量单一出处原则的例外记档（§5.5 指示窗）：preload 是独立 CJS bundle，
// 不能 import @drora/shared（会拖进整个 shared 运行时）——通道名与主 preload 的
// PlatformChannels 平行维护，由 contract 测试钉住一致性（见 contract.test.ts 补丁）。
const CH = {
  Transcript: "drora:voice-asr-stream-transcript",
  State: "drora:voice-asr-stream-state",
};

contextBridge.exposeInMainWorld("voiceTranscriptBridge", {
  onTranscript: (handler: (frame: unknown) => void) => {
    const fn = (_e: unknown, frame: unknown) => handler(frame);
    ipcRenderer.on(CH.Transcript, fn);
    return () => {
      ipcRenderer.removeListener(CH.Transcript, fn);
    };
  },
  onState: (handler: (frame: unknown) => void) => {
    const fn = (_e: unknown, frame: unknown) => handler(frame);
    ipcRenderer.on(CH.State, fn);
    return () => {
      ipcRenderer.removeListener(CH.State, fn);
    };
  },
  requestStop: () => {
    // v1：指示窗不持 streamId（主窗 renderer 持）——停止经 main 广播回主窗 renderer。
    ipcRenderer.send("drora:voice-transcript-stop-request");
  },
  onShow: (handler: (payload: unknown) => void) => {
    const fn = (_e: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on("drora:voice-transcript-show", fn);
    return () => {
      ipcRenderer.removeListener("drora:voice-transcript-show", fn);
    };
  },
  onHide: (handler: (payload: unknown) => void) => {
    const fn = (_e: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on("drora:voice-transcript-hide", fn);
    return () => {
      ipcRenderer.removeListener("drora:voice-transcript-hide", fn);
    };
  },
});
