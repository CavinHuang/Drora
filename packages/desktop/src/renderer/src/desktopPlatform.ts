import { recordArmsCustomEventForE2E } from "@drora/ui";
import { DesktopCommandIds, buildLocalMediaPreviewUrl, type IPlatformService } from "@drora/shared";

import { desktopBrowserPlatformBridge } from "./desktopBrowserPlatformBridge.js";

export function createDesktopPlatform(options: {
  isLocalDevelopmentRuntime: boolean;
}): IPlatformService {
  return {
    canSelectFilePath: true,
    createLocalMediaPreviewUrl: buildLocalMediaPreviewUrl,
    isLocalDevelopmentRuntime: options.isLocalDevelopmentRuntime,
    selectDirectory: () => window.drora.selectDirectory(),
    startMobilePairing: (params) => window.drora.startMobilePairing(params),
    stopMobilePairing: () => window.drora.stopMobilePairing(),
    getMobilePairingState: () => window.drora.getMobilePairingState(),
    selectFile: () => window.drora.selectFile(),
    selectFiles: () => window.drora.selectFiles?.() ?? Promise.resolve([]),
    createTempTextAttachment: (payload) => window.drora.createTempTextAttachment(payload),
    onRemoteConnectionLog: (handler) => window.drora.onRemoteConnectionLog(handler),
    onRemoteSessionClosed: (handler) => window.drora.onRemoteSessionClosed(handler),
    onBotRemoteWorkspaceReconnected: (handler) =>
      window.drora.onBotRemoteWorkspaceReconnected(handler),
    activateOrSetWorkspace: (path) =>
      window.drora.activateOrSetWorkspace?.(path) ?? Promise.resolve({ activated: false }),
    connectRemote: (remoteOptions, requestId, context) =>
      window.drora.connectRemote(remoteOptions, requestId, context),
    cancelPendingRemoteConnection: (requestId) =>
      window.drora.cancelPendingRemoteConnection?.(requestId) ?? Promise.resolve(),
    bindRemoteWorkspaceSessionContext: (context) =>
      window.drora.bindRemoteWorkspaceSessionContext?.(context) ?? Promise.resolve(),
    disposeRemoteSession: (sessionId) => window.drora.disposeRemoteSession(sessionId),
    isDockerAvailable: () => window.drora.isDockerAvailable(),
    listWSLDistros: () => window.drora.listWSLDistros(),
    listDockerContainers: () => window.drora.listDockerContainers(),
    listSSHConfigAliases: () => window.drora.listSSHConfigAliases(),
    loadMcpFromUserDirectory: (payload) => window.drora.loadMcpFromUserDirectory(payload),
    saveMcpToUserDirectory: (payload) => window.drora.saveMcpToUserDirectory(payload),
    migrateLegacyCommonMcp: (payload) => window.drora.migrateLegacyCommonMcp(payload),
    openExternal: (url) => window.drora.openExternal(url),
    openFeedback: () => window.drora.executeDesktopCommand(DesktopCommandIds.OpenFeedback),
    openCommunity: () => window.drora.executeDesktopCommand(DesktopCommandIds.OpenCommunity),
    canOpenCommunity: (locale) => window.drora.canOpenCommunity(locale),
    openInFileManager: (path) => window.drora.openInFileManager(path),
    openExternalFile: (path) => window.drora.openExternalFile(path),
    openCuaPermissionOnboarding: window.drora.openCuaPermissionOnboarding
      ? (permissionOptions) =>
          window.drora.openCuaPermissionOnboarding?.(permissionOptions) ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    prepareCuaHelperPermissionDrag: window.drora.prepareCuaHelperPermissionDrag
      ? () =>
          window.drora.prepareCuaHelperPermissionDrag?.() ??
          Promise.resolve({ success: false, error: "not_supported" })
      : undefined,
    startCuaHelperPermissionDrag: window.drora.startCuaHelperPermissionDrag
      ? () => window.drora.startCuaHelperPermissionDrag?.()
      : undefined,
    registerOAuthState: (payload) => window.drora.registerOAuthState(payload),
    onOAuthCallback: (callback) => window.drora.onOAuthCallback(callback),
    onPaymentCallback: (callback) => window.drora.onPaymentCallback(callback),
    onShareImport: (callback) => window.drora.onShareImport?.(callback) ?? (() => {}),
    notifyRendererReady: () => window.drora.notifyRendererReady(),
    reportTelemetryEvent: (payload) => window.drora.reportTelemetryEvent(payload),
    reportArmsCustomEvent: (payload) => {
      recordArmsCustomEventForE2E(payload);
      return window.drora.reportArmsCustomEvent(payload);
    },
    getRendererActionTraceConfig: window.drora.getRendererActionTraceConfig
      ? () => window.drora.getRendererActionTraceConfig!()
      : undefined,
    onRendererActionTraceConfigChanged: window.drora.onRendererActionTraceConfigChanged
      ? (callback) => window.drora.onRendererActionTraceConfigChanged!(callback)
      : undefined,
    reportLocalTtftBatch: (batch) => window.drora.reportLocalTtftBatch(batch),
    reportRendererActionTraceBatch: window.drora.reportRendererActionTraceBatch
      ? (batch) => window.drora.reportRendererActionTraceBatch!(batch)
      : undefined,
    reportRendererHeapSample: window.drora.reportRendererHeapSample
      ? (sample) => window.drora.reportRendererHeapSample!(sample)
      : undefined,
    showTaskNotification: (payload) => window.drora.showTaskNotification(payload),
    publishDesktopPet: (presentation) => window.drora.publishDesktopPet?.(presentation),
    syncWindowTabs: (paths) => window.drora.syncWindowTabs(paths),
    syncWindowUnreadCount: (count) => window.drora.syncWindowUnreadCount(count),
    syncActiveTaskSession: (sessionId) => window.drora.syncActiveTaskSession(sessionId),
    syncAppSettings: (patch) => window.drora.syncAppSettings?.(patch),
    setShortcutRecordingActive: (active) => window.drora.setShortcutRecordingActive?.(active),
    onFocusTab: (handler) => window.drora.onFocusTab(handler),
    onNewTab: (handler) => window.drora.onNewTab(handler),
    onCloseActiveContextRequest: (handler) =>
      window.drora.onCloseActiveContextRequest?.(handler) ?? (() => {}),
    onOpenBrowserUrl: (handler) => window.drora.onOpenBrowserUrl?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfacePrepare: (handler) =>
      window.drora.onBrowserViewScreenshotSurfacePrepare?.(handler) ?? (() => {}),
    onBrowserViewScreenshotSurfaceRelease: (handler) =>
      window.drora.onBrowserViewScreenshotSurfaceRelease?.(handler) ?? (() => {}),
    browserViewScreenshotSurfaceReady: (payload) =>
      window.drora.browserViewScreenshotSurfaceReady?.(payload),
    ...desktopBrowserPlatformBridge,
    onNewTask: (handler) => window.drora.onNewTask(handler),
    onOpenWorkspace: (handler) => {
      // 开发态或升级后的旧窗口可能仍运行未暴露 onOpenWorkspace 的 preload，
      // renderer 直接调用会在启动时崩溃。这里和 activateOrSetWorkspace 一样做兼容兜底，
      // 缺少该 bridge 时只禁用原生菜单回调，不影响应用继续打开。
      return window.drora.onOpenWorkspace?.(handler) ?? (() => {});
    },
    onOpenWorkspacePath: (handler) => window.drora.onOpenWorkspacePath?.(handler) ?? (() => {}),
    onOpenFeedbackDialog: (handler) => window.drora.onOpenFeedbackDialog?.(handler) ?? (() => {}),
    onOpenTicketsPanel: (handler) => window.drora.onOpenTicketsPanel?.(handler) ?? (() => {}),
    onWindowFullscreenChanged: (handler) => window.drora.onWindowFullscreenChanged(handler),
    getDesktopWindowChromeState: window.drora.getDesktopWindowChromeState
      ? () => window.drora.getDesktopWindowChromeState!()
      : undefined,
    onDesktopWindowChromeStateChanged: window.drora.onDesktopWindowChromeStateChanged
      ? (handler) => window.drora.onDesktopWindowChromeStateChanged!(handler)
      : undefined,
    getWindowControlsOverlayMetrics: () => window.drora.getWindowControlsOverlayMetrics?.() ?? null,
    onWindowControlsOverlayChanged: (handler) =>
      window.drora.onWindowControlsOverlayChanged?.(handler) ?? (() => {}),
    getDesktopZoomLevel: () =>
      window.drora.getDesktopZoomLevel?.() ?? Promise.resolve({ zoomLevel: 0 }),
    onDesktopZoomLevelChanged: (handler) =>
      window.drora.onDesktopZoomLevelChanged?.(handler) ?? (() => {}),
    onTaskNotificationClick: (handler) => window.drora.onTaskNotificationClick(handler),
    onDesktopPetOpenTask: (handler) => window.drora.onDesktopPetOpenTask?.(handler) ?? (() => {}),
    exportLogs: () => window.drora.exportLogs(),
    captureWindowScreenshot: () =>
      window.drora.captureWindowScreenshot?.() ?? Promise.resolve(null),
    onUpdateReady: (callback) => window.drora.onUpdateReady(callback),
    onUpdateCheckResult: (callback) => window.drora.onUpdateCheckResult(callback),
    onUpdateStateChanged: (callback) => window.drora.onUpdateStateChanged?.(callback) ?? (() => {}),
    getUpdateState: () =>
      window.drora.getUpdateState?.() ?? Promise.resolve({ kind: "idle", enabled: true }),
    downloadUpdate: () => window.drora.downloadUpdate?.() ?? Promise.resolve(),
    cancelUpdateDownload: () => window.drora.cancelUpdateDownload?.() ?? Promise.resolve(),
    openUpdateStatusWindow: () => window.drora.openUpdateStatusWindow?.() ?? Promise.resolve(),
    getAutoUpdatePreferences: () =>
      window.drora.getAutoUpdatePreferences?.() ??
      Promise.resolve({ autoDownloadAndInstallUpdates: false }),
    setAutoDownloadAndInstallUpdates: (enabled) =>
      window.drora.setAutoDownloadAndInstallUpdates?.(enabled) ?? Promise.resolve(),
    getDesktopSessionActivity: () =>
      window.drora.getDesktopSessionActivity?.() ??
      Promise.resolve({ runningAgentSessionCount: 0 }),
    getDroraStdioTapDevState: () =>
      window.drora.getDroraStdioTapDevState?.() ??
      Promise.resolve({ enabled: false, visible: false, logDir: "", statePath: "" }),
    onSettingsChanged: (callback) => window.drora.onSettingsChanged?.(callback) ?? (() => {}),
    onApplicationLocaleChanged: (callback) =>
      window.drora.onApplicationLocaleChanged?.(callback) ?? (() => {}),
    onPostUpdateReleaseNotes: (callback) => window.drora.onPostUpdateReleaseNotes(callback),
    acknowledgePostUpdateReleaseNotes: (version) =>
      window.drora.acknowledgePostUpdateReleaseNotes(version),
    skipUpdateVersion: (version) => window.drora.skipUpdateVersion?.(version) ?? Promise.resolve(),
    quitAndInstallUpdate: () => window.drora.quitAndInstallUpdate(),
    getInstalledEditors: () => window.drora.getInstalledEditors(),
    getApplicationIcon: (bundleId) =>
      window.drora.getApplicationIcon?.(bundleId) ?? Promise.resolve(null),
    openInEditor: (editorId, path, editorOptions) =>
      window.drora.openInEditor(editorId, path, editorOptions),
    executeDesktopCommand: (command) => window.drora.executeDesktopCommand(command),
    setApplicationLocale: (locale) => window.drora.setApplicationLocale(locale),
    getSystemLocale: () =>
      window.drora.getSystemLocale?.() ??
      Promise.resolve(navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"),
    setTitleBarTheme: (theme) => window.drora.setTitleBarTheme(theme),
    getDeviceId: () =>
      (window as Window & { __DRORA_DEVICE_ID__?: string }).__DRORA_DEVICE_ID__ ?? "",
  };
}
