import { roleToKind2 } from "../../native/atspiRoleMap.js";
import { uiaControlTypeToKind } from "../../native/controlTypeToKind.js";
import { createAxLinuxReadOnlySource } from "../../native/linux.js";
import { createAxWinReadOnlySource } from "../../native/win.js";
import { createWindowsScreenCaptureBridge } from "../../native/windowsScreenCapture.js";
import { createNativeAxSource } from "./nativeAxSource.js";

export function selectPlatformAxSource(options) {
  const platform2 = options.platform ?? process.platform;
  if (platform2 === "darwin") {
    const axSource = createNativeAxSource(options.native, {
      ...(options.captureWindowPng ? { captureWindowPng: options.captureWindowPng } : {}),
      ...(options.resolveApplicationBundleId
        ? { resolveApplicationBundleId: options.resolveApplicationBundleId }
        : {}),
    });
    return { axSource };
  }
  if (platform2 === "linux") {
    return {
      axSource: createAxLinuxReadOnlySource(
        options.native,
        options.captureWindowRegionPng
          ? { captureWindowRegionPng: options.captureWindowRegionPng }
          : {},
      ),
      roleToKind: roleToKind2,
    };
  }
  if (platform2 === "win32") {
    const windowsNative = options.native;
    const screenCapture = createWindowsScreenCaptureBridge(windowsNative);
    return {
      axSource: createAxWinReadOnlySource(
        windowsNative,
        screenCapture.available
          ? {
              captureWindowPngVerified: (params) => screenCapture.captureWindow(params),
            }
          : {},
      ),
      roleToKind: uiaControlTypeToKind,
    };
  }
  throw new Error(
    `Unsupported platform for AX source: ${platform2} (expected darwin, linux, or win32).`,
  );
}
