// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
import { execFile, execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DEV_HELPER_APP_NAME, HELPER_APP_NAME } from "../helperConstants.js";
import { isWindowsNamedPipePath } from "../socketPath.js";
import {
  recognizedCuaHelperInstallRoots,
  resolveCuaHelperInstallRoot,
  standaloneHelperCandidatePaths,
} from "./helperLauncher.js";
// helper 孤儿进程证据链与回收（ps 证据 + canonical 路径别名）。
import { MACOS_SYSTEM_COMMANDS } from "./macosSystemCommands.js";

export var CUA_HELPER_FULL_WIDTH_PS_ARGS = ["-awwxo", "pid=,ppid=,uid=,command="];
export function standaloneHelperExecutablePaths(env = process.env) {
  const executableName = HELPER_APP_NAME.replace(/\.app$/u, "");
  const current = standaloneHelperCandidatePaths(env);
  const recognized = recognizedCuaHelperInstallRoots(env).flatMap((root) => [
    join(root, HELPER_APP_NAME),
    join(root, DEV_HELPER_APP_NAME),
  ]);
  return [.../* @__PURE__ */ new Set([...current, ...recognized])].map((appPath) =>
    join(appPath, "Contents", "MacOS", executableName),
  );
}
export function helperExecutablePathForApp(appPath) {
  return join(appPath, "Contents", "MacOS", HELPER_APP_NAME.replace(/\.app$/u, ""));
}
export function extractFlagValue(command, flag) {
  const tokens = command.split(/\s+/u);
  const index = tokens.indexOf(flag);
  if (index < 0 || index + 1 >= tokens.length) return null;
  return tokens[index + 1] ?? null;
}
export function defaultIsProcessAlive3(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error51) {
    return error51.code === "EPERM";
  }
}
export function commandStartsWithExactExecutable(command, executablePath) {
  return command === executablePath || command.startsWith(`${executablePath} `);
}
export function commandMayStartWithHelperBundleExecutable(command) {
  if (!command.startsWith("/")) return false;
  const executableName = HELPER_APP_NAME.replace(/\.app$/u, "");
  const suffix = `/Contents/MacOS/${executableName}`;
  let offset = command.indexOf(suffix);
  while (offset > 0) {
    const end = offset + suffix.length;
    if (end === command.length || /\s/u.test(command[end])) return true;
    offset = command.indexOf(suffix, offset + 1);
  }
  return false;
}
export function commandHasExactFlagValue(command, flag, expectedValue) {
  const marker = ` ${flag} ${expectedValue}`;
  let offset = command.indexOf(marker);
  while (offset >= 0) {
    const end = offset + marker.length;
    if (end === command.length || /\s/u.test(command[end])) return true;
    offset = command.indexOf(marker, offset + 1);
  }
  return false;
}
export function parsePsProcessRows(output) {
  const rows = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const [, pidStr, ppidStr, uidStr, command] = match;
    if (pidStr === void 0 || ppidStr === void 0 || uidStr === void 0 || command === void 0) {
      continue;
    }
    rows.push({
      pid: Number(pidStr),
      ppid: Number(ppidStr),
      uid: Number(uidStr),
      command,
    });
  }
  return rows;
}
export function defaultListProcesses() {
  const output = execFileSync(MACOS_SYSTEM_COMMANDS.ps, [...CUA_HELPER_FULL_WIDTH_PS_ARGS], {
    encoding: "utf8",
  });
  return parsePsProcessRows(output);
}
export function addCanonicalPathAliases(paths, canonicalizePath) {
  const aliases = new Set(paths);
  for (const path of paths) {
    try {
      aliases.add(canonicalizePath(path));
    } catch {}
  }
  return [...aliases];
}
export function createDefaultHelperPidEvidenceProvider(options: any = {}) {
  const platform2 = options.platform ?? process.platform;
  const currentUid =
    options.currentUid ?? (typeof process.getuid === "function" ? process.getuid() : null);
  const listProcesses = options.listProcesses ?? defaultListProcesses;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive3;
  const canonicalizePath = options.canonicalizePath ?? realpathSync.native;
  const executablePaths = addCanonicalPathAliases(
    standaloneHelperExecutablePaths(options.env ?? process.env),
    canonicalizePath,
  );
  const logger = options.logger;
  return (helperPid, context) => {
    if (platform2 !== "darwin" || currentUid === null) {
      return {
        state: "helper",
        reason: "non-darwin / no uid; identity recheck unavailable",
      };
    }
    let rows;
    try {
      rows = listProcesses();
    } catch (error51) {
      logger?.warn(
        void 0,
        `cua helper kill-path: process listing failed for pid ${helperPid} (${messageOf(error51)}); skipping SIGTERM as a pid-reuse precaution`,
      );
      return { state: "unknown", reason: "process listing failed" };
    }
    const row = rows.find((candidate) => candidate.pid === helperPid);
    if (!row) {
      return isProcessAlive(helperPid)
        ? { state: "unknown", reason: "pid alive but absent from ps snapshot" }
        : { state: "dead", reason: "pid not alive" };
    }
    const expectedExecutablePaths = context?.helperAppPath
      ? addCanonicalPathAliases(
          [helperExecutablePathForApp(context.helperAppPath), ...executablePaths],
          canonicalizePath,
        )
      : executablePaths;
    const exactExecutable = expectedExecutablePaths.find((path) =>
      commandStartsWithExactExecutable(row.command, path),
    );
    if (
      exactExecutable &&
      (!context?.socketPath ||
        commandHasExactFlagValue(row.command, "--socket", context.socketPath))
    ) {
      return {
        state: "helper",
        reason: "ps command matches Helper executable path",
      };
    }
    if (exactExecutable && context?.socketPath) {
      const observedSocket = extractFlagValue(row.command, "--socket");
      if (
        observedSocket === null ||
        (context.socketPath.startsWith(observedSocket) &&
          row.command.trimEnd().endsWith(observedSocket))
      ) {
        return {
          state: "unknown",
          reason: "Helper argv is incomplete; exact random socket cannot be verified",
          command: row.command,
        };
      }
      return {
        state: "unrelated",
        reason: "pid now belongs to a Helper launched for a different random socket",
        command: row.command,
      };
    }
    if (
      context?.socketPath &&
      commandHasExactFlagValue(row.command, "--socket", context.socketPath) &&
      commandMayStartWithHelperBundleExecutable(row.command)
    ) {
      return {
        state: "unknown",
        reason:
          "Helper-shaped argv and exact random socket match, but canonical executable identity cannot be proven",
        command: row.command,
      };
    }
    const trimmedCommand = row.command.trimEnd();
    if (
      trimmedCommand.length > 0 &&
      expectedExecutablePaths.some((path: any) => path.startsWith(trimmedCommand))
    ) {
      return {
        state: "unknown",
        reason: "ps command may be a truncated Helper executable path",
        command: row.command,
      };
    }
    return {
      state: "unrelated",
      reason: context?.socketPath
        ? "pid no longer matches the Helper executable and random socket"
        : "pid reused by non-Helper process",
      command: row.command,
    };
  };
}
export function messageOf(error51) {
  return error51 instanceof Error ? error51.message : String(error51);
}
