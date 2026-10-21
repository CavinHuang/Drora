import type { DroraEndpointUrls } from "@drora/shared";

/**
 * 自建 relay 的 V1 凭据存储形状（原 main/webRemoteControlRelayAuthStorageProvider.ts
 * 随上游 v3.16.1 Relay V2 合并被删除，此处保留 Drora 自建装配所需的最小结构）。
 * 自建 relay V2 适配待接线：relay-server 实现 V2 wire 契约后，此装配点切换为
 * V2 deviceStorage 语义（JWT 注册 + 一次性连接 token），再挂回官方 manager。
 */
export interface DroraRelayAuthStorageProvider {
  load(): Promise<{ deviceSid: string; passHash: string } | undefined>;
  save(auth: { deviceSid: string; passHash: string }): Promise<void>;
  clear(): Promise<void>;
  rotate(auth: { deviceSid: string; passHash: string }): Promise<void>;
}

export interface RemoteDeploymentPort {
  getEndpointUrls(): Promise<DroraEndpointUrls>;
  resolveAuthStorageProvider(relayWsUrl: string): DroraRelayAuthStorageProvider;
  dispose(): Promise<void>;
}
