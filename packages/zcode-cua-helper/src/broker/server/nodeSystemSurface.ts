import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join as join4 } from "node:path";
import { createLinuxNodeSystemSurface } from "./linuxSystemSurface.js";
import { resolveApplicationBundleId } from "./macosApplicationResolver.js";
import { MACOS_SYSTEM_COMMANDS } from "./macosSystemCommands.js";
import { createWindowsNodeSystemSurface } from "./windowsSystemSurface.js";

export var SCREEN_CAPTURE_TIMEOUT_MS = 5e3;
var defaultScreenCaptureCommand = (args, options, callback) => {
  execFile(MACOS_SYSTEM_COMMANDS.screencapture, args, options, (error51) => callback(error51));
};
export function createNodeSystemSurface(options: any = {}) {
  const platform2: any = options.platform ?? process.platform;
  if (platform2 === "linux") {
    return createLinuxNodeSystemSurface(options);
  }
  if (platform2 === "win32") {
    return createWindowsNodeSystemSurface(options);
  }
  const captureCommand: any = options.captureCommand ?? defaultScreenCaptureCommand;
  const captureTimeoutMs: any =
    typeof options.captureTimeoutMs === "number" &&
    Number.isFinite(options.captureTimeoutMs) &&
    options.captureTimeoutMs > 0
      ? options.captureTimeoutMs
      : SCREEN_CAPTURE_TIMEOUT_MS;
  const capturePng = (captureArgsFor, timeoutOverrideMs?) =>
    new Promise((resolve2) => {
      let settled = false;
      let dir = null;
      try {
        dir = mkdtempSync(join4(tmpdir(), "zcode-cua-cap-"));
      } catch {
        resolve2(null);
        return;
      }
      const out = join4(dir, "screen.png");
      const cleanup = () => {
        if (!dir) return;
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve2(value);
      };
      let captureArgs;
      try {
        captureArgs = captureArgsFor(out);
      } catch {
        finish(null);
        return;
      }
      try {
        const timeout =
          typeof timeoutOverrideMs === "number" &&
          Number.isFinite(timeoutOverrideMs) &&
          timeoutOverrideMs > 0
            ? Math.min(captureTimeoutMs, Math.max(1, Math.floor(timeoutOverrideMs)))
            : captureTimeoutMs;
        captureCommand(captureArgs, { timeout, killSignal: "SIGKILL" }, (err) => {
          if (err) {
            finish(null);
            return;
          }
          try {
            const bytes = readFileSync(out);
            finish(bytes.length > 0 ? new Uint8Array(bytes) : null);
          } catch {
            finish(null);
          }
        });
      } catch {
        finish(null);
      }
    });
  return {
    // -x 静音抓屏；-R 使用选中 CG display 的稳定全局 bounds，避免把两个 API 的 display
    // ordinal 混用。Screen Recording 归属就是本 helper 进程的签名身份。
    captureScreenPng: (area) => capturePng((out) => buildScreenCaptureArgs(out, area)),
    captureWindowPng: (windowId, timeoutMs) =>
      capturePng((out) => buildWindowCaptureArgs(out, windowId), timeoutMs),
    readClipboardText: () => {
      try {
        return execFileSync(MACOS_SYSTEM_COMMANDS.pbpaste, [], {
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch {
        return "";
      }
    },
    writeClipboardText: (text) => {
      execFileSync(MACOS_SYSTEM_COMMANDS.pbcopy, [], { input: text });
    },
    resolveApplicationBundleId: (name) =>
      resolveApplicationBundleId(name, options.applicationBundleIdLookup),
    openApplication: async (params) => {
      await new Promise<void>((resolve2, reject) => {
        const args = buildOpenArgs(params);
        if (!args) {
          reject(new Error("openApplication requires bundleId or name"));
          return;
        }
        execFile(MACOS_SYSTEM_COMMANDS.open, args, (err) => (err ? reject(err) : resolve2()));
      });
      return resolveOpenedProcessHint(params);
    },
  };
}
function buildScreenCaptureArgs(out, area) {
  const displayArgs = area ? [`-R${screenCaptureRect(area)}`] : [];
  return ["-x", "-t", "png", ...displayArgs, out];
}
function buildWindowCaptureArgs(out, windowId) {
  if (!Number.isSafeInteger(windowId) || windowId <= 0) {
    throw new Error("screen capture window id must be a positive safe integer");
  }
  return ["-x", "-o", "-t", "png", `-l${windowId}`, out];
}
function screenCaptureRect(area) {
  const values = [area.x, area.y, area.width, area.height];
  const rounded = values.map((value) => Math.round(value));
  if (values.some((value) => !Number.isFinite(value)) || rounded[2] <= 0 || rounded[3] <= 0) {
    throw new Error("screen capture area must contain finite coordinates and positive dimensions");
  }
  return rounded.join(",");
}
function buildOpenArgs(params) {
  const args = [];
  if (params.newInstance) args.push("-n");
  if (!params.activate) args.push("-g");
  if (params.bundleId) {
    args.push("-b", params.bundleId);
  } else if (params.name) {
    args.push("-a", params.name);
  } else {
    return null;
  }
  for (const url2 of params.urls ?? []) args.push(url2);
  if (params.newInstance) {
    args.push("--args", "-ApplePersistenceIgnoreState", "YES");
  }
  return args;
}
var DEFAULT_PROCESS_HINT_COMMANDS = {
  pidForProcessName,
  appInfoForBundleId,
};
async function resolveOpenedProcessHint(params, commands = DEFAULT_PROCESS_HINT_COMMANDS) {
  if (params.newInstance) return void 0;
  if (params.bundleId) {
    const app = await commands.appInfoForBundleId(params.bundleId);
    const pid = app ? await commands.pidForProcessName(app.executableName) : void 0;
    if (pid) {
      return {
        pid,
        name: params.name ?? app?.displayName ?? app?.executableName,
        bundleId: params.bundleId,
        active: false,
      };
    }
    return void 0;
  }
  const name: any = params.name;
  if (name) {
    const pid = await commands.pidForProcessName(name);
    if (pid) return { pid, name, bundleId: null, active: false };
  }
  return void 0;
}
async function pidForProcessName(name) {
  return new Promise((resolve2) => {
    execFile(
      MACOS_SYSTEM_COMMANDS.pgrep,
      ["-x", name],
      { encoding: "utf8", maxBuffer: 1024, timeout: 1e3 },
      (_err, stdout) => {
        const pid = String(stdout)
          .split(/\s+/)
          .map((part) => Number.parseInt(part, 10))
          .find((value) => Number.isInteger(value) && value > 0);
        resolve2(pid);
      },
    );
  });
}
async function appInfoForBundleId(bundleId) {
  const query = `kMDItemCFBundleIdentifier == "${bundleId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const paths: any = await execFileText3(MACOS_SYSTEM_COMMANDS.mdfind, [query], 1500);
  const appPath = paths
    ?.split(/\n/)
    .map((line) => line.trim())
    .find((line) => line.endsWith(".app"));
  if (!appPath) return void 0;
  const plist = join4(appPath, "Contents", "Info.plist");
  const executableName: any = await execFileText3(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleExecutable", plist],
    1e3,
  );
  if (!executableName?.trim()) return void 0;
  const displayName: any = await execFileText3(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleName", plist],
    1e3,
  );
  return {
    executableName: executableName.trim(),
    displayName: displayName?.trim() || basename(appPath, ".app"),
  };
}
async function execFileText3(command, args, timeout) {
  return new Promise((resolve2) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 16 * 1024, timeout }, (err, stdout) => {
      resolve2(err ? void 0 : stdout);
    });
  });
}
