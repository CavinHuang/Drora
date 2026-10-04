import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@zcode/shared/zcode-protocol-v4";
import type { ProjectedWorkspace } from "../src/app/entry.js";
import { projectHomeWorkspacesWithLiveness } from "../src/app/useHomeSessionsIndex.js";

test("双视口共用的活性投影更新运行态并保留工作区身份", () => {
  const workspace: ProjectedWorkspace = {
    workspaceKey: "remote-host/path",
    name: "demo",
    kind: "remote",
    path: "C:/demo",
    updatedAtMs: null,
    connectionState: "connected",
    tasks: [
      {
        sessionId: "task-1",
        title: "旧标题",
        createdAtMs: 100,
        updatedAtMs: 150,
        status: "completed",
      },
    ],
  };
  const summary: SessionSummary = {
    workspaceId: workspace.workspaceKey,
    sessionId: "task-1",
    title: "新标题",
    titleSource: "custom",
    phase: "running",
    sessionEnded: false,
    hasBackgroundWork: false,
    lastActivityAt: 200,
    createdAt: 100,
  };
  const projected = projectHomeWorkspacesWithLiveness(
    [workspace],
    new Map([[workspace.workspaceKey, [summary]]]),
  );
  assert.equal(projected[0]?.workspaceKey, "remote-host/path");
  assert.equal(projected[0]?.path, "C:/demo");
  assert.equal(projected[0]?.connectionState, "connected");
  assert.deepEqual(projected[0]?.tasks[0], {
    sessionId: "task-1",
    title: "新标题",
    createdAtMs: 100,
    updatedAtMs: 200,
    status: "running",
    // §32.37 投影携带未读键（null = 已读；左表无 membership 时缺省）。
    unreadAtMs: null,
    // §32.50 投影携带后台工作标记（左表无该字段时 false）。
    hasBackgroundWork: false,
  });
});

test("已结束摘要不把 Host 空状态任务误标为已完成", () => {
  const workspace: ProjectedWorkspace = {
    workspaceKey: "C:/g1",
    name: "g1",
    kind: "local",
    path: "C:/g1",
    updatedAtMs: null,
    connectionState: "connected",
    tasks: [
      { sessionId: "idle-task", title: "任务", createdAtMs: 1, updatedAtMs: 2, status: "idle" },
    ],
  };
  const summary: SessionSummary = {
    workspaceId: workspace.workspaceKey,
    sessionId: "idle-task",
    title: "任务",
    titleSource: "generated",
    phase: "completedSuccess",
    sessionEnded: true,
    hasBackgroundWork: false,
    lastActivityAt: 3,
    createdAt: 1,
  };
  const projected = projectHomeWorkspacesWithLiveness(
    [workspace],
    new Map([[workspace.workspaceKey, [summary]]]),
  );
  assert.equal(projected[0]?.tasks[0]?.status, "idle");
});
