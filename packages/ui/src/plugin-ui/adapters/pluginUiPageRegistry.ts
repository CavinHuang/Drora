import { PluginUiBackgroundRetention } from "@/plugin-ui/app/pluginUiBackgroundRetention.js";
import { sandboxPages, onSandboxPageRemoved } from "./sandboxPageOwners.js";
import type { Page } from "./pluginUiHostTypes.js";
const retention = new PluginUiBackgroundRetention<Page>(
  (run, ms) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
  () => Date.now(),
);
if (typeof document !== "undefined") {
  retention.setWindowVisible(!document.hidden);
  document.addEventListener("visibilitychange", () => retention.setWindowVisible(!document.hidden));
}
export const pluginUiPages = {
  get(key: string): Page | undefined {
    const page = sandboxPages.get(key);
    return page?.kind === "mcp" ? (page as Page) : undefined;
  },
  add: (page: Page) => sandboxPages.add(page),
  reserve: (page: Page) => sandboxPages.reserve(page),
  prepared(page: Page, retain: boolean) {
    if (retain) retention.register(page);
    else retention.release(page);
    // 冷后台页面没有 visibility 边沿，也必须启动普通页面的五分钟期限。
    sandboxPages.visibility(page, page.visible);
  },
  claimRecycle: (page: Page) => retention.claim(page),
  finishRecycle: (page: Page) => retention.finish(page),
  activity: (page: Page) => retention.activity(page),
  released(page: Page) {
    retention.release(page);
    sandboxPages.released(page);
  },
  visibility(page: Page, visible: boolean) {
    sandboxPages.visibility(page, visible);
    retention.activity(page);
  },
  settled(page: Page) {
    sandboxPages.settled(page);
    retention.changed();
  },
  removeTask: (task: string) => sandboxPages.removeTask(task),
  clear: () => sandboxPages.clear(),
};

const pageSubscribers = new Map<string, Set<() => void>>();
export function subscribePage(key: string, listener: () => void): () => void {
  const set = pageSubscribers.get(key) ?? new Set();
  set.add(listener);
  pageSubscribers.set(key, set);
  let off: (() => void) | undefined;
  const connect = () => {
    off?.();
    off = pluginUiPages.get(key)?.subscribe(listener);
    listener();
  };
  set.delete(listener);
  set.add(connect);
  const offRemoved = onSandboxPageRemoved(key, connect);
  connect();
  return () => {
    off?.();
    offRemoved();
    set.delete(connect);
    if (!set.size) pageSubscribers.delete(key);
  };
}
export function bindPluginUiPage(key: string, node: HTMLElement, sidebar: boolean): () => void {
  let off: (() => void) | undefined;
  let bound: Page | undefined;
  const connect = () => {
    const page = pluginUiPages.get(key);
    if (page === bound) return;
    off?.();
    bound = page;
    off = page?.bind(node, sidebar);
  };
  const unsubscribe = subscribePage(key, connect);
  return () => {
    unsubscribe();
    off?.();
  };
}

export function notifyPluginUiPageCreated(key: string): void {
  for (const listener of pageSubscribers.get(key) ?? []) listener();
}

const creating = new Map<string, Promise<Page>>();
export function acquirePluginUiPage(key: string, create: () => Page): Promise<Page> {
  const current = pluginUiPages.get(key);
  if (current) return Promise.resolve(current);
  const existing = creating.get(key);
  if (existing) return existing;
  const page = create();
  const pending = pluginUiPages
    .add(page)
    .then(
      () => {
        // admission 后即启动；请求方此时可能已切页，不能依赖 React 后续 update 或锚点。
        page.start();
        notifyPluginUiPageCreated(key);
        return page;
      },
      (error) => {
        page.destroy();
        throw error;
      },
    )
    .finally(() => {
      if (creating.get(key) === pending) creating.delete(key);
    });
  creating.set(key, pending);
  return pending;
}

/**
 * g9 宿主→面板 openWith 的窗口级投递入口（specs/obsidian-vault-phase2-true-extraction.md
 * §6/§8，C5a citation 打开路由）。key 为 `buildPluginUiSurfaceKey` 结果；页面已在
 * 窗口管理器里（面板 tab 已打开）时直接转发，controller 未握手则由其暂存补发。
 * 页面不存在返回 false——调用方（P5 UI 编排）按「先打开面板 tab、再投递载荷」的顺序
 * 使用；不在此隐式建页面，避免绕过锚点/容量准入。
 */
export function notifyPluginUiPageOpenWith(key: string, payload: unknown): boolean {
  const page = pluginUiPages.get(key);
  if (!page) return false;
  page.notifyOpenWith(payload);
  return true;
}

/**
 * g9 navigate 编排用的投递变体：面板页尚不在窗口（刚请求打开 tab，页面在异步准入中）时，
 * 等页面创建后投递一次；超时（对齐握手上限 15s）如实放弃并返回 false。
 * 只等待「已发起打开」的页面，不做任何打开动作——打开仍归 UI 层（launcher / navigate handler）。
 */
export function deliverPluginUiPageOpenWith(
  key: string,
  payload: unknown,
  timeoutMs = 15_000,
): Promise<boolean> {
  if (notifyPluginUiPageOpenWith(key, payload)) return Promise.resolve(true);
  return new Promise((resolve) => {
    // subscribePage 订阅时同步触发一次 listener（覆盖「首次检查与订阅之间页面已创建」的竞态），
    // 因此 finish 必须容忍在 off 赋值前被调用：先以空函数占位，避免 TDZ 崩溃。
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let off: () => void = () => {};
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      off();
      resolve(ok);
    };
    off = subscribePage(key, () => {
      if (notifyPluginUiPageOpenWith(key, payload)) finish(true);
    });
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}
