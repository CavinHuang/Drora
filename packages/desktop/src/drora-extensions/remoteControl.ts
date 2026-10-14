import { join } from "node:path";
import type { AppSettings, DroraEndpointUrls } from "@drora/shared";
import { buildDroraEndpointUrls } from "@drora/shared";
import { getDataBaseDir } from "@drora/services/node";
import { MobileRelayCredentialStore } from "../main/desktopMobileRelayProtocol.js";
import {
  buildLanRemotePageUrl,
  createDesktopMobileLanRelayHost,
  credentialFileNameForOrigin,
  LAN_EMBEDDED_RELAY_ORIGIN,
  resolveCloudRelayOrigin,
} from "../main/desktopMobileLanRelayHost.js";
import type { WebRemoteControlRelayAuthStorageProvider } from "../main/webRemoteControlRelayAuthStorageProvider.js";

/** 部署与凭据适配；任务、attachment 与传输状态仍只属于官方 manager。 */
export function createDroraRemoteControlDeployment(deps: {
  loadSettings(): Promise<AppSettings>;
  officialEndpoints(): Promise<DroraEndpointUrls>;
  appVersion: string;
  relayWsOverride?: string;
  remoteUrlOverride?: string;
  resolveEncryption?():
    | { encrypt(plain: string): string; decrypt(stored: string): string }
    | undefined;
  logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
}) {
  // 资源/数据根在 bootstrap 设置之后读取，避免固定到启动前的旧目录。
  let lanHost: ReturnType<typeof createDesktopMobileLanRelayHost> | undefined;
  const stores = new Map<string, WebRemoteControlRelayAuthStorageProvider>();
  return {
    async getEndpointUrls(): Promise<DroraEndpointUrls> {
      const settings = await deps.loadSettings();
      if ((settings.mobileRelayTransport ?? "lan") === "lan") {
        lanHost ??= createDesktopMobileLanRelayHost({
          logger: deps.logger,
          registryFilePath: join(getDataBaseDir(), ".drora/v2/mobile-relay-lan/registry.json"),
        });
        const { port } = await lanHost.ensureStarted();
        const remoteUrl = buildLanRemotePageUrl({ port });
        return {
          ...buildDroraEndpointUrls(new URL(remoteUrl).origin, { appVersion: deps.appVersion }),
          relayWsUrl: `ws://127.0.0.1:${port}/ws`,
          remoteUrl,
        };
      }
      const official = await deps.officialEndpoints();
      const override = settings.relayServerUrl?.trim() || deps.relayWsOverride;
      if (!override)
        return { ...official, remoteUrl: deps.remoteUrlOverride || official.remoteUrl };
      const url = new URL(override);
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
        throw new Error("Relay URL must use http(s) or ws(s).");
      }
      const secure = url.protocol === "https:" || url.protocol === "wss:";
      const derived = buildDroraEndpointUrls(`${secure ? "https:" : "http:"}//${url.host}`, {
        appVersion: deps.appVersion,
      });
      return {
        ...derived,
        relayWsUrl: `${secure ? "wss:" : "ws:"}//${url.host}${url.pathname === "/" ? "/ws" : url.pathname}`,
        remoteUrl: deps.remoteUrlOverride || derived.remoteUrl,
      };
    },
    resolveAuthStorageProvider(relayWsUrl: string): WebRemoteControlRelayAuthStorageProvider {
      const lanPort = lanHost?.currentPort();
      const origin =
        lanPort && relayWsUrl === `ws://127.0.0.1:${lanPort}/ws`
          ? LAN_EMBEDDED_RELAY_ORIGIN
          : resolveCloudRelayOrigin(relayWsUrl);
      // 捕获 origin，不使用随另一窗口 start 改变的全局 active-origin。
      let provider = stores.get(origin);
      if (!provider) {
        const store = new MobileRelayCredentialStore(
          join(getDataBaseDir(), ".drora/v2"),
          deps.resolveEncryption?.(),
          credentialFileNameForOrigin(origin),
        );
        provider = {
          load: async () => (await store.load()) ?? undefined,
          save: (auth) => store.save(auth),
          clear: () => store.clear(),
          rotate: async (auth) => {
            await store.clear();
            await store.save(auth);
          },
        };
        stores.set(origin, provider);
      }
      return provider;
    },
    async dispose(): Promise<void> {
      await lanHost?.stop();
    },
  };
}
