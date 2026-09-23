import { defineConfig } from "tsup";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// tsup 配置自身会被打包，构建工具需保留原始文件位置，不能被内联后重定位。
const { loadBuiltinProviderConfig } = await import(
  pathToFileURL(resolve(import.meta.dirname, "../../scripts/builtin-provider-config.mjs")).href
);

const { content: droraBuiltinProviderConfigJson } = await loadBuiltinProviderConfig();

export const SERVER_CLI_DEFINES = {
  __DRORA_BUILTIN_PROVIDER_CONFIG_JSON__: JSON.stringify(droraBuiltinProviderConfigJson),
};

export default defineConfig({
  entry: {
    "server-cli": "src/main.ts",
    "server-core": "src/server-core/entry.ts",
  },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  splitting: false,
  banner: {
    js: 'import { fileURLToPath as __droraFileURLToPath } from "node:url"; import { dirname as __droraDirname } from "node:path"; const __filename = __droraFileURLToPath(import.meta.url); const __dirname = __droraDirname(__filename);',
  },
  noExternal: ["@drora/shared", "@drora/rpc", "@drora/services"],
  define: SERVER_CLI_DEFINES,
  external: [
    "node-pty",
    "ssh2",
    "yaml",
    "node-forge",
    "undici",
    "axios",
    "form-data",
    "combined-stream",
    "proxy-from-env",
    "follow-redirects",
    "@lydell/node-pty-darwin-arm64",
    "@lydell/node-pty-darwin-x64",
    "@lydell/node-pty-linux-arm64",
    "@lydell/node-pty-linux-x64",
  ],
});
