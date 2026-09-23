import type { IPlatformService } from "@drora/shared";

type DesktopBrowserPlatformBridge = Pick<
  IPlatformService,
  | "onBrowserViewReady"
  | "onBrowserViewOperation"
  | "onBrowserViewViewportChanged"
  | "onBrowserViewVisibility"
  | "onBrowserViewCloseTab"
  | "onBrowserViewSuspend"
  | "onBrowserViewRestore"
  | "browserViewAttachGuest"
  | "browserViewDetachGuest"
  | "browserViewCloseTab"
  | "browserViewReportResidency"
  | "browserViewSuspendReady"
  | "browserViewEnsureResident"
  | "browserViewRestoreTabs"
  | "browserViewUpdateViewport"
  | "importChromeBrowserData"
  | "clearEmbeddedBrowserData"
  | "getPathForFile"
  | "saveFile"
  | "printPageToPdf"
>;

// Rebase 集成：browser bridge 若继续内联在 renderer 入口，会让入口越过 max-lines 门禁。
// 独立对象只做 preload 委托与旧 bridge 兼容兜底，不持有 Browser 业务状态。
export const desktopBrowserPlatformBridge = {
  getPathForFile: (file) => window.drora.getPathForFile?.(file) ?? null,
  saveFile: (payload) =>
    window.drora.saveFile?.(payload) ?? Promise.resolve({ success: false, error: "not_supported" }),
  // 条件定义而非兜底返回失败：UI 靠方法是否存在做能力检测，旧 preload 下必须保持 undefined
  printPageToPdf: window.drora.printPageToPdf ? () => window.drora.printPageToPdf!() : undefined,
  onBrowserViewReady: (handler) => window.drora.onBrowserViewReady?.(handler) ?? (() => {}),
  onBrowserViewOperation: (handler) => window.drora.onBrowserViewOperation?.(handler) ?? (() => {}),
  onBrowserViewViewportChanged: (handler) =>
    window.drora.onBrowserViewViewportChanged?.(handler) ?? (() => {}),
  onBrowserViewVisibility: (handler) =>
    window.drora.onBrowserViewVisibility?.(handler) ?? (() => {}),
  onBrowserViewCloseTab: (handler) => window.drora.onBrowserViewCloseTab?.(handler) ?? (() => {}),
  onBrowserViewSuspend: (handler) => window.drora.onBrowserViewSuspend?.(handler) ?? (() => {}),
  onBrowserViewRestore: (handler) => window.drora.onBrowserViewRestore?.(handler) ?? (() => {}),
  browserViewAttachGuest: (payload) =>
    window.drora.browserViewAttachGuest?.(payload) ??
    Promise.resolve({ ok: false, reason: "not-found", recoveryRequested: false }),
  browserViewDetachGuest: (payload) =>
    window.drora.browserViewDetachGuest?.(payload) ?? Promise.resolve(false),
  browserViewCloseTab: (payload) =>
    window.drora.browserViewCloseTab?.(payload) ?? Promise.resolve(),
  browserViewReportResidency: (payload) =>
    window.drora.browserViewReportResidency?.(payload) ?? Promise.resolve(),
  browserViewSuspendReady: (payload) =>
    window.drora.browserViewSuspendReady?.(payload) ?? Promise.resolve(),
  browserViewEnsureResident: (payload) =>
    window.drora.browserViewEnsureResident?.(payload) ?? Promise.resolve(),
  browserViewRestoreTabs: (payload) =>
    window.drora.browserViewRestoreTabs?.(payload) ?? Promise.resolve([]),
  browserViewUpdateViewport: (payload) =>
    window.drora.browserViewUpdateViewport?.(payload) ?? Promise.resolve(),
  importChromeBrowserData: (options) =>
    window.drora.importChromeBrowserData?.(options) ??
    Promise.resolve({
      success: false,
      cookies: { imported: 0, skipped: 0, failed: 0 },
      localStorage: {
        originsImported: 0,
        entriesImported: 0,
        originsSkipped: 0,
        originsFailed: 0,
      },
      error: "unsupported",
    }),
  clearEmbeddedBrowserData: (mode) =>
    window.drora.clearEmbeddedBrowserData?.(mode) ??
    Promise.resolve({ success: false, error: "unsupported" }),
} satisfies DesktopBrowserPlatformBridge;
