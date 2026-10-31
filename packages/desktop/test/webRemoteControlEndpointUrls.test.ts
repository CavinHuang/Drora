import { describe, expect, it } from "vitest";
import { buildWebRemoteControlEndpointUrls } from "../src/main/web-remote-relay/webRemoteControlEndpointUrls.js";

// 远控「官方/自建 Relay」切换（specs/relay-v2-server.md §8.7）：
// 设置键必须同时驱动三个 URL 面（注册 HTTP origin / relay WS / 二维码页），
// dev env 调试覆盖仍保持各自面内最高优先级。
describe("buildWebRemoteControlEndpointUrls", () => {
  it("derives all three surfaces from the global endpoint chain without the setting", () => {
    const urls = buildWebRemoteControlEndpointUrls({
      endpointOrigin: "https://zcode.z.ai",
      appVersion: "3.16.1",
    });
    expect(urls.origin).toBe("https://zcode.z.ai");
    expect(urls.remoteUrl).toBe("https://zcode.z.ai/remote/v4");
    expect(urls.relayWsUrl).toBe("wss://zcode.z.ai/api/v1/remote/ws2");
  });

  it("moves all three surfaces to the relay origin setting", () => {
    const urls = buildWebRemoteControlEndpointUrls({
      endpointOrigin: "https://zcode.z.ai",
      relayOriginSetting: "https://relay.example.com",
      appVersion: "3.16.1",
    });
    expect(urls.origin).toBe("https://relay.example.com");
    expect(urls.remoteUrl).toBe("https://relay.example.com/remote/v4");
    expect(urls.relayWsUrl).toBe("wss://relay.example.com/api/v1/remote/ws2");
  });

  it("keeps dev env overrides above the relay origin setting per surface", () => {
    const urls = buildWebRemoteControlEndpointUrls({
      endpointOrigin: "https://zcode.z.ai",
      relayOriginSetting: "https://relay.example.com",
      appVersion: "3.16.1",
      relayWsUrlEnvOverride: "ws://127.0.0.1:8080/api/v1/remote/ws2",
      remoteUrlEnvOverride: "http://127.0.0.1:5173/remote/v4",
    });
    expect(urls.origin).toBe("https://relay.example.com");
    expect(urls.relayWsUrl).toBe("ws://127.0.0.1:8080/api/v1/remote/ws2");
    expect(urls.remoteUrl).toBe("http://127.0.0.1:5173/remote/v4");
  });

  it("falls back to the chain when the setting is blank", () => {
    const urls = buildWebRemoteControlEndpointUrls({
      endpointOrigin: "https://zcode.z.ai",
      relayOriginSetting: "   ",
      appVersion: "3.16.1",
    });
    expect(urls.origin).toBe("https://zcode.z.ai");
  });
});
