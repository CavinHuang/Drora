export type CuaAgentEnvironment = Record<string, string>;

export type WebhookSecretResolution = { ok: true; secret: string | undefined } | { ok: false };
