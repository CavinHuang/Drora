import { mkdirSync, readFileSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gitBashPathToWindowsPath,
  type ExecutionCommand,
  type ExecutionRequest,
  type ExecutionShellDialect,
  windowsPathToGitBashPath,
} from "@drora/contracts";

export interface CwdCapturePlan {
  command: ExecutionCommand;
  cwdFilePath?: string;
}

export function createCwdCapturePlan(
  request: ExecutionRequest,
  options: {
    dialect: ExecutionShellDialect;
    platform: NodeJS.Platform;
  },
): CwdCapturePlan {
  if (request.captureCwdAfterSuccess !== true || request.command.mode !== "shell") {
    return { command: request.command };
  }

  const cwdCaptureDir = tmpdir();
  mkdirSync(cwdCaptureDir, { recursive: true });
  const cwdFilePath = join(cwdCaptureDir, `drora-${crypto.randomUUID()}-cwd`);

  // 每次 Bash 仍启动新 shell；成功后只把最终 pwd -P 写回主进程，不能持久化 env/alias/function。
  // 默认 shell、hooks、background command 不走这个分支，避免改变其它执行面。
  const wrappedCommand =
    options.dialect === "cmd"
      ? createWindowsCmdCwdCaptureCommand(request.command.command, cwdFilePath)
      : createPosixCwdCaptureCommand(
          request.command.command,
          options.dialect === "git-bash" ? windowsPathToGitBashPath(cwdFilePath) : cwdFilePath,
        );

  return {
    command: {
      ...request.command,
      command: wrappedCommand,
    },
    cwdFilePath,
  };
}

function createPosixCwdCaptureCommand(command: string, cwdFilePath: string): string {
  return [
    command,
    "__drora_status=$?",
    `if [ "$__drora_status" -eq 0 ]; then pwd -P > ${shellQuote(cwdFilePath)}; fi`,
    'exit "$__drora_status"',
  ].join("\n");
}

function createWindowsCmdCwdCaptureCommand(command: string, cwdFilePath: string): string {
  // Windows 修复：Node 的 spawn(shell) 把整段命令交给 `cmd.exe /d /s /c "..."`，
  // 多行（CRLF）脚本只有第一行会执行，后续行被静默丢弃——命令成功也写不出 cwd
  // 文件，resolvedCwd 恒为 undefined。改为单行 `&` 串联；退出码不能用
  // %ERRORLEVEL%（同一行在解析期展开，拿到的是命令执行前的旧值），必须先
  // `setlocal EnableDelayedExpansion` 再用 !ERRORLEVEL!。本机 Node 24 + cmd 实测：
  // 失败命令原码透传（exit 3 → status 3），成功时 `cd > file` 落盘。
  return [
    "setlocal EnableDelayedExpansion",
    command,
    `(if not errorlevel 1 cd > ${cmdQuote(cwdFilePath)})`,
    "exit /b !ERRORLEVEL!",
  ].join(" & ");
}

export function readCapturedCwd(
  cwdFilePath: string | undefined,
  options: { dialect: ExecutionShellDialect },
): string | undefined {
  if (!cwdFilePath) return undefined;
  try {
    const value = readFileSync(cwdFilePath, "utf8").replace(/\r?\n$/u, "");
    if (!value) return undefined;
    const hostValue = normalizeCapturedCwdForHost(value, options.dialect);
    const stats = statSync(hostValue);
    if (!stats.isDirectory()) return undefined;
    return realpathSync(hostValue);
  } catch {
    return undefined;
  } finally {
    try {
      unlinkSync(cwdFilePath);
    } catch {
      // cwd 捕获只影响内部会话状态，清理失败不能影响工具结果。
    }
  }
}

export function normalizeCapturedCwdForHost(
  value: string,
  dialect: ExecutionShellDialect,
): string {
  return dialect === "git-bash" ? gitBashPathToWindowsPath(value) : value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cmdQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
