import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { download } from "../../../scripts/prepare-prebuilds.mjs";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    spawnSync: (...args: Parameters<typeof original.spawnSync>) => {
      if (String(args[0]).startsWith("curl"))
        return {
          status: null,
          error: Object.assign(new Error("curl unavailable"), { code: "ENOENT" }),
        };
      return original.spawnSync(...args);
    },
  };
});

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("prebuild download without curl", () => {
  it.each([false, true])(
    "streams bytes or rejects a interrupted body: interrupted=%s",
    async (interrupted) => {
      const root = await mkdtemp(join(tmpdir(), "drora-download-fallback-"));
      temporaryRoots.push(root);
      const target = join(root, "asset.bin");
      const server = createServer((_request, response) => {
        response.writeHead(200, { "content-length": 12 });
        response.write("first-");
        setImmediate(() => (interrupted ? response.destroy() : response.end("second")));
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const promise = download(
          `http://127.0.0.1:${(server.address() as { port: number }).port}/asset`,
          target,
        );
        if (interrupted) await expect(promise).rejects.toThrow();
        else {
          await promise;
          expect(await readFile(target, "utf8")).toBe("first-second");
        }
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
