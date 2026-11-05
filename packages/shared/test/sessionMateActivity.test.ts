/**
 * Drora Mate assistantActivity wire schema 测试（specs/drora-personal-assistant.md §11.4；
 * 02 详设 §6）：strict、有界、旧帧字段缺席合法；键常量单出处 contracts/assistant.ts。
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  sessionMateActivitySchema,
  SESSION_MATE_ACTIVITY_KEY,
  windowHostControllerTaskActivitySchema,
} from "../src/drora-protocol-v4/index.js";
import { SESSION_MATE_ACTIVITY_KEY as CONTRACT_KEY } from "../src/contracts/assistant.js";

describe("sessionMateActivitySchema", () => {
  it("键常量单出处：contracts 与协议 re-export 同值", () => {
    expect(SESSION_MATE_ACTIVITY_KEY).toBe(CONTRACT_KEY);
    expect(SESSION_MATE_ACTIVITY_KEY).toBe("mate");
  });

  it("合法摘要通过；非法多余字段 strict 拒绝", () => {
    const valid = { activeCount: 2, pendingDecisions: 1, updatedAtMs: 1_700_000_000_000 };
    expect(sessionMateActivitySchema.parse(valid)).toEqual(valid);
    expect(() => sessionMateActivitySchema.parse({ ...valid, extra: true })).toThrow();
  });

  it("负数/非整数/超界拒绝", () => {
    const base = { activeCount: 0, pendingDecisions: 0, updatedAtMs: 0 };
    expect(() => sessionMateActivitySchema.parse({ ...base, activeCount: -1 })).toThrow();
    expect(() => sessionMateActivitySchema.parse({ ...base, activeCount: 1.5 })).toThrow();
    expect(() => sessionMateActivitySchema.parse({ ...base, pendingDecisions: 100 })).toThrow();
  });

  it("controller 任务行 activity 携带可选 mate 字段（旧帧缺席合法）", () => {
    const activity = {
      phase: "running",
      lastActivityAt: 1_700_000_000_000,
      hasBackgroundWork: false,
      [SESSION_MATE_ACTIVITY_KEY]: { activeCount: 1, pendingDecisions: 0, updatedAtMs: 1 },
    };
    const parsed = windowHostControllerTaskActivitySchema.parse(activity);
    expect(parsed[SESSION_MATE_ACTIVITY_KEY]).toEqual({
      activeCount: 1,
      pendingDecisions: 0,
      updatedAtMs: 1,
    });
    const legacy = windowHostControllerTaskActivitySchema.parse({
      phase: "draft",
      lastActivityAt: 1,
      hasBackgroundWork: false,
    });
    expect(legacy[SESSION_MATE_ACTIVITY_KEY]).toBeUndefined();
  });
});
