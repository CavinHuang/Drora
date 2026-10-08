import { z } from "zod";
import { parsePluginStoreOrder, type PluginStoreOrder } from "./pluginStoreOrder.js";

/** 只允许显式接入的公开字段进入服务快照，不透传账户或 Provider 配置。 */
export interface ClientConfigSnapshot {
  pluginStoreOrder: PluginStoreOrder | null;
  captcha: CaptchaClientConfig | null;
}

export const clientConfigReadOptionsSchema = z.object({
  forceRefresh: z.boolean().optional(),
});
export type ClientConfigReadOptions = z.infer<typeof clientConfigReadOptionsSchema>;

/**
 * Start Plan 人机验证配置（官方 client-configs `configs.captcha`）。
 * 三元组 region/prefix/sceneId 缺一不可：官方以"缺任一字段即视为不可用"处理，
 * 这里解析失败/不完整统一回 null，调用方按未启用降级。
 */
export interface CaptchaClientConfig {
  enabled: boolean;
  region: string;
  prefix: string;
  sceneId: string;
}

const envelopeSchema = z.object({
  code: z.literal(0),
  data: z
    .object({
      configs: z
        .object({
          pluginStoreOrder: z.unknown().optional(),
          captcha: z.unknown().optional(),
        })
        .nullish(),
    })
    .nullish(),
});

const captchaConfigSchema = z.object({
  enabled: z.boolean(),
  region: z.string().trim().min(1),
  prefix: z.string().trim().min(1),
  sceneId: z.string().trim().min(1),
});

export function parseClientConfigSnapshot(payload: unknown): ClientConfigSnapshot {
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) throw new Error("Invalid public client config response");
  const raw = parsed.data.data?.configs?.captcha;
  // 官方 p3 判定：无配置/enabled=false/缺 region|prefix|sceneId 一律视为"无可用配置"。
  // 在解析边界归一为 null，消费方只需区分"可采集/不可采集"，不感知半残配置。
  const captcha =
    captchaConfigSchema.safeParse(raw).success && (raw as { enabled?: unknown })?.enabled === true
      ? (raw as CaptchaClientConfig)
      : null;
  return {
    pluginStoreOrder: parsePluginStoreOrder(parsed.data.data?.configs?.pluginStoreOrder),
    captcha,
  };
}
