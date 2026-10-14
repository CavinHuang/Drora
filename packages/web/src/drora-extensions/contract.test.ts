import { describe, expect, it } from "vitest";
import { resolveHostedRemoteRelayUrl } from "./remoteEndpoint.js";
describe("hosted Relay deployment", () => {
  it("LAN/HTTPS resolve same-origin while standalone follows official configuration", () => {
    expect(
      resolveHostedRemoteRelayUrl({
        pathname: "/remote/v4",
        protocol: "http:",
        host: "192.168.1.2:4500",
      }),
    ).toBe("ws://192.168.1.2:4500/ws");
    expect(
      resolveHostedRemoteRelayUrl({
        pathname: "/remote/v4/index.html",
        protocol: "https:",
        host: "relay.example",
      }),
    ).toBe("wss://relay.example/ws");
    expect(
      resolveHostedRemoteRelayUrl({ pathname: "/", protocol: "https:", host: "app.example" }),
    ).toBeUndefined();
    expect(
      resolveHostedRemoteRelayUrl({
        pathname: "/remote/v40",
        protocol: "https:",
        host: "app.example",
      }),
    ).toBeUndefined();
  });
});
