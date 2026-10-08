import { spawn } from "node:child_process";
import { notAuthorized } from "../types.js";

var WINDOWS_OPEN_APPLICATION_IDENTITY_ERROR =
  "openApplication requires an explicit application name on Windows";
var WINDOWS_AUMID_ACTIVATOR_ERROR =
  "openApplication requires the native AUMID activator for Windows packaged apps";
var WINDOWS_AUMID_URL_ERROR =
  "openApplication cannot open URL(s) with a Windows AUMID in this build";
var WINDOWS_CALCULATOR_AUMID = "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App";
var WINDOWS_PACKAGED_APP_ALIASES = /* @__PURE__ */ new Map([
  ["calculator", WINDOWS_CALCULATOR_AUMID],
  ["windows calculator", WINDOWS_CALCULATOR_AUMID],
  ["calc", WINDOWS_CALCULATOR_AUMID],
  ["calc.exe", WINDOWS_CALCULATOR_AUMID],
  ["计算器", WINDOWS_CALCULATOR_AUMID],
]);
function failedWindowsOpenApplicationError(name) {
  return new Error(`open_application failed: could not launch "${name}"`);
}
function isWindowsAppUserModelId(value) {
  const trimmed = value?.trim();
  return Boolean(
    trimmed && trimmed.length <= 512 && /^[A-Za-z0-9._-]+![A-Za-z0-9._-]+$/u.test(trimmed),
  );
}
function resolveWindowsPackagedAppAlias(value) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return void 0;
  return WINDOWS_PACKAGED_APP_ALIASES.get(normalized);
}
async function defaultWindowsOpenRunner(argv) {
  const [command, ...args] = argv;
  if (!command) return void 0;
  return new Promise((resolve2, reject) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        shell: false,
        stdio: "ignore",
        // 根因：windowsHide 会把现代 Notepad 的首个 GUI 窗口一并以 SW_HIDE
        // 启动，进程虽成功但 UIA 永远看不到窗口；这里没有控制台需要隐藏。
        windowsHide: false,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve2(child.pid);
      });
    } catch (error51) {
      reject(error51);
    }
  });
}
export function createWindowsNodeSystemSurface(options: any = {}) {
  const openRunner = options.openRunner ?? defaultWindowsOpenRunner;
  const activateApplicationByAumid = options.activateApplicationByAumid;
  return {
    supportsScreenCapture: false,
    supportsClipboard: false,
    captureScreenPng: async () => null,
    captureWindowPng: async () => null,
    readClipboardText: () => {
      throw notAuthorized(
        "read_clipboard is unavailable on Windows until the native clipboard adapter is installed.",
      );
    },
    writeClipboardText: () => {
      throw notAuthorized(
        "write_clipboard is unavailable on Windows until the native clipboard adapter is installed.",
      );
    },
    openApplication: async (params: any) => {
      const bundleId = params.bundleId?.trim();
      if (isWindowsAppUserModelId(bundleId)) {
        if (params.urls && params.urls.length > 0) {
          throw new Error(WINDOWS_AUMID_URL_ERROR);
        }
        if (!activateApplicationByAumid) {
          throw new Error(WINDOWS_AUMID_ACTIVATOR_ERROR);
        }
        try {
          const pid = await activateApplicationByAumid(bundleId);
          if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
            throw failedWindowsOpenApplicationError(bundleId);
          }
          return {
            pid,
            name: bundleId,
            bundleId,
            active: false,
          };
        } catch {
          throw failedWindowsOpenApplicationError(bundleId);
        }
      }
      const name = params.name?.trim();
      if (!name) throw new Error(WINDOWS_OPEN_APPLICATION_IDENTITY_ERROR);
      try {
        const pid = await openRunner([name, ...(params.urls ?? [])]);
        if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
          throw failedWindowsOpenApplicationError(name);
        }
        return { pid, name, bundleId: null, active: false };
      } catch {
        throw failedWindowsOpenApplicationError(name);
      }
    },
  };
}
