// Drora Relay Server CLI 入口：node/SEA 可执行。
// 用法：relay-server --port 4430 --host 0.0.0.0 --db ./relay-devices.json
//       [--static-dir ./site]（dev 离线镜像，优先）或默认内建资产代理
//       [--asset-cache-dir ./remote-asset-cache]（官方页 cache→fetch，spec §12.9）
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
    "asset-cache-dir": { type: "string" },
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

// 官方 v4 前端资产托管（spec §12.5/§12.9）：--static-dir=离线目录镜像（dev 手动
// 下载，优先，测试床语义）；未给时默认启用内建资产代理——cache → fetch 官方源站
// → 落盘缓存出站改写，离线时入口 302 → /m/index.html（R2 极简页兜底）。
// 缓存目录缺省 ./remote-asset-cache，--asset-cache-dir 可覆盖。
const staticDir = values["static-dir"];
const server = createRelayServer({
  registry,
  port,
  host: values.host,
  staticRoot: staticDir,
  remoteAssets: staticDir
    ? undefined
    : { cacheDir: values["asset-cache-dir"] ?? "./remote-asset-cache" },
  log: { info: (...args) => console.log(...args), warn: (...args) => console.warn(...args) },
});

const actualPort = await server.listen();
const assetMode = staticDir
  ? `static-dir: ${staticDir}`
  : `asset-cache-dir: ${values["asset-cache-dir"] ?? "./remote-asset-cache"}`;
console.log(
  `[relay-server] ready on ${values.host}:${actualPort} (db: ${values.db}, ${assetMode})`,
);

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
