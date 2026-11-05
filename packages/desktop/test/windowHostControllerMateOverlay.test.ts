/**
 * Drora Mate assistantActivity 任务行 overlay 合成测试（specs/drora-personal-assistant.md
 * §11.4；02 详设 §6）：mate 摘要合成进 session overlay 的 activity（与 teamActivity 同位），
 * 无 activity 的 overlay 不合成（不伪造会话事实）；合成产物满足 controller wire schema。
 */
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  mergeMateActivityIntoOverlays,
  type WindowHostControllerSessionOverlay,
} from "../src/host/windowHostControllerProjection.js";
import { windowHostControllerTaskActivitySchema } from "@drora/shared/drora-protocol-v4";

const MATE = { activeCount: 2, pendingDecisions: 1, updatedAtMs: 1_700_000_000_000 };

function overlayWithActivity(
  taskId: string,
  activity?: WindowHostControllerSessionOverlay["activity"],
): WindowHostControllerSessionOverlay {
  const overlay: WindowHostControllerSessionOverlay = {
    taskId,
    liveStatus: "running",
    ...(activity ? { activity } : {}),
  };
  return overlay;
}

function baseActivity() {
  return {
    phase: "running" as const,
    lastActivityAt: 1_700_000_000_000,
    hasBackgroundWork: false,
  };
}

describe("mergeMateActivityIntoOverlays（02 详设 §6 host 任务行 overlay）", () => {
  it("有 activity 的 overlay 合成 mate 字段；产物满足 controller activity wire schema", () => {
    const merged = mergeMateActivityIntoOverlays(
      [overlayWithActivity("task-1", baseActivity())],
      MATE,
    );
    expect(merged[0].activity?.mate).toEqual(MATE);
    // 合成产物即 wire 合法形态（controller/tasks-index 帧可携带，桌面/手机透传）。
    expect(windowHostControllerTaskActivitySchema.parse(merged[0].activity)).toBeDefined();
    // 原 overlay 不被改写（纯合成，发布侧可安全重算）。
    expect(overlayWithActivity("task-1", baseActivity()).activity?.mate).toBeUndefined();
  });

  it("无 activity 的 overlay 不合成（旧帧/离线行缺席合法）", () => {
    const merged = mergeMateActivityIntoOverlays([overlayWithActivity("task-2")], MATE);
    expect(merged[0].activity).toBeUndefined();
  });

  it("mate 缺席 → overlay 原样返回（无工单 workspace 无徽标）", () => {
    const overlays = [overlayWithActivity("task-3", { ...baseActivity(), mate: MATE })];
    expect(mergeMateActivityIntoOverlays(overlays, undefined)).toBe(overlays);
  });

  it("既有 mate 被最新快照覆盖（幂等重发布语义）", () => {
    const stale = { activeCount: 0, pendingDecisions: 0, updatedAtMs: 1 };
    const merged = mergeMateActivityIntoOverlays(
      [overlayWithActivity("task-4", { ...baseActivity(), mate: stale })],
      MATE,
    );
    expect(merged[0].activity?.mate).toEqual(MATE);
  });
});
