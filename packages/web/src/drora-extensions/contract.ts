export interface HostedLocation {
  pathname: string;
  protocol: string;
  host: string;
}
export type HostedRelayResolver = (location: HostedLocation) => string | undefined;
