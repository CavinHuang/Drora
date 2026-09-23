const DRORA_PROCESS_PREFIX = "drora";
const MAX_PROCESS_NAME_SEGMENT_LENGTH = 24;

function sanitizeProcessNameSegment(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_PROCESS_NAME_SEGMENT_LENGTH);
}

function joinDroraProcessName(...segments: Array<string | null | undefined>): string {
  const sanitizedSegments = segments
    .map((segment) => sanitizeProcessNameSegment(segment))
    .filter((segment): segment is string => Boolean(segment));
  return [DRORA_PROCESS_PREFIX, ...sanitizedSegments].join("-");
}

function pickWorkspaceTag(workspacePath: string | null | undefined): string | undefined {
  const trimmedPath = workspacePath?.trim();
  if (!trimmedPath) {
    return undefined;
  }

  const parts = trimmedPath.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? trimmedPath;
}

export function formatDroraMainProcessName(): string {
  return joinDroraProcessName("main");
}

export function formatDroraGpuProcessName(): string {
  return joinDroraProcessName("gpu");
}

export function formatDroraHostProcessName(label?: string): string {
  return joinDroraProcessName("host", label);
}

export function formatDroraRendererProcessName(windowTitle?: string): string {
  const normalizedTitle = windowTitle?.trim();
  if (!normalizedTitle || normalizedTitle === "Drora") {
    return joinDroraProcessName("renderer", "main");
  }

  if (normalizedTitle === "Resource Manager") {
    return joinDroraProcessName("renderer", "resource-manager");
  }

  const remoteWindowPrefix = "Drora - ";
  if (normalizedTitle.startsWith(remoteWindowPrefix)) {
    return joinDroraProcessName(
      "renderer",
      "remote",
      normalizedTitle.slice(remoteWindowPrefix.length),
    );
  }

  return joinDroraProcessName("renderer", normalizedTitle);
}

export function formatDroraAgentProcessName(provider: string, workspacePath?: string): string {
  return joinDroraProcessName("agent", provider, pickWorkspaceTag(workspacePath));
}

export function formatDroraUtilityProcessName(name?: string, type = "utility"): string {
  return joinDroraProcessName(type, name);
}
