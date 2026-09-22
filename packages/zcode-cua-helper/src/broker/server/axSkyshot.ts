// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
// AX 树 skyshot 行协议：全量/差分渲染，供 read_element 低带宽消费。
import { permissionDenied } from "../types.js";

var SKYSHOT_ROLE = {
  AXWindow: "standard window",
  AXSheet: "sheet",
  AXDrawer: "drawer",
  AXSplitGroup: "split group",
  AXGroup: "container",
  AXScrollArea: "scroll area",
  AXOutline: "outline",
  AXTable: "table",
  AXRow: "row",
  AXCell: "cell",
  AXColumn: "column",
  AXButton: "button",
  AXMenuButton: "menu button",
  AXPopUpButton: "popup button",
  AXCheckBox: "toggle button",
  AXRadioButton: "radio button",
  AXComboBox: "combobox",
  AXSlider: "slider",
  AXIncrementor: "stepper",
  AXTextField: "text field",
  AXTextArea: "text area",
  AXSearchField: "search field",
  AXSecureTextField: "secure field",
  AXStaticText: "text",
  AXHeading: "heading",
  AXLink: "link",
  AXImage: "image",
  AXTab: "tab",
  AXTabGroup: "tab group",
  AXToolbar: "toolbar",
  AXMenuBar: "menu bar",
  AXMenu: "menu",
  AXMenuItem: "menu item",
  AXMenuBarItem: "menu bar item",
  AXCloseButton: "close button",
  AXZoomButton: "zoom button",
  AXMinimizeButton: "minimize button",
  AXFullScreenButton: "full screen button",
  AXProgressIndicator: "progress indicator",
  AXList: "list",
  AXOutlineRow: "outline row",
  AXBrowser: "browser",
  AXPopOver: "popover",
};
function roleOf(raw) {
  return SKYSHOT_ROLE[raw.role] ?? (raw.role.replace(/^AX/, "").toLowerCase() || "element");
}
function stateOf(raw) {
  const parts = [];
  if (raw.enabled === false) parts.push("disabled");
  if (raw.editable) parts.push("settable");
  if (raw.focused) parts.push("focused");
  return parts.length ? ` (${parts.join(", ")})` : "";
}
function lineOf(raw, depth) {
  const indent = "	".repeat(depth);
  const role = roleOf(raw);
  const title = raw.title ? ` ${raw.title}` : "";
  const attrs = [];
  if (raw.description) attrs.push(`Description: ${raw.description}`);
  if (raw.value != null && raw.value !== "") attrs.push(`Value: ${raw.value}`);
  const attrStr = attrs.length ? ` ${attrs.join(", ")}` : "";
  return `${indent}${role}${title}${attrStr}${stateOf(raw)}`;
}
function sigOf(raw, depth) {
  return `${depth}|${raw.role}|${raw.title ?? ""}`;
}
function buildSkyshotLines(roots) {
  const out = [];
  let index = 0;
  const walk = (nodes, depth) => {
    if (!nodes) return;
    for (const n of nodes) {
      out.push({ index, depth, sig: sigOf(n, depth), text: lineOf(n, depth) });
      index += 1;
      if (n.children && n.children.length) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}
function serializeSkyshot(roots, header) {
  const lines = buildSkyshotLines(roots);
  const head = header ? [header] : [];
  const text = head.concat(lines.map((l) => `${l.index} ${l.text}`)).join("\n");
  return { text, isDiff: false, lines };
}
var SkyshotDiffer = class {
  prev = /* @__PURE__ */ new Map();
  prevMaxIndex = /* @__PURE__ */ new Map();
  render(appKey, roots, opts) {
    const lines = buildSkyshotLines(roots);
    const header = opts?.windowTitle ? `Window: "${opts.windowTitle}"` : void 0;
    const prev = this.prev.get(appKey);
    if (!prev || opts?.disableDiff) {
      this.prev.set(appKey, lines);
      this.prevMaxIndex.set(appKey, lines.length > 0 ? lines.length - 1 : 0);
      return serializeSkyshot(roots, header);
    }
    const prevLines = prev;
    const prevBySig = new Map<string, any>(prevLines.map((l) => [l.sig, l]));
    let nextIndex = (this.prevMaxIndex.get(appKey) ?? 0) + 1;
    const out = [];
    if (header) out.push(header);
    out.push("The following is a diff from the previous accessibility tree (~ changed, + added).");
    const currSigs = /* @__PURE__ */ new Set();
    for (const l of lines) {
      currSigs.add(l.sig);
      const p = prevBySig.get(l.sig);
      if (p) {
        if (p.text !== l.text) out.push(`~ ${l.depth}	${p.index} ${l.text}`);
      } else {
        out.push(`+ ${l.depth}	${nextIndex} ${l.text}`);
        nextIndex += 1;
      }
    }
    const removed = prevLines
      .filter((l) => !currSigs.has(l.sig))
      .map((l) => l.index)
      .sort((a, b) => a - b);
    if (removed.length) out.push(`Removed element IDs: ${summarizeRanges(removed)}`);
    this.prev.set(appKey, lines);
    this.prevMaxIndex.set(appKey, nextIndex - 1);
    return { text: out.join("\n"), isDiff: true, lines };
  }
  clear(appKey) {
    if (appKey) {
      this.prev.delete(appKey);
      this.prevMaxIndex.delete(appKey);
    } else {
      this.prev.clear();
      this.prevMaxIndex.clear();
    }
  }
};
function summarizeRanges(ids) {
  if (ids.length === 0) return "";
  const out = [];
  let start = ids[0];
  let prev = ids[0];
  for (let i = 1; i < ids.length; i += 1) {
    const v = ids[i];
    if (v === prev + 1) {
      prev = v;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = v;
  }
  out.push(start === prev ? `${start}` : `${start}-${prev}`);
  return out.join(", ");
}
var sharedDiffer = new SkyshotDiffer();
function createGetSkyshotHandler(source) {
  return async (params) => {
    const appRef = params.app_ref ?? {};
    const snapshot = await source.captureApp(appRef, {
      includeScreenshot: false,
    });
    if (!snapshot) {
      throw permissionDenied(
        "get_skyshot could not read the accessibility tree (Accessibility not granted, or app not scriptable).",
      );
    }
    const appKey = String(snapshot.app.pid ?? snapshot.app.bundle_id ?? "default");
    const sky = sharedDiffer.render(appKey, snapshot.elements, {
      windowTitle: snapshot.window.title ?? void 0,
      disableDiff: params.disable_diff === true,
    });
    return { text: sky.text, is_diff: sky.isDiff };
  };
}
