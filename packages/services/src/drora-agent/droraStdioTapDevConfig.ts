import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DroraStdioTapDevState } from "@drora/shared";
import { getAppConfigDir } from "#src/paths.js";
import { isEffectiveDevelopmentNodeEnv } from "#src/runtime-tools/nodeEnv.js";

interface DroraStdioTapStateFile {
  enabled?: boolean;
}

function isDroraStdioTapDevVisible(): boolean {
  return isEffectiveDevelopmentNodeEnv();
}

function getDroraStdioTapDevDir(): string {
  return join(getAppConfigDir(), "dev");
}

export function getDroraStdioTapDevLogDir(): string {
  return join(getDroraStdioTapDevDir(), "stdio-traffic");
}

function getDroraStdioTapDevStatePath(): string {
  return join(getDroraStdioTapDevDir(), "drora-stdio-tap.json");
}

function readStateFile(path: string): DroraStdioTapStateFile {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as DroraStdioTapStateFile) : {};
  } catch {
    return {};
  }
}

export function readDroraStdioTapDevState(): DroraStdioTapDevState {
  const visible = isDroraStdioTapDevVisible();
  const statePath = getDroraStdioTapDevStatePath();
  const fileState = readStateFile(statePath);
  return {
    enabled: visible && fileState.enabled === true,
    visible,
    logDir: getDroraStdioTapDevLogDir(),
    statePath,
  };
}

export function setDroraStdioTapDevEnabled(enabled: boolean): DroraStdioTapDevState {
  const visible = isDroraStdioTapDevVisible();
  const statePath = getDroraStdioTapDevStatePath();
  mkdirSync(getDroraStdioTapDevDir(), { recursive: true });
  writeFileSync(
    statePath,
    `${JSON.stringify(
      {
        // 开发态 stdio 抓包是高频原始协议帧，只能通过显式开关写旁路文件，避免误进生产日志。
        enabled: visible && enabled,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
  return readDroraStdioTapDevState();
}
