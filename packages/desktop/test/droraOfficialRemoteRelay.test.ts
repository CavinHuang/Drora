import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { createDeviceRegistry, createFileDeviceRegistryStorage, createRelayServer } from "@drora/relay-server";
import { WebRemoteControlDeviceTransport } from "../src/main/webRemoteControlTransport.js";
import { createNodeWebRemoteControlRelayAuthProvider } from "../src/main/webRemoteControlRelayAuthProvider.js";
import { WebRemoteControlTerminalTransport } from "../../web/src/webRemoteControlTransport.js";
import { createBrowserWebRemoteControlRelayAuthProvider } from "../../web/src/webRemoteControlRelayAuthProvider.js";
import type { WebRemoteControlAppPayload } from "@drora/shared";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Remote Relay integration timed out");
    await new Promise(done => setTimeout(done, 10));
  }
}
it("official device and browser transports pair through Drora Relay and preserve wire payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "drora-official-relay-"));
  const registry = createDeviceRegistry({ storage: createFileDeviceRegistryStorage(join(root, "registry.json")) });
  const server = createRelayServer({ registry, port: 0, host: "127.0.0.1" });
  const url = `ws://127.0.0.1:${await server.listen()}/ws`;
  const authProvider = createNodeWebRemoteControlRelayAuthProvider();
  let auth: { deviceSid: string; passHash: string } | undefined;
  let deviceState = "idle";
  let terminalState = "idle";
  const receivedByDevice: WebRemoteControlAppPayload[] = [];
  const receivedByTerminal: WebRemoteControlAppPayload[] = [];
  const faults: unknown[] = [];
  let terminal: WebRemoteControlTerminalTransport | undefined;
  const device = new WebRemoteControlDeviceTransport({
    relayWsUrl: url, deviceMid: "integration-device", appVersion: "3.15.1",
    auth: { mode: "register", passHash: authProvider.createPassHash("integration-password") },
    meta: { name: "Drora", version: "3.15.1", platform: "linux" }, authProvider,
    logger: { info() {}, warn() {}, error() {} },
    onRegisteredAuth: value => { auth = value; }, onStateChange: state => { deviceState = state; },
    onPayload: payload => receivedByDevice.push(payload), onError: error => faults.push(error),
    onInvalidPersistedAuth: async () => { faults.push("invalid-auth"); },
  });
  try {
    device.start();
    await until(() => !!auth && deviceState === "waiting_terminal");
    terminal = new WebRemoteControlTerminalTransport({
      relayWsUrl: url, ...auth!, authProvider: createBrowserWebRemoteControlRelayAuthProvider(),
      onStateChange: state => { terminalState = state; }, onPayload: payload => receivedByTerminal.push(payload),
      onFailure: error => faults.push(error), onError: error => faults.push(error), reloadPage() {},
    });
    terminal.start();
    await until(() => deviceState === "paired" && terminalState === "paired");
    const request: WebRemoteControlAppPayload = { zcode_type: "workspace-list-request", requestId: "official-request" };
    expect(terminal.sendPayload(request)).toBe(true);
    await until(() => receivedByDevice.length > 0);
    expect(receivedByDevice[0]).toEqual(request);
    const response: WebRemoteControlAppPayload = { zcode_type: "app-error", reason: "unexpected-error", error: "test-error" };
    expect(device.sendPayload(response)).toBe(true);
    await until(() => receivedByTerminal.length > 0);
    expect(receivedByTerminal[0]).toEqual(response);
    expect(faults).toEqual([]);
  } finally { terminal?.dispose(); device.dispose(); await server.close(); await rm(root, { recursive: true, force: true }); }
});
