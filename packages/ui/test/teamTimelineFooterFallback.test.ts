/**
 * M14 回归（specs/agents-team.md §10 增补五）：渲染**真实** ConversationTimeline，锁定
 * 团队卡「锚定轮轮内 / 无锚定轮 footer 钉底」两条路由的互斥——锚定轮在场时 footerSlot
 * 让位（ConversationTimeline.tsx「§10 增补五」注释处条件），无锚定轮时 footerSlot 钉底
 * 渲染。若该抑制条件回归（轮内 + 钉底双挂载同一张卡），本测试失败。
 *
 * harness 照 v4ConversationTimelineScrollMemory.test.ts：自制最小 DOM + mock
 * @tanstack/react-virtual 与 ConversationTurnGroup（捕获 teamCardSlot 下发）。文件收
 * .ts 扩展名即被根 vitest unit 通道的 include 模式命中（见 vitest.config.ts 的 unit
 * 工程 include；此处刻意不内联该 glob 字面量——块注释里的星号加斜杠序列会提前闭合
 * 注释、余文被当代码解析，与本批 L13 修复的注释吞码同型错误）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationRow } from "@drora/shared/drora-protocol-v4";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import { ConversationTimeline } from "@/v4/ConversationTimeline.js";

const virtualItems = vi.hoisted(() => ({
  items: [] as Array<{ index: number; key: string; start: number; size: number; end: number }>,
}));

const turnGroupCalls = vi.hoisted(() => ({
  teamCardSlotByTurnKey: new Map<string, unknown>(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItemForOffset: vi.fn(),
    getTotalSize: () => 1_200,
    getVirtualItems: () => virtualItems.items,
    measurementsCache: [],
    measure: vi.fn(),
    measureElement: vi.fn(),
    resizeItem: vi.fn(),
    scrollOffset: null,
    scrollRect: null,
    scrollToIndex: vi.fn(),
    shouldAdjustScrollPositionOnItemSizeChange: null,
  }),
}));

vi.mock("@/v4/ConversationTurnGroup.js", async () => {
  const React = await import("react");
  return {
    ConversationTurnGroup: (props: Record<string, unknown>) => {
      const unit = props.unit as { key: string };
      turnGroupCalls.teamCardSlotByTurnKey.set(
        unit.key,
        "teamCardSlot" in props ? props.teamCardSlot : "__absent__",
      );
      return React.createElement(
        "div",
        { "data-testid": "mock-turn-group", "data-turn-key": unit.key },
        props.teamCardSlot ?? null,
      );
    },
  };
});

vi.mock("@/v4/ConversationTurnNavigator.js", () => ({
  ConversationTurnNavigator: () => null,
}));

vi.mock("@/v4/useConversationTimelineFind.js", () => ({
  useConversationTimelineFind: () => undefined,
}));

type TestEventHandler = (event: Record<string, unknown>) => void;
type TestElement = Element & {
  __attrs: Map<string, string>;
  __listeners: Map<string, TestEventHandler[]>;
  childNodes: TestElement[];
  parentNode: TestElement | null;
  scrollTop: number;
};

let nextFrameId = 1;
const animationFrames = new Map<number, FrameRequestCallback>();
const scheduledMicrotasks: Array<() => void> = [];
const nativeQueueMicrotask = globalThis.queueMicrotask;
let mountedRoot: Root | null = null;
let mountedContainer: TestElement | null = null;
const layout = { clientHeight: 300, scrollHeight: 1_200 };

function createMinimalElement(ownerDocument: Document, tagName = "div"): TestElement {
  let scrollTop = 0;
  const element = {
    __attrs: new Map<string, string>(),
    __listeners: new Map<string, TestEventHandler[]>(),
    addEventListener: (type: string, handler: TestEventHandler) => {
      element.__listeners.set(type, [...(element.__listeners.get(type) ?? []), handler]);
    },
    appendChild: (child: TestElement) => {
      child.parentNode = element as unknown as TestElement;
      element.childNodes.push(child);
      return child;
    },
    childNodes: [] as TestElement[],
    dispatchEvent: () => true,
    getBoundingClientRect: () => ({
      bottom: layout.clientHeight,
      height: layout.clientHeight,
      left: 0,
      right: 800,
      top: 0,
      width: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    getAttribute: (name: string) => element.__attrs.get(name) ?? null,
    insertBefore: (child: TestElement, beforeChild?: TestElement | null) => {
      child.parentNode = element as unknown as TestElement;
      const index = beforeChild ? element.childNodes.indexOf(beforeChild) : -1;
      if (index >= 0) element.childNodes.splice(index, 0, child);
      else element.childNodes.push(child);
      return child;
    },
    nodeName: tagName.toUpperCase(),
    nodeType: 1,
    ownerDocument,
    parentNode: null as TestElement | null,
    removeAttribute: (name: string) => element.__attrs.delete(name),
    removeChild: (child: TestElement) => {
      element.childNodes = element.childNodes.filter((item) => item !== child);
      child.parentNode = null;
      return child;
    },
    removeEventListener: (type: string, handler: TestEventHandler) => {
      element.__listeners.set(
        type,
        (element.__listeners.get(type) ?? []).filter((item) => item !== handler),
      );
    },
    querySelectorAll: () => [],
    setAttribute: (name: string, value: string) => {
      element.__attrs.set(name, String(value));
    },
    style: {},
    tagName: tagName.toUpperCase(),
  };
  Object.defineProperties(element, {
    clientHeight: { get: () => layout.clientHeight },
    scrollHeight: { get: () => layout.scrollHeight },
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.min(
          Math.max(Number(value) || 0, 0),
          Math.max(layout.scrollHeight - layout.clientHeight, 0),
        );
      },
    },
  });
  return element as unknown as TestElement;
}

function installMinimalDom(): TestElement {
  const documentMock = {
    addEventListener: () => {},
    createElement: (tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createElementNS: (_namespace: string, tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createTextNode: (nodeValue: string) => ({
      nodeType: 3,
      nodeValue,
      ownerDocument: documentMock,
      parentNode: null,
    }),
    nodeType: 9,
    removeEventListener: () => {},
  } as unknown as Document;
  const windowMock = {
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    cancelAnimationFrame: (frameId: number) => animationFrames.delete(frameId),
    document: documentMock,
    HTMLElement: function HTMLElement() {},
    HTMLIFrameElement: function HTMLIFrameElement() {},
    Node: function Node() {},
    queueMicrotask: (callback: () => void) => scheduledMicrotasks.push(callback),
    removeEventListener: () => {},
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      animationFrames.set(frameId, callback);
      return frameId;
    },
  };
  Object.assign(globalThis, {
    document: documentMock,
    HTMLElement: windowMock.HTMLElement,
    HTMLIFrameElement: windowMock.HTMLIFrameElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    Node: windowMock.Node,
    window: windowMock,
  });
  return createMinimalElement(documentMock, "div");
}

function countByTestId(node: TestElement, testId: string): number {
  let count = node.getAttribute("data-testid") === testId ? 1 : 0;
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue;
    count += countByTestId(child, testId);
  }
  return count;
}

function teamTurnRows(withTeamSpawn: boolean): ConversationRow[] {
  const base = [
    {
      rowId: 1,
      turnId: "turn-1",
      createdAt: 1_700_000_000_000,
      createdAtSeq: 1,
      kind: "turnHeader",
      origin: "userInput",
      state: "completedSuccess",
      startedAt: 1_700_000_000_000,
    },
    {
      rowId: 2,
      turnId: "turn-1",
      createdAt: 1_700_000_000_002,
      createdAtSeq: 2,
      kind: "userInput",
      text: "组一支团队",
      origin: "realUser",
    },
  ];
  const teamSpawn = {
    rowId: 3,
    turnId: "turn-1",
    createdAt: 1_700_000_000_003,
    createdAtSeq: 3,
    kind: "toolCall",
    toolCallId: "tool-team-spawn",
    toolName: "TeamSpawn",
    status: "success",
    input: {},
    inputText: "{}",
  };
  const finalText = {
    rowId: 4,
    entityId: "message-assistant-4",
    turnId: "turn-1",
    createdAt: 1_700_000_000_004,
    createdAtSeq: 4,
    kind: "assistantText",
    state: "complete",
    text: "团队已组建完成。",
  };
  return [
    ...base,
    ...(withTeamSpawn ? [teamSpawn] : []),
    finalText,
  ] as unknown as ConversationRow[];
}

const rowContext: ConversationRowRenderContext = {
  codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
  sessionId: "session-1",
  theme: "system",
  workspacePath: "/workspace",
};

function flushScheduledMicrotasks(): void {
  while (scheduledMicrotasks.length > 0) {
    scheduledMicrotasks.shift()?.();
  }
}

function flushAnimationFrames(): void {
  const frameIds = [...animationFrames.keys()];
  for (const frameId of frameIds) {
    const callback = animationFrames.get(frameId);
    if (!callback) continue;
    animationFrames.delete(frameId);
    callback(0);
  }
}

function renderTimeline(rows: ConversationRow[]): void {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mountedContainer = installMinimalDom();
  mountedRoot = createRoot(mountedContainer);
  act(() => {
    mountedRoot!.render(
      createElement(
        DroraIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(ConversationTimeline, {
          rows,
          totalCount: rows.length,
          sessionKey: "session-1",
          rowContext,
          teamCardSlot: createElement("div", { "data-testid": "team-card-inline" }),
          footerSlot: createElement("div", { "data-testid": "team-card-footer" }),
        }),
      ),
    );
  });
  act(() => {
    flushAnimationFrames();
    flushScheduledMicrotasks();
  });
}

beforeEach(() => {
  virtualItems.items = [{ index: 0, key: "0", start: 0, size: 400, end: 400 }];
  turnGroupCalls.teamCardSlotByTurnKey.clear();
  nextFrameId = 1;
  animationFrames.clear();
  scheduledMicrotasks.length = 0;
});

afterEach(() => {
  act(() => {
    flushScheduledMicrotasks();
    mountedRoot?.unmount();
    flushScheduledMicrotasks();
  });
  mountedRoot = null;
  mountedContainer = null;
  animationFrames.clear();
  scheduledMicrotasks.length = 0;
  vi.unstubAllGlobals();
  globalThis.queueMicrotask = nativeQueueMicrotask;
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
});

describe("ConversationTimeline 团队卡锚定/钉底互斥（§10 增补五 / M14）", () => {
  it("无锚定轮（无 TeamSpawn 行）：footerSlot 钉底渲染，TurnGroup 不收 teamCardSlot", () => {
    renderTimeline(teamTurnRows(false));

    expect(mountedContainer).not.toBeNull();
    expect(countByTestId(mountedContainer!, "team-card-footer")).toBe(1);
    expect(countByTestId(mountedContainer!, "team-card-inline")).toBe(0);
    expect(turnGroupCalls.teamCardSlotByTurnKey.size).toBeGreaterThan(0);
    for (const slot of turnGroupCalls.teamCardSlotByTurnKey.values()) {
      expect(slot).toBe("__absent__");
    }
  });

  it("有锚定轮（含 TeamSpawn 行）：teamCardSlot 下发给锚定轮 TurnGroup，footer 让位不双挂载", () => {
    renderTimeline(teamTurnRows(true));

    expect(mountedContainer).not.toBeNull();
    // 轮内挂载恰好一次（经 mock TurnGroup 渲染 slot 内容）。
    expect(countByTestId(mountedContainer!, "team-card-inline")).toBe(1);
    // footer 钉底被抑制——同一时刻同一张卡只挂载一份。
    expect(countByTestId(mountedContainer!, "team-card-footer")).toBe(0);
    const anchored = [...turnGroupCalls.teamCardSlotByTurnKey.entries()].filter(
      ([, slot]) => slot !== "__absent__",
    );
    expect(anchored).toHaveLength(1);
  });
});
