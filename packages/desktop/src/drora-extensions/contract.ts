import type { DroraEndpointUrls } from "@drora/shared";
import type { WebRemoteControlRelayAuthStorageProvider } from "../main/webRemoteControlRelayAuthStorageProvider.js";
export interface RemoteDeploymentPort {
  getEndpointUrls(): Promise<DroraEndpointUrls>;
  resolveAuthStorageProvider(relayWsUrl: string): WebRemoteControlRelayAuthStorageProvider;
  dispose(): Promise<void>;
}
