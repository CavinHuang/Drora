import type { DroraConfigOption, DroraProvider, DroraTaskMode } from "@drora/shared";

// 原版 bundle（chunk-NKOHJ4QI.js @618632 附近）canonical 集合为 10 值——含 legacy
// permissionMode 词（default/acceptEdits/dontAsk/bypassPermissions）。本地持久化的
// 旧数据可能携带这些词，按原版逐值恢复（批 3 审查 P3-1）。
const CANONICAL_SESSION_MODES = new Set<DroraTaskMode>([
  "default",
  "yolo",
  "guarded",
  "plan",
  "edit",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "autoEdit",
  "build",
  "default",
  "acceptEdits",
  "dontAsk",
  "bypassPermissions",
]);

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function getModeConfigOption(options: readonly DroraConfigOption[]): DroraConfigOption | undefined {
  return options.find((option) => option.category === "mode" && option.type === "select");
}

function normalizePersistedSessionMode(
  modeId: string | null | undefined,
  _provider?: DroraProvider,
): DroraTaskMode | undefined {
  const trimmedModeId = readTrimmedString(modeId);
  if (!trimmedModeId) {
    return undefined;
  }

  if (CANONICAL_SESSION_MODES.has(trimmedModeId as DroraTaskMode)) {
    return trimmedModeId as DroraTaskMode;
  }

  switch (trimmedModeId) {
    // Bugfix: provider 原生 modeId 和本地持久化的 session mode 不是一套枚举。
    // 下发前需要把本地语义映射回 provider options 中真实存在的值。
    case "read-only":
    case "read_only":
      return "plan";
    case "auto_edit":
    case "auto-edit":
    case "autoEdit":
    case "accept_edits":
    case "accept-edits":
      return "acceptEdits";
    case "full-auto":
    case "full_auto":
      return "yolo";
    case "agent":
      // 该 modeId 专属于已下线的第三方 provider；不再映射到任何本地 mode。
      return undefined;
    case "agent-full-access":
    case "agent_full_access":
    case "full-access":
    case "full_access":
      return "bypassPermissions";
    default:
      return undefined;
  }
}

export function resolveProviderModeIdFromConfigOptions(params: {
  configOptions: readonly DroraConfigOption[];
  modeId: string | null | undefined;
  provider?: DroraProvider;
}): string | undefined {
  const requestedMode = readTrimmedString(params.modeId);
  if (!requestedMode) {
    return undefined;
  }

  const modeOption = getModeConfigOption(params.configOptions);
  const candidates = modeOption?.options ?? [];
  const exactMatch = candidates.find((candidate) => candidate.value === requestedMode);
  if (exactMatch) {
    return exactMatch.value;
  }

  const requestedPersistedMode = normalizePersistedSessionMode(requestedMode, params.provider);
  if (!requestedPersistedMode) {
    return undefined;
  }

  const semanticMatch = candidates.find(
    (candidate) =>
      normalizePersistedSessionMode(candidate.value, params.provider) === requestedPersistedMode,
  );

  return semanticMatch?.value;
}
