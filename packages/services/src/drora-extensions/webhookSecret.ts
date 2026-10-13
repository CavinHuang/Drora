import { BOT_WEBHOOK_SECRET_HEADER, DRORA_LEGACY_WEBHOOK_SECRET_HEADER } from "@drora/shared";
import type { WebhookSecretResolution } from "./contract.js";

/** 兼容既有入站别名；验密仍只有 Bot 服务一个 owner，冲突不能用优先级静默掩盖。 */
export function resolveDroraWebhookSecret(
  getHeader: (name: string) => string | undefined,
): WebhookSecretResolution {
  const official = getHeader(BOT_WEBHOOK_SECRET_HEADER);
  const legacy = getHeader(DRORA_LEGACY_WEBHOOK_SECRET_HEADER);
  if (official !== undefined && legacy !== undefined && official !== legacy) return { ok: false };
  return { ok: true, secret: official ?? legacy };
}
