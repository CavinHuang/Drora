import { afterAll, vi } from "vitest";

// 调试读取必须留在用户数据目录内；隔离测试 home，保留生产路径边界。
const fixture = await vi.hoisted(async () => {
  const { mkdtempSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "drora-debug-home-"));
  const data = join(home, ".drora");
  mkdirSync(data);
  return { home, data };
});

vi.mock("node:os", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:os")>(),
  homedir: () => fixture.home,
  tmpdir: () => fixture.data,
}));

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(fixture.home, { recursive: true, force: true });
});
