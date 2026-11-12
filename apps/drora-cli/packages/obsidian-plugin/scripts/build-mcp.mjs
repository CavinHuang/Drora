// knowledge MCP server 构建（specs/obsidian-vault-phase2-true-extraction.md §3/§10-P3）：
// src/mcp/server.ts → dist/mcp/server.js（自包含 ESM bundle，节点先例 node-repl-host
// scripts/build.mjs 同款纪律）。onnxruntime-node/onnxruntime-common/undici 保持 external：
// 前两者按插件 node_modules 确定性子树随包解析（g7），undici 仅 httpProxy 下载分支动态
// import（P3 未接线代理，永不触发；接线时随子树一并登记）。
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const packageRoot = resolve(import.meta.dirname, "..");

export const buildKnowledgeMcpBundle = async ({
  outfile = resolve(packageRoot, "dist", "mcp", "server.js"),
} = {}) => {
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    bundle: true,
    entryPoints: [resolve(packageRoot, "src", "mcp", "server.ts")],
    external: ["onnxruntime-node", "onnxruntime-common", "undici"],
    format: "esm",
    legalComments: "none",
    outfile,
    platform: "node",
    target: "node24",
  });
  return { outfile };
};

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const { outfile } = await buildKnowledgeMcpBundle();
  console.log(`[obsidian-plugin] ${outfile}`);
}
