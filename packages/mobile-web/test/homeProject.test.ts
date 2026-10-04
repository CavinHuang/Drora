// P4b 回归测试（spec §17）：真实 bootstrap 响应形状 → projectHomeData 任务归组。
// 背景：分组曾读**投影后**任务对象（已剥 workspacePath/workspaceIdentity）→ key 为空、
// 任务全部被丢弃——E2E 首批真链路验证（种子任务 + 真桌面 control）实证后修复。
// 方法学：响应形状逐字段对照 desktop buildBootstrapResult（desktopMobileRelayProtocol.ts）。
import assert from "node:assert/strict";
import test from "node:test";
import { projectHomeData } from "../src/app/entry.js";

const BOOTSTRAP_RESULT = {
  windowControlSessionId: "d_x",
  desktopAppVersion: "3.14.3",
  workspaces: [
    { workspacePath: "C:/g1", label: "g1", kind: "local", connectionState: "connected" },
  ],
  tasks: [
    {
      taskId: "task-e2e-1",
      title: "E2E 冒烟任务",
      status: "",
      updatedAt: 1790717360214,
      workspacePath: "C:/g1",
      workspaceLabel: "g1",
      workspaceKind: "local",
      createdAt: 1790630960214,
    },
  ],
};

test("P4b 回归：bootstrap 任务按原始记录归组到工作区（投影不丢定位字段）", () => {
  const home = projectHomeData(BOOTSTRAP_RESULT);
  assert.equal(home.workspaces.length, 1);
  assert.equal(home.workspaces[0]?.workspaceKey, "C:/g1");
  assert.equal(home.workspaces[0]?.tasks.length, 1);
  assert.equal(home.workspaces[0]?.tasks[0]?.sessionId, "task-e2e-1");
  assert.equal(home.workspaces[0]?.tasks[0]?.title, "E2E 冒烟任务");
  assert.equal(home.workspaces[0]?.tasks[0]?.status, "idle");
});

test("真实 Host 状态投影：运行、明确完成与空状态分别保真", () => {
  const home = projectHomeData({
    ...BOOTSTRAP_RESULT,
    tasks: [
      { ...BOOTSTRAP_RESULT.tasks[0], taskId: "running", status: "running" },
      { ...BOOTSTRAP_RESULT.tasks[0], taskId: "completed", status: "completed" },
      { ...BOOTSTRAP_RESULT.tasks[0], taskId: "unknown", status: "legacy-unknown" },
    ],
  });
  assert.deepEqual(
    home.workspaces[0]?.tasks.map((task) => task.status),
    ["running", "completed", "idle"],
  );
});

test("P4b 回归：workspaceIdentity 归一与孤儿任务（不在已知工作区的任务不渲染组）", () => {
  const home = projectHomeData({
    ...BOOTSTRAP_RESULT,
    workspaces: [
      {
        workspacePath: "C:/g1",
        workspaceIdentity: "id-g1",
        label: "g1",
        kind: "local",
        connectionState: "connected",
      },
    ],
    tasks: [
      // identity 命中：workspaceIdentity?.trim() || workspacePath。
      {
        ...BOOTSTRAP_RESULT.tasks[0],
        workspaceIdentity: "id-g1",
      },
      // 孤儿：workspacePath 不在清单（控制面投影缺失场景）——不崩溃即可。
      {
        ...BOOTSTRAP_RESULT.tasks[0],
        taskId: "task-orphan",
        workspacePath: "C:/elsewhere",
        workspaceIdentity: undefined,
      },
    ],
  });
  assert.equal(home.workspaces[0]?.tasks.length, 1);
  assert.equal(home.workspaces[0]?.tasks[0]?.sessionId, "task-e2e-1");
});

test("P4b 回归：activeTaskId 从 mobileViewState 回退读取（bootstrap 顶层无该键）", () => {
  const home = projectHomeData({
    ...BOOTSTRAP_RESULT,
    mobileViewState: { activeWorkspaceKey: "C:/g1", activeTaskId: "task-e2e-1" },
  });
  assert.equal(home.activeTaskId, "task-e2e-1");
  assert.equal(home.activeWorkspaceKey, "C:/g1");
});

// §32.7 细节还原：组卡「更新于 X」行——workspace.updatedAtMs 从组内任务 updatedAt 推导
// （官方组卡第三行实拍；relay workspace 摘要无 workspace 级 updatedAt）。
test("§32.7 workspace.updatedAtMs = 组内任务 updatedAt 最大值（官方「更新于」行数据源）", () => {
  const home = projectHomeData({
    ...BOOTSTRAP_RESULT,
    tasks: [
      { ...BOOTSTRAP_RESULT.tasks[0], taskId: "t1", updatedAt: 1000 },
      { ...BOOTSTRAP_RESULT.tasks[0], taskId: "t2", updatedAt: 9000 },
      { ...BOOTSTRAP_RESULT.tasks[0], taskId: "t3", updatedAt: 3000 },
    ],
  });
  assert.equal(home.workspaces[0]?.updatedAtMs, 9000);
});

test("§32.7 任务全部缺 updatedAt 时组卡 updatedAtMs 保持 null（不渲染更新于行）", () => {
  const home = projectHomeData({
    ...BOOTSTRAP_RESULT,
    tasks: [{ ...BOOTSTRAP_RESULT.tasks[0], updatedAt: undefined }],
  });
  assert.equal(home.workspaces[0]?.updatedAtMs, null);
});

test("§33.18.16 S7 最小切片：bootstrap sidePane 初值投影（闭集外归 null）", () => {
  assert.equal(
    projectHomeData({ ...BOOTSTRAP_RESULT, sidePane: { tab: "review" } }).sidePaneTab,
    "review",
  );
  assert.equal(
    projectHomeData({ ...BOOTSTRAP_RESULT, sidePane: { tab: "terminal" } }).sidePaneTab,
    "terminal",
  );
  assert.equal(
    projectHomeData({ ...BOOTSTRAP_RESULT, sidePane: { tab: "browser" } }).sidePaneTab,
    null,
    "闭集外 tab 归 null（手机回选择器）",
  );
  assert.equal(projectHomeData(BOOTSTRAP_RESULT).sidePaneTab, null, "缺省不下发=选择器");
});

test("§33.18.15 批 B TODO 清偿：bootstrap desktopPlatform 投影（非字符串归 null）", () => {
  assert.equal(
    projectHomeData({ ...BOOTSTRAP_RESULT, desktopPlatform: "win32" }).desktopPlatform,
    "win32",
  );
  assert.equal(projectHomeData(BOOTSTRAP_RESULT).desktopPlatform, null);
  assert.equal(projectHomeData({ ...BOOTSTRAP_RESULT, desktopPlatform: 42 }).desktopPlatform, null);
});
