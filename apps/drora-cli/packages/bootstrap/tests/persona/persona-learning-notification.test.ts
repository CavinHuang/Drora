/**
 * P1b 机会通知接缝·服务侧（spec §8「只在普通成功轮获得有界机会通知；不阻塞、不等待；
 * 进程内最多 64 待接收，超出丢机会并计数」；合同 §6）：非阻塞语义、64 上限丢弃计数、
 * 门跳过计数、system 端口工厂的 E/workspaceKey 门。Runtime 侧接缝测试在
 * apps/drora-cli/packages/core/tests/persona/turn-learning-notification.test.ts。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSONA_PREFERENCE_KEYS } from "@drora/shared";
import { createPersonaLearningCoordinator } from "../../src/app/drora-persona/learning-coordinator.js";
import { PERSONA_LEARNING_TRUSTED_ORIGIN } from "../../src/app/drora-persona/learning-contract.js";
import {
  getOrCreateDroraPersonaSystem,
  resetDroraPersonaSystemForTests,
} from "../../src/app/drora-persona/persona-system.js";
import {
  controlledExtractor,
  createLearningReadyService,
  draft,
  WORKSPACE_KEY,
  type LearningReadyService,
} from "./persona-learning-test-support.js";

describe("persona P1b 机会通知消费者（服务侧）", () => {
  let env: LearningReadyService;

  beforeEach(async () => {
    env = await createLearningReadyService({
      extractor: controlledExtractor({
        drafts: [draft(PERSONA_PREFERENCE_KEYS.replyLanguage, "zh-CN")],
      }),
    });
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it("非阻塞：notify 同步返回，处理在后台异步完成", async () => {
    const coordinator = createPersonaLearningCoordinator({
      learning: env.service,
      logger: undefined,
    });
    const port = coordinator.createNotificationPort({
      personaPermission: true,
      workspaceKey: WORKSPACE_KEY,
    });
    // 同步返回时只入队：接收计数已增，处理结果尚未发生。
    port.notifyLearningOpportunity({
      boundaryMessageId: "msg-assistant-1",
      sessionId: "session-learning-1",
      turnId: "turn-1",
      userMessageId: "msg-user-1",
    });
    expect(coordinator.snapshotCounters().received).toBe(1);
    expect(coordinator.snapshotCounters().acceptAccepted).toBe(0);
    await coordinator.drainForTests();
    expect(coordinator.snapshotCounters().acceptAccepted).toBe(1);
  });

  it("64 待接收上限：超出丢机会并计数，已入队机会照常处理", async () => {
    const coordinator = createPersonaLearningCoordinator({ learning: env.service });
    const port = coordinator.createNotificationPort({
      personaPermission: true,
      workspaceKey: WORKSPACE_KEY,
    });
    // notify 全程同步：70 次通知在 drain（微任务）启动前全部入队，64 上限截断。
    for (let index = 0; index < 70; index += 1) {
      port.notifyLearningOpportunity({
        boundaryMessageId: `msg-a-${index}`,
        sessionId: `session-${index}`,
        turnId: `turn-${index}`,
        userMessageId: `msg-u-${index}`,
      });
    }
    const counters = coordinator.snapshotCounters();
    expect(counters.received).toBe(70);
    expect(counters.droppedQueueFull).toBe(6);
    await coordinator.drainForTests();
    // 丢弃数不因后续处理变化（合同 §6「超出丢机会并计数」）。
    expect(coordinator.snapshotCounters().droppedQueueFull).toBe(6);
    expect(coordinator.snapshotCounters().orchestrationErrors).toBe(0);
  });

  it("门跳过计数：策略关闭的机会被跳过并按原因计数", async () => {
    await env.service.setPersonalPolicy({
      expectedPolicyRevision: 1,
      mutationId: "l-off",
      usePreferences: false,
    });
    const coordinator = createPersonaLearningCoordinator({ learning: env.service });
    const port = coordinator.createNotificationPort({
      personaPermission: true,
      workspaceKey: WORKSPACE_KEY,
    });
    port.notifyLearningOpportunity({
      boundaryMessageId: "msg-assistant-1",
      sessionId: "session-learning-1",
      turnId: "turn-1",
      userMessageId: "msg-user-1",
    });
    await coordinator.drainForTests();
    expect(coordinator.snapshotCounters().acceptSkipped.policy_disabled).toBe(1);
    expect(coordinator.snapshotCounters().acceptAccepted).toBe(0);
  });

  it("重复通知同源：幂等（already_accepted），不重复处理工作", async () => {
    const coordinator = createPersonaLearningCoordinator({ learning: env.service });
    const port = coordinator.createNotificationPort({
      personaPermission: true,
      workspaceKey: WORKSPACE_KEY,
    });
    port.notifyLearningOpportunity({
      boundaryMessageId: "msg-assistant-1",
      sessionId: "session-learning-1",
      turnId: "turn-1",
      userMessageId: "msg-user-1",
    });
    port.notifyLearningOpportunity({
      boundaryMessageId: "msg-assistant-1",
      sessionId: "session-learning-1",
      turnId: "turn-1",
      userMessageId: "msg-user-1",
    });
    await coordinator.drainForTests();
    const counters = coordinator.snapshotCounters();
    expect(counters.acceptAccepted).toBe(1);
    expect(counters.acceptAlreadyAccepted).toBe(1);
  });
});

describe("persona P1b system 端口工厂门", () => {
  afterEach(async () => {
    await resetDroraPersonaSystemForTests();
  });

  it("E off / workspaceKey 缺席 → 端口缺席（Runtime 零开销）", async () => {
    const root = await mkdtemp(join(tmpdir(), "drora-persona-p1b-system-"));
    try {
      const system = getOrCreateDroraPersonaSystem({
        trustedCliStorageRoot: root,
      });
      expect(
        system.learningNotificationPort({ personaEnabled: false, workspaceKey: WORKSPACE_KEY }),
      ).toBeUndefined();
      expect(system.learningNotificationPort({ personaEnabled: true })).toBeUndefined();
      expect(
        system.learningNotificationPort({ personaEnabled: true, workspaceKey: "   " }),
      ).toBeUndefined();
      const bound = system.learningNotificationPort({
        personaEnabled: true,
        workspaceKey: WORKSPACE_KEY,
      });
      expect(bound).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("trusted origin 是装配层字面量（模型/远端不可自报）", () => {
    expect(PERSONA_LEARNING_TRUSTED_ORIGIN).toBe("drora-cli-local-runtime");
  });
});
