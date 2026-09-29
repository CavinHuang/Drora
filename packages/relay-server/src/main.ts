// Drora Relay Server CLI 入口：node/SEA 可执行。
// 用法：relay-server --port 4430 --host 0.0.0.0 --db ./relay-devices.json
//       [--static-dir ./site]（dev 离线镜像，优先）
//       [--mobile-dir ./packages/mobile-web/dist]（独立本地页面包；缺省按 dist 源码应用 → src/recovered 快照 → 内建代理取根）
//       [--asset-cache-dir ./remote-asset-cache]（本地缺失时 cache→fetch，spec §12.9）
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  createDeviceRegistry,
  createFileDeviceRegistryStorage,
  createRelayServer,
} from "./index.js";
import { pickBundledMobileRoot } from "./bundledMobileRoot.js";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "4430" },
    host: { type: "string", default: "0.0.0.0" },
    db: { type: "string", default: "./relay-devices.json" },
    "static-dir": { type: "string" },
    "mobile-dir": { type: "string" },
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

// 官方 v4 前端资产托管（spec §12.5/§12.9 + mobile-relay-r3-frontend.md §13）：
// static-dir 测试床优先；无 --mobile-dir 时 bundled 根优先级 =
// mobile-web/dist（P2a 源码应用产物，entry 存在才启用）→ mobile-web/src/recovered
// （官方 3.14.3 可读快照，D7 行为保底）。两者都缺失时才启用内建资产代理
// cache → fetch 官方源站，离线时入口 302 → /m/index.html（R2 极简页兜底）。
const staticDir = values["static-dir"];
const bundledSourceAppDir = fileURLToPath(new URL("../../mobile-web/dist/", import.meta.url));
const bundledRecoveredDir = fileURLToPath(
  new URL("../../mobile-web/src/recovered/", import.meta.url),
);
let mobileDir = values["mobile-dir"];
if (!mobileDir) {
  // pickBundledMobileRoot 以 null 表达“全缺失”；createRelayServer 选项用 undefined 表达
  // 未注入——此处做一次词汇转换，不改变语义。
  mobileDir =
    (await pickBundledMobileRoot([bundledSourceAppDir, bundledRecoveredDir])) ?? undefined;
}
const server = createRelayServer({
  registry,
  port,
  host: values.host,
  staticRoot: staticDir,
  mobileRoot: mobileDir,
  remoteAssets:
    staticDir || mobileDir
      ? undefined
      : { cacheDir: values["asset-cache-dir"] ?? "./remote-asset-cache" },
  log: { info: (...args) => console.log(...args), warn: (...args) => console.warn(...args) },
});

const actualPort = await server.listen();
const assetMode = staticDir
  ? `static-dir: ${staticDir}`
  : mobileDir
    ? `mobile-dir: ${mobileDir}`
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
