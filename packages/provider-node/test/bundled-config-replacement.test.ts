import { mkdtemp, open, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  materializeDroraBuiltinProviderConfig,
  NodeDroraBuiltinProviderConfigSource,
} from "../src/index.js";
import * as persistence from "@drora/shared/node";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function environmentRoot() {
  const root = await mkdtemp(join(tmpdir(), "todo104-bundled-"));
  roots.push(root);
  return root;
}
function release(revision: number) {
  return JSON.stringify({
    schemaVersion: 1,
    revision,
    config: {
      providerConfigRules: { providerRules: [], templateRules: [] },
      modelConfigRules: {
        modelRules: [],
        modelApiRules: [],
        providerSiteRules: [],
        templateModelRules: [],
        builtinProviderModelRules: [],
      },
    },
  });
}

it("同内容并发启动复用固定资源且不改写文件", async () => {
  const environmentConfigRoot = await environmentRoot();
  const options = { environmentConfigRoot, content: release(1) };
  const file = await materializeDroraBuiltinProviderConfig(options);
  const before = await stat(file, { bigint: true });
  expect(
    await Promise.all(
      Array.from({ length: 8 }, () => materializeDroraBuiltinProviderConfig(options)),
    ),
  ).toEqual(Array(8).fill(file));
  expect((await stat(file, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
  expect(await readdir(dirname(file))).toEqual(["drora-builtin.json"]);
});

it("真实 Source 与资源替换共用文件锁，只见完整旧版或新版", async () => {
  const environmentConfigRoot = await environmentRoot();
  const file = await materializeDroraBuiltinProviderConfig({
    environmentConfigRoot,
    content: release(1),
  });
  const source = new NodeDroraBuiltinProviderConfigSource({ bundledFilePath: file, watch: false });
  let finished = false;
  const revisions = new Set<string>();
  const firstRead = await source.read();
  revisions.add(firstRead.revision.split(":")[1]!);
  const writer = (async () => {
    try {
      for (let index = 0; index < 30; index++) {
        await materializeDroraBuiltinProviderConfig({
          environmentConfigRoot,
          content: release((index % 2) + 1),
        });
      }
    } finally {
      finished = true;
    }
  })();
  const reader = (async () => {
    do {
      const snapshot = await source.read();
      expect(snapshot.revision).toMatch(/^drora-builtin:[12]:/u);
      expect(snapshot.providers.keys()).toEqual([]);
      revisions.add(snapshot.revision.split(":")[1]!);
    } while (!finished);
  })();
  try {
    // 即使一侧失败，也要等另一侧退出，避免 teardown 删除仍被使用的 Windows 文件。
    const results = await Promise.allSettled([writer, reader]);
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
    const finalSnapshot = await source.read();
    expect(finalSnapshot.revision).toMatch(/^drora-builtin:2:/u);
    revisions.add(finalSnapshot.revision.split(":")[1]!);
    expect([...revisions].sort()).toEqual(["1", "2"]);
    expect(await readdir(dirname(file))).toEqual(["drora-builtin.json"]);
  } finally {
    source.dispose();
  }
});

it("持有读取锁的真实文件句柄关闭后，资源替换才提交", async () => {
  const environmentConfigRoot = await environmentRoot();
  const file = await materializeDroraBuiltinProviderConfig({
    environmentConfigRoot,
    content: release(1),
  });
  const entered = Promise.withResolvers<void>();
  const releaseReader = Promise.withResolvers<void>();
  const events: string[] = [];
  const read = persistence.withFileLock(file, async () => {
    const handle = await open(file, "r");
    entered.resolve();
    try {
      await releaseReader.promise;
      expect(JSON.parse(await handle.readFile("utf8")).revision).toBe(1);
    } finally {
      await handle.close();
      events.push("reader-closed");
    }
  });
  await entered.promise;
  const actualWrite = persistence.atomicWritePrivateTextFile;
  vi.spyOn(persistence, "atomicWritePrivateTextFile").mockImplementation(async (...args) => {
    events.push("writer-commit");
    return actualWrite(...args);
  });
  const write = materializeDroraBuiltinProviderConfig({
    environmentConfigRoot,
    content: release(2),
  });
  releaseReader.resolve();
  await Promise.all([read, write]);
  expect(events).toEqual(["reader-closed", "writer-commit"]);
  expect(JSON.parse(await readFile(file, "utf8")).revision).toBe(2);
  expect(await readdir(dirname(file))).toEqual(["drora-builtin.json"]);
});

// Windows 不保证持续裸读目标时可用 POSIX rename 语义；真实 Source 的跨平台并发验收见上。
it.skipIf(process.platform === "win32")(
  "POSIX 裸读与替换并发只见完整旧版或新版，不产生 hash 历史文件",
  async () => {
    const environmentConfigRoot = await environmentRoot();
    const file = await materializeDroraBuiltinProviderConfig({
      environmentConfigRoot,
      content: release(1),
    });
    let finished = false;
    const writer = (async () => {
      try {
        for (let index = 0; index < 30; index++) {
          await materializeDroraBuiltinProviderConfig({
            environmentConfigRoot,
            content: release((index % 2) + 1),
          });
        }
      } finally {
        finished = true;
      }
    })();
    const reader = (async () => {
      do {
        const fileContent = JSON.parse(await readFile(file, "utf8"));
        expect([1, 2]).toContain(fileContent.revision);
        expect(fileContent).toEqual(JSON.parse(release(fileContent.revision)));
      } while (!finished);
    })();
    await Promise.all([writer, reader]);
    expect(await readdir(dirname(file))).toEqual(["drora-builtin.json"]);
  },
);

it("资源校验或原子写入失败时保留旧内容，错误向调用方报告", async () => {
  const environmentConfigRoot = await environmentRoot();
  const file = await materializeDroraBuiltinProviderConfig({
    environmentConfigRoot,
    content: release(1),
  });
  const before = await readFile(file, "utf8");
  await expect(
    materializeDroraBuiltinProviderConfig({ environmentConfigRoot, content: "{}" }),
  ).rejects.toThrow();
  vi.spyOn(persistence, "atomicWritePrivateTextFile").mockRejectedValueOnce(
    new Error("fixture write failure"),
  );
  await expect(
    materializeDroraBuiltinProviderConfig({ environmentConfigRoot, content: release(2) }),
  ).rejects.toThrow("fixture write failure");
  expect(await readFile(file, "utf8")).toBe(before);
  expect(await readdir(dirname(file))).toEqual(["drora-builtin.json"]);
});
