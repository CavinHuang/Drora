import { decorateRequestSecurityLogArgs } from "./request-security-edition/index.js";
/* eslint-disable max-lines -- 桌面平台 IPC 集中装配，拆散会让权限边界更难审计；行数随平台能力增长。 */
import { BrowserWindow, dialog, ipcMain, nativeTheme, net, screen } from "electron";
import { join } from "node:path";
import WebSocket from "ws";
import { readDroraStdioTapDevState } from "@drora/services/node";
import {
  DesktopCommandIds,
  appSettingsPatchSchema,
  formatZodError,
  localeSchema,
  nonEmptyStringSchema,
  PlatformChannels,
  rendererLogPayloadSchema,
  stringArraySchema,
  webRemoteControlWorkspaceTargetsSchema,
  type DesktopCommandId,
  type ApplicationIconRequest,
  type Locale,
  type LoadCliMcpFromUserDirectoryRequest,
  type MigrateLegacyCommonMcpRequest,
  type OpenInEditorOptions,
  type SaveCliMcpToUserDirectoryRequest,
  type CreateTempTextAttachmentRequest,
  type MaterializeWorkflowArtifactFileRequest,
  type UpdateStatePayload,
  type WebRemoteControlWorkspaceTarget,
  type WindowControlsOverlayReadyPayload,
} from "@drora/shared";
import { getAppIconDataUrl, getInstalledEditors } from "./editors.js";
import { createFileApplicationService } from "@desktop/main/file-open-apps/index.js";
import type { FileApplicationTarget } from "@drora/shared";
import { getApplicationIcon } from "./applicationIcons.js";
import { exportLogs } from "./exportLogs.js";
import {
  createVoiceVendorProxyHandler,
  createVoiceVendorStreamHandler,
} from "./voiceVendorProxy.js";
import { createDoubaoAsrService } from "./doubaoAsrService.js";
import { createVoiceTranscriptIndicator } from "./voiceTranscriptIndicatorWindow.js";
import { resolveCommunityUrl } from "./desktopCommandHandlers.js";
import { openInEditor } from "./openInEditor.js";
import {
  openResourceManager,
  getResourceUsageSnapshot,
  setResourceUsageSamplingActive,
} from "./resourceManagerWindow.js";
import { registerResourceManagerStorageIpc } from "./resourceManagerStorage.js";
import { registerResourceManagerNetworkIpc } from "./resourceManagerNetwork.js";
import { applyWindowsTitleBarTheme, getWindowOverlayTheme } from "./desktopWindowChrome.js";
import { syncWindowControlsOverlayForZoomLevel } from "./desktopWindowButtonPosition.js";
import { resolveDesktopZoomLevelFromFactor } from "./desktopZoom.js";
import { resolveDesktopWindowChromeState } from "./desktopWindowChromeState.js";
import { handleWindowUnreadCountSync } from "./desktopWindowLifecycle.js";
import { captureWindowScreenshot, openPathInFileManager } from "./desktopMainIpcHelpers.js";
import { registerCuaPermissionIpcHandlers } from "./desktopCuaPermissionIpc.js";
import {
  registerDesktopBrowserIpcHandlers,
  type AttachBrowserGuest,
  type ReportBrowserScreenshotSurfaceReady,
  type UpdateBrowserGuestViewport,
  type BrowserViewResidencyIpcHandlers,
} from "./desktopBrowserViewIpc.js";
import {
  loadCliMcpFromUserDirectory,
  migrateLegacyCommonMcp,
  saveCliMcpToUserDirectory,
} from "./mcpUserDirectory/index.js";
import { createTempTextAttachment } from "./tempTextAttachment.js";
import { materializeWorkflowArtifactFile } from "./workflowArtifactFile.js";
import { registerDesktopSaveFileIpcHandler } from "./desktopSaveFile.js";
import { registerDesktopPrintToPdfIpcHandler } from "./desktopPrintToPdf.js";
import { registerDesktopCommandIpcHandler } from "./desktopCommandIpc.js";
import { registerCuaPipActiveSessionIpc } from "./desktopCuaPipIpc.js";

export function registerPlatformIpcHandlers(options: {
  fetchHelpConfig?: () => Promise<unknown>;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
  applyApplicationLocale: (locale: Locale) => Promise<void>;
  resolveSystemLocale: () => Locale;
  focusWorkspaceInExistingWindow: (
    path: string,
    extra?: { skipWindowId?: number },
  ) => { activated: boolean; winId?: number };
  windowWorkspaceMap: Map<number, Set<string>>;
  windowUnreadCountMap: Map<number, number>;
  currentApplicationLocale: () => Locale;
  executeDesktopCommand: (
    command: DesktopCommandId,
    senderWindow?: BrowserWindow | null,
  ) => Promise<unknown>;
  acknowledgePostUpdateReleaseNotes: (version: string) => Promise<void>;
  syncActiveTaskSession: (windowId: number, sessionId: string | null) => void;
  syncTaskRealtimeWorkspaceKeys: (windowId: number, workspaceKeys: Iterable<string>) => void;
  getUpdateState: () => UpdateStatePayload;
  openUpdateStatusWindow: () => void;
  syncWebRemoteControlWorkspaces: (
    windowId: number,
    workspaces: WebRemoteControlWorkspaceTarget[],
  ) => void;
  getDesktopSessionActivity: () => {
    runningAgentSessionCount: number;
  };
  getAutoUpdatePreferences: () => Promise<{
    autoDownloadAndInstallUpdates: boolean;
  }>;
  setAutoDownloadAndInstallUpdates: (enabled: boolean) => Promise<void>;
  syncAppSettings: (patch: ReturnType<typeof appSettingsPatchSchema.parse>) => void;
  /** 关闭驻留托盘能力查询（spec：docs/desktop/linux-close-to-tray.md）；传入 monitor 的 refresh */
  refreshCloseToTrayCapability: () => Promise<import("@drora/shared").DesktopCloseToTrayCapability>;
  /** 快捷键设置页录制态开关：true 时 main 重建菜单摘除可配置 accelerator（见 shortcut-settings-spec §7） */
  setShortcutRecordingActive?: (active: boolean, ownerWebContentsId?: number | null) => void;
  /** 桌面端设备标识符（基于 userData 路径的 SHA-256） */
  deviceMid: string;
  /** CDP-on-guest pivot：renderer `<webview>` 上报 guest webContentsId → main attach。 */
  attachBrowserGuest?: AttachBrowserGuest;
  /** renderer 自由尺寸变化 → 当前窗口所属的受控 tab。 */
  updateBrowserGuestViewport?: UpdateBrowserGuestViewport;
  /** 可信 owner renderer 上报的后台截图表面 ready。 */
  reportBrowserScreenshotSurfaceReady?: ReportBrowserScreenshotSurfaceReady;
  /** Browser tab 关闭、挂起、恢复与跨重启 shell IPC。 */
  browserViewResidencyHandlers?: BrowserViewResidencyIpcHandlers;
}) {
  ipcMain.handle(PlatformChannels.SelectDirectory, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(PlatformChannels.SelectDirectories, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory", "multiSelections"],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(PlatformChannels.SelectFile, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(PlatformChannels.SelectFiles, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }
    return result.filePaths;
  });

  registerDesktopSaveFileIpcHandler(options.logger);
  registerDesktopPrintToPdfIpcHandler(options.logger);

  ipcMain.handle(
    PlatformChannels.CreateTempTextAttachment,
    async (_event, payload: CreateTempTextAttachmentRequest) => {
      return createTempTextAttachment(payload);
    },
  );

  ipcMain.handle(
    PlatformChannels.MaterializeWorkflowArtifactFile,
    async (_event, payload: MaterializeWorkflowArtifactFileRequest) => {
      return materializeWorkflowArtifactFile(payload);
    },
  );

  registerDesktopBrowserIpcHandlers(
    options.attachBrowserGuest,
    options.updateBrowserGuestViewport,
    options.logger,
    options.reportBrowserScreenshotSurfaceReady,
    options.browserViewResidencyHandlers,
  );

  ipcMain.handle(PlatformChannels.ActivateOrSetWorkspace, (event, path: string) => {
    const validatedPath = nonEmptyStringSchema.parse(path);
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    const activated = options.focusWorkspaceInExistingWindow(validatedPath, {
      skipWindowId: senderWin?.id,
    });
    if (activated.activated) {
      return { activated: true };
    }

    if (senderWin) {
      let pathSet = options.windowWorkspaceMap.get(senderWin.id);
      if (!pathSet) {
        pathSet = new Set();
        options.windowWorkspaceMap.set(senderWin.id, pathSet);
        senderWin.on("closed", () => options.windowWorkspaceMap.delete(senderWin.id));
      }
      pathSet.add(validatedPath);
      options.syncTaskRealtimeWorkspaceKeys(senderWin.id, pathSet);
    }
    return { activated: false };
  });

  ipcMain.handle(PlatformChannels.GetResourceUsageSnapshot, (event) =>
    getResourceUsageSnapshot(event.sender.id),
  );
  // 设置页 Linux 置灰判断入口；monitor 带 stale 缓存，用户装完扩展重开设置页即可解除置灰。
  ipcMain.handle(PlatformChannels.GetCloseToTrayCapability, () =>
    options.refreshCloseToTrayCapability(),
  );
  ipcMain.on(PlatformChannels.SetResourceUsageSamplingActive, (event, active: unknown) => {
    if (typeof active === "boolean") setResourceUsageSamplingActive(event.sender.id, active);
  });
  registerResourceManagerStorageIpc();
  registerResourceManagerNetworkIpc();
  ipcMain.handle(PlatformChannels.GetDroraStdioTapDevState, () => readDroraStdioTapDevState());
  ipcMain.on(PlatformChannels.OpenResourceManager, () => {
    openResourceManager();
  });

  ipcMain.handle(
    PlatformChannels.LoadMcpFromUserDirectory,
    async (_event, payload?: LoadCliMcpFromUserDirectoryRequest) => {
      return loadCliMcpFromUserDirectory(payload);
    },
  );

  ipcMain.handle(
    PlatformChannels.SaveMcpToUserDirectory,
    async (_event, payload: SaveCliMcpToUserDirectoryRequest) => {
      try {
        await saveCliMcpToUserDirectory(payload);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        options.logger.warn("[mcp-user-directory] save failed", message);
        return { success: false, error: message };
      }
    },
  );

  ipcMain.handle(
    PlatformChannels.MigrateLegacyCommonMcp,
    async (_event, payload?: MigrateLegacyCommonMcpRequest) => {
      return migrateLegacyCommonMcp(payload);
    },
  );

  ipcMain.handle(PlatformChannels.SetTitleBarTheme, (event, theme: string) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return;
    }

    if (theme !== "light" && theme !== "dark" && theme !== "system") {
      options.logger.warn("[title-bar-theme] invalid theme:", theme);
      return;
    }

    nativeTheme.themeSource = theme;
    applyWindowsTitleBarTheme(senderWindow, theme === "system" ? getWindowOverlayTheme() : theme);
  });

  ipcMain.handle(PlatformChannels.SetApplicationLocale, (_event, locale: unknown) => {
    const result = localeSchema.safeParse(locale);
    if (!result.success) {
      options.logger.warn("[application-locale] invalid locale:", formatZodError(result.error));
      return;
    }

    return options.applyApplicationLocale(result.data);
  });

  ipcMain.handle(PlatformChannels.GetSystemLocale, () => options.resolveSystemLocale());

  ipcMain.on(PlatformChannels.SyncWindowTabs, (event, paths: string[]) => {
    const result = stringArraySchema.safeParse(paths);
    if (!result.success) {
      options.logger.warn("[sync-window-tabs] invalid payload:", formatZodError(result.error));
      return;
    }
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      options.windowWorkspaceMap.set(win.id, new Set(result.data));
      options.syncTaskRealtimeWorkspaceKeys(win.id, result.data);
      // 远控恢复统一由 SyncWebRemoteControlWorkspaces 的完整快照驱动。
    }
  });

  ipcMain.on(PlatformChannels.SyncWebRemoteControlWorkspaces, (event, payload: unknown) => {
    const result = webRemoteControlWorkspaceTargetsSchema.safeParse(payload);
    if (!result.success) {
      options.logger.warn(
        "[sync-web-remote-control-workspaces] invalid payload:",
        formatZodError(result.error),
      );
      return;
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return;
    }

    options.syncWebRemoteControlWorkspaces(win.id, result.data);
  });

  ipcMain.on(PlatformChannels.SyncWindowUnreadCount, (event, payload: unknown) => {
    handleWindowUnreadCountSync(
      BrowserWindow.fromWebContents(event.sender),
      payload,
      options.windowUnreadCountMap,
      options.logger,
    );
  });
  registerCuaPipActiveSessionIpc({
    syncActiveTaskSession: options.syncActiveTaskSession,
    warn: (message) => options.logger.warn(message),
  });
  ipcMain.on(
    PlatformChannels.WindowControlsOverlayReady,
    (event, payload: WindowControlsOverlayReadyPayload) => {
      const senderWindow = BrowserWindow.fromWebContents(event.sender);
      if (!senderWindow || !Number.isFinite(payload.zoomLevel)) {
        return;
      }

      // preload 早于 React 页面运行，用它同步到的 zoom 档位先调整 macOS 红绿灯，
      // 避免等 RootStartupLoading 切到 App 页面后才重置位置。
      syncWindowControlsOverlayForZoomLevel(senderWindow, payload.zoomLevel);
    },
  );

  ipcMain.on(PlatformChannels.SyncAppSettings, (_event, payload: unknown) => {
    const result = appSettingsPatchSchema.safeParse(payload);
    if (!result.success) {
      options.logger.warn(
        "[settings] invalid app settings sync payload:",
        formatZodError(result.error),
      );
      return;
    }

    options.syncAppSettings(result.data);
  });

  // 快捷键录制态：renderer 设置页进入/退出录制时通知。macOS 系统菜单会先于 renderer
  // 吃掉按键，录制 menu 通道命令必须先摘掉可配置 accelerator，否则按键直接触发原命令。
  // 附带发起方 webContents id：录制中窗口销毁时 main 侧据此复位（见 index.ts）。
  ipcMain.on(PlatformChannels.SetShortcutRecordingActive, (event, payload: unknown) => {
    if (typeof payload !== "boolean") {
      options.logger.warn("[shortcuts] invalid recording-active payload:", payload);
      return;
    }
    options.setShortcutRecordingActive?.(payload, event.sender.id);
  });

  ipcMain.on(PlatformChannels.Log, (event, payload: unknown) => {
    const result = rendererLogPayloadSchema.safeParse(payload);
    if (!result.success) {
      options.logger.warn("[renderer-log] invalid payload:", formatZodError(result.error));
      return;
    }
    (
      options.logger as unknown as { fromRenderer(level: string, args: unknown[]): void }
    ).fromRenderer?.(
      result.data.level,
      decorateRequestSecurityLogArgs(result.data.args, event.sender.id),
    );
  });

  ipcMain.handle(PlatformChannels.OpenInFileManager, async (_event, rawPath: string) =>
    openPathInFileManager(rawPath, options.logger),
  );

  registerCuaPermissionIpcHandlers({
    logger: options.logger,
    currentApplicationLocale: options.currentApplicationLocale,
  });

  ipcMain.handle(PlatformChannels.CanOpenCommunity, async (_event, locale: unknown) => {
    const result = localeSchema.safeParse(locale);
    if (!result.success) {
      options.logger.warn("[community] invalid locale:", formatZodError(result.error));
      return false;
    }

    const communityUrl = await resolveCommunityUrl({
      locale: result.data,
      fetchRemoteConfig: options.fetchHelpConfig,
      logger: options.logger,
    });

    return typeof communityUrl === "string" && communityUrl.length > 0;
  });

  ipcMain.handle(
    PlatformChannels.AcknowledgePostUpdateReleaseNotes,
    async (_event, version: string) => {
      const validatedVersion = nonEmptyStringSchema.parse(version);
      await options.acknowledgePostUpdateReleaseNotes(validatedVersion);
    },
  );

  ipcMain.handle(PlatformChannels.GetUpdateState, () => options.getUpdateState());
  ipcMain.handle(PlatformChannels.OpenUpdateStatusWindow, () => {
    options.openUpdateStatusWindow();
  });
  ipcMain.handle(PlatformChannels.GetAutoUpdatePreferences, () =>
    options.getAutoUpdatePreferences(),
  );
  ipcMain.handle(
    PlatformChannels.SetAutoDownloadAndInstallUpdates,
    async (_event, enabled: unknown) => {
      if (typeof enabled !== "boolean") {
        return;
      }
      await options.setAutoDownloadAndInstallUpdates(enabled);
    },
  );
  ipcMain.handle(PlatformChannels.GetDesktopSessionActivity, () =>
    options.getDesktopSessionActivity(),
  );
  ipcMain.handle(PlatformChannels.GetDesktopZoomLevel, (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      return { zoomLevel: 0 };
    }

    return {
      zoomLevel: resolveDesktopZoomLevelFromFactor(senderWindow.webContents.getZoomFactor()),
    };
  });
  ipcMain.handle(PlatformChannels.GetDesktopWindowChromeState, (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    return resolveDesktopWindowChromeState(senderWindow?.isMaximized() ?? false);
  });
  ipcMain.handle(PlatformChannels.GetInstalledEditors, (_event, filePath?: string) =>
    getInstalledEditors(typeof filePath === "string" ? filePath : undefined),
  );
  const fileApplications = createFileApplicationService({
    getIcon: (id, path) => getAppIconDataUrl(id, path),
    logger: options.logger,
  });
  ipcMain.handle(PlatformChannels.GetFileApplications, (_event, target: FileApplicationTarget) =>
    fileApplications.getFileApplications(target),
  );
  ipcMain.handle(
    PlatformChannels.OpenFileWithApplication,
    (_event, payload: { applicationId: string; target: FileApplicationTarget }) =>
      fileApplications.openFileWithApplication(payload?.applicationId, payload?.target),
  );
  ipcMain.handle(
    PlatformChannels.GetApplicationIcon,
    (_event, request: string | ApplicationIconRequest) => getApplicationIcon(request),
  );
  ipcMain.handle(PlatformChannels.GetDeviceId, () => options.deviceMid);
  ipcMain.handle(PlatformChannels.ExportLogs, () => exportLogs());
  // §15.8 语音厂商出站代理：main net.fetch 不受 CORS 约束；白名单/上限/超时校验在 handler。
  const voiceVendorProxyHandler = createVoiceVendorProxyHandler({
    fetchImpl: (input, init) => net.fetch(input, init),
  });
  ipcMain.handle(PlatformChannels.VoiceVendorProxyFetch, (_event, payload: unknown) =>
    voiceVendorProxyHandler(payload),
  );
  // §16 真流式播报三通道：Start 逐行推 Chunk（帧下行绑 sender webContents）；Abort 摘流。
  const voiceVendorStreamHandler = createVoiceVendorStreamHandler({
    fetchImpl: (input, init) => net.fetch(input, init),
  });
  ipcMain.handle(PlatformChannels.VoiceVendorProxyStreamStart, (event, payload: unknown) =>
    voiceVendorStreamHandler.start(payload, (frame) => {
      // 窗口销毁后 send 会 throw（"Object has been destroyed"）——吞掉防 main unhandled
      // rejection（§16 审查修复）；流本体由 60s 硬闸/GC 表自然收尾。
      try {
        BrowserWindow.fromWebContents(event.sender)?.webContents.send(
          PlatformChannels.VoiceVendorProxyStreamChunk,
          frame,
        );
      } catch {
        // sender 已销毁：帧丢弃。
      }
    }),
  );
  ipcMain.handle(PlatformChannels.VoiceVendorProxyStreamAbort, (_event, payload: unknown) =>
    voiceVendorStreamHandler.abort(payload),
  );
  // §9.6.10 豆包流式 ASR 通道族：常驻 service（Start/Audio/Abort 三通道共享会话表）；
  // 下行按 streamId 路由到发起 Start 的 sender（窗口销毁吞异常，§16 sink 同款）；
  // 悬浮指示窗（§5.5 二次增补）：起录 show、结束 hide，Transcript/State 同帧转发。
  const transcriptIndicator = (() => {
    const devUrl = process.env["ELECTRON_RENDERER_URL"];
    return createVoiceTranscriptIndicator({
      createWindow: (options) =>
        new BrowserWindow({
          ...options,
          alwaysOnTop: true,
          // 2026-11-07 修正：透明窗原生阴影按整窗口矩形涂抹（跟不上圆角面板），在面板
          // 下方透明死区晕出暗色区域（真机截图「黄色区域」问题）；投影由面板自身
          // boxShadow 提供，原生阴影必须关。
          hasShadow: false,
          show: false,
          // webPreferences 放 options 之后仅追加安全字段——不能整体覆盖
          //（options.webPreferences.preload 是指示窗桥的唯一注入通道，覆盖即丢失，
          // 真机实证：bridge undefined → App 空态渲染 → 「窗口关闭」假象）。
          webPreferences: {
            ...options.webPreferences,
            nodeIntegration: false,
            contextIsolation: true,
          },
        }),
      getCursorDisplayWorkArea: () => {
        const point = screen.getCursorScreenPoint();
        return screen.getDisplayNearestPoint(point).workArea;
      },
      resolveEntryUrl: (isDev, devUrl, dir) =>
        isDev && devUrl
          ? { url: `${devUrl}/voice-transcript.html` }
          : { file: join(dir, "voice-transcript.html") },
      rendererDevUrl: devUrl,
      rendererDir: join(import.meta.dirname, "../renderer"),
      preloadPath: join(import.meta.dirname, "../preload/voice-transcript-preload.cjs"),
      logger: options.logger,
    });
  })();
  {
    const senders = new Map<string, Electron.WebContents>();
    const push = (channel: string, frame: { streamId: string }) => {
      const sender = senders.get(frame.streamId);
      if (!sender || sender.isDestroyed()) return;
      try {
        sender.send(channel, frame);
      } catch {
        // sender 已销毁：帧丢弃。
      }
    };
    const doubaoAsr = createDoubaoAsrService({
      connect: (url, headers) => new WebSocket(url, { headers }),
      sendTranscript: (frame) => {
        push(PlatformChannels.VoiceAsrStreamTranscript, frame);
        transcriptIndicator.send(PlatformChannels.VoiceAsrStreamTranscript, frame);
      },
      sendState: (frame) => {
        push(PlatformChannels.VoiceAsrStreamState, frame);
        transcriptIndicator.send(PlatformChannels.VoiceAsrStreamState, frame);
        if (frame.status === "ended" || frame.status === "error") {
          transcriptIndicator.hide(); // 会话终：指示窗隐藏（窗体复用不销毁）。
          transcriptIndicator.send("drora:voice-transcript-hide", { streamId: frame.streamId });
        }
        senders.delete(frame.streamId); // ended/error 后不再需要路由。
      },
    });
    ipcMain.handle(PlatformChannels.VoiceAsrStreamStart, (event, payload: unknown) => {
      // 指示窗零等待反馈（真机实证修复）：invoke 即显示——不等 WS 连接（串行链 2s+
      // 期间用户看到的「按住无反应/闪现即失」）；连接失败经 sendState error 路径 hide。
      transcriptIndicator.show();
      transcriptIndicator.send("drora:voice-transcript-show", { streamId: "pending" });
      return doubaoAsr
        .start(payload)
        .then((result) => {
          senders.set(result.streamId, event.sender);
          return result;
        })
        .catch((error: unknown) => {
          transcriptIndicator.hide();
          transcriptIndicator.send("drora:voice-transcript-hide", { streamId: "pending" });
          throw error;
        });
    });
    ipcMain.on(PlatformChannels.VoiceAsrStreamAudio, (_event, chunk: unknown) => {
      doubaoAsr.sendAudio(chunk);
    });
    ipcMain.handle(PlatformChannels.VoiceAsrStreamAbort, (_event, payload: unknown) => {
      const streamId = (payload as { streamId?: string })?.streamId ?? "";
      senders.delete(streamId);
      transcriptIndicator.hide();
      transcriptIndicator.send("drora:voice-transcript-hide", { streamId });
      doubaoAsr.abort(payload);
    });
    // 指示窗「停止听写」→ 路由回发起听写的主窗 renderer（走主窗 ToggleStop 等价通道）。
    ipcMain.on("drora:voice-transcript-stop-request", (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.webContents === event.sender || window.webContents.isDestroyed()) continue;
        try {
          window.webContents.send(PlatformChannels.VoiceAsrStreamAbort, { streamId: "*" });
        } catch {
          // 主窗已销毁：忽略。
        }
      }
      // v1 简化：全局停止——由主窗 useVoiceDictation 的 stop 语义按 owner 落地
      //（doubao 流式 stop = last 帧 + 尾句结算，见 §9.6.10 适配器）。
      event.sender.send("drora:voice-transcript-hide", { streamId: "*" });
    });
  }
  ipcMain.handle(PlatformChannels.CaptureWindowScreenshot, async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    return captureWindowScreenshot(senderWindow);
  });
  ipcMain.handle(
    PlatformChannels.OpenInEditor,
    (_event, payload: { editorId: string; path: string; options?: OpenInEditorOptions }) =>
      openInEditor(payload.editorId, payload.path, payload.options),
  );

  registerDesktopCommandIpcHandler({
    executeDesktopCommand: options.executeDesktopCommand,
    logger: options.logger,
  });
}
