// Bundled 本地根优先级测试（specs/mobile-relay-server.md §12.5 修订 +
// specs/mobile-relay-r3-frontend.md §13.4）：候选序 = dist 源码应用 → src/recovered 快照
// → null（内建代理兜底）；以 entry（remote/v4/index.html）存在性为启用判据。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pickBundledMobileRoot } from "../src/bundledMobileRoot.js";

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function makeRootWithEntry(suffix: string, withEntry: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `mobile-root-${suffix}-`));
  tempDirs.push(dir);
  if (withEntry) {
    await mkdir(join(dir, "remote", "v4"), { recursive: true });
    await writeFile(join(dir, "remote", "v4", "index.html"), "<!doctype html>");
  }
  return dir;
}

test("优先级：dist 源码应用入口存在时压过 recovered 快照", async () => {
  const distRoot = await makeRootWithEntry("dist", true);
  const recoveredRoot = await makeRootWithEntry("recovered", true);
  assert.equal(await pickBundledMobileRoot([distRoot, recoveredRoot]), distRoot);
});

test("回退：dist 缺入口时落 recovered 快照（D7 行为保底）", async () => {
  const distRoot = await makeRootWithEntry("dist-empty", false);
  const recoveredRoot = await makeRootWithEntry("recovered2", true);
  assert.equal(await pickBundledMobileRoot([distRoot, recoveredRoot]), recoveredRoot);
});

test("全缺失：返回 null（调用方落回内建资产代理）", async () => {
  const emptyA = await makeRootWithEntry("empty-a", false);
  const emptyB = await makeRootWithEntry("empty-b", false);
  assert.equal(await pickBundledMobileRoot([emptyA, emptyB]), null);
  assert.equal(await pickBundledMobileRoot([]), null);
});
