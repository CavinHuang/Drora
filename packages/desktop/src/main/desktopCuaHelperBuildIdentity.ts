import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface BundledHelperBuildIdentity {
  embeddedBuildId?: string;
  version?: string;
}

// 上游语义：桌面发布构建把自己的 Helper 构建身份内嵌进安装期望，使
// "bundled .app 是什么 build" 与 "校验期望什么 build" 恒等（spec:
// specs/mac-cua-helper-app-alignment.md §六）。本模块是被打包 Helper 身份的
// 唯一读取点：创建 installer 时直接从同一 bundle 的 Info.plist 读出，不存在
// 漂移可能。读取失败/键缺失返回 undefined，调用方回退仓库 WC 钉扎（现状行为）。
// 独立于 electron 的纯 Node 单元，便于测试直接覆盖。
export function readBundledHelperBuildIdentity(
  bundledAppPath: string,
): BundledHelperBuildIdentity | undefined {
  const plistPath = join(bundledAppPath, "Contents", "Info.plist");
  if (!existsSync(plistPath)) return undefined;
  const readKey = (key: string): string | undefined => {
    try {
      const result = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", plistPath], {
        encoding: "utf8",
        timeout: 2000,
        maxBuffer: 64 * 1024,
      });
      const value = (result.stdout ?? "").trim();
      return result.status === 0 && value ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const embeddedBuildId = readKey("ZCodeCUAHelperBuildId");
  const version = readKey("CFBundleShortVersionString");
  if (!embeddedBuildId && !version) return undefined;
  return {
    ...(embeddedBuildId ? { embeddedBuildId } : {}),
    ...(version ? { version } : {}),
  };
}
