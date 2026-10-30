import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PERSONA_RECEIPT_SCOPES,
  PERSONA_STORE_SCHEMA_VERSION,
  PERSONA_TEMPLATE_VERSION,
  type PersonaEditableCore,
} from "@drora/shared";
import {
  PERSONA_STORE_DEFAULTS,
  isPersonaStoreError,
  openPersonaStore,
  type PersonaStorePort,
} from "../../src/storage/persona/index.js";
import { PERSONA_MIGRATIONS } from "../../src/storage/persona/migrations.js";

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

describe("persona 独立库仓储（切片 B）", () => {
  let root: string;
  let dbPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-store-"));
    dbPath = join(root, "personas", "persona.sqlite");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("打开、未初始化与关闭", () => {
    it("全新路径打开成功且不创建任何 authority 事实；三类表已迁移就位", async () => {
      const store = await openPersonaStore({ dbPath });
      try {
        await expect(store.readSnapshot()).resolves.toEqual({ state: "uninitialized" });
        const raw = new DatabaseSync(dbPath);
        try {
          const tables = raw
            .prepare(
              "select name from sqlite_master where type='table' and name like 'persona_%' order by name",
            )
            .all()
            .map((row) => (row as { name: string }).name);
          expect(tables).toEqual([
            "persona_authority",
            "persona_core",
            "persona_mutation_receipt",
          ]);
        } finally {
          raw.close();
        }
      } finally {
        await store.close();
      }
    });

    it("关闭后的调用以 storage_unavailable 拒绝，不伪装成业务结果", async () => {
      const store = await openPersonaStore({ dbPath });
      await store.close();
      await expect(store.readSnapshot()).rejects.toMatchObject({
        name: "PersonaStoreError",
        code: "storage_unavailable",
      });
    });

    it("重复打开同一库不重复迁移，数据保持（migration runner 幂等）", async () => {
      const first = await openPersonaStore({ dbPath });
      const initialized = await first.initializeAuthority({
        initialCore: defaultCore(),
        mutationId: "m-1",
        now: 1_000,
        requestDigest: digest("m-1"),
        templateVersion: PERSONA_TEMPLATE_VERSION,
      });
      expect(initialized.ok).toBe(true);
      await first.close();

      const second = await openPersonaStore({ dbPath });
      try {
        await expect(second.readSnapshot()).resolves.toMatchObject({
          state: "initialized",
          authority: { schemaVersion: PERSONA_STORE_SCHEMA_VERSION },
        });
      } finally {
        await second.close();
      }
    });
  });

  describe("authority 单例与并发初始化", () => {
    it("首次显式初始化原子生成 authority+默认核心+created 回执", async () => {
      const store = await openPersonaStore({ dbPath });
      try {
        const result = await store.initializeAuthority({
          initialCore: defaultCore(),
          mutationId: "init-1",
          now: 1_000,
          requestDigest: digest("init-1"),
          templateVersion: PERSONA_TEMPLATE_VERSION,
        });
        expect(result).toEqual({
          ok: true,
          value: {
            status: "created",
            snapshot: {
              state: "initialized",
              authority: {
                authorityId: expect.any(String),
                personaId: expect.any(String),
                schemaVersion: PERSONA_STORE_SCHEMA_VERSION,
                createdAt: 1_000,
              },
              core: {
                coreRevision: 1,
                templateVersion: PERSONA_TEMPLATE_VERSION,
                core: defaultCore(),
                updatedAt: 1_000,
              },
            },
          },
        });
        if (!result.ok) return;
        // opaque ID 不从昵称/cwd/用户文本推导：应为随机 UUID 形态。
        expect(result.value.snapshot.authority.authorityId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        expect(result.value.snapshot.authority.personaId).not.toBe(
          result.value.snapshot.authority.authorityId,
        );
      } finally {
        await store.close();
      }
    });

    it("不同 mutationId 的第二次初始化并发幂等：unchanged，不生成第二个 authority", async () => {
      const store = await openPersonaStore({ dbPath });
      try {
        const first = await store.initializeAuthority({
          initialCore: defaultCore(),
          mutationId: "init-1",
          now: 1_000,
          requestDigest: digest("init-1"),
          templateVersion: PERSONA_TEMPLATE_VERSION,
        });
        expect(first.ok).toBe(true);
        const second = await store.initializeAuthority({
          initialCore: defaultCore(),
          mutationId: "init-2",
          now: 2_000,
          requestDigest: digest("init-2"),
          templateVersion: PERSONA_TEMPLATE_VERSION,
        });
        expect(second).toMatchObject({ ok: true, value: { status: "unchanged" } });
        if (!second.ok || !first.ok) return;
        expect(second.value.snapshot.authority.authorityId).toBe(
          first.value.snapshot.authority.authorityId,
        );
        const raw = new DatabaseSync(dbPath);
        try {
          expect(
            raw.prepare("select count(*) as n from persona_authority").get(),
          ).toEqual({ n: 1 });
        } finally {
          raw.close();
        }
      } finally {
        await store.close();
      }
    });

    it("同 mutationId 同摘要重放 created 结果；同 ID 异摘要返回 mutation_conflict", async () => {
      const store = await openPersonaStore({ dbPath });
      try {
        const first = await store.initializeAuthority({
          initialCore: defaultCore(),
          mutationId: "init-1",
          now: 1_000,
          requestDigest: digest("init-1"),
          templateVersion: PERSONA_TEMPLATE_VERSION,
        });
        expect(first.ok).toBe(true);
        const replay = await store.initializeAuthority({
          initialCore: defaultCore(),
          mutationId: "init-1",
          now: 9_000,
          requestDigest: digest("init-1"),
          templateVersion: PERSONA_TEMPLATE_VERSION,
        });
        // 合同 §2：同作用域同 ID 同摘要返回先前结果（created 原样回放）。
        expect(replay).toMatchObject({ ok: true, value: { status: "created" } });
        if (replay.ok && first.ok) {
          expect(replay.value.snapshot.authority.authorityId).toBe(
            first.value.snapshot.authority.authorityId,
          );
          // 回执 createdAt 不被重放改写。
          expect(replay.value.snapshot.authority.createdAt).toBe(1_000);
        }
        const conflict = await store.initializeAuthority({
          initialCore: defaultCore(),
          mutationId: "init-1",
          now: 9_000,
          requestDigest: digest("different-payload"),
          templateVersion: PERSONA_TEMPLATE_VERSION,
        });
        expect(conflict).toEqual({ ok: false, code: "mutation_conflict" });
      } finally {
        await store.close();
      }
    });

    it("两个连接并发初始化：恰好一个 created，authority 单例不被破坏", async () => {
      const a = await openPersonaStore({ dbPath });
      const b = await openPersonaStore({ dbPath });
      try {
        const [ra, rb] = await Promise.all([
          a.initializeAuthority({
            initialCore: defaultCore(),
            mutationId: "init-a",
            now: 1_000,
            requestDigest: digest("init-a"),
            templateVersion: PERSONA_TEMPLATE_VERSION,
          }),
          b.initializeAuthority({
            initialCore: defaultCore(),
            mutationId: "init-b",
            now: 1_000,
            requestDigest: digest("init-b"),
            templateVersion: PERSONA_TEMPLATE_VERSION,
          }),
        ]);
        expect(ra.ok && rb.ok).toBe(true);
        if (ra.ok && rb.ok) {
          const statuses = [ra.value.status, rb.value.status].sort();
          expect(statuses).toEqual(["created", "unchanged"]);
          expect(ra.value.snapshot.authority.authorityId).toBe(
            rb.value.snapshot.authority.authorityId,
          );
        }
      } finally {
        await a.close();
        await b.close();
      }
    });

    it("两个连接并发提交同一 mutationId：一个 created 一个回放，单例唯一", async () => {
      const a = await openPersonaStore({ dbPath, lockWaitTimeoutMs: 10 });
      const b = await openPersonaStore({ dbPath, lockWaitTimeoutMs: 10 });
      try {
        const input = {
          initialCore: defaultCore(),
          mutationId: "init-same",
          now: 1_000,
          requestDigest: digest("init-same"),
          templateVersion: PERSONA_TEMPLATE_VERSION,
        };
        const [ra, rb] = await Promise.all([a.initializeAuthority(input), b.initializeAuthority(input)]);
        expect(ra.ok && rb.ok).toBe(true);
        if (ra.ok && rb.ok) {
          expect(ra.value.status).toBe("created");
          expect(rb.value.status).toBe("created");
          expect(ra.value.snapshot.authority.authorityId).toBe(
            rb.value.snapshot.authority.authorityId,
          );
        }
        const raw = new DatabaseSync(dbPath);
        try {
          expect(raw.prepare("select count(*) as n from persona_authority").get()).toEqual({ n: 1 });
          expect(
            raw.prepare("select count(*) as n from persona_mutation_receipt").get(),
          ).toEqual({ n: 1 });
        } finally {
          raw.close();
        }
      } finally {
        await a.close();
        await b.close();
      }
    });
  });

  describe("core CAS 语义", () => {
    async function initializedStore(): Promise<PersonaStorePort> {
      const store = await openPersonaStore({ dbPath });
      const result = await store.initializeAuthority({
        initialCore: defaultCore(),
        mutationId: "init",
        now: 1_000,
        requestDigest: digest("init"),
        templateVersion: PERSONA_TEMPLATE_VERSION,
      });
      if (!result.ok) throw new Error(`fixture init failed: ${result.code}`);
      return store;
    }

    it("expectedRevision 不匹配返回 revision_conflict，不推进 revision 也不写 receipt", async () => {
      const store = await initializedStore();
      try {
        const conflict = await store.updateCore({
          expectedRevision: 99,
          mutationId: "core-1",
          next: { ...defaultCore(), displayName: "Dro" },
          now: 2_000,
          requestDigest: digest("core-1"),
        });
        expect(conflict).toEqual({ ok: false, code: "revision_conflict" });
        await expect(store.readSnapshot()).resolves.toMatchObject({
          state: "initialized",
          core: { coreRevision: 1 },
        });
        const raw = new DatabaseSync(dbPath);
        try {
          expect(
            raw
              .prepare("select count(*) as n from persona_mutation_receipt where scope = 'core'")
              .get(),
          ).toEqual({ n: 0 });
        } finally {
          raw.close();
        }
      } finally {
        await store.close();
      }
    });

    it("匹配的 expectedRevision 保存为新 revision；内容未变的有效保存返回 unchanged 不新增 revision", async () => {
      const store = await initializedStore();
      try {
        const saved = await store.updateCore({
          expectedRevision: 1,
          mutationId: "core-1",
          next: { ...defaultCore(), displayName: "Dro", warmth: "warm" },
          now: 2_000,
          requestDigest: digest("core-1"),
        });
        expect(saved).toEqual({ ok: true, value: { status: "saved", coreRevision: 2 } });
        await expect(store.readSnapshot()).resolves.toMatchObject({
          state: "initialized",
          core: {
            coreRevision: 2,
            core: { displayName: "Dro", warmth: "warm", directness: "direct", humor: "light" },
            updatedAt: 2_000,
          },
        });

        const unchanged = await store.updateCore({
          expectedRevision: 2,
          mutationId: "core-2",
          next: { ...defaultCore(), displayName: "Dro", warmth: "warm" },
          now: 3_000,
          requestDigest: digest("core-2"),
        });
        expect(unchanged).toEqual({ ok: true, value: { status: "unchanged" } });
        await expect(store.readSnapshot()).resolves.toMatchObject({
          state: "initialized",
          core: { coreRevision: 2 },
        });
      } finally {
        await store.close();
      }
    });

    it("同实例重叠管理调用经进程内队列串行化：落败方得到 revision_conflict 而非 storage_unavailable", async () => {
      // 回归：node:sqlite 单连接上重叠的事务会报 errcode 1「cannot start a transaction
      // within a transaction」，曾被误分类为 storage_unavailable（把内部串行化缺陷伪装成
      // 环境故障）。串行化后两个请求都得到真实业务裁决：同 expectedRevision 竞争，恰好
      // 一个 saved，另一个按 CAS 返回 revision_conflict。
      const store = await initializedStore();
      try {
        const [ra, rb] = await Promise.all([
          store.updateCore({
            expectedRevision: 1,
            mutationId: "core-race-a",
            next: { ...defaultCore(), displayName: "race-a" },
            now: 2_000,
            requestDigest: digest("core-race-a"),
          }),
          store.updateCore({
            expectedRevision: 1,
            mutationId: "core-race-b",
            next: { ...defaultCore(), displayName: "race-b" },
            now: 2_000,
            requestDigest: digest("core-race-b"),
          }),
        ]);
        const results = [ra, rb];
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.find((result) => !result.ok)).toEqual({
          ok: false,
          code: "revision_conflict",
        });
        await expect(store.readSnapshot()).resolves.toMatchObject({
          state: "initialized",
          core: { coreRevision: 2 },
        });
        const raw = new DatabaseSync(dbPath);
        try {
          expect(
            raw
              .prepare("select count(*) as n from persona_mutation_receipt where scope = 'core'")
              .get(),
          ).toEqual({ n: 1 });
        } finally {
          raw.close();
        }
      } finally {
        await store.close();
      }
    });

    it("未初始化的库上 updateCore 返回 uninitialized，不落任何行", async () => {
      const store = await openPersonaStore({ dbPath });
      try {
        const result = await store.updateCore({
          expectedRevision: 1,
          mutationId: "core-x",
          next: defaultCore(),
          now: 1_000,
          requestDigest: digest("core-x"),
        });
        expect(result).toEqual({ ok: false, code: "uninitialized" });
        const raw = new DatabaseSync(dbPath);
        try {
          expect(raw.prepare("select count(*) as n from persona_core").get()).toEqual({ n: 0 });
          expect(raw.prepare("select count(*) as n from persona_mutation_receipt").get()).toEqual({
            n: 0,
          });
        } finally {
          raw.close();
        }
      } finally {
        await store.close();
      }
    });
  });

  describe("receipt 幂等三态", () => {
    it("同 ID 同摘要重放 saved：返回记录时的 revision，即使核心后来又被推进", async () => {
      const store = await openPersonaStore({ dbPath });
      try {
        await store.initializeAuthority({
          initialCore: defaultCore(),
          mutationId: "init",
          now: 1_000,
          requestDigest: digest("init"),
          templateVersion: PERSONA_TEMPLATE_VERSION,
        });
        const first = await store.updateCore({
          expectedRevision: 1,
          mutationId: "core-1",
          next: { ...defaultCore(), displayName: "Dro" },
          now: 2_000,
          requestDigest: digest("core-1"),
        });
        expect(first).toMatchObject({ ok: true, value: { status: "saved", coreRevision: 2 } });
        await store.updateCore({
          expectedRevision: 2,
          mutationId: "core-2",
          next: { ...defaultCore(), displayName: "Drora Prime" },
          now: 3_000,
          requestDigest: digest("core-2"),
        });
        // 网络/响应迟到后的同 ID 重试（PM53）：回放当时的结果，不重复提交。
        const replay = await store.updateCore({
          expectedRevision: 1,
          mutationId: "core-1",
          next: { ...defaultCore(), displayName: "Dro" },
          now: 9_000,
          requestDigest: digest("core-1"),
        });
        expect(replay).toEqual({ ok: true, value: { status: "saved", coreRevision: 2 } });
        await expect(store.readSnapshot()).resolves.toMatchObject({
          state: "initialized",
          core: { coreRevision: 3, core: { displayName: "Drora Prime" } },
        });
      } finally {
        await store.close();
      }
    });

    it("同 ID 异摘要返回 mutation_conflict；unchanged 回执按 unchanged 回放", async () => {
      const store = await openPersonaStore({ dbPath });
      try {
        await store.initializeAuthority({
          initialCore: defaultCore(),
          mutationId: "init",
          now: 1_000,
          requestDigest: digest("init"),
          templateVersion: PERSONA_TEMPLATE_VERSION,
        });
        const unchanged = await store.updateCore({
          expectedRevision: 1,
          mutationId: "core-same",
          next: defaultCore(),
          now: 2_000,
          requestDigest: digest("core-same"),
        });
        expect(unchanged).toEqual({ ok: true, value: { status: "unchanged" } });
        const replay = await store.updateCore({
          expectedRevision: 1,
          mutationId: "core-same",
          next: defaultCore(),
          now: 3_000,
          requestDigest: digest("core-same"),
        });
        expect(replay).toEqual({ ok: true, value: { status: "unchanged" } });
        const conflict = await store.updateCore({
          expectedRevision: 1,
          mutationId: "core-same",
          next: { ...defaultCore(), displayName: "Other" },
          now: 3_000,
          requestDigest: digest("other-content"),
        });
        expect(conflict).toEqual({ ok: false, code: "mutation_conflict" });
      } finally {
        await store.close();
      }
    });
  });

  describe("损坏库与未初始化的区分（PM55）", () => {
    it("垃圾字节的库文件：schema_incompatible，不做任何降级写", async () => {
      await mkdir(dirname(dbPath), { recursive: true });
      await writeFile(dbPath, "this is definitely not a sqlite database".repeat(10), "utf8");
      const error = await openPersonaStore({ dbPath }).catch((error: unknown) => error);
      expect(isPersonaStoreError(error)).toBe(true);
      if (!isPersonaStoreError(error)) return;
      expect(error.code).toBe("schema_incompatible");
    });

    it("账本里出现本版本不认识的迁移：schema_incompatible（库被更新版本写过）", async () => {
      const store = await openPersonaStore({ dbPath });
      await store.close();
      const raw = new DatabaseSync(dbPath);
      try {
        raw
          .prepare(
            "insert into schema_migration (id, checksum, app_version, time_applied) values (?, ?, ?, ?)",
          )
          .run("9999_future_migration", "x".repeat(64), "99.0.0", 1);
      } finally {
        raw.close();
      }
      const error = await openPersonaStore({ dbPath }).catch((error: unknown) => error);
      expect(isPersonaStoreError(error)).toBe(true);
      if (!isPersonaStoreError(error)) return;
      expect(error.code).toBe("schema_incompatible");
    });

    it("authority.schemaVersion 大于本构建支持版本：schema_incompatible", async () => {
      const store = await openPersonaStore({ dbPath });
      await store.initializeAuthority({
        initialCore: defaultCore(),
        mutationId: "init",
        now: 1_000,
        requestDigest: digest("init"),
        templateVersion: PERSONA_TEMPLATE_VERSION,
      });
      await store.close();
      const raw = new DatabaseSync(dbPath);
      try {
        raw.prepare("update persona_authority set schema_version = ? where id = 1").run(
          PERSONA_STORE_SCHEMA_VERSION + 1,
        );
      } finally {
        raw.close();
      }
      const reopened = await openPersonaStore({ dbPath }).catch((error: unknown) => error);
      expect(isPersonaStoreError(reopened)).toBe(true);
      if (!isPersonaStoreError(reopened)) return;
      expect(reopened.code).toBe("schema_incompatible");
    });

    it("有 authority 行但缺 core 行：读取按损坏处理，不静默换默认身份", async () => {
      const store = await openPersonaStore({ dbPath });
      await store.initializeAuthority({
        initialCore: defaultCore(),
        mutationId: "init",
        now: 1_000,
        requestDigest: digest("init"),
        templateVersion: PERSONA_TEMPLATE_VERSION,
      });
      const raw = new DatabaseSync(dbPath);
      try {
        raw.exec("delete from persona_core");
      } finally {
        raw.close();
      }
      const error = await store.readSnapshot().catch((error: unknown) => error);
      expect(isPersonaStoreError(error)).toBe(true);
      if (!isPersonaStoreError(error)) return;
      expect(error.code).toBe("schema_incompatible");
      await store.close();
    });

    it("CHECK 约束拒绝非法表达枚举，存储内容不被污染", async () => {
      const store = await openPersonaStore({ dbPath });
      await store.initializeAuthority({
        initialCore: defaultCore(),
        mutationId: "init",
        now: 1_000,
        requestDigest: digest("init"),
        templateVersion: PERSONA_TEMPLATE_VERSION,
      });
      const raw = new DatabaseSync(dbPath);
      try {
        expect(() =>
          raw.exec("update persona_core set warmth = 'sarcastic' where id = 1"),
        ).toThrow();
      } finally {
        raw.close();
      }
      await expect(store.readSnapshot()).resolves.toMatchObject({
        state: "initialized",
        core: { core: { warmth: "balanced" } },
      });
      await store.close();
    });

    it("不存在的库文件是未初始化而不是损坏；损坏不被误报为未初始化", async () => {
      const fresh = await openPersonaStore({ dbPath: join(root, "personas", "fresh.sqlite") });
      try {
        await expect(fresh.readSnapshot()).resolves.toEqual({ state: "uninitialized" });
      } finally {
        await fresh.close();
      }
      await writeFile(dbPath, "not a database at all".repeat(20), "utf8");
      const corrupted = await openPersonaStore({ dbPath }).catch((error: unknown) => error);
      expect(isPersonaStoreError(corrupted)).toBe(true);
      if (!isPersonaStoreError(corrupted)) return;
      expect(corrupted.code).toBe("schema_incompatible");
    });
  });

});

describe("persona 存储默认值与迁移清单", () => {
  it("默认预算/容量与合同 §2 初始值一致", () => {
    expect(PERSONA_STORE_DEFAULTS.lockWaitTimeoutMs).toBe(100);
    expect(PERSONA_STORE_DEFAULTS.adminRequestBudgetMs).toBe(5000);
    expect(PERSONA_STORE_DEFAULTS.captureBudgetMs).toBe(250);
    expect(PERSONA_STORE_DEFAULTS.receiptRetentionMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(PERSONA_STORE_DEFAULTS.receiptMaxPerAuthority).toBe(4096);
  });

  it("P0 只迁移 authority/core/receipt 三类表", () => {
    expect(PERSONA_MIGRATIONS).toHaveLength(1);
    expect([...PERSONA_MIGRATIONS[0]!.touchedTables]).toEqual([
      "persona_authority",
      "persona_core",
      "persona_mutation_receipt",
    ]);
  });

  it("scope 词汇与 shared contracts 单一出处一致", () => {
    expect(Object.values(PERSONA_RECEIPT_SCOPES).sort()).toEqual(["authority", "core"]);
    expect(Object.values(PERSONA_RECEIPT_SCOPES)).toContain("authority");
  });
});
