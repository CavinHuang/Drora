// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealVaultQuoteIfCurrent } from "../src/v4/vault/vault-quote-reveal.js";

let container: HTMLDivElement;
let editor: EditorView;

beforeEach(() => {
  // CodeMirror measures the DOM using these native APIs. JSDOM intentionally
  // does not do real layout; assert selection/focus with its real editor state,
  // but leave visual scroll-position validation to the Electron GUI gate.
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  Range.prototype.getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  container = document.createElement("div");
  document.body.appendChild(container);
  const initial = Array.from({ length: 12 }, (_, i) => `paragraph ${i + 1}`).join("\n");
  editor = new EditorView({
    state: EditorState.create({ doc: initial }),
    parent: container,
  });
});

afterEach(() => {
  editor.destroy();
  container.remove();
  vi.unstubAllGlobals();
});

describe("real CodeMirror citation quote reveal (renderer mount)", () => {
  it("selects exactly the verified pair of lines, keeps text unchanged and focuses editor", () => {
    const snapshot = editor.state.doc.toString();
    expect(revealVaultQuoteIfCurrent(
      editor, { startLine: 5, endLine: 6 }, 4, 4,
    )).toBe(true);
    const expectedFrom = editor.state.doc.line(5).from;
    const expectedTo = editor.state.doc.line(6).to;
    expect(editor.state.selection.main.from).toBe(expectedFrom);
    expect(editor.state.selection.main.to).toBe(expectedTo);
    expect(editor.state.sliceDoc(expectedFrom, expectedTo)).toBe("paragraph 5\nparagraph 6");
    expect(editor.state.doc.toString()).toBe(snapshot);
    expect(editor.hasFocus).toBe(true);
  });

  it("does not change selection or steal focus after a scope epoch switch", () => {
    const before = editor.state.selection.main;
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    expect(revealVaultQuoteIfCurrent(
      editor, { startLine: 7, endLine: 8 }, 1, 3,
    )).toBe(false);
    expect(editor.state.selection.main.eq(before)).toBe(true);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("clamps line positions for a valid currently-bound quote", () => {
    expect(revealVaultQuoteIfCurrent(
      editor, { startLine: 50, endLine: 80 }, 9, 9,
    )).toBe(true);
    expect(editor.state.selection.main.from).toBe(editor.state.doc.line(12).from);
    expect(editor.state.selection.main.to).toBe(editor.state.doc.line(12).to);
  });
});
