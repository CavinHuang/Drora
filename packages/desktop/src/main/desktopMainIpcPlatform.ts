/* eslint-disable max-lines -- 桌面平台 IPC 集中装配，拆散会让权限边界更难审计；行数随平台能力增长。 */
import { BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
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
  type DesktopCommandId,
  type ApplicationIconRequest,
  type Locale,
  type LoadCliMcpFromUserDirectoryRequest,
  type MigrateLegacyCommonMcpRequest,
  type OpenInEditorOptions,
  type SaveCliMcpToUserDirectoryRequest,
  type CreateTempTextAttachmentRequest,
  type UpdateStatePayload,
  type WindowControlsOverlayReadyPayload,
  type MobilePairingRuntimeState,
  type MobileRelayTaskSyncEntry,
  type MobileRelayTransport,
  type MobileRelayWorkspaceSyncEntry,
} from "@drora/shared";
import { getInstalledEditors } from "./editors.js";
import { getApplicationIcon } from "./applicationIcons.js";
import { exportLogs } from "./exportLogs.js";
import { resolveCommunityUrl } from "./desktopCommandHandlers.js";
import { openInEditor } from "./openInEditor.js";
import {
  openResourceManager,
  getResourceUsageSnapshot,
  setResourceUsageSamplingActive,
} from "./resourceManagerWindow.js";
import { registerResourceManagerStorageIpc } from "./resourceManagerStorage.js";
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
import { registerDesktopSaveFileIpcHandler } from "./desktopSaveFile.js";
import { registerDesktopPrintToPdfIpcHandler } from "./desktopPrintToPdf.js";
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
  getDesktopSessionActivity: () => {
    runningAgentSessionCount: number;
  };
  getAutoUpdatePreferences: () => Promise<{
    autoDownloadAndInstallUpdates: boolean;
  }>;
  setAutoDownloadAndInstallUpdates: (enabled: boolean) => Promise<void>;
  syncAppSettings: (patch: unknown) => void;
  /** 快捷键设置页录制态开关：true 时 main 重建菜单摘除可配置 accelerator */
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
  /** relay 远控（M4a + 内嵌 LAN §12，spec: mobile-web-remote.md / mobile-relay-server.md）。仅 Desktop 主进程提供。 */
  mobileRelay?: {
    start: (params: {
      workspacePath: string;
      workspaceIdentity?: string;
      /** lan=进程内嵌自建 relay；cloud=云中继（缺省）。 */
      transport?: MobileRelayTransport;
      senderWebContentsId: number;
    }) => Promise<{ url: string; sessionId: string }>;
    reset: (params: { senderWebContentsId: number }) => Promise<{ url: string; sessionId: string }>;
    stop: () => Promise<void>;
    state: () => MobilePairingRuntimeState;
    syncWorkspaces: (
      senderWebContentsId: number,
      workspaces: MobileRelayWorkspaceSyncEntry[],
    ) => void;
    syncTasks: (senderWebContentsId: number, tasks: MobileRelayTaskSyncEntry[]) => void;
  };
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

  ipcMain.handle(
    PlatformChannels.MobileRelayStart,
    async (
      event,
      params:
        | { workspacePath?: string; workspaceIdentity?: string; transport?: string }
        | undefined,
    ) => {
      if (!options.mobileRelay) {
        throw new Error("mobile relay control is unavailable in this build");
      }
      return options.mobileRelay.start({
        workspacePath: String(params?.workspacePath ?? ""),
        workspaceIdentity: params?.workspaceIdentity ? String(params.workspaceIdentity) : undefined,
        // 契约字面量白名单化（shared MobileRelayTransport）；未知值回落 cloud。
        transport: params?.transport === "lan" ? "lan" : "cloud",
        senderWebContentsId: event.sender.id,
      });
    },
  );
  ipcMain.handle(PlatformChannels.MobileRelayReset, async (event) => {
    if (!options.mobileRelay) {
      throw new Error("mobile relay control is unavailable in this build");
    }
    return options.mobileRelay.reset({ senderWebContentsId: event.sender.id });
  });
  ipcMain.handle(PlatformChannels.MobileRelayStop, async () => {
    await options.mobileRelay?.stop();
  });
  ipcMain.handle(PlatformChannels.MobileRelayState, () => {
    return (
      options.mobileRelay?.state() ?? {
        running: false,
        status: "idle" as const,
        connected: false,
        url: null,
        workspacePath: null,
        workspaceIdentity: null,
        failure: null,
      }
    );
  });
  // 多工作区聚合（对齐官方 syncWebRemoteControlWorkspaces/Tasks）：renderer 在
  // tab 变化时推送窗口全部工作区与任务摘要，main 侧作为 bootstrap 清单事实源。
  ipcMain.handle(PlatformChannels.MobileRelaySyncWorkspaces, (event, workspaces: unknown) => {
    options.mobileRelay?.syncWorkspaces(event.sender.id, sanitizeSyncWorkspaces(workspaces));
  });
  ipcMain.handle(PlatformChannels.MobileRelaySyncTasks, (event, tasks: unknown) => {
    options.mobileRelay?.syncTasks(event.sender.id, sanitizeSyncTasks(tasks));
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
  ipcMain.on(PlatformChannels.SetResourceUsageSamplingActive, (event, active: unknown) => {
    if (typeof active === "boolean") setResourceUsageSamplingActive(event.sender.id, active);
  });
  registerResourceManagerStorageIpc();
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
    }
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

  ipcMain.on(PlatformChannels.Log, (_event, payload: unknown) => {
    const result = rendererLogPayloadSchema.safeParse(payload);
    if (!result.success) {
      options.logger.warn("[renderer-log] invalid payload:", formatZodError(result.error));
      return;
    }
    (
      options.logger as unknown as { fromRenderer(level: string, args: unknown[]): void }
    ).fromRenderer?.(result.data.level, result.data.args);
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
  ipcMain.handle(PlatformChannels.GetInstalledEditors, () => getInstalledEditors());
  ipcMain.handle(
    PlatformChannels.GetApplicationIcon,
    (_event, request: string | ApplicationIconRequest) => getApplicationIcon(request),
  );
  ipcMain.handle(PlatformChannels.GetDeviceId, () => options.deviceMid);
  ipcMain.handle(PlatformChannels.ExportLogs, () => exportLogs());
  ipcMain.handle(PlatformChannels.CaptureWindowScreenshot, async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    return captureWindowScreenshot(senderWindow);
  });
  ipcMain.handle(
    PlatformChannels.OpenInEditor,
    (_event, payload: { editorId: string; path: string; options?: OpenInEditorOptions }) =>
      openInEditor(payload.editorId, payload.path, payload.options),
  );

  ipcMain.handle(PlatformChannels.ExecuteDesktopCommand, async (event, command: string) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const isKnownCommand = (Object.values(DesktopCommandIds) as string[]).includes(command);
    if (!isKnownCommand) {
      options.logger.warn("[desktop-command] invalid command:", command);
      return;
    }

    // 返回值直通 renderer 的 executeDesktopCommand promise（GetCuaOsSupport 依赖此行为）。
    return await options.executeDesktopCommand(command as DesktopCommandId, senderWindow);
  });
}

/** relay 工作区同步载荷的形状级运行时校验（协议入口防御）。 */
function sanitizeSyncWorkspaces(value: unknown): MobileRelayWorkspaceSyncEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): MobileRelayWorkspaceSyncEntry[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const workspacePath =
      typeof record.workspacePath === "string" ? record.workspacePath.trim() : "";
    if (!workspacePath) return [];
    const kind = record.kind === "remote" ? "remote" : "local";
    // 官方 jjn 语义：connectionState 仅远程携带，合法值之外丢弃（本地缺省）。
    const connectionState =
      record.connectionState === "disconnected" || record.connectionState === "reconnecting"
        ? record.connectionState
        : record.connectionState === "connected"
          ? "connected"
          : undefined;
    return [
      {
        workspacePath,
        ...(typeof record.workspaceIdentity === "string" && record.workspaceIdentity.trim()
          ? { workspaceIdentity: record.workspaceIdentity.trim() }
          : {}),
        ...(typeof record.remoteSessionId === "string" && record.remoteSessionId.trim()
          ? { remoteSessionId: record.remoteSessionId.trim() }
          : {}),
        label:
          typeof record.label === "string" && record.label.trim() ? record.label : workspacePath,
        kind,
        ...(connectionState ? { connectionState } : {}),
        ...(typeof record.workspacePurpose === "string" && record.workspacePurpose.trim()
          ? { workspacePurpose: record.workspacePurpose.trim() }
          : {}),
        ...(typeof record.lastConnectionError === "string" && record.lastConnectionError.trim()
          ? { lastConnectionError: record.lastConnectionError.trim() }
          : {}),
      },
    ];
  });
}

/** relay 任务同步载荷的形状级运行时校验。 */
function sanitizeSyncTasks(value: unknown): MobileRelayTaskSyncEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): MobileRelayTaskSyncEntry[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const taskId = typeof record.taskId === "string" ? record.taskId.trim() : "";
    const workspacePath =
      typeof record.workspacePath === "string" ? record.workspacePath.trim() : "";
    if (!taskId || !workspacePath) return [];
    return [
      {
        taskId,
        title: typeof record.title === "string" ? record.title : "",
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
        createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
        workspacePath,
        ...(typeof record.workspaceIdentity === "string" && record.workspaceIdentity.trim()
          ? { workspaceIdentity: record.workspaceIdentity.trim() }
          : {}),
        ...(typeof record.remoteSessionId === "string" && record.remoteSessionId.trim()
          ? { remoteSessionId: record.remoteSessionId.trim() }
          : {}),
      },
    ];
  });
}
