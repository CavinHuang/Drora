import http from "node:http";
import { stripVTControlCharacters } from "node:util";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build, createServer } from "vite";
import type { Logger } from "vite";
import { listPdfJsCMapAssets, pdfJsCMapsPlugin } from "../../ui/vite/pdfJsCMapsPlugin";

// 回归背景：pdfJsCMapsPlugin 的 buildStart 曾在 dev serve 下对每个 CMap 调 emitFile，
// Vite 8 dev/scan 插件容器不支持该 API，会逐文件刷
// "context method emitFile() is not supported in serve mode" 告警（终验日志里成片出现）。
// 修复后 serve 走 configureServer 中间件按需返回、仅构建物化资产；本文件锁定两个方向。
function createWarningCollector(): { warnings: string[]; logger: Logger } {
  const warnings: string[] = [];
  const record = (message: string) => {
    warnings.push(stripVTControlCharacters(message));
  };
  return {
    warnings,
    logger: {
      hasWarned: false,
      hasErrorLogged: () => false,
      clearScreen: () => {},
      info: () => {},
      warn: record,
      warnOnce: record,
      error: () => {},
    },
  };
}

async function createDevServer(logger: Logger) {
  return createServer({
    configFile: false,
    root: resolve(import.meta.dirname, ".."),
    logLevel: "silent",
    customLogger: logger,
    plugins: [pdfJsCMapsPlugin()],
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
}

describe("pdf.js CMaps 插件 serve/build 行为", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("dev serve 的 buildStart 不再触发 emitFile serve 模式告警", async () => {
    const { warnings, logger } = createWarningCollector();
    const server = await createDevServer(logger);
    try {
      // vite dev 真实启动路径即经此容器跑 buildStart；显式调用保证断言确定性。
      await server.environments.client.pluginContainer.buildStart();
      expect(warnings.filter((message) => message.includes("not supported in serve mode"))).toEqual(
        [],
      );
    } finally {
      await server.close();
    }
  });

  it("dev serve 中间件仍按需返回 CMap（中文 PDF 预览依赖）", async () => {
    const { logger } = createWarningCollector();
    const server = await createDevServer(logger);
    const httpServer = http.createServer(server.middlewares);
    try {
      await new Promise<void>((resolveListen) => httpServer.listen(0, "127.0.0.1", resolveListen));
      const address = httpServer.address();
      if (address === null || typeof address === "string") {
        throw new Error("ephemeral http server should expose a port");
      }
      const [sample] = await listPdfJsCMapAssets();
      const sampleName = sample.fileName.slice(sample.fileName.lastIndexOf("/") + 1);
      const response = await fetch(`http://127.0.0.1:${address.port}/pdfjs/cmaps/${sampleName}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/octet-stream");
      expect(new Uint8Array(await response.arrayBuffer()).byteLength).toBe(sample.source.length);
    } finally {
      await new Promise<void>((resolveClose) => httpServer.close(() => resolveClose()));
      await server.close();
    }
  });

  it("一次性构建仍把全部 CMap 物化进产物（含 UniGB-UCS2-H.bcmap）", async () => {
    const root = await mkdtemp(join(tmpdir(), "drora-pdfjs-cmaps-build-"));
    tempRoots.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>',
    );
    await writeFile(join(root, "src", "main.js"), "console.log(1);\n");
    const { warnings, logger } = createWarningCollector();
    await build({
      configFile: false,
      root,
      logLevel: "silent",
      customLogger: logger,
      plugins: [pdfJsCMapsPlugin()],
      build: {
        outDir: join(root, "dist"),
        rollupOptions: { input: join(root, "index.html") },
      },
    });
    const expected = await listPdfJsCMapAssets();
    const emitted = await readdir(join(root, "dist", "pdfjs", "cmaps"));
    expect(emitted.filter((name) => name.endsWith(".bcmap")).sort()).toEqual(
      expected.map((asset) => asset.fileName.slice(asset.fileName.lastIndexOf("/") + 1)).sort(),
    );
    // STSong-Light 只引用 UniGB-UCS2-H 而不嵌入映射，此文件缺失即中文预览回归。
    expect(emitted).toContain("UniGB-UCS2-H.bcmap");
    expect(warnings.filter((message) => message.includes("not supported in serve mode"))).toEqual(
      [],
    );
  });
});
