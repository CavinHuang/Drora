import { afterEach, describe, expect, it } from "vitest";
import {
  acquirePluginUiPage,
  deliverPluginUiPageOpenWith,
  notifyPluginUiPageOpenWith,
  pluginUiPages,
} from "./pluginUiPageRegistry.js";
import type { Page } from "./pluginUiHostTypes.js";

// g9 宿主→面板 openWith 的窗口级投递（specs/obsidian-vault-phase2-true-extraction.md §6/§8）：
// 页面在场直接转发；navigate 编排（刚开 tab、页面异步准入中）等创建后投递一次，超时如实放弃。
describe("g9 页面管理器定向投递", () => {
  const key = "plugin-ui:test-open-with";
  afterEach(() => {
    pluginUiPages.removeTask("task-1");
    pluginUiPages.clear();
  });
  it("页面不在场返回 false；在场转发 notifyOpenWith", async () => {
    expect(notifyPluginUiPageOpenWith(key, { a: 1 })).toBe(false);
    const delivered: unknown[] = [];
    await acquirePluginUiPage(key, () => buildStubPage(key, (payload) => delivered.push(payload)));
    expect(notifyPluginUiPageOpenWith(key, { a: 1 })).toBe(true);
    // deliver：页面已在场立即投递。
    expect(await deliverPluginUiPageOpenWith(key, { b: 2 }, 50)).toBe(true);
    expect(delivered).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("deliver 等待异步准入中的页面创建后投递；页面移除后超时如实放弃", async () => {
    const delivered: unknown[] = [];
    // acquirePluginUiPage 的准入是异步的：deliver 的首次检查可能先于页面登记，
    // 必须经 subscribePage 的创建通知补投（两种时序都只投一次）。
    const pending = acquirePluginUiPage(key, () =>
      buildStubPage(key, (payload) => delivered.push(payload)),
    );
    const delivering = deliverPluginUiPageOpenWith(key, { later: true }, 1_000);
    await pending;
    expect(await delivering).toBe(true);
    expect(delivered).toEqual([{ later: true }]);
    pluginUiPages.removeTask("task-1");
    expect(await deliverPluginUiPageOpenWith(key, { c: 3 }, 50)).toBe(false);
  });

  function buildStubPage(pageKey: string, notify: (payload: unknown) => void): Page {
    return {
      kind: "mcp",
      key: pageKey,
      task: "task-1",
      visible: false,
      snapshot: () => ({}) as never,
      start: () => {},
      update: () => {},
      updateToolFeed: () => {},
      subscribe: () => () => {},
      bind: () => () => {},
      busy: () => false,
      running: () => false,
      suspend: async () => true,
      notifyOpenWith: notify,
      destroy: () => {},
    };
  }
});
