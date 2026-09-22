import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { CUA_HELPER_BUNDLE_IDS } from "../helperConstants.js";
import { BROKER_METHODS, notAuthorized } from "../types.js";

export function createBrokerInfo(options) {
  return {
    bundle_id: options.bundleId,
    display_name: options.displayName,
    permission_mode: "product",
    version: options.version,
    platform: process.platform,
    ...(options.authorizationSubject
      ? { authorization_subject: options.authorizationSubject }
      : {}),
  };
}
export function authorizationSubjectKind(brokerInfo) {
  return authorizationSubjectKindForBundleId(brokerInfo.bundle_id);
}
function authorizationSubjectKindForBundleId(bundleId) {
  if (CUA_HELPER_BUNDLE_IDS.has(bundleId)) return "zcode_helper";
  if (bundleId === "dev.zcode.app") return "zcode_app";
  return "unknown";
}
function canonicalAuthorizationSubjectPath(value, canonicalizePath = realpathSync.native) {
  const absolute = resolve(value);
  try {
    return resolve(canonicalizePath(absolute));
  } catch {
    return absolute;
  }
}
function isPathWithinDirectory(path, directory) {
  const rel = relative(directory, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function authorizationSubjectInstabilityWarnings(diagnostics, options: any = {}) {
  const expectedBundleId: any = options.expectedBundleId ?? "dev.zcode.app";
  const installedPrefix: any = options.installedAppPathPrefix ?? "/Applications/";
  if (!diagnostics) {
    return ["authorization_subject diagnostics unavailable; broker ownership cannot be attributed"];
  }
  const warnings = [];
  if (diagnostics.signature === "adhoc") {
    warnings.push("signature=adhoc (unsigned dev/dist build, not a Developer ID installed app)");
  }
  if (diagnostics.code_signing_identifier !== expectedBundleId) {
    warnings.push(
      `code_signing_identifier=${diagnostics.code_signing_identifier ?? "unknown"} (expected ${expectedBundleId})`,
    );
  }
  if (!diagnostics.team_identifier) {
    warnings.push("team_identifier missing (not Developer ID signed)");
  }
  const appPath = diagnostics.app_bundle_path;
  const canonicalizePath: any = options.canonicalizePath ?? realpathSync.native;
  const installedAppPath: any = options.installedAppPath?.trim();
  if (installedAppPath) {
    if (
      !appPath ||
      canonicalAuthorizationSubjectPath(appPath, canonicalizePath) !==
        canonicalAuthorizationSubjectPath(installedAppPath, canonicalizePath)
    ) {
      warnings.push(
        `app_bundle_path=${appPath ?? "unknown"} does not match expected installed path ${installedAppPath}`,
      );
    }
  } else {
    const underInstalledPrefix =
      appPath &&
      isPathWithinDirectory(
        canonicalAuthorizationSubjectPath(appPath, canonicalizePath),
        canonicalAuthorizationSubjectPath(installedPrefix, canonicalizePath),
      );
    if (!underInstalledPrefix) {
      warnings.push(
        `app_bundle_path=${appPath ?? "unknown"} is not under ${installedPrefix} (running from a non-installed location)`,
      );
    }
  }
  if (diagnostics.stable_identity === false) {
    warnings.push("stable_identity=false");
  }
  return warnings;
}
function nonEmpty2(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
function inferAppBundlePath(executablePath) {
  let current = resolve(executablePath);
  if (basename(current).endsWith(".app")) return current;
  current = dirname(current);
  while (current !== dirname(current)) {
    if (basename(current).endsWith(".app")) return current;
    current = dirname(current);
  }
  return null;
}
function lineValue(output, key) {
  const match = new RegExp(`^${key}=(.+)$`, "m").exec(output);
  return nonEmpty2(match?.[1]);
}
function inspectCodeSigning(targetPath, platform2) {
  if (platform2 !== "darwin") {
    return {
      codeSigningIdentifier: null,
      teamIdentifier: null,
      signature: null,
      warnings: [`codesign unavailable on ${platform2}`],
    };
  }
  if (!targetPath) {
    return {
      codeSigningIdentifier: null,
      teamIdentifier: null,
      signature: null,
      warnings: ["codesign target path unavailable"],
    };
  }
  const result = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", targetPath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 1500,
  });
  const output = `${String(result.stdout ?? "")}
${String(result.stderr ?? "")}`;
  const warnings = [];
  if (result.error) {
    warnings.push(`codesign failed: ${result.error.message}`);
  } else if (result.status !== 0) {
    warnings.push(`codesign exited ${result.status ?? "unknown"}`);
  }
  if (!output.trim()) {
    warnings.push("codesign produced no diagnostics");
  }
  const authorities = [...output.matchAll(/^Authority=(.+)$/gm)]
    .map((match) => nonEmpty2(match[1]))
    .filter((authority) => authority !== null);
  const rawSignature = lineValue(output, "Signature");
  const signature =
    rawSignature?.toLowerCase() === "adhoc" || /flags=.*adhoc/.test(output)
      ? "adhoc"
      : authorities[0]
        ? `signed:${authorities[0]}`
        : rawSignature;
  return {
    codeSigningIdentifier: lineValue(output, "Identifier"),
    teamIdentifier: lineValue(output, "TeamIdentifier"),
    signature,
    warnings,
  };
}
export function createRuntimeAuthorizationSubjectDiagnostics(options) {
  const platform2 = options.platform ?? process.platform;
  const executablePath = nonEmpty2(options.executablePath) ?? process.execPath;
  const appBundlePath =
    options.appBundlePath === void 0 ? inferAppBundlePath(executablePath) : options.appBundlePath;
  // 与原版一致：非 darwin 平台 inspectCodeSigning 返回 "codesign unavailable on <platform>"
  // 警告且 stable_identity 只能为 false，不静默美化诊断输出。
  const signing = (options.codeSigningDiagnostics ?? inspectCodeSigning)(
    appBundlePath ?? executablePath,
    platform2,
  );
  const expectedBundleId = options.expectedBundleId ?? options.bundleId;
  const stableIdentity = Boolean(
    platform2 === "darwin" &&
      appBundlePath &&
      signing.codeSigningIdentifier === expectedBundleId &&
      signing.teamIdentifier &&
      signing.signature &&
      signing.signature !== "adhoc",
  );
  const diagnostics = {
    kind: authorizationSubjectKindForBundleId(options.bundleId),
    executable_path: executablePath,
    app_bundle_path: appBundlePath,
    bundle_id: options.bundleId,
    display_name: options.displayName,
    version: options.version,
    pid: options.pid ?? process.pid,
    code_signing_identifier: signing.codeSigningIdentifier,
    team_identifier: signing.teamIdentifier,
    signature: signing.signature,
    stable_identity: stableIdentity,
    warnings: [],
  };
  diagnostics.warnings = [
    ...signing.warnings,
    ...authorizationSubjectInstabilityWarnings(diagnostics, {
      expectedBundleId,
      installedAppPathPrefix: options.installedAppPathPrefix,
      installedAppPath: options.installedAppPath,
      canonicalizePath: options.canonicalizePath,
    }),
  ];
  return diagnostics;
}
function capabilityList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
function diagnosticAuthorizationSubject(brokerInfo) {
  const diagnostics = brokerInfo.authorization_subject;
  return {
    kind: diagnostics?.kind ?? authorizationSubjectKind(brokerInfo),
    bundle_id: diagnostics?.bundle_id ?? brokerInfo.bundle_id,
    display_name: diagnostics?.display_name ?? brokerInfo.display_name,
    version: diagnostics?.version ?? brokerInfo.version,
    ...(diagnostics?.pid !== void 0 ? { pid: diagnostics.pid } : {}),
    ...(diagnostics?.app_bundle_path !== void 0
      ? { app_bundle_path: diagnostics.app_bundle_path }
      : {}),
    ...(diagnostics?.code_signing_identifier !== void 0
      ? { code_signing_identifier: diagnostics.code_signing_identifier }
      : {}),
    ...(diagnostics?.team_identifier !== void 0
      ? { team_identifier: diagnostics.team_identifier }
      : {}),
    ...(diagnostics?.signature !== void 0 ? { signature: diagnostics.signature } : {}),
    stable_identity: diagnostics?.stable_identity ?? true,
    warnings: diagnostics?.warnings ?? [],
    ...(diagnostics ? { diagnostics } : {}),
  };
}
function diagnosticHandlers(options) {
  return {
    request_access: (params) => ({
      grant_owner: options.brokerInfo.bundle_id,
      owner: diagnosticAuthorizationSubject(options.brokerInfo),
      requested_capabilities: capabilityList(params.capabilities),
      accessibility: {
        prompted: false,
        status_after: "unknown",
        action_required: "native_backend_unavailable",
      },
      screen_recording: {
        warmup_attempted: false,
        status_after: "unknown",
        action_required: "native_backend_unavailable",
      },
      note: "ZCode permission broker is reachable, but this build has no native automation backend to request OS permissions.",
    }),
    input_permission_status: () => "unknown",
    screen_capture_status: () => "unknown",
    // 没有 native 层时 screen-capture 探针必须如实回报"抓不到像素"，而不是抛 not_authorized——
    // 它是只读诊断，readiness 组装靠 ok=false 判未就绪即可（与 screen_capture_status 同待遇）。
    screen_capture_probe: () => ({
      ok: false,
      status: "unknown",
      probed: false,
      byte_length: 0,
      error: "native_backend_unavailable",
      evidence: "none",
      probe_pid: process.pid,
      target_window_id: null,
      target_owner_pid: null,
      target_on_screen: null,
      target_bounds: null,
      png_width: null,
      png_height: null,
    }),
    supports_accessibility: () => false,
  };
}
export function createUnavailableNativeBackend(options) {
  const reason =
    options.reason ??
    "ZCode CUA native automation backend is not installed in this build; screen/accessibility/input actions require a signed ZCode helper.";
  const backend = {};
  for (const method of BROKER_METHODS) {
    if (method === "broker_info") {
      backend[method] = () => options.brokerInfo;
      continue;
    }
    const diagnostic = diagnosticHandlers(options)[method];
    backend[method] =
      diagnostic ??
      (() => {
        throw notAuthorized(`${method}: ${reason}`);
      });
  }
  return backend;
}
