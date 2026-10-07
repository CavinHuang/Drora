import { buildRuntimeDroraApiUrl, resolveZaiBusinessBaseUrl } from "@drora/shared";

export const DRORA_CLIENT_SCENES_URL = buildRuntimeDroraApiUrl(
  process.env,
  "/api/v1/client/scenes",
);

export const ZAI_API_HOST = resolveZaiBusinessBaseUrl(process.env);
