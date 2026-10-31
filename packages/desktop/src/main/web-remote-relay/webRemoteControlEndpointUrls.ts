import {
  buildDroraEndpointUrls,
  resolveWebRemoteControlEndpointOrigin,
  resolveWebRemoteControlRelayWsUrl,
  type DroraEndpointUrls,
} from "@drora/shared";

export interface WebRemoteControlEndpointUrlInputs {
  /** 全局 endpoint 链解析结果（settings droraEndpointOrigin → env → 官方默认）。 */
  endpointOrigin: string;
  /** 设置键 webRemoteControlRelayOrigin：仅覆盖远控三 URL 面（specs/relay-v2-server.md §8.7）。 */
  relayOriginSetting?: string;
  appVersion?: string;
  /** dev 调试覆盖（DRORA_WEB_REMOTE_CONTROL_RELAY_WS_URL），优先级高于设置键。 */
  relayWsUrlEnvOverride?: string;
  /** dev 调试覆盖（DRORA_WEB_REMOTE_CONTROL_URL），优先级高于设置键。 */
  remoteUrlEnvOverride?: string;
}

export function buildWebRemoteControlEndpointUrls(
  inputs: WebRemoteControlEndpointUrlInputs,
): DroraEndpointUrls {
  const effectiveOrigin = resolveWebRemoteControlEndpointOrigin({
    relayOrigin: inputs.relayOriginSetting,
    endpointOrigin: inputs.endpointOrigin,
  });
  return {
    ...buildDroraEndpointUrls(effectiveOrigin, { appVersion: inputs.appVersion }),
    relayWsUrl: resolveWebRemoteControlRelayWsUrl({
      endpointOrigin: effectiveOrigin,
      overrideUrl: inputs.relayWsUrlEnvOverride,
    }),
    ...(inputs.remoteUrlEnvOverride ? { remoteUrl: inputs.remoteUrlEnvOverride } : {}),
  };
}
