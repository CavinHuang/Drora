import { realpathSync } from "node:fs";
import { platform as currentPlatform } from "node:process";
import type { ExecutionResult } from "@drora/contracts";
import {
  getToolPathApi,
  normalizeToolPathForComparison,
  type ToolPathApi,
  type ToolPathPlatform,
} from "../path-normalization.js";
import type { ToolRuntimeScope } from "../types.js";

export interface BashCwdPolicyInput {
  resolvedCwd: string | undefined;
  status: ExecutionResult["status"];
  exitCode: number | undefined;
  platform?: ToolPathPlatform;
  workspaceRoot: string;
  runtimeScope?: ToolRuntimeScope;
}

export interface BashCwdPolicyDecision {
  nextWorkingDirectory?: string;
  stderrSuffix?: string;
}

interface CwdBoundaryPair {
  resolvedCwd: string;
  workspaceRoot: string;
}

interface NormalizedCwdBoundary {
  pathApi: ToolPathApi;
  equivalentPairs: CwdBoundaryPair[];
}

export function decideBashCwdPolicy(input: BashCwdPolicyInput): BashCwdPolicyDecision {
  if (input.status !== "completed") return {};
  if (input.exitCode !== 0) return {};
  if (!input.resolvedCwd) return {};
  if ((input.runtimeScope ?? "main") !== "main") return {};

  const boundary = normalizeCwdBoundaryInput(input);
  // 修复原因：写回规范化后的物理路径时，symlink root、/private 别名或盘符大小写让同一目录
  // 换了写法，环境公告按字符串比较，报出假的目录变化并多跑一次仓库检查。
  // 规范化只用于判断边界；写回一律用 workspace root 的写法（加相对路径）。
  const containing = findContainingPair(boundary);
  if (containing) {
    const relativePath = boundary.pathApi.relative(
      containing.workspaceRoot,
      containing.resolvedCwd,
    );
    // 修复：写回必须沿用 workspace root 自身的分隔符写法（注释所述「root 的写法」）。
    // Windows 平台 api 的 join 会把 POSIX 风格的 root（"/repo"）改写成 "\repo\subdir"，
    // 令 cwd 写回形态随平台漂移；root 含反斜杠时才用平台 join，否则按正斜杠拼接。
    if (input.workspaceRoot.includes("\\")) {
      return {
        nextWorkingDirectory:
          relativePath === ""
            ? input.workspaceRoot
            : boundary.pathApi.join(input.workspaceRoot, relativePath),
      };
    }
    return {
      nextWorkingDirectory:
        relativePath === ""
          ? input.workspaceRoot
          : `${input.workspaceRoot}/${relativePath.split(boundary.pathApi.sep).join("/")}`,
    };
  }

  return {
    nextWorkingDirectory: input.workspaceRoot,
    stderrSuffix: `Shell cwd was reset to ${input.workspaceRoot}`,
  };
}

export function appendBashCwdStderrSuffix(stderr: string, suffix: string | undefined): string {
  if (!suffix) return stderr;
  const stderrWithoutTrailingNewlines = stderr.replace(/[\r\n]+$/, "");
  if (!stderrWithoutTrailingNewlines) return suffix;
  return `${stderrWithoutTrailingNewlines}\n${suffix}`;
}

function normalizeCwdBoundaryInput(input: BashCwdPolicyInput): NormalizedCwdBoundary {
  const platform = input.platform ?? currentPlatform;
  const pathApi = getToolPathApi(platform);
  const isWindows = platform === "win32";
  const resolvedCwd = normalizeCwdBoundary(input.resolvedCwd ?? "", isWindows);
  const workspaceRoot = normalizeCwdBoundary(input.workspaceRoot, isWindows);
  const equivalentPairs = [{ resolvedCwd, workspaceRoot }];
  // cwd 捕获使用 pwd -P/realpath 得到物理路径；session root 可能是 symlink。
  // 统一收集等价边界后再判断，避免把项目内物理路径误判成离开项目。
  const realResolvedCwd = realpathCwdBoundary(input.resolvedCwd ?? "", isWindows);
  const realWorkspaceRoot = realpathCwdBoundary(input.workspaceRoot, isWindows);

  if (realResolvedCwd && realWorkspaceRoot) {
    equivalentPairs.push({
      resolvedCwd: realResolvedCwd,
      workspaceRoot: realWorkspaceRoot,
    });
  }

  return { pathApi, equivalentPairs };
}

function findContainingPair(boundary: NormalizedCwdBoundary): CwdBoundaryPair | undefined {
  return boundary.equivalentPairs.find(({ resolvedCwd, workspaceRoot }) =>
    isInsideOrSamePath(resolvedCwd, workspaceRoot, boundary.pathApi),
  );
}

function isInsideOrSamePath(child: string, parent: string, pathApi: ToolPathApi): boolean {
  const relativePath = pathApi.relative(parent, child);
  return relativePath === "" || !isPathOutsideParent(relativePath, pathApi);
}

function isPathOutsideParent(relativePath: string, pathApi: ToolPathApi): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativePath)
  );
}

function normalizeCwdBoundary(value: string, isWindows: boolean): string {
  let normalized = normalizeToolPathForComparison(value, isWindows ? "win32" : "linux");
  if (!isWindows) {
    normalized = normalized
      .replace(/^\/private\/var\//, "/var/")
      .replace(/^\/private\/tmp(\/|$)/, "/tmp$1");
  }
  return normalized;
}

function realpathCwdBoundary(value: string, isWindows: boolean): string | undefined {
  try {
    return normalizeCwdBoundary(realpathSync.native(value), isWindows);
  } catch {
    return undefined;
  }
}
