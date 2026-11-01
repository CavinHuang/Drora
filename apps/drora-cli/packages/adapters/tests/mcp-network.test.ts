import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildMcpStdioEnv,
  prependRunningNodeDirectory,
} from "../src/mcp/network.js";

describe("MCP stdio environment", () => {
  it("prepends the running Node directory so portable node commands work remotely", () => {
    const originalPath = ["/definitely/missing/bin", "/also/missing/bin"].join(delimiter);

    const env = buildMcpStdioEnv({
      env: {
        PATH: originalPath,
      },
    });

    expect(env.PATH).toBe([dirname(process.execPath), originalPath].join(delimiter));
  });

  it("preserves an existing PATH when another executable node is already available", async () => {
    const root = await mkdtemp(join(tmpdir(), "drora-mcp-node-path-"));
    // win32 的可执行探测只认 node.exe（network.ts 在 Windows 下 probe 名固定
    // node.exe）；无扩展名的 shebang 文件在 Windows 上不可执行，按平台写对应形态。
    const nodePath = join(root, process.platform === "win32" ? "node.exe" : "node");
    try {
      await writeFile(nodePath, process.platform === "win32" ? "" : "#!/bin/sh\nexit 0\n");
      await chmod(nodePath, 0o755);

      const env = buildMcpStdioEnv({ env: { PATH: root } });

      expect(env.PATH).toBe(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("normalizes Windows separators and case before adding the running node directory", () => {
    const env = prependRunningNodeDirectory(
      { Path: "C:\\Drora\\Node;C:\\Windows\\System32" },
      {
        execPath: "c:/drora/node/node.exe",
        isExecutable: () => false,
        platform: "win32",
      },
    );

    expect(env).toEqual({ Path: "C:\\Drora\\Node;C:\\Windows\\System32" });
  });
});
