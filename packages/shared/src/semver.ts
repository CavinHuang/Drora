// 语义化版本比较工具。
//
// 来源说明：v3.17.1 上游将 compareSemverVersions 及其解析辅助放在 shared 的
// forceUpdate.ts 中；Drora 按 specs/force-update-gate-removal.md 删除了该文件
// （移除的是"远端强制升级门控"，不含通用版本比较能力）。上游 v3.17.1 新增的
// data-sync（packages/ui/src/data-sync/domain/compare.ts）与 source-server
// 生命周期最低版本判断（SOURCE_SERVER_LIFECYCLE_CONTROL_MIN_VERSION 消费方）
// 都需要该纯函数，因此把 semver 部分原样迁到本独立模块（实现逐行取自上游
// forceUpdate.ts，未经改动），与已删除的强更门控彻底解耦。

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(version: string): ParsedSemver | null {
  const normalized = version.trim().replace(/^v/i, "");

  // 远端配置可能只传主版本号（如 "45"）或主次版本号（如 "4.5"），
  // 严格 semver（X.Y.Z）解析会返回 null，导致 resolveForceUpdateRequirement
  // 永远不触发。这里依次尝试标准版本和补齐版本，兼容服务端简写格式。
  const strictMatch = normalized.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (strictMatch) {
    return {
      major: Number(strictMatch[1]!),
      minor: Number(strictMatch[2]!),
      patch: Number(strictMatch[3]!),
      prerelease: strictMatch[4]?.split(".") ?? [],
    };
  }

  // 补全：只有主版本号（"45" → "45.0.0"）
  const majorOnly = normalized.match(/^(\d+)$/);
  if (majorOnly) {
    return {
      major: Number(majorOnly[1]!),
      minor: 0,
      patch: 0,
      prerelease: [],
    };
  }

  // 补全：主版本号.次版本号（"4.5" → "4.5.0"）
  const majorMinor = normalized.match(/^(\d+)\.(\d+)$/);
  if (majorMinor) {
    return {
      major: Number(majorMinor[1]!),
      minor: Number(majorMinor[2]!),
      patch: 0,
      prerelease: [],
    };
  }

  return null;
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const delta = Number(leftPart) - Number(rightPart);
      if (delta !== 0) {
        return delta > 0 ? 1 : -1;
      }
      continue;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }

    const delta = leftPart.localeCompare(rightPart);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }

  return 0;
}

export function compareSemverVersions(leftVersion: string, rightVersion: string): number | null {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) {
    return null;
  }

  for (const key of ["major", "minor", "patch"] as const) {
    const delta = left[key] - right[key];
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}
