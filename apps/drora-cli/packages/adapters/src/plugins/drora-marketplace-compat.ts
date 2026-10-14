import {
  DRORA_OFFICIAL_PLUGIN_MARKETPLACE,
  OFFICIAL_MARKETPLACE_UPSTREAM_ALIAS,
} from "@drora/contracts";

/** 品牌适配：只归一受信官方刷新，不改变第三方 manifest 或放宽保留名守卫。 */
export function normalizeDroraOfficialMarketplace<T extends { name: string; raw?: unknown }>(
  manifest: T,
  trustedId: string | undefined,
): T {
  if (
    trustedId !== DRORA_OFFICIAL_PLUGIN_MARKETPLACE ||
    manifest.name !== OFFICIAL_MARKETPLACE_UPSTREAM_ALIAS
  ) {
    return manifest;
  }
  const raw = manifest.raw;
  return {
    ...manifest,
    name: DRORA_OFFICIAL_PLUGIN_MARKETPLACE,
    ...(raw && typeof raw === "object" && !Array.isArray(raw)
      ? { raw: { ...raw, name: DRORA_OFFICIAL_PLUGIN_MARKETPLACE } }
      : {}),
  };
}
