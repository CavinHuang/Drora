/**
 * 正式异步 worker 的行为测试（specs/drora-persona-system.md §4；数据合同 §2「SQLite 位于
 * 异步 worker」、实施计划 §3.B「正式 worker 最低可运行验证」）。
 *
 * 覆盖：worker 形态与在程 engine 同一 PersonaStorePort 语义（管理面＋P1b 学习面）、
 * close 幂等、open 失败透传、worker 崩溃（PM16：扩展只停不崩进程，后续调用
 * storage_unavailable）。在程 engine 的存储语义由 persona-store*.test.ts 覆盖，这里只
 * 钉传输层不改变语义。
 *
 * 运行前提：worker 入口是已编译 JS（dist/storage/persona/persona-store-worker-main.js，
 * client 从 src 运行时映射到同包 dist）；dist 缺失时先 `pnpm --dir . build`。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PERSONA_ERROR_CODES, type PersonaEditableCore } from "@drora/shared";
import {
  openWorkerPersonaStore,
  terminatePersonaWorkerForTests,
  type PersonaStorePort,
} from "../../src/storage/persona/index.js";
import { isPersonaStoreError } from "../../src/storage/persona/contract.js";

function defaultCore(): PersonaEditableCore {
  return {
    displayName: "Drora",
    selfDescription: "",
    warmth: "balanced",
    directness: "direct",
    humor: "light",
  };
}

function digest(...parts: Array<unknown>): string {
  return JSON.stringify(parts);
}

describe("persona 独立库异步 worker", () => {
  const cleanupRoots: string[] = [];

  afterEach(async () => {
    while (cleanupRoots.length > 0) {
      const root = cleanupRoots.pop();
      if (!root) continue;
      // 崩溃路径里线程被强杀时，Windows 上文件句柄的释放会晚于 exit 事件；重试清理，
      // 最终残留交给临时目录的生命周期（不据此判定测试失败）。
      let removed = false;
      for (let attempt = 0; attempt < 5 && !removed; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        removed = await rm(root, { recursive: true, force: true })
          .then(() => true)
          .catch(() => false);
      }
    }
  });

  async function makeDbPath(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "drora-persona-worker-"));
    cleanupRoots.push(root);
    const dbPath = join(root, "personas", "persona.sqlite");
    await mkdir(join(root, "personas"), { recursive: true });
    return dbPath;
  }

  async function initialize(store: PersonaStorePort, now: number): Promise<void> {
    const result = await store.initializeAuthority({
      mutationId: "init-1",
      requestDigest: digest("init"),
      now,
      initialCore: defaultCore(),
      templateVersion: 1,
    });
    expect(result.ok).toBe(true);
  }

  it("管理面经消息传递与在程 engine 同语义：初始化/快照/CAS", async () => {
    const dbPath = await makeDbPath();
    const store = await openWorkerPersonaStore({ dbPath });
    try {
      await expect(store.readSnapshot()).resolves.toEqual({ state: "uninitialized" });
      await initialize(store, 1000);

      const snapshot = await store.readSnapshot();
      expect(snapshot.state).toBe("initialized");
      if (snapshot.state !== "initialized") throw new Error("unreachable");
      expect(snapshot.authority.schemaVersion).toBeGreaterThan(0);
      expect(snapshot.core.coreRevision).toBe(1);
      expect(snapshot.policy.usePreferences).toBe(false);

      // CAS：同 revision 保存成功推进 revision；过期 revision 拒绝（语义与 engine 一致）。
      const saved = await store.updateCore({
        mutationId: "core-1",
        requestDigest: digest("core", "n1"),
        now: 1001,
        expectedRevision: 1,
        next: { ...defaultCore(), displayName: "Drora-2" },
      });
      expect(saved).toMatchObject({ ok: true, value: { status: "saved", coreRevision: 2 } });
      const conflict = await store.updateCore({
        mutationId: "core-2",
        requestDigest: digest("core", "n2"),
        now: 1002,
        expectedRevision: 1,
        next: { ...defaultCore(), displayName: "Drora-3" },
      });
      expect(conflict).toEqual({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    } finally {
      await store.close();
    }
  });

  it("P1b 学习面经同一 worker：启用策略→接收→领取→提交→落槽", async () => {
    const dbPath = await makeDbPath();
    const store = await openWorkerPersonaStore({ dbPath });
    try {
      await initialize(store, 1000);
      const policy = await store.updatePolicy({
        mutationId: "policy-1",
        requestDigest: digest("policy", true),
        now: 1001,
        expectedPolicyRevision: 0,
        usePreferences: true,
        autoLearn: true,
      });
      expect(policy).toMatchObject({ ok: true, value: { status: "saved" } });
      if (!policy.ok || policy.value.status !== "saved") throw new Error("unreachable");

      const snapshot = await store.readSnapshot();
      if (snapshot.state !== "initialized") throw new Error("unreachable");
      const accept = await store.learning.acceptLearningEvidence({
        evidenceId: "ev-worker-1",
        sourceHandle: {
          authorityId: snapshot.authority.authorityId,
          workspaceKey: "D:/workspace/example",
          sessionId: "session-1",
          productTurnId: "turn-1",
          origin: "drora-cli-local-runtime",
          sourceRevision: "rev-1",
          messageBoundary: '{"userMessageId":"u1","boundaryMessageId":"a1"}',
          branchEvidence: "active-branch",
        },
        policyEpoch: policy.value.policyEpoch,
        keyGenerations: {},
        now: 1002,
      });
      expect(accept).toMatchObject({ ok: true, value: { status: "accepted" } });
      if (!accept.ok || accept.value.status !== "accepted") throw new Error("unreachable");

      const claim = await store.learning.claimLearningWork({
        leaseOwner: "worker-test",
        leaseDurationMs: 60_000,
        now: 1003,
      });
      expect(claim).toMatchObject({ ok: true, value: { status: "claimed" } });
      if (!claim.ok || claim.value.status !== "claimed") throw new Error("unreachable");
      const { workId, fence } = claim.value.claim;

      const commit = await store.learning.commitLearningWork({
        workId,
        fence,
        candidates: [
          {
            key: "replyLanguage",
            value: "zh-CN",
            evidenceRefs: ["u1:0:8:总是用中文回我"],
          },
        ],
        now: 1004,
      });
      expect(commit).toMatchObject({
        ok: true,
        value: {
          status: "applied",
          outcomes: [{ key: "replyLanguage", outcome: "slot_written" }],
        },
      });
      // applied 提交即终态（与 engine 一致）：对同一工作的再次 settle 被拒。
      expect(
        await store.learning.settleLearningWork({ workId, fence, outcome: "applied", now: 1005 }),
      ).toMatchObject({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });

      // 第二项工作走显式 settle（no_change）路径，验证终态化也经同一 worker。
      await store.learning.acceptLearningEvidence({
        evidenceId: "ev-worker-2",
        sourceHandle: {
          authorityId: snapshot.authority.authorityId,
          workspaceKey: "D:/workspace/example",
          sessionId: "session-2",
          productTurnId: "turn-2",
          origin: "drora-cli-local-runtime",
          sourceRevision: "rev-2",
          messageBoundary: '{"userMessageId":"u2","boundaryMessageId":"a2"}',
          branchEvidence: "active-branch",
        },
        policyEpoch: policy.value.policyEpoch,
        keyGenerations: {},
        now: 1006,
      });
      const claim2 = await store.learning.claimLearningWork({
        leaseOwner: "worker-test",
        leaseDurationMs: 60_000,
        now: 1007,
      });
      expect(claim2).toMatchObject({ ok: true, value: { status: "claimed" } });
      if (!claim2.ok || claim2.value.status !== "claimed") throw new Error("unreachable");
      const settle = await store.learning.settleLearningWork({
        workId: claim2.value.claim.workId,
        fence: claim2.value.claim.fence,
        outcome: "no_change",
        now: 1008,
      });
      expect(settle).toMatchObject({ ok: true, value: { state: "no_change" } });

      // U on：inferred 槽随快照出库（provenance=extraction）。
      const after = await store.readSnapshot();
      if (after.state !== "initialized") throw new Error("unreachable");
      expect(after.preferences).toHaveLength(1);
      expect(after.preferences[0]).toMatchObject({
        key: "replyLanguage",
        value: "zh-CN",
        provenanceKind: "extraction",
      });
    } finally {
      await store.close();
    }
  });

  it("同库两个 worker 实例共享事实（多实例经文件锁/WAL 协调）", async () => {
    const dbPath = await makeDbPath();
    const first = await openWorkerPersonaStore({ dbPath });
    const second = await openWorkerPersonaStore({ dbPath });
    try {
      await initialize(first, 1000);
      // 第二实例（独立 worker 线程）读到同一 authority：同根一个身份（PM27）。
      const snapshot = await second.readSnapshot();
      expect(snapshot.state).toBe("initialized");
      // CAS 跨实例生效：第二实例以过期 revision 写入被拒。
      const conflict = await second.updateCore({
        mutationId: "core-x",
        requestDigest: digest("core", "x"),
        now: 1001,
        expectedRevision: 99,
        next: defaultCore(),
      });
      expect(conflict).toEqual({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("close 之后调用按 storage_unavailable 拒绝；close 幂等", async () => {
    const dbPath = await makeDbPath();
    const store = await openWorkerPersonaStore({ dbPath });
    await initialize(store, 1000);
    await store.close();
    await expect(store.close()).resolves.toBeUndefined();
    const error = await store.readSnapshot().catch((thrown: unknown) => thrown);
    expect(isPersonaStoreError(error)).toBe(true);
    if (isPersonaStoreError(error)) {
      expect(error.code).toBe(PERSONA_ERROR_CODES.storageUnavailable);
    }
  });

  it("open 失败按原错误码透传（目录被文件占位时无法建库）", async () => {
    const root = await mkdtemp(join(tmpdir(), "drora-persona-worker-"));
    cleanupRoots.push(root);
    // 一个已存在的文件占据了目录位置：worker 内 mkdir 失败 → open-failed → storage_unavailable。
    const blocker = join(root, "blocker");
    await writeFile(blocker, "not a directory", "utf8");
    const dbPath = join(blocker, "personas", "persona.sqlite");
    const error = await openWorkerPersonaStore({ dbPath }).catch((thrown: unknown) => thrown);
    expect(isPersonaStoreError(error)).toBe(true);
    if (isPersonaStoreError(error)) {
      expect(error.code).toBe(PERSONA_ERROR_CODES.storageUnavailable);
      expect(error.message).toContain("Failed to open persona database");
    }
  });

  it("空 dbPath 在 spawn 前拒绝（不启动线程）", async () => {
    const error = await openWorkerPersonaStore({ dbPath: "" }).catch((thrown: unknown) => thrown);
    expect(isPersonaStoreError(error)).toBe(true);
    if (isPersonaStoreError(error)) {
      expect(error.code).toBe(PERSONA_ERROR_CODES.storageUnavailable);
      expect(error.message).toContain("caller-provided database path");
    }
  });

  it("worker 崩溃：后续请求按 storage_unavailable 拒绝，进程不崩，close 幂等", async () => {
    const dbPath = await makeDbPath();
    const store = await openWorkerPersonaStore({ dbPath });
    await initialize(store, 1000);
    // 模拟 worker 意外终止（不经 close 请求）：在飞/后续请求只能得到环境故障。
    await terminatePersonaWorkerForTests(store);
    // 终止后短暂让位，让 exit 事件先落地（markBroken）。
    await new Promise((resolve) => setTimeout(resolve, 50));
    const error = await store.readSnapshot().catch((thrown: unknown) => thrown);
    expect(isPersonaStoreError(error)).toBe(true);
    if (isPersonaStoreError(error)) {
      expect(error.code).toBe(PERSONA_ERROR_CODES.storageUnavailable);
      expect(error.message).toContain("exited unexpectedly");
    }
    // close 在 broken 态是幂等成功（库随线程消亡），不抛错也不悬挂。
    await expect(store.close()).resolves.toBeUndefined();
  });
});
