/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
import { randomBytes } from "node:crypto";
import { textRangeSplitsUtf16SurrogatePair } from "../../lib/unicode-text-range.js";
import { normalizeAxTree } from "../../targeting/treeNormalization.js";
import { withBrokerPresentation } from "../presentation.js";
import {
  actionUnavailable,
  elementUnavailable,
  notSelectable,
  notSettable,
  permissionDenied,
} from "../types.js";
import { AxSnapshotCache, decideSnapshotMode, diffAxSnapshots } from "./axSnapshot.js";
// 清退（2026-11-10 R10 后续）：createGetSkyshotHandler（./axSkyshot.js）已随
// get_skyshot broker 方法删除——skyshot/SkyshotDiffer/get_skyshot 在官方 0.6.5
// win entry 与官方 mac SEA（3.17.2）双零命中；axSkyshot.ts 整文件删除。
// 还原自发行 bundle（官方 0.6.5 win32 entry :21534-21595/:23003）：投递轨迹封套
//（appendAttempt/finalizeDelivery，windowsDeliveryReceipt.ts）、写后读回裁决
//（windowsValueReadback.ts）与 win32 操作域的菜单期望标记
//（windows-operation-request.ts expectWindowsMenu）。
import { appendAttempt, finalizeDelivery } from "./windowsDeliveryReceipt.js";
import { applyAxEchoSurfaceTrust, classifyReplacementReadback } from "./windowsValueReadback.js";
import { expectWindowsMenu } from "../../native/windows-operation-request.js";
import {
  canonicalizeCuaBundleId,
  resolvePidBundleId,
  resolvePidIdentity,
} from "./cuaAppIdentity.js";

export var AxTokenRegistry = class {
  counter = 0;
  // 修复原因：Helper restart 后 counter 会从 1 重置；若 token 只有 ax-<n>，旧 MCP state
  // 里的 token 可能在新 Helper 中命中另一个元素。每次进程构造 registry 时加入 128-bit
  // 随机实例域，让跨 restart 的旧 token 必定 fail-closed，而不依赖调用方主动清缓存。
  bootNonce = randomBytes(16).toString("hex");
  tokenToRef = /* @__PURE__ */ new Map();
  refToToken = /* @__PURE__ */ new Map();
  refToOwnerPid = /* @__PURE__ */ new Map();
  refToBundleId = /* @__PURE__ */ new Map();
  tokenInsertionOrder = [];
  stagedRefCounts = /* @__PURE__ */ new Map();
  uncommittedCaptureRefs = /* @__PURE__ */ new Set();
  snapshotEpochCounter = 0;
  ownerSnapshotEpochs = /* @__PURE__ */ new Map();
  globalSnapshotEpochs = [];
  get size() {
    return this.tokenToRef.size;
  }
  deleteRef(ref) {
    if ((this.stagedRefCounts.get(ref) ?? 0) > 0) return;
    const token = this.refToToken.get(ref);
    if (token) this.tokenToRef.delete(token);
    this.refToToken.delete(ref);
    this.refToOwnerPid.delete(ref);
    this.refToBundleId.delete(ref);
    this.uncommittedCaptureRefs.delete(ref);
  }
  ensureToken(ref) {
    const existing = this.refToToken.get(ref);
    if (existing) return existing;
    this.counter += 1;
    const token = `ax-${this.bootNonce}-${this.counter}`;
    this.tokenToRef.set(token, ref);
    this.refToToken.set(ref, token);
    this.tokenInsertionOrder.push(token);
    return token;
  }
  bindRefMetadata(ref, ownerPid, bundleId) {
    if (typeof ownerPid === "number") this.refToOwnerPid.set(ref, ownerPid);
    if (typeof bundleId === "string" && bundleId.trim()) {
      try {
        this.refToBundleId.set(ref, canonicalizeCuaBundleId(bundleId, { loose: true }));
      } catch {
        this.refToBundleId.delete(ref);
      }
    }
  }
  pruneTokenCapacity() {
    let candidates = this.tokenInsertionOrder.length;
    while (this.tokenToRef.size > 4096 && candidates > 0) {
      const expired = this.tokenInsertionOrder.shift();
      if (!expired) break;
      const expiredRef = this.tokenToRef.get(expired);
      if (expiredRef === void 0) continue;
      if ((this.stagedRefCounts.get(expiredRef) ?? 0) > 0) {
        this.tokenInsertionOrder.push(expired);
        candidates -= 1;
        continue;
      }
      this.deleteRef(expiredRef);
    }
    if (
      this.tokenInsertionOrder.length > 4096 &&
      this.tokenInsertionOrder.length > this.tokenToRef.size * 2
    ) {
      let writeIndex = 0;
      for (const token of this.tokenInsertionOrder) {
        if (!this.tokenToRef.has(token)) continue;
        this.tokenInsertionOrder[writeIndex] = token;
        writeIndex += 1;
      }
      this.tokenInsertionOrder.length = writeIndex;
    }
  }
  beginCaptureTransaction() {
    const staged = /* @__PURE__ */ new Map();
    let finished = false;
    const finish = (commit, ownerPid = null, currentRefs = /* @__PURE__ */ new Set()) => {
      if (finished) return;
      finished = true;
      if (commit) {
        for (const [ref, entry] of staged) {
          this.bindRefMetadata(ref, entry.ownerPid, entry.bundleId);
          this.uncommittedCaptureRefs.delete(ref);
        }
        if (typeof ownerPid === "number") {
          this.replaceOwnerPidRefs(ownerPid, currentRefs);
        }
      }
      for (const [ref] of staged) {
        const nextCount = (this.stagedRefCounts.get(ref) ?? 1) - 1;
        if (nextCount > 0) this.stagedRefCounts.set(ref, nextCount);
        else {
          this.stagedRefCounts.delete(ref);
          if (!commit && this.uncommittedCaptureRefs.has(ref)) {
            this.deleteRef(ref);
          }
        }
      }
      this.pruneTokenCapacity();
    };
    return {
      tokenFor: (ref, ownerPid, bundleId) => {
        if (finished) throw new Error("capture token transaction already settled");
        const existing = staged.get(ref);
        if (existing) return existing.token;
        const created = !this.refToToken.has(ref);
        const token = this.ensureToken(ref);
        if (created) this.uncommittedCaptureRefs.add(ref);
        this.stagedRefCounts.set(ref, (this.stagedRefCounts.get(ref) ?? 0) + 1);
        staged.set(ref, { token, ownerPid, bundleId });
        return token;
      },
      commit: (ownerPid, currentRefs) => {
        finish(true, ownerPid, currentRefs);
      },
      rollback: () => finish(false),
    };
  }
  pruneOwnerRefs(ownerPid) {
    const retained = /* @__PURE__ */ new Set();
    for (const epoch of this.ownerSnapshotEpochs.get(ownerPid) ?? []) {
      for (const ref of epoch.refs) retained.add(ref);
    }
    for (const [ref, pid] of this.refToOwnerPid) {
      if (pid === ownerPid && !retained.has(ref)) this.deleteRef(ref);
    }
  }
  /**
   * 记录一个已交付/即将交付的 native snapshot。保留同 PID 最近四份、全局最近 32 份 ref set，
   * 与 native epoch 窗口对齐；并发截图完成顺序倒置时不会把另一份刚返回的 token 立刻删掉。
   */
  replaceOwnerPidRefs(ownerPid, currentRefs) {
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) return;
    const epochs = this.ownerSnapshotEpochs.get(ownerPid) ?? [];
    const last = epochs.at(-1);
    if (
      last &&
      last.refs.size === currentRefs.size &&
      [...currentRefs].every((ref) => last.refs.has(ref))
    ) {
      this.pruneOwnerRefs(ownerPid);
      return;
    }
    const epoch = {
      id: ++this.snapshotEpochCounter,
      refs: new Set(currentRefs),
    };
    epochs.push(epoch);
    this.ownerSnapshotEpochs.set(ownerPid, epochs);
    this.globalSnapshotEpochs.push({ id: epoch.id, pid: ownerPid });
    const affected = /* @__PURE__ */ new Set([ownerPid]);
    while (epochs.length > 4) {
      const expired = epochs.shift();
      const globalIndex = this.globalSnapshotEpochs.findIndex(
        (candidate) => candidate.id === expired.id,
      );
      if (globalIndex >= 0) this.globalSnapshotEpochs.splice(globalIndex, 1);
    }
    while (this.globalSnapshotEpochs.length > 32) {
      const expired = this.globalSnapshotEpochs.shift();
      const ownerEpochs = this.ownerSnapshotEpochs.get(expired.pid) ?? [];
      const next = ownerEpochs.filter((candidate) => candidate.id !== expired.id);
      if (next.length > 0) this.ownerSnapshotEpochs.set(expired.pid, next);
      else this.ownerSnapshotEpochs.delete(expired.pid);
      affected.add(expired.pid);
    }
    for (const pid of affected) this.pruneOwnerRefs(pid);
  }
  tokenFor(ref, ownerPid, bundleId) {
    const token = this.ensureToken(ref);
    this.uncommittedCaptureRefs.delete(ref);
    this.bindRefMetadata(ref, ownerPid, bundleId);
    this.pruneTokenCapacity();
    return token;
  }
  refFor(token) {
    return this.tokenToRef.get(token);
  }
  ownerPidForRef(ref) {
    return this.refToOwnerPid.get(ref);
  }
  ownerPidForToken(token) {
    const ref = this.refFor(token);
    return ref === void 0 ? void 0 : this.ownerPidForRef(ref);
  }
  bundleIdForRef(ref) {
    return this.refToBundleId.get(ref);
  }
  bundleIdForToken(token) {
    const ref = this.refFor(token);
    return ref === void 0 ? void 0 : this.bundleIdForRef(ref);
  }
};
export var ROLE_TO_KIND = {
  AXButton: "button",
  AXMenuButton: "button",
  AXPopUpButton: "popupbutton",
  AXComboBox: "combobox",
  AXTextField: "textfield",
  AXSearchField: "searchfield",
  AXSecureTextField: "securefield",
  AXTextArea: "textarea",
  AXCheckBox: "checkbox",
  AXRadioButton: "radio",
  AXMenuItem: "menuitem",
  AXMenuBarItem: "menuitem",
  AXLink: "link",
  AXSlider: "slider",
  AXStaticText: "text",
  AXImage: "image",
  AXCell: "cell",
  AXRow: "row",
  AXTab: "tab",
};
export function roleToKind(role) {
  return ROLE_TO_KIND[role] ?? "";
}
var TEXT_ENTRY_KINDS = /* @__PURE__ */ new Set([
  "textfield",
  "textarea",
  "searchfield",
  "securefield",
  "combobox",
]);
var VALUE_SET_KINDS = /* @__PURE__ */ new Set([...TEXT_ENTRY_KINDS, "slider", "stepper"]);
function isValueSettableElement(el, kindFor) {
  return VALUE_SET_KINDS.has(kindFor(el.role)) || el.editable === true;
}
function isTextEntryElement(el, kindFor) {
  return TEXT_ENTRY_KINDS.has(kindFor(el.role));
}
function assertUnicodeSafeTextRange(live, range) {
  if (!range || typeof live.value !== "string") return;
  if (textRangeSplitsUtf16SurrogatePair(live.value, range)) {
    throw notSelectable(
      "element_select_text: text_range boundary splits a UTF-16 surrogate pair; start and end must fall between complete Unicode characters. action_sent=false.",
      {
        action_sent: false,
        reason: "text_range_splits_surrogate_pair",
        text_range: range,
      },
    );
  }
}
function recordPressFocus(outcome, live, kindFor, onDiagnostic) {
  try {
    if (outcome === null || outcome === void 0) return;
    if (typeof outcome === "boolean") return;
    const diag = outcome.pressFocusDiagnostics;
    if (!diag) return;
    const label =
      [live.title, live.description, live.value].find(
        (candidate) => typeof candidate === "string" && candidate.length > 0,
      ) ?? null;
    onDiagnostic("cua.element_press_focus", {
      role: live.role,
      kind: kindFor(live.role),
      label: typeof label === "string" ? label.slice(0, 70) : null,
      label_source:
        typeof live.title === "string" && live.title.length > 0
          ? "title"
          : typeof live.description === "string" && live.description.length > 0
            ? "description"
            : typeof live.value === "string" && live.value.length > 0
              ? "value"
              : null,
      ref: live.ref,
      bounds: live.bounds,
      ax_ok: outcome.ok === true,
      ax_error: outcome.axError ?? null,
      ...diag,
    });
  } catch {}
}
async function recordElementAction(source, registry2, params, live, action, kindFor, onDiagnostic) {
  try {
    const token = typeof params.native === "string" ? params.native : "";
    const capturedBundleId = registry2.bundleIdForToken(token);
    const ownerPid = registry2.ownerPidForToken(token);
    const identity: any = await resolvePidIdentity(
      source,
      ownerPid,
      "element_perform_action:would_bracket_probe",
    );
    const windowId =
      source.elementWindowId && token
        ? await source.elementWindowId(registry2.refFor(token) ?? "")
        : null;
    onDiagnostic(
      "cua.element_action",
      {
        action,
        role: live.role,
        kind: kindFor(live.role),
        has_menu: live.hasMenu === true,
        target_pid: identity?.pid ?? ownerPid ?? null,
        target_bundle_id: identity?.bundle_id ?? capturedBundleId ?? null,
        // 判别位：非前台才是本 bug 的场景，也才需要 bracket。
        target_active: identity?.active ?? null,
        identity_resolved: identity !== null,
        window_id: windowId ?? null,
        window_id_resolved: typeof windowId === "number" && windowId > 0,
        // 留给「跨动作保持打开的 bracket」那个设计做判据：这次 press 的目标是否
        // 非前台、且窗口身份可解析。不参与任何控制流。
        bracketable: identity?.active !== true && typeof windowId === "number" && windowId > 0,
      },
      "info",
    );
  } catch {}
}
function toElementPayload(raw, registry2, ownerPid, bundleId, kindFor, depth?) {
  const actions = raw.actions ?? [];
  const resolvedOwnerPid = raw.ownerPid ?? ownerPid;
  return {
    role: raw.role,
    kind: kindFor(raw.role),
    title: raw.title ?? raw.description ?? null,
    value: raw.value ?? null,
    bounds: raw.bounds,
    enabled: raw.enabled ?? true,
    editable: raw.editable ?? false,
    actions,
    focused: raw.focused ?? false,
    ...(typeof raw.selected === "boolean" ? { selected: raw.selected } : {}),
    default_action: raw.default_action ?? false,
    pressable: raw.hasMenu === void 0 ? actions.includes("AXPress") : actions.includes("AXPress"),
    has_menu: raw.hasMenu ?? actions.includes("AXShowMenu"),
    native: registry2.tokenFor(raw.ref, resolvedOwnerPid, bundleId),
    owner_pid: resolvedOwnerPid ?? null,
    // M3.4：树深度旁路（顶层=0）。渲染层暂不消费；切树形缩进时直接可用。
    ...(typeof depth === "number" ? { depth } : {}),
    // 被采样的容器：把真实总数和可见区间带到模型面（渲染成 "showing 100-117 of 184 items"）。
    // flatten 会打散父子关系，所以这些计数必须挂在元素自身上才能存活。
    // children_shown 用实际展开数而不是硬编码上限：budget/deadline 可能在容器内部提前耗尽，
    // 那时报上限值就是假数据。children_offset 缺席按 0 处理（native 只在截断时下发）。
    ...(typeof raw.children_total === "number"
      ? {
          children_total: raw.children_total,
          children_shown: raw.children?.length ?? 0,
          children_offset: raw.children_offset ?? 0,
        }
      : {}),
  };
}
export function flattenAxTree(roots, limit = 6e3) {
  return flattenAxTreeWithDepth(roots, limit).elements;
}
function flattenAxTreeWithDepth(roots, limit = 6e3) {
  const out = [];
  const depths = [];
  const stack = [...roots].map((node) => ({ node, depth: 0 })).reverse();
  while (stack.length > 0 && out.length < limit) {
    const { node, depth } = stack.pop();
    out.push(node);
    depths.push(depth);
    const children = node.children;
    if (children && children.length > 0) {
      for (let i = children.length - 1; i >= 0; i -= 1)
        stack.push({ node: children[i], depth: depth + 1 });
    }
  }
  return { elements: out, depths };
}
function refFromParams(registry2, params, method) {
  const token = typeof params.native === "string" ? params.native : "";
  const ref = registry2.refFor(token);
  if (!ref) {
    throw elementUnavailable(
      // 原版 mac 3.11.2 消息原文（blob 雕刻，第 36 轮参数矩阵对齐）：短文案。
      // 此前还原稿为 v3.1 内部版的长文案（"is no longer registered…"），已按
      // parity 矩阵实测与原版对齐。details 键为开源增强，保留。
      `${method}: unknown or stale element token ${token || "<empty>"}; call get_app_state again.`,
      {
        action_sent: false,
        element_lookup: "not_found",
        recovery: "reresolve_element",
        auto_reresolve: true,
      },
    );
  }
  return ref;
}
async function refForAction(source, registry2, params, method) {
  const ref = refFromParams(registry2, params, method);
  const token = typeof params.native === "string" ? params.native : "";
  const recordedPid = registry2.ownerPidForToken(token);
  if (recordedPid) {
    await resolvePidBundleId(source, recordedPid, method);
  }
  return ref;
}
async function readLiveForAction(source, ref, method) {
  const live: any = await source.readElement(ref);
  if (!live) {
    throw elementUnavailable(
      `${method}: target element is gone, stale, or the owning app did not respond.`,
      {
        action_sent: false,
        element_lookup: "not_found",
        recovery: "reresolve_element",
        auto_reresolve: true,
      },
    );
  }
  return live;
}
function assertActionSucceeded(result, method) {
  if (result === void 0 || result === true) return null;
  if (typeof result === "object" && result !== null && "ok" in result) {
    if (result.ok) return null;
    const axError = result.axError ?? null;
    if (axError === "api_disabled") {
      throw permissionDenied(
        `${method}: Accessibility API is disabled \u2014 grant Accessibility to ZCode.`,
        { ax_error: axError, action_sent: false },
      );
    }
    return {
      action_sent: true,
      dispatch_status: "possibly_sent",
      ...(axError ? { ax_error: axError } : {}),
    };
  }
  return { action_sent: true, dispatch_status: "possibly_sent" };
}
async function verifyElementTargetState(source, ref, dispatch, matches) {
  let status = "unavailable";
  try {
    const live = await source.readElement(ref);
    if (live) {
      const matched = matches(live);
      status = matched === null ? "unavailable" : matched ? "matched" : "mismatched";
    }
  } catch {
    status = "unavailable";
  }
  return {
    action_sent: true,
    dispatch_status: dispatch?.dispatch_status ?? "accepted",
    ...(dispatch?.ax_error ? { ax_error: dispatch.ax_error } : {}),
    target_verification_status: status,
  };
}
async function verifySelectablePress(source, ref, before, dispatch) {
  if (typeof before.selected !== "boolean") return dispatch;
  const menuBearingButton =
    (before.role === "AXButton" ||
      before.role === "AXMenuButton" ||
      before.role === "AXPopUpButton") &&
    (before.hasMenu === true || before.actions?.includes("AXShowMenu") === true);
  if (menuBearingButton) return dispatch;
  return verifyElementTargetState(source, ref, dispatch, (after) => {
    if (typeof after.selected !== "boolean") return null;
    return before.selected === false
      ? after.selected === true
      : after.selected === false
        ? true
        : null;
  });
}
function parseTextRange(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const start = Number(value[0]);
  const length = Number(value[1]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(length) ||
    start < 0 ||
    length < 0 ||
    start > 2147483647 ||
    length > 2147483647 ||
    start + length > 2147483647
  ) {
    return null;
  }
  return [start, length];
}
export function createAxReadOnlyMethods(
  source,
  registry2 = new AxTokenRegistry(),
  options: any = {},
) {
  const kindFor: any = options.roleToKind ?? roleToKind;
  const maxCaptureResponsesInProgress = 32;
  let captureResponsesInProgress = 0;
  const snapshotCache = new AxSnapshotCache();
  let snapshotCounter = 0;
  const methods: any = {
    supports_accessibility: () => true,
    list_applications: async () => {
      const apps = await source.listApplications();
      return withBrokerPresentation(
        apps.map((app) => normalizeApp(app)),
        {
          items: apps.slice(0, 128).map((application, resultIndex) => ({
            resultIndex,
            application,
          })),
        },
      );
    },
    capture_app: async (params) => {
      if (captureResponsesInProgress >= maxCaptureResponsesInProgress) {
        throw elementUnavailable(
          "capture_app: too many responses are being assembled; retry after an earlier capture completes.",
        );
      }
      captureResponsesInProgress += 1;
      let snapshot = null;
      let leaseAcknowledged = false;
      let tokenTransaction = null;
      let tokenTransactionCommitted = false;
      try {
        const appRef = params.app_ref;
        const geometryGuard: any =
          params.include_screenshot !== false ? options.beginCaptureGeometry?.() : void 0;
        const captureOptions = {
          includeScreenshot: params.include_screenshot !== false,
        };
        snapshot = await source.captureApp(appRef ?? {}, captureOptions);
        const initialSnapshot: any = snapshot;
        if (
          initialSnapshot?.window.empty_capture_reason === "cg-only-no-ax-window" &&
          options.reopenWindowlessApp
        ) {
          let reopened: any = false;
          try {
            reopened = await options.reopenWindowlessApp({
              pid: initialSnapshot.app.pid ?? null,
              bundle_id: initialSnapshot.app.bundle_id ?? null,
              name: initialSnapshot.app.name ?? null,
            });
          } catch {}
          if (reopened) {
            const reread = await source.captureApp(appRef ?? {}, captureOptions);
            if (reread) {
              initialSnapshot.captureLease?.release();
              snapshot = reread;
            }
          }
        }
        if (!snapshot) {
          const suffix: any = options.permissionDeniedHint
            ? ` ${options.permissionDeniedHint}`
            : "";
          throw permissionDenied(
            "capture_app could not read the accessibility tree (the OS accessibility API returned nothing for this app: it may not be scriptable, or ZCode lacks the accessibility access it needs)." +
              suffix,
          );
        }
        const capturedSnapshot: any = snapshot;
        const ownerPid = capturedSnapshot.app.pid ?? null;
        const windowId = capturedSnapshot.window.window_id ?? null;
        let canonicalBundleId = null;
        try {
          canonicalBundleId = capturedSnapshot.app.bundle_id
            ? canonicalizeCuaBundleId(capturedSnapshot.app.bundle_id, {
                loose: true,
              })
            : null;
        } catch {}
        const presentationWindowId = capturedSnapshot.window.presentation_window_id ?? windowId;
        const captureWindowTarget =
          typeof windowId === "number" &&
          Number.isSafeInteger(windowId) &&
          windowId > 0 &&
          typeof ownerPid === "number" &&
          Number.isSafeInteger(ownerPid) &&
          ownerPid > 0
            ? {
                windowId,
                ...(typeof presentationWindowId === "number" &&
                Number.isSafeInteger(presentationWindowId) &&
                presentationWindowId > 0
                  ? { presentationWindowId }
                  : {}),
                pid: ownerPid,
                bundleId: canonicalBundleId,
              }
            : null;
        const { elements: flatElements, depths } = flattenAxTreeWithDepth(
          normalizeAxTree(capturedSnapshot.elements),
        );
        tokenTransaction = registry2.beginCaptureTransaction();
        const elements = flatElements.map((el, i) =>
          toElementPayload(
            el,
            tokenTransaction,
            ownerPid,
            capturedSnapshot.app.bundle_id,
            kindFor,
            depths[i],
          ),
        );
        const response = (() => {
          const windowPayload: any = {
            title: capturedSnapshot.window.title ?? null,
            bounds: capturedSnapshot.window.bounds,
            window_id: capturedSnapshot.window.window_id ?? null,
          };
          const actualSurface = capturedSnapshot.surfaces?.find(
            (surface) => surface.actual_window_id === capturedSnapshot.window.window_id,
          );
          if (actualSurface) {
            windowPayload.actual_window_id = actualSurface.actual_window_id;
            windowPayload.presentation_window_id = actualSurface.presentation_window_id;
            windowPayload.surface_kind = actualSurface.surface_kind;
            windowPayload.surface_lifecycle = "stable";
          }
          if (capturedSnapshot.window.window_id_fallback) {
            windowPayload.window_id_fallback = true;
            const requested = typeof appRef?.window_id === "number" ? appRef.window_id : null;
            windowPayload.note = `capture_app: requested window_id ${requested ?? "(unknown)"} could not be resolved (closed, stale, or owned by another process); returned the frontmost window instead. Call list_windows to pick a fresh window_id.`;
          }
          const captureGeometry =
            capturedSnapshot.screenshot && geometryGuard !== void 0
              ? (options.completeCaptureGeometry?.(geometryGuard, capturedSnapshot) ?? {})
              : {};
          if (capturedSnapshot.window.empty_capture_reason) {
            windowPayload.empty_capture_reason = capturedSnapshot.window.empty_capture_reason;
          }
          return {
            app: normalizeApp(capturedSnapshot.app),
            window: windowPayload,
            elements,
            // 若 source 提供了按窗口后台截图（native addon + Screen Recording）就回填，让 AX 树和视觉快照
            // 对齐、且不抢焦点；否则为 null，视觉走独立 screenshot 方法。
            screenshot: capturedSnapshot.screenshot ?? null,
            ...(capturedSnapshot.screenshot_bounds
              ? {
                  screenshot_bounds: capturedSnapshot.screenshot_bounds,
                }
              : {}),
            ...(capturedSnapshot.screenshot_error !== void 0
              ? {
                  screenshot_error: capturedSnapshot.screenshot_error,
                }
              : {}),
            // 空白截图告警：source 判定像素 uniform（黑帧），上层据此提示模型像素不可用。
            screenshot_blank: capturedSnapshot.screenshot_blank === true,
            ...captureGeometry,
          };
        })();
        if (capturedSnapshot.captureLease) {
          if (capturedSnapshot.captureLease.acknowledge() !== true) {
            throw elementUnavailable(
              "capture_app: native token epoch expired before broker tokens were ready.",
            );
          }
          leaseAcknowledged = true;
        }
        tokenTransaction.commit(ownerPid, new Set(flatElements.map((element) => element.ref)));
        tokenTransactionCommitted = true;
        try {
          const rawPipContext = params.pip_session_context;
          const validPipIdentifier = (value) =>
            typeof value === "string" &&
            value.length > 0 &&
            value.length <= 255 &&
            !value.includes("\0");
          const pipContext =
            typeof rawPipContext === "object" &&
            rawPipContext !== null &&
            !Array.isArray(rawPipContext) &&
            validPipIdentifier(rawPipContext.session_id) &&
            validPipIdentifier(rawPipContext.turn_id)
              ? {
                  sessionId: rawPipContext.session_id,
                  turnId: rawPipContext.turn_id,
                }
              : null;
          options.onCaptureWindow?.(captureWindowTarget, pipContext);
        } catch {}
        const stateId = `s-${++snapshotCounter}`;
        const pid = capturedSnapshot.app.pid ?? 0;
        const cached2 = snapshotCache.get(pid, capturedSnapshot.window);
        const diff = cached2 ? diffAxSnapshots(cached2.snapshot, capturedSnapshot) : null;
        const mode =
          params.force_full === true
            ? "full"
            : decideSnapshotMode(diff, {
                previousWindowTitle: cached2?.snapshot.window?.title ?? null,
                newWindowTitle: capturedSnapshot.window?.title ?? null,
                previousWindowId: cached2?.snapshot.window?.window_id ?? null,
                newWindowId: capturedSnapshot.window?.window_id ?? null,
                previousWindowBounds: cached2?.snapshot.window?.bounds ?? null,
                newWindowBounds: capturedSnapshot.window?.bounds ?? null,
                totalElements: flatElements.length,
              });
        if (mode === "delta" && diff) {
          response.snapshot_mode = "delta";
          response.base_state_id = cached2.stateId;
          response.state_id = stateId;
          response.changes = diff;
        } else if (mode === "no_change" && cached2) {
          if (params.include_screenshot === false) {
            response.screenshot = null;
          }
          response.snapshot_mode = "no_change";
          response.base_state_id = cached2.stateId;
          response.state_id = stateId;
          response.repeat_observation = true;
        } else {
          response.snapshot_mode = "full";
          response.state_id = stateId;
        }
        snapshotCache.set(pid, capturedSnapshot, stateId);
        return response;
      } finally {
        try {
          if (tokenTransaction && !tokenTransactionCommitted) {
            tokenTransaction.rollback();
          }
          if (snapshot?.captureLease && !leaseAcknowledged) {
            snapshot.captureLease.release();
          }
        } finally {
          captureResponsesInProgress -= 1;
        }
      }
    },
    read_element: async (params) => {
      const ref = refFromParams(registry2, params, "read_element");
      const raw = await source.readElement(ref);
      if (!raw) return null;
      const ownerPid = raw.ownerPid ?? registry2.ownerPidForRef(ref) ?? null;
      const bundleId = registry2.bundleIdForRef(ref) ?? null;
      return toElementPayload(raw, registry2, ownerPid, bundleId, kindFor);
    },
  };
  if (source.applicationInfo) {
    const applicationInfo = source.applicationInfo.bind(source);
    methods.application_info = async (params) => {
      const info = await applicationInfo(params.app_ref);
      return info ? withBrokerPresentation(normalizeApp(info), { primary: info }) : null;
    };
  }
  if (source.listWindows) {
    const listWindows = source.listWindows.bind(source);
    methods.list_windows = async (params) => {
      const appRef = params.app_ref ?? {};
      const windows = await listWindows(appRef);
      if (!windows) {
        const suffix = options.permissionDeniedHint ? ` ${options.permissionDeniedHint}` : "";
        throw permissionDenied(
          "list_windows could not read the accessibility window list (Accessibility not granted to ZCode.app, or the app is not scriptable)." +
            suffix,
        );
      }
      return windows.map((window) => ({
        ...(window.index === void 0 ? {} : { index: window.index }),
        title: window.title ?? null,
        bounds: window.bounds,
        window_id: window.window_id ?? null,
        ...(window.main === void 0 ? {} : { main: window.main }),
        ...(window.focused === void 0 ? {} : { focused: window.focused }),
        // 让 offscreen 残留窗口在模型面也可辨识：get_app_state 曾报出一个 window_id，
        // 而它其实是 WindowServer 残留（用户不可见、AX 读不到），模型无从判断。
        ...(window.onscreen === void 0 ? {} : { onscreen: window.onscreen }),
      }));
    };
  }
  if (source.elementAtPoint) {
    const elementAtPoint = source.elementAtPoint.bind(source);
    methods.element_at_point = async (params) => {
      const x = Number(params.x);
      const y = Number(params.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw permissionDenied("element_at_point requires finite global coordinates.");
      }
      const raw = await elementAtPoint(x, y);
      if (!raw) return null;
      let bundleId = null;
      try {
        bundleId = await resolvePidBundleId(source, raw.ownerPid ?? null, "element_at_point");
      } catch {}
      return toElementPayload(raw, registry2, raw.ownerPid ?? null, bundleId, kindFor);
    };
  }
  if (source.elementPress) {
    const elementPress = source.elementPress.bind(source);
    methods.element_press = async (params) => {
      const ref = await refForAction(source, registry2, params, "element_press");
      const live = await readLiveForAction(source, ref, "element_press");
      const verificationBaseline = { ...live };
      const dispatch = assertActionSucceeded(await elementPress(ref), "element_press");
      return verifySelectablePress(source, ref, verificationBaseline, dispatch);
    };
  }
  if (source.elementShowMenu) {
    const elementShowMenu = source.elementShowMenu.bind(source);
    methods.element_show_menu = async (params) => {
      const ref = await refForAction(source, registry2, params, "element_show_menu");
      return assertActionSucceeded(await elementShowMenu(ref), "element_show_menu");
    };
  }
  if (source.elementFocus) {
    const elementFocus = source.elementFocus.bind(source);
    methods.element_focus = async (params) => {
      const ref = await refForAction(source, registry2, params, "element_focus");
      const dispatch = assertActionSucceeded(await elementFocus(ref), "element_focus");
      return verifyElementTargetState(source, ref, dispatch, (live) =>
        typeof live.focused === "boolean" ? live.focused : null,
      );
    };
  }
  if (source.elementSetValue) {
    const elementSetValue = source.elementSetValue.bind(source);
    methods.element_set_value = async (params) => {
      const value = typeof params.value === "string" ? params.value : "";
      const ref = await refForAction(source, registry2, params, "element_set_value");
      const live = await readLiveForAction(source, ref, "element_set_value");
      if (!isValueSettableElement(live, kindFor)) {
        throw notSettable(
          `element_set_value: element (role ${live.role}) is not settable; refuse set_value. action_sent=false. Use get_app_state to pick a settable element target (a text field, slider, or stepper).`,
          {
            action_sent: false,
            target_role: live.role,
            target_actions: live.actions ?? [],
          },
        );
      }
      if (params.strategy === "event") {
        if (!isTextEntryElement(live, kindFor)) {
          throw notSettable(
            `element_set_value: strategy=event only replaces text-entry elements; role ${live.role} is not text. action_sent=false.`,
            {
              action_sent: false,
              target_role: live.role,
              reason: "event_strategy_requires_text_entry",
            },
          );
        }
        const replaceTextValueWithInput: any = options.replaceTextValueWithInput;
        const pid = registry2.ownerPidForRef(ref);
        const bundleId = registry2.bundleIdForRef(ref);
        if (!replaceTextValueWithInput || !pid || !bundleId) {
          throw permissionDenied(
            "element_set_value: strategy=event requires verified app-scoped keyboard input and a PID+bundle-bound element token. action_sent=false.",
            {
              action_sent: false,
              reason: "verified_text_replacement_unavailable",
            },
          );
        }
        return assertActionSucceeded(
          await replaceTextValueWithInput({
            ref,
            value,
            pid,
            bundleId,
            bounds: live.bounds,
            windowId: await source.elementWindowId?.(ref),
          }),
          "element_set_value",
        );
      }
      // 还原自发行 bundle（官方 0.6.5 win32 entry :22798-22866）：win32 写后读回
      // 裁决链。setValueReadbackAsync + winAxElementFromToken + winAxElementRelease
      // 三 additive ABI 齐备时走读回：!readback.ok → readback_job_unavailable（写
      // 可能已开始，action_sent=true）；!writeOk 且 dispatch_status 非 not_sent →
      // native_write_uncertain（附 ax 轨迹 possibly_sent 封套）；!writeOk 且未派发 →
      // notSettable；成功 → classifyReplacementReadback 裁决（confirmed/pending/
      // suspected_noop/unreadable）+ Chromium 直接宿主 AX-echo 降级，封套 reason=
      // directed_value_set（post_message 路径）/value_pattern_set（UIA 模式路径）。
      // 缺任一 ABI（mac 官方形态）时整链跳过，落下方裸写路径。
      const setValueReadback = source.setValueReadbackAsync?.bind(source);
      const fromToken = source.winAxElementFromToken?.bind(source);
      const releaseRef = source.winAxElementRelease?.bind(source);
      if (setValueReadback && fromToken && releaseRef) {
        const token = fromToken(ref);
        if (token.ok) {
          try {
            const hostWindowId = (await source.elementWindowId?.(ref)) ?? 0;
            const readback: any = await setValueReadback(token.element, hostWindowId, value);
            if (!readback.ok) {
              throw elementUnavailable(
                "element_set_value could not complete; the write may already have started. Re-observe before retrying.",
                {
                  action_sent: true,
                  reason: "readback_job_unavailable",
                },
              );
            }
            if (!readback.writeOk) {
              if (readback.dispatch_status && readback.dispatch_status !== "not_sent") {
                throw elementUnavailable(
                  "element_set_value: the native write may have started; verify the field before any further action.",
                  {
                    action_sent: true,
                    reason: "native_write_uncertain",
                    delivery: {
                      path: readback.path ?? "ax",
                      effect: "unverifiable",
                      attempts: [{ path: readback.path ?? "ax", dispatch_status: "possibly_sent" }],
                      escalated: false,
                    },
                  },
                );
              }
              throw notSettable(
                `element_set_value: the element did not accept the value (read-only or no value pattern). Target an inner editable element instead, or use type with strategy=event for insertion semantics, or click the field and type_text. action_sent=false.`,
                {
                  action_sent: false,
                  reason: "action_unsupported",
                },
              );
            }
            const verdict = applyAxEchoSurfaceTrust(
              classifyReplacementReadback(readback.before, readback.after, value),
              options.isChromiumHostWindow?.(hostWindowId) === true,
            );
            const delivery = {
              path: readback.path ?? "ax",
              effect: readback.focus_unchanged === false ? "unverifiable" : verdict.effect,
              attempts: [
                {
                  path: readback.path ?? "ax",
                  dispatch_status: "sent",
                  reason: readback.path === "post_message" ? "directed_value_set" : "value_pattern_set",
                },
              ],
              escalated: false,
              readback: {
                verify: verdict.verify,
                ...(readback.focus_unchanged !== void 0 ? { focus_unchanged: readback.focus_unchanged } : {}),
                ...(verdict.idempotent ? { idempotent: true } : {}),
                ...(verdict.axEchoDemoted ? { axEchoDemoted: true } : {}),
              },
            };
            return {
              action_sent: true,
              dispatch_status: "accepted",
              delivery,
            };
          } finally {
            releaseRef(token.element);
          }
        }
      }
      const dispatch = assertActionSucceeded(
        await elementSetValue(ref, value),
        "element_set_value",
      );
      return {
        action_sent: true,
        dispatch_status: dispatch?.dispatch_status ?? "accepted",
        ...(dispatch?.ax_error ? { ax_error: dispatch.ax_error } : {}),
      };
    };
  }
  if (source.elementPerformAction) {
    const elementPerformAction = source.elementPerformAction.bind(source);
    methods.element_perform_action = async (params) => {
      const action = typeof params.action === "string" ? params.action : "";
      const ref = await refForAction(source, registry2, params, "element_perform_action");
      const live = await readLiveForAction(source, ref, "element_perform_action");
      const allowed = live.actions ?? [];
      // 还原自发行 bundle（官方 0.6.5 win32 entry :22896-22905）：UIA 模式梯在场
      //（elementPatternCallAsync + 强引用桥）时 AXPress 不再要求 allowed 预列——
      // invoke/toggle/select/expand 梯自证可达性，allowed 空的菜单/可Invoke元素也能按。
      const doubleInvoke = params.click_count === 2 && action === "AXPress";
      const windowsPress =
        action === "AXPress" &&
        source.elementPatternCallAsync &&
        source.winAxElementFromToken &&
        source.winAxElementRelease;
      if (!allowed.includes(action) && !windowsPress) {
        throw actionUnavailable(
          `element_perform_action: action ${JSON.stringify(action)} is not available on this element; allowed: ${allowed.length ? JSON.stringify(allowed) : "[]"}. action_sent=false. Call get_app_state and pass one of the target element's \`actions\`.`,
          {
            action_sent: false,
            requested_action: action,
            allowed_actions: allowed,
          },
        );
      }
      // 还原自官方 :22906-22981：Chromium 元素单击分流——AXPress（非双击）且 UIA
      // 梯 + classify + postMessage click 三件在场时，宿主是 chromium 直接宿主则
      // 降级为后台坐标点击（UIA Invoke 在 Chromium 里不触发合成事件）。降级前逐
      // 项校验宿主窗与元素 bounds（stale_element_geometry）；downgradeDelivery 随
      // 轨迹封套（chromium_element_downgrade → sent/refused/possibly）。
      const classifyForDowngrade = source.classifyPostMessageDelivery;
      const postClickForDowngrade = source.postMessageClickAsync;
      const chromiumDowngrade =
        action === "AXPress" &&
        !doubleInvoke &&
        windowsPress &&
        typeof classifyForDowngrade === "function" &&
        typeof postClickForDowngrade === "function";
      let downgradeDeliveryCarry = null;
      if (chromiumDowngrade && classifyForDowngrade && postClickForDowngrade) {
        const hostWindowId = await source.elementWindowId?.(ref);
        if (!hostWindowId) {
          throw elementUnavailable(
            "element_perform_action: the element's host window could not be resolved before dispatch; re-observe the app and retry. action_sent=false.",
            { action_sent: false, reason: "stale_element_geometry" },
          );
        }
        const probe = await classifyForDowngrade(hostWindowId, "mouse_click");
        if (probe && typeof probe === "object" && probe.host === "chromium") {
          const pid = live.ownerPid;
          const [ex, ey, ew, eh] = live.bounds;
          const centerValid =
            Number.isFinite(ex) &&
            Number.isFinite(ey) &&
            ew > 0 &&
            eh > 0 &&
            typeof pid === "number" &&
            pid > 0;
          if (!centerValid) {
            throw elementUnavailable(
              "element_perform_action: the Chromium element's screen bounds or host window could not be verified before dispatch; re-observe the app and retry. action_sent=false.",
              { action_sent: false, reason: "stale_element_geometry" },
            );
          }
          const cx = ex + ew / 2;
          const cy = ey + eh / 2;
          let downgradeDelivery = appendAttempt(null, {
            path: "post_message",
            dispatch_status: "not_sent",
            reason: "chromium_element_downgrade",
          });
          let outcome;
          try {
            outcome = await postClickForDowngrade(hostWindowId, pid, cx, cy, "left", 1);
          } catch {
            throw elementUnavailable(
              "element_perform_action: background delivery is unknown; re-observe before retrying.",
              {
                action_sent: true,
                delivery: finalizeDelivery(
                  appendAttempt(downgradeDelivery, {
                    path: "post_message",
                    dispatch_status: "possibly_sent",
                    reason: "threw",
                  }),
                ),
              },
            );
          }
          if (outcome.ok && !outcome.error) {
            downgradeDelivery = appendAttempt(downgradeDelivery, {
              path: "post_message",
              dispatch_status: "sent",
            });
            return {
              action_sent: true,
              dispatch_status: "accepted",
              delivery: finalizeDelivery(downgradeDelivery),
            };
          }
          const error51 = outcome.error ?? "unknown";
          const possiblySent = error51.startsWith("possibly");
          downgradeDelivery = appendAttempt(downgradeDelivery, {
            path: "post_message",
            dispatch_status: possiblySent ? "possibly_sent" : "not_sent",
            reason: error51,
          });
          if (possiblySent) {
            throw elementUnavailable(
              "element_perform_action: background delivery may have partly reached the target; re-observe before retrying.",
              {
                action_sent: true,
                delivery: finalizeDelivery(downgradeDelivery),
              },
            );
          }
          downgradeDeliveryCarry = downgradeDelivery;
        }
      }
      if (options.onDiagnostic) {
        await recordElementAction(
          source,
          registry2,
          params,
          live,
          action,
          kindFor,
          options.onDiagnostic,
        );
      }
      const verificationBaseline = { ...live };
      // 还原自官方 :23000-23016：菜单展开期望——AXExpand/AXShowMenu/AXPress(带菜单)
      // 在 win32 操作域里标记 expectWindowsMenu("expand")（右键菜单证据链入口）。
      const patternForAction = {
        AXPress: "invoke",
        AXToggle: "toggle",
        AXSelect: "select",
        AXExpand: "expand",
      };
      if (
        action === "AXExpand" ||
        action === "AXShowMenu" ||
        (action === "AXPress" && (live.hasMenu || live.actions?.includes("AXShowMenu")))
      ) {
        expectWindowsMenu("expand");
      }
      // 还原自官方 :23013-23066：UIA 模式梯。强引用桥 + elementPatternCallAsync 在场
      // 时按梯级逐模式调原生（hasMenu 优先 expand——先 Invoke 会把子菜单当叶命令；
      // 双击走 invoke_double；其余按动作映射梯 invoke→toggle→select→expand→legacy）。
      // pattern_absent 换下一级；busy/unavailable → uia_busy/uia_unavailable 拒绝；
      // 梯尽 → cannot_complete；全程 patternDelivery 轨迹。缺 ABI（mac 官方形态）
      // 退回同步 elementPerformAction。
      const pattern = patternForAction[action];
      const fromToken = source.winAxElementFromToken?.bind(source);
      const patternCall = source.elementPatternCallAsync?.bind(source);
      const releaseRef = source.winAxElementRelease?.bind(source);
      if (doubleInvoke && !(fromToken && patternCall && releaseRef)) {
        throw actionUnavailable("Double Invoke is unavailable. action_sent=false.", { action_sent: false });
      }
      let rawOutcome;
      let patternDelivery = downgradeDeliveryCarry;
      if (pattern && fromToken && patternCall && releaseRef) {
        const token = fromToken(ref);
        if (token.ok) {
          try {
            const hostWindowId = (await source.elementWindowId?.(ref)) ?? 0;
            const ladder = doubleInvoke
              ? ["invoke_double"]
              : action === "AXPress"
                ? live.hasMenu
                  ? ["expand", "invoke", "toggle", "select", "legacy"]
                  : ["invoke", "toggle", "select", "expand", "legacy"]
                : [pattern];
            rawOutcome = { ok: false, axError: "action_unsupported" };
            for (const rung of ladder) {
              const call: any = await patternCall(token.element, hostWindowId, rung);
              patternDelivery = appendAttempt(patternDelivery, {
                path: "ax",
                dispatch_status:
                  call.result === "invoked"
                    ? "sent"
                    : ["timeout", "possibly_sent"].includes(call.result)
                      ? "possibly_sent"
                      : "not_sent",
                reason: `${rung}:${call.result}`,
              });
              if (call.result === "invoked") {
                rawOutcome = { ok: true, axError: null };
                break;
              }
              if (call.pattern_absent === true) continue;
              if (call.result === "busy" || call.result === "unavailable") {
                throw elementUnavailable(
                  `element_perform_action could not complete (${call.result}). action_sent=false.`,
                  {
                    action_sent: false,
                    reason: `uia_${call.result}`,
                    delivery: finalizeDelivery(patternDelivery),
                  },
                );
              }
              rawOutcome = { ok: false, axError: "cannot_complete" };
              break;
            }
            if (rawOutcome && typeof rawOutcome === "object" && rawOutcome.axError === "action_unsupported") {
              throw actionUnavailable(
                "element_perform_action: no supported action pattern. action_sent=false.",
                {
                  action_sent: false,
                  delivery: finalizeDelivery(patternDelivery),
                },
              );
            }
          } finally {
            releaseRef(token.element);
          }
        } else {
          rawOutcome = { ok: false, axError: "invalid_element" };
        }
      } else {
        rawOutcome = await elementPerformAction(ref, action);
      }
      if (options.onDiagnostic && action === "AXPress") {
        recordPressFocus(rawOutcome, live, kindFor, options.onDiagnostic);
      }
      const dispatch = assertActionSucceeded(rawOutcome, "element_perform_action");
      const verified =
        action === "AXPress"
          ? await verifySelectablePress(source, ref, verificationBaseline, dispatch)
          : dispatch;
      return patternDelivery ? { ...verified, delivery: finalizeDelivery(patternDelivery) } : verified;
    };
  }
  if (source.elementSelectText) {
    const elementSelectText = source.elementSelectText.bind(source);
    methods.element_select_text = async (params) => {
      const ref = await refForAction(source, registry2, params, "element_select_text");
      const live = await readLiveForAction(source, ref, "element_select_text");
      if (!isTextEntryElement(live, kindFor)) {
        throw notSelectable(
          `element_select_text: element (role ${live.role}) is not selectable; refuse select_text. action_sent=false. Use get_app_state to pick a text/entry element target that supports text selection.`,
          {
            action_sent: false,
            target_role: live.role,
            target_actions: live.actions ?? [],
          },
        );
      }
      const textRange = parseTextRange(params.text_range);
      assertUnicodeSafeTextRange(live, textRange);
      const dispatch = assertActionSucceeded(
        await elementSelectText(ref, textRange),
        "element_select_text",
      );
      return verifyElementTargetState(source, ref, dispatch, (after) =>
        !textRange || !after.selected_text_range
          ? null
          : after.selected_text_range[0] === textRange[0] &&
            after.selected_text_range[1] === textRange[1],
      );
    };
  }
  // 还原自发行 bundle（官方 3.17.2 / 0.6.5，SEA offset 85310963-85312580）：元素级滚动
  // handler（能力门控 source.elementScroll；官方 mac 3.17.2 addon 无 scrollElement 导出，
  // 本块不注册=官方行为）。参数校验文案逐字（direction up|down|left|right / amount 1..100）。
  if (source.elementScroll) {
    const elementScroll = source.elementScroll.bind(source);
    methods.element_scroll = async (params) => {
      const direction = typeof params.direction === "string" ? params.direction : "";
      if (direction !== "up" && direction !== "down" && direction !== "left" && direction !== "right") {
        throw permissionDenied(
          "element_scroll: direction must be one of up|down|left|right. action_sent=false.",
          { action_sent: false },
        );
      }
      const rawAmount = params.amount;
      if (
        typeof rawAmount !== "number" ||
        !Number.isSafeInteger(rawAmount) ||
        rawAmount < 1 ||
        rawAmount > 100
      ) {
        throw permissionDenied(
          "element_scroll: amount must be an integer 1..100. action_sent=false.",
          { action_sent: false },
        );
      }
      const ref = await refForAction(source, registry2, params, "element_scroll");
      await readLiveForAction(source, ref, "element_scroll");
      const outcome = await elementScroll(ref, direction, rawAmount);
      if (
        outcome &&
        typeof outcome === "object" &&
        "ok" in outcome &&
        outcome.ok === false &&
        outcome.axError === "action_unsupported"
      ) {
        throw actionUnavailable(
          "element_scroll: no scrollable container in the element's ancestor chain (or the axis is not scrollable). action_sent=false. Use strategy=event for a raw coordinate scroll, or target an element inside a scrollable list.",
          { action_sent: false, reason: "no_scrollable_container" },
        );
      }
      return assertActionSucceeded(outcome, "element_scroll");
    };
  }
  // 清退（2026-11-10 R10 后续）：methods.get_skyshot 注册已随方法删除——官方
  // v3.1 协议瘦身 49→43（win entry :19750 墓碑），get_skyshot 在官方 win entry
  // 与 mac SEA 双零命中（2026-11-10 strings 实证）。
  return methods;
}
function normalizeApp(app) {
  return {
    pid: app.pid,
    bundle_id: app.bundle_id ?? null,
    name: app.name ?? null,
    active: app.active ?? false,
  };
}
