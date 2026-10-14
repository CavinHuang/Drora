import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildDroraEndpointUrls } from "@drora/shared";
import { getDataBaseDir, setDataBaseDir } from "@drora/services/node";
import { createDroraRemoteControlDeployment } from "./remoteControl.js";
it("custom deployment keeps credentials pinned to origin across overlapping starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-deployment-"));
  const previous = getDataBaseDir();
  setDataBaseDir(root);
  const deployment = createDroraRemoteControlDeployment({
    loadSettings: async () => ({
      mobileRelayTransport: "relay",
      relayServerUrl: "https://relay.example",
    }),
    officialEndpoints: async () =>
      buildDroraEndpointUrls("https://zcode.z.ai", { appVersion: "3.15.1" }),
    appVersion: "3.15.1",
    logger: { info() {}, warn() {} },
  });
  try {
    const endpoints = await deployment.getEndpointUrls();
    expect(endpoints.remoteUrl).toBe("https://relay.example/remote/v4");
    expect(endpoints.relayWsUrl).toBe("wss://relay.example/ws");
    const first = deployment.resolveAuthStorageProvider("wss://relay.example/ws");
    const second = deployment.resolveAuthStorageProvider("wss://other.example/ws");
    await first.save({ deviceSid: "first", passHash: "first-secret" });
    await second.save({ deviceSid: "second", passHash: "second-secret" });
    expect(await first.load()).toEqual({ deviceSid: "first", passHash: "first-secret" });
    await second.rotate({ deviceSid: "rotated", passHash: "rotated-secret" });
    await first.clear();
    expect(await first.load()).toBeUndefined();
    expect(await second.load()).toEqual({ deviceSid: "rotated", passHash: "rotated-secret" });
  } finally {
    await deployment.dispose();
    setDataBaseDir(previous);
    await rm(root, { recursive: true, force: true });
  }
});
