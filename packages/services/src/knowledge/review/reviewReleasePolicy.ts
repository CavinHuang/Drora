import type { ServiceAuthorityMode } from "@drora/shared";

/**
 * 本轮 S03 委托自审交付范围，见 S03_CLOSEOUT_2026-10-17.md。
 * 只装配桌面本地能力；Vault 开关与逐提案批准仍由 ReviewEngine 独立校验。
 */
export function isReleasedReviewWriteAuthority(authority: ServiceAuthorityMode | undefined): boolean {
  return authority === "desktop-local";
}
