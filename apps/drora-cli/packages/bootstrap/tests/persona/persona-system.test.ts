import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERSONA_STORAGE_KEYS } from "@drora/shared";
import type { Logger } from "@drora/contracts";
import {
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

  it("同一进程重复绑定同一可信根返回同一实例；capturePort 稳定", () => {
    const first = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root });
    const second = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root });
    expect(second).toBe(first);
    expect(second.capturePort).toBe(first.capturePort);
    // 服务单例：同一实例被反复取得（session 关闭不销毁进程级资料服务）。
    expect(second.appService()).toBe(first.appService());
    expect(peekDroraPersonaSystem()).toBe(first);
  });

  it("绑定不做任何 IO：capture 之后库文件与目录都不存在（未启用不读库、不迁移、不起 worker）", async () => {
    const system = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root, logger: nullLogger() });
    const controller = new AbortController();
    const outcome = await system.capturePort.captureContribution({
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

  it("已取消的轮返回 cancelled，不伪装成 omitted", async () => {
    const system = getOrCreateDroraPersonaSystem({ trustedCliStorageRoot: root, logger: nullLogger() });
    const controller = new AbortController();
    controller.abort();
    await expect(
      system.capturePort.captureContribution({
        sessionId: "session-1",
        turnId: "turn-1",
        signal: controller.signal,
      }),
    ).resolves.toEqual({ status: "cancelled" });
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
});
