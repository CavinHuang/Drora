// Drora Relay Server CLI 入口：node/SEA 可执行。
// 用法：relay-server --port 4430 --host 0.0.0.0 --db ./relay-devices.json
import { parseArgs } from "node:util";
import {
  createDeviceRegistry,
  createFileDeviceRegistryStorage,
  createRelayServer,
} from "./index.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4430" },
    host: { type: "string", default: "0.0.0.0" },
    db: { type: "string", default: "./relay-devices.json" },
    "static-dir": { type: "string" },
  },
});

const port = Number(values.port);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`invalid --port: ${values.port}`);
  process.exit(1);
}

const registry = createDeviceRegistry({
  storage: createFileDeviceRegistryStorage(values.db),
});

const server = createRelayServer({
  registry,
  port,
  host: values.host,
  // 官方 v4 前端资产本地托管（spec §12.5）：目录结构镜像 /remote/v4/**。
  staticRoot: values["static-dir"],
  log: { info: (...args) => console.log(...args), warn: (...args) => console.warn(...args) },
});

const actualPort = await server.listen();
console.log(`[relay-server] ready on ${values.host}:${actualPort} (db: ${values.db})`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[relay-server] ${signal} received, shutting down`);
  await server.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
