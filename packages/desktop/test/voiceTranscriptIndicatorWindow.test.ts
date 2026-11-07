import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import {
  createVoiceTranscriptIndicator,
  indicatorBounds,
  type VoiceTranscriptIndicatorDeps,
} from "../src/main/voiceTranscriptIndicatorWindow.js";

/**
 * §5.5 二次增补 悬浮指示窗契约（specs/voice-agent-integration.md）：生命周期幂等
 * （show 复用/hide 不销毁/destroy 幂等）+ 置顶参数（screen-saver 级/全工作区/不抢焦点）。
 * 2026-11-07 真机终因回归钉：webPreferences 从未携带 preload（deps.preloadPath 声明未
 * 消费）→ bridge 永不注入 → App 恒 idle 空渲染 =「悬浮条看不见」——preload 接线必须钉死。
 */

interface FakeWindow {
  options: Record<string, unknown>;
  destroyed: boolean;
  hidden: boolean;
  showInactiveCalls: number;
  setBoundsCalls: Array<{ x: number; y: number; width: number; height: number }>;
  sent: Array<{ channel: string; payload: unknown }>;
  alwaysOnTop: Array<[boolean, string]>;
  allWorkspaces: Array<[boolean, { visibleOnFullScreen?: boolean }]>;
  loadedUrls: string[];
  loadedFiles: string[];
  win: BrowserWindow;
}

function makeFakeWindow(options: Record<string, unknown>): FakeWindow {
  const fake: FakeWindow = {
    options,
    destroyed: false,
    hidden: false,
    showInactiveCalls: 0,
    setBoundsCalls: [],
    sent: [],
    alwaysOnTop: [],
    allWorkspaces: [],
    loadedUrls: [],
    loadedFiles: [],
    win: null as unknown as BrowserWindow,
  };
  fake.win = {
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => {
      fake.setBoundsCalls.push(bounds);
    },
    showInactive: () => {
      fake.showInactiveCalls += 1;
    },
    hide: () => {
      fake.hidden = true;
    },
    destroy: () => {
      fake.destroyed = true;
    },
    isDestroyed: () => fake.destroyed,
    send: (channel: string, payload: unknown) => {
      fake.sent.push({ channel, payload });
    },
    setVisibleOnAllWorkspaces: (visible: boolean, opts: { visibleOnFullScreen?: boolean }) => {
      fake.allWorkspaces.push([visible, opts]);
    },
    setAlwaysOnTop: (top: boolean, level: string) => {
      fake.alwaysOnTop.push([top, level]);
    },
    once: () => fake.win,
    loadURL: (url: string) => {
      fake.loadedUrls.push(url);
      return Promise.resolve();
    },
    loadFile: (file: string) => {
      fake.loadedFiles.push(file);
      return Promise.resolve();
    },
    webContents: {
      once: () => undefined,
      send: (channel: string, payload: unknown) => fake.sent.push({ channel, payload }),
    },
  } as unknown as BrowserWindow;
  return fake;
}

function makeDeps(overrides: Partial<VoiceTranscriptIndicatorDeps> = {}) {
  const created: FakeWindow[] = [];
  const deps: VoiceTranscriptIndicatorDeps = {
    createWindow: (options) => {
      const fake = makeFakeWindow(options as Record<string, unknown>);
      created.push(fake);
      return fake.win;
    },
    getCursorDisplayWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    resolveEntryUrl: () => ({ url: "http://localhost:5174/voice-transcript.html" }),
    rendererDevUrl: "http://localhost:5174",
    rendererDir: "/out/renderer",
    preloadPath: "/out/preload/voice-transcript-preload.cjs",
    logger: { info: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
  return { deps, created };
}

describe("悬浮指示窗生命周期（§5.5 二次增补）", () => {
  it("真机终因回归钉：webPreferences 必须携带 preload（桥注入唯一通道）", () => {
    const { deps, created } = makeDeps();
    createVoiceTranscriptIndicator(deps).show();
    expect(created).toHaveLength(1);
    expect(created[0]!.options["webPreferences"]).toEqual({
      preload: "/out/preload/voice-transcript-preload.cjs",
    });
  });

  it("置顶参数：screen-saver 级 alwaysOnTop + 全工作区 + 不抢焦点 + 透明无框", () => {
    const { deps, created } = makeDeps();
    createVoiceTranscriptIndicator(deps).show();
    const options = created[0]!.options;
    expect(options["transparent"]).toBe(true);
    expect(options["frame"]).toBe(false);
    expect(options["alwaysOnTop"]).toBe(true);
    expect(options["skipTaskbar"]).toBe(true);
    expect(options["focusable"]).toBe(false);
    expect(created[0]!.alwaysOnTop).toEqual([[true, "screen-saver"]]);
    expect(created[0]!.allWorkspaces).toEqual([[true, { visibleOnFullScreen: true }]]);
  });

  it("show 幂等复用：重复 show 不重建窗口；bounds 随光标工作区刷新", () => {
    const { deps, created } = makeDeps();
    const indicator = createVoiceTranscriptIndicator(deps);
    indicator.show();
    indicator.show();
    expect(created).toHaveLength(1);
    expect(created[0]!.showInactiveCalls).toBe(2);
    expect(created[0]!.setBoundsCalls).toHaveLength(2);
    expect(indicatorBounds({ x: 0, y: 0, width: 1920, height: 1080 })).toEqual({
      x: 720,
      // 高度贴内容（86=84 实测+2 容差，真机「面板下暗色死区」修复回归钉）。
      y: 966,
      width: 480,
      height: 86,
    });
  });

  it("hide 复用不销毁：send 继续可达；destroy 后 isAlive=false 且 send 静默", () => {
    const { deps, created } = makeDeps();
    const indicator = createVoiceTranscriptIndicator(deps);
    indicator.show();
    indicator.hide();
    expect(created[0]!.hidden).toBe(true);
    expect(indicator.isAlive()).toBe(true);
    indicator.send("drora:voice-asr-stream-transcript", { streamId: "s1", text: "你好" });
    expect(created[0]!.sent.at(-1)).toEqual({
      channel: "drora:voice-asr-stream-transcript",
      payload: { streamId: "s1", text: "你好" },
    });
    indicator.destroy();
    indicator.destroy(); // 幂等
    expect(indicator.isAlive()).toBe(false);
    indicator.send("drora:voice-asr-stream-transcript", { streamId: "s1" }); // 不抛
    expect(created[0]!.sent).toHaveLength(1);
  });

  it("渲染入口：dev 走 loadURL、打包走 loadFile", () => {
    const dev = makeDeps();
    createVoiceTranscriptIndicator(dev.deps).show();
    expect(dev.created[0]!.loadedUrls).toEqual(["http://localhost:5174/voice-transcript.html"]);

    const packaged = makeDeps({
      resolveEntryUrl: () => ({ file: "/out/renderer/voice-transcript.html" }),
    });
    createVoiceTranscriptIndicator(packaged.deps).show();
    expect(packaged.created[0]!.loadedFiles).toEqual(["/out/renderer/voice-transcript.html"]);
  });
});
