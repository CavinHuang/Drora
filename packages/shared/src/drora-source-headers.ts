import { DEFAULT_DRORA_ENDPOINT_ORIGIN } from "./droraEndpoint.js";

export const DRORA_SOURCE_HEADERS = {
  "User-Agent": "Drora/unknown",
  "HTTP-Referer": DEFAULT_DRORA_ENDPOINT_ORIGIN,
  "X-Title": "Z Code@electron",
} as const;

export interface BuildDroraSourceHeadersFromContextOptions {
  appVersion?: string;
  arch?: string;
  clientLanguage?: string;
  clientTimezone?: string;
  deviceMid?: string;
  endpointOrigin?: string;
  osVersion?: string;
  platform?: string;
  releaseChannel?: string;
  sourceTitle?: string;
}

export function normalizeDroraSourceHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^[\x20-\x7e]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function buildDroraSourceHeadersFromContext(
  options: BuildDroraSourceHeadersFromContextOptions = {},
): Record<string, string> {
  const appVersion = normalizeDroraSourceHeaderValue(options.appVersion);
  const arch = normalizeDroraSourceHeaderValue(options.arch);
  const clientLanguage = normalizeDroraSourceHeaderValue(options.clientLanguage) ?? "unknown";
  const clientTimezone = normalizeDroraSourceHeaderValue(options.clientTimezone) ?? "unknown";
  const deviceMid = normalizeDroraSourceHeaderValue(options.deviceMid);
  const endpointOrigin =
    normalizeDroraSourceHeaderValue(options.endpointOrigin) ?? DEFAULT_DRORA_ENDPOINT_ORIGIN;
  const osVersion = normalizeDroraSourceHeaderValue(options.osVersion);
  const platform = normalizeDroraSourceHeaderValue(options.platform);
  const releaseChannel = normalizeDroraSourceHeaderValue(options.releaseChannel);
  const sourceTitle = normalizeDroraSourceHeaderValue(options.sourceTitle) ?? "electron";

  return {
    ...DRORA_SOURCE_HEADERS,
    "HTTP-Referer": endpointOrigin,
    "User-Agent": `Drora/${appVersion ?? "unknown"}`,
    ...(appVersion ? { "X-Drora-App-Version": appVersion } : {}),
    "X-Title": `Z Code@${sourceTitle}`,
    ...(platform && arch ? { "X-Platform": `${platform}-${arch}` } : {}),
    ...(releaseChannel ? { "X-Release-Channel": releaseChannel } : {}),
    "X-Client-Language": clientLanguage,
    "X-Client-Timezone": clientTimezone,
    ...(platform ? { "X-Os-Category": normalizeOsCategory(platform) } : {}),
    ...(osVersion ? { "X-Os-Version": osVersion } : {}),
    ...(deviceMid ? { "X-Device-Mid": deviceMid } : {}),
  };
}

function normalizeOsCategory(platform: string): string {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}
