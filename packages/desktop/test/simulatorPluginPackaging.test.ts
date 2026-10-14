import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("source simulator plugin distribution", () => {
  it.each([
    ["android-emulator", ["android_preflight", "android_build_and_run", "android_screenshot"]],
    ["ios-simulator", ["ios_preflight", "ios_build_and_run", "ios_screenshot"]],
  ] as const)(
    "builds %s without an old dist and initializes from an empty runtime directory",
    async (plugin, requiredTools) => {
      const root = await mkdtemp(resolve(tmpdir(), "drora-simulator-package-"));
      temporaryRoots.push(root);
      const output = resolve(root, "server.mjs");
      // 直接从当前源码产出单文件，cwd 没有 node_modules/dist/SDK/Xcode，验证真正分发闭包。
      await build({
        entryPoints: [
          resolve(process.cwd(), `apps/drora-cli/packages/${plugin}-plugin/src/mcp/server.ts`),
        ],
        outfile: output,
        bundle: true,
        platform: "node",
        target: "node24",
        format: "esm",
        legalComments: "none",
      });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [output],
        cwd: root,
        stderr: "pipe",
      });
      const client = new Client({ name: "drora-simulator-distribution-test", version: "1.0.0" });
      let stderr = "";
      transport.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      try {
        await client.connect(transport).catch((error) => {
          throw new Error(`MCP initialize failed: ${String(error)}\n${stderr}`);
        });
        const listed = await client.listTools();
        expect(listed.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(requiredTools),
        );
        expect(client.getServerVersion()?.name).toBe(plugin);
      } finally {
        await client.close();
      }
    },
    60_000,
  );
});
