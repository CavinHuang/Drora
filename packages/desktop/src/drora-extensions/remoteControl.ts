import { join } from "node:path";
import { ipcMain } from "electron";
import type {
  AppSettings,
  DroraEndpointUrls,
  WebRemoteControlContext,
  WebRemoteControlStartOperationResult,
} from "@drora/shared";
import { PlatformChannels, buildDroraEndpointUrls } from "@drora/shared";
import { getDataBaseDir } from "@drora/services/node";
import { MobileRelayCredentialStore } from "../main/desktopMobileRelayProtocol.js";
import {
  buildLanRemotePageUrl,
  createDesktopMobileLanRelayHost,
  credentialFileNameForOrigin,
  LAN_EMBEDDED_RELAY_ORIGIN,
  resolveCloudRelayOrigin,
} from "../main/desktopMobileLanRelayHost.js";
// V1 凭据类型宿主（main/webRemoteControlRelayAuthStorageProvider.ts）已随上游 Relay V2 删除；
// 形状改由本仓 contract.ts 就地定义。自建 relay V2 适配待接线。
import type { DroraRelayAuthStorageProvider } from "./contract.js";

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
  const stores = new Map<string, DroraRelayAuthStorageProvider>();
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
    resolveAuthStorageProvider(relayWsUrl: string): DroraRelayAuthStorageProvider {
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

/**
 * Web 远控「刷新二维码」入口（ours 保真面，v3.16.1 上游 V2 重写删除了 V1 resetPairing）。
 * 按 webRemoteControlManager 的 R1 决策：V2 下配对材料由 deviceStorage 注册流管理，
 * manager 没有配对轮换原语，二维码泄露轮换语义保留在 Drora mobile relay
 * （desktopMobileRelayControl.refreshMobileRelayControl）。本 handler 按 UI 已兼容的
 * 「可取消平台实现」契约（WebRemoteControlStartCancelledResult）优雅降级，
 * 不在还原的官方 manager 内新增半成品轮换逻辑。
 */
export function registerWebRemoteControlPairingRefreshIpc(deps: {
  logger: { info(...args: unknown[]): void };
}): void {
  ipcMain.handle(
    PlatformChannels.ResetWebRemoteControlPairing,
    async (
      _event,
      _context: WebRemoteControlContext,
    ): Promise<WebRemoteControlStartOperationResult> => {
      deps.logger.info(
        "[web-remote-control] pairing refresh requested; V2 has no rotation primitive, answering cancelled (R1)",
      );
      return { status: "cancelled" };
    },
  );
}
