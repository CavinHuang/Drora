// @vitest-environment jsdom
/**
 * L12/L14 回归（specs/agents-team.md §18 附裁二：审批卡逐层对齐 workflow 确认卡）：
 * - L12：反馈行（revise note 输入）此前嵌在 role="listbox" 容器内但自身不是 option
 *   （ARIA 歧义）；现照 PermissionDialog（listbox 闭合后作兄弟节点）移出。
 * - L14：确认钮颜色对齐 PermissionDialog 确认钮（bg-brand 品牌蓝），两卡并排不再异色。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { TeamStagedEditor } from "@/team/TeamStagedEditor.js";
import type { TeamPanelStagedDraftView } from "@/team/view-model.js";

const DRAFT: TeamPanelStagedDraftView = {
  members: [
    { memberName: "alice", modelSelection: { provider: "bigmodel", model: "glm" } },
    { memberName: "bob" },
  ],
  tasks: [{ taskId: "task_1", title: "调研定价页", dependsOn: [] }],
  awaitingFeedback: false,
};

function renderEditor(): void {
  render(
    createElement(
      DroraIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(TeamStagedEditor, {
        draft: DRAFT,
        onApprove: vi.fn(),
        onRevise: vi.fn(),
        onAbandon: vi.fn(),
      }),
    ),
  );
}

afterEach(cleanup);

describe("TeamStagedEditor 反馈行结构（§18 附裁二 / L12）", () => {
  it("listbox 含四个 option（§10 增补六）；反馈行不在 listbox 内（照 PermissionDialog 兄弟节点结构）", () => {
    renderEditor();

    const listbox = screen.getByRole("listbox");
    expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(4);
    // 反馈行是 listbox 的兄弟节点，不是它的子节点。
    const note = screen.getByTestId("team-staged-revise-note");
    expect(note.closest('[role="listbox"]')).toBeNull();
    expect(listbox.parentElement?.contains(note)).toBe(true);
  });
});

describe("TeamStagedEditor 权限平铺列表（§10 增补六）", () => {
  it("radiogroup 五行带说明；组标题行与选项 listbox 相互独立", () => {
    renderEditor();

    const group = screen.getByRole("radiogroup");
    const radios = group.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(5);
    // 每行都有说明文本（description 键双语在场由 i18n 测试锁）。
    const yolo = screen.getByTestId("team-staged-member-mode-yolo");
    expect(yolo.getAttribute("aria-checked")).toBe("false");
    expect(yolo.textContent).not.toBe("");
    // radiogroup 不在动作 listbox 内。
    expect(group.closest('[role="listbox"]')).toBeNull();
  });
});

describe("TeamStagedEditor 确认钮颜色（§18 附裁二 / L14）", () => {
  it("确认钮带 bg-brand 品牌蓝类（对照 PermissionDialog 确认钮同款类名）", () => {
    renderEditor();

    const confirm = screen.getByTestId("team-staged-confirm");
    expect(confirm.className).toContain("bg-brand");
    expect(confirm.className).toContain("text-foreground-inverse");
    expect(confirm.className).toContain("hover:bg-brand/80");
    // cn 的 tailwind-merge 应去掉 default variant 的 bg-primary（否则两色并存按 CSS
    // 顺序不可控）——PermissionDialog 确认钮同机制，这里锁定覆盖确实发生。
    expect(confirm.className).not.toContain("bg-primary");
  });
});
