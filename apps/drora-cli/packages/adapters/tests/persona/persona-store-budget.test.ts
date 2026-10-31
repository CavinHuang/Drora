import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSONA_TEMPLATE_VERSION, type PersonaEditableCore } from "@drora/shared";
import {
  isPersonaStoreError,
  openPersonaStore,
  type PersonaStorePort,
} from "../../src/storage/persona/index.js";
// 分类器直接从模块文件导入（与 migrations.js 的测试导入先例一致），保持公开入口最小面。
import { toPersonaStoreError } from "../../src/storage/persona/persona-store.js";

// 从 persona-store.test.ts 拆出（architecture-policy maxFileLines 800）：容量语义与
// 锁预算/超时语义共享同一临时库 fixture，合并在本文件验证（合同 §2）。
const DAY_MS = 24 * 60 * 60 * 1000;

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

describe("persona 独立库仓储：receipt 容量与锁预算语义（切片 B）", () => {
  let root: string;
  let dbPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-store-budget-"));
    dbPath = join(root, "personas", "persona.sqlite");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("receipt 容量语义（注入小上限验证 4096/7 天合同）", () => {
    function smallStore(): Promise<PersonaStorePort> {
      return openPersonaStore({
        dbPath,
        receiptMaxPerAuthority: 3,
        receiptRetentionMs: 7 * DAY_MS,
      });
    }

    async function fillToCap(store: PersonaStorePort): Promise<void> {
      await store.initializeAuthority({
        initialCore: defaultCore(),
        mutationId: "init",
        now: 0,
        requestDigest: digest("init"),
        templateVersion: PERSONA_TEMPLATE_VERSION,
      });
      // receipt: init(authority) + 两个 core 变更 = 3 条，达到注入上限。
      for (const [index, name] of ["a", "b"].entries()) {
        const saved = await store.updateCore({
          expectedRevision: 1 + index,
          mutationId: `core-${name}`,
          next: { ...defaultCore(), displayName: `name-${name}` },
          now: (index + 1) * DAY_MS,
          requestDigest: digest(`core-${name}`),
        });
        expect(saved).toMatchObject({ ok: true });
      }
    }

    it("达到上限且无过期项时拒绝新管理写并返回 storage_capacity；窗口内凭据不驱逐", async () => {
      const store = await smallStore();
      try {
        await fillToCap(store);
        const rejected = await store.updateCore({
          expectedRevision: 3,
          mutationId: "core-c",
          next: { ...defaultCore(), displayName: "name-c" },
          now: 2 * DAY_MS,
          requestDigest: digest("core-c"),
        });
        expect(rejected).toEqual({ ok: false, code: "storage_capacity" });
        const raw = new DatabaseSync(dbPath);
        try {
          // 窗口内的幂等凭据全部保留（不驱逐）。
          expect(
            raw.prepare("select count(*) as n from persona_mutation_receipt").get(),
          ).toEqual({ n: 3 });
          expect(
            raw.prepare("select core_revision as r from persona_core where id = 1").get(),
          ).toEqual({ r: 3 });
        } finally {
          raw.close();
        }
      } finally {
        await store.close();
      }
    });

    it("存在过期项时先清理再写入：窗口外凭据可清除，窗口内保留", async () => {
      const store = await smallStore();
      try {
        await fillToCap(store);
        // now=9d 的 7 天窗口截止 2d：init(0d) 与 core-a(1d) 过期被清，core-b(2d) 恰在边界保留。
        const accepted = await store.updateCore({
          expectedRevision: 3,
          mutationId: "core-c",
          next: { ...defaultCore(), displayName: "name-c" },
          now: 9 * DAY_MS,
          requestDigest: digest("core-c"),
        });
        expect(accepted).toEqual({ ok: true, value: { status: "saved", coreRevision: 4 } });
        const raw = new DatabaseSync(dbPath);
        try {
          const rows = raw
            .prepare("select mutation_id from persona_mutation_receipt order by mutation_id")
            .all()
            .map((row) => (row as { mutation_id: string }).mutation_id);
          expect(rows).toEqual(["core-b", "core-c"]);
        } finally {
          raw.close();
        }
      } finally {
        await store.close();
      }
    });

    it("过期清理移除回执后，同 mutationId 重放必须过 CAS：旧 expectedRevision 返回 revision_conflict", async () => {
      // 合同 §2「7 天外重复提交不保证回放原结果，仍须通过 expectedRevision；失效回执
      // 不能绕过 CAS」：清理把 core-a 的回执移除后，同一 mutationId 携带当年旧前置
      // revision 重放，不得按已消失的凭据回放 saved，而是作为全新变更走 CAS 被拒。
      const store = await smallStore();
      try {
        await fillToCap(store); // init(rev1) + core-a(rev2) + core-b(rev3)，receipt 已达上限 3
        // now=9d 清理窗口外 init(0d)/core-a(1d)，保留 core-b(2d)，并写入 core-c → rev4。
        const accepted = await store.updateCore({
          expectedRevision: 3,
          mutationId: "core-c",
          next: { ...defaultCore(), displayName: "name-c" },
          now: 9 * DAY_MS,
          requestDigest: digest("core-c"),
        });
        expect(accepted).toEqual({ ok: true, value: { status: "saved", coreRevision: 4 } });
        const staleReplay = await store.updateCore({
          expectedRevision: 1, // core-a 当年保存时的前置 revision
          mutationId: "core-a",
          next: { ...defaultCore(), displayName: "name-a" },
          now: 9 * DAY_MS + 1,
          requestDigest: digest("core-a"),
        });
        expect(staleReplay).toEqual({ ok: false, code: "revision_conflict" });
        // 被拒重放不推进 revision、不改内容、不重新落回执。
        await expect(store.readSnapshot()).resolves.toMatchObject({
          state: "initialized",
          core: { coreRevision: 4, core: { displayName: "name-c" } },
        });
        const raw = new DatabaseSync(dbPath);
        try {
          expect(
            raw
              .prepare(
                "select count(*) as n from persona_mutation_receipt where mutation_id = 'core-a'",
              )
              .get(),
          ).toEqual({ n: 0 });
        } finally {
          raw.close();
        }
      } finally {
        await store.close();
      }
    });

    it("容量满的拒绝不影响既有 receipt 的回放（幂等凭据仍有效）", async () => {
      const store = await smallStore();
      try {
        await fillToCap(store);
        // 已见过的 mutationId 即使库满也按回执回放，不需要新容量。
        const replay = await store.updateCore({
          expectedRevision: 3,
          mutationId: "core-b",
          next: { ...defaultCore(), displayName: "name-b" },
          now: 2 * DAY_MS,
          requestDigest: digest("core-b"),
        });
        expect(replay).toEqual({ ok: true, value: { status: "saved", coreRevision: 3 } });
      } finally {
        await store.close();
      }
    });
  });

  describe("锁预算与超时语义（合同 §2）", () => {
    it("写请求拿不到锁且预算耗尽：outcome_unknown（不谎报失败或成功）", async () => {
      const store = await openPersonaStore({
        dbPath,
        lockWaitTimeoutMs: 10,
        adminRequestBudgetMs: 60,
      });
      try {
        await store.initializeAuthority({
          initialCore: defaultCore(),
          mutationId: "init",
          now: 1_000,
          requestDigest: digest("init"),
          templateVersion: PERSONA_TEMPLATE_VERSION,
        });
        // 另一连接持有写事务，模拟跨进程竞争。
        const holder = new DatabaseSync(dbPath, { timeout: 10 });
        try {
          holder.exec("begin immediate");
          const error = await store
            .updateCore({
              expectedRevision: 1,
              mutationId: "core-contended",
              next: { ...defaultCore(), displayName: "Dro" },
              now: 2_000,
              requestDigest: digest("core-contended"),
            })
            .catch((error: unknown) => error);
          expect(isPersonaStoreError(error)).toBe(true);
          if (!isPersonaStoreError(error)) return;
          expect(error.code).toBe("outcome_unknown");
        } finally {
          holder.exec("rollback");
          holder.close();
        }
        // 锁释放后，同 mutationId 重试正常保存（重试安全）。
        const retried = await store.updateCore({
          expectedRevision: 1,
          mutationId: "core-contended",
          next: { ...defaultCore(), displayName: "Dro" },
          now: 3_000,
          requestDigest: digest("core-contended"),
        });
        expect(retried).toEqual({ ok: true, value: { status: "saved", coreRevision: 2 } });
      } finally {
        await store.close();
      }
    });

    it("真实 SQLITE_BUSY 错误对象的读/写分类：读→storage_unavailable，写→outcome_unknown", async () => {
      // WAL 读事务不与写者互斥，读侧 BUSY 无法在本进程对已附加连接稳定复现（实测：
      // 持锁连接一旦设置 locking_mode=exclusive，其 begin immediate 自身先撞 BUSY——
      // store 连接写过 WAL 后 wal-index 已附加；见评审记录）。这里用写者与写者的真实
      // 碰撞产生货真价实的 SQLITE_BUSY（errcode 5）错误对象，再交给生产分类器
      // toPersonaStoreError（即 withTxn 使用的同一分类路径）按读/写分别断言。
      await mkdir(dirname(dbPath), { recursive: true });
      const holder = new DatabaseSync(dbPath, { timeout: 10 });
      const contender = new DatabaseSync(dbPath, { timeout: 10 });
      try {
        // 冲突语义与表无关；直接在空的 persona 库文件上制造写者-写者碰撞。
        holder.exec("begin immediate");
        let busyError: unknown;
        try {
          contender.exec("begin immediate");
        } catch (error) {
          busyError = error;
        }
        if (busyError === undefined) {
          throw new Error("expected contender's begin immediate to fail with SQLITE_BUSY");
        }
        expect(busyError).toMatchObject({ errcode: 5 });
        const readSide = toPersonaStoreError(busyError, { write: false, dbPath });
        expect(readSide).toMatchObject({
          name: "PersonaStoreError",
          code: "storage_unavailable",
          dbPath,
        });
        expect(readSide.cause).toBe(busyError);
        expect(toPersonaStoreError(busyError, { write: true, dbPath })).toMatchObject({
          name: "PersonaStoreError",
          code: "outcome_unknown",
        });
      } finally {
        holder.exec("rollback");
        holder.close();
        contender.close();
      }
    });

    it("读路径的 storage_unavailable 分类：store 已关闭时拒绝且不伪装业务结果", async () => {
      // closed 分支走同一 PersonaStoreError 通道，补充验证读侧环境故障不会伪装成业务结果。
      const store = await openPersonaStore({ dbPath });
      await store.close();
      const error = await store.readSnapshot().catch((error: unknown) => error);
      expect(isPersonaStoreError(error)).toBe(true);
      if (!isPersonaStoreError(error)) return;
      expect(error.code).toBe("storage_unavailable");
    });
  });
});
