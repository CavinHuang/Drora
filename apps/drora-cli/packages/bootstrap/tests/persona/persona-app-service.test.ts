import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compilePersonaCore } from "@drora/core/persona";
import { openPersonaStore, PersonaStoreError, type PersonaStorePort } from "@drora/adapters/storage/persona";
import {
  PERSONA_ERROR_CODES,
  PERSONA_STORAGE_KEYS,
  PERSONA_STORE_SCHEMA_VERSION,
  PERSONA_TEMPLATE_VERSION,
  type PersonaCorePatch,
  type PersonaEditableCore,
} from "@drora/shared";
import { PersonaAppServiceImpl } from "../../src/app/drora-persona/persona-app-service.js";
import type { PersonaAppServiceOptions } from "../../src/app/drora-persona/contract.js";

const NOW = 1_700_000_000_000;

function customCore(): PersonaEditableCore {
  return { displayName: "Dro", selfDescription: "testing core", warmth: "warm", directness: "gentle", humor: "off" };
}

describe("PersonaAppService（切片 B 服务层）", () => {
  let root: string;
  let dbPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-service-"));
    dbPath = join(root, PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function createService(
    openStore?: PersonaAppServiceOptions["openStore"],
    logger?: PersonaAppServiceOptions["logger"],
  ): PersonaAppServiceImpl {
    return new PersonaAppServiceImpl({ dbPath, openStore, logger, now: () => NOW });
  }

  describe("getPersonaOverview", () => {
    it("未初始化时如实返回 uninitialized，且不暗建任何身份行", async () => {
      const service = createService();
      try {
        await expect(service.getPersonaOverview()).resolves.toEqual({
          ok: true,
          value: { state: "uninitialized" },
        });
        // 管理查询允许惰性打开库（打开即迁移），但绝不创建 authority/persona 事实。
        const raw = new DatabaseSync(dbPath);
        try {
          const rows = raw.prepare("select count(*) as n from persona_authority").get() as {
            n: number;
          };
          expect(rows.n).toBe(0);
        } finally {
          raw.close();
        }
      } finally {
        await service.close();
      }
    });

    it("初始化后返回最小观测事实（personaId/schemaVersion/coreRevision/templateVersion）", async () => {
      const service = createService();
      try {
        const initialized = await service.initializePersona({ mutationId: "m-ov-1" });
        if (!initialized.ok) throw new Error("initialize must succeed");
        await expect(service.getPersonaOverview()).resolves.toEqual({
          ok: true,
          value: {
            state: "initialized",
            personaId: initialized.value.personaId,
            schemaVersion: PERSONA_STORE_SCHEMA_VERSION,
            coreRevision: 1,
            templateVersion: PERSONA_TEMPLATE_VERSION,
            compilerVersion: 1,
          },
        });
      } finally {
        await service.close();
      }
    });
  });

  describe("initializePersona 幂等", () => {
    it("created → 同 mutationId 同摘要回放 → 新 mutationId 并发幂等 unchanged", async () => {
      const service = createService();
      try {
        const first = await service.initializePersona({ mutationId: "m-init-1" });
        expect(first).toMatchObject({
          ok: true,
          value: {
            status: "created",
            coreRevision: 1,
            schemaVersion: PERSONA_STORE_SCHEMA_VERSION,
            templateVersion: PERSONA_TEMPLATE_VERSION,
            compilerVersion: 1,
          },
        });
        if (!first.ok) throw new Error("unreachable");
        // 同 ID 同摘要：重试回放先前终态（PM53），不产生第二个身份。
        await expect(service.initializePersona({ mutationId: "m-init-1" })).resolves.toMatchObject({
          ok: true,
          value: { status: "created", personaId: first.value.personaId, coreRevision: 1 },
        });
        // 已初始化但该 ID 首次出现：并发初始化幂等，记 unchanged 回执。
        await expect(service.initializePersona({ mutationId: "m-init-2" })).resolves.toMatchObject({
          ok: true,
          value: { status: "unchanged", personaId: first.value.personaId },
        });
        await expect(service.getPersonaOverview()).resolves.toMatchObject({
          ok: true,
          value: { state: "initialized", coreRevision: 1 },
        });
      } finally {
        await service.close();
      }
    });

    it("空 mutationId 以 validation_failed 拒绝，且不触发存储打开", async () => {
      const openStore = vi.fn((path: string) => openPersonaStore({ dbPath: path }));
      const service = createService((path) => openStore(path));
      await expect(service.initializePersona({ mutationId: "   " })).resolves.toEqual({
        ok: false,
        code: PERSONA_ERROR_CODES.validationFailed,
      });
      expect(openStore).not.toHaveBeenCalled();
      await service.close();
    });
  });

  describe("updatePersonaCore：CAS、unchanged 与回放", () => {
    it("expectedRevision 不匹配返回 revision_conflict（不写凭据）；保存推进 revision", async () => {
      const service = createService();
      try {
        await service.initializePersona({ mutationId: "m-cas-0" });
        await expect(
          service.updatePersonaCore({
            expectedRevision: 99,
            patch: { displayName: "Dro" },
            mutationId: "m-cas-1",
          }),
        ).resolves.toEqual({ ok: false, code: PERSONA_ERROR_CODES.revisionConflict });
        await expect(service.getPersonaOverview()).resolves.toMatchObject({
          ok: true,
          value: { state: "initialized", coreRevision: 1 },
        });
        await expect(
          service.updatePersonaCore({
            expectedRevision: 1,
            patch: { displayName: "Dro" },
            mutationId: "m-cas-2",
          }),
        ).resolves.toEqual({ ok: true, value: { status: "saved", coreRevision: 2 } });
      } finally {
        await service.close();
      }
    });

    it("无内容变化的有效保存返回 unchanged，不新增 revision", async () => {
      const service = createService();
      try {
        await service.initializePersona({ mutationId: "m-same-0" });
        await service.updatePersonaCore({
          expectedRevision: 1,
          patch: { displayName: "Dro" },
          mutationId: "m-same-1",
        });
        await expect(
          service.updatePersonaCore({
            expectedRevision: 2,
            patch: { displayName: "Dro" },
            mutationId: "m-same-2",
          }),
        ).resolves.toEqual({ ok: true, value: { status: "unchanged" } });
        await expect(service.getPersonaOverview()).resolves.toMatchObject({
          ok: true,
          value: { state: "initialized", coreRevision: 2 },
        });
      } finally {
        await service.close();
      }
    });

    it("同 mutationId 同请求跨时间回放先前终态；同 ID 异请求 mutation_conflict", async () => {
      const service = createService();
      try {
        await service.initializePersona({ mutationId: "m-rp-0" });
        const original = await service.updatePersonaCore({
          expectedRevision: 1,
          patch: { displayName: "Dro" },
          mutationId: "m-rp-1",
        });
        expect(original).toEqual({ ok: true, value: { status: "saved", coreRevision: 2 } });
        // 其他变更把核心推进到 rev3 之后，同一请求（同 ID、同 expectedRevision、同 patch）重试
        // 仍回放当时终态 saved rev2，不产生新 revision（PM53：超时重试不换 ID 重写）。
        await service.updatePersonaCore({
          expectedRevision: 2,
          patch: { displayName: "Dra" },
          mutationId: "m-rp-2",
        });
        await expect(
          service.updatePersonaCore({
            expectedRevision: 1,
            patch: { displayName: "Dro" },
            mutationId: "m-rp-1",
          }),
        ).resolves.toEqual({ ok: true, value: { status: "saved", coreRevision: 2 } });
        // 同 ID 不同请求（不同 expectedRevision/patch）→ mutation_conflict。
        await expect(
          service.updatePersonaCore({
            expectedRevision: 3,
            patch: { displayName: "Dro" },
            mutationId: "m-rp-1",
          }),
        ).resolves.toEqual({ ok: false, code: PERSONA_ERROR_CODES.mutationConflict });
        await expect(service.getPersonaOverview()).resolves.toMatchObject({
          ok: true,
          value: { state: "initialized", coreRevision: 3 },
        });
      } finally {
        await service.close();
      }
    });

    it("未知键、超限、控制字符与非法 expectedRevision 以 validation_failed 拒绝且不改状态", async () => {
      const service = createService();
      try {
        await service.initializePersona({ mutationId: "m-val-0" });
        await expect(
          service.updatePersonaCore({
            expectedRevision: 1,
            patch: { nickname: "x" } as unknown as PersonaCorePatch,
            mutationId: "m-val-1",
          }),
        ).resolves.toEqual({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
        await expect(
          service.updatePersonaCore({
            expectedRevision: 1,
            patch: { displayName: "D".repeat(41) },
            mutationId: "m-val-2",
          }),
        ).resolves.toEqual({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
        await expect(
          service.updatePersonaCore({
            expectedRevision: 1,
            patch: { displayName: "A\u0000B" },
            mutationId: "m-val-3",
          }),
        ).resolves.toEqual({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
        await expect(
          service.updatePersonaCore({
            expectedRevision: 1.5,
            patch: { displayName: "Dro" },
            mutationId: "m-val-4",
          }),
        ).resolves.toEqual({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
        // 校验失败不产生半提交状态。
        await expect(service.getPersonaOverview()).resolves.toMatchObject({
          ok: true,
          value: { state: "initialized", coreRevision: 1 },
        });
      } finally {
        await service.close();
      }
    });

    it("patch 归一化落库：NFC/trim 后保存规范化值", async () => {
      const service = createService();
      try {
        await service.initializePersona({ mutationId: "m-nfc-0" });
        // 「か＋结合浊点」NFC 后为「が」；首尾空白 trim。
        await expect(
          service.updatePersonaCore({
            expectedRevision: 1,
            patch: { displayName: "  Drora\u304B\u3099  " },
            mutationId: "m-nfc-1",
          }),
        ).resolves.toEqual({ ok: true, value: { status: "saved", coreRevision: 2 } });
        const core = await service.getPersonaCore();
        if (!core.ok || core.value.state !== "current") throw new Error("expected current core");
        expect(core.value.core.displayName).toBe("Drora\u304C");
      } finally {
        await service.close();
      }
    });
  });

  describe("resetPersonaCore", () => {
    it("恢复产品默认是明确的 Core 更新；已是默认时返回 unchanged", async () => {
      const service = createService();
      try {
        await service.initializePersona({ mutationId: "m-rs-0" });
        await service.updatePersonaCore({
          expectedRevision: 1,
          patch: { ...customCore() },
          mutationId: "m-rs-1",
        });
        await expect(
          service.resetPersonaCore({ expectedRevision: 2, mutationId: "m-rs-2" }),
        ).resolves.toEqual({ ok: true, value: { status: "saved", coreRevision: 3 } });
        const core = await service.getPersonaCore();
        if (!core.ok || core.value.state !== "current") throw new Error("expected current core");
        expect(core.value.core).toEqual({
          displayName: "Drora",
          selfDescription: "",
          warmth: "balanced",
          directness: "direct",
          humor: "light",
        });
        await expect(
          service.resetPersonaCore({ expectedRevision: 3, mutationId: "m-rs-3" }),
        ).resolves.toEqual({ ok: true, value: { status: "unchanged" } });
      } finally {
        await service.close();
      }
    });

    it("未初始化时以 uninitialized 拒绝（写方法语义）", async () => {
      const service = createService();
      try {
        await expect(
          service.resetPersonaCore({ expectedRevision: 1, mutationId: "m-rs-4" }),
        ).resolves.toEqual({ ok: false, code: PERSONA_ERROR_CODES.uninitialized });
        await expect(
          service.updatePersonaCore({ expectedRevision: 1, patch: {}, mutationId: "m-rs-5" }),
        ).resolves.toEqual({ ok: false, code: PERSONA_ERROR_CODES.uninitialized });
      } finally {
        await service.close();
      }
    });
  });

  describe("getPersonaCore", () => {
    it("未初始化返回 built_in_preview（产品默认，不落库）；初始化后返回 current", async () => {
      const service = createService();
      try {
        await expect(service.getPersonaCore()).resolves.toMatchObject({
          ok: true,
          value: {
            state: "built_in_preview",
            core: { displayName: "Drora", warmth: "balanced", directness: "direct", humor: "light" },
            template: { templateVersion: PERSONA_TEMPLATE_VERSION },
          },
        });
        await expect(service.getPersonaOverview()).resolves.toMatchObject({
          ok: true,
          value: { state: "uninitialized" },
        });
        await service.initializePersona({ mutationId: "m-core-1" });
        await expect(service.getPersonaCore()).resolves.toMatchObject({
          ok: true,
          value: { state: "current", coreRevision: 1 },
        });
      } finally {
        await service.close();
      }
    });
  });

  describe("previewPersona", () => {
    it("同输入同输出、与编译路径一致，且全程零存储访问", async () => {
      const openStore = vi.fn((path: string) => openPersonaStore({ dbPath: path }));
      const service = createService((path) => openStore(path));
      try {
        const draft: PersonaEditableCore = {
          displayName: "  Drora  ",
          selfDescription: "here to help",
          warmth: "warm",
          directness: "gentle",
          humor: "off",
        };
        const first = await service.previewPersona({ draft });
        const second = await service.previewPersona({ draft });
        if (!first.ok || !second.ok) throw new Error("preview must succeed");
        const compiled = compilePersonaCore(draft, 0);
        if (compiled.status !== "compiled") throw new Error("fixture must compile");
        expect(first.value.text).toBe(compiled.contribution.content);
        expect(second.value).toEqual(first.value);
        expect(first.value.templateVersion).toBe(PERSONA_TEMPLATE_VERSION);
        expect(first.value.compilerVersion).toBe(1);
        // 预览零副作用：不打开库、不写库（PM20「preview 不写执行」）。
        expect(openStore).not.toHaveBeenCalled();
        await service.getPersonaOverview();
        expect(openStore).toHaveBeenCalledTimes(1);
      } finally {
        await service.close();
      }
    });

    it("非法草稿与未知受控情境以 validation_failed 拒绝（不截断、不发明假情境）", async () => {
      const service = createService();
      try {
        await expect(
          service.previewPersona({ draft: { ...customCore(), displayName: "" } }),
        ).resolves.toEqual({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
        await expect(
          service.previewPersona({ draft: customCore(), situationId: "work" }),
        ).resolves.toEqual({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
      } finally {
        await service.close();
      }
    });
  });

  describe("captureContribution（切片 C：E on 的真实存储捕获路径）", () => {
    it("未初始化：omitted(uninitialized)，不自动建资料；已取消返回 cancelled", async () => {
      const openStore = vi.fn((path: string) => openPersonaStore({ dbPath: path }));
      const service = createService((path) => openStore(path));
      try {
        const controller = new AbortController();
        await expect(
          service.captureContribution({ sessionId: "s", turnId: "t", signal: controller.signal }),
        ).resolves.toEqual({ status: "omitted", reason: PERSONA_ERROR_CODES.uninitialized });
        controller.abort();
        // 取消沿原 AbortSignal 语义，不把 cancelled 伪装成 omitted（spec §6）。
        await expect(
          service.captureContribution({ sessionId: "s", turnId: "t", signal: controller.signal }),
        ).resolves.toEqual({ status: "cancelled" });
        // 未初始化路径不写资料：authority 单例仍缺席（显式 initialize 才建，合同 §3）。
        await expect(service.getPersonaOverview()).resolves.toEqual({
          ok: true,
          value: { state: "uninitialized" },
        });
        // 打开即迁移的存储工厂被调用过一次（惰性打开），authority 建立从未发生。
        expect(openStore).toHaveBeenCalledTimes(1);
        await expect(service.initializePersona({ mutationId: "probe" })).resolves.toMatchObject({
          ok: true,
          value: { status: "created" },
        });
      } finally {
        await service.close();
      }
    });

    it("已初始化：返回 applied，贡献为当前核心 revision 的确定性编译结果", async () => {
      const openStore = vi.fn((path: string) => openPersonaStore({ dbPath: path }));
      const service = createService((path) => openStore(path));
      try {
        const initialized = await service.initializePersona({ mutationId: "mut-1" });
        expect(initialized.ok).toBe(true);
        if (!initialized.ok) throw new Error("initialize failed");
        const controller = new AbortController();
        const outcome = await service.captureContribution({
          sessionId: "s",
          turnId: "t",
          signal: controller.signal,
        });
        expect(outcome.status).toBe("applied");
        if (outcome.status !== "applied") throw new Error("expected applied");
        expect(outcome.contribution.coreRevision).toBe(initialized.value.coreRevision);
        expect(outcome.contribution.compilerVersion).toBe(initialized.value.compilerVersion);
        expect(outcome.contribution.content.length).toBeGreaterThan(0);
      } finally {
        await service.close();
      }
    });

    it("存储环境故障按封闭错误码省略扩展，不向轮次抛出（PM16）", async () => {
      const openStore = vi.fn(async (): Promise<PersonaStorePort> => {
        throw new PersonaStoreError("simulated capture failure", {
          code: PERSONA_ERROR_CODES.storageUnavailable,
        });
      });
      const service = createService(() => openStore());
      try {
        const controller = new AbortController();
        await expect(
          service.captureContribution({ sessionId: "s", turnId: "t", signal: controller.signal }),
        ).resolves.toEqual({
          status: "omitted",
          reason: PERSONA_ERROR_CODES.storageUnavailable,
        });
      } finally {
        await service.close();
      }
    });

    it("打开库挂起不返回：capture 总预算内按 budget_exhausted 省略，原任务继续（合同 §2/PM16）", async () => {
      // 评审发现的「挂起不返回」用例：openStore 永不结算（慢盘/迁移/worker 卡死），
      // E on 捕获必须在预算内省略扩展，不能无上界延迟首个合格主请求（spec §6）。
      const service = new PersonaAppServiceImpl({
        dbPath,
        captureBudgetMs: 20,
        openStore: () => new Promise<PersonaStorePort>(() => {}),
      });
      const controller = new AbortController();
      const startedAt = Date.now();
      try {
        await expect(
          service.captureContribution({ sessionId: "s", turnId: "t", signal: controller.signal }),
        ).resolves.toEqual({ status: "omitted", reason: PERSONA_ERROR_CODES.budgetExhausted });
        expect(Date.now() - startedAt).toBeLessThan(1_000);
      } finally {
        await service.close();
      }
    });

    it("预算结算后迟到的 store 打开失败被吞掉，不产生 unhandled rejection", async () => {
      const service = new PersonaAppServiceImpl({
        dbPath,
        captureBudgetMs: 20,
        openStore: () =>
          new Promise<PersonaStorePort>((_, reject) => {
            // 预算（20ms）先到，40ms 后打开库才失败：迟到拒绝必须被预算竞速吞掉，
            // 否则本文件会以 unhandled rejection 失败。
            setTimeout(() => reject(new Error("late store open failure")), 40);
          }),
      });
      const controller = new AbortController();
      try {
        await expect(
          service.captureContribution({ sessionId: "s", turnId: "t", signal: controller.signal }),
        ).resolves.toEqual({ status: "omitted", reason: PERSONA_ERROR_CODES.budgetExhausted });
        // 留出迟到拒绝的窗口，让潜在 unhandled rejection 在本用例内暴露。
        await new Promise((resolve) => setTimeout(resolve, 120));
      } finally {
        await service.close();
      }
    });
  });

  describe("环境故障与生命周期", () => {
    it("初始化失败只影响扩展：无半提交状态，存储恢复后同一服务实例继续可用", async () => {
      let failNext = true;
      const openStore = vi.fn(async (path: string): Promise<PersonaStorePort> => {
        if (failNext) {
          throw new PersonaStoreError("simulated disk failure", {
            code: PERSONA_ERROR_CODES.storageUnavailable,
          });
        }
        return openPersonaStore({ dbPath: path });
      });
      const logs: Array<{ message: string; context?: Record<string, unknown> }> = [];
      const service = createService((path) => openStore(path), {
        warn: (message: string, context?: Record<string, unknown>) => {
          logs.push({ message, context });
        },
      });
      try {
        await expect(service.initializePersona({ mutationId: "m-fail-1" })).resolves.toEqual({
          ok: false,
          code: PERSONA_ERROR_CODES.storageUnavailable,
        });
        // 失败不留半提交状态；服务未失效（storage_unavailable 允许重试）。
        failNext = false;
        await expect(service.getPersonaOverview()).resolves.toMatchObject({
          ok: true,
          value: { state: "uninitialized" },
        });
        await expect(service.initializePersona({ mutationId: "m-fail-1" })).resolves.toMatchObject({
          ok: true,
          value: { status: "created" },
        });
        // 故障日志只记固定类别/操作/耗时，不落个人正文（合同 §3）。
        expect(logs.length).toBeGreaterThan(0);
        for (const entry of logs) {
          expect(Object.keys(entry.context ?? {})).toEqual(
            expect.arrayContaining(["operation", "code", "durationMs"]),
          );
        }
      } finally {
        await service.close();
      }
    });

    it("storage_capacity 按合同原样透传；读路径不受影响", async () => {
      const stub: PersonaStorePort = {
        readSnapshot: async () => ({ state: "uninitialized" }),
        initializeAuthority: async () => ({
          ok: false,
          code: PERSONA_ERROR_CODES.storageCapacity,
        }),
        updateCore: async () => ({ ok: false, code: PERSONA_ERROR_CODES.storageCapacity }),
        close: async () => {},
      };
      const service = createService(async () => stub);
      try {
        await expect(service.initializePersona({ mutationId: "m-cap-1" })).resolves.toEqual({
          ok: false,
          code: PERSONA_ERROR_CODES.storageCapacity,
        });
        await expect(service.getPersonaCore()).resolves.toMatchObject({
          ok: true,
          value: { state: "built_in_preview" },
        });
      } finally {
        await service.close();
      }
    });

    it("schema_incompatible 是进程内终态：不再重复打开库（只停扩展）", async () => {
      const openStore = vi.fn(async (): Promise<PersonaStorePort> => {
        throw new PersonaStoreError("simulated corruption", {
          code: PERSONA_ERROR_CODES.schemaIncompatible,
        });
      });
      const service = createService(() => openStore());
      try {
        await expect(service.getPersonaOverview()).resolves.toEqual({
          ok: false,
          code: PERSONA_ERROR_CODES.schemaIncompatible,
        });
        await expect(service.getPersonaOverview()).resolves.toEqual({
          ok: false,
          code: PERSONA_ERROR_CODES.schemaIncompatible,
        });
        expect(openStore).toHaveBeenCalledTimes(1);
      } finally {
        await service.close();
      }
    });

    it("close 幂等；关闭后管理调用以 storage_unavailable 失败，不影响其他实例", async () => {
      const service = createService();
      await service.close();
      await service.close();
      await expect(service.getPersonaOverview()).resolves.toEqual({
        ok: false,
        code: PERSONA_ERROR_CODES.storageUnavailable,
      });
      const other = createService();
      try {
        await expect(other.getPersonaOverview()).resolves.toMatchObject({
          ok: true,
          value: { state: "uninitialized" },
        });
      } finally {
        await other.close();
      }
    });
  });

  it("未启用且未进入资料管理时不创建库文件（构造即注入也不打开；零存储路径只剩预览）", async () => {
    const openStore = vi.fn((path: string) => openPersonaStore({ dbPath: path }));
    const service = createService((path) => openStore(path));
    // 构造与预览（无存储路径）不打开库：目录不该被创建。切片 C 起捕获的零 IO 语义
    // 由执行许可端口层承担（capturePortForPermission(false)，见 persona-system.test.ts），
    // 服务方法本身是 E on 的真实存储捕获路径。
    await service.previewPersona({ draft: customCore() });
    expect(openStore).not.toHaveBeenCalled();
    await service.close();
  });

  it("isPersonaStoreError 守卫与 PersonaStoreError 一起从 adapters 复用（不做第二份错误类型）", async () => {
    const error = new PersonaStoreError("x", { code: PERSONA_ERROR_CODES.storageUnavailable });
    expect(error.name).toBe("PersonaStoreError");
    expect(error.code).toBe(PERSONA_ERROR_CODES.storageUnavailable);
  });
});
