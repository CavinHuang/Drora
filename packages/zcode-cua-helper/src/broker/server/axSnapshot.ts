var DELTA_NODE_RATIO = 0.4;
function flattenElements(elements) {
  const out = [];
  function walk(els) {
    for (const el of els) {
      out.push({ element: el, index: out.length });
      if (el.children) walk(el.children);
    }
  }
  walk(elements);
  return out;
}
function stableNodeId(el, windowTitle) {
  const role = (el.role || "").trim().toLowerCase();
  const title = (el.title || "").trim().toLowerCase();
  const win = (windowTitle || "").trim().toLowerCase();
  return `${win}\0${role}\0${title}`;
}
function materialFieldDiff(oldEl, newEl) {
  const changes: any = {};
  if ((oldEl.value || "") !== (newEl.value || "")) changes.value = newEl.value ?? "";
  const oldLabel = oldEl.title ?? oldEl.description ?? "";
  const newLabel: any = newEl.title ?? newEl.description ?? "";
  if (oldLabel !== newLabel) changes.label = newLabel;
  if ((oldEl.focused ?? false) !== (newEl.focused ?? false)) changes.focused = newEl.focused;
  if ((oldEl.enabled ?? true) !== (newEl.enabled ?? true)) changes.enabled = newEl.enabled;
  if ((oldEl.editable ?? false) !== (newEl.editable ?? false)) changes.editable = newEl.editable;
  const o: any = oldEl.bounds,
    n = newEl.bounds;
  if (o[0] !== n[0] || o[1] !== n[1] || o[2] !== n[2] || o[3] !== n[3]) changes.bounds = n;
  const oldA = (oldEl.actions || []).join(",");
  const newA: any = (newEl.actions || []).join(",");
  if (oldA !== newA) changes.actions = newEl.actions ?? [];
  return changes;
}
function groupByStableId(flat, windowTitle) {
  const map2 = /* @__PURE__ */ new Map();
  for (const entry of flat) {
    const sid = stableNodeId(entry.element, windowTitle);
    const list = map2.get(sid);
    if (list) list.push(entry);
    else map2.set(sid, [entry]);
  }
  return map2;
}
function findFocusedTitle(snap) {
  const flat = flattenElements(snap.elements);
  const focused: any = flat.find((e) => e.element.focused);
  return focused?.element.title ?? focused?.element.value ?? null;
}
export function diffAxSnapshots(oldSnap, newSnap) {
  const newFlat = flattenElements(newSnap.elements);
  const newWin = newSnap.window?.title ?? "";
  if (!oldSnap) {
    return {
      added: newFlat.map((e, i) => ({ index: i, role: e.element.role, title: e.element.title })),
      updated: [],
      removed: [],
      added_count: newFlat.length,
      updated_count: 0,
      removed_count: 0,
      focus_changed: false,
      focused_title: findFocusedTitle(newSnap),
    };
  }
  const oldWin = oldSnap.window?.title ?? "";
  const oldFlat = flattenElements(oldSnap.elements);
  const oldMap = groupByStableId(oldFlat, oldWin);
  const newMap = groupByStableId(newFlat, newWin);
  const added = [];
  const updated = [];
  const removed = [];
  for (const [sid, newList] of newMap.entries()) {
    const oldList = oldMap.get(sid) ?? [];
    if (oldList.length === 0) {
      for (const { element, index } of newList) {
        added.push({ index, role: element.role, title: element.title });
      }
    } else if (oldList.length === newList.length) {
      for (let i = 0; i < newList.length; i++) {
        const oldEl: any = oldList[i].element;
        const newEl: any = newList[i].element;
        const changes = materialFieldDiff(oldEl, newEl);
        if (Object.keys(changes).length > 0) {
          updated.push({
            index: newList[i].index,
            role: newEl.role,
            title: newEl.title,
            changes,
          });
        }
      }
    } else if (newList.length > oldList.length) {
      for (let i = oldList.length; i < newList.length; i++) {
        added.push({
          index: newList[i].index,
          role: newList[i].element.role,
          title: newList[i].element.title,
        });
      }
    } else {
      for (let i = newList.length; i < oldList.length; i++) {
        removed.push({ role: oldList[i].element.role, title: oldList[i].element.title });
      }
    }
  }
  for (const [sid, oldList] of oldMap.entries()) {
    if (!newMap.has(sid)) {
      for (const { element } of oldList) {
        removed.push({ role: element.role, title: element.title });
      }
    }
  }
  const oldFocused = findFocusedTitle(oldSnap);
  const newFocused = findFocusedTitle(newSnap);
  return {
    added: added.slice(0, 50),
    updated: updated.slice(0, 50),
    removed: removed.slice(0, 50),
    added_count: added.length,
    updated_count: updated.length,
    removed_count: removed.length,
    focus_changed: oldFocused !== newFocused,
    focused_title: newFocused,
  };
}
export function decideSnapshotMode(diff, opts) {
  if (diff === null) return "full";
  if (opts.previousWindowTitle !== opts.newWindowTitle) return "full";
  if (opts.previousWindowId !== opts.newWindowId) return "full";
  if (!sameBounds(opts.previousWindowBounds, opts.newWindowBounds)) return "full";
  const changed = diff.added_count + diff.removed_count + diff.updated_count;
  if (changed === 0 && !diff.focus_changed) return "no_change";
  if (opts.totalElements > 0 && changed / opts.totalElements > DELTA_NODE_RATIO) {
    return "full";
  }
  return "delta";
}
function sameBounds(previous, next) {
  if (previous === void 0 && next === void 0) return true;
  if (!previous || !next) return previous === next;
  return previous.every((value, index) => value === next[index]);
}
export var AxSnapshotCache = class {
  cache = /* @__PURE__ */ new Map();
  get(pid, window) {
    const windows = this.cache.get(pid);
    if (!windows) return void 0;
    if (window) return windows.get(snapshotWindowKey(window));
    let latest;
    for (const cached2 of windows.values()) latest = cached2;
    return latest;
  }
  set(pid, snapshot, stateId) {
    let windows = this.cache.get(pid);
    if (!windows) {
      windows = /* @__PURE__ */ new Map();
      this.cache.set(pid, windows);
    }
    windows.set(snapshotWindowKey(snapshot.window), { snapshot, stateId });
  }
  invalidate(pid) {
    this.cache.delete(pid);
  }
  clear() {
    this.cache.clear();
  }
};
function snapshotWindowKey(window) {
  if (typeof window.window_id === "number" && Number.isSafeInteger(window.window_id)) {
    return `window-id:${window.window_id}`;
  }
  return `bounds:${window.bounds.join(",")}|title:${window.title ?? ""}`;
}
