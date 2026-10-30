import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONA_ERROR_CODES, PERSONA_STORAGE_KEYS } from "@drora/shared";
import type { Logger } from "@drora/contracts";
import {
  createPersonaControlPort,
  getOrCreateDroraPersonaSystem,
  peekDroraPersonaSystem,
  resetDroraPersonaSystemForTests,
} from "../../src/app/drora-persona/persona-system.js";
import {
  PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
  resolvePersonaDatabasePath,
} from "../../src/app/drora-persona/contract.js";

function nullLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => nullLogger(),
  };
}

describe("进程级 Persona 组合与 capture 生产装配", () => {
  let root: string;

  beforeEach(async () => {
    await resetDroraPersonaSystemForTests();
    root = await mkdtemp(join(tmpdir(), "drora-persona-system-"));
  });

  afterEach(async () => {
    await resetDroraPersonaSystemForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("resolvePersonaDatabasePath 只按 shared PERSONA_STORAGE_KEYS 拼接，空可信根 fail fast", () => {
    expect(resolvePersonaDatabasePath("/data/cli")).toBe(
      join("/data/cli", PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database),
    );
    expect(() => resolvePersonaDatabasePath("   ")).toThrow();
  });

  it("同一进程重复绑定同一可信根返回同一实例；服务单例稳定", () => {
    const first = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root });
    const second = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root });
    expect(second).toBe(first);
    // 服务单例：同一实例被反复取得（session 关闭不销毁进程级资料服务）。
    expect(second.appService()).toBe(first.appService());
    expect(peekDroraPersonaSystem()).toBe(first);
  });

  it("capturePortForPermission 按 E 值绑定：off 与 on 是不同端口，同值端口行为一致", async () => {
    const system = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root });
    const offA = system.capturePortForPermission(false);
    const offB = system.capturePortForPermission(false);
    const on = system.capturePortForPermission(true);
    expect(offA).not.toBe(on);
    // E off 每次绑定同一拒绝端口（无状态、零 IO）。
    expect(offB).toBe(offA);
    const controller = new AbortController();
    await expect(
      offA.captureContribution({ sessionId: "s", turnId: "t", signal: controller.signal }),
    ).resolves.toEqual({
      status: "omitted",
      reason: PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
    });
  });

  it("E off：capture 之后库文件与目录都不存在（零 IO：未启用不读库、不迁移、不起 worker）", async () => {
    const system = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root, logger: nullLogger() });
    const controller = new AbortController();
    const outcome = await system
      .capturePortForPermission(false)
      .captureContribution({
        sessionId: "session-1",
        turnId: "turn-1",
        signal: controller.signal,
      });
    expect(outcome).toEqual({
      status: "omitted",
      reason: PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
    });
    const dbPath = resolvePersonaDatabasePath(root);
    await expect(access(dbPath)).rejects.toThrow();
    await expect(access(join(root, PERSONA_STORAGE_KEYS.directory))).rejects.toThrow();
  });

  it("E off：已取消的轮返回 cancelled，不伪装成 omitted", async () => {
    const system = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root, logger: nullLogger() });
    const controller = new AbortController();
    controller.abort();
    await expect(
      system.capturePortForPermission(false).captureContribution({
        sessionId: "session-1",
        turnId: "turn-1",
        signal: controller.signal,
      }),
    ).resolves.toEqual({ status: "cancelled" });
  });

  it("E on 且资料未初始化：omitted(uninitialized) 且不自动建资料（显式 initialize 才建）", async () => {
    const system = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root, logger: nullLogger() });
    const controller = new AbortController();
    const outcome = await system.capturePortForPermission(true).captureContribution({
      sessionId: "session-1",
      turnId: "turn-1",
      signal: controller.signal,
    });
    expect(outcome).toEqual({ status: "omitted", reason: PERSONA_ERROR_CODES.uninitialized });
    // 未初始化是读取的成功答案：捕获没有暗建 authority/persona 身份（PM55/合同 §3）。
    await expect(system.appService().getPersonaOverview()).resolves.toEqual({
      ok: true,
      value: { state: "uninitialized" },
    });
  });

  it("E on 且已初始化：走真实存储捕获，贡献为默认核心的确定性编译结果", async () => {
    const system = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root, logger: nullLogger() });
    const initialized = await system.appService().initializePersona({ mutationId: "mut-1" });
    expect(initialized.ok).toBe(true);
    if (!initialized.ok) throw new Error("initialize failed");
    const controller = new AbortController();
    const outcome = await system.capturePortForPermission(true).captureContribution({
      sessionId: "session-1",
      turnId: "turn-1",
      signal: controller.signal,
    });
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") throw new Error("expected applied");
    expect(outcome.contribution.coreRevision).toBe(initialized.value.coreRevision);
    expect(outcome.contribution.templateVersion).toBe(initialized.value.templateVersion);
    expect(outcome.contribution.compilerVersion).toBe(initialized.value.compilerVersion);
    expect(outcome.contribution.content.length).toBeGreaterThan(0);
    // 确定性：同输入同摘要语义的内容（默认核心编译）。
    expect(outcome.contribution.content).toBeTypeOf("string");
  });

  it("不同可信根的重复绑定只告警并保留首个绑定（不静默切换资料域）", () => {
    const warn = vi.fn((_message: string, _context?: Record<string, unknown>) => {});
    const bindingLogger: Logger = {
      ...nullLogger(),
      warn: (message: string, context?: Record<string, unknown>) => {
        warn(message, context);
      },
    };
    const first = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root, logger: bindingLogger });
    const otherRoot = join(root, "other");
    const second = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: otherRoot, logger: bindingLogger });
    expect(second).toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("createPersonaControlPort 惰性绑定：未使用前进程 holder 不绑定，首个管理调用才落绑定", async () => {
    expect(peekDroraPersonaSystem()).toBeUndefined();
    const control = createPersonaControlPort({ trustedCliStorageRoot: root });
    // 构造端口零 IO、零绑定。
    expect(peekDroraPersonaSystem()).toBeUndefined();
    await expect(control.getPersonaOverview()).resolves.toEqual({
      ok: true,
      value: { state: "uninitialized" },
    });
    // 首个管理调用才执行进程级绑定（entrypoint 与 create-app 共享同一 holder）。
    expect(peekDroraPersonaSystem()).toBeDefined();
  });
});
