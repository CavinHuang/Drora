import {
  DEFAULT_DRORA_ENDPOINT_ORIGIN,
  DRORA_VERSION,
  buildHelpAppConfigUrl,
  createHelpAppConfigReader,
  resolveOptionalDroraAuthorization,
  resolveHelpAppConfig,
  toZhOrEnLocale,
  type Locale,
  type DroraJwtTokenResolver,
} from "@drora/shared";
import { BrowserOAuthCredentialRepo } from "#src/auth/browserOAuthCredentialRepo.js";
import localDefaultAppConfig from "../../../config/default.json" with { type: "json" };

interface ResolveWebCommunityUrlOptions {
  fetchImpl?: typeof fetch;
  localConfig?: unknown;
  endpointOrigin?: string;
  resolveDroraJwtToken?: DroraJwtTokenResolver;
}

const readHelpConfig = createHelpAppConfigReader({
  fetchImpl: (input, init) => fetch(input, init),
});

export async function resolveWebHelpConfig(options: ResolveWebCommunityUrlOptions = {}) {
  const env = import.meta.env;
  const endpoint =
    options.endpointOrigin ??
    (env?.VITE_DRORA_BASE_URL?.trim() ||
      env?.VITE_DRORA_ENDPOINT_ORIGIN?.trim() ||
      DEFAULT_DRORA_ENDPOINT_ORIGIN);
  // 服务端拒绝 platform=web；浏览器省略可选平台参数，避免伪装桌面系统。
  const url = buildHelpAppConfigUrl(endpoint, DRORA_VERSION);
  const authorization = await resolveOptionalDroraAuthorization(
    // 可选配置读取不能顺带清理过期或残缺的登录态；恢复/登出仍由原认证入口处理。
    options.resolveDroraJwtToken ?? (() => new BrowserOAuthCredentialRepo().loadDroraJwtToken()),
  );
  let remote: unknown;
  try {
    remote = await (
      options.fetchImpl
        ? createHelpAppConfigReader({ fetchImpl: options.fetchImpl })
        : readHelpConfig
    )(url, authorization ? { Authorization: authorization } : undefined);
  } catch {
    // 远端不可用时保留内置入口，不使用旧 CDN 作为第二个远端配置源。
  }
  return resolveHelpAppConfig(remote, options.localConfig ?? localDefaultAppConfig);
}

export async function resolveWebCommunityUrl(
  locale: Locale,
  options: ResolveWebCommunityUrlOptions = {},
): Promise<string | undefined> {
  // 社区链接只配置中英；非中文界面语言走英文链接。
  return (await resolveWebHelpConfig(options)).community_urls?.[toZhOrEnLocale(locale)];
}
