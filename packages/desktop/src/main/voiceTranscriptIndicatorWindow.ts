/**
 * 流式听写悬浮指示窗（specs/voice-agent-integration.md §5.5 二次增补，2026-11-07
 * 用户裁定「2」=Proma 同款独立窗口）。
 *
 * 职责：透明置顶小窗的**纯生命周期管理**（create/show/hide/destroy 幂等）+ 转写/
 * 状态下行转发 + 音量上行中继（本仓 v1：仅 Transcript/State 下行与 Audio 上行中继；
 * 音量波形由 renderer 自己的 PCM 链驱动，不进 main）。窗口参数照 Proma
 * voice-dictation-window.ts + 本仓 CUA 拖拽浮窗实证（focusable:false 防抢焦点、
 * alwaysOnTop screen-saver 压系统设置、setVisibleOnAllWorkspaces 全工作区）。
 *
 * BrowserWindow/createWindow 注入（测试脱离 Electron）；销毁幂等；showInactive
 * 不激活（不抢主窗焦点）。渲染入口 = voice-transcript.html（rollup 多入口），
 * dev 经 rendererDevUrl、打包 loadFile（照 CUA 面板先例）。
 */

import { join } from "node:path";
import type { BrowserWindow } from "electron";

/**
 * 指示窗尺寸与底边距（宽度照 Proma INDICATOR_WIDTH）。高度 2026-11-07 修正：recording
 * 态内容实测 84px（真字体克隆实测）+2px 容差——原 120 在面板下留 36px 透明死区，叠加
 * 原生 hasShadow 阴影按整窗口矩形（非圆角内容）涂抹，真机截图呈「面板下方暗色空区」
 * 假象（用户圈问的黄色区域）。内容单行截断（nowrap）保证高度恒定。
 */
export const INDICATOR_WIDTH = 480;
export const INDICATOR_HEIGHT = 86;
export const INDICATOR_BOTTOM_MARGIN = 28;

/** 最小窗口能力面（测试替身实现用）。 */
export interface VoiceTranscriptIndicatorWindow {
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
  showInactive(): void;
  hide(): void;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

/** 光标所在 display 工作区底部居中 bounds。 */
export function indicatorBounds(workArea: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } {
  return {
    x: workArea.x + Math.round((workArea.width - INDICATOR_WIDTH) / 2),
    y: workArea.y + workArea.height - INDICATOR_HEIGHT - INDICATOR_BOTTOM_MARGIN,
    width: INDICATOR_WIDTH,
    height: INDICATOR_HEIGHT,
  };
}

export interface VoiceTranscriptIndicatorDeps {
  createWindow(options: {
    width: number;
    height: number;
    x: number;
    y: number;
    transparent: boolean;
    backgroundColor: string;
    frame: boolean;
    alwaysOnTop: boolean;
    skipTaskbar: boolean;
    focusable: boolean;
    resizable: boolean;
    movable: boolean;
    minimizable: boolean;
    maximizable: boolean;
    fullscreenable: boolean;
    show: boolean;
    webPreferences: { preload?: string; additionalArguments?: string[] };
  }): BrowserWindow;
  getCursorDisplayWorkArea(): { x: number; y: number; width: number; height: number };
  /** 渲染入口地址：dev=rendererDevUrl + query；打包=loadFile。 */
  resolveEntryUrl(
    isDev: boolean,
    devUrl: string | undefined,
    dir: string,
  ): { url?: string; file?: string };
  rendererDevUrl?: string;
  rendererDir: string;
  /** 指示窗 preload（桥：ipcRenderer 直订通道 + requestStop invoke）。 */
  preloadPath: string;
  /** 下行转发目标 = 指示窗 webContents（内部接线，调用方不感知）。 */
  logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
}

export interface VoiceTranscriptIndicator {
  /** 启动期预建：App 非激活上下文创建窗口+预载（不显示）；按键时刻只余 showInactive。 */
  preload(): void;
  /** 起录显示（幂等：已建窗 setBounds + 就绪即 showInactive；首建加载中由 ready-to-show 门接管）。 */
  show(): void;
  /** 结束/错误隐藏（不销毁——复用避免每句闪烁，Proma hide/show 先例）。 */
  hide(): void;
  destroy(): void;
  /** 转写帧转发（main doubaoAsrService 的 sendTranscript/sendState 挂到这）。 */
  send(channel: string, frame: unknown): void;
  isAlive(): boolean;
}

export function createVoiceTranscriptIndicator(
  deps: VoiceTranscriptIndicatorDeps,
): VoiceTranscriptIndicator {
  let win: BrowserWindow | null = null;
  let wantVisible = false;

  const ensure = (): BrowserWindow => {
    if (win && !win.isDestroyed()) {
      return win;
    }
    const bounds = indicatorBounds(deps.getCursorDisplayWorkArea());
    const created = deps.createWindow({
      width: INDICATOR_WIDTH,
      height: INDICATOR_HEIGHT,
      x: bounds.x,
      y: bounds.y,
      transparent: true,
      backgroundColor: "#00000000",
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      // 2026-11-07 首按消失修复（对齐 Proma voice-dictation-window.ts 旗标组合）：
      // 悬浮条是 aux overlay——不可缩放/移动/最小化/最大化/全屏。fullscreenable:false
      // 与 setVisibleOnAllWorkspaces 的 CanJoinAllSpaces+FullScreenAuxiliary 组合才
      // 是 macOS 认可的 overlay 形态；默认 FullScreenPrimary 参与全屏 Space 仲裁，
      // 首次 showInactive 时触发 Space 切换/整 App 窗口退场（真机：仅首按——首按
      // 是唯一跑完整创建序列的路径）。backgroundColor 显式透明防白闪。
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      // 2026-11-07 真机终因修复：此前此处传空 webPreferences——deps.preloadPath 声明了
      // 却从未消费，BrowserWindow 无 preload → voiceTranscriptBridge 永不注入 → App
      // 恒 idle display:none（CDP 实证 bridge undefined、root 空文本）→ 透明窗零渲染
      // =「悬浮条看不见/疑似没置顶」。装配点的展开顺序修复保住的是这里的 preload，
      // 两处缺一即桥断。
      webPreferences: { preload: deps.preloadPath },
    });
    // skipTransformProcessType（2026-11-07）：Electron 文档明示 setVisibleOnAllWorkspaces
    // 在 macOS 默认「transform the process type」(UIElement ↔ Foreground App)——真机
    // 「Dock 图标消失 + 主窗沉底」正是进程被转 UIElement(accessory) 的机制；此选项
    // 专治，必须带上。
    created.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    // 2026-11-07 弃运行时改级：构造器 alwaysOnTop:true（floating 级）已够压普通窗；
    // 运行时 setAlwaysOnTop(true,"screen-saver") 是 NSWindow level 变更——独立复现器
    // 实证其触发主窗延迟隐藏（T4 +5s mainVis=hidden），永久弃用。
    created.once("closed", () => {
      win = null;
    });
    created.once("ready-to-show", () => {
      // 首次显示门（Proma 同款）：页面未就绪前不 showInactive——透明空窗在部分
      // macOS 版本上首次 orderFront 是 Space 异常的高危面。
      if (wantVisible && !created.isDestroyed()) {
        created.showInactive();
      }
    });
    const entry = deps.resolveEntryUrl(
      deps.rendererDevUrl != null,
      deps.rendererDevUrl,
      deps.rendererDir,
    );
    // 加载失败退避重试：启动期预建时 dev Vite 可能未就绪（0.5s/1.5s/4s 三退避）。
    void (async () => {
      for (const delayMs of [0, 500, 1500, 4000]) {
        if (created.isDestroyed()) return;
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        try {
          if (entry.url) {
            await created.loadURL(entry.url);
          } else if (entry.file) {
            await created.loadFile(entry.file);
          }
          return;
        } catch (error) {
          deps.logger.warn("voice transcript indicator load failed, retrying", {
            attemptDelayMs: delayMs,
            message: error instanceof Error ? error.message.slice(0, 120) : String(error),
          });
        }
      }
    })();
    win = created;
    return created;
  };

  return {
    /**
     * 启动期预建（2026-11-07 恒外置定案的关键）：在 App 非激活/无用户交互的上下文
     * 创建窗口并预载页面（不显示）——真机三轮实证「按键时刻的创建序列」是 macOS
     * Space/进程类型异常的触发面，而「对已存在窗口 showInactive」从未翻车；预建后
     * 首按只剩 showInactive。
     */
    preload() {
      ensure();
    },
    show() {
      const w = ensure();
      if (w.isDestroyed()) return;
      wantVisible = true;
      w.setBounds(indicatorBounds(deps.getCursorDisplayWorkArea()));
      if (!w.webContents.isLoading()) {
        w.showInactive();
      }
      // 仍在加载：ready-to-show 门接管显示（bounds 已就位，零等待反馈语义不变）。
    },
    hide() {
      wantVisible = false;
      if (win && !win.isDestroyed()) {
        win.hide();
      }
    },
    destroy() {
      if (win && !win.isDestroyed()) {
        win.destroy();
      }
      win = null;
    },
    send(channel, frame) {
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, frame);
      }
    },
    isAlive() {
      return win != null && !win.isDestroyed();
    },
  };
}
