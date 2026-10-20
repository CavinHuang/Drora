// @vitest-environment jsdom
// 继任测试：移植自 packages/ui/test/v4ConversationDraftEmptyStateLogo.test.ts（7ced6f898）。
// 上游 v3.16.1 删除旧测试路径；Drora 有意分歧（specs/drora-rename.md「首页空态水印」）
// ——双主题 D 形轮廓单变体，不得采纳上游 Z 形双变体——由本测试继续守护。

import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { ConversationDraftEmptyState } from "@/v4/ConversationDraftEmptyState.js";

afterEach(() => {
  cleanup();
});

describe("ConversationDraftEmptyState logo", () => {
  it("renders the single Drora D-outline watermark for both themes", () => {
    const { container } = render(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(ConversationDraftEmptyState),
      ),
    );

    // 修复依据见 specs/drora-rename.md「首页空态水印品牌回归修复」：双主题统一为
    // D 形轮廓单变体（currentColor + 内置渐隐 mask）；v3.15.1 整合曾误搬上游
    // 「浅色 Z inline + 暗色 drora-mark.svg img」双变体，此断言防止其再次回归。
    const logo = container.querySelector("svg");
    const watermarkPath = logo?.querySelector("path");
    const fadeGroup = logo?.querySelector("g");

    expect(logo).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-v4-draft-logo="dark"]')).toBeNull();
    expect(logo?.getAttribute("class") ?? "").toContain("opacity-70");
    expect(watermarkPath?.getAttribute("d") ?? "").toMatch(/^M0 0H74C96\.25/);
    expect(watermarkPath?.getAttribute("stroke")).toBe("currentColor");
    expect(watermarkPath?.getAttribute("stroke-width")).toBe("1");
    expect(fadeGroup?.getAttribute("mask")).toBe("url(#drora-outline-fade-mask)");
  });
});
