// @vitest-environment jsdom
/**
 * 「模型能力」导航分组守护（specs/model-capabilities.md §5.1；MC-5 导航面）：
 * - 第三分组 capabilities 恒出现，五条目固定顺序（= shared MODEL_CAPABILITY_PURPOSES 契约顺序）；
 * - 条目不参与 dnd（getSortableProviderId 返回 null → 固定渲染分支）；
 * - 选中 key 语义（resolveModelProviderSideSelectionKey 原样返回 capability 节点 key）。
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  ModelProviderNavGroup,
  ModelProviderNavItem,
} from "@/settings/model-provider-section/constants.js";
import { getSortableProviderId } from "@/settings/model-provider-section/Navigation.js";
import { resolveModelProviderSideSelectionKey } from "@/settings/ModelProviderSection.js";
import { useModelProviderNavigation } from "@/settings/model-provider-section/useModelProviderNavigation.js";
import { MODEL_CAPABILITY_NAV_PURPOSES, createCapabilityNodeKey } from "./capabilityNav.js";

const intl = { formatMessage: ({ id }: { id: string }) => id } as never;

function mountNavigation() {
  return renderHook(() =>
    useModelProviderNavigation({
      presetProviders: [],
      modelProviders: [],
      selectedNodeKey: null,
      setSelectedNodeKey: vi.fn(),
      intl,
    }),
  );
}

describe("「模型能力」导航分组（specs/model-capabilities.md §5.1）", () => {
  it("第三分组 capabilities：条目固定顺序 = 契约 purpose 顺序（P7 后三条目）", () => {
    const { result } = mountNavigation();
    const groups = result.current.navigationGroups;
    expect(groups.map((group: ModelProviderNavGroup) => group.id)).toEqual([
      "preset",
      "custom",
      "capabilities",
    ]);
    const capabilitiesGroup = groups[2]!;
    expect(capabilitiesGroup.items.map((item: ModelProviderNavItem) => item.key)).toEqual(
      MODEL_CAPABILITY_NAV_PURPOSES.map((purpose) => createCapabilityNodeKey(purpose)),
    );
  });

  it("能力条目不参与 dnd 排序（getSortableProviderId 恒 null → 固定渲染分支）", () => {
    const { result } = mountNavigation();
    const capabilityItems = result.current.navigationGroups[2]!.items as ModelProviderNavItem[];
    for (const item of capabilityItems) {
      expect(item.type).toBe("capability");
      expect(getSortableProviderId(item)).toBeNull();
    }
  });

  it("选中能力条目：side selection key 原样返回节点 key（无 family 归一）", () => {
    const item = {
      key: createCapabilityNodeKey("asr"),
      type: "capability",
      purpose: "asr",
      label: "语音识别",
    } as never as ModelProviderNavItem;
    expect(resolveModelProviderSideSelectionKey(item)).toBe("capability:asr");
  });
});
