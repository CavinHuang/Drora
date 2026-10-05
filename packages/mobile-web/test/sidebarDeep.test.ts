import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SidebarOrganizeMenu,
  type SidebarOrganizeMode,
  type SidebarSortMode,
} from "../src/ui/wide/SidebarOrganizeMenu.js";
import {
  SidebarRemoveWorkspaceDialog,
  WorkspaceSshBadge,
} from "../src/ui/wide/SidebarRemoveWorkspaceDialog.js";
import { IntlProvider } from "../src/ui/intl.js";

// Node 的 tsx loader 使用 classic JSX transform；Vite 运行时使用 automatic transform。
Object.assign(globalThis, { React });

function renderMenu(props: Partial<Parameters<typeof SidebarOrganizeMenu>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(SidebarOrganizeMenu, {
        organize: "project",
        onOrganizeChange: () => {},
        ...props,
      }),
    ),
  );
}

test("organize 官方 RadioGroup：aria-label「视图」+ 三值 radio（项目/时间线/分组）", () => {
  const html = renderMenu();
  assert.ok(html.includes('role="radiogroup"'));
  assert.ok(html.includes('aria-label="视图"'));
  for (const value of ["project", "chronological", "workspace"]) {
    assert.ok(html.includes(`data-testid="sidebar-organize-${value}"`), value);
  }
  assert.ok(html.includes("项目"));
  assert.ok(html.includes("时间线"));
  assert.ok(html.includes("分组"));
});

test("organize 选中态：aria-checked + check 图标只随当前值", () => {
  const html = renderMenu({ organize: "workspace" });
  // 渲染属性序：aria-checked 先于 data-testid（JSX 声明序）。
  assert.ok(/aria-checked="true"[^>]*sidebar-organize-workspace/.test(html), "workspace 项选中");
  const projectChecked = /aria-checked="true"[^>]*sidebar-organize-project/.test(html);
  assert.ok(!projectChecked, "project 项未选中");
});

test("sortBy 装配缝：缺省不渲染；传入时官方两值（更新时间/创建时间）+「排序方式」", () => {
  const bare = renderMenu();
  assert.ok(!bare.includes("排序方式"), "缺省不渲染 sortBy 段");
  const wired = renderMenu({ sort: "updated", onSortChange: () => {} });
  assert.ok(wired.includes('aria-label="排序方式"'));
  assert.ok(wired.includes("更新时间"));
  assert.ok(wired.includes("创建时间"));
  assert.ok(wired.includes('data-testid="sidebar-sort-updated"'));
  assert.ok(wired.includes('data-testid="sidebar-sort-created"'));
});

function renderDialog(props: Partial<Parameters<typeof SidebarRemoveWorkspaceDialog>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(SidebarRemoveWorkspaceDialog, {
        open: true,
        onConfirm: () => {},
        onCancel: () => {},
        ...props,
      }),
    ),
  );
}

test("移除对话官方三键：title/description/confirm 逐字 + common.cancel 取消 + alertdialog", () => {
  const html = renderDialog();
  assert.ok(html.includes('role="alertdialog"'));
  assert.ok(html.includes("移除运行中的项目？"));
  assert.ok(
    html.includes(
      "该项目还有运行中的对话或 Agent。移除项目会停止并释放相关运行状态，历史任务不会被删除。",
    ),
  );
  assert.ok(html.includes("移除并停止运行"));
  assert.ok(html.includes("取消"), "官方 cancelLabel=common.cancel");
  assert.ok(html.includes('data-testid="sidebar-remove-confirm"'));
  assert.ok(html.includes('data-testid="sidebar-remove-cancel"'));
});

test("windowsReservedNameRisk 装配：{count}/{path} 官方插值逐字", () => {
  const html = renderDialog({
    reservedNameRisk: { count: 2, path: "D:/ws/con" },
  });
  assert.ok(html.includes("已移除项目，但检测到 2 个 Windows 保留名文件"));
  assert.ok(html.includes("D:/ws/con"));
});

test("受控关闭：open=false → null", () => {
  assert.equal(renderDialog({ open: false }), "");
});

test("SSH 徽标：官方「SSH 连接」+ alias/host/path 插值进 title 详情", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(WorkspaceSshBadge, { alias: "dev-box", host: "10.0.0.8", path: "/srv" }),
    ),
  );
  assert.ok(html.includes("SSH 连接"));
  assert.ok(html.includes('title="dev-box（SSH）'), "alias 插值（官方缺值补译形态）");
  assert.ok(html.includes("主机：10.0.0.8"));
  assert.ok(html.includes("路径：/srv"));
});

// —— Sidebar 组装级装配缝（P6 深面接线；键位官方化后空态/入口行为）——
import { Sidebar } from "../src/ui/wide/Sidebar.js";

const ws = {
  workspaceKey: "C:/g1",
  workspacePath: "C:/g1",
  label: "g1",
  tasks: [],
} as never;

function renderSidebar(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(
      IntlProvider,
      { locale: "zh-CN" },
      React.createElement(Sidebar, {
        connection: "connected",
        workspaces: [ws],
        collapsed: false,
        onCollapsedChange: () => {},
        onOpenSearch: () => {},
        ...props,
      }),
    ),
  );
}

test("空态官方键：尚未打开项目/还没有任务（替换自建键官方化）", () => {
  const emptyProjects = renderSidebar({ workspaces: [] });
  assert.ok(emptyProjects.includes("尚未打开项目"), "官方 noProjects");
  const emptyTasks = renderSidebar();
  assert.ok(emptyTasks.includes("还没有任务"), "官方 noConversations");
});

test("装配缝缺省：深面入口不渲染（零回归）；传入即渲染官方 aria-label", () => {
  const bare = renderSidebar();
  assert.ok(!bare.includes("筛选和排序"));
  assert.ok(!bare.includes("添加项目"));
  assert.ok(!bare.includes("查看文件"));
  assert.ok(!bare.includes("移除"));
  const wired = renderSidebar({
    onOrganizeChange: () => {},
    onAddProject: () => {},
    onShowFileTree: () => {},
    onWorkspaceRemove: () => {},
  });
  assert.ok(wired.includes('aria-label="筛选和排序"'));
  assert.ok(wired.includes('aria-label="添加项目"'));
  assert.ok(wired.includes('aria-label="查看文件"'));
  assert.ok(wired.includes('aria-label="移除"'), "组行 X 官方 remove 键");
});

test("键位官方化：切换侧边栏（官方一键双向）/项目/新建任务", () => {
  const html = renderSidebar();
  assert.ok(html.includes('aria-label="切换侧边栏"'), "官方 toggleSidebar");
  assert.ok(html.includes("新建任务"));
});

test("宽壳置顶节仍先于项目树，置顶行和组内行保留同一任务契约", () => {
  const html = renderSidebar({
    workspaces: [
      {
        workspaceKey: "project-1",
        name: "Project",
        kind: "local",
        path: "C:/project",
        updatedAtMs: null,
        tasks: [
          {
            sessionId: "task-1",
            title: "Pinned task",
            status: "idle",
            pinned: true,
            createdAtMs: 1,
            updatedAtMs: 2,
          },
        ],
      },
    ],
  });
  assert.ok(html.indexOf("已置顶") < html.indexOf("Project"));
  assert.equal((html.match(/data-testid="task-item-task-1"/g) ?? []).length, 2);
  assert.ok(html.includes('aria-label="打开任务 Pinned task"'));
});
