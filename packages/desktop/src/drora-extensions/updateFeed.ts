import type { DroraUpdateFeedTarget } from "./contract.js";

/** 发布源属于 Drora，更新事实与轮询仍由官方更新器持有。 */
export function applyDroraUpdateFeed(updater: DroraUpdateFeedTarget, explicitUrl?: string): void {
  const url = explicitUrl?.trim();
  if (!url) return; // electron-builder 的 app-update.yml 配置 Drora GitHub feed。
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Update feed must use http(s).");
  updater.setFeedURL({ provider: "generic", url });
}
