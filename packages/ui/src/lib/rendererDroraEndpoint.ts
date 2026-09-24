import {
  buildRuntimeDroraEndpointUrls,
  DRORA_ENV,
  type RuntimeDroraEndpointEnv,
} from "@drora/shared";

interface RendererImportMetaEnv {
  VITE_DRORA_BASE_URL?: string;
  VITE_DRORA_ENDPOINT_ORIGIN?: string;
}

function readRendererImportMetaEnv(): RendererImportMetaEnv {
  return ((import.meta as ImportMeta & { env?: RendererImportMetaEnv }).env ??
    {}) as RendererImportMetaEnv;
}

function createRendererDroraEndpointEnv(
  env: RendererImportMetaEnv = readRendererImportMetaEnv(),
): RuntimeDroraEndpointEnv {
  return {
    DRORA_ENV,
    // UI 侧的 zcode-plan 占位 provider 以前只看 DRORA_ENV，
    // 没有消费 Vite 注入的 base url，导致自定义测试域名时 renderer 和 host/service 可能不一致。
    DRORA_BASE_URL: env.VITE_DRORA_BASE_URL,
    DRORA_ENDPOINT_ORIGIN: env.VITE_DRORA_ENDPOINT_ORIGIN,
  };
}

export const RENDERER_DRORA_ENDPOINT_URLS = buildRuntimeDroraEndpointUrls(
  createRendererDroraEndpointEnv(),
);
