// @vitest-environment jsdom
import { createElement, Fragment } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectSidebarListHeader } from "@/project-sidebar/ProjectSidebarListHeader.js";
import { ProjectSidebarNavigation } from "@/project-sidebar/ProjectSidebarNavigation.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";

vi.mock("@/NewTaskButtonGroup.js", () => ({ NewTaskButtonGroup: () => null }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  ["MacIntel", "⌘ K"],
  ["Win32", "Ctrl+K"],
  ["Linux x86_64", "Ctrl+K"],
])(
  "SBV01: title row search icon opens existing search with the %s shortcut",
  async (platform, shortcut) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform!);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(platform!);
    const onOpenCommandCenter = vi.fn();
    render(
      createElement(
        TooltipProvider,
        {},
        createElement(
          Fragment,
          {},
          createElement(ProjectSidebarNavigation, {
            props: {},
            onCreate: vi.fn(),
          }),
          createElement(ProjectSidebarListHeader, {
            onOpenCommandCenter,
            view: "projects",
            onViewChange: vi.fn(),
          }),
        ),
      ),
    );
    const search = screen.getByTestId("sidebar-search-open");
    expect(search.tagName).toBe("BUTTON");
    expect(search.querySelector("input")).toBeNull();
    expect(search.textContent).toBe("");
    expect(search.getAttribute("aria-label")).toBe("commandCenter.open");
    expect(screen.getByTestId("sidebar-search-toolbar").querySelector("kbd")).toBeNull();
    fireEvent.focus(search);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.querySelector('[data-slot="kbd"]')?.textContent).toBe(shortcut);
    fireEvent.click(search);
    expect(onOpenCommandCenter).toHaveBeenCalledOnce();
  },
);

it("SBV02: filter has project, group and recent update choices", async () => {
  const onViewChange = vi.fn();
  render(
    createElement(
      TooltipProvider,
      {},
      createElement(
        Fragment,
        {},
        createElement(ProjectSidebarNavigation, {
          props: {},
          onCreate: vi.fn(),
        }),
        createElement(ProjectSidebarListHeader, {
          onOpenCommandCenter: vi.fn(),
          view: "projects",
          onViewChange,
        }),
      ),
    ),
  );
  const trigger = screen.getByTestId("sidebar-view-menu");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const choices = await screen.findAllByRole("menuitemradio");
  expect(choices).toHaveLength(3);
  expect(choices[0]?.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByTestId("sidebar-view-timeline"));
  expect(onViewChange).toHaveBeenCalledWith("timeline");
});

// 审计 docs/upstream-sync/2026-10-21-v3.16.1-merge-audit.md F7：vault 侧栏入口以
// Drora 扩展槽位回植，组件级验证接线渲染、点击回调与选中态。
it("SBV03: vault entry renders when wired and click invokes onOpenVault", () => {
  const onOpenVault = vi.fn();
  render(
    createElement(
      TooltipProvider,
      {},
      createElement(ProjectSidebarNavigation, {
        props: { onOpenVault },
        onCreate: vi.fn(),
      }),
    ),
  );
  const vault = screen.getByTestId("vault-sidebar-open");
  expect(vault.tagName).toBe("BUTTON");
  expect(vault.textContent).toBe("workspace.openVault");
  fireEvent.click(vault);
  expect(onOpenVault).toHaveBeenCalledOnce();
});

it("SBV04: vault entry reflects vaultActive pressed and highlight state", () => {
  render(
    createElement(
      TooltipProvider,
      {},
      createElement(ProjectSidebarNavigation, {
        props: { onOpenVault: vi.fn(), vaultActive: true },
        onCreate: vi.fn(),
      }),
    ),
  );
  const vault = screen.getByTestId("vault-sidebar-open");
  expect(vault.getAttribute("aria-pressed")).toBe("true");
  expect(vault.className).toContain("bg-selected");
});

it("SBV05: vault entry stays absent when the extension slot is not wired", () => {
  render(
    createElement(
      TooltipProvider,
      {},
      createElement(ProjectSidebarNavigation, { props: {}, onCreate: vi.fn() }),
    ),
  );
  expect(screen.queryByTestId("vault-sidebar-open")).toBeNull();
});
