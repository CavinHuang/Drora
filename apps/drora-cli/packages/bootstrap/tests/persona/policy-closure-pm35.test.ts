/**
 * PM35 关闭语义（specs/drora-persona-system.md §5 生效矩阵/§12；数据合同 §4.2 提交与
 * 捕获时点；impact 矩阵 PM28/PM35/PM52 的可自动化子集）：
 * - 关 E：新轮零捕获（端口层零 IO），已存资料保留，管理域不要求 E；
 * - 关 U：偏好零注入、学习接收拒绝（同事务级联关 L），已存偏好保留；重开 U 不恢复 L；
 * - 关 L：零学习接收、零派发，已存有效 inferred 值仍被 U 读取。
 * 场景 2/3 用受控 owner/抽取替身走 PersonaAppServiceImpl＋在程 engine（确定性）；场景 1
 * 走生产组合（getOrCreateDroraPersonaSystem，含正式异步 worker 装配）验证 E 门端口层。
 */
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Logger } from "@drora/contracts";
import {
  createLearningReadyService,
  acceptanceRequest,
  controlledExtractor,
  draft,
  type LearningReadyService,
} from "./persona-learning-test-support.js";
import { PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED } from "../../src/app/drora-persona/contract.js";
import {
  getOrCreateDroraPersonaSystem,
  resetDroraPersonaSystemForTests,
} from "../../src/app/drora-persona/persona-system.js";
import { resolvePersonaDatabasePath } from "../../src/app/drora-persona/contract.js";

const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => nullLogger,
};

function captureRequest() {
  return {
    sessionId: "session-pm35",
    turnId: "turn-pm35",
    signal: new AbortController().signal,
  };
}

describe("PM35 关闭语义（E/U/L 屏障与资料保留）", () => {
  const cleanupRoots: string[] = [];
  const trackedServices: LearningReadyService[] = [];

  afterEach(async () => {
    await resetDroraPersonaSystemForTests();
    while (cleanupRoots.length > 0) {
      const root = cleanupRoots.pop();
      if (root) await rm(root, { recursive: true, force: true });
    }
    while (trackedServices.length > 0) {
      const ready = trackedServices.pop();
      if (ready) await ready.cleanup().catch(() => undefined);
    }
  });

  function trackService(ready: LearningReadyService): LearningReadyService {
    trackedServices.push(ready);
    return ready;
  }

  it("关 E：新轮零捕获（端口层零 IO），资料保留且管理域不要求 E", async () => {
    const root = await mkdtemp(join(tmpdir(), "drora-persona-pm35-e-"));
    cleanupRoots.push(root);
    const system = getOrCreateDroraPersonaSystem({
      trustedCliStorageRoot: root,
      logger: nullLogger,
    });

    // E off 的新 Runtime：capture 整轮省略（permission_not_granted），且零 IO——库文件
    // 不被暗建（E 门在端口层，不开库不起 worker）。
    const denied = await system
      .capturePortForPermission(false)
      .captureContribution(captureRequest());
    expect(denied).toEqual({
      status: "omitted",
      reason: PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
    });
    await expect(access(resolvePersonaDatabasePath(root))).rejects.toThrow();

    // 管理域不要求 E（spec §5「管理/预览/导出…不要求 E/M/U/L，不开启它们」）：
    // 初始化与显式保存照常；已存资料保留。
    const initialized = await system.appService().initializePersona({ mutationId: "mut-e-1" });
    expect(initialized).toMatchObject({ ok: true });
    const saved = await system
      .appService()
      .savePreference({
        key: "replyLanguage",
        value: "zh-CN",
        expectedRevision: 0,
        mutationId: "mut-e-2",
      });
    expect(saved).toMatchObject({ ok: true, value: { status: "saved" } });
    await expect(access(resolvePersonaDatabasePath(root))).resolves.toBeUndefined();

    // E off 不删除、不隐藏已存资料：列表照常可读。
    const listed = await system.appService().listPreferences();
    expect(listed).toMatchObject({
      ok: true,
      value: [{ key: "replyLanguage", value: "zh-CN", status: "active" }],
    });

    // E on 的 Runtime 按新轮资格捕获同一资料：E 关闭没有破坏资料域。
    const applied = await system
      .capturePortForPermission(true)
      .captureContribution(captureRequest());
    expect(applied.status).toBe("applied");
  });

  it("关 U：偏好零注入、学习接收拒绝（同事务级联关 L）；重开 U 不恢复 L，资料保留", async () => {
    const ready = trackService(await createLearningReadyService());
    const { service } = ready;

    // U on + 已存显式偏好：capture 注入该值。
    const saved = await service.savePreference({
      key: "replyLanguage",
      value: "zh-CN",
      expectedRevision: 0,
      mutationId: "mut-u-1",
    });
    expect(saved).toMatchObject({ ok: true, value: { status: "saved" } });
    const before = await service.captureContribution(captureRequest());
    expect(before.status).toBe("applied");
    if (before.status !== "applied") throw new Error("unreachable");
    expect(before.contribution.content).toContain("zh-CN");

    // 关 U（同事务级联关 L：合同 §4.2）。
    const off = await service.setPersonalPolicy({
      expectedPolicyRevision: 1,
      usePreferences: false,
      mutationId: "mut-u-2",
    });
    expect(off).toMatchObject({ ok: true, value: { status: "saved", policyEpoch: 2 } });

    // 新轮偏好零注入：贡献退化为纯核心段（不含已存值），资料本体保留。
    const after = await service.captureContribution(captureRequest());
    expect(after.status).toBe("applied");
    if (after.status !== "applied") throw new Error("unreachable");
    expect(after.contribution.content).not.toContain("zh-CN");

    // 学习接收被拒（U/L 均关）：新机会零接收；工作循环无工作可派。
    const accepted = await service.acceptLearningSource(acceptanceRequest());
    expect(accepted).toMatchObject({ kind: "skipped", reason: "policy_disabled" });
    await expect(service.processLearningWork()).resolves.toBe("idle");

    // 资料保留：偏好槽还在，只是不注入。
    const listed = await service.listPreferences();
    expect(listed).toMatchObject({
      ok: true,
      value: [{ key: "replyLanguage", value: "zh-CN", status: "active" }],
    });

    // 重开 U 不恢复 L（spec §5）：autoLearn patch 缺省＝保持当前值（false）。
    const reopen = await service.setPersonalPolicy({
      expectedPolicyRevision: 2,
      usePreferences: true,
      mutationId: "mut-u-3",
    });
    expect(reopen).toMatchObject({ ok: true, value: { status: "saved" } });
    const overview = await service.getPersonaLearningOverview();
    expect(overview).toMatchObject({
      ok: true,
      value: {
        state: "initialized",
        policy: { usePreferences: true, autoLearn: false },
      },
    });
    // 偏好注入随 U 恢复；但学习接收仍被 L off 拒绝。
    const restored = await service.captureContribution(captureRequest());
    expect(restored.status).toBe("applied");
    if (restored.status !== "applied") throw new Error("unreachable");
    expect(restored.contribution.content).toContain("zh-CN");
    const stillBlocked = await service.acceptLearningSource(acceptanceRequest());
    expect(stillBlocked).toMatchObject({ kind: "skipped", reason: "policy_disabled" });
  });

  it("关 L：零学习接收、零派发；已存有效 inferred 值仍被 U 读取", async () => {
    const ready = trackService(
      await createLearningReadyService({
        extractor: controlledExtractor({
          kind: "drafts",
          drafts: [draft("replyLanguage", "zh-CN")],
        }),
      }),
    );
    const { service } = ready;

    // 学习在飞→落槽：inferred 值写入并随 U 注入。
    const accepted = await service.acceptLearningSource(acceptanceRequest());
    expect(accepted).toMatchObject({ kind: "accepted" });
    await expect(service.processLearningWork()).resolves.toBe("claimed");
    await expect(service.processLearningWork()).resolves.toBe("idle");
    const withInferred = await service.captureContribution(captureRequest());
    expect(withInferred.status).toBe("applied");
    if (withInferred.status !== "applied") throw new Error("unreachable");
    expect(withInferred.contribution.content).toContain("zh-CN");

    // 关 L（U 保持 on）：停新接收与派发；已存资料不删。
    const off = await service.setPersonalPolicy({
      expectedPolicyRevision: 1,
      usePreferences: true,
      autoLearn: false,
      mutationId: "mut-l-1",
    });
    expect(off).toMatchObject({ ok: true, value: { status: "saved" } });

    const accepted2 = await service.acceptLearningSource(acceptanceRequest());
    expect(accepted2).toMatchObject({ kind: "skipped", reason: "policy_disabled" });
    await expect(service.processLearningWork()).resolves.toBe("idle");

    // 已存有效 inferred 值仍被 U 读取（spec §5「关闭 L…已存有效值仍可被 U 读取」）：
    // 来源复验照常走 owner，注入继续。
    const stillInjected = await service.captureContribution(captureRequest());
    expect(stillInjected.status).toBe("applied");
    if (stillInjected.status !== "applied") throw new Error("unreachable");
    expect(stillInjected.contribution.content).toContain("zh-CN");
  });
});
