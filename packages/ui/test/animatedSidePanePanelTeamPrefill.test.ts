// @vitest-environment jsdom
/**
 * AnimatedSidePanePanel team 分支的挂载转发测试（缺口9）：挂载点（WorkspaceShellLayout）
 * 经 props 链传入的 onPrefillComposer 必须到达 team tab 分支的 TeamSidePane——此前该分支
 * 只传 tab/focused/三个 onOpen*，「回对话修改」预填与「引用任务」两条链因此在挂载点断链。
 * 这里打桩 TeamSidePane 捕获 props（模式照 subagentSidePane.test.ts 的 paneState 捕获），
 * 断言回调在场即转发、缺席不下发键（exactOptionalPropertyTypes 的条件展开语义）。
 */
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedSidePanePanel } from "@/app-shell/AnimatedSidePanePanel.js";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import type { TeamSidePaneTab } from "@/lib/workspaceSidePane.js";

const captured = vi.hoisted(() => ({ teamSidePaneProps: null as unknown }));

vi.mock("@/app-shell/TeamSidePane.js", async () => {
  const React = await import("react");
  return {
    TeamSidePane: (props: Record<string, unknown>) => {
      captured.teamSidePaneProps = props;
      return React.createElement("div", { "data-testid": "mock-team-side-pane" });
    },
  };
});

// 面板的 ResizeHandle/ResizablePanel 依赖外层 ResizablePanelGroup（生产由
// WorkspaceShellLayout 提供；打桩模式照 workspaceShellRemoteMobileLayout.test.ts）。
vi.mock("@/components/ui/resizable.js", async () => {
  const React = await import("react");
  type ResizableProps = { children?: React.ReactNode; className?: string };
  return {
    ResizableHandle: ({ className }: ResizableProps) =>
      React.createElement("div", { className, "data-testid": "resizable-handle" }),
    ResizablePanel: ({ children, className }: ResizableProps) =>
      React.createElement("div", { className, "data-testid": "resizable-panel" }, children),
    ResizablePanelGroup: ({ children, className }: ResizableProps) =>
      React.createElement("div", { className, "data-testid": "resizable-group" }, children),
    // 面板 resize 把手的样式常量（真实值只影响 className 拼接，测试给占位串）。
    WORKSPACE_VERTICAL_RESIZE_HANDLE_CLASS_NAME: "mock-resize-handle",
  };
});

const teamTab: TeamSidePaneTab = {
  id: "team-tab-1",
  type: "team",
  workspaceKey: "/ws",
  workspacePath: "/ws",
  parentSessionId: "lead-session-1",
};

function renderPanel(onPrefillComposer?: (prefill: string) => void) {
  const noop = () => undefined;
  return render(
    createElement(
      DroraIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(AnimatedSidePanePanel, {
        services: {} as never,
        isVisible: true,
        sidePaneState: { tabs: [teamTab], activeTabId: teamTab.id },
        recentClosedSidePaneTabs: [],
        isBrowserOpen: false,
        workspaceAbsPath: "/ws",
        activeTaskId: "lead-session-1",
        sidePaneOwnerId: null,
        gitState: {} as never,
        activeGitSourceId: "unstaged",
        panelRef: { current: null },
        panelElementRef: { current: null },
        browserNavigationRequest: null,
        browserRestoreUrls: {},
        fileChangeFindActiveIndex: -1,
        fileChangeFindNavigationRequestId: 0,
        fileChangeFindQuery: "",
        onFileChangeFindMatchCountChange: noop,
        onCloseCodeViewer: noop,
        onCloseGit: noop,
        onActivateTab: noop,
        onOpenNewTab: noop,
        onReorderTab: noop,
        onCloseTab: noop,
        onCloseOtherTabs: noop,
        onCloseAllTabs: noop,
        onReopenClosedTab: noop,
        onOpenBrowserTab: noop,
        onOpenWhiteboard: noop,
        onOpenDeveloperTools: noop,
        onOpenFileManager: noop,
        onNavigateFileManager: noop,
        onOpenTerminalTab: noop,
        onOpenReviewTab: noop,
        onOpenSelectionSideConversation: noop,
        onOpenBrowserUrl: noop,
        onOpenCodeViewer: noop,
        onOpenSubagentSession: noop,
        onRefreshGit: noop,
        onBrowserNavigationRequestHandled: noop,
        onBrowserUrlChange: noop,
        onBrowserPageMetadataChange: noop,
        onSelectGitSource: noop,
        ...(onPrefillComposer === undefined ? {} : { onPrefillComposer }),
      }),
    ),
  );
}

afterEach(() => {
  captured.teamSidePaneProps = null;
  cleanup();
});
beforeEach(() => {
  // jsdom 无 ResizeObserver（面板内嵌组件按需观测尺寸）。
  window.ResizeObserver =
    window.ResizeObserver ??
    (class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver);
});

describe("AnimatedSidePanePanel team branch forwards onPrefillComposer (缺口9)", () => {
  it("team tab 挂载时把挂载点的 onPrefillComposer 原样传给 TeamSidePane", () => {
    const onPrefillComposer = (prefill: string) => prefill;
    renderPanel(onPrefillComposer);
    expect(screen.getByTestId("mock-team-side-pane")).toBeTruthy();
    expect((captured.teamSidePaneProps as Record<string, unknown>).onPrefillComposer).toBe(
      onPrefillComposer,
    );
  });

  it("挂载点未提供时不下发该键（TeamSidePane 保持只发命令不预填的降级行为）", () => {
    renderPanel();
    expect(screen.getByTestId("mock-team-side-pane")).toBeTruthy();
    expect(
      Object.prototype.hasOwnProperty.call(captured.teamSidePaneProps, "onPrefillComposer"),
    ).toBe(false);
  });
});
