import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join3 } from "node:path";
import { SCREEN_CAPTURE_TIMEOUT_MS } from "./nodeSystemSurface.js";

var LINUX_SCREENSHOT_BINARIES = {
  gnomeScreenshot: "gnome-screenshot",
  scrot: "scrot",
  /** ImageMagick `import`. Honors `-window root` (full X screen) and `-window <id>` (one X window). */
  imagemagickImport: "import",
  /**
   * Python 3 + Pillow (`PIL.ImageGrab`). Preferred backend on GNOME/X11 setups where
   * gnome-screenshot hangs (it delegates to org.gnome.Shell.Screenshot D-Bus, which is
   * unreliable under SSH / headless / locked-screen — LAV18/LAV21 turn exhaustion).
   * ImageGrab uses XCB/Xlib GET_IMAGE directly: no D-Bus round-trip, supports a bbox
   * crop, and PIL ships in the distro python3-pil / pyenv stacks already used by the
   * act-verify harness. Probed for BOTH `python3` on PATH AND `import PIL` succeeding.
   */
  pythonPil: "python3",
};
var LINUX_CLIPBOARD_BINARIES = {
  xclip: "xclip",
  xsel: "xsel",
  wlCopy: "wl-copy",
  wlPaste: "wl-paste",
};
var LINUX_LAUNCH_BINARIES = {
  gtkLaunch: "gtk-launch",
  xdgOpen: "xdg-open",
};
var CLIPBOARD_MAX_BUFFER = 16 * 1024 * 1024;
var OPEN_APPLICATION_TIMEOUT_MS = 5e3;
var BINARY_PROBE_TIMEOUT_MS = 1e3;
function detectLinuxSessionType(env = process.env) {
  const raw = (env.XDG_SESSION_TYPE ?? "").trim().toLowerCase();
  if (raw === "wayland") return "wayland";
  if (raw === "x11" || raw === "x") return "x11";
  return null;
}
var binaryAvailabilityCache = /* @__PURE__ */ new Map();
var SAFE_BINARY_NAME = /^[A-Za-z0-9._-]{1,64}$/;
function isSafeBinaryName(name) {
  return SAFE_BINARY_NAME.test(name);
}
function isLinuxBinaryAvailable(name, probe) {
  if (probe) return probe(name);
  const cached2 = binaryAvailabilityCache.get(name);
  if (cached2 !== void 0) return cached2;
  let available = false;
  if (isSafeBinaryName(name)) {
    try {
      const stdout = execFileSync("sh", ["-c", `command -v ${name}`], {
        encoding: "utf8",
        timeout: BINARY_PROBE_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
      });
      available = stdout.trim().length > 0;
    } catch {
      available = false;
    }
  }
  binaryAvailabilityCache.set(name, available);
  return available;
}
function isPythonPilAvailable(probe) {
  if (probe) return probe(LINUX_SCREENSHOT_BINARIES.pythonPil);
  const cacheKey = "__python_pil__";
  const cached2 = binaryAvailabilityCache.get(cacheKey);
  if (cached2 !== void 0) return cached2;
  let available = false;
  try {
    execFileSync(LINUX_SCREENSHOT_BINARIES.pythonPil, ["-c", "from PIL import ImageGrab"], {
      encoding: "utf8",
      timeout: BINARY_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "ignore", "ignore"],
    });
    available = true;
  } catch {
    available = false;
  }
  binaryAvailabilityCache.set(cacheKey, available);
  return available;
}
function resolveLinuxScreenshotBinary(variant, probe) {
  if (variant === "window") {
    return isLinuxBinaryAvailable(LINUX_SCREENSHOT_BINARIES.imagemagickImport, probe)
      ? LINUX_SCREENSHOT_BINARIES.imagemagickImport
      : null;
  }
  if (isPythonPilAvailable(probe)) {
    return LINUX_SCREENSHOT_BINARIES.pythonPil;
  }
  for (const name of [
    LINUX_SCREENSHOT_BINARIES.gnomeScreenshot,
    LINUX_SCREENSHOT_BINARIES.scrot,
    LINUX_SCREENSHOT_BINARIES.imagemagickImport,
  ]) {
    if (isLinuxBinaryAvailable(name, probe)) return name;
  }
  return null;
}
function buildLinuxScreenCaptureArgs(out, binary, area) {
  switch (binary) {
    case LINUX_SCREENSHOT_BINARIES.pythonPil: {
      const callArgs = area
        ? `bbox=(${Math.round(area.x)},${Math.round(area.y)},${Math.round(area.x + area.width)},${Math.round(area.y + area.height)})`
        : "";
      const script = `from PIL import ImageGrab; ImageGrab.grab(${callArgs}).save(${JSON.stringify(out)})`;
      return ["-c", script];
    }
    case LINUX_SCREENSHOT_BINARIES.gnomeScreenshot:
      return ["-f", out];
    case LINUX_SCREENSHOT_BINARIES.scrot: {
      const areaArgs = area ? ["-a", linuxRectArea(area)] : [];
      return [...areaArgs, "-o", out];
    }
    case LINUX_SCREENSHOT_BINARIES.imagemagickImport:
      return ["-window", "root", out];
    default:
      return [out];
  }
}
function buildLinuxWindowCaptureArgs(out, binary, windowId) {
  if (!Number.isSafeInteger(windowId) || windowId <= 0) {
    throw new Error("screen capture window id must be a positive safe integer");
  }
  if (binary === LINUX_SCREENSHOT_BINARIES.imagemagickImport) {
    return ["-window", String(windowId), out];
  }
  return [out];
}
function linuxRectArea(area) {
  const values = [area.x, area.y, area.width, area.height];
  const rounded = values.map((value) => Math.round(value));
  if (values.some((value) => !Number.isFinite(value)) || rounded[2] <= 0 || rounded[3] <= 0) {
    throw new Error("screen capture area must contain finite coordinates and positive dimensions");
  }
  return rounded.join(",");
}
function buildLinuxClipboardReadCommand(sessionType = detectLinuxSessionType(), probe) {
  if (
    sessionType === "wayland" &&
    isLinuxBinaryAvailable(LINUX_CLIPBOARD_BINARIES.wlPaste, probe)
  ) {
    return { command: LINUX_CLIPBOARD_BINARIES.wlPaste, args: ["--no-newline"] };
  }
  if (isLinuxBinaryAvailable(LINUX_CLIPBOARD_BINARIES.xclip, probe)) {
    return {
      command: LINUX_CLIPBOARD_BINARIES.xclip,
      args: ["-selection", "clipboard", "-o"],
    };
  }
  if (isLinuxBinaryAvailable(LINUX_CLIPBOARD_BINARIES.xsel, probe)) {
    return { command: LINUX_CLIPBOARD_BINARIES.xsel, args: ["--clipboard", "--output"] };
  }
  if (isLinuxBinaryAvailable(LINUX_CLIPBOARD_BINARIES.wlPaste, probe)) {
    return { command: LINUX_CLIPBOARD_BINARIES.wlPaste, args: ["--no-newline"] };
  }
  return null;
}
function buildLinuxClipboardWriteCommand(sessionType = detectLinuxSessionType(), probe) {
  if (sessionType === "wayland" && isLinuxBinaryAvailable(LINUX_CLIPBOARD_BINARIES.wlCopy, probe)) {
    return { command: LINUX_CLIPBOARD_BINARIES.wlCopy, args: [] };
  }
  if (isLinuxBinaryAvailable(LINUX_CLIPBOARD_BINARIES.xclip, probe)) {
    return {
      command: LINUX_CLIPBOARD_BINARIES.xclip,
      args: ["-selection", "clipboard"],
    };
  }
  if (isLinuxBinaryAvailable(LINUX_CLIPBOARD_BINARIES.xsel, probe)) {
    return { command: LINUX_CLIPBOARD_BINARIES.xsel, args: ["--clipboard", "--input"] };
  }
  if (isLinuxBinaryAvailable(LINUX_CLIPBOARD_BINARIES.wlCopy, probe)) {
    return { command: LINUX_CLIPBOARD_BINARIES.wlCopy, args: [] };
  }
  return null;
}
function buildLinuxOpenInvocations(params) {
  const urls = params.urls ?? [];
  const invocations = [];
  if (params.name) {
    invocations.push({
      command: LINUX_LAUNCH_BINARIES.gtkLaunch,
      args: [params.name, ...urls],
    });
  } else if (urls.length > 0 && !params.bundleId) {
    invocations.push({ command: LINUX_LAUNCH_BINARIES.xdgOpen, args: [...urls] });
  } else if (params.bundleId) {
    invocations.push({
      command: LINUX_LAUNCH_BINARIES.gtkLaunch,
      args: [params.bundleId, ...urls],
    });
  }
  if (params.name) {
    invocations.push({ command: params.name, args: [...urls] });
  }
  return invocations;
}
function execBinaryCaptureCommand(binary) {
  return (args, options, callback) => {
    execFile(binary, args, options, (error51) => callback(error51));
  };
}
function captureLinuxPng(captureArgsFor, captureCommand, captureTimeoutMs, timeoutOverrideMs?) {
  return new Promise((resolve2) => {
    let settled = false;
    let dir = null;
    try {
      dir = mkdtempSync(join3(tmpdir(), "zcode-cua-cap-"));
    } catch {
      resolve2(null);
      return;
    }
    const out = join3(dir, "screen.png");
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
}
async function defaultLinuxOpenRunner(invocation) {
  return new Promise((resolve2) => {
    execFile(
      invocation.command,
      invocation.args,
      {
        timeout: OPEN_APPLICATION_TIMEOUT_MS,
      },
      (error51) => resolve2(!error51),
    );
  });
}
export function createLinuxNodeSystemSurface(options: any = {}) {
  const probe: any = options.linuxBinaryProbe;
  const sessionType: any = options.linuxSessionType ?? detectLinuxSessionType();
  const captureTimeoutMs: any =
    typeof options.captureTimeoutMs === "number" &&
    Number.isFinite(options.captureTimeoutMs) &&
    options.captureTimeoutMs > 0
      ? options.captureTimeoutMs
      : SCREEN_CAPTURE_TIMEOUT_MS;
  const injectedCaptureCommand: any = options.linuxCaptureCommand;
  const openRunner: any = options.linuxOpenRunner ?? defaultLinuxOpenRunner;
  return {
    captureScreenPng: (area) => {
      const binary = resolveLinuxScreenshotBinary("screen", probe);
      if (!binary) return Promise.resolve(null);
      const command = injectedCaptureCommand ?? execBinaryCaptureCommand(binary);
      return captureLinuxPng(
        (out) => buildLinuxScreenCaptureArgs(out, binary, area),
        command,
        captureTimeoutMs,
      );
    },
    captureWindowPng: (windowId, timeoutMs) => {
      const binary = resolveLinuxScreenshotBinary("window", probe);
      if (!binary) return Promise.resolve(null);
      const command = injectedCaptureCommand ?? execBinaryCaptureCommand(binary);
      return captureLinuxPng(
        (out) => buildLinuxWindowCaptureArgs(out, binary, windowId),
        command,
        captureTimeoutMs,
        timeoutMs,
      );
    },
    readClipboardText: () => {
      const cmd = buildLinuxClipboardReadCommand(sessionType, probe);
      if (!cmd) return "";
      try {
        return execFileSync(cmd.command, cmd.args, {
          encoding: "utf8",
          maxBuffer: CLIPBOARD_MAX_BUFFER,
        });
      } catch {
        return "";
      }
    },
    writeClipboardText: (text) => {
      const cmd = buildLinuxClipboardWriteCommand(sessionType, probe);
      if (!cmd) return;
      try {
        execFileSync(cmd.command, cmd.args, { input: text });
      } catch {}
    },
    openApplication: async (params) => {
      const invocations = buildLinuxOpenInvocations(params);
      if (invocations.length === 0) {
        throw new Error("openApplication requires bundleId or name");
      }
      for (const invocation of invocations) {
        if (await openRunner(invocation)) return;
      }
      throw new Error(
        `open_application failed: no launcher succeeded for ${params.name ?? params.bundleId ?? "urls"}`,
      );
    },
  };
}
