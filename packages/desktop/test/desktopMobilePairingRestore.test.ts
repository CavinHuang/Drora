import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  MobilePairingRestoreStore,
  shouldRestorePairing,
  workspaceKeyOf,
} from "../src/main/desktopMobilePairingRestore.js";

// 启动恢复（对齐原版 webRemoteControlLastEnabledContext / restorePreviouslyEnabled）：
// 持久化单键上下文；判定 = 有上下文 && 服务未运行 && 本次运行未 start 过 && 工作区匹配。

const tempDirs: string[] = [];

async function createStore() {
  const dir = await mkdtemp(join(tmpdir(), "drora-pairing-restore-"));
  tempDirs.push(dir);
  return { dir, store: new MobilePairingRestoreStore(dir) };
}

after(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restore store：save/load 往返，clear 后视为无上下文", async () => {
  const { store } = await createStore();
  assert.equal(await store.load(), null, "初始状态无上下文");

  await store.save({ workspacePath: "C:/demo", workspaceIdentity: "identity-1" });
  assert.deepEqual(await store.load(), {
    workspacePath: "C:/demo",
    workspaceIdentity: "identity-1",
  });

  await store.clear();
  assert.equal(await store.load(), null);
});

test("restore store：损坏文件按无上下文处理，不抛错", async () => {
  const { dir, store } = await createStore();
  await writeFile(join(dir, "mobile-pairing-last-enabled-context.json"), "{broken", "utf-8");
  assert.equal(await store.load(), null);
});

test("restore store：workspacePath 为空的记录视为无上下文", async () => {
  const { dir, store } = await createStore();
  await writeFile(
    join(dir, "mobile-pairing-last-enabled-context.json"),
    JSON.stringify({ workspacePath: "   " }),
    "utf-8",
  );
  assert.equal(await store.load(), null);
});

test("shouldRestorePairing：工作区按 identity key 匹配", () => {
  const saved = { workspacePath: "C:/demo", workspaceIdentity: "identity-1" };
  assert.ok(
    shouldRestorePairing({
      saved,
      serviceRunning: false,
      alreadyStartedThisRun: false,
      hostWorkspace: { workspacePath: "D:/other", workspaceIdentity: "identity-1" },
    }),
    "identity 命中即恢复（同 key 优先于路径）",
  );
  assert.ok(
    !shouldRestorePairing({
      saved,
      serviceRunning: false,
      alreadyStartedThisRun: false,
      hostWorkspace: { workspacePath: "C:/demo", workspaceIdentity: "identity-2" },
    }),
    "identity 不同则不恢复",
  );
});

test("shouldRestorePairing：路径 fallback 匹配（无 identity）", () => {
  assert.ok(
    shouldRestorePairing({
      saved: { workspacePath: "C:/demo" },
      serviceRunning: false,
      alreadyStartedThisRun: false,
      hostWorkspace: { workspacePath: "C:/demo" },
    }),
  );
  assert.ok(
    !shouldRestorePairing({
      saved: { workspacePath: "C:/demo" },
      serviceRunning: false,
      alreadyStartedThisRun: false,
      hostWorkspace: { workspacePath: "D:/other" },
    }),
  );
});

test("shouldRestorePairing：服务运行中/本次已 start 过/无 Host 工作区时不恢复", () => {
  const saved = { workspacePath: "C:/demo" };
  const hostWorkspace = { workspacePath: "C:/demo" };
  assert.ok(
    !shouldRestorePairing({
      saved,
      serviceRunning: true,
      alreadyStartedThisRun: false,
      hostWorkspace,
    }),
  );
  assert.ok(
    !shouldRestorePairing({
      saved,
      serviceRunning: false,
      alreadyStartedThisRun: true,
      hostWorkspace,
    }),
  );
  assert.ok(
    !shouldRestorePairing({
      saved,
      serviceRunning: false,
      alreadyStartedThisRun: false,
      hostWorkspace: undefined,
    }),
  );
  assert.ok(!shouldRestorePairing({ saved: null, serviceRunning: false, alreadyStartedThisRun: false, hostWorkspace }));
});

test("workspaceKeyOf：identity 优先、空白回退路径", () => {
  assert.equal(workspaceKeyOf({ workspacePath: "C:/demo", workspaceIdentity: " id " }), "id");
  assert.equal(workspaceKeyOf({ workspacePath: "C:/demo" }), "C:/demo");
  assert.equal(workspaceKeyOf({ workspacePath: "  " }), null);
  assert.equal(workspaceKeyOf({}), null);
});
