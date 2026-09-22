// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
// helper broker launch guard（.launch-cancel 哨兵目录）安全性校验与取消判定。

import { isWindowsNamedPipePath, brokerRuntimeDir } from "../socketPath.js";

var HELPER_BROKER_LAUNCH_DEADLINE_ARG = "--broker-launch-deadline-epoch-ms";
var HELPER_BROKER_LAUNCH_CANCEL_FILE_ARG = "--broker-launch-cancel-file";
var LAUNCH_CANCEL_DIR_NAME = ".launch-cancel";
var LAUNCH_CANCEL_FILE_PATTERN =
  /^\.broker-launch-cancel-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.sentinel$/u;
export function flagIndexes(argv, flag) {
  const indexes = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) indexes.push(index);
  }
  return indexes;
}
export function guardAnchorDirectory(socketPath) {
  return isWindowsNamedPipePath(socketPath)
    ? brokerRuntimeDir(process.env)
    : dirname(resolve(socketPath));
}
export function hasAnchorableSocketPath(socketPath) {
  return isWindowsNamedPipePath(socketPath) || isAbsolute(socketPath);
}
export function canonicalGuardDirectoryForSocket(socketPath) {
  if (!hasAnchorableSocketPath(socketPath)) return null;
  try {
    return join(realpathSync(guardAnchorDirectory(socketPath)), LAUNCH_CANCEL_DIR_NAME);
  } catch {
    return null;
  }
}
export function isSafeCuaHelperBrokerLaunchGuard(socketPath, guard) {
  if (
    !Number.isSafeInteger(guard.deadlineEpochMs) ||
    guard.deadlineEpochMs <= 0 ||
    !isAbsolute(guard.cancelFilePath) ||
    !LAUNCH_CANCEL_FILE_PATTERN.test(basename(guard.cancelFilePath))
  ) {
    return false;
  }
  const expectedDirectory = canonicalGuardDirectoryForSocket(socketPath);
  if (!expectedDirectory) return false;
  try {
    return realpathSync(dirname(resolve(guard.cancelFilePath))) === expectedDirectory;
  } catch {
    return false;
  }
}
export function shouldCancelCuaHelperBrokerLaunch(argv, socketPath, options: any = {}) {
  const deadlineIndexes = flagIndexes(argv, HELPER_BROKER_LAUNCH_DEADLINE_ARG);
  const cancelIndexes = flagIndexes(argv, HELPER_BROKER_LAUNCH_CANCEL_FILE_ARG);
  if (deadlineIndexes.length === 0 && cancelIndexes.length === 0) return false;
  if (deadlineIndexes.length !== 1 || cancelIndexes.length !== 1) return true;
  const rawDeadline = argv[deadlineIndexes[0] + 1];
  const cancelFilePath = argv[cancelIndexes[0] + 1];
  const deadlineEpochMs = rawDeadline ? Number(rawDeadline) : Number.NaN;
  if (!cancelFilePath) return true;
  const guard = { cancelFilePath, deadlineEpochMs };
  if (!isSafeCuaHelperBrokerLaunchGuard(socketPath, guard)) return true;
  if ((options.now ?? Date.now()) >= deadlineEpochMs) return true;
  return (options.cancelFileExists ?? existsSync)(cancelFilePath);
}
