// ZCode Computer Use 插件薄壳（原版 src/mcp/server.ts 还原）。
// 只做三件事：解析 argv / 读取 broker env → 组装 options → 调用
// @zcode/zcode-cua 的 main() 启动 stdio 或 streamable-http MCP server。
// __zcode-plugin-host 会注入 --permission-broker-socket 与
// ZCODE_CUA_PERMISSION_BROKER_TOKEN，缺一即拒绝启动（fail-closed）。
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import {
  main,
  parseServerArgs,
  parsedArgsToOptions,
  readBrokerEnv,
} from "@zcode/zcode-cua";

const BROKER_TOKEN_ENV = "ZCODE_CUA_PERMISSION_BROKER_TOKEN";

async function run() {
  const argv = process.argv.slice(2);
  const parsed = parseServerArgs(argv);
  const env = readBrokerEnv(process.env);
  const options = {
    ...env,
    ...parsedArgsToOptions(parsed),
    refreshMarkerPath: env.refreshMarkerPath,
  };
  if (!options.brokerSocketPath) {
    throw new Error(
      "zcode-cua plugin launcher requires --permission-broker-socket (set by __zcode-plugin-host)",
    );
  }
  if (!options.brokerToken) {
    throw new Error(
      `zcode-cua plugin launcher requires ${BROKER_TOKEN_ENV} (set by __zcode-plugin-host)`,
    );
  }
  await main(options);
}

function isDirectExecution() {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    import.meta.url === pathToFileURL(resolve(entrypoint)).href
  );
}

if (isDirectExecution()) {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`zcode-cua plugin launcher failed: ${message}\n`);
    process.exitCode = 1;
  });
}

export { run as main };
