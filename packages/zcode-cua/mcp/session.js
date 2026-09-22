import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  ControlStopped,
  callBroker,
  callBrokerControl,
  recordTargetAppDisplayEvidence
} from "./client.js";
import {
  currentBrokerCancelSignal,
  interruptibleBrokerSleep,
  isBrokerUnavailableException,
  shouldPropagateToWrapper
} from "./errors.js";
var KillSwitch = class {
  stopped = false;
  stopReason = null;
  /** Latch the kill-switch. Idempotent — calling twice keeps the first
   * reason (Python: `stopped=True` assignment + `stop_reason` overwrite,
   * but we keep the original reason to preserve audit order). */
  stop(reason) {
    if (!this.stopped) {
      this.stopped = true;
      this.stopReason = typeof reason === "string" && reason ? reason : null;
    }
  }
  /**
   * Tool-entry preflight. Throws {@link ControlStopped} after `stop()` has
   * fired. Call before any backend read or target revalidation so the
   * kill-switch fails hard before touching the machine (Python:
   * `state.guard.ensure_running()` at the top of every tool body).
   */
  ensureRunning() {
    if (this.stopped) {
      throw new ControlStopped(
        `Computer control was stopped (${this.stopReason ?? "no reason given"}). Start a new session to continue.`
      );
    }
  }
  isStopped() {
    return this.stopped;
  }
  status() {
    return {
      stopped: this.stopped,
      stop_reason: this.stopReason
    };
  }
  /** Test hook — reset to the un-stopped state. */
  resetForTest() {
    this.stopped = false;
    this.stopReason = null;
  }
};
var defaultKillSwitch = null;
function getDefaultKillSwitch() {
  if (!defaultKillSwitch) defaultKillSwitch = new KillSwitch();
  return defaultKillSwitch;
}
function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error51) {
    return error51.code !== "ESRCH";
  }
}
function defaultLockPath() {
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "nouid";
  return join(tmpdir(), `zcode-cua-${uid}`, "left-mouse-owner.lock");
}
function createPointerHoldGuard(options = {}) {
  const lockPath = options?.lockPath ?? defaultLockPath();
  const pid = options?.pid ?? process.pid;
  const isAlive = options?.isAlive ?? processIsAlive;
  const readOwner = () => {
    try {
      const value = JSON.parse(readFileSync(lockPath, "utf8"));
      if (value.version !== 1 || !Number.isInteger(value.pid) || typeof value.sessionKey !== "string" || !value.sessionKey) {
        return null;
      }
      return value;
    } catch {
      return null;
    }
  };
  const ownerState = (sessionKey) => {
    const owner = readOwner();
    if (!owner) return "none";
    return owner.pid === pid && owner.sessionKey === sessionKey ? "same" : "other";
  };
  const removeIfStale = () => {
    const owner = readOwner();
    if (!owner || isAlive(owner.pid)) return false;
    try {
      rmSync(lockPath);
      return true;
    } catch {
      return false;
    }
  };
  return {
    acquire(sessionKey) {
      const dir = dirname(lockPath);
      mkdirSync(dir, { recursive: true, mode: 448 });
      chmodSync(dir, 448);
      const owner = { version: 1, pid, sessionKey };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const candidate = `${lockPath}.${pid}.${randomUUID()}.tmp`;
        let fd;
        try {
          fd = openSync(candidate, "wx", 384);
          writeFileSync(
            fd,
            `${JSON.stringify(owner)}
`,
            "utf8"
          );
          closeSync(fd);
          fd = void 0;
          chmodSync(candidate, 384);
          linkSync(candidate, lockPath);
        } catch (error51) {
          if (fd !== void 0) closeSync(fd);
          rmSync(candidate, { force: true });
          if (error51.code === "EEXIST" && attempt === 0 && removeIfStale()) {
            continue;
          }
          return ownerState(sessionKey) === "same" ? "same" : "other";
        }
        try {
          rmSync(candidate, { force: true });
        } catch {
        }
        return "none";
      }
      return "other";
    },
    ownerState,
    release(sessionKey) {
      if (ownerState(sessionKey) !== "same") return false;
      try {
        rmSync(lockPath);
        return true;
      } catch {
        return false;
      }
    }
  };
}
var globalPointerHoldGuard = createPointerHoldGuard();
var InputHoldRegistry = class {
  constructor(sessionKey) {
    this.sessionKey = sessionKey;
  }
  nextId = 0;
  active = /* @__PURE__ */ new Set();
  cancellationClaimed = /* @__PURE__ */ new Set();
  begin() {
    const key = `${this.sessionKey}:hold:${++this.nextId}`;
    this.active.add(key);
    let ended = false;
    return {
      key,
      end: () => {
        if (ended) return;
        ended = true;
        this.active.delete(key);
        this.cancellationClaimed.delete(key);
      }
    };
  }
  activeKeys() {
    return [...this.active];
  }
  claimCancellation(key) {
    if (!this.active.has(key) || this.cancellationClaimed.has(key)) return false;
    this.cancellationClaimed.add(key);
    return true;
  }
  cancellationWasClaimed(key) {
    return this.active.has(key) && this.cancellationClaimed.has(key);
  }
};
var FRAME_PIXEL_TRANSFORM_VERSION = "frame_pixel_projection_v1";
var FrameRegistryError = class extends Error {
  reason;
  frame_id;
  constructor(reason, message, frame_id) {
    super(message);
    this.name = "FrameRegistryError";
    this.reason = reason;
    this.frame_id = frame_id;
  }
};
function cloneAndFreeze(value) {
  return deepFreeze(structuredClone(value));
}
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
var FrameRegistry = class {
  session_id;
  maxFrames;
  maxTombstones;
  now;
  frames = /* @__PURE__ */ new Map();
  latestActionableFrameId = null;
  tombstones = /* @__PURE__ */ new Map();
  constructor(options) {
    if (!options.session_id) throw new Error("FrameRegistry session_id must be non-empty");
    const maxFrames = options.max_frames ?? 16;
    const maxTombstones = options.max_tombstones ?? Math.max(32, maxFrames * 4);
    if (!Number.isInteger(maxFrames) || maxFrames < 1) {
      throw new Error("FrameRegistry max_frames must be a positive integer");
    }
    if (!Number.isInteger(maxTombstones) || maxTombstones < 1) {
      throw new Error("FrameRegistry max_tombstones must be a positive integer");
    }
    this.session_id = options.session_id;
    this.maxFrames = maxFrames;
    this.maxTombstones = maxTombstones;
    this.now = options.now ?? Date.now;
  }
  register(input) {
    if (input.session_id !== this.session_id) {
      throw new FrameRegistryError(
        "cross_session_frame",
        `frame "${input.frame_id}" belongs to another session`,
        input.frame_id
      );
    }
    if (this.frames.has(input.frame_id) || this.tombstones.has(input.frame_id)) {
      throw new FrameRegistryError(
        "duplicate_frame",
        `frame_id "${input.frame_id}" has already been issued and cannot be reused`,
        input.frame_id
      );
    }
    if (input.image_ref.frame_id !== input.frame_id) {
      throw new Error("FrameDescriptor image_ref.frame_id must match frame_id");
    }
    const descriptor = cloneAndFreeze({
      ...input,
      image_ref: {
        frame_id: input.frame_id,
        width: input.delivered.width,
        height: input.delivered.height,
        actionable: input.actionable
      }
    });
    this.frames.set(descriptor.frame_id, descriptor);
    if (descriptor.actionable) {
      this.latestActionableFrameId = descriptor.frame_id;
    }
    this.evictOverflow();
    return descriptor;
  }
  resolve(frame_id) {
    const tombstone = this.tombstones.get(frame_id);
    if (tombstone) {
      throw new FrameRegistryError(tombstone, this.recoveryMessage(frame_id, tombstone), frame_id);
    }
    const frame = this.frames.get(frame_id);
    if (!frame) {
      throw new FrameRegistryError(
        "unknown_frame",
        this.recoveryMessage(frame_id, "unknown_frame"),
        frame_id
      );
    }
    if (this.now() > frame.expires_at_ms) {
      this.frames.delete(frame_id);
      this.rememberTombstone(frame_id, "expired_frame");
      throw new FrameRegistryError(
        "expired_frame",
        this.recoveryMessage(frame_id, "expired_frame"),
        frame_id
      );
    }
    if (!frame.actionable) {
      throw new FrameRegistryError(
        "non_actionable_frame",
        `frame_id "${frame_id}" is not actionable (${frame.non_actionable_reason ?? "unknown reason"}); capture a new image before acting`,
        frame_id
      );
    }
    return frame;
  }
  /**
   * Resolve model-supplied pixel authority. Retained descriptors remain
   * actionable until TTL/LRU/actionability checks fail them closed.
   */
  resolveForAction(frame_id) {
    return this.resolve(frame_id);
  }
  /**
   * Bind model-visible pixels to this transport's current raster authority.
   *
   * frame_id 是 transport 内部权限，默认坐标动作不要求模型转抄。这里仍复用
   * resolveForAction 的 TTL/actionability 检查；没有权威帧时 fail-closed。
   */
  resolveLatestForAction() {
    if (this.latestActionableFrameId === null) {
      throw new FrameRegistryError(
        "unknown_frame",
        "no actionable frame is available in this transport; call screenshot, zoom, or get_app_state before using image coordinates"
      );
    }
    return this.resolveForAction(this.latestActionableFrameId);
  }
  get(frame_id) {
    return this.frames.get(frame_id) ?? null;
  }
  tombstoneReason(frame_id) {
    return this.tombstones.get(frame_id) ?? null;
  }
  clear() {
    for (const id of this.frames.keys()) this.rememberTombstone(id, "evicted_frame");
    this.frames.clear();
    this.latestActionableFrameId = null;
  }
  evictOverflow() {
    while (this.frames.size > this.maxFrames) {
      const oldest = this.frames.keys().next().value;
      if (oldest === void 0) break;
      this.frames.delete(oldest);
      this.rememberTombstone(oldest, "evicted_frame");
    }
  }
  rememberTombstone(frame_id, reason) {
    this.tombstones.delete(frame_id);
    this.tombstones.set(frame_id, reason);
    while (this.tombstones.size > this.maxTombstones) {
      const oldest = this.tombstones.keys().next().value;
      if (oldest === void 0) break;
      this.tombstones.delete(oldest);
    }
  }
  recoveryMessage(frame_id, reason) {
    return `frame_id "${frame_id}" is ${reason.replaceAll("_", " ")}; call screenshot, zoom, or get_app_state again, then resubmit x/y chosen from the new raster; frame binding is internal`;
  }
};
var DEFAULT_MAX_STATES = 8;
var DEFAULT_MAX_FRAMES = 16;
var DEFAULT_FRAME_TTL_MS = 10 * 60 * 1e3;
var MAX_EMPTY_TREE_WARMUPS = 32;
var AccessibilitySession = class {
  /** Insertion-ordered map — `Map` iteration is insertion order, so the
   * first entry is the least-recently-used. Re-touching on `get` moves an
   * entry to the end (most-recently-used). */
  entries = /* @__PURE__ */ new Map();
  maxStates;
  counter = 0;
  frameRegistry;
  frameSessionId;
  issuedFrameIds = /* @__PURE__ */ new Set();
  frameGeneration = 0;
  /** Stable native display id selected by this MCP transport. */
  selectedDisplayId = null;
  /** Consecutive observation state is transport-scoped just like state ids
   * and visual frames. One HTTP client must not nudge another client to act. */
  lastObservationKey = null;
  observationRepeatCount = 0;
  /** App/window identities that already received the one-shot empty AX-tree warmup. */
  emptyTreeWarmups = /* @__PURE__ */ new Set();
  /** 动作进入原生调用后，本次引用的旧观察不再具有执行权限。 */
  supersededStateIds = /* @__PURE__ */ new Set();
  constructor(maxStates = DEFAULT_MAX_STATES) {
    if (!Number.isInteger(maxStates) || maxStates < 1) {
      throw new Error(
        `AccessibilitySession maxStates must be a positive integer (got ${maxStates})`
      );
    }
    this.maxStates = maxStates;
    this.frameSessionId = `session-${randomUUID()}`;
    this.frameRegistry = new FrameRegistry({
      session_id: this.frameSessionId,
      max_frames: DEFAULT_MAX_FRAMES
    });
  }
  issueFrame(input) {
    const createdAt = Date.now();
    this.frameGeneration += 1;
    let frameId;
    do {
      frameId = `frame-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    } while (this.issuedFrameIds.has(frameId));
    this.issuedFrameIds.add(frameId);
    const descriptor = {
      ...input,
      frame_id: frameId,
      session_id: this.frameSessionId,
      generation: this.frameGeneration,
      transform_version: FRAME_PIXEL_TRANSFORM_VERSION,
      created_at_ms: createdAt,
      expires_at_ms: createdAt + (input.ttl_ms ?? DEFAULT_FRAME_TTL_MS),
      image_ref: {
        frame_id: frameId,
        width: input.delivered.width,
        height: input.delivered.height,
        actionable: input.actionable
      }
    };
    delete descriptor.ttl_ms;
    return this.frameRegistry.register(descriptor);
  }
  /** Next monotonic state_id `s-N`, matching Python's `f"s-{self._counter}"`. */
  nextStateId() {
    this.counter += 1;
    return `s-${this.counter}`;
  }
  /** Cache a freshly observed state. Re-inserting an existing state_id
   * refreshes its LRU position (mirrors `_states[state_id] = state` followed
   * by the move_to_end in Python's per-app LRU). Evicts the oldest entry
   * when over capacity. */
  remember(state) {
    const parsedCounter = /^s-(\d+)$/.exec(state.state_id);
    if (parsedCounter) this.counter = Math.max(this.counter, Number(parsedCounter[1]));
    this.supersededStateIds.delete(state.state_id);
    if (this.entries.has(state.state_id)) {
      this.entries.delete(state.state_id);
    }
    this.entries.set(state.state_id, state);
    while (this.entries.size > this.maxStates) {
      const oldest = this.entries.keys().next().value;
      if (oldest === void 0) break;
      this.entries.delete(oldest);
      this.supersededStateIds.delete(oldest);
    }
  }
  /** Look up a cached state. Returns null if unknown/evicted (mirrors
   * Python's `StateError` path — callers surface that as a soft MCP error
   * so the model re-runs `get_app_state`). Touches the entry to refresh its
   * LRU position on hit. */
  get(state_id) {
    if (this.supersededStateIds.has(state_id)) return null;
    const state = this.entries.get(state_id);
    if (!state) return null;
    this.entries.delete(state_id);
    this.entries.set(state_id, state);
    return state;
  }
  has(state_id) {
    return this.entries.has(state_id) && !this.supersededStateIds.has(state_id);
  }
  isSuperseded(state_id) {
    return this.supersededStateIds.has(state_id);
  }
  /** 在原生调用前冻结基线，不改变任何可执行状态。 */
  beginMutation(appRef2, preStateId) {
    const preActionState = preStateId === null ? null : preStateId === void 0 ? this.latestStateForAppRef(appRef2) : this.entries.get(preStateId) ?? null;
    const scope = mutationScopeFrom(appRef2, preActionState);
    if (!mutationScopeHasAppIdentity(scope)) {
      throw new Error(
        "Element mutation requires a verified app identity before dispatch. action_sent=false."
      );
    }
    return {
      scope,
      preActionState
    };
  }
  /**
   * 原生调用已经开始：不能再依据 AX 返回值猜测副作用是否发生。只废弃本次动作
   * 实际引用的 pre_state_id；同 app/window 的其它已观察状态不被 scope-wide 锁死。
   */
  markMutationDispatched(ticket) {
    this.consumeReferencedState(ticket);
  }
  /** 废弃动作明确引用、但已被 Helper 证明失效的唯一 state。 */
  consumeReferencedState(ticket) {
    const stateId = ticket.preActionState?.state_id;
    if (stateId && this.entries.has(stateId)) this.supersededStateIds.add(stateId);
  }
  requiresRefresh(appRef2) {
    void appRef2;
    return false;
  }
  /**
   * The most-recently-used state_id (last key — `Map` iteration is touch
   * order, so the last key is MRU), or null when no state is cached. Used to
   * tell the model which state_id to reuse for a delta/no_change response,
   * which does not ingest a fresh tree and therefore does not assign a new
   * session id. Never surface the broker's own snapshot counter id — the
   * resolver only knows session-assigned ids.
   */
  lastStateId() {
    let last = null;
    for (const id of this.entries.keys()) {
      if (!this.supersededStateIds.has(id)) last = id;
    }
    return last;
  }
  /**
   * Return the newest cached state that belongs to the observed app/window.
   * Incremental broker replies carry no element tree, so their frontend
   * state_id may only reuse a baseline with the same ownership boundary.
   */
  lastStateIdFor(app, window2, options = {}) {
    const states = [...this.entries.values()].reverse();
    for (const state of states) {
      if (this.supersededStateIds.has(state.state_id)) continue;
      if (options.requireImage && !state.has_image) continue;
      if (!sameApp(state.app, app) || !sameWindow(state.window, window2)) continue;
      return state.state_id;
    }
    return null;
  }
  /**
   * Return the newest cached pre-action state matching an app_ref. Action
   * verification uses this immutable observation as its baseline; the broker
   * may successfully accept an input event while the target UI ignores it.
   */
  latestStateForAppRef(appRef2, options = {}) {
    if (!appRef2 || typeof appRef2 !== "object" || Array.isArray(appRef2)) return null;
    const ref = appRef2;
    const hasIdentity = typeof ref.pid === "number" || typeof ref.bundle_id === "string" || typeof ref.name === "string";
    if (!hasIdentity) return null;
    const matches = [];
    for (const state of [...this.entries.values()].reverse()) {
      if (this.supersededStateIds.has(state.state_id)) continue;
      if (typeof ref.pid === "number" && state.app.pid !== ref.pid) continue;
      if (typeof ref.bundle_id === "string" && state.app.bundle_id !== ref.bundle_id) continue;
      if (typeof ref.name === "string" && state.app.name !== ref.name) continue;
      if (!options.ignoreWindow && typeof ref.window_id === "number" && state.window.window_id !== ref.window_id)
        continue;
      matches.push(state);
    }
    if (matches.length === 0) return null;
    if (!options.ignoreWindow && typeof ref.window_id !== "number") {
      const windowIds2 = new Set(matches.map((state) => state.window.window_id));
      if (windowIds2.size > 1) return null;
    }
    return matches[0] ?? null;
  }
  selectDisplay(displayId) {
    if (!Number.isInteger(displayId)) {
      throw new Error(`display id must be an integer (got ${displayId})`);
    }
    this.selectedDisplayId = displayId;
  }
  selectedDisplay() {
    return this.selectedDisplayId;
  }
  clearSelectedDisplay() {
    this.selectedDisplayId = null;
  }
  /** Record a fingerprint and return its consecutive count in this session. */
  noteObservation(key) {
    if (this.lastObservationKey === key) {
      this.observationRepeatCount += 1;
    } else {
      this.lastObservationKey = key;
      this.observationRepeatCount = 1;
    }
    return this.observationRepeatCount;
  }
  /** Reset only the repeat-observation streak (test/diagnostic helper). */
  resetObservationFingerprint() {
    this.lastObservationKey = null;
    this.observationRepeatCount = 0;
  }
  /**
   * Claim the one allowed empty-tree warmup for this app/window in this
   * transport session. Stable canvas/video windows may legitimately expose
   * no AX nodes, so repeated observations must not pay another capture.
   */
  claimEmptyTreeWarmup(app, window2) {
    const appKey = typeof app.pid === "number" ? `pid:${app.pid}` : typeof app.bundle_id === "string" && app.bundle_id ? `bundle:${app.bundle_id.toLowerCase()}` : `name:${app.name ?? ""}`;
    const windowKey = typeof window2.window_id === "number" ? `wid:${window2.window_id}` : `geometry:${window2.title ?? ""}:${window2.bounds?.join(",") ?? ""}`;
    const key = `${appKey}|${windowKey}`;
    if (this.emptyTreeWarmups.has(key)) return false;
    this.emptyTreeWarmups.add(key);
    while (this.emptyTreeWarmups.size > MAX_EMPTY_TREE_WARMUPS) {
      const oldest = this.emptyTreeWarmups.values().next().value;
      if (oldest === void 0) break;
      this.emptyTreeWarmups.delete(oldest);
    }
    return true;
  }
  /** Test hook — drop every cached state and reset the counter. */
  clear() {
    this.entries.clear();
    this.supersededStateIds.clear();
    this.counter = 0;
    this.frameRegistry.clear();
    this.selectedDisplayId = null;
    this.emptyTreeWarmups.clear();
    this.resetObservationFingerprint();
  }
  /** Current cache size (test/diagnostic helper). */
  get size() {
    return this.entries.size;
  }
};
function mutationScopeFrom(appRef2, fallback) {
  const ref = appRef2 && typeof appRef2 === "object" && !Array.isArray(appRef2) ? appRef2 : {};
  return {
    pid: typeof ref.pid === "number" ? ref.pid : fallback?.app.pid ?? null,
    bundle_id: typeof ref.bundle_id === "string" ? ref.bundle_id : fallback?.app.bundle_id ?? null,
    name: typeof ref.name === "string" ? ref.name : fallback?.app.name ?? null,
    window_id: typeof ref.window_id === "number" ? ref.window_id : fallback?.window.window_id ?? null
  };
}
function mutationScopeHasAppIdentity(scope) {
  return scope.pid !== null || Boolean(scope.bundle_id || scope.name);
}
function sameApp(cached2, observed) {
  if (typeof observed.pid === "number") return cached2.pid === observed.pid;
  if (typeof observed.bundle_id === "string" && observed.bundle_id) {
    return cached2.bundle_id === observed.bundle_id;
  }
  if (typeof observed.name === "string" && observed.name) {
    return cached2.name === observed.name;
  }
  return false;
}
function sameWindow(cached2, observed) {
  if (typeof observed.window_id === "number") {
    return cached2.window_id === observed.window_id;
  }
  if (typeof observed.title !== "string" || !Array.isArray(observed.bounds)) {
    return false;
  }
  return cached2.title === observed.title && cached2.bounds.length === observed.bounds.length && cached2.bounds.every((value, index) => value === observed.bounds?.[index]);
}
var defaultSession = null;
var sessionContext = new AsyncLocalStorage();
function getDefaultSession() {
  const contextualSession = sessionContext.getStore();
  if (contextualSession) return contextualSession;
  if (!defaultSession) defaultSession = new AccessibilitySession();
  return defaultSession;
}
function runWithSession(session, callback) {
  return sessionContext.run(session, callback);
}
var ActionTier = {
  READ_ONLY: "read_only",
  T1_INPUT: "t1_input",
  SAFETY_CONTROL: "safety_control"
};
var READ_ONLY_TOOLS = /* @__PURE__ */ new Set([
  "list_apps",
  "list_windows",
  "get_app_state",
  "screenshot",
  "zoom",
  "list_displays",
  "cursor_position",
  "request_access",
  "wait",
  "read_clipboard"
]);
var SAFETY_CONTROL_TOOLS = /* @__PURE__ */ new Set(["left_mouse_up", "stop_computer_control"]);
var TIER_TABLE = Object.freeze({
  // OBSERVATION (9)
  list_apps: ActionTier.READ_ONLY,
  open_application: ActionTier.T1_INPUT,
  list_windows: ActionTier.READ_ONLY,
  get_app_state: ActionTier.READ_ONLY,
  screenshot: ActionTier.READ_ONLY,
  zoom: ActionTier.READ_ONLY,
  list_displays: ActionTier.READ_ONLY,
  switch_display: ActionTier.T1_INPUT,
  cursor_position: ActionTier.READ_ONLY,
  // POINTER (10)
  left_click: ActionTier.T1_INPUT,
  double_click: ActionTier.T1_INPUT,
  triple_click: ActionTier.T1_INPUT,
  right_click: ActionTier.T1_INPUT,
  middle_click: ActionTier.T1_INPUT,
  scroll: ActionTier.T1_INPUT,
  left_click_drag: ActionTier.T1_INPUT,
  mouse_move: ActionTier.T1_INPUT,
  left_mouse_down: ActionTier.T1_INPUT,
  left_mouse_up: ActionTier.SAFETY_CONTROL,
  // KEYBOARD (5)
  type: ActionTier.T1_INPUT,
  set_value: ActionTier.T1_INPUT,
  select_text: ActionTier.T1_INPUT,
  key: ActionTier.T1_INPUT,
  hold_key: ActionTier.T1_INPUT,
  // SEMANTIC (1)
  perform_action: ActionTier.T1_INPUT,
  // RUNTIME (5)
  request_access: ActionTier.READ_ONLY,
  stop_computer_control: ActionTier.SAFETY_CONTROL,
  wait: ActionTier.READ_ONLY,
  read_clipboard: ActionTier.READ_ONLY,
  write_clipboard: ActionTier.T1_INPUT
});
function classifyTier(name) {
  if (READ_ONLY_TOOLS.has(name)) return ActionTier.READ_ONLY;
  if (SAFETY_CONTROL_TOOLS.has(name)) return ActionTier.SAFETY_CONTROL;
  return ActionTier.T1_INPUT;
}
for (const [name, tier] of Object.entries(TIER_TABLE)) {
  const expected = classifyTier(name);
  if (tier !== expected) {
    throw new Error(
      `tier-table.ts: TIER_TABLE["${name}"] = "${tier}" but allow-sets classify it as "${expected}"`
    );
  }
}
var RESTRICTED_MODE_TIERS = /* @__PURE__ */ new Set(["read_only", "safety_control"]);
function toolAnnotationsFor(name) {
  if (!(name in TIER_TABLE)) {
    throw new Error(
      `toolAnnotationsFor: unknown tool name "${name}" \u2014 not present in TIER_TABLE (manifest drift)`
    );
  }
  const tier = TIER_TABLE[name];
  if (RESTRICTED_MODE_TIERS.has(tier)) {
    return { readOnlyHint: true, destructiveHint: false };
  }
  return { readOnlyHint: false, destructiveHint: true };
}
var DEFAULT_MCP_SESSION_KEY = randomBytes(8).toString("hex");
function toolSession(deps) {
  return deps.session ?? getDefaultSession();
}
function toolSessionKey(deps) {
  return deps.sessionKey ?? DEFAULT_MCP_SESSION_KEY;
}
function toolKillSwitch(deps) {
  return deps.killSwitch ?? getDefaultKillSwitch();
}
var sharpPromise = null;
function loadSharp() {
  if (!sharpPromise) {
    try {
      const requireBases = [
        typeof import.meta.url === "string" && import.meta.url ? import.meta.url : void 0,
        typeof __filename === "string" && __filename ? __filename : void 0,
        process.env.ZCODE_PLUGIN_ROOT ? join(process.env.ZCODE_PLUGIN_ROOT, "package.json") : void 0,
        process.env.ZCODE_ALLOW_HOST_SHARP === "1" ? join(process.cwd(), "package.json") : void 0
      ].filter((base) => typeof base === "string");
      let sharp;
      let lastError;
      for (const requireBase of new Set(requireBases)) {
        try {
          sharp = createRequire(requireBase)("sharp");
          break;
        } catch (error51) {
          lastError = error51;
        }
      }
      if (!sharp) throw lastError;
      if (typeof sharp !== "function" || typeof sharp.versions?.vips !== "string") {
        throw new Error("Resolved sharp runtime failed callable/libvips validation");
      }
      sharpPromise = Promise.resolve(sharp);
    } catch (error51) {
      sharpPromise = Promise.reject(error51);
    }
  }
  return sharpPromise;
}
function asSurfaceKind(value) {
  return value === "window" || value === "attached_dialog" || value === "open_panel" || value === "save_panel" || value === "popover" ? value : null;
}
function parseAppFrameSurfaceSet(value) {
  if (value === void 0 || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const record2 = value;
  if (!Number.isSafeInteger(record2.presentation_window_id) || record2.presentation_window_id <= 0 || typeof record2.before_fingerprint !== "string" || record2.before_fingerprint.length === 0 || typeof record2.after_fingerprint !== "string" || record2.after_fingerprint.length === 0 || record2.order !== "front_to_back" || !Array.isArray(record2.surfaces) || record2.surfaces.length < 1 || record2.surfaces.length > 64) {
    return void 0;
  }
  const surfaces = record2.surfaces.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const surface = entry;
    const kind = asSurfaceKind(surface.surface_kind);
    const bounds = surface.bounds;
    if (!Number.isSafeInteger(surface.actual_window_id) || surface.actual_window_id <= 0 || !Number.isSafeInteger(surface.presentation_window_id) || surface.presentation_window_id <= 0 || !kind || surface.relation !== "presentation_root" && surface.relation !== "ax_descendant" || !Number.isSafeInteger(surface.owner_pid) || surface.owner_pid <= 0 || typeof surface.owner_bundle_id !== "string" || surface.owner_bundle_id.length === 0 || !Number.isSafeInteger(surface.layer) || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) {
      return null;
    }
    return {
      actual_window_id: surface.actual_window_id,
      presentation_window_id: surface.presentation_window_id,
      surface_kind: kind,
      relation: surface.relation,
      owner_pid: surface.owner_pid,
      owner_bundle_id: surface.owner_bundle_id,
      layer: surface.layer,
      bounds
    };
  });
  if (surfaces.some((surface) => surface === null)) return void 0;
  return {
    presentation_window_id: record2.presentation_window_id,
    before_fingerprint: record2.before_fingerprint,
    after_fingerprint: record2.after_fingerprint,
    order: "front_to_back",
    surfaces
  };
}
function asBounds(value, where) {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error(`${where} must be a 4-number bounds array; got ${JSON.stringify(value)}`);
  }
  const nums = value.map(Number);
  if (!nums.every((n) => Number.isFinite(n))) {
    throw new Error(`${where} must contain finite numbers; got ${JSON.stringify(value)}`);
  }
  return nums;
}
function asElements(raw) {
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`capture_app element[${i}] must be an object; got ${typeof entry}`);
    }
    const el = entry;
    const bounds = asBounds(el.bounds, `capture_app element[${i}].bounds`);
    const actions = Array.isArray(el.actions) ? el.actions : [];
    return {
      role: typeof el.role === "string" ? el.role : "",
      kind: typeof el.kind === "string" ? el.kind : "",
      title: typeof el.title === "string" ? el.title : null,
      value: typeof el.value === "string" ? el.value : null,
      bounds,
      enabled: typeof el.enabled === "boolean" ? el.enabled : true,
      editable: typeof el.editable === "boolean" ? el.editable : false,
      actions,
      focused: typeof el.focused === "boolean" ? el.focused : false,
      ...typeof el.selected === "boolean" ? { selected: el.selected } : {},
      default_action: typeof el.default_action === "boolean" ? el.default_action : false,
      pressable: typeof el.pressable === "boolean" ? el.pressable : actions.includes("AXPress"),
      has_menu: typeof el.has_menu === "boolean" ? el.has_menu : actions.includes("AXShowMenu"),
      native: typeof el.native === "string" ? el.native : "",
      owner_pid: typeof el.owner_pid === "number" ? el.owner_pid : null,
      // 被采样的大容器：保留真实总数，供 formatAppStateTree 渲染 "of 274"。
      ...typeof el.children_total === "number" && el.children_total > 0 ? {
        children_total: el.children_total,
        ...typeof el.children_shown === "number" ? { children_shown: el.children_shown } : {}
      } : {}
    };
  });
}
function asSurfaceKind2(value) {
  return value === "window" || value === "attached_dialog" || value === "open_panel" || value === "save_panel" || value === "popover" ? value : null;
}
async function probeScreenshotSize(screenshot) {
  if (!screenshot) return null;
  const data = screenshot.data;
  if (typeof data !== "string" || !data) return null;
  try {
    const sharp = await loadSharp();
    const meta3 = await sharp(Buffer.from(data, "base64")).metadata();
    if (typeof meta3.width === "number" && typeof meta3.height === "number" && meta3.width > 0 && meta3.height > 0) {
      return { width: meta3.width, height: meta3.height };
    }
    return null;
  } catch {
    return null;
  }
}
async function issueCaptureFrame(raw, app, window2, session) {
  const rasterSize = await probeScreenshotSize(raw.screenshot);
  if (!rasterSize || !raw.screenshot?.data) return null;
  const screenshotBlank = raw.screenshot_blank === true;
  const pointer = raw.pointer;
  const geometryVerified = raw.coordinate_contract === "frame_pixel_projection_v1" && pointer !== null && pointer !== void 0 && [pointer.x, pointer.y, pointer.width, pointer.height].every(
    (part) => typeof part === "number" && Number.isFinite(part)
  ) && (pointer.width ?? 0) > 0 && (pointer.height ?? 0) > 0 && typeof pointer.unit === "string" && typeof raw.display?.topology_fingerprint === "string" && raw.display.topology_fingerprint.length > 0;
  const px = geometryVerified ? pointer.x : 0;
  const py = geometryVerified ? pointer.y : 0;
  const pw = geometryVerified ? pointer.width : 0;
  const ph = geometryVerified ? pointer.height : 0;
  const parsedCaptureSurfaces = parseAppFrameSurfaceSet(raw.capture_surfaces);
  const captureSurfaces = parsedCaptureSurfaces ?? null;
  const malformedCaptureSurfaces = raw.capture_surfaces !== void 0 && raw.capture_surfaces !== null && parsedCaptureSurfaces === void 0;
  const surfaceStatus = raw.capture_surfaces_status;
  const nonActionableReason = screenshotBlank ? "screenshot_blank" : surfaceStatus === "capture_surfaces_changed" ? "capture_surfaces_changed" : surfaceStatus === "capture_surfaces_unavailable" ? "capture_surfaces_unavailable" : malformedCaptureSurfaces ? "capture_surfaces_unavailable" : raw.capture_surfaces && raw.capture_surfaces.before_fingerprint !== raw.capture_surfaces.after_fingerprint ? "capture_surfaces_changed" : geometryVerified ? null : "capture_geometry_unverified";
  const frame = session.issueFrame({
    delivered: {
      width: rasterSize.width,
      height: rasterSize.height,
      format: raw.screenshot.format ?? "png",
      digest: `sha256:${createHash("sha256").update(Buffer.from(raw.screenshot.data, "base64")).digest("hex")}`,
      data: raw.screenshot.data
    },
    source: {
      width: rasterSize.width,
      height: rasterSize.height,
      crop: { left: 0, top: 0, right: rasterSize.width, bottom: rasterSize.height }
    },
    pointer: {
      x: raw.pointer?.x ?? px,
      y: raw.pointer?.y ?? py,
      width: raw.pointer?.width ?? pw,
      height: raw.pointer?.height ?? ph,
      unit: raw.pointer?.unit ?? "point"
    },
    app: {
      bundle_id: app.bundle_id,
      pid: app.pid,
      name: app.name,
      aumid: app.aumid,
      executable_path: app.executable_path,
      icon_png: app.icon_png
    },
    window: { window_id: window2.window_id, bounds: window2.bounds },
    display: {
      display_id: raw.display?.id ?? null,
      topology_fingerprint: raw.display?.topology_fingerprint ?? "unverified",
      origin: { x: raw.pointer?.x ?? px, y: raw.pointer?.y ?? py }
    },
    capture_surfaces: captureSurfaces,
    actionable: nonActionableReason === null,
    non_actionable_reason: nonActionableReason
  });
  return frame.image_ref;
}
async function ingestCaptureAppResult(raw, options) {
  const session = options?.session ?? getDefaultSession();
  const app = {
    bundle_id: typeof raw.app.bundle_id === "string" ? raw.app.bundle_id : null,
    pid: typeof raw.app.pid === "number" ? raw.app.pid : null,
    name: typeof raw.app.name === "string" ? raw.app.name : null,
    window_id: typeof raw.window.window_id === "number" ? raw.window.window_id : null,
    aumid: typeof raw.app.aumid === "string" ? raw.app.aumid : null,
    executable_path: typeof raw.app.executable_path === "string" ? raw.app.executable_path : null,
    icon_png: typeof raw.app.icon_png === "string" ? raw.app.icon_png : null
  };
  recordTargetAppDisplayEvidence(app);
  const window2 = {
    title: typeof raw.window.title === "string" ? raw.window.title : null,
    bounds: raw.window.bounds ? asBounds(raw.window.bounds, "capture_app window.bounds") : [0, 0, 0, 0],
    window_id: typeof raw.window.window_id === "number" ? raw.window.window_id : null,
    window_id_fallback: raw.window.window_id_fallback === true || void 0,
    empty_capture_reason: typeof raw.window.empty_capture_reason === "string" && raw.window.empty_capture_reason.length > 0 ? raw.window.empty_capture_reason : void 0,
    note: raw.window.window_id_fallback === true && typeof raw.window.note === "string" ? raw.window.note : void 0,
    actual_window_id: typeof raw.window.actual_window_id === "number" ? raw.window.actual_window_id : typeof raw.window.window_id === "number" ? raw.window.window_id : null,
    presentation_window_id: typeof raw.window.presentation_window_id === "number" ? raw.window.presentation_window_id : typeof raw.window.window_id === "number" ? raw.window.window_id : null,
    surface_kind: asSurfaceKind2(raw.window.surface_kind) ?? "window",
    surface_lifecycle: raw.window.surface_lifecycle === "replaced" || raw.window.surface_lifecycle === "closed" ? raw.window.surface_lifecycle : "stable"
  };
  const elements = asElements(raw.elements);
  const screenshotBlank = raw.screenshot_blank === true;
  const rasterSize = await probeScreenshotSize(raw.screenshot);
  const imageSize = screenshotBlank ? null : rasterSize;
  const state = {
    state_id: session.nextStateId(),
    app,
    window: window2,
    elements,
    has_image: imageSize !== null,
    image_size: imageSize ?? void 0,
    screenshot_blank: screenshotBlank || void 0
  };
  const imageRef = await issueCaptureFrame(raw, app, window2, session);
  if (imageRef) {
    state.image_ref = imageRef;
  }
  session.remember(state);
  return state;
}
var GLOBAL_SCREEN_COORDINATE_CONTRACT = "coordinate_contract: bounds=[x,y,width,height] in global_screen_points; screen_rect=[x0,y0,x1,y1]; zoom.region uses exact image pixels from the current raster";
var EMPTY_CAPTURE_GUIDANCE = {
  // 此时菜单栏通常是完整可读的（元素表里的 menubar 项就来自它），且 File > New … /
  // open_app 都能把窗口开回来。所以这条路径是"换动作"，不是"读失败"。
  "cg-only-no-ax-window": "This app has closed all of its real windows \u2014 the window_id above is a WindowServer leftover that is neither visible to the user nor readable through Accessibility. Do NOT retry this read. Either drive the app's menu bar (its items are listed below, e.g. File > New) or reopen the app with open_app to get a real window back.",
  // 窗口确实解析到了，但整棵树是空的：多为 app 无响应 / 树尚未构建。重试或换窗口有意义。
  "ax-window-empty-tree": "A window resolved but exposed no Accessibility children \u2014 the app may be busy or still building its tree. Take a screenshot to see what is actually on screen, or call list_windows to pick a different window before reading again."
};
function flag(value, label) {
  return value ? label : "";
}
function synthesizeLabel(el, index) {
  if (el.value) {
    return `${el.kind}: ${truncate(el.value, 60)}`;
  }
  if (el.kind === "button" || el.pressable) {
    return `${el.kind} ${index}`;
  }
  if (el.kind === "image") {
    return "image";
  }
  if (el.kind === "group" || el.kind === "menu" || el.kind === "menubar" || el.kind === "toolbar" || el.kind === "scrollbar" || el.kind === "tab" || el.kind === "list" || el.kind === "table") {
    return `${el.kind} ${index}`;
  }
  return "";
}
function elementRow(index, el, detail) {
  const caps = [
    flag(el.pressable, "pressable"),
    flag(el.editable, "editable"),
    flag(el.has_menu, "has_menu"),
    flag(el.focused, "focused"),
    flag(el.selected === true, "selected"),
    flag(el.default_action === true, "default_action"),
    flag(!el.enabled, "disabled")
  ].filter(Boolean).join(" ");
  const synthesized = el.title ? "" : synthesizeLabel(el, index);
  const title = el.title ? ` ${el.title}` : synthesized ? ` ${synthesized}` : "";
  const value = el.value ? ` = ${truncate(el.value, 60)}` : "";
  const head = `[${index}] ${el.kind}${title}${value}`;
  const tail = caps ? ` (${caps})` : "";
  const sampled = (() => {
    const total = el.children_total;
    if (typeof total !== "number" || total <= 0) return "";
    const shown = el.children_shown ?? 0;
    const offset = el.children_offset ?? 0;
    const range = shown > 0 ? `${offset}-${offset + shown - 1}` : `${shown}`;
    return ` (showing ${range} of ${total} items)`;
  })();
  if (detail === "full") {
    const boundsStr = el.bounds.join(",");
    const actions = el.actions.length ? ` actions=[${el.actions.join(",")}]` : "";
    return `  ${head}${tail}${sampled} bounds=[${boundsStr}]${actions}`;
  }
  return `  ${head}${tail}${sampled}`;
}
function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\u2026`;
}
function formatAppStateTree(state, detail = "compact") {
  const app = state.app;
  const win = state.window;
  const appParts = [];
  if (app.bundle_id) appParts.push(app.bundle_id);
  if (typeof app.pid === "number") appParts.push(`pid=${app.pid}`);
  if (app.name) appParts.push(`"${app.name}"`);
  const appLine = appParts.length ? appParts.join(" ") : "(unknown app)";
  const [wx, wy, ww, wh] = win.bounds;
  const screenRect = [wx, wy, wx + ww, wy + wh];
  const title = win.title ? ` "${win.title}"` : "";
  const windowId = typeof win.window_id === "number" ? ` window_id=${win.window_id}` : "";
  const fallbackNote = win.window_id_fallback ? `[window_id_fallback] ${win.note ?? "The requested window could not be resolved; a different live window was returned. Call list_windows before acting."}` : "";
  const emptyCaptureNote = win.empty_capture_reason ? `[${win.empty_capture_reason}] ${EMPTY_CAPTURE_GUIDANCE[win.empty_capture_reason] ?? "This app exposed no window tree. Retrying the same read is unlikely to help; re-resolve the app with list_windows first."}` : "";
  const surfaceLine = win.surface_kind ? `surface: kind=${win.surface_kind} actual_window_id=${win.actual_window_id ?? win.window_id ?? "unknown"} presentation_window_id=${win.presentation_window_id ?? win.window_id ?? "unknown"} lifecycle=${win.surface_lifecycle ?? "stable"}` : "";
  const filePanelSummary = (() => {
    if (win.surface_kind !== "open_panel" && win.surface_kind !== "save_panel") {
      return "";
    }
    const selected = state.elements.filter((element) => element.selected === true).map((element) => element.title ?? element.value).filter((value) => typeof value === "string" && value.length > 0);
    const defaultAction = state.elements.find((element) => element.default_action === true);
    return [
      `file_panel: selected=[${selected.join(",")}] default_action=${defaultAction?.title ?? "unknown"} enabled=${defaultAction?.enabled ?? false}`,
      "file_panel_guidance: For an exact path use Cmd+Shift+G, observe the attached surface again, type the full path, then confirm once."
    ].join("\n");
  })();
  const maxElements = 200;
  let entries = state.elements.map((el, index) => ({ el, index }));
  let truncatedCount = 0;
  if (entries.length > maxElements) {
    const ranked = entries.map(({ el, index }) => ({
      el,
      index,
      score: elementPriority(el, win.bounds)
    }));
    ranked.sort((a, b) => b.score - a.score);
    entries = ranked.slice(0, maxElements).sort((a, b) => a.index - b.index);
    truncatedCount = state.elements.length - entries.length;
  }
  const rows = entries.map(({ el, index }) => elementRow(index, el, detail));
  const truncatedNote = truncatedCount > 0 ? `(showing top ${entries.length} of ${state.elements.length} by priority; ${truncatedCount} low-priority elements hidden)` : "";
  return [
    `state_id=${state.state_id}`,
    `app: ${appLine}`,
    GLOBAL_SCREEN_COORDINATE_CONTRACT,
    `window:${title}${windowId} bounds=[${wx},${wy},${ww},${wh}] screen_rect=[${screenRect.join(",")}]`,
    surfaceLine,
    filePanelSummary,
    fallbackNote,
    emptyCaptureNote,
    `elements (${entries.length}${truncatedCount > 0 ? ` of ${state.elements.length}` : ""}):`,
    ...rows,
    truncatedNote
  ].filter((line) => line.length > 0).join("\n");
}
function elementPriority(el, windowBounds) {
  let score = 0;
  const kind = el.kind?.toLowerCase() ?? "";
  const container = /group|split|scroll|layout|container|pane|unknown/.test(kind);
  const leafControl = /button|check|radio|switch|link|menuitem|tab|textfield|textarea|slider/.test(
    kind
  );
  if (el.focused) score += 220;
  if (el.selected) score += 240;
  if (el.default_action) score += 240;
  if (el.pressable && el.enabled) score += 200;
  if (leafControl) score += 100;
  if (el.title) score += 60;
  if (el.editable && !container) score += 120;
  if (el.has_menu && !container) score += 30;
  if (el.value) score += 20;
  if (container) score -= 120;
  const [, , ew, eh] = el.bounds;
  const [, , ww, wh] = windowBounds;
  if (ew <= 0 || eh <= 0) {
    score -= kind === "menuitem" ? 50 : 400;
  }
  if (ww > 0 && wh > 0 && ew * eh >= ww * wh * 0.75) score -= 80;
  return score;
}
function projectFramePixelToPointer(frame, pixel) {
  const { x, y } = pixel;
  const { width: deliveredWidth, height: deliveredHeight } = frame.delivered;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= deliveredWidth || y >= deliveredHeight) {
    throw new RangeError(
      `frame pixel coordinate (${String(x)}, ${String(y)}) is outside ${deliveredWidth}x${deliveredHeight}`
    );
  }
  const { crop } = frame.source;
  const cropWidth = crop.right - crop.left;
  const cropHeight = crop.bottom - crop.top;
  if (deliveredWidth <= 0 || deliveredHeight <= 0 || frame.source.width <= 0 || frame.source.height <= 0 || cropWidth <= 0 || cropHeight <= 0 || frame.pointer.width <= 0 || frame.pointer.height <= 0) {
    throw new RangeError("frame coordinate transform contains a zero or negative extent");
  }
  const sourceX = crop.left + (x + 0.5) / deliveredWidth * cropWidth;
  const sourceY = crop.top + (y + 0.5) / deliveredHeight * cropHeight;
  return {
    x: frame.pointer.x + sourceX * (frame.pointer.width / frame.source.width),
    y: frame.pointer.y + sourceY * (frame.pointer.height / frame.source.height)
  };
}
var implicitFrameBindings = /* @__PURE__ */ new WeakSet();
function frameBindingKind(target) {
  if (target && typeof target === "object" && implicitFrameBindings.has(target)) {
    return "implicit";
  }
  const frameId = target?.frame_id;
  return typeof frameId === "string" && frameId.length > 0 ? "explicit" : "implicit";
}
function bindFramePixelTarget(target, context) {
  const bindingKind = frameBindingKind(target);
  const explicitFrameId = target.frame_id;
  const frame = typeof explicitFrameId === "string" && explicitFrameId.length > 0 ? context.frame_registry.resolveForAction(explicitFrameId) : context.frame_registry.resolveLatestForAction();
  const bound = {
    type: "coordinate",
    frame_id: frame.frame_id,
    x: target.x,
    y: target.y
  };
  if (bindingKind === "implicit") implicitFrameBindings.add(bound);
  return bound;
}
function resolveFramePixelTarget(target, context) {
  const bound = bindFramePixelTarget(target, context);
  const frame = context.frame_registry.resolveForAction(bound.frame_id);
  return {
    frame_id: bound.frame_id,
    point: projectFramePixelToPointer(frame, {
      x: bound.x,
      y: bound.y
    })
  };
}
function unwrapStringifiedObject(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return value;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  return value;
}
function present(value, key, obj) {
  return key in obj && value !== void 0 && value !== null;
}
function parseAppRef(value) {
  value = unwrapStringifiedObject(value);
  if (typeof value === "string") {
    if (!value.trim()) {
      throw new Error("app_ref bundle id string must be non-empty");
    }
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}") || trimmed.startsWith("[") && trimmed.endsWith("]")) {
      throw new Error(
        `app_ref must be a bundle id string (e.g. com.apple.TextEdit) or an object {bundle_id|pid}; a JSON-stringified value like '${trimmed}' is not a valid bundle id. Pass the parsed object instead.`
      );
    }
    return { bundle_id: value };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("app_ref must be an object {bundle_id|pid} or a bundle id string");
  }
  const obj = value;
  const result = {};
  const bundleIdRaw = obj.bundle_id;
  if (present(bundleIdRaw, "bundle_id", obj)) {
    if (typeof bundleIdRaw !== "string") {
      throw new Error("app_ref.bundle_id must be a string");
    }
    if (!bundleIdRaw.trim()) {
      throw new Error("app_ref.bundle_id must be a non-empty string");
    }
    result.bundle_id = bundleIdRaw;
  }
  const pidRaw = obj.pid;
  if (present(pidRaw, "pid", obj)) {
    if (typeof pidRaw === "boolean" || typeof pidRaw !== "number" || !Number.isInteger(pidRaw)) {
      throw new Error("app_ref.pid must be an integer");
    }
    if (pidRaw <= 0) {
      throw new Error("app_ref.pid must be a positive integer");
    }
    result.pid = pidRaw;
  }
  const windowIdRaw = obj.window_id;
  if (present(windowIdRaw, "window_id", obj)) {
    if (typeof windowIdRaw === "boolean" || typeof windowIdRaw !== "number" || !Number.isInteger(windowIdRaw)) {
      throw new Error("app_ref.window_id must be an integer");
    }
    result.window_id = windowIdRaw;
  }
  const nameRaw = obj.name;
  if (present(nameRaw, "name", obj)) {
    if (typeof nameRaw !== "string" || !nameRaw.trim()) {
      throw new Error("app_ref.name must be a non-empty string");
    }
    result.name = nameRaw;
  }
  return result;
}
var appRef = z.unknown().superRefine((value, ctx) => {
  try {
    parseAppRef(value);
  } catch (e) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: e instanceof Error ? e.message : String(e)
    });
  }
}).transform((value) => {
  const unwrapped = unwrapStringifiedObject(value);
  if (typeof unwrapped === "string") return { bundle_id: unwrapped };
  return unwrapped;
});
var appRefNullable = z.unknown().superRefine((value, ctx) => {
  if (value === void 0 || value === null) return;
  try {
    parseAppRef(value);
  } catch (e) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: e instanceof Error ? e.message : String(e)
    });
  }
}).transform((value) => {
  if (value === void 0 || value === null) return value;
  const unwrapped = unwrapStringifiedObject(value);
  if (typeof unwrapped === "string") return { bundle_id: unwrapped };
  return unwrapped;
}).optional();
var elementTargetJSONSchema = {
  type: "object",
  required: ["type", "state_id", "index"],
  description: 'Element target (PREFERRED): accessibility-driven, works on a BACKGROUND app (no focus steal) -- {"type":"element","state_id":"s-1","index":4}. state_id/index come from the most recent get_app_state.',
  properties: {
    type: { const: "element" },
    state_id: {
      type: "string",
      description: "state_id from the most recent get_app_state"
    },
    index: { type: "integer", description: "the element's index within that state_id" }
  },
  additionalProperties: false
};
var coordinateTargetJSONSchema = {
  type: "object",
  required: ["type", "x", "y"],
  description: 'Image-pixel target {"type":"coordinate","x":496,"y":331}. x/y are integer pixel indices in the latest actionable raster returned by this transport. Retina, DPI, crop, resize, display origin and pointer units are resolved internally.',
  properties: {
    type: { const: "coordinate" },
    frame_id: {
      type: "string",
      minLength: 1,
      description: "optional explicit frame_id for backward compatibility; omit it to use CUA's transport-local current raster binding"
    },
    x: { type: "integer", minimum: 0 },
    y: { type: "integer", minimum: 0 }
  },
  additionalProperties: false
};
var targetArgJSONSchema = {
  description: "Choose exactly one semantic path. Use an element target only when selecting an accessibility-tree element. When the action is derived from a delivered image, use the coordinate target and copy integer pixels from that exact raster; CUA binds its frame internally.",
  anyOf: [elementTargetJSONSchema, coordinateTargetJSONSchema]
};
var OPEN_APPLICATION_APP_PROPERTIES = {
  bundle_id: { type: "string", description: "macOS bundle id, e.g. com.google.Chrome" },
  name: {
    type: "string",
    description: 'Copy the user-provided application name character-for-character. For example, use {"name":"\u7F51\u6613\u4E91\u97F3\u4E50app"}, not {"name":"\u7F51\u6613\u4E91\u97F3\u4E50"}; use {"name":"\u65E5\u5386"}, not {"name":"Calendar"}.'
  },
  pid: { type: "integer", description: "running process id from list_apps/get_app_state" },
  url: { type: "string", description: "single URL to hand to the app" },
  urls: {
    type: "array",
    items: { type: "string" },
    description: "multiple URLs to hand to the app"
  }
};
function openApplicationAppBranch(required2) {
  return {
    type: "object",
    required: [required2],
    properties: OPEN_APPLICATION_APP_PROPERTIES,
    additionalProperties: false
  };
}
var openApplicationAppArgJSONSchema = {
  description: 'Application to launch/resolve. Put fields directly inside app: {"name":"Google Chrome","url":"https://..."} or {"bundle_id":"com.google.Chrome","urls":["https://..."]} or {"pid":12345,"name":"Google Chrome"} for an already-running app. Do not use {"app":"Google Chrome"} inside this object.',
  // Moonshot's tool schema validator rejects type/properties/additionalProperties
  // beside anyOf, so each branch is a complete object schema.
  anyOf: [
    openApplicationAppBranch("bundle_id"),
    openApplicationAppBranch("name"),
    openApplicationAppBranch("pid")
  ]
};
function coercePixel(value, name) {
  if (typeof value === "boolean" || typeof value !== "number") {
    throw new Error(`${name} must be a number`);
  }
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer pixel index`);
  }
  return value;
}
function parseTarget(value) {
  value = unwrapStringifiedObject(value);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error('target must be an object with a "type" of "element" or "coordinate"');
  }
  const obj = value;
  const kind = obj.type;
  if (kind === "element") {
    const stateId = obj.state_id;
    if (typeof stateId !== "string" || !stateId) {
      throw new Error("element target requires a non-empty string state_id");
    }
    const index = obj.index;
    if (typeof index === "boolean" || typeof index !== "number" || !Number.isInteger(index)) {
      throw new Error("element target requires an integer index");
    }
    return { type: "element", state_id: stateId, index };
  }
  if (kind === "coordinate") {
    const allowed = /* @__PURE__ */ new Set(["type", "frame_id", "x", "y"]);
    const unexpected = Object.keys(obj).filter((key) => !allowed.has(key));
    if (unexpected.length > 0) {
      throw new Error(
        `coordinate target only accepts type, frame_id, x and y; unexpected ${unexpected.join(", ")}`
      );
    }
    if (obj.frame_id !== void 0 && (typeof obj.frame_id !== "string" || obj.frame_id.length === 0)) {
      throw new Error("coordinate target frame_id, when provided, must be a non-empty string");
    }
    return {
      type: "coordinate",
      ...typeof obj.frame_id === "string" ? { frame_id: obj.frame_id } : {},
      x: coercePixel(obj.x, "target.x"),
      y: coercePixel(obj.y, "target.y")
    };
  }
  throw new Error('target.type must be "element" or "coordinate"');
}
var targetArg = z.unknown().superRefine((value, ctx) => {
  try {
    parseTarget(value);
  } catch (e) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: e instanceof Error ? e.message : String(e)
    });
  }
}).meta(targetArgJSONSchema);
var targetArgNullable = z.unknown().superRefine((value, ctx) => {
  if (value === void 0 || value === null) return;
  try {
    parseTarget(value);
  } catch (e) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: e instanceof Error ? e.message : String(e)
    });
  }
}).optional().meta(targetArgJSONSchema);
function elementTargetArg(opts) {
  const base = opts?.required ? targetArg : targetArgNullable;
  return base.superRefine((value, ctx) => {
    if (value === void 0 || value === null) return;
    let parsed;
    try {
      parsed = parseTarget(value);
    } catch {
      return;
    }
    if (parsed.type !== "element") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "target must be an element target"
      });
    }
  });
}
function coordinateTargetArg(opts) {
  const base = opts?.required ? targetArg : targetArgNullable;
  return base.superRefine((value, ctx) => {
    if (value === void 0 || value === null) return;
    let parsed;
    try {
      parsed = parseTarget(value);
    } catch {
      return;
    }
    if (parsed.type !== "coordinate") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "target must be a coordinate target"
      });
    }
  });
}
function boundsCenter(bounds) {
  const [x, y, w, h] = bounds;
  return { x: x + Math.floor(w / 2), y: y + Math.floor(h / 2) };
}
function normalizeTitle(title) {
  if (!title) return "";
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}
function normalizeValue(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}
var HEAL_MAX_DISPLACEMENT_PX = 400;
function boundsNear(a, b, maxPx = HEAL_MAX_DISPLACEMENT_PX) {
  const ca = boundsCenter(a);
  const cb = boundsCenter(b);
  const dx = ca.x - cb.x;
  const dy = ca.y - cb.y;
  return Math.sqrt(dx * dx + dy * dy) <= maxPx;
}
function captureFingerprint(element, bundleId, surface) {
  return {
    role: element.role,
    title: normalizeTitle(element.title),
    value: normalizeValue(element.value),
    bounds: element.bounds,
    editable: element.editable,
    bundle_id: typeof bundleId === "string" ? bundleId : "",
    actual_window_id: surface?.actual_window_id ?? null,
    presentation_window_id: surface?.presentation_window_id ?? null
  };
}
function findFingerprintMatch(stored, candidates, options = {}) {
  if (!stored.title) {
    return null;
  }
  const valueSignal = stored.editable && stored.value.length > 0;
  const highNearnessWaived = options.singleWindowApp === true;
  const high = [];
  const medium = [];
  for (const el of candidates) {
    if (normalizeTitle(el.title) !== stored.title) continue;
    if (el.role !== stored.role) continue;
    const liveValueMatches2 = valueSignal && normalizeValue(el.value) === stored.value;
    if (liveValueMatches2) {
      high.push(el);
    } else {
      medium.push(el);
    }
  }
  const mediumNear = medium.filter((el) => boundsNear(el.bounds, stored.bounds));
  const highNear = highNearnessWaived ? high : high.filter((el) => boundsNear(el.bounds, stored.bounds));
  let match;
  if (highNear.length === 1) {
    match = highNear[0];
  } else if (highNear.length > 1) {
    return null;
  } else if (mediumNear.length === 1) {
    match = mediumNear[0];
  } else if (mediumNear.length > 1) {
    return null;
  } else {
    return null;
  }
  const liveValueMatches = valueSignal && normalizeValue(match.value) === stored.value;
  const criteria = liveValueMatches ? "role+title+value" : "role+title";
  const confidence = liveValueMatches ? "high" : "medium";
  return {
    reason: criteria === "role+title+value" ? "element fingerprint changed; re-resolved by role+title+value in a fresh capture (the original handle was gone or its identity changed)" : "element fingerprint changed; re-resolved by role+title in a fresh capture (the original handle was gone or its identity changed)",
    match_criteria: criteria,
    confidence,
    value_matched: liveValueMatches,
    native: match.native,
    bounds: match.bounds,
    value: match.value
  };
}
function findSameCaptureVisualMatchInRawElements(stored, storedNative, rawElements) {
  if (!Array.isArray(rawElements)) return null;
  const candidates = rawElements.map((entry) => normalizeCandidate(entry));
  if (storedNative) {
    const exactNative = candidates.filter(
      (candidate) => candidate.native === storedNative && candidate.role === stored.role
    );
    if (exactNative.length === 1) return exactNative[0];
    if (exactNative.length > 1) return null;
  }
  if (stored.title) return findFingerprintMatch(stored, candidates);
  const exactGeometry = candidates.filter(
    (candidate) => candidate.role === stored.role && candidate.bounds.every((value, index) => Math.abs(value - stored.bounds[index]) <= 0.5) && (stored.value.length === 0 || normalizeValue(candidate.value) === stored.value)
  );
  return exactGeometry.length === 1 ? exactGeometry[0] : null;
}
async function captureFreshElements(deps, appRef2) {
  let raw;
  try {
    raw = await callBroker(
      deps,
      "capture_app",
      {
        app_ref: appRef2 ?? {},
        include_screenshot: false,
        // Healing requires fresh native tokens. A delta/no_change reply strips
        // `elements`, making fingerprint matching impossible.
        force_full: true
      },
      { kind: "read", timeoutMs: 2e4 }
    );
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const elements = raw.elements;
  if (!Array.isArray(elements)) return null;
  const window2 = raw.window;
  const windowRecord = window2 && typeof window2 === "object" && !Array.isArray(window2) ? window2 : {};
  return {
    elements: elements.map((entry) => normalizeCandidate(entry)),
    actual_window_id: typeof windowRecord.actual_window_id === "number" ? windowRecord.actual_window_id : typeof windowRecord.window_id === "number" ? windowRecord.window_id : null,
    presentation_window_id: typeof windowRecord.presentation_window_id === "number" ? windowRecord.presentation_window_id : typeof windowRecord.window_id === "number" ? windowRecord.window_id : null
  };
}
function freshSurfaceMatches(stored, fresh) {
  const storedIsAttachedSurface = stored.actual_window_id !== null && stored.actual_window_id !== void 0 && stored.presentation_window_id !== null && stored.presentation_window_id !== void 0 && stored.actual_window_id !== stored.presentation_window_id;
  if (!storedIsAttachedSurface && fresh.actual_window_id === null && fresh.presentation_window_id === null) {
    return true;
  }
  return (stored.actual_window_id === null || stored.actual_window_id === void 0 || stored.actual_window_id === fresh.actual_window_id) && (stored.presentation_window_id === null || stored.presentation_window_id === void 0 || stored.presentation_window_id === fresh.presentation_window_id);
}
async function captureFreshFingerprintMatch(deps, ctx) {
  const fresh = await captureFreshElements(deps, ctx.appRef);
  if (!fresh || !freshSurfaceMatches(ctx.fingerprint, fresh)) return null;
  return findFingerprintMatch(ctx.fingerprint, fresh.elements);
}
function normalizeCandidate(entry) {
  if (!entry || typeof entry !== "object") {
    return BLANK_CANDIDATE;
  }
  const el = entry;
  const bounds = asBounds2(el.bounds);
  const actions = Array.isArray(el.actions) ? el.actions : [];
  return {
    role: typeof el.role === "string" ? el.role : "",
    kind: typeof el.kind === "string" ? el.kind : "",
    title: typeof el.title === "string" ? el.title : null,
    value: typeof el.value === "string" ? el.value : null,
    bounds,
    enabled: typeof el.enabled === "boolean" ? el.enabled : true,
    editable: typeof el.editable === "boolean" ? el.editable : false,
    actions,
    focused: typeof el.focused === "boolean" ? el.focused : false,
    pressable: typeof el.pressable === "boolean" ? el.pressable : actions.includes("AXPress"),
    has_menu: typeof el.has_menu === "boolean" ? el.has_menu : actions.includes("AXShowMenu"),
    native: typeof el.native === "string" ? el.native : "",
    owner_pid: typeof el.owner_pid === "number" ? el.owner_pid : null
  };
}
var BLANK_CANDIDATE = {
  role: "",
  kind: "",
  title: null,
  value: null,
  bounds: [0, 0, 0, 0],
  enabled: true,
  editable: false,
  actions: [],
  focused: false,
  pressable: false,
  has_menu: false,
  native: "",
  owner_pid: null
};
function asBounds2(value) {
  if (!Array.isArray(value) || value.length !== 4) return [0, 0, 0, 0];
  const nums = value.map(Number);
  if (!nums.every((n) => Number.isFinite(n))) return [0, 0, 0, 0];
  return nums;
}
var TargetResolveError = class extends Error {
  reason;
  stateId;
  constructor(reason, message, stateId) {
    super(message);
    this.name = "TargetResolveError";
    this.reason = reason;
    if (stateId !== void 0) this.stateId = stateId;
  }
};
function elementCenter(bounds) {
  const [x, y, w, h] = bounds;
  return { x: x + Math.floor(w / 2), y: y + Math.floor(h / 2) };
}
function visibleElementCenter(elementBounds, windowBounds) {
  const [ex, ey, ew, eh] = elementBounds;
  const [wx, wy, ww, wh] = windowBounds;
  if (ew <= 0 || eh <= 0) return void 0;
  if (ww <= 0 || wh <= 0) return elementCenter(elementBounds);
  const left = Math.max(ex, wx);
  const top = Math.max(ey, wy);
  const right = Math.min(ex + ew, wx + ww);
  const bottom = Math.min(ey + eh, wy + wh);
  if (right <= left || bottom <= top) return void 0;
  return elementCenter([left, top, right - left, bottom - top]);
}
function appRefFromState(state) {
  const app = state.app;
  const ref = {};
  if (app.bundle_id) ref.bundle_id = app.bundle_id;
  if (typeof app.pid === "number") ref.pid = app.pid;
  if (typeof app.window_id === "number") ref.window_id = app.window_id;
  if (app.name) ref.name = app.name;
  return ref;
}
function resolveElement(target, ctx) {
  if (ctx.session.isSuperseded(target.state_id)) {
    throw new TargetResolveError(
      "state_superseded",
      `element target state_id "${target.state_id}" was superseded by an action that may already have changed the app. Call get_app_state and use the returned fresh state_id; do not retry the previous action.`,
      target.state_id
    );
  }
  const state = ctx.session.get(target.state_id);
  if (!state) {
    throw new TargetResolveError(
      "state_expired",
      `element target state_id "${target.state_id}" is unknown or expired (it was evicted from the session cache or never observed). Call get_app_state again and re-pick the element target from the new state_id.`,
      target.state_id
    );
  }
  const element = state.elements[target.index];
  if (!element) {
    throw new TargetResolveError(
      "index_out_of_range",
      `element target index ${target.index} is out of range for state_id "${target.state_id}" (has ${state.elements.length} elements). Call get_app_state again and re-pick the element target from the new state_id.`,
      target.state_id
    );
  }
  return buildFromElement(element, state);
}
function buildFromElement(element, state) {
  recordTargetAppDisplayEvidence(state.app);
  const resolution = {
    app_ref: appRefFromState(state),
    isElement: true,
    kind: "element",
    observedValue: element.value
  };
  if (typeof element.native === "string" && element.native) {
    resolution.native = element.native;
  }
  const [, , bw, bh] = element.bounds;
  if (bw > 0 && bh > 0) {
    resolution.point = visibleElementCenter(element.bounds, state.window.bounds);
  }
  if (!resolution.point && !resolution.native) {
    throw new TargetResolveError(
      "element_no_native_no_bounds",
      `element has no native token and no on-screen bounds visible inside the observed window (element=${JSON.stringify(element.bounds)}, window=${JSON.stringify(state.window.bounds)}); call get_app_state again and pick a visible element.`,
      state.state_id
    );
  }
  resolution.fingerprint = captureFingerprint(element, state.app.bundle_id, {
    actual_window_id: state.window.actual_window_id ?? state.window.window_id,
    presentation_window_id: state.window.presentation_window_id ?? state.window.window_id
  });
  return resolution;
}
function resolveCoordinate(target, ctx, bindingKind) {
  try {
    const { frame_id, point } = resolveFramePixelTarget(target, {
      frame_registry: ctx.session.frameRegistry,
      binding_kind: bindingKind
    });
    const frame = ctx.session.frameRegistry.get(frame_id);
    if (frame) recordTargetAppDisplayEvidence(frame.app);
    const appRef2 = frame ? {
      ...frame.app.bundle_id ? { bundle_id: frame.app.bundle_id } : {},
      ...frame.app.pid !== null ? { pid: frame.app.pid } : {},
      ...frame.window.window_id !== null ? { window_id: frame.window.window_id } : {}
    } : {};
    const app_ref = Object.keys(appRef2).length > 0 ? appRef2 : null;
    return { point, app_ref, isElement: false, kind: "coordinate" };
  } catch (error51) {
    throw new TargetResolveError(
      "frame_reference_invalid",
      error51 instanceof Error ? error51.message : String(error51)
    );
  }
}
function resolveTarget(target, ctx) {
  const originalBindingKind = frameBindingKind(target);
  const parsed = parseTarget(target);
  if (parsed.type === "element") {
    return resolveElement(parsed, ctx);
  }
  const bindingKind = target && typeof target === "object" && originalBindingKind === "implicit" && typeof target.frame_id === "string" ? originalBindingKind : frameBindingKind(parsed);
  return resolveCoordinate(parsed, ctx, bindingKind);
}
function displayTopologyFingerprint(displays) {
  return [...displays].sort((left, right) => left.id - right.id).map(
    ({ id, bounds, main: main22, scale_factor }) => `${id}:${bounds.join(",")}:${main22 ? 1 : 0}:${scale_factor}`
  ).join("|");
}
function parseDisplay(value) {
  if (!value || typeof value !== "object") return null;
  const index = value.index;
  const id = value.id;
  const bounds = value.bounds;
  const scaleFactor = value.scale_factor;
  if (!Number.isInteger(index) || index < 1) return null;
  if (!Number.isInteger(id)) return null;
  if (typeof scaleFactor !== "number" || !Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    return null;
  }
  if (!Array.isArray(bounds) || bounds.length !== 4) return null;
  const [x, y, width, height] = bounds;
  if (![x, y, width, height].every((part) => typeof part === "number" && Number.isFinite(part)) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    index,
    id,
    bounds: [x, y, width, height],
    main: value.main === true,
    scale_factor: scaleFactor
  };
}
function parseTopology(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const displays = value.map(parseDisplay);
  return displays.every((display) => display !== null) ? displays : null;
}
function capturedDisplay(selected, topology) {
  return {
    index: selected.index,
    id: selected.id,
    bounds: selected.bounds,
    topology_fingerprint: displayTopologyFingerprint(topology)
  };
}
async function resolveCapturedDisplay(_deps, reply) {
  if (reply.coordinate_contract !== "frame_pixel_projection_v1") {
    throw new Error(
      "screenshot: Helper does not support the atomic frame-pixel coordinate contract; upgrade/restart ZCode Computer Use before retrying."
    );
  }
  const directTopology = parseTopology(reply.display_topology);
  const direct = parseDisplay(reply.display);
  if (!direct || !directTopology) {
    throw new Error(
      "screenshot: Helper returned an image without atomic display provenance; upgrade/restart ZCode Computer Use before retrying."
    );
  }
  const matching = directTopology.filter(
    (candidate) => candidate.id === direct.id && candidate.index === direct.index && candidate.scale_factor === direct.scale_factor && candidate.bounds.every((part, index) => part === direct.bounds[index])
  );
  if (matching.length !== 1) {
    throw new Error(
      "screenshot: selected display does not match its atomic topology snapshot; capture a new screenshot before acting."
    );
  }
  return capturedDisplay(matching[0], directTopology);
}
function roundHalfToEven(n) {
  const floor = Math.floor(n);
  const diff = n - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}
var MAX_EDGE = 1280;
function computeAgentSize(w, h, maxEdge = MAX_EDGE) {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w, h };
  const scale = maxEdge / longest;
  return {
    w: Math.max(1, roundHalfToEven(w * scale)),
    h: Math.max(1, roundHalfToEven(h * scale))
  };
}
async function resizeLanczos(input, w, h) {
  const sharp = await loadSharp();
  return input.resize(w, h, {
    kernel: sharp.kernel.lanczos3,
    fit: "fill",
    // exact w×h
    withoutEnlargement: true,
    fastShrinkOnLoad: false
  });
}
var AGENT_B64_BUDGET = 190 * 1024;
var MIN_QUALITY = 40;
var QUALITY_STEP = 15;
var SHRINK_FACTOR = 0.8;
var SHRINK_MIN_EDGE = 320;
function b64Len(byteLen) {
  return Math.floor((byteLen + 2) / 3) * 4;
}
var JFIF_APP0 = Buffer.from("ffe000104a46494600010100000100010000", "hex");
function injectJfifApp0(jpeg) {
  if (jpeg.length < 2 || jpeg[0] !== 255 || jpeg[1] !== 216) return jpeg;
  if (jpeg.length >= 4 && jpeg[2] === 255 && jpeg[3] === 224) return jpeg;
  return Buffer.concat([jpeg.subarray(0, 2), JFIF_APP0, jpeg.subarray(2)]);
}
async function encodeJpegFromSharp(img, quality) {
  const raw = await img.clone().jpeg({
    quality,
    chromaSubsampling: "4:2:0",
    mozjpeg: false,
    optimiseCoding: false,
    // Pillow/libjpeg default is optimize_coding=FALSE
    progressive: false,
    trellisQuantisation: false,
    overshootDeringing: false,
    optimiseScans: false,
    force: true
  }).toBuffer();
  return injectJfifApp0(raw);
}
async function encodeUnderBudget(inputRgb, inputW, inputH, quality, maxB64) {
  const data = await encodeJpegFromSharp(inputRgb, quality);
  const shrinkTrail = [];
  if (maxB64 === null || b64Len(data.length) <= maxB64) {
    return {
      bytes: data,
      finalQuality: quality,
      finalWidth: inputW,
      finalHeight: inputH,
      shrinkTrail
    };
  }
  let q = quality;
  let currentData = data;
  while (b64Len(currentData.length) > maxB64 && q > MIN_QUALITY) {
    q = Math.max(MIN_QUALITY, q - QUALITY_STEP);
    currentData = await encodeJpegFromSharp(inputRgb, q);
  }
  let work = inputRgb;
  let w = inputW;
  let h = inputH;
  while (b64Len(currentData.length) > maxB64 && Math.max(w, h) > SHRINK_MIN_EDGE) {
    w = Math.max(1, Math.floor(w * SHRINK_FACTOR));
    h = Math.max(1, Math.floor(h * SHRINK_FACTOR));
    work = await resizeLanczos(work, w, h);
    shrinkTrail.push([w, h]);
    currentData = await encodeJpegFromSharp(work, q);
  }
  return {
    bytes: currentData,
    finalQuality: q,
    finalWidth: w,
    finalHeight: h,
    shrinkTrail
  };
}
var NUM_INT_BOOL_MSG = "expected a number, not a boolean";
var NUM_INT_STRING_MSG = "expected a JSON number, not a string";
var NUM_INT_INT_MSG = "expected an integer";
var numInt = z.unknown().superRefine((v, ctx) => {
  if (typeof v === "boolean") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: NUM_INT_BOOL_MSG });
    return;
  }
  if (typeof v === "string") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: NUM_INT_STRING_MSG });
    return;
  }
  if (typeof v !== "number" || Number.isNaN(v) || !Number.isInteger(v)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: NUM_INT_INT_MSG });
  }
});
z.globalRegistry.add(numInt, { type: "integer" });
var FINITE_BOOL_MSG = "expected a number, not a boolean";
var FINITE_STRING_MSG = "expected a JSON number, not a string";
var FINITE_MSG = "expected a finite number";
var finiteFloat = z.unknown().superRefine((v, ctx) => {
  if (typeof v === "boolean") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: FINITE_BOOL_MSG });
    return;
  }
  if (typeof v === "string") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: FINITE_STRING_MSG });
    return;
  }
  if (typeof v !== "number" || !Number.isFinite(v)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: FINITE_MSG });
  }
});
z.globalRegistry.add(finiteFloat, { type: "number" });
var SCROLL_AMOUNT_MAX = 100;
var SCROLL_AMOUNT_MIN = 0;
var KEY_REPEAT_MAX = 100;
var KEY_REPEAT_MIN = 1;
var CAPTURE_APP_TIMEOUT_MS = 2e4;
var NegativeDurationError = class extends Error {
  constructor(field) {
    super(`${field} must be >= 0`);
    this.field = field;
    this.name = "NegativeDurationError";
  }
};
var InvalidTextRangeError = class extends Error {
  constructor(reason) {
    super(
      reason === "not_array_of_2" ? "text_range must be a 2-element array [start, length]" : "text_range start and length must be >= 0"
    );
    this.reason = reason;
    this.name = "InvalidTextRangeError";
  }
};
function boundDuration(duration3, field) {
  if (duration3 < 0) {
    throw new NegativeDurationError(field);
  }
  if (duration3 > 30) {
    return { value: 30, clamped: true, requested: duration3 };
  }
  return { value: duration3, clamped: false };
}
function clampScrollAmount(scrollAmount) {
  if (scrollAmount < SCROLL_AMOUNT_MIN) {
    return { value: SCROLL_AMOUNT_MIN, clamped: true, requested: scrollAmount };
  }
  if (scrollAmount > SCROLL_AMOUNT_MAX) {
    return { value: SCROLL_AMOUNT_MAX, clamped: true, requested: scrollAmount };
  }
  return { value: scrollAmount, clamped: false };
}
function clampKeyRepeat(repeat) {
  if (repeat < KEY_REPEAT_MIN) {
    return { value: KEY_REPEAT_MIN, clamped: true, requested: repeat };
  }
  if (repeat > KEY_REPEAT_MAX) {
    return { value: KEY_REPEAT_MAX, clamped: true, requested: repeat };
  }
  return { value: repeat, clamped: false };
}
function validateTextRange(textRange) {
  if (textRange === void 0 || textRange === null) return null;
  if (!Array.isArray(textRange) || textRange.length !== 2) {
    throw new InvalidTextRangeError("not_array_of_2");
  }
  const [start, length] = textRange;
  if (typeof start !== "number" || typeof length !== "number" || !Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0) {
    throw new InvalidTextRangeError("negative");
  }
  return [start, length];
}
function waitNote(bounded, requested) {
  if (requested === void 0 || bounded === requested) {
    return `Waited ${bounded}s. Re-observe with get_app_state.`;
  }
  return `Waited ${bounded}s (requested ${requested}, clamped to 0..30). Re-observe with get_app_state.`;
}
function scrollNote(applied, requested) {
  if (requested === void 0 || applied === requested) {
    return `Scrolled ${applied}.`;
  }
  return `Scrolled ${applied} (requested ${requested}, clamped to 0..100).`;
}
var strategyEnum = z.enum(["auto", "a11y", "event"]);
var returnStateEnum = z.enum(["compact", "full", "none"]);
var scrollDirectionEnum = z.enum(["up", "down", "left", "right"]);
function stringifiedJsonArray(schema) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return value;
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : value;
    } catch {
      return value;
    }
  }, schema);
}
var applicationName = z.string().describe(
  'For an app that is not running, copy the user-provided name character-for-character, including script, case, spaces, punctuation, and suffixes such as app. For example, use {"name":"\u7F51\u6613\u4E91\u97F3\u4E50app"}, not {"name":"\u7F51\u6613\u4E91\u97F3\u4E50"}; use {"name":"\u65E5\u5386"}, not {"name":"Calendar"}. Do not translate, localize, normalize, shorten, or remove a suffix.'
);
var sharedAppProperties = {
  bundle_id: z.string().optional(),
  name: applicationName.optional(),
  pid: z.number().int().optional(),
  window_id: z.number().int().positive().optional().describe(
    "Only copy a fresh actual_window_id from an observed macOS open/save panel. Omit for ordinary launch or activation; never guess a placeholder such as 1."
  ),
  url: z.string().optional(),
  urls: stringifiedJsonArray(z.array(z.string())).optional()
};
var bundleBranch = z.object({
  ...sharedAppProperties,
  bundle_id: z.string()
}).strict();
var nameBranch = z.object({
  ...sharedAppProperties,
  name: applicationName
}).strict();
var pidBranch = z.object({
  ...sharedAppProperties,
  pid: z.number().int()
}).strict();
var openApplicationAppArg = z.preprocess(
  (value) => unwrapStringifiedObject(value),
  z.union([bundleBranch, nameBranch, pidBranch])
);
var listAppsSchema = z.object({}).strict();
var openApplicationSchema = z.object({
  app: openApplicationAppArg,
  activate: z.boolean().default(false),
  new_instance: z.boolean().default(false).describe(
    "macOS only: launch a separate process and verify its fresh pid. Use for an isolated scratch app when an existing instance is blocked; do not combine with app.pid."
  )
}).strict();
var listWindowsSchema = z.object({ app_ref: appRef }).strict();
var getAppStateSchema = z.object({
  app_ref: appRef,
  detail: z.enum(["compact", "full"]).default("compact"),
  include_screenshot: z.boolean().default(false)
}).strict();
var screenshotSchema = z.object({}).strict();
var zoomSchema = z.object({
  frame_id: z.string().trim().min(1).optional().describe(
    "Optional explicit source frame for backward compatibility; omit it to crop the latest actionable raster in this transport."
  ),
  region: stringifiedJsonArray(z.array(numInt).length(4)).nullish().describe(
    "Crop bounds [x0,y0,x1,y1] in the latest delivered raster (or the optional explicit frame_id). Do not pass with target."
  ),
  target: elementTargetArg({ required: false }).describe(
    "Element target from get_app_state. Do not also pass frame_id or region."
  )
}).strict().superRefine((value, ctx) => {
  if (value.target != null && value.frame_id) {
    ctx.addIssue({
      code: "custom",
      path: ["frame_id"],
      message: "zoom target mode derives its source from state_id; omit frame_id"
    });
  }
});
var listDisplaysSchema = z.object({}).strict();
var switchDisplaySchema = z.object({ index: numInt }).strict();
var cursorPositionSchema = z.object({}).strict();
var clickShape = {
  target: targetArg,
  modifiers: z.string().trim().default(""),
  strategy: strategyEnum.default("auto"),
  return_state: returnStateEnum.default("none"),
  app_ref: appRefNullable
};
var leftClickSchema = z.object(clickShape).strict();
var doubleClickSchema = z.object(clickShape).strict();
var tripleClickSchema = z.object(clickShape).strict();
var rightClickSchema = z.object(clickShape).strict();
var middleClickSchema = z.object(clickShape).strict();
var scrollSchema = z.object({
  target: targetArg,
  scroll_direction: scrollDirectionEnum,
  scroll_amount: numInt,
  strategy: strategyEnum.default("auto"),
  return_state: returnStateEnum.default("none"),
  app_ref: appRefNullable
}).strict();
var leftClickDragSchema = z.object({
  from_target: targetArg,
  to: targetArg,
  modifiers: z.string().trim().default(""),
  return_state: returnStateEnum.default("none"),
  app_ref: appRefNullable
}).strict();
var mouseMoveSchema = z.object({
  coordinate: coordinateTargetArg({ required: true }),
  app_ref: appRefNullable,
  return_state: returnStateEnum.default("none")
}).strict();
var leftMouseDownSchema = z.object({
  target: targetArg,
  app_ref: appRefNullable,
  return_state: returnStateEnum.default("none")
}).strict();
var leftMouseUpSchema = z.object({
  return_state: returnStateEnum.default("none")
}).strict();
var PUBLIC_KEY_TOKENS = /* @__PURE__ */ new Set([
  ..."abcdefghijklmnopqrstuvwxyz0123456789".split(""),
  "=",
  "*",
  "-",
  "]",
  "[",
  "'",
  ";",
  "\\",
  ",",
  "/",
  ".",
  "`",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "esc",
  "escape",
  "cmd",
  "command",
  "meta",
  "super",
  "win",
  "shift",
  "capslock",
  "alt",
  "opt",
  "option",
  "ctrl",
  "control",
  "help",
  "home",
  "pageup",
  "forwarddelete",
  "end",
  "pagedown",
  "left",
  "right",
  "down",
  "up",
  ...Array.from({ length: 16 }, (_, index) => `f${index + 1}`)
]);
function findUnsupportedKeyToken(text) {
  const tokens = text.split("+").map((token) => token.trim().toLowerCase()).filter((token) => token && token !== "none");
  return tokens.find((token) => !PUBLIC_KEY_TOKENS.has(token)) ?? null;
}
var typeSchema = z.object({
  text: z.string(),
  // Coordinate targets are accepted and routed through the a11y hit-test
  // (element_at_point) before actuation — see target-utils.resolveCoordinateToNative.
  target: targetArgNullable,
  app_ref: appRefNullable,
  strategy: strategyEnum.default("auto"),
  return_state: returnStateEnum.default("none")
}).strict();
var setValueSchema = z.object({
  // Coordinate targets are hit-tested to their owning element first.
  target: targetArg,
  value: z.string(),
  strategy: strategyEnum.default("auto"),
  return_state: returnStateEnum.default("none")
}).strict();
var selectTextSchema = z.object({
  // Coordinate targets are hit-tested to their owning element first.
  target: targetArg,
  text_range: stringifiedJsonArray(z.array(numInt).length(2)).nullish(),
  return_state: returnStateEnum.default("none")
}).strict();
var keySchema = z.object({
  text: z.string(),
  repeat: numInt.nullish(),
  app_ref: appRefNullable,
  strategy: strategyEnum.default("auto"),
  return_state: returnStateEnum.default("none")
}).strict();
var holdKeySchema = z.object({
  text: z.string(),
  duration: finiteFloat,
  app_ref: appRefNullable,
  strategy: strategyEnum.default("auto"),
  return_state: returnStateEnum.default("none")
}).strict();
var performActionSchema = z.object({
  // Coordinate targets are accepted and routed through the a11y hit-test
  // (element_at_point) before actuation; non-element/no-token points are
  // refused at runtime with a soft error.
  target: targetArg,
  action: z.string(),
  return_state: returnStateEnum.default("none")
}).strict();
var requestAccessSchema = z.object({
  capabilities: stringifiedJsonArray(z.array(z.string())).nullish()
}).strict();
var stopComputerControlSchema = z.object({
  reason: z.string().nullish()
}).strict();
var waitSchema = z.object({
  duration: finiteFloat
}).strict();
var readClipboardSchema = z.object({}).strict();
var writeClipboardSchema = z.object({
  text: z.string()
}).strict();
var DEFAULT_JPEG_QUALITY = 80;
var DEFAULT_MAX_EDGE = 1568;
var ZOOM_ERR_BOTH = "zoom: pass either region or target, not both.";
var ZOOM_ERR_NEITHER = 'zoom: provide a region [x0,y0,x1,y1] or a target {"type":"element","state_id":"...","index":N}.';
function composeSourceCrop(parent, crop) {
  const sourceWidth = parent.source.crop.right - parent.source.crop.left;
  const sourceHeight = parent.source.crop.bottom - parent.source.crop.top;
  return {
    left: parent.source.crop.left + crop.left / parent.delivered.width * sourceWidth,
    top: parent.source.crop.top + crop.top / parent.delivered.height * sourceHeight,
    right: parent.source.crop.left + crop.right / parent.delivered.width * sourceWidth,
    bottom: parent.source.crop.top + crop.bottom / parent.delivered.height * sourceHeight
  };
}
async function composeZoom(deps, args, options) {
  const session = options?.session ?? getDefaultSession();
  let sourceFrame = null;
  let appRef2 = null;
  let cropScreenBounds = null;
  let targetFingerprint = null;
  let targetNative = null;
  if (args.target) {
    if (args.region) throw new Error(ZOOM_ERR_BOTH);
    const resolved = resolveTarget(args.target, { session });
    if (!resolved.isElement) {
      throw new Error("zoom target must be an element: {type:element,state_id,index}.");
    }
    appRef2 = resolved.app_ref;
    if (!resolved.point) {
      throw new Error(
        "zoom target element has no on-screen bounds; call get_app_state again and pick a visible element."
      );
    }
    targetFingerprint = resolved.fingerprint ?? null;
    targetNative = resolved.native ?? null;
    if (!targetFingerprint) {
      throw new Error("zoom target element has no stable fingerprint; call get_app_state again.");
    }
  } else if (args.region) {
    const [x0, y0, x1, y1] = args.region;
    if (x1 <= x0 || y1 <= y0) {
      throw new Error(
        `zoom: region must have positive width and height with x1 > x0 and y1 > y0; received ${JSON.stringify(args.region)}.`
      );
    }
    cropScreenBounds = [x0, y0, x1, y1];
    sourceFrame = args.frame_id ? session.frameRegistry.resolveForAction(args.frame_id) : session.frameRegistry.resolveLatestForAction();
    if (x0 < 0 || y0 < 0 || x1 > sourceFrame.delivered.width || y1 > sourceFrame.delivered.height) {
      throw new RangeError(
        `zoom: region ${JSON.stringify(args.region)} is outside latest delivered raster ${sourceFrame.delivered.width}x${sourceFrame.delivered.height}`
      );
    }
    recordTargetAppDisplayEvidence(sourceFrame.app);
    if (!sourceFrame.delivered.data) {
      throw new Error(
        `zoom: frame_id "${sourceFrame.frame_id}" has no retained final raster; capture a new image, then resubmit x/y chosen from the new raster; frame binding is internal.`
      );
    }
  } else {
    throw new Error(ZOOM_ERR_NEITHER);
  }
  const retainedFrame = sourceFrame;
  let screenshotData;
  let screenshotFormat;
  let captureAppWindowBounds = null;
  let captureAppRaw = null;
  if (retainedFrame) {
    screenshotData = retainedFrame.delivered.data;
    screenshotFormat = retainedFrame.delivered.format;
  } else {
    const raw = await callBroker(
      deps,
      "capture_app",
      {
        app_ref: appRef2,
        include_screenshot: true,
        // A visual crop needs both the current window image and geometry.
        // Bypass incremental no_change replies, which are tree optimizations
        // and must not suppress an explicitly requested image.
        force_full: true
      },
      { kind: "read", timeoutMs: CAPTURE_APP_TIMEOUT_MS }
    );
    if (!raw || !raw.screenshot?.data) {
      throw new Error(
        "zoom: capture_app returned no screenshot. Confirm the app_ref and that Screen Recording permission is granted."
      );
    }
    screenshotData = raw.screenshot.data;
    captureAppRaw = raw;
    screenshotFormat = raw.screenshot.format ?? "jpeg";
    const liveMatch = targetFingerprint ? findSameCaptureVisualMatchInRawElements(targetFingerprint, targetNative, raw.elements) : null;
    if (!liveMatch) {
      throw new Error(
        "zoom target is stale or ambiguous in the fresh capture; call get_app_state again."
      );
    }
    const [ex, ey, ew, eh] = liveMatch.bounds;
    if (ew <= 0 || eh <= 0) {
      throw new Error(
        "zoom target has no visible bounds in the fresh capture; call get_app_state again."
      );
    }
    cropScreenBounds = [ex, ey, ex + ew, ey + eh];
    const pointer = raw.pointer;
    if (raw.coordinate_contract !== "frame_pixel_projection_v1" || !pointer || ![pointer.x, pointer.y, pointer.width, pointer.height].every(
      (part) => typeof part === "number" && Number.isFinite(part)
    ) || (pointer.width ?? 0) <= 0 || (pointer.height ?? 0) <= 0) {
      throw new Error(
        "zoom: capture_app returned no same-capture raster geometry; refusing to mint an actionable pixel frame."
      );
    }
    captureAppWindowBounds = [pointer.x, pointer.y, pointer.width, pointer.height];
  }
  const imageSize = await probeScreenshotSize({
    format: screenshotFormat,
    data: screenshotData
  });
  if (!imageSize) {
    throw new Error(
      retainedFrame ? "zoom: retained source frame could not be decoded." : "zoom: capture_app screenshot could not be decoded."
    );
  }
  const { width: imgW, height: imgH } = imageSize;
  if (retainedFrame && (imgW !== retainedFrame.delivered.width || imgH !== retainedFrame.delivered.height)) {
    throw new Error(
      `zoom: retained raster decoded dimensions ${imgW}x${imgH} do not match frame descriptor ${retainedFrame.delivered.width}x${retainedFrame.delivered.height}.`
    );
  }
  const windowBounds = captureAppWindowBounds ?? [0, 0, imgW, imgH];
  const [wx, wy, ww, wh] = windowBounds;
  if (ww <= 0 || wh <= 0) {
    throw new Error(
      `zoom: target window has zero-size bounds ${JSON.stringify(windowBounds)}; no usable screenshot to crop.`
    );
  }
  if (!cropScreenBounds) {
    throw new Error("zoom: internal crop geometry is unavailable.");
  }
  const [sx0, sy0, sx1, sy1] = cropScreenBounds;
  const scaleX = retainedFrame ? 1 : imgW / ww;
  const scaleY = retainedFrame ? 1 : imgH / wh;
  let px0 = Math.floor(retainedFrame ? sx0 : (sx0 - wx) * scaleX);
  let py0 = Math.floor(retainedFrame ? sy0 : (sy0 - wy) * scaleY);
  let px1 = Math.ceil(retainedFrame ? sx1 : (sx1 - wx) * scaleX);
  let py1 = Math.ceil(retainedFrame ? sy1 : (sy1 - wy) * scaleY);
  if (px1 <= 0 || py1 <= 0 || px0 >= imgW || py0 >= imgH) {
    throw new Error(
      `zoom: requested region ${JSON.stringify(cropScreenBounds)} does not intersect the captured image bounds ${JSON.stringify(windowBounds)}.`
    );
  }
  const clamped = px0 < 0 || py0 < 0 || px1 > imgW || py1 > imgH;
  px0 = Math.max(0, Math.min(px0, imgW - 1));
  py0 = Math.max(0, Math.min(py0, imgH - 1));
  px1 = Math.max(px0 + 1, Math.min(px1, imgW));
  py1 = Math.max(py0 + 1, Math.min(py1, imgH));
  const cropWidth = px1 - px0;
  const cropHeight = py1 - py0;
  const maxEdge = Math.max(cropWidth, cropHeight);
  const sharp = await loadSharp();
  let pipeline = sharp(Buffer.from(screenshotData, "base64")).extract({
    left: px0,
    top: py0,
    width: cropWidth,
    height: cropHeight
  });
  if (maxEdge > DEFAULT_MAX_EDGE) {
    const scale = DEFAULT_MAX_EDGE / maxEdge;
    pipeline = pipeline.resize({
      width: Math.max(1, Math.round(cropWidth * scale)),
      height: Math.max(1, Math.round(cropHeight * scale)),
      fit: "fill"
    });
  }
  const preBudgetWidth = maxEdge > DEFAULT_MAX_EDGE ? Math.max(1, Math.round(cropWidth * (DEFAULT_MAX_EDGE / maxEdge))) : cropWidth;
  const preBudgetHeight = maxEdge > DEFAULT_MAX_EDGE ? Math.max(1, Math.round(cropHeight * (DEFAULT_MAX_EDGE / maxEdge))) : cropHeight;
  const encoded = await encodeUnderBudget(
    pipeline,
    preBudgetWidth,
    preBudgetHeight,
    DEFAULT_JPEG_QUALITY,
    AGENT_B64_BUDGET
  );
  const image = {
    data: encoded.bytes.toString("base64"),
    format: "jpeg"
  };
  const framePointer = retainedFrame ? {
    width: retainedFrame.pointer.width,
    height: retainedFrame.pointer.height
  } : {
    width: captureAppRaw?.pointer?.width ?? 0,
    height: captureAppRaw?.pointer?.height ?? 0
  };
  const frameOrigin = retainedFrame ? {
    x: retainedFrame.pointer.x,
    y: retainedFrame.pointer.y
  } : {
    x: captureAppRaw?.pointer?.x ?? 0,
    y: captureAppRaw?.pointer?.y ?? 0
  };
  const capturedApp = retainedFrame ? retainedFrame.app : captureAppRaw?.app;
  const windowGeometryVerified = retainedFrame !== null || captureAppRaw?.coordinate_contract === "frame_pixel_projection_v1" && captureAppRaw.screenshot_blank !== true && captureAppRaw.pointer !== null && captureAppRaw.pointer !== void 0 && captureAppRaw.pointer.unit !== void 0 && framePointer.width > 0 && framePointer.height > 0 && typeof captureAppRaw.display?.topology_fingerprint === "string";
  const frameDescriptor = session.issueFrame({
    delivered: {
      width: encoded.finalWidth,
      height: encoded.finalHeight,
      format: "jpeg",
      digest: `sha256:${createHash("sha256").update(encoded.bytes).digest("hex")}`,
      data: encoded.bytes.toString("base64")
    },
    source: {
      width: retainedFrame ? retainedFrame.source.width : imgW,
      height: retainedFrame ? retainedFrame.source.height : imgH,
      crop: retainedFrame ? composeSourceCrop(retainedFrame, {
        left: px0,
        top: py0,
        right: px1,
        bottom: py1
      }) : { left: px0, top: py0, right: px1, bottom: py1 }
    },
    pointer: {
      x: frameOrigin.x,
      y: frameOrigin.y,
      width: framePointer.width,
      height: framePointer.height,
      unit: retainedFrame ? retainedFrame.pointer.unit : captureAppRaw?.pointer?.unit ?? "point"
    },
    // Bug 根因：zoom 子 frame 曾只复制 PID/bundle id，导致后续 coordinate 动作
    // 虽能读取 locator，却丢失 displayName/AUMID 等展示身份。派生 frame 必须完整
    // 继承父 frame；target 模式则保留 Helper capture_app 返回的同等字段。
    app: retainedFrame ? retainedFrame.app : {
      bundle_id: typeof capturedApp?.bundle_id === "string" ? capturedApp.bundle_id : null,
      pid: typeof capturedApp?.pid === "number" ? capturedApp.pid : null,
      name: typeof capturedApp?.name === "string" ? capturedApp.name : null,
      aumid: typeof capturedApp?.aumid === "string" ? capturedApp.aumid : null,
      executable_path: typeof capturedApp?.executable_path === "string" ? capturedApp.executable_path : null,
      icon_png: typeof capturedApp?.icon_png === "string" ? capturedApp.icon_png : null
    },
    window: {
      window_id: retainedFrame ? retainedFrame.window.window_id : typeof captureAppRaw?.window?.window_id === "number" ? captureAppRaw.window.window_id : null,
      // Keep the AX identity bounds separate from pointer projection geometry.
      // The native action gate uses these bounds only for stale-window checks.
      bounds: (retainedFrame ? retainedFrame.window.bounds : captureAppRaw?.window?.bounds) ?? [
        frameOrigin.x,
        frameOrigin.y,
        framePointer.width,
        framePointer.height
      ]
    },
    display: {
      display_id: retainedFrame ? retainedFrame.display.display_id : captureAppRaw?.display?.id ?? null,
      topology_fingerprint: retainedFrame ? retainedFrame.display.topology_fingerprint : captureAppRaw?.display?.topology_fingerprint ?? "unverified",
      origin: frameOrigin
    },
    ...retainedFrame?.capture_windows !== void 0 ? { capture_windows: retainedFrame.capture_windows } : {},
    actionable: windowGeometryVerified,
    non_actionable_reason: windowGeometryVerified ? null : captureAppRaw?.screenshot_blank === true ? "screenshot_blank" : "capture_geometry_unverified"
  });
  const textBlocks = [];
  if (clamped) {
    textBlocks.push(
      "The crop was clipped to the captured window; part of the requested region or element was outside the window."
    );
  }
  return {
    image,
    image_ref: frameDescriptor.image_ref,
    text_blocks: textBlocks
  };
}
var APP_INSTRUCTIONS = [
  {
    app: "Slack",
    bundle_ids: ["com.tinyspeck.slackmacgap"],
    name_patterns: ["slack"],
    instructions: [
      "Use \u2318K to open the quick switcher and jump to a channel or DM \u2014 much faster than scrolling the sidebar.",
      "The message input is contenteditable; press Enter to send (Shift+Enter for a newline). There is no send button.",
      "Threads live in a side panel \u2014 open a thread with the message's thread reply action, not by clicking the timestamp.",
      "Upload files by dropping them in the input or \u2318U; do not hunt for a paperclip button."
    ]
  },
  {
    app: "Notion",
    bundle_ids: ["notion.id"],
    name_patterns: ["notion"],
    instructions: [
      "Block operations are slash-command driven \u2014 type '/' at the start of a block for create/transform menus.",
      "Drag blocks by their left handle (\u283F); clicking text enters edit mode and will not move the block.",
      "Use \u2318P / \u2318F for page navigation and in-page search; the sidebar search is slower and scopes differently.",
      "Set a checkbox / property by clicking the property cell directly, not the row."
    ]
  },
  {
    app: "Figma",
    bundle_ids: ["com.figma.Desktop"],
    name_patterns: ["figma"],
    instructions: [
      "Use V for the move tool and frames-first navigation \u2014 clicking the layers panel to scroll is slow.",
      "Zoom to selection with \u21E72, zoom to fit with \u21E71, zoom to 100% with \u21E70.",
      "Hold Space to pan; \u2318+scroll to zoom. Drag-with-trackpad only works inside the canvas frame.",
      "Text editing requires double-click into the text node; a single click selects the node."
    ]
  },
  {
    app: "VS Code",
    bundle_ids: ["com.microsoft.VSCode", "com.microsoft.VSCodeInsiders"],
    name_patterns: ["visual studio code", "vs code", "vscode", "code -"],
    instructions: [
      "\u2318P opens the file quick-open; \u2318\u21E7P opens the command palette. Prefer these over clicking menus or the explorer.",
      "The integrated terminal is focusable via \u2303`; terminal focus vs editor focus is a common click-miss source.",
      "Toggle a breakpoint by clicking in the editor gutter (left of the line number), not the line number itself.",
      "Save is \u2318S \u2014 there is no save button; the file tab's dot indicates unsaved changes."
    ]
  },
  {
    app: "Chrome",
    bundle_ids: ["com.google.Chrome", "com.google.Chrome.canary"],
    name_patterns: ["google chrome", "chrome"],
    instructions: [
      "Address bar is \u2318L \u2014 type a URL or search query there, not into a page search box.",
      "In-page find is \u2318F; navigate matches with \u2318G / \u2318\u21E7G. The page search box is not the address bar.",
      "New tab is \u2318T, close tab is \u2318W, reopen closed tab is \u2318\u21E7T. The tab strip's + button is a slower target.",
      "Form autofill suggestions are keyboard-navigable; Tab/Enter accepts. Clicking the suggestion often misses."
    ]
  },
  {
    app: "Terminal",
    bundle_ids: ["com.apple.Terminal", "com.googlecode.iterm2", "com.todesktop.230313mzl4w4u92"],
    name_patterns: ["terminal", "iterm", "warp", "alacritty", "kitty"],
    instructions: [
      "The shell is the only real input \u2014 type the command and press Enter. There is no Run button.",
      "Do not click-and-drag to select command output as a way to interact; selection is copy-only.",
      "Tab/Shift-Tab completes; \u2191/\u2193 recalls history. Use these before retyping.",
      "Interrupt a running command with \u2303C, not by closing the window."
    ]
  },
  {
    app: "Finder",
    bundle_ids: ["com.apple.finder"],
    name_patterns: ["finder"],
    instructions: [
      "Open a folder with \u2318O or \u2318\u2193; the folder name is not a button.",
      "\u2318\u21E7G opens 'Go to Folder' for a typed path \u2014 faster than navigating the sidebar.",
      "List/Column/Icon/Gallery view is \u23181/\u23182/\u23183/\u23184; do not hunt the toolbar icons.",
      "Rename is Enter (not F2 / double-click); committing is Enter again or click-elsewhere."
    ]
  },
  {
    app: "Numbers",
    bundle_ids: ["com.apple.iWork.Numbers"],
    name_patterns: ["numbers"],
    instructions: [
      "Edit a cell by selecting it and typing \u2014 do not double-click first; Numbers enters edit mode on first keystroke.",
      "Commit a cell edit with Enter or Tab; Esc cancels. Clicking elsewhere also commits but is slower.",
      "Insert a formula with '=' at the start of the cell; do not look for an insert-formula button in the toolbar.",
      "Drag a sheet's tab (bottom of the canvas) to reorder; the sidebar lists sheets for navigation, not drag."
    ]
  }
];
function norm(value) {
  return value.trim().toLowerCase();
}
function findAppInstruction(input) {
  if (!input) return null;
  const bundle = typeof input.bundle_id === "string" ? norm(input.bundle_id) : "";
  if (bundle) {
    for (const entry of APP_INSTRUCTIONS) {
      for (const id of entry.bundle_ids) {
        if (norm(id) === bundle) return entry;
      }
    }
  }
  const name = typeof input.name === "string" && input.name.trim() ? norm(input.name) : "";
  if (name) {
    for (const entry of APP_INSTRUCTIONS) {
      for (const pattern of entry.name_patterns) {
        if (name.includes(norm(pattern))) return entry;
      }
    }
  }
  const title = typeof input.window_title === "string" && input.window_title.trim() ? norm(input.window_title) : "";
  if (title) {
    for (const entry of APP_INSTRUCTIONS) {
      for (const pattern of entry.name_patterns) {
        if (title.includes(norm(pattern))) return entry;
      }
    }
  }
  return null;
}
function formatAppInstructions(input) {
  const entry = findAppInstruction(input);
  if (!entry) return null;
  return renderInstructionBlock(entry);
}
function renderInstructionBlock(entry) {
  const lines = entry.instructions.map((tip) => `- ${tip}`);
  return [
    `<app_specific_instructions app="${entry.app}">`,
    ...lines,
    "</app_specific_instructions>"
  ].join("\n");
}
var PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function stripPngIcc(png) {
  if (png.length < 8 || png.subarray(0, 8).compare(PNG_SIG) !== 0) {
    return png;
  }
  const out = [Buffer.from(PNG_SIG)];
  let p = 8;
  while (p + 8 <= png.length) {
    const len = png.readUInt32BE(p);
    const type = png.toString("ascii", p + 4, p + 8);
    const chunkEnd = p + 12 + len;
    if (chunkEnd > png.length) break;
    if (type !== "iCCP") {
      out.push(png.subarray(p, chunkEnd));
    }
    p = chunkEnd;
  }
  return Buffer.concat(out);
}
async function loadRgbaRawFromBuffer(png) {
  const stripped = stripPngIcc(png);
  const sharp = await loadSharp();
  const { data, info } = await sharp(stripped).ensureAlpha().toColorspace("srgb").raw({ depth: "uchar" }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}
function compositeAlphaOntoWhite(rgba) {
  if (rgba.channels !== 4) {
    throw new Error(`compositeAlphaOntoWhite: expected 4-channel RGBA, got ${rgba.channels}`);
  }
  const { width: W, height: H, data: src } = rgba;
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
    const a = src[i + 3];
    const inv = 255 - a;
    const base = 255 * inv + 127;
    for (let c = 0; c < 3; c++) {
      const v = src[i + c] * a + base;
      out[j + c] = Math.floor(v / 255);
    }
  }
  return { data: out, width: W, height: H, channels: 3 };
}
async function asRgbRawFromBuffer(png) {
  const rgba = await loadRgbaRawFromBuffer(png);
  if (rgba.channels === 3) return rgba;
  return compositeAlphaOntoWhite(rgba);
}
async function rgbRawToSharp(rgb) {
  const sharp = await loadSharp();
  return sharp(rgb.data, {
    raw: { width: rgb.width, height: rgb.height, channels: 3 }
  });
}
async function encodeScreenshotRaw(rgb, opts = {}) {
  const maxEdge = opts.maxEdge ?? MAX_EDGE;
  const quality = opts.quality ?? 75;
  const maxB64 = opts.maxAgentB64 ?? AGENT_B64_BUDGET;
  const W = rgb.width;
  const H = rgb.height;
  const originalBytes = await encodeJpegFromSharp(await rgbRawToSharp(rgb), quality);
  const { w: aw, h: ah } = computeAgentSize(W, H, maxEdge);
  let agentPipeline;
  let agentW;
  let agentH;
  if (aw === W && ah === H) {
    agentPipeline = await rgbRawToSharp(rgb);
    agentW = W;
    agentH = H;
  } else {
    agentPipeline = await resizeLanczos(await rgbRawToSharp(rgb), aw, ah);
    agentW = aw;
    agentH = ah;
  }
  const {
    bytes: agentBytes,
    finalQuality,
    finalWidth,
    finalHeight,
    shrinkTrail
  } = await encodeUnderBudget(agentPipeline, agentW, agentH, quality, maxB64);
  return {
    originalBytes,
    agentBytes,
    mediaFormat: "jpeg",
    geometry: {
      original: { width: W, height: H },
      agent: { width: finalWidth, height: finalHeight }
    },
    finalQuality,
    shrinkTrail
  };
}
async function encodeScreenshotFromPng(png, opts) {
  const rgb = await asRgbRawFromBuffer(png);
  return encodeScreenshotRaw(rgb, opts);
}
var FILE_URL_WINDOW_VERIFY_ATTEMPTS = 30;
function fileTarget(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "file:") return null;
  const encodedName = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!encodedName) return null;
  let filename;
  try {
    filename = decodeURIComponent(encodedName);
  } catch {
    filename = encodedName;
  }
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  return { filename, stem };
}
function windowIds(windows) {
  return new Set(
    windows.map((window2) => window2.window_id).filter((id) => typeof id === "number" && Number.isInteger(id))
  );
}
function titleMatches(title, target) {
  const normalized = title?.trim().toLocaleLowerCase();
  if (!normalized) return false;
  return target.titleCandidates.some(
    (candidate) => normalized === candidate.trim().toLocaleLowerCase()
  );
}
function distinguishableTargets(targets) {
  const normalize = (value) => value.trim().toLocaleLowerCase();
  const filenameOwners = /* @__PURE__ */ new Map();
  for (const [targetIndex, target] of targets.entries()) {
    const filename = normalize(target.filename);
    const ownerIndex = filenameOwners.get(filename);
    if (ownerIndex !== void 0) {
      throw new Error(
        `file URL window verification cannot distinguish duplicate filename ${JSON.stringify(filename)} for ${JSON.stringify(targets[ownerIndex].filename)} and ${JSON.stringify(target.filename)}; the requested files cannot be verified safely.`
      );
    }
    filenameOwners.set(filename, targetIndex);
  }
  const stemCounts = /* @__PURE__ */ new Map();
  for (const target of targets) {
    const stem = normalize(target.stem);
    stemCounts.set(stem, (stemCounts.get(stem) ?? 0) + 1);
  }
  return targets.map((target, targetIndex) => {
    const filename = normalize(target.filename);
    const stem = normalize(target.stem);
    const stemConflictsWithFilename = [...filenameOwners.entries()].some(
      ([candidate, ownerIndex]) => candidate === stem && ownerIndex !== targetIndex
    );
    const stemIsUnambiguous = stem !== filename && stemCounts.get(stem) === 1 && !stemConflictsWithFilename;
    return {
      ...target,
      titleCandidates: stemIsUnambiguous ? [target.filename, target.stem] : [target.filename]
    };
  });
}
function hasOneToOneWindowMatch(windows, baseline) {
  const targets = baseline.targets;
  const baselineWindowIds = baseline.windowIds;
  const candidateWindows = windows.filter(
    (window2) => typeof window2.window_id === "number" && Number.isInteger(window2.window_id)
  );
  const targetForWindow = /* @__PURE__ */ new Map();
  const assign = (targetIndex, visited) => {
    for (const window2 of candidateWindows) {
      const target = targets[targetIndex];
      const isFresh = !baselineWindowIds.has(window2.window_id);
      const baselineTitle = baseline.windowTitles?.get(window2.window_id);
      const existingWindowNavigated = baselineWindowIds.has(window2.window_id) && !titleMatches(baselineTitle, target) && titleMatches(window2.title, target);
      if (!isFresh && !existingWindowNavigated || visited.has(window2.window_id) || !titleMatches(window2.title, target)) {
        continue;
      }
      visited.add(window2.window_id);
      const previousTarget = targetForWindow.get(window2.window_id);
      if (previousTarget === void 0 || assign(previousTarget, visited)) {
        targetForWindow.set(window2.window_id, targetIndex);
        return true;
      }
    }
    return false;
  };
  return targets.every((_target, targetIndex) => assign(targetIndex, /* @__PURE__ */ new Set()));
}
async function captureFileUrlWindowBaseline(listWindows, urls) {
  if (!listWindows || !urls) return null;
  const parsedTargets = urls.map(fileTarget).filter((target) => target !== null);
  if (parsedTargets.length === 0) return null;
  const targets = distinguishableTargets(parsedTargets);
  try {
    const windows = await listWindows();
    if (!windows) return null;
    return {
      targets,
      windowIds: windowIds(windows),
      windowTitles: new Map(
        windows.filter(
          (window2) => typeof window2.window_id === "number" && Number.isInteger(window2.window_id)
        ).map((window2) => [window2.window_id, window2.title])
      )
    };
  } catch {
    return null;
  }
}
async function verifyFileUrlWindowEffect(listWindows, baseline, options = {}) {
  if (!baseline || !listWindows) return "unavailable";
  const attempts = options.attempts ?? FILE_URL_WINDOW_VERIFY_ATTEMPTS;
  const delay = options.delay ?? ((milliseconds) => new Promise((resolve22) => setTimeout(resolve22, milliseconds)));
  let lastWindows = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const windows = await listWindows();
    if (windows) {
      lastWindows = windows;
      if (hasOneToOneWindowMatch(windows, baseline)) {
        return "verified";
      }
    }
    if (attempt + 1 < attempts) await delay(100);
  }
  throw new Error(
    `the app process resolved, but the requested file URL did not produce a matching accessibility window. Requested files: ${baseline.targets.map((target) => target.filename).join(", ")}; before window_ids=${JSON.stringify([...baseline.windowIds])}; after window_ids=${JSON.stringify([...windowIds(lastWindows)])}.`
  );
}
var OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY = "zcode.cua/official-frame-integrity-v1";
function textBlock(text) {
  return { type: "text", text };
}
function imageBlock(data, format) {
  return { type: "image", data, mimeType: mimeTypeFor(format) };
}
function imageRefBlock(imageRef) {
  return textBlock(JSON.stringify({ image_ref: imageRef }));
}
function imageWithRef(imageRef, data, format) {
  if (imageRef.actionable !== true) {
    return [
      textBlock(
        "CUA raster withheld because its frame projection is not actionable. Capture a new frame before using pixel coordinates."
      )
    ];
  }
  return [imageBlock(data, format), imageRefBlock(imageRef)];
}
function withOfficialFrameIntegrity(result, imageRef, data, format, session) {
  const frame = session.frameRegistry.get(imageRef.frame_id);
  const mediaType = mimeTypeFor(format);
  const digest = `sha256:${createHash("sha256").update(Buffer.from(data, "base64")).digest("hex")}`;
  if (imageRef.actionable !== true || !frame || frame.image_ref.width !== imageRef.width || frame.image_ref.height !== imageRef.height || normalizeImageFormat(frame.delivered.format) !== normalizeImageFormat(format) || frame.delivered.digest !== digest) {
    return toolError(
      "CUA image rejected because its hidden frame-integrity metadata does not match the final raster. No raster authority was exposed; capture a new image and retry."
    );
  }
  return {
    ...result,
    _meta: {
      ...result._meta,
      [OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY]: {
        version: 1,
        frame_id: imageRef.frame_id,
        width: imageRef.width,
        height: imageRef.height,
        media_type: mediaType,
        sha256: digest.slice("sha256:".length)
      }
    }
  };
}
function mimeTypeFor(format) {
  return `image/${normalizeImageFormat(format)}`;
}
function normalizeImageFormat(format) {
  const lower = format.toLowerCase().replace(/^image\//u, "");
  return lower === "jpg" ? "jpeg" : lower;
}
function textResult(text) {
  return { content: [textBlock(text)] };
}
function toolError(text, details) {
  return details === void 0 ? { isError: true, content: [textBlock(text)] } : { isError: true, content: [textBlock(text)], structuredContent: { ...details } };
}
function toText(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
function mapAppStateResult(result) {
  if (typeof result === "string") return textResult(result);
  if (result === null || typeof result !== "object") return textResult(toText(result));
  const r = result;
  const unboundImageWarning = "unbound_image_suppressed: the Helper returned image bytes without an immutable image_ref/frame transform. Capture again with the current Helper; no image was delivered to the model.";
  if (Array.isArray(r.blocks)) {
    const hadImage = r.blocks.some((b) => b.type === "image");
    const content2 = r.blocks.filter((b) => b.type === "text").map((b) => textBlock(b.text));
    if (hadImage) content2.unshift(textBlock(unboundImageWarning));
    return { content: content2, ...hadImage ? { isError: true } : {} };
  }
  const content = [];
  if (r.image) content.push(textBlock(unboundImageWarning));
  content.push(textBlock(r.content ?? toText(r)));
  return { content, ...r.image ? { isError: true } : {} };
}
async function mapRawCaptureAppResult(result, detail, includeTree, options) {
  if (!result || typeof result !== "object") return null;
  const raw = result;
  const rawScreenshot = raw.screenshot;
  if (typeof rawScreenshot?.data === "string" && rawScreenshot.data) {
    try {
      const encoded = await encodeScreenshotFromPng(Buffer.from(rawScreenshot.data, "base64"), {
        quality: 75
      });
      raw.screenshot = {
        data: encoded.agentBytes.toString("base64"),
        format: encoded.mediaFormat
      };
    } catch {
    }
  }
  const session = options?.session ?? getDefaultSession();
  if (raw.snapshot_mode === "delta" || raw.snapshot_mode === "no_change") return null;
  if (!Array.isArray(raw.elements)) return null;
  if (typeof raw.app !== "object" || typeof raw.window !== "object") return null;
  const state = await ingestCaptureAppResult(raw, { session });
  noteObservation(raw, session);
  const content = [];
  let emittedFrame;
  const screenshot = raw.screenshot;
  const screenshotBlank = raw.screenshot_blank === true;
  if (!screenshotBlank && typeof screenshot?.data === "string" && screenshot.data) {
    if (state.image_ref) {
      const format = screenshot.format ?? "jpeg";
      content.push(...imageWithRef(state.image_ref, screenshot.data, format));
      if (state.image_ref.actionable) {
        emittedFrame = { imageRef: state.image_ref, data: screenshot.data, format };
      }
    }
  }
  if (screenshotBlank) {
    content.push(
      textBlock(
        "[screenshot_blank] The get_app_state screenshot is BLANK (transparent or near-black placeholder). The target window was most likely occluded, minimized, off-screen, or mid-render at capture time, so these pixels are unusable \u2014 do NOT read coordinates or content from this image. The blank raster and image_ref were withheld. Use the accessibility tree returned with this observation, or call open_application(activate=true) when foreground recovery is required, then call get_app_state again."
      )
    );
  }
  if (includeTree) {
    content.push(textBlock(formatAppStateTree(state, detail)));
    const appHint = formatAppInstructions({
      bundle_id: state.app.bundle_id,
      name: state.app.name,
      window_title: state.window.title
    });
    if (appHint) content.push(textBlock(appHint));
  }
  if (screenshotBlank && typeof screenshot?.data === "string" && screenshot.data) {
    if (state.image_ref) {
      const format = screenshot.format ?? "jpeg";
      content.push(...imageWithRef(state.image_ref, screenshot.data, format));
      if (state.image_ref.actionable) {
        emittedFrame = { imageRef: state.image_ref, data: screenshot.data, format };
      }
    }
  }
  const mappedResult = { content };
  return emittedFrame ? withOfficialFrameIntegrity(
    mappedResult,
    emittedFrame.imageRef,
    emittedFrame.data,
    emittedFrame.format,
    session
  ) : mappedResult;
}
function actionReceiptBlock(receipt) {
  const action_receipt = {
    schema_version: "zcode-cua-action-receipt-v1",
    action_sent: receipt.action_sent,
    dispatch_status: receipt.dispatch_status,
    retry_action: false
  };
  if (receipt.ax_error) action_receipt.ax_error = receipt.ax_error;
  if (receipt.target_verification_status) {
    action_receipt.target_verification_status = receipt.target_verification_status;
  }
  return textBlock(JSON.stringify({ action_receipt }));
}
function stateUnavailableBlock(error51) {
  const errorType = error51 instanceof Error ? error51.constructor.name : typeof error51;
  const message = error51 instanceof Error ? error51.message : String(error51);
  return textBlock(
    JSON.stringify({
      state_observation: {
        schema_version: "zcode-cua-state-observation-v1",
        status: "unavailable",
        retry_action: false,
        error_type: errorType,
        message
      }
    })
  );
}
function normalizeActionDispatchReceipt(result) {
  if (result && typeof result === "object") {
    const value = result;
    if (value.action_sent === true && (value.dispatch_status === "accepted" || value.dispatch_status === "possibly_sent")) {
      return {
        action_sent: true,
        dispatch_status: value.dispatch_status,
        ...typeof value.ax_error === "string" ? { ax_error: value.ax_error } : {},
        ...value.target_verification_status === "matched" || value.target_verification_status === "mismatched" || value.target_verification_status === "unavailable" ? { target_verification_status: value.target_verification_status } : {}
      };
    }
  }
  return { action_sent: true, dispatch_status: "accepted" };
}
function actionDispatchReceiptFromError(error51) {
  const details = error51?.details;
  if (details?.action_sent === false && details.reason === "stale_element") {
    return { action_sent: false, dispatch_status: "not_sent" };
  }
  if (error51?.code === "broker_unavailable") {
    if (details?.request_delivery_state === "possibly_sent") {
      return { action_sent: true, dispatch_status: "possibly_sent" };
    }
    return null;
  }
  if (details?.request_delivery_state !== "possibly_sent") return null;
  return {
    action_sent: true,
    dispatch_status: "possibly_sent",
    ...typeof details.ax_error === "string" ? { ax_error: details.ax_error } : {}
  };
}
async function postActionObserve(deps, opts) {
  const { note } = opts;
  const consistency = opts.stateConsistency;
  const receipt = consistency?.dispatch ?? opts.dispatch ?? normalizeActionDispatchReceipt(null);
  const isError = receipt.action_sent === false ? true : void 0;
  const dispatchRecordBlock = opts.dispatchRecord && typeof opts.dispatchRecord === "object" ? textBlock(JSON.stringify(opts.dispatchRecord)) : null;
  if (consistency) {
    if (receipt.action_sent) {
      toolSession(deps).markMutationDispatched(consistency.mutation);
    } else if (receipt.dispatch_status === "not_sent") {
      toolSession(deps).consumeReferencedState(consistency.mutation);
    }
  }
  if (!receipt.action_sent) {
    opts.onEffect?.("unknown");
    return {
      content: [textBlock(note), actionReceiptBlock(receipt)],
      isError: true
    };
  }
  const hasAppRef = opts.app_ref !== void 0 && opts.app_ref !== null;
  if (opts.return_state === "none") {
    opts.onEffect?.("unknown");
    return {
      content: dispatchRecordBlock ? [textBlock(note), dispatchRecordBlock, actionReceiptBlock(receipt)] : [textBlock(note), actionReceiptBlock(receipt)],
      isError
    };
  }
  if (!hasAppRef) {
    opts.onEffect?.("unknown");
    return {
      content: [
        textBlock(note),
        actionReceiptBlock(receipt),
        textBlock(
          JSON.stringify({
            state_observation: {
              schema_version: "zcode-cua-state-observation-v1",
              status: "unavailable",
              retry_action: false,
              verification_reason: "app_unknown",
              message: "No app_ref was available for an optional post-action observation. Call get_app_state only if the next step needs UI state."
            }
          })
        )
      ],
      isError
    };
  }
  try {
    const raw = await callBroker(
      deps,
      "capture_app",
      { app_ref: opts.app_ref, include_screenshot: false, force_full: true },
      { kind: "read", timeoutMs: CAPTURE_APP_TIMEOUT_MS }
    );
    const mapped = await mapRawCaptureAppResult(raw, opts.return_state, true, {
      session: toolSession(deps)
    });
    if (mapped === null) {
      throw new Error("capture_app did not return a full app state");
    }
    opts.onEffect?.("unknown");
    return {
      ...mapped,
      content: [
        textBlock(`${note} (state below)`),
        // 根因：长 AX tree 会被宿主从尾部截断；receipt 必须先于可选状态详情，
        // 否则 possibly_sent/retry_action=false 的防重放契约会丢失。
        actionReceiptBlock(receipt),
        ...mapped.content
      ],
      isError
    };
  } catch (e) {
    opts.onEffect?.("unknown");
    return {
      content: [textBlock(note), actionReceiptBlock(receipt), stateUnavailableBlock(e)],
      isError
    };
  }
}
function mapZoomResult(result, session) {
  const r = result;
  if (r.image_ref.actionable !== true) {
    return toolError(
      "Zoom unavailable because its capture projection is not actionable. No raster authority was exposed; capture a new image and retry."
    );
  }
  const imageContent = imageWithRef(r.image_ref, r.image.data, r.image.format);
  const content = [...imageContent, ...r.text_blocks.map((text) => textBlock(text))];
  return withOfficialFrameIntegrity(
    { content },
    r.image_ref,
    r.image.data,
    r.image.format,
    session
  );
}
function observationFingerprint(raw) {
  const app = raw.app ?? {};
  const window2 = raw.window ?? {};
  const elements = Array.isArray(raw.elements) ? raw.elements : [];
  const elementSigs = elements.map((el) => {
    if (!el || typeof el !== "object") return "?";
    const e = el;
    const b = Array.isArray(e.bounds) ? e.bounds.map(Number).join(",") : "?";
    return [
      e.role ?? "",
      e.kind ?? "",
      e.title ?? "",
      e.value ?? "",
      b,
      e.enabled ?? true,
      e.editable ?? false,
      e.focused ?? false,
      e.pressable ?? false,
      e.has_menu ?? false
    ].join(":");
  }).sort();
  const appIdentity = typeof app.pid === "number" ? app.pid : typeof app.bundle_id === "string" ? app.bundle_id : typeof app.name === "string" ? app.name : null;
  const windowBounds = Array.isArray(window2.bounds) ? window2.bounds.map(Number).join(",") : "?";
  const screenshotData = raw.screenshot?.data;
  return JSON.stringify({
    app: appIdentity,
    window: [window2.title ?? "", windowBounds, window2.window_id ?? null],
    elements: elementSigs,
    has_image: typeof screenshotData === "string" && screenshotData.length > 0
  });
}
function noteObservation(raw, session = getDefaultSession()) {
  const key = observationFingerprint(raw);
  return session.noteObservation(key);
}
var listAppsTool = {
  name: "list_apps",
  title: "List Apps",
  description: "List running applications only: name, bundle_id (macOS bundle id / Windows AUMID / often empty on Linux), pid, active. A target missing from this list does not mean it is not installed. Do not substitute a different running application for the user-requested app. On Linux/Windows prefer name or pid. Read-only.",
  inputSchema: listAppsSchema,
  buildHandler: (deps) => async () => {
    try {
      const result = await callBroker(deps, "list_applications", {}, { kind: "read" });
      return textResult(toText(result));
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError(e instanceof Error ? e.message : String(e));
    }
  }
};
var openApplicationTool = {
  name: "open_application",
  title: "Open Application",
  description: `Launch or resolve an application.
app is OS-specific:
  - macOS: {"bundle_id": "com.apple.TextEdit"} or {"name": "TextEdit"}.
  - Linux: {"name": "gedit"} or {"name": "Firefox"} (no bundle_id on Linux; use name/pid).
  - Windows: {"name": "Notepad"} or {"bundle_id": "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"} (AUMID for UWP).
When bundle_id or pid is known, use that canonical identity alone; do not add a translated or guessed name.
For a macOS app that is not running, try the original user-provided name once: copy it character-for-character into app.name, including its script, case, spaces, punctuation, and suffixes such as app. For example, use {"name":"\u7F51\u6613\u4E91\u97F3\u4E50app"}, not {"name":"\u7F51\u6613\u4E91\u97F3\u4E50"}; use {"name":"\u65E5\u5386"}, not {"name":"Calendar"}. Do not translate, localize, normalize, shorten, or remove a suffix; do not retry names, search with Bash/Finder/Spotlight, or substitute another application.
If you already have a process-scoped app_ref from get_app_state/list_apps, {"pid": 123, "name": "..."}
is accepted to resolve that already-running process.
Browser navigation/search: pass url or urls, e.g.
{"bundle_id": "com.google.Chrome", "url": "https://www.bing.com/search?q=Zhipu+AI"}.
Prefer url/urls for browsers when get_app_state has no elements or screenshot is unavailable.

a11y-first: by default (activate=false) the app is NOT brought to the foreground, so
this never steals the user's focus/screen -- accessibility targets remain the primary
background-safe path. App-scoped input may still report no observable effect; do not treat
dispatch acceptance as proof that an attached panel or control handled it. Do
NOT set activate=true just to open, observe, click element targets, or type/key with
app_ref; try those background-safe paths first. Set activate=true only when the operation
genuinely requires the application foreground. The backend verifies that foreground
postcondition on every platform and fails instead of silently falling back to background.
The prevent_activation policy of the trusted host can still refuse activate=true before
dispatch; the model-facing flag expresses intent and never overrides host policy.
For an ordinary launch or application activation, omit window_id. Never guess window_id or use placeholders such as 1.
Only for a fresh macOS open/save panel, copy the exact pid, bundle_id, and actual window_id
returned by get_app_state with activate=true. Re-observe that surface before event key/type.
Use foreground activation ONLY as a last resort for raw foreground key/hold_key
input, or a coordinate click onto a self-drawn canvas area with no accessibility element --
those are the only inputs that truly need the app frontmost. A normal left_click and all
element/type/key actions are already background-safe (accessibility hit-test / AXPress) and
do NOT require activate=true, so do not set it before a coordinate or element click.
activate=true also applies to an already-running exact target. The returned
"active" field tells you whether the app ended up frontmost.

On macOS, new_instance=true launches and verifies a separate process. Use it for a disposable
scratch document when an existing app process is blocked or has unrelated windows. It cannot
be combined with app.pid; the returned fresh pid must be reused for list_windows/get_app_state.

On Linux, keyboard input (type/key without an element target) additionally needs the target window frontmost -- Mutter ignores programmatic focus.`,
  inputSchema: openApplicationSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    try {
      const app = args.app ?? {};
      const params = {
        activate: args.activate
      };
      if (args.new_instance === true) params.new_instance = true;
      if (app.bundle_id !== void 0) params.bundle_id = app.bundle_id;
      if (app.name !== void 0) params.name = app.name;
      if (app.pid !== void 0) params.pid = app.pid;
      if (app.window_id !== void 0) params.window_id = app.window_id;
      if (app.urls !== void 0) params.urls = app.urls;
      if (app.url !== void 0) params.url = app.url;
      const requestedUrls = app.urls ?? (app.url ? [app.url] : void 0);
      const requestedAppRef = {
        ...app.pid ? { pid: app.pid } : {},
        ...app.bundle_id ? { bundle_id: app.bundle_id } : {},
        ...app.name ? { name: app.name } : {},
        ...app.window_id ? { window_id: app.window_id } : {}
      };
      if (!requestedUrls && args.activate !== true && args.new_instance !== true) {
        const liveApps = await callBroker(deps, "list_applications", {}, { kind: "read" });
        if (Array.isArray(liveApps)) {
          const matches = liveApps.filter((candidate) => {
            if (!candidate || typeof candidate !== "object") return false;
            const live = candidate;
            if (app.pid !== void 0 && live.pid !== app.pid) return false;
            if (app.bundle_id !== void 0 && String(live.bundle_id ?? "").toLocaleLowerCase() !== app.bundle_id.toLocaleLowerCase()) {
              return false;
            }
            if (app.pid === void 0 && app.bundle_id === void 0 && app.name !== void 0 && String(live.name ?? "").trim().toLocaleLowerCase() !== app.name.trim().toLocaleLowerCase()) {
              return false;
            }
            return true;
          });
          if (matches.length === 1) {
            const matched = matches[0];
            if (typeof matched.pid === "number") {
              try {
                await callBroker(
                  deps,
                  "application_info",
                  { app_ref: { pid: matched.pid } },
                  { kind: "read", timeoutMs: 500 }
                );
              } catch {
              }
            }
            return textResult(toText(matched));
          }
        }
      }
      const readWindows = async (appRef2) => {
        const windows = await callBroker(
          deps,
          "list_windows",
          { app_ref: appRef2 },
          { kind: "read" }
        );
        if (!Array.isArray(windows)) return null;
        return windows.filter(
          (window2) => Boolean(window2) && typeof window2 === "object" && !Array.isArray(window2)
        );
      };
      const fileUrlWindowBaseline = await captureFileUrlWindowBaseline(
        args.new_instance === true ? async () => [] : () => readWindows(requestedAppRef),
        requestedUrls
      );
      const result = await callBroker(deps, "open_application", params, {
        kind: "action"
      });
      const opened = result && typeof result === "object" && !Array.isArray(result) ? result : {};
      const openedAppRef = {
        ...requestedAppRef,
        ...typeof opened.pid === "number" ? { pid: opened.pid } : {},
        ...typeof opened.bundle_id === "string" ? { bundle_id: opened.bundle_id } : {},
        ...typeof opened.name === "string" ? { name: opened.name } : {}
      };
      const helperVerification = opened.file_window_verification && typeof opened.file_window_verification === "object" && !Array.isArray(opened.file_window_verification) ? opened.file_window_verification : null;
      const helperVerifiedFileWindow = helperVerification?.status === "verified";
      if (!helperVerifiedFileWindow) {
        try {
          await verifyFileUrlWindowEffect(() => readWindows(openedAppRef), fileUrlWindowBaseline);
        } catch (error51) {
          const message = error51 instanceof Error ? error51.message : String(error51);
          throw new Error(
            `open_application could not verify the requested file was opened: ${message} Call list_windows before retrying; do not assume the returned app process opened the file.`
          );
        }
      }
      return textResult(toText(result));
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError(e instanceof Error ? e.message : String(e));
    }
  }
};
var listWindowsTool = {
  name: "list_windows",
  title: "List Windows",
  description: "List an application's windows: index, window_id, title, bounds, main, focused. Every window bounds=[x,y,width,height] tuple uses global screen points. `main` is the application's AX main window; `focused` identifies the application's AX focused/key window. Neither field means the application is the macOS system-frontmost application \u2014 use list_apps.active for that. For a multi-window app, capture a SPECIFIC window by passing its `window_id` back inside app_ref (get_app_state / left_click / set_value), e.g. {\"pid\":123,\"window_id\":4567}; otherwise the app's main/key window is returned. Read-only.",
  inputSchema: listWindowsSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    try {
      const result = await callBroker(
        deps,
        "list_windows",
        { app_ref: args.app_ref },
        { kind: "read" }
      );
      return textResult(toText(result));
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError(e instanceof Error ? e.message : String(e));
    }
  }
};
var getAppStateTool = {
  name: "get_app_state",
  title: "Get App State",
  description: 'Observe an app ONCE, then ACT on the next turn. Returns the filtered accessibility tree + a fresh state_id that element targets reference.\n\nObserve-then-act is the core loop: call this ONCE to read the current UI, then act (left_click / type / set_value / perform_action) using an element target from that state_id. Do NOT call get_app_state again on the SAME unchanged state before acting -- re-observing an identical state wastes your limited turn budget and is the leading cause of task failure. Re-observe only when (a) the server returned an element_stale error, (b) you just took an action that should have changed the UI and need to verify the result, or (c) the app/frontmost/occlusion state may have changed. This tool always requests a full snapshot from CUA; broker-internal delta/no_change replies are not model executable state.\n\napp_ref = {"pid": 1234} (preferred; from list_apps), {"name": "..."} (must resolve uniquely), or {"bundle_id": "..."} (macOS bundle id / Windows AUMID). For a multi-window app, add "window_id" (integer, from list_windows or the window tuple this tool returns) to observe a SPECIFIC window, e.g. {"pid":1234,"window_id":4567}; without it the main/key window is returned (a window_id_fallback note is surfaced if the requested window could not be resolved). macOS and Windows accept a stable window_id returned by list_windows; Linux support is backend-dependent, so never invent one. macOS also uses it for window-scoped pointer and synthetic-focus dispatch.\n\ndetail="compact" (default) returns a token-lean tree: each element as index + kind + name + capability flags (pressable/editable/has_menu/focused), which is all you need to pick an element target. detail="full" adds every field including bounds and the full `actions` list (use it when you need coordinates or a specific secondary action). Each element\'s integer `index` is valid only within this state_id.\n\nCoordinate contract: image-derived actions use integer x/y pixels from the latest returned raster; CUA binds its frame internally. app/window/element bounds=[x,y,width,height] remain diagnostic global screen points and must never be copied into a coordinate target.\n\ninclude_screenshot=false (default) keeps AX-first observations text-only so normal app control does not require or consume visual input. Set include_screenshot=true only when the task explicitly requires visual reading or frame-pixel coordinates. When present, the response emits image_ref immediately beside the image for internal integrity; do not invent or transform coordinates.\n\nIf an action fails unexpectedly or the app state looks wrong, check whether a modal dialog may be intercepting an unrelated action -- it shows up as a frontmost window here. Inspect its contents first; dismiss it only when it is NOT the intended target (press Escape, or use the dialog\'s own cancel/close control), then re-observe with get_app_state. If the dialog IS your task, read its contents before choosing an option.',
  inputSchema: getAppStateSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    try {
      const session = toolSession(deps);
      const params = { app_ref: args.app_ref, force_full: true };
      if (args.include_screenshot !== void 0) {
        params.include_screenshot = args.include_screenshot;
      }
      const result = await callBroker(deps, "capture_app", params, {
        kind: "read",
        timeoutMs: CAPTURE_APP_TIMEOUT_MS
      });
      const raw = await mapRawCaptureAppResult(result, args.detail, true, {
        session
      });
      if (raw) return raw;
      if (isIncrementalSnapshotResult(result)) {
        return toolError(
          "capture_app did not return a full app state. The broker returned an internal incremental snapshot, which is not model-executable; call get_app_state again."
        );
      }
      return mapAppStateResult(result);
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError(e instanceof Error ? e.message : String(e));
    }
  }
};
function isIncrementalSnapshotResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const mode = result.snapshot_mode;
  return mode === "delta" || mode === "no_change";
}
var screenshotTool = {
  name: "screenshot",
  title: "Screenshot",
  description: "Fallback full-display observation; prefer get_app_state. The image covers the display selected by switch_display. For a pixel action, choose x/y only by looking at the returned raster and submit them unchanged; CUA binds the frame internally. CUA owns the native projection. Metadata includes bounds=[x,y,width,height] for display identity only.",
  inputSchema: screenshotSchema,
  buildHandler: (deps) => async () => {
    try {
      const reply = await deps.broker.screenshot({
        displayId: toolSession(deps).selectedDisplay()
      });
      const display = await resolveCapturedDisplay(deps, reply);
      const captureWindows = parseScreenshotCaptureWindows(reply.capture_windows);
      if (captureWindows === null) {
        return toolError(
          JSON.stringify({
            code: "full_display_capture_windows_unavailable",
            message: "Full-display screenshot withheld because capture_windows ownership provenance is unavailable. No raster, local artifact, or frame authority was exposed. action_sent=false.",
            actionable: false,
            action_sent: false,
            image_delivered: false,
            frame_authority_issued: false
          })
        );
      }
      const png = Buffer.from(reply.data, "base64");
      const encoded = await encodeScreenshotFromPng(png, { quality: 75 });
      const agentW = encoded.geometry.agent.width;
      const agentH = encoded.geometry.agent.height;
      const frameDescriptor = toolSession(deps).issueFrame({
        delivered: {
          width: agentW,
          height: agentH,
          format: "jpeg",
          digest: `sha256:${createHash("sha256").update(encoded.agentBytes).digest("hex")}`,
          data: encoded.agentBytes.toString("base64")
        },
        source: {
          width: encoded.geometry.original.width,
          height: encoded.geometry.original.height,
          crop: {
            left: 0,
            top: 0,
            right: encoded.geometry.original.width,
            bottom: encoded.geometry.original.height
          }
        },
        pointer: {
          x: display.bounds[0],
          y: display.bounds[1],
          width: display.bounds[2],
          height: display.bounds[3],
          unit: "point"
        },
        app: { bundle_id: null, pid: null },
        window: { window_id: null, bounds: display.bounds },
        display: {
          display_id: display.id,
          topology_fingerprint: display.topology_fingerprint,
          origin: { x: display.bounds[0], y: display.bounds[1] }
        },
        capture_windows: captureWindows,
        actionable: true,
        non_actionable_reason: null
      });
      const content = [
        // canonical image-first pair；consumer 只校验并预算，不再重排。
        {
          type: "image",
          data: encoded.agentBytes.toString("base64"),
          mimeType: "image/jpeg"
        },
        imageRefBlock(frameDescriptor.image_ref),
        textBlock(
          JSON.stringify({
            screenshot_display: {
              index: display.index,
              id: display.id,
              bounds: display.bounds
            }
          })
        )
      ];
      return withOfficialFrameIntegrity(
        { content },
        frameDescriptor.image_ref,
        encoded.agentBytes.toString("base64"),
        "jpeg",
        toolSession(deps)
      );
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError(e instanceof Error ? e.message : String(e));
    }
  }
};
var zoomTool = {
  name: "zoom",
  title: "Zoom",
  description: "Exceptional close-up for a target that is too small or ambiguous in the current raster. Crop the latest returned raster with region=[x0,y0,x1,y1]; an optional explicit frame_id is accepted for compatibility, and it never takes a replacement screenshot. Alternatively zoom an accessibility element target; the modes are mutually exclusive. The result is a new raster. Choose x/y only by looking at that child raster and submit them unchanged; frame binding is internal.",
  inputSchema: zoomSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    const raw = input;
    const hasRegion = args.region !== void 0 && args.region !== null;
    const hasTarget = args.target !== void 0 && args.target !== null;
    const hasFrame = args.frame_id !== void 0 && args.frame_id !== null;
    if (hasRegion && hasTarget) {
      return toolError("zoom: pass either region or target, not both.");
    }
    if (!hasTarget && !hasRegion) {
      return toolError("zoom: provide a region [x0,y0,x1,y1] or a target {...}.");
    }
    if (raw.app_ref !== void 0) {
      return toolError(
        "zoom: app_ref region mode was removed because recapturing can drift; capture the app image first, then pass region pixels from that current raster."
      );
    }
    if (hasTarget && hasFrame) {
      return toolError("zoom: target mode derives its source from state_id; omit frame_id.");
    }
    try {
      const result = await composeZoom(
        deps,
        {
          region: args.region ?? null,
          frame_id: args.frame_id ?? null,
          target: args.target ?? null
        },
        { session: toolSession(deps) }
      );
      return mapZoomResult(result, toolSession(deps));
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError(e instanceof Error ? e.message : String(e));
    }
  }
};
var listDisplaysTool = {
  name: "list_displays",
  title: "List Displays",
  description: "List displays: index (1-based), bounds, main. Display bounds=[x,y,width,height] use global screen points. Read-only.",
  inputSchema: listDisplaysSchema,
  buildHandler: (deps) => async () => {
    try {
      const result = await callBroker(deps, "list_displays", {}, { kind: "read" });
      return textResult(toText(publicDisplayList(result)));
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError(e instanceof Error ? e.message : String(e));
    }
  }
};
var switchDisplayTool = {
  name: "switch_display",
  title: "Switch Display",
  description: "Choose which display a future full-screen `screenshot` captures (1-based index from list_displays). This does not capture an image or create a frame. Previously returned immutable frame_ids keep their original pixel meaning; the next captured image receives a new adjacent image_ref.",
  inputSchema: switchDisplaySchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    try {
      const raw = await callBroker(deps, "list_displays", {}, { kind: "read" });
      const list = Array.isArray(raw) ? raw : [];
      const validIdx = list.map((d) => d.index).filter((i) => typeof i === "number");
      if (!validIdx.some((i) => i === args.index)) {
        return toolError(
          `display index ${args.index} is out of range; valid: ${JSON.stringify(validIdx.sort((a, b) => a - b))}`
        );
      }
      const selected = list.find((display) => display.index === args.index);
      if (!selected || typeof selected.id !== "number" || !Number.isInteger(selected.id)) {
        return toolError(
          `display index ${args.index} did not include a stable integer id; call list_displays again`
        );
      }
      await callBroker(deps, "set_display", { index: args.index }, { kind: "action" });
      toolSession(deps).selectDisplay(selected.id);
      return textResult(JSON.stringify({ display: args.index, displays: publicDisplayList(list) }));
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError(e instanceof Error ? e.message : String(e));
    }
  }
};
function publicDisplayList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((display) => {
    if (!display || typeof display !== "object" || Array.isArray(display)) {
      return display;
    }
    const { scale_factor: _scaleFactor, ...publicDisplay } = display;
    return publicDisplay;
  });
}
function parseScreenshotCaptureWindows(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record2 = value;
  const windows = record2.windows;
  if (typeof record2.fingerprint !== "string" || record2.fingerprint.length === 0 || record2.order !== "front_to_back" || !Array.isArray(windows)) {
    return null;
  }
  const parsed = windows.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const window2 = entry;
    const bounds = window2.bounds;
    if (!Number.isSafeInteger(window2.window_id) || window2.window_id <= 0 || !Number.isSafeInteger(window2.owner_pid) || window2.owner_pid <= 0 || !Number.isSafeInteger(window2.layer) || !(window2.owner_bundle_id === null || typeof window2.owner_bundle_id === "string") || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every((part) => typeof part === "number" && Number.isFinite(part)) || // additive 字段：缺失/null 视为未知；出现了却不是 boolean 说明上游契约不一致，fail-closed。
    !(window2.accepts_left_mouse_down === void 0 || window2.accepts_left_mouse_down === null || typeof window2.accepts_left_mouse_down === "boolean")) {
      return null;
    }
    return {
      window_id: window2.window_id,
      owner_pid: window2.owner_pid,
      owner_bundle_id: window2.owner_bundle_id,
      layer: window2.layer,
      bounds,
      ...typeof window2.accepts_left_mouse_down === "boolean" ? { accepts_left_mouse_down: window2.accepts_left_mouse_down } : {}
    };
  });
  if (!parsed.every((entry) => entry !== null)) {
    return null;
  }
  return {
    fingerprint: record2.fingerprint,
    order: "front_to_back",
    windows: parsed
  };
}
var cursorPositionTool = {
  name: "cursor_position",
  title: "Cursor Position",
  description: "Read current pointer position (screen points).\n\nThe point is GLOBAL (covers all displays; secondary displays may have negative origins). ``cursor_display`` is the display the pointer is on and ``selected_display`` is the display ``screenshot`` currently captures, so a multi-display session can tell whether the pointer and the capture target agree. Call ``list_displays`` for each display's bounds/origin.",
  inputSchema: cursorPositionSchema,
  buildHandler: (deps) => async () => {
    try {
      const result = await callBroker(deps, "cursor_position", {}, { kind: "read" });
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        return textResult(toText(result));
      }
      const selectedId = toolSession(deps).selectedDisplay();
      if (selectedId === null) {
        return textResult(
          toText({
            ...result,
            selected_display: null
          })
        );
      }
      const rawDisplays = await callBroker(deps, "list_displays", {}, { kind: "read" });
      const selected = Array.isArray(rawDisplays) ? rawDisplays.find((display) => display.id === selectedId) : void 0;
      if (!selected) {
        toolSession(deps).clearSelectedDisplay();
      }
      return textResult(
        toText({
          ...result,
          selected_display: selected ? selected.index ?? null : null
        })
      );
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError(e instanceof Error ? e.message : String(e));
    }
  }
};
var observationTools = [
  listAppsTool,
  openApplicationTool,
  listWindowsTool,
  getAppStateTool,
  screenshotTool,
  zoomTool,
  listDisplaysTool,
  cursorPositionTool
];
var displayActionTools = [switchDisplayTool];
var observationToolsByName = new Map(
  [...observationTools, ...displayActionTools].map((t) => [t.name, t])
);
function textBlock2(text) {
  return { type: "text", text };
}
function textResult2(text) {
  return { content: [textBlock2(text)] };
}
function toolError2(text, details, _cause) {
  return details === void 0 ? { isError: true, content: [textBlock2(text)] } : { isError: true, content: [textBlock2(text)], structuredContent: { ...details } };
}
function pointerResolveError(error51) {
  if (error51 instanceof TargetResolveError || error51 instanceof FrameRegistryError) {
    return toolError2(`${error51.message} action_sent=false.`);
  }
  if (shouldPropagateToWrapper(error51)) throw error51;
  return toolError2(error51 instanceof Error ? error51.message : String(error51));
}
function bindPointerTarget(deps, rawTarget) {
  const target = parseTarget(rawTarget);
  if (target.type !== "coordinate") return target;
  return bindFramePixelTarget(target, {
    frame_registry: toolSession(deps).frameRegistry
  });
}
function resolveCoordinateFrame(deps, target, bindingKind = frameBindingKind(target)) {
  const session = toolSession(deps);
  const { frame_id } = resolveFramePixelTarget(target, {
    frame_registry: session.frameRegistry,
    binding_kind: bindingKind
  });
  return session.frameRegistry.resolveForAction(frame_id);
}
var POINTER_MODIFIER_ALIASES = {
  cmd: "cmd",
  command: "cmd",
  super: "cmd",
  meta: "cmd",
  shift: "shift",
  opt: "opt",
  option: "opt",
  alt: "opt",
  ctrl: "ctrl",
  control: "ctrl"
};
function normalizePointerModifiers(value, method) {
  const normalized = [];
  const seen = /* @__PURE__ */ new Set();
  for (const token of value.split("+").map((part) => part.trim().toLowerCase()).filter((part) => part.length > 0 && part !== "none")) {
    const canonical = POINTER_MODIFIER_ALIASES[token];
    if (!canonical) {
      throw new Error(
        `${method} modifiers must be a '+'-separated chord of cmd/shift/opt/ctrl (got '${token}'). action_sent=false.`
      );
    }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      normalized.push(canonical);
    }
  }
  return normalized.join("+");
}
function pointerActionError(error51, method) {
  if (shouldPropagateToWrapper(error51)) throw error51;
  if (error51 instanceof TargetResolveError || error51 instanceof FrameRegistryError) {
    return pointerResolveError(error51);
  }
  const message = error51 instanceof Error ? error51.message : String(error51);
  const attributed = /\braw foreground event\b.*\brefused because\b/i.test(message) ? message.replace(/^click:/i, `${method}:`) : message;
  const brokerDetails = error51?.details;
  return toolError2(
    attributed,
    brokerDetails && typeof brokerDetails === "object" ? brokerDetails : void 0
  );
}
function pointerDispatchErrorResult(deps, error51, options) {
  const dispatch = actionDispatchReceiptFromError(error51);
  if (!dispatch) return pointerActionError(error51, options.method);
  return postActionObserve(deps, {
    note: options.note,
    app_ref: options.appRef,
    return_state: options.returnState,
    dispatch
  });
}
function toText2(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
function resolvedActionAppRef(result, fallback) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return fallback;
  const resolved = result.resolved_app_ref;
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) return fallback;
  const record2 = resolved;
  if (!Number.isSafeInteger(record2.pid) || record2.pid <= 0 || typeof record2.bundle_id !== "string" || record2.bundle_id.length === 0) {
    return fallback;
  }
  return {
    pid: record2.pid,
    bundle_id: record2.bundle_id,
    ...Number.isSafeInteger(record2.window_id) && record2.window_id > 0 ? { window_id: record2.window_id } : {}
  };
}
async function resolveTargetForClick(deps, target) {
  try {
    const resolved = resolveTarget(target, {
      session: toolSession(deps)
    });
    if (!resolved.point && !(resolved.native && resolved.fingerprint)) {
      return toolError2(
        "target did not resolve to a screen point; use an element target with on-screen bounds or a coordinate target."
      );
    }
    return {
      point: resolved.point,
      app_ref: resolved.app_ref ?? null,
      fingerprint: resolved.fingerprint,
      native: resolved.native
    };
  } catch (e) {
    return pointerResolveError(e);
  }
}
function extractAppRefPid(appRef2) {
  if (appRef2 && typeof appRef2 === "object" && !Array.isArray(appRef2)) {
    const pid = appRef2.pid;
    if (typeof pid === "number" && Number.isInteger(pid) && pid > 0) return pid;
  }
  return void 0;
}
function unsentPointerIdentityError(error51) {
  const message = error51 instanceof Error ? error51.message : String(error51);
  return new Error(`${message.replace(/\s*action_sent=false\.?\s*$/i, "")} action_sent=false.`);
}
async function callPointerAction(deps, method, params, targets) {
  const dispatchCheckedDeps = {
    broker: {
      call: async (queuedMethod, queuedParams, queuedOpts) => {
        try {
          const session = toolSession(deps);
          for (const rawTarget of targets) {
            const bindingKind = frameBindingKind(rawTarget);
            const target = parseTarget(rawTarget);
            if (target.type === "coordinate") {
              resolveFramePixelTarget(target, {
                frame_registry: session.frameRegistry,
                binding_kind: bindingKind
              });
            }
          }
        } catch (error51) {
          throw unsentPointerIdentityError(error51);
        }
        return deps.broker.call(queuedMethod, queuedParams, queuedOpts);
      }
    }
  };
  return callBroker(dispatchCheckedDeps, method, params, { kind: "action" });
}
async function resolveExpectedPid(deps, appRef2, alreadyVerified = false) {
  if (appRef2 === void 0 || appRef2 === null) return void 0;
  const directPid = extractAppRefPid(appRef2);
  if (alreadyVerified && directPid !== void 0) return directPid;
  const record2 = appRef2 && typeof appRef2 === "object" && !Array.isArray(appRef2) ? appRef2 : null;
  const hasAdditionalIdentityConstraint = typeof appRef2 === "string" || record2 !== null && (typeof record2.bundle_id === "string" && record2.bundle_id.trim().length > 0 || typeof record2.name === "string" && record2.name.trim().length > 0 || typeof record2.window_id === "number" && Number.isSafeInteger(record2.window_id));
  if (directPid !== void 0 && !hasAdditionalIdentityConstraint) {
    return directPid;
  }
  let captured;
  let captureError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      captured = await callBroker(
        deps,
        "capture_app",
        { app_ref: appRef2, include_screenshot: false },
        { kind: "read" }
      );
      captureError = void 0;
      break;
    } catch (error51) {
      if (isBrokerUnavailableException(error51)) throw error51;
      captureError = error51;
      const message = error51 instanceof Error ? error51.message : String(error51);
      if (!/target app could not be resolved/i.test(message)) break;
    }
  }
  if (captureError !== void 0) {
    throw unsentPointerIdentityError(captureError);
  }
  const app = captured && typeof captured === "object" && !Array.isArray(captured) ? captured.app : void 0;
  const pid = extractAppRefPid(app);
  if (pid === void 0) {
    throw unsentPointerIdentityError(
      "coordinate target app_ref could not be bound to a verified live pid; raw pointer input was refused to prevent acting on the frontmost application. Call list_apps and retry with app_ref.pid."
    );
  }
  const capturedApp = app && typeof app === "object" && !Array.isArray(app) ? app : null;
  const capturedWindow = captured && typeof captured === "object" && !Array.isArray(captured) ? captured.window : null;
  const capturedWindowRecord = capturedWindow && typeof capturedWindow === "object" && !Array.isArray(capturedWindow) ? capturedWindow : null;
  const requestedBundle = record2 && typeof record2.bundle_id === "string" ? record2.bundle_id.trim() : "";
  const requestedName = record2 && typeof record2.name === "string" ? record2.name.trim() : "";
  const requestedWindowId = record2 && typeof record2.window_id === "number" && Number.isSafeInteger(record2.window_id) ? record2.window_id : void 0;
  const capturedBundle = capturedApp && typeof capturedApp.bundle_id === "string" ? capturedApp.bundle_id : "";
  const capturedName = capturedApp && typeof capturedApp.name === "string" ? capturedApp.name : "";
  const capturedWindowId = capturedWindowRecord && typeof capturedWindowRecord.window_id === "number" ? capturedWindowRecord.window_id : capturedWindowRecord && typeof capturedWindowRecord.id === "number" ? capturedWindowRecord.id : void 0;
  if (directPid !== void 0 && pid !== directPid || requestedBundle && capturedBundle !== requestedBundle || requestedName && capturedName !== requestedName || requestedWindowId !== void 0 && capturedWindowId !== requestedWindowId) {
    throw unsentPointerIdentityError(
      "coordinate target app_ref identity conflict: pid, bundle_id, name, and window_id must describe the same live application/window. Call list_apps and list_windows, then retry with one consistent app_ref."
    );
  }
  return pid;
}
function verifiedPointerAppRef(appRef2, pid) {
  if (pid === void 0) return void 0;
  if (appRef2 && typeof appRef2 === "object" && !Array.isArray(appRef2)) {
    return { ...appRef2, pid };
  }
  return { pid };
}
function frameActionProvenance(deps, ...targets) {
  const session = toolSession(deps);
  return targets.flatMap((rawTarget, endpointIndex) => {
    const bindingKind = frameBindingKind(rawTarget);
    const target = parseTarget(rawTarget);
    if (target.type !== "coordinate") return [];
    const frame = resolveCoordinateFrame(deps, target, bindingKind);
    const resolved = resolveTarget(rawTarget, { session });
    if (!resolved.point) return [];
    return [
      {
        contract: "frame_pixel_projection_v1",
        frame_id: frame.frame_id,
        expires_at_ms: frame.expires_at_ms,
        delivered: {
          width: frame.delivered.width,
          height: frame.delivered.height
        },
        source: frame.source,
        pointer: frame.pointer,
        app: frame.app,
        window: frame.window,
        display: {
          display_id: frame.display.display_id,
          topology_fingerprint: frame.display.topology_fingerprint
        },
        capture_windows: frame.capture_windows ?? null,
        capture_surfaces: frame.capture_surfaces ?? null,
        pixel: { x: target.x, y: target.y },
        projected_point: resolved.point,
        endpoint_index: endpointIndex
      }
    ];
  });
}
function appRefMatchesFrame(rawAppRef, frame) {
  if (rawAppRef === void 0 || rawAppRef === null) return true;
  let appRef2;
  try {
    appRef2 = parseAppRef(rawAppRef);
  } catch {
    return false;
  }
  if (frame.app.pid !== null && appRef2.pid !== null && appRef2.pid !== void 0 && appRef2.pid !== frame.app.pid) {
    return false;
  }
  if (frame.app.bundle_id !== null && appRef2.bundle_id !== null && appRef2.bundle_id !== void 0 && appRef2.bundle_id.toLocaleLowerCase() !== frame.app.bundle_id.toLocaleLowerCase()) {
    return false;
  }
  if (frame.window.window_id !== null && appRef2.window_id !== null && appRef2.window_id !== void 0 && appRef2.window_id !== frame.window.window_id) {
    return false;
  }
  return frame.app.pid !== null && appRef2.pid === frame.app.pid || frame.app.bundle_id !== null && appRef2.bundle_id?.toLocaleLowerCase() === frame.app.bundle_id.toLocaleLowerCase() || frame.window.window_id !== null && appRef2.window_id === frame.window.window_id;
}
function frameScopedAppRef(deps, fallback, ...targets) {
  for (const rawTarget of targets) {
    const bindingKind = frameBindingKind(rawTarget);
    const target = parseTarget(rawTarget);
    if (target.type !== "coordinate") continue;
    const frame = resolveCoordinateFrame(deps, target, bindingKind);
    if (frame.app.pid === null && frame.app.bundle_id === null) continue;
    return {
      ...frame.app.pid !== null ? { pid: frame.app.pid } : {},
      ...frame.app.bundle_id !== null ? { bundle_id: frame.app.bundle_id } : {},
      ...frame.window.window_id !== null ? { window_id: frame.window.window_id } : {}
    };
  }
  return fallback;
}
function frameDispatchIdentityError(deps, appRef2, ...targets) {
  if (appRef2 === void 0 || appRef2 === null) return null;
  try {
    for (const rawTarget of targets) {
      const bindingKind = frameBindingKind(rawTarget);
      const target = parseTarget(rawTarget);
      if (target.type !== "coordinate") continue;
      const frame = resolveCoordinateFrame(deps, target, bindingKind);
      if ((frame.app.pid !== null || frame.app.bundle_id !== null) && !appRefMatchesFrame(appRef2, frame)) {
        return toolError2(
          `app_ref for frame_id "${frame.frame_id}" does not match the application/window that produced the image; capture a new image from the intended app or omit app_ref. action_sent=false.`
        );
      }
    }
  } catch (error51) {
    return pointerResolveError(error51);
  }
  return null;
}
function targetHasFrameAuthority(rawTarget) {
  try {
    return parseTarget(rawTarget).type === "coordinate";
  } catch {
    return false;
  }
}
async function runClick(deps, input, button, clicks) {
  const args = input;
  let modifiers;
  try {
    modifiers = normalizePointerModifiers(args.modifiers ?? "", "click");
  } catch (error51) {
    return pointerActionError(error51, "click");
  }
  let target;
  try {
    target = bindPointerTarget(deps, args.target);
  } catch (error51) {
    return pointerResolveError(error51);
  }
  const strategy = args.strategy ?? "auto";
  const identityError = frameDispatchIdentityError(deps, args.app_ref, target);
  if (identityError) return identityError;
  let frameProvenance;
  try {
    frameProvenance = frameActionProvenance(deps, target);
  } catch (error51) {
    return pointerResolveError(error51);
  }
  const resolved = await resolveTargetForClick(deps, target);
  if ("content" in resolved) return resolved;
  try {
    const parsedClickTarget = target;
    const actionAppRef = frameScopedAppRef(deps, args.app_ref ?? resolved.app_ref, target);
    const elementTarget = parsedClickTarget.type === "element";
    const expectedPid = await resolveExpectedPid(
      deps,
      actionAppRef,
      frameProvenance.length > 0 || elementTarget && (args.app_ref === void 0 || args.app_ref === null)
    );
    const elementStateId = elementTarget ? parsedClickTarget.state_id : void 0;
    const elementMutation = elementTarget ? toolSession(deps).beginMutation(
      actionAppRef,
      typeof elementStateId === "string" ? elementStateId : void 0
    ) : null;
    let result;
    let fellThroughActionUnavailable = false;
    const semanticAxPress = resolved.native && resolved.fingerprint && button === "left" && clicks === 1 && !modifiers && strategy !== "event";
    if (semanticAxPress) {
      const native = resolved.native;
      const mutation = elementMutation;
      try {
        const axResult = await callPointerAction(
          deps,
          "element_perform_action",
          { native, action: "AXPress" },
          [target]
        );
        return postActionObserve(deps, {
          note: (axResult === null || axResult === void 0 ? "Dispatched AXPress." : toText2(axResult)) + " (semantic AXPress on the element token; no coordinate hit-test.)",
          app_ref: actionAppRef,
          return_state: args.return_state,
          stateConsistency: {
            mutation,
            dispatch: normalizeActionDispatchReceipt(axResult)
          }
        });
      } catch (e) {
        const dispatch = actionDispatchReceiptFromError(e);
        if (dispatch) {
          return postActionObserve(deps, {
            note: "AXPress may already have reached the target element.",
            app_ref: actionAppRef,
            return_state: args.return_state,
            stateConsistency: { mutation, dispatch }
          });
        }
        const code = e?.code;
        const details = e?.details;
        const actionProvenUnsent = details !== null && typeof details === "object" && !Array.isArray(details) && details.action_sent === false;
        if (code !== "action_unavailable" || !actionProvenUnsent) throw e;
        if (strategy === "a11y") {
          throw e;
        }
        fellThroughActionUnavailable = true;
      }
    }
    const effStrategy = elementTarget && (button === "left" || clicks > 1 || fellThroughActionUnavailable) ? "event" : strategy;
    try {
      if (resolved.fingerprint && resolved.native) {
        result = await callPointerAction(
          deps,
          "click",
          {
            point: elementCenter(resolved.fingerprint.bounds),
            button,
            clicks,
            modifiers,
            // P2-3: forward strategy so the broker can honor strategy=event
            // (force raw CGEvent, skip the AX hit-test path).
            strategy: effStrategy,
            // BUG-1/2: an element target is already resolved to a known app, so
            // the broker's AX hit-test owner gate is redundant — and it mis-fires
            // (ax_error) for non-pressable elements (textarea) after a semantic
            // AXPress attempt. Drop it whenever we force a raw click.
            expected_pid: expectedPid,
            app_ref: verifiedPointerAppRef(actionAppRef, expectedPid),
            ...frameProvenance.length > 0 ? { frame_provenance: frameProvenance } : {},
            expected_window_id: resolved.app_ref?.window_id,
            expected_bundle_id: resolved.app_ref?.bundle_id
          },
          [target]
        );
      } else {
        result = await callPointerAction(
          deps,
          "click",
          {
            point: resolved.point,
            button,
            clicks,
            modifiers,
            strategy: effStrategy,
            expected_pid: expectedPid,
            app_ref: verifiedPointerAppRef(actionAppRef, expectedPid),
            ...frameProvenance.length > 0 ? { frame_provenance: frameProvenance } : {},
            expected_window_id: resolved.app_ref?.window_id,
            expected_bundle_id: resolved.app_ref?.bundle_id
          },
          [target]
        );
      }
    } catch (error51) {
      const dispatch = actionDispatchReceiptFromError(error51);
      if (!dispatch) throw error51;
      return postActionObserve(deps, {
        note: elementMutation ? "Element click may already have reached the target window." : "Coordinate click may already have reached the target window.",
        app_ref: actionAppRef,
        return_state: args.return_state,
        ...elementMutation ? { stateConsistency: { mutation: elementMutation, dispatch } } : { dispatch }
      });
    }
    if (elementMutation) {
    }
    return postActionObserve(deps, {
      note: toText2(result),
      app_ref: resolvedActionAppRef(result, actionAppRef),
      return_state: args.return_state,
      ...elementMutation ? {
        stateConsistency: {
          mutation: elementMutation,
          dispatch: normalizeActionDispatchReceipt(result)
        }
      } : {}
    });
  } catch (e) {
    if (shouldPropagateToWrapper(e)) throw e;
    return toolError2(e instanceof Error ? e.message : String(e));
  }
}
function clickToolDef(opts) {
  return {
    name: opts.name,
    title: opts.title,
    description: opts.description,
    inputSchema: opts.schema,
    buildHandler: (deps) => async (input) => runClick(deps, input, opts.button, opts.clicks)
  };
}
var SKILL_REF = 'See SKILL.md "Choose the target".';
var leftClickTool = clickToolDef({
  name: "left_click",
  title: "Left Click",
  button: "left",
  clicks: 1,
  schema: leftClickSchema,
  description: `Left-click a target. Element target {"type":"element","state_id","index"} is PREFERRED: an accessibility press that works on a BACKGROUND app (no focus steal). A coordinate target is still a11y-first under auto -- the server hit-tests and presses via accessibility when a pressable element is found; a raw click is the fallback only when no pressable element is hit, strategy="event", or a modifier is held. On macOS that fallback stays background/window-scoped. A coordinate is {"type":"coordinate","x","y"}; x/y are integer pixels in the latest returned raster, and CUA binds its frame internally. strategy: auto|a11y|event; modifiers are OS-specific (macOS cmd/shift/ctrl/alt; Linux ctrl/shift/alt/super; Windows ctrl/shift/alt/win -- use ctrl, not cmd, on Linux/Windows); return_state compact|full|none. For an element target, state_id is the authoritative app/window scope; omit app_ref (a redundant top-level app_ref is validated and ignored for compatibility). A coordinate inherits its observed app/window scope from CUA's internal frame binding; top-level app_ref may only narrow it. Example: left_click(target={"type":"element","state_id":"s-1","index":4}). ` + SKILL_REF
});
var doubleClickTool = clickToolDef({
  name: "double_click",
  title: "Double Click",
  button: "left",
  clicks: 2,
  schema: doubleClickSchema,
  description: 'Double-click a target. NO ACCESSIBILITY equivalent: on macOS it is a verified background window event; Linux/Windows retain their foreground raw route. Under auto an element target fails closed; a coordinate falls through to the same raw event and is bound to the current raster internally. Example: double_click(target={"type":"coordinate","x":120,"y":80}, strategy="event"). ' + SKILL_REF
});
var tripleClickTool = clickToolDef({
  name: "triple_click",
  title: "Triple Click",
  button: "left",
  clicks: 3,
  schema: tripleClickSchema,
  description: 'Triple-click a target. NO ACCESSIBILITY equivalent: on macOS it is a verified background window event; Linux/Windows retain their foreground raw route. Under auto an element target fails closed; a coordinate falls through to the same raw event and is bound to the current raster internally. Example: triple_click(target={"type":"coordinate","x":120,"y":80}, strategy="event"). ' + SKILL_REF
});
var rightClickTool = clickToolDef({
  name: "right_click",
  title: "Right Click",
  button: "right",
  clicks: 1,
  schema: rightClickSchema,
  description: `Right-click a target. Element target {"type":"element","state_id","index"} opens the element's menu via accessibility when it has one (BACKGROUND-safe). A coordinate is still a11y-first under auto -- the server hit-tests and opens the menu via accessibility when a menu element is found; a raw right-click is the fallback when no menu element is hit, strategy="event", or a modifier is held. On macOS that fallback is still background/window-scoped. An element target with no menu or with a modifier fails closed under auto. A coordinate is bound to the current raster inside CUA. modifiers/return_state/app_ref as on left_click. Example: right_click(target={"type":"element","state_id":"s-1","index":4}). ` + SKILL_REF
});
var middleClickTool = clickToolDef({
  name: "middle_click",
  title: "Middle Click",
  button: "middle",
  clicks: 1,
  schema: middleClickSchema,
  description: 'Middle-click a target. NO ACCESSIBILITY equivalent: on macOS it is a verified background window event; Linux/Windows retain their foreground raw route. Under auto an element target fails closed; a coordinate falls through to the same raw event and is bound to the current raster internally. Example: middle_click(target={"type":"coordinate","x":120,"y":80}, strategy="event"). ' + SKILL_REF
});
var scrollTool = {
  name: "scroll",
  title: "Scroll",
  description: 'Scroll at a target. scroll_amount is clamped to 0..100. Scroll has NO accessibility actuation: it is always a raw event, so under strategy=auto or a11y an element target fails closed. On macOS strategy=event is background/window-scoped; Linux/Windows retain their foreground raw route. A coordinate is bound to the current raster inside CUA. Example: scroll(target={"type":"coordinate","x":200,"y":300}, scroll_direction="down", scroll_amount=10, strategy="event"). ' + SKILL_REF,
  inputSchema: scrollSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    const strategy = args.strategy ?? "auto";
    const { value: applied, requested } = clampScrollAmount(args.scroll_amount);
    if (applied < 1) {
      const requestedAmount = requested ?? args.scroll_amount;
      return textResult2(
        `Scrolled 0 (requested ${requestedAmount}, applied ${applied}; nothing to scroll). action_sent=false.`
      );
    }
    let target;
    try {
      target = bindPointerTarget(deps, args.target);
    } catch (error51) {
      return pointerResolveError(error51);
    }
    const identityError = frameDispatchIdentityError(deps, args.app_ref, target);
    if (identityError) return identityError;
    const frameProvenance = frameActionProvenance(deps, target);
    let point;
    let targetAppRef;
    let targetIsElement = false;
    try {
      const resolved = resolveTarget(target, {
        session: toolSession(deps)
      });
      if (!resolved.point) {
        return toolError2(
          "target did not resolve to a screen point; use a coordinate target with on-screen bounds."
        );
      }
      point = resolved.point;
      targetAppRef = resolved.app_ref;
      targetIsElement = resolved.isElement;
      if (strategy === "a11y") {
        return toolError2(
          "scroll has no accessibility actuation; strategy=a11y requires an accessibility operation (AX/UIA/AT-SPI), but scrolling is implemented as raw pointer input. Use strategy=event (background/window-scoped on macOS) or keyboard navigation against a focused element."
        );
      }
    } catch (e) {
      return pointerResolveError(e);
    }
    try {
      const scopedAppRef = frameScopedAppRef(deps, args.app_ref ?? targetAppRef, target);
      const expectedPid = await resolveExpectedPid(
        deps,
        scopedAppRef,
        frameProvenance.length > 0 || targetIsElement && (args.app_ref === void 0 || args.app_ref === null)
      );
      const result = await callPointerAction(
        deps,
        "scroll",
        {
          point,
          direction: args.scroll_direction,
          amount: applied,
          ...frameProvenance.length > 0 ? { frame_provenance: frameProvenance } : {},
          ...expectedPid !== void 0 ? {
            app_ref: verifiedPointerAppRef(scopedAppRef, expectedPid)
          } : {}
        },
        [target]
      );
      return postActionObserve(deps, {
        note: scrollNote(applied, requested),
        app_ref: resolvedActionAppRef(result, scopedAppRef),
        return_state: args.return_state
      });
    } catch (e) {
      return pointerDispatchErrorResult(deps, e, {
        method: "scroll",
        note: "Scroll may already have reached the target window.",
        appRef: args.app_ref ?? targetAppRef,
        returnState: args.return_state ?? "none"
      });
    }
  }
};
var DRAG_NOTE = "Dragged.";
var leftClickDragTool = {
  name: "left_click_drag",
  title: "Left Click Drag",
  description: 'Drag from one target to another (each an element or coordinate). ADVANCED/RAW: a drag has no accessibility equivalent, so both endpoints must be scoped to the same app. On macOS it is a background/window-scoped gesture; Linux/Windows retain foreground raw semantics. modifiers (e.g. cmd/shift/opt/ctrl) are held for the whole drag and are OS-specific: macOS cmd/shift/ctrl/alt; Linux ctrl/shift/alt/super; Windows ctrl/shift/alt/win -- use ctrl, not cmd, on Linux/Windows. A coordinate endpoint is bound to the current raster inside CUA. return_state/app_ref as on left_click. Example: left_click_drag(from_target={"type":"element","state_id":"s-1","index":2}, to={"type":"coordinate","x":40,"y":60}). ' + SKILL_REF,
  inputSchema: leftClickDragSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    let dispatchAppRef = args.app_ref;
    try {
      const fromTarget = bindPointerTarget(deps, args.from_target);
      const toTarget = bindPointerTarget(deps, args.to);
      const identityError = frameDispatchIdentityError(deps, args.app_ref, fromTarget, toTarget);
      if (identityError) return identityError;
      const frameProvenance = frameActionProvenance(deps, fromTarget, toTarget);
      const modifiers = normalizePointerModifiers(args.modifiers ?? "", "drag");
      const start = resolveTarget(fromTarget, {
        session: toolSession(deps)
      });
      const end = resolveTarget(toTarget, {
        session: toolSession(deps)
      });
      if (!start.point || !end.point) {
        return toolError2("drag endpoints must resolve to on-screen points.");
      }
      const explicitPid = await resolveExpectedPid(deps, args.app_ref);
      const startPid = await resolveExpectedPid(
        deps,
        start.app_ref,
        start.isElement || targetHasFrameAuthority(fromTarget)
      );
      const endPid = await resolveExpectedPid(
        deps,
        end.app_ref,
        end.isElement || targetHasFrameAuthority(toTarget)
      );
      const endpointPids = [startPid, endPid].filter((pid) => pid !== void 0);
      if (endpointPids.length > 1 && endpointPids.some((pid) => pid !== endpointPids[0])) {
        return toolError2(
          "drag endpoints resolve to different applications; both endpoints must belong to the same live pid. action_sent=false."
        );
      }
      if (explicitPid !== void 0 && endpointPids.some((pid) => pid !== explicitPid)) {
        return toolError2(
          "drag app_ref does not match the application owning both endpoints. action_sent=false."
        );
      }
      const expectedPid = explicitPid ?? endpointPids[0];
      const scopedAppRef = frameScopedAppRef(
        deps,
        args.app_ref ?? start.app_ref ?? end.app_ref,
        fromTarget,
        toTarget
      );
      dispatchAppRef = scopedAppRef;
      const result = await callPointerAction(
        deps,
        "drag",
        {
          start: start.point,
          end: end.point,
          modifiers,
          ...frameProvenance.length > 0 ? { frame_provenance: frameProvenance } : {},
          ...expectedPid !== void 0 ? { app_ref: verifiedPointerAppRef(scopedAppRef, expectedPid) } : {}
        },
        [fromTarget, toTarget]
      );
      return postActionObserve(deps, {
        note: DRAG_NOTE,
        app_ref: resolvedActionAppRef(result, scopedAppRef),
        return_state: args.return_state
      });
    } catch (e) {
      return pointerDispatchErrorResult(deps, e, {
        method: "drag",
        note: "Drag may already have reached the target window.",
        appRef: dispatchAppRef,
        returnState: args.return_state ?? "none"
      });
    }
  }
};
var MOVE_NOTE = "Moved.";
var mouseMoveTool = {
  name: "mouse_move",
  title: "Mouse Move",
  description: 'Move the virtual pointer to a coordinate target without clicking (hover). ADVANCED/RAW. On macOS this is a background/window-scoped move and leaves the physical cursor unchanged; Linux/Windows retain their native pointer semantics. Coordinate only; an element target is refused (use left_click to actuate an element). Use integer pixels from the latest returned raster. Example: mouse_move(coordinate={"type":"coordinate","x":100,"y":100}). ' + SKILL_REF,
  inputSchema: mouseMoveSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    let dispatchAppRef = args.app_ref;
    try {
      const coordinate = bindPointerTarget(deps, args.coordinate);
      const identityError = frameDispatchIdentityError(deps, args.app_ref, coordinate);
      if (identityError) return identityError;
      const frameProvenance = frameActionProvenance(deps, coordinate);
      const resolved = resolveTarget(coordinate, {
        session: toolSession(deps)
      });
      if (!resolved.point) {
        return toolError2("coordinate did not resolve to an on-screen point.");
      }
      const scopedAppRef = frameScopedAppRef(deps, args.app_ref ?? resolved.app_ref, coordinate);
      dispatchAppRef = scopedAppRef;
      const expectedPid = await resolveExpectedPid(deps, scopedAppRef, frameProvenance.length > 0);
      const result = await callPointerAction(
        deps,
        "move_to",
        {
          point: resolved.point,
          // A split drag is process-global in the Helper. Forward the stable
          // MCP-session key so only the session that posted mouse_down may drive
          // its subsequent dragged move events.
          session_key: toolSessionKey(deps),
          ...frameProvenance.length > 0 ? { frame_provenance: frameProvenance } : {},
          ...expectedPid !== void 0 ? {
            app_ref: verifiedPointerAppRef(scopedAppRef, expectedPid)
          } : {}
        },
        [coordinate]
      );
      return postActionObserve(deps, {
        note: MOVE_NOTE,
        app_ref: resolvedActionAppRef(result, scopedAppRef),
        return_state: args.return_state ?? "none"
      });
    } catch (e) {
      return pointerDispatchErrorResult(deps, e, {
        method: "move_to",
        note: "Mouse move may already have reached the target window.",
        appRef: dispatchAppRef,
        returnState: args.return_state ?? "none"
      });
    }
  }
};
var MOUSE_DOWN_NOTE = "Mouse button pressed at resolved element or scoped coordinate.";
var leftMouseDownTool = {
  name: "left_mouse_down",
  title: "Left Mouse Down",
  description: 'Press and hold the left mouse button at an element or frame-bound coordinate. ADVANCED/RAW and requires an element or frame-bound coordinate target. Coordinate targets are bound to the current raster internally, so the press is scoped to an observed app/window. On macOS the pair is window-scoped and leaves the real cursor/frontmost app intact. A left_mouse_down + left_mouse_up pair is a click, so independently verify the target before releasing. return_state defaults to none; request compact/full only when fresh UI state is needed. The matching left_mouse_up reuses the stored app scope. Release with left_mouse_up. Examples: left_mouse_down(target={"type":"element","state_id":"s-1","index":4}); left_mouse_down(target={"type":"coordinate","x":100,"y":100}). ' + SKILL_REF,
  inputSchema: leftMouseDownSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    let point;
    let targetAppRef;
    let targetIsElement = false;
    let frameProvenance = [];
    let target;
    try {
      target = bindPointerTarget(deps, args.target);
      const identityError = frameDispatchIdentityError(deps, args.app_ref, target);
      if (identityError) return identityError;
      frameProvenance = frameActionProvenance(deps, target);
      const resolved = resolveTarget(target, {
        session: toolSession(deps)
      });
      if (!resolved.point) {
        return toolError2(
          "target did not resolve to an on-screen point; pass a coordinate or element target with on-screen bounds."
        );
      }
      point = resolved.point;
      targetAppRef = resolved.app_ref;
      targetIsElement = resolved.isElement;
    } catch (e) {
      return pointerResolveError(e);
    }
    try {
      const scopedAppRef = frameScopedAppRef(deps, args.app_ref ?? targetAppRef, target);
      const expectedPid = await resolveExpectedPid(
        deps,
        scopedAppRef,
        frameProvenance.length > 0 || targetIsElement && (args.app_ref === void 0 || args.app_ref === null)
      );
      const sessionKey = toolSessionKey(deps);
      const ownership = deps.pointerHoldGuard?.acquire(sessionKey);
      if (ownership === "same") {
        return toolError2(
          "mouse_down refused: this MCP session already holds the left mouse button. This request did not send another press; action_sent=false. Wait for mouse_up or stop_computer_control."
        );
      }
      if (ownership === "other") {
        return toolError2(
          "mouse_down refused: another MCP session already holds the left mouse button. This request did not send a press; action_sent=false. Wait for that session to call mouse_up or stop_computer_control."
        );
      }
      const heldAppRef = verifiedPointerAppRef(scopedAppRef, expectedPid) ?? scopedAppRef ?? targetAppRef;
      if (deps.inputState) {
        deps.inputState.leftMouseDown = true;
        deps.inputState.appRef = heldAppRef;
      }
      const result = await callPointerAction(
        deps,
        "mouse_down",
        {
          point,
          button: "left",
          session_key: sessionKey,
          ...frameProvenance.length > 0 ? { frame_provenance: frameProvenance } : {},
          ...expectedPid !== void 0 ? { app_ref: heldAppRef } : {}
        },
        [target]
      );
      const observedAppRef = resolvedActionAppRef(result, heldAppRef);
      if (deps.inputState) {
        deps.inputState.appRef = observedAppRef;
      }
      return postActionObserve(deps, {
        note: MOUSE_DOWN_NOTE,
        app_ref: observedAppRef,
        return_state: args.return_state ?? "none"
      });
    } catch (e) {
      const deliveryState = e !== null && typeof e === "object" && "details" in e && e.details?.request_delivery_state;
      if (deliveryState !== "possibly_sent") {
        deps.pointerHoldGuard?.release(toolSessionKey(deps));
        if (deps.inputState) {
          deps.inputState.leftMouseDown = false;
          deps.inputState.appRef = void 0;
        }
      }
      return pointerDispatchErrorResult(deps, e, {
        method: "mouse_down",
        note: "Mouse down may already have reached the target window.",
        appRef: deps.inputState?.appRef ?? args.app_ref ?? targetAppRef,
        returnState: args.return_state ?? "none"
      });
    }
  }
};
var MOUSE_UP_NOTE = "Mouse button released.";
var leftMouseUpTool = {
  name: "left_mouse_up",
  title: "Left Mouse Up",
  description: "Release the left mouse button previously pressed by this MCP session. CLEANUP RELEASE ONLY: it refuses when this session has not successfully called left_mouse_down, so an accidental call cannot release the user's own mouse press. return_state defaults to none; request compact/full only when fresh UI state is needed. The app scope is remembered from the matching left_mouse_down. Example: left_mouse_up(). " + SKILL_REF,
  inputSchema: leftMouseUpSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    const heldAppRef = deps.inputState?.appRef;
    try {
      const sessionKey = toolSessionKey(deps);
      const ownership = deps.pointerHoldGuard?.ownerState(sessionKey);
      if (ownership === "none") {
        return toolError2(
          "mouse_up refused: this MCP session is not holding the left mouse button. This request did not send a release; action_sent=false. It only releases a button previously pressed by mouse_down."
        );
      }
      if (ownership === "other") {
        return toolError2(
          "mouse_up refused: another MCP session holds the left mouse button. This request did not send a release; action_sent=false. Wait for that session to call mouse_up or stop_computer_control."
        );
      }
      await callBroker(
        deps,
        "mouse_up",
        // P2-6: forward session_key so the broker can refuse a left_mouse_up
        // when this session isn't the holder (Python parity).
        { button: "left", session_key: sessionKey, app_ref: heldAppRef },
        { kind: "action" }
      );
      deps.pointerHoldGuard?.release(sessionKey);
      if (deps.inputState) {
        deps.inputState.leftMouseDown = false;
        deps.inputState.appRef = void 0;
      }
      return postActionObserve(deps, {
        note: MOUSE_UP_NOTE,
        app_ref: heldAppRef,
        return_state: args.return_state ?? "none"
      });
    } catch (e) {
      return pointerDispatchErrorResult(deps, e, {
        method: "mouse_up",
        note: "Mouse up may already have reached the target window.",
        appRef: heldAppRef,
        returnState: args.return_state ?? "none"
      });
    }
  }
};
var pointerTools = [
  leftClickTool,
  doubleClickTool,
  tripleClickTool,
  rightClickTool,
  middleClickTool,
  scrollTool,
  leftClickDragTool,
  mouseMoveTool,
  leftMouseDownTool,
  leftMouseUpTool
];
var pointerToolsByName = new Map(pointerTools.map((t) => [t.name, t]));
async function closePipForEndedSession(_deps) {
}
async function releaseHeldPointer(deps) {
  if (deps?.inputState?.leftMouseDown !== true) return false;
  const sessionKey = toolSessionKey(deps);
  await callBroker(
    deps,
    "mouse_up",
    {
      button: "left",
      session_key: sessionKey,
      app_ref: deps.inputState.appRef
    },
    { kind: "action", timeoutMs: 2e3 }
  );
  deps.pointerHoldGuard?.release(sessionKey);
  deps.inputState.leftMouseDown = false;
  deps.inputState.appRef = void 0;
  return true;
}
async function cleanupStdioSession(deps, lifecycleCleanup) {
  try {
    await cancelHeldKeys(deps);
    await releaseHeldPointer(deps);
  } finally {
    await closePipForEndedSession(deps);
    await lifecycleCleanup?.();
  }
}
async function cancelHeldKeys(deps) {
  if (!deps) return false;
  const trackedKeys = deps.inputHolds?.activeKeys() ?? [];
  const activeKeys = trackedKeys.filter((key) => deps.inputHolds?.claimCancellation(key));
  const keys = trackedKeys.length > 0 ? activeKeys : [toolSessionKey(deps)];
  if (keys.length === 0) return true;
  const outcomes = await Promise.all(
    keys.map(async (sessionKey) => {
      try {
        await callBrokerControl(
          deps,
          "cancel_input_holds",
          { session_key: sessionKey },
          { kind: "action", timeoutMs: 2e3 }
        );
        return true;
      } catch {
        return false;
      }
    })
  );
  return outcomes.some(Boolean);
}
function softError(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}
async function resolveCoordinateToNative(deps, target) {
  let parsed;
  try {
    parsed = parseTarget(target);
  } catch {
    return null;
  }
  if (parsed.type !== "coordinate") return null;
  let resolved;
  try {
    resolved = resolveTarget(target, { session: getDefaultSession() });
  } catch (e) {
    const message = e instanceof TargetResolveError ? e.message : String(e);
    return softError(`${message} action_sent=false.`);
  }
  const point = resolved.point;
  if (!point) {
    return softError(
      "coordinate target did not resolve to a screen point; call get_app_state and use its element or image coordinates. action_sent=false."
    );
  }
  const reply = await deps.broker.call("element_at_point", {
    x: point.x,
    y: point.y
  });
  if (!reply || typeof reply !== "object") {
    return softError(
      `no actionable element at (${point.x}, ${point.y}); the point is empty or not accessibility-exposed. Re-observe with get_app_state and target an element. action_sent=false.`
    );
  }
  const native = reply.native;
  if (typeof native !== "string" || native.length === 0) {
    return softError(
      `the element at (${point.x}, ${point.y}) has no native accessibility token; it cannot be actuated semantically. Use a coordinate click (strategy=event) or re-observe with get_app_state. action_sent=false.`
    );
  }
  const ownerPid = reply.owner_pid;
  const pid = typeof ownerPid === "number" ? ownerPid : void 0;
  if (pid === void 0) {
    return softError(
      `the element at (${point.x}, ${point.y}) did not report an owning pid; refusing to actuate without owner verification. action_sent=false.`
    );
  }
  return { native, app_ref: { pid } };
}
function resolveTargetOrSoftError(target, session) {
  try {
    return {
      resolved: resolveTarget(target, {
        session
      })
    };
  } catch (e) {
    if (e instanceof TargetResolveError) {
      return softError(`${e.message} action_sent=false.`);
    }
    return softError(e instanceof Error ? e.message : String(e));
  }
}
function splitsUtf16SurrogatePair(text, offset) {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return before >= 55296 && before <= 56319 && after >= 56320 && after <= 57343;
}
function textRangeSplitsUtf16SurrogatePair(text, range) {
  const [start, length] = range;
  return splitsUtf16SurrogatePair(text, start) || splitsUtf16SurrogatePair(text, start + length);
}
var CUA_REQUEST_ACCESS_STATUS_META_KEY = "zcode.cua/request-access-status-v1";
var cuaRequestAccessStatusSchema = z.object({
  schemaVersion: z.literal(1),
  platform: z.literal("darwin"),
  grantOwner: z.string().trim().min(1).max(512),
  accessibility: z.enum(["granted", "stale", "denied"]),
  screenRecording: z.enum(["granted", "denied", "unknown"])
}).strict();
function readCuaRequestAccessStatus(platform, report) {
  if (platform !== "darwin") return void 0;
  const parsed = cuaRequestAccessStatusSchema.safeParse({
    schemaVersion: 1,
    platform,
    grantOwner: report.grant_owner,
    accessibility: report.accessibility,
    screenRecording: report.screen_recording
  });
  return parsed.success ? parsed.data : void 0;
}
function attachCuaRequestAccessStatusMeta(result, platform, report) {
  const status = readCuaRequestAccessStatus(platform, report);
  if (!status) return result;
  return {
    ...result,
    _meta: {
      ...result._meta,
      [CUA_REQUEST_ACCESS_STATUS_META_KEY]: status
    }
  };
}
function explicitElementTarget(target) {
  const parsed = parseTarget(target);
  return parsed.type === "element" ? parsed : null;
}
function explicitElementStateId(target) {
  return explicitElementTarget(target)?.state_id;
}
function keyboardIdentityConstraints(appRef2) {
  if (!appRef2 || typeof appRef2 !== "object" || Array.isArray(appRef2)) return null;
  const record2 = appRef2;
  if (typeof record2.window_id !== "number" || !Number.isSafeInteger(record2.window_id) || record2.window_id === 0) {
    return null;
  }
  const constrained = ["pid", "bundle_id", "name", "window_id"].filter((field) => {
    const value = record2[field];
    return field === "pid" && typeof value === "number" && Number.isSafeInteger(value) && value > 0 || field === "window_id" && typeof value === "number" && Number.isSafeInteger(value) && value !== 0 || (field === "bundle_id" || field === "name") && typeof value === "string" && value.trim().length > 0;
  });
  return constrained.length > 1 ? record2 : null;
}
function processScopedKeyboardAppRef(appRef2) {
  return appRef2;
}
async function verifyCompoundKeyboardAppRef(deps, appRef2, method) {
  const expected = keyboardIdentityConstraints(appRef2);
  if (!expected) return;
  let captured;
  try {
    captured = await callBroker(
      deps,
      "capture_app",
      { app_ref: appRef2, include_screenshot: false },
      { kind: "read" }
    );
  } catch (error51) {
    if (isBrokerUnavailableException(error51)) throw error51;
    const details = brokerErrorDetails(error51);
    if (details?.reason === "surface_replaced") throw error51;
    const detail = error51 instanceof Error ? error51.message : String(error51);
    throw new Error(
      `${method}: compound app_ref could not be bound to one live application before keyboard dispatch (${detail}). action_sent=false.`
    );
  }
  const app = captured && typeof captured === "object" && !Array.isArray(captured) ? captured.app : null;
  const live = app && typeof app === "object" && !Array.isArray(app) ? app : null;
  const window2 = captured && typeof captured === "object" && !Array.isArray(captured) ? captured.window : null;
  const liveWindow = window2 && typeof window2 === "object" && !Array.isArray(window2) ? window2 : null;
  const appMismatch = !live || typeof expected.pid === "number" && live.pid !== expected.pid || typeof expected.bundle_id === "string" && (typeof live.bundle_id !== "string" || live.bundle_id.trim().toLowerCase() !== expected.bundle_id.trim().toLowerCase()) || typeof expected.name === "string" && (typeof live.name !== "string" || live.name.trim().toLowerCase() !== expected.name.trim().toLowerCase());
  const windowMismatch = typeof expected.window_id === "number" && (!liveWindow || liveWindow.window_id !== expected.window_id);
  if (!appMismatch && windowMismatch) {
    throw Object.assign(
      new Error(
        `${method}: surface_replaced; app_ref.window_id ${String(expected.window_id)} does not identify the current attached surface. Call get_app_state and use the new actual_window_id. action_sent=false.`
      ),
      {
        details: {
          action_sent: false,
          reason: "surface_replaced",
          recovery: "Call get_app_state and use the new attached surface identity; do not reuse the old window_id."
        }
      }
    );
  }
  if (appMismatch) {
    throw new Error(
      `${method}: pid, bundle_id, name, and window_id in app_ref must identify the same live application/window. Call list_apps/list_windows and reuse one row's identity fields. action_sent=false.`
    );
  }
}
var SKILL_REF2 = 'See SKILL.md "Choose the target".';
function textBlock3(text) {
  return { type: "text", text };
}
function textResult3(text) {
  return { content: [textBlock3(text)] };
}
function brokerErrorDetails(error51) {
  const details = error51?.details;
  return details && typeof details === "object" ? details : void 0;
}
function toolError3(text, details, _cause, _meta) {
  return details === void 0 ? { isError: true, content: [textBlock3(text)] } : { isError: true, content: [textBlock3(text)], structuredContent: { ...details } };
}
function keyboardDispatchErrorResult(deps, error51, options) {
  const dispatch = actionDispatchReceiptFromError(error51);
  if (!dispatch) return null;
  return postActionObserve(deps, {
    note: options.note,
    app_ref: options.appRef,
    return_state: options.returnState,
    dispatch
  });
}
function appRefHasIdentity(appRef2) {
  if (appRef2 === null || appRef2 === void 0 || typeof appRef2 !== "object") {
    return false;
  }
  const r = appRef2;
  return typeof r.pid === "number" && r.pid > 0 || typeof r.bundle_id === "string" && r.bundle_id.trim() !== "" || typeof r.name === "string" && r.name.trim() !== "";
}
function toText3(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
function typedTextNote(text) {
  const codePoints = Array.from(text).length;
  const utf16Units = text.length;
  return codePoints === utf16Units ? `Typed ${codePoints} character(s).` : `Typed ${codePoints} Unicode code point(s) (${utf16Units} UTF-16 code unit(s)).`;
}
async function defaultSleep2(seconds) {
  const cancelSignal = currentBrokerCancelSignal();
  await interruptibleBrokerSleep(seconds * 1e3, cancelSignal);
  if (cancelSignal?.cancelled) {
    throw new Error("wait was cancelled by the MCP client.");
  }
}
async function typeViaAppOrFocus(deps, text, returnState, appRef2, strategy) {
  if (text.length === 0) {
    return textResult3("Typed 0 character(s). action_sent=false.");
  }
  const hasRef = appRef2 !== void 0 && appRef2 !== null;
  if (hasRef && !appRefHasIdentity(appRef2)) {
    return toolError3(
      'type was called with an app_ref that has no pid, bundle_id, or name, so it cannot be scoped to a target app. Either pass an element target (target={"type":"element",...}) or call get_app_state first to bind a pid, then type(app_ref={"pid":...}). action_sent=false.'
    );
  }
  const method = hasRef ? "type_text_to_app" : "type_text";
  const params = { text };
  if (hasRef) params.app_ref = processScopedKeyboardAppRef(appRef2);
  if (strategy === "event") params.strategy = strategy;
  try {
    const result = await callBroker(deps, method, params, { kind: "action" });
    return postActionObserve(deps, {
      note: typedTextNote(text),
      app_ref: appRef2,
      return_state: returnState,
      dispatch: normalizeActionDispatchReceipt(result),
      dispatchRecord: result && typeof result === "object" && !Array.isArray(result) ? result : null
    });
  } catch (error51) {
    const result = keyboardDispatchErrorResult(deps, error51, {
      note: "Typing may already have reached the target app.",
      appRef: appRef2,
      returnState
    });
    if (result) return result;
    throw error51;
  }
}
async function coordinateHitTestPreflight(deps, target, resolved) {
  if (resolved.native || resolved.kind !== "coordinate") {
    return { native: resolved.native, app_ref: resolved.app_ref, note: "", softError: void 0 };
  }
  const hit = await resolveCoordinateToNative(deps, target);
  if (hit === null) {
    return { native: resolved.native, app_ref: resolved.app_ref, note: "", softError: void 0 };
  }
  if ("content" in hit) return { softError: hit };
  return {
    native: hit.native,
    app_ref: hit.app_ref,
    note: " (element resolved from the coordinate via the accessibility hit-test)",
    softError: void 0
  };
}
var typeTool = {
  name: "type",
  title: "Type",
  description: 'Type text into an editable element, a target app, or the current focus.\n\nPrefer element targets: `target` is an element target ({"type":"element","state_id","index"}); a coordinate target is accepted and first hit-tested through accessibility to the element owning that point (an empty or non-actuable point is refused with action_sent=false). With an editable element the default (strategy=auto/a11y) sets the field\'s value via accessibility -- no focus move, no global keystrokes -- so it works on a background/non-frontmost app and never steals focus; it REPLACES the field\'s contents (select_text first, or strategy=event, to insert). With `app_ref` and no element, this is app-scoped input: macOS posts to the target window through a synthetic-focus SkyLight session (background-safe, including Chromium); app_ref.window_id is preserved and verified immediately before dispatch. On Linux and Windows (neither has pid-targeted keyboard) the app MUST be frontmost or the call is refused -- prefer an editable element target when not frontmost. On macOS strategy=event requires the app and exact app_ref.window_id already frontmost and focused; it never activates implicitly. For open/save panels, first call confirmed open_application and re-observe. After Cmd+Shift+G, observe by pid/bundle without the old panel window_id, then type against the fresh attached_dialog actual_window_id. Without target/app_ref, a11y backends refuse because raw foreground text can hit the user\'s current-focus app; only non-a11y fallback backends use targetless current-focus typing.\nExample: type(text="hello", target={"type":"element","state_id":"s-1","index":1}).\n' + SKILL_REF2,
  inputSchema: typeSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    const hasTarget = args.target !== void 0 && args.target !== null;
    const hasAppRef = args.app_ref !== void 0 && args.app_ref !== null;
    if (hasTarget && hasAppRef) {
      return toolError3("type accepts either a target or an app_ref, not both. action_sent=false.");
    }
    try {
      if (hasAppRef) {
        await verifyCompoundKeyboardAppRef(deps, args.app_ref, "type");
      }
      if (hasTarget) {
        const r = resolveTargetOrSoftError(args.target, toolSession(deps));
        if ("content" in r) return r;
        const hit = await coordinateHitTestPreflight(deps, args.target, r.resolved);
        if (hit.softError) return hit.softError;
        const hitNote = hit.note;
        const nativeToken = hit.native;
        const nativeAppRef = hit.native ? hit.app_ref : r.resolved.app_ref ?? null;
        if (nativeToken && args.strategy !== "event") {
          const fingerprint = r.resolved.fingerprint ?? null;
          const targetStateId = explicitElementStateId(args.target);
          const mutation = toolSession(deps).beginMutation(
            nativeAppRef,
            typeof targetStateId === "string" ? targetStateId : null
          );
          if (fingerprint) {
            try {
              const result = await callBroker(
                deps,
                "element_set_value",
                { native: nativeToken, value: args.text },
                { kind: "action" }
              );
              return postActionObserve(deps, {
                note: args.text.length === 0 ? "Cleared the target element value by typing an empty string." : typedTextNote(args.text),
                app_ref: r.resolved.app_ref ?? null,
                return_state: args.return_state,
                stateConsistency: {
                  mutation,
                  dispatch: normalizeActionDispatchReceipt(result)
                }
              });
            } catch (error51) {
              const dispatch = actionDispatchReceiptFromError(error51);
              if (!dispatch) throw error51;
              return postActionObserve(deps, {
                note: "Type element value may already have reached the app.",
                app_ref: r.resolved.app_ref ?? null,
                return_state: args.return_state,
                stateConsistency: { mutation, dispatch }
              });
            }
          }
          try {
            const result = await callBroker(
              deps,
              "element_set_value",
              { native: nativeToken, value: args.text },
              { kind: "action" }
            );
            return postActionObserve(deps, {
              note: (args.text.length === 0 ? "Cleared the target element value by typing an empty string." : typedTextNote(args.text)) + hitNote,
              app_ref: nativeAppRef,
              return_state: args.return_state,
              stateConsistency: {
                mutation,
                dispatch: normalizeActionDispatchReceipt(result)
              }
            });
          } catch (error51) {
            const dispatch = actionDispatchReceiptFromError(error51);
            if (!dispatch) throw error51;
            return postActionObserve(deps, {
              note: "Type element value may already have reached the app.",
              app_ref: nativeAppRef,
              return_state: args.return_state,
              stateConsistency: { mutation, dispatch }
            });
          }
        }
        return await typeViaAppOrFocus(
          deps,
          args.text,
          args.return_state,
          nativeAppRef,
          args.strategy
        );
      }
      return await typeViaAppOrFocus(
        deps,
        args.text,
        args.return_state,
        args.app_ref ?? null,
        args.strategy
      );
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError3(e instanceof Error ? e.message : String(e), brokerErrorDetails(e));
    }
  }
};
var setValueTool = {
  name: "set_value",
  title: "Set Value",
  description: `Set a settable element's value directly via accessibility (BACKGROUND-safe; no focus move, no keystrokes). target is an element target ({"type":"element","state_id","index"}); a coordinate target is accepted and first hit-tested through accessibility to the element owning that point. Use this for sliders/steppers/controls that type refuses. For a document-backed text entry whose app must receive real edit notifications, strategy=event focuses that element and replaces its text through PID+bundle-verified keyboard input; non-text controls reject event strategy.
Example: set_value(target={"type":"element","state_id":"s-1","index":0}, value="72").
` + SKILL_REF2,
  inputSchema: setValueSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    const r = resolveTargetOrSoftError(args.target, toolSession(deps));
    if ("content" in r) return r;
    const hit = await coordinateHitTestPreflight(deps, args.target, r.resolved);
    if (hit.softError) return hit.softError;
    const nativeToken = hit.native;
    const nativeAppRef = (hit.native ? hit.app_ref : r.resolved.app_ref) ?? null;
    const hitNote = hit.note;
    if (!nativeToken) {
      return toolError3(
        "target did not resolve to a native element token; pass an element target from get_app_state."
      );
    }
    const observedFingerprint = r.resolved.fingerprint ?? null;
    const targetStateId = explicitElementStateId(args.target);
    const mutation = toolSession(deps).beginMutation(
      nativeAppRef,
      typeof targetStateId === "string" ? targetStateId : null
    );
    if (!observedFingerprint) {
      try {
        const result = await callBroker(
          deps,
          "element_set_value",
          { native: nativeToken, value: args.value, strategy: args.strategy },
          { kind: "action" }
        );
        return postActionObserve(deps, {
          note: `Set value request dispatched.${hitNote}`,
          app_ref: nativeAppRef,
          return_state: args.return_state,
          stateConsistency: {
            mutation,
            dispatch: normalizeActionDispatchReceipt(result)
          }
        });
      } catch (e) {
        const dispatch = actionDispatchReceiptFromError(e);
        if (dispatch) {
          return postActionObserve(deps, {
            note: "Set value request may already have reached the app.",
            app_ref: nativeAppRef,
            return_state: args.return_state,
            stateConsistency: { mutation, dispatch }
          });
        }
        if (shouldPropagateToWrapper(e)) throw e;
        return toolError3(e instanceof Error ? e.message : String(e));
      }
    }
    try {
      const result = await callBroker(
        deps,
        "element_set_value",
        {
          native: nativeToken,
          value: args.value,
          strategy: args.strategy
        },
        { kind: "action" }
      );
      return postActionObserve(deps, {
        note: "Set value request dispatched.",
        app_ref: r.resolved.app_ref ?? null,
        return_state: args.return_state,
        stateConsistency: {
          mutation,
          dispatch: normalizeActionDispatchReceipt(result)
        }
      });
    } catch (e) {
      const dispatch = actionDispatchReceiptFromError(e);
      if (dispatch) {
        return postActionObserve(deps, {
          note: "Set value request may already have reached the app.",
          app_ref: r.resolved.app_ref ?? null,
          return_state: args.return_state,
          stateConsistency: { mutation, dispatch }
        });
      }
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError3(e instanceof Error ? e.message : String(e), brokerErrorDetails(e));
    }
  }
};
var selectTextTool = {
  name: "select_text",
  title: "Select Text",
  description: 'Select a text range [start, length] in a text element, or place the caret. target must an element target ({"type":"element","state_id","index"}); a coordinate target is accepted. Background-safe via accessibility. Omit text_range to place the caret.\nExample: select_text(target={"type":"element","state_id":"s-1","index":1}, text_range=[0,3]).\n' + SKILL_REF2,
  inputSchema: selectTextSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    let pendingMutation = null;
    let pendingAppRef = null;
    try {
      let textRangeParam = {};
      if (args.text_range !== void 0 && args.text_range !== null) {
        try {
          const validated = validateTextRange(args.text_range);
          if (validated !== null) textRangeParam = { text_range: validated };
        } catch (e) {
          if (e instanceof InvalidTextRangeError) {
            return toolError3(`${e.message}. action_sent=false.`);
          }
          throw e;
        }
      }
      const r = resolveTargetOrSoftError(args.target, toolSession(deps));
      if ("content" in r) return r;
      const hit = await coordinateHitTestPreflight(deps, args.target, r.resolved);
      if (hit.softError) return hit.softError;
      const nativeToken = hit.native;
      const nativeAppRef = (hit.native ? hit.app_ref : r.resolved.app_ref) ?? null;
      const hitNote = hit.note;
      if (!nativeToken) {
        return toolError3(
          "target did not resolve to a native element token; pass an element target from get_app_state."
        );
      }
      const observedFingerprint = r.resolved.fingerprint ?? null;
      const selectTargetStateId = explicitElementStateId(args.target);
      const mutation = toolSession(deps).beginMutation(
        nativeAppRef,
        typeof selectTargetStateId === "string" ? selectTargetStateId : null
      );
      pendingMutation = mutation;
      pendingAppRef = nativeAppRef;
      if (!observedFingerprint) {
        const result2 = await callBroker(
          deps,
          "element_select_text",
          { native: nativeToken, ...textRangeParam },
          { kind: "action" }
        );
        const selRange = textRangeParam.text_range;
        const selIsCaret = !selRange || selRange[1] === 0;
        return postActionObserve(deps, {
          note: (selIsCaret ? `Caret placed at ${selRange ? selRange[0] : "current position"} (no text selected).` : `Text selected.`) + hitNote,
          app_ref: nativeAppRef,
          return_state: args.return_state,
          stateConsistency: {
            mutation,
            dispatch: normalizeActionDispatchReceipt(result2)
          }
        });
      }
      const fingerprint = r.resolved.fingerprint;
      const requestedRange = textRangeParam.text_range;
      if (requestedRange && typeof r.resolved.observedValue === "string" && textRangeSplitsUtf16SurrogatePair(r.resolved.observedValue, requestedRange)) {
        const fresh = await captureFreshFingerprintMatch(deps, {
          appRef: r.resolved.app_ref,
          fingerprint
        });
        if (typeof fresh?.value === "string" && textRangeSplitsUtf16SurrogatePair(fresh.value, requestedRange)) {
          return toolError3(
            "select_text refused: text_range boundary splits a UTF-16 surrogate pair; start and end must fall between complete Unicode characters. action_sent=false."
          );
        }
      }
      const result = await callBroker(
        deps,
        "element_select_text",
        { native: nativeToken, ...textRangeParam },
        { kind: "action" }
      );
      const range = textRangeParam.text_range;
      const isCaret = !range || range[1] === 0;
      const note = isCaret ? `Caret placed at ${range ? range[0] : "current position"} (no text selected).` : `Text selected.`;
      return postActionObserve(deps, {
        note,
        app_ref: r.resolved.app_ref ?? null,
        return_state: args.return_state,
        stateConsistency: {
          mutation,
          dispatch: normalizeActionDispatchReceipt(result)
        }
      });
    } catch (e) {
      const dispatch = actionDispatchReceiptFromError(e);
      if (dispatch && pendingMutation) {
        return postActionObserve(deps, {
          note: "Text-selection request may already have reached the app.",
          app_ref: pendingAppRef,
          return_state: args.return_state,
          stateConsistency: { mutation: pendingMutation, dispatch }
        });
      }
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError3(e instanceof Error ? e.message : String(e), brokerErrorDetails(e));
    }
  }
};
var keyTool = {
  name: "key",
  title: "Key",
  description: 'Press a non-text key or explicit chord (Return, Escape, Tab, cmd+a, arrows). Not for typing ordinary text -- use type(app_ref=..., text=...) for that. Negative repeat is refused, repeat=0 is a no-op, and positive values are clamped to 1..100. With `app_ref`, sends an app-scoped chord (macOS binds it to the verified CGWindowID through synthetic focus); on Linux and Windows (neither has pid-targeted keyboard) the app MUST be frontmost or the call is refused -- prefer an element target / perform_action when the app is not frontmost. Without `app_ref` this is a FOREGROUND-ONLY raw fallback: a11y backends refuse it because a GLOBAL key would reach the user\'s frontmost app; only non-a11y fallback backends use targetless current-focus keys. Modifiers are OS-specific: macOS cmd/shift/ctrl/alt; Linux ctrl/shift/alt/super; Windows ctrl/shift/alt/win. Use ctrl (not cmd) for shortcuts on Linux/Windows.\nOn macOS strategy="event" requires an already-frontmost, freshly verified app_ref.window_id; it never activates implicitly. File panels require confirmed open_application followed by a fresh observation; after Cmd+Shift+G, omit the old panel window_id once to discover and pin the focused attached_dialog. auto keeps the synthetic-focus background route. A focused submit button + Enter is auto-routed through the element action path, no strategy needed.\nExample: key(text="return", app_ref={"pid":1}).\n' + SKILL_REF2,
  inputSchema: keySchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    const unsupportedToken = findUnsupportedKeyToken(args.text);
    if (unsupportedToken) {
      return toolError3(
        `key text contains unsupported key token '${unsupportedToken}'. action_sent=false.`
      );
    }
    const hasAppRef = args.app_ref !== void 0 && args.app_ref !== null;
    if (hasAppRef && !appRefHasIdentity(args.app_ref)) {
      return toolError3(
        'key was called with an app_ref that has no pid, bundle_id, or name, so it cannot be scoped to a target app. Call get_app_state first to bind a pid, then key(text=..., app_ref={"pid":...}). action_sent=false.'
      );
    }
    const requested = args.repeat ?? 1;
    if (requested < 0) {
      return toolError3(`key repeat must be non-negative (got ${requested}). action_sent=false.`);
    }
    if (requested === 0) {
      return textResult3("No key event sent because key repeat is 0 (no-op). action_sent=false.");
    }
    try {
      if (hasAppRef) {
        await verifyCompoundKeyboardAppRef(deps, args.app_ref, "key");
      }
      const clamped = clampKeyRepeat(requested);
      const method = hasAppRef ? "press_key_to_app" : "press_key";
      const params = { text: args.text };
      if (hasAppRef) params.app_ref = processScopedKeyboardAppRef(args.app_ref);
      if (args.strategy) params.strategy = args.strategy;
      const note = clamped.clamped ? `Key pressed ${clamped.value} time(s) (requested ${requested}, clamped to 1..100).` : `Key pressed ${clamped.value} time(s).`;
      let dispatch;
      let dispatchRecord = null;
      for (let i = 0; i < clamped.value; i++) {
        const result = await callBroker(deps, method, params, { kind: "action" });
        dispatch = normalizeActionDispatchReceipt(result);
        dispatchRecord = result && typeof result === "object" && !Array.isArray(result) ? result : null;
      }
      return postActionObserve(deps, {
        note,
        app_ref: args.app_ref,
        return_state: args.return_state,
        ...dispatch ? { dispatch } : {},
        dispatchRecord
      });
    } catch (e) {
      const receiptResult = keyboardDispatchErrorResult(deps, e, {
        note: "Key press may already have reached the target app.",
        appRef: args.app_ref,
        returnState: args.return_state
      });
      if (receiptResult) return receiptResult;
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError3(e instanceof Error ? e.message : String(e), brokerErrorDetails(e));
    }
  }
};
var holdKeyTool = {
  name: "hold_key",
  title: "Hold Key",
  description: 'Hold a key or chord for a duration (clamped to 0..30 seconds). With `app_ref`, holds an app-scoped chord (macOS binds it to the verified background CGWindowID); on Linux and Windows (neither has window-targeted keyboard) the app MUST be frontmost or the call is refused -- prefer an element target when the app is not frontmost. Without `app_ref` this is a FOREGROUND-ONLY raw fallback: a11y backends refuse a targetless hold because a GLOBAL key would reach the user\'s frontmost app. On macOS, auto keeps the verified background window route; strategy="event" requires an already-frontmost, fresh app_ref.window_id and never activates implicitly.\nExample: hold_key(text="shift", duration=1.0, app_ref={"pid":1}).\n' + SKILL_REF2,
  inputSchema: holdKeySchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    const unsupportedToken = findUnsupportedKeyToken(args.text);
    if (unsupportedToken) {
      return toolError3(
        `hold_key text contains unsupported key token '${unsupportedToken}'. action_sent=false.`
      );
    }
    const hasAppRef = args.app_ref !== void 0 && args.app_ref !== null;
    if (hasAppRef && !appRefHasIdentity(args.app_ref)) {
      return toolError3(
        'hold_key was called with an app_ref that has no pid, bundle_id, or name, so it cannot be scoped to a target app. Call get_app_state first to bind a pid, then hold_key(text=..., duration=..., app_ref={"pid":...}). action_sent=false.'
      );
    }
    const duration3 = args.duration;
    if (duration3 < 0) {
      return toolError3(
        `hold_key duration must be non-negative (got ${duration3}). action_sent=false.`
      );
    }
    if (duration3 === 0) {
      return textResult3(
        "No key event sent because hold_key duration is 0 (no-op). action_sent=false."
      );
    }
    try {
      if (hasAppRef) {
        await verifyCompoundKeyboardAppRef(deps, args.app_ref, "hold_key");
      }
      const result = boundDuration(duration3, "duration");
      const bounded = result.value;
      const method = hasAppRef ? "hold_key_to_app" : "hold_key";
      const hold = deps.inputHolds?.begin();
      const holdSessionKey = hold?.key ?? toolSessionKey(deps);
      const params = {
        text: args.text,
        duration: bounded,
        session_key: holdSessionKey
      };
      if (hasAppRef) params.app_ref = processScopedKeyboardAppRef(args.app_ref);
      if (args.strategy) params.strategy = args.strategy;
      const cancelSignal = currentBrokerCancelSignal();
      const unsubscribe = cancelSignal?.onCancel?.(() => {
        if (deps.inputHolds && !deps.inputHolds.claimCancellation(holdSessionKey)) {
          return;
        }
        void callBrokerControl(
          deps,
          "cancel_input_holds",
          { session_key: holdSessionKey },
          { kind: "action", timeoutMs: 2e3 }
        ).catch(() => void 0);
      });
      try {
        try {
          await callBroker(deps, method, params, { kind: "action" });
        } catch (error51) {
          const detail = error51 instanceof Error ? error51.message : String(error51);
          const legacyCancelledHold = method === "hold_key_to_app" && /hold_key_to_app: verified pid-scoped input(?: to \d+)? failed \(rejected\)/u.test(
            detail
          );
          if (legacyCancelledHold && deps.inputHolds?.cancellationWasClaimed(holdSessionKey)) {
            throw new Error(
              `hold_key was cancelled while native input was in flight; events may have been sent and cancellation cleanup was requested. Native terminal detail: ${detail}`
            );
          }
          throw error51;
        }
      } finally {
        unsubscribe?.();
        hold?.end();
      }
      const note = bounded !== duration3 ? `Key held for ${bounded}s (requested ${duration3}, clamped to 0..30).` : `Key held for ${bounded}s.`;
      return postActionObserve(deps, {
        note,
        app_ref: args.app_ref,
        return_state: args.return_state
      });
    } catch (e) {
      const receiptResult = keyboardDispatchErrorResult(deps, e, {
        note: "Key hold may already have reached the target app.",
        appRef: args.app_ref,
        returnState: args.return_state
      });
      if (receiptResult) return receiptResult;
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError3(e instanceof Error ? e.message : String(e), brokerErrorDetails(e));
    }
  }
};
function resolveActionAlias(requested, allowed) {
  if (allowed.includes(requested)) return requested;
  const families = [
    ["press", "axpress", "invoke", "click"],
    ["show_menu", "showmenu", "axshowmenu", "menu"],
    ["pick", "axpick", "select", "selection"]
  ];
  const normalizedRequested = requested.trim().toLowerCase().replaceAll("-", "_");
  const family = families.find((names) => names.includes(normalizedRequested));
  if (!family) return requested;
  return allowed.find((action) => family.includes(action.trim().toLowerCase().replaceAll("-", "_"))) ?? requested;
}
var performActionTool = {
  name: "perform_action",
  title: "Perform Action",
  description: "Invoke a named accessibility action on an element. `action` must be one of that element's `actions` from the current state (server-validated). For ordinary buttons, activation is the element's listed Press/Invoke action; a scroll-to-visible action only scrolls an element into view and does not activate/click it. An open/activate action opens or launches the target (like a double-click) \u2014 it does NOT merely select it; to just select a list or table row, click it rather than opening it, since opening will launch the item.",
  inputSchema: performActionSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    const r = resolveTargetOrSoftError(args.target, toolSession(deps));
    if ("content" in r) return r;
    const hit = await coordinateHitTestPreflight(deps, args.target, r.resolved);
    if (hit.softError) return hit.softError;
    const nativeToken = hit.native;
    const nativeAppRef = (hit.native ? hit.app_ref : r.resolved.app_ref) ?? null;
    const hitNote = hit.note;
    if (!nativeToken) {
      return toolError3(
        "target did not resolve to a native element token; pass an element target from get_app_state."
      );
    }
    const observedFingerprint = r.resolved.fingerprint ?? null;
    const performTargetStateId = explicitElementStateId(args.target);
    const mutation = toolSession(deps).beginMutation(
      nativeAppRef,
      typeof performTargetStateId === "string" ? performTargetStateId : null
    );
    if (!observedFingerprint) {
      try {
        const result = await callBroker(
          deps,
          "element_perform_action",
          { native: nativeToken, action: args.action },
          { kind: "action" }
        );
        return postActionObserve(deps, {
          note: `Dispatched ${args.action}.` + hitNote,
          app_ref: nativeAppRef,
          return_state: args.return_state,
          stateConsistency: {
            mutation,
            dispatch: normalizeActionDispatchReceipt(result)
          }
        });
      } catch (e) {
        const dispatch = actionDispatchReceiptFromError(e);
        if (dispatch) {
          return postActionObserve(deps, {
            note: `Dispatch of ${args.action} may already have reached the app.`,
            app_ref: nativeAppRef,
            return_state: args.return_state,
            stateConsistency: { mutation, dispatch }
          });
        }
        if (shouldPropagateToWrapper(e)) throw e;
        return toolError3(e instanceof Error ? e.message : String(e));
      }
    }
    const tgt = explicitElementTarget(args.target);
    let action = args.action;
    if (tgt) {
      const el = toolSession(deps).get(tgt.state_id)?.elements[tgt.index];
      if (el && el.enabled === false) {
        return toolError3(
          `perform_action refused: element [${tgt.index}] is disabled (enabled=false). Disabled controls must not be activated. action_sent=false.`
        );
      }
      if (el) action = resolveActionAlias(args.action, el.actions);
      if (el && !el.actions.includes(action)) {
        return toolError3(
          `perform_action refused: action ${JSON.stringify(args.action)} is not available on element [${tgt.index}]; allowed: ${JSON.stringify(el.actions)}. action_sent=false. Call get_app_state and pass one of the target element's \`actions\`.`
        );
      }
    }
    try {
      const result = await callBroker(
        deps,
        "element_perform_action",
        { native: nativeToken, action },
        { kind: "action" }
      );
      return postActionObserve(deps, {
        note: `Dispatched ${action}.` + (action !== args.action ? ` (normalized from ${args.action})` : ""),
        app_ref: r.resolved.app_ref ?? null,
        return_state: args.return_state,
        stateConsistency: {
          mutation,
          dispatch: normalizeActionDispatchReceipt(result)
        }
      });
    } catch (e) {
      const dispatch = actionDispatchReceiptFromError(e);
      if (dispatch) {
        return postActionObserve(deps, {
          note: `Dispatch of ${action} may already have reached the app.`,
          app_ref: r.resolved.app_ref ?? null,
          return_state: args.return_state,
          stateConsistency: { mutation, dispatch }
        });
      }
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError3(e instanceof Error ? e.message : String(e), brokerErrorDetails(e));
    }
  }
};
var requestAccessTool = {
  name: "request_access",
  title: "Request Access",
  description: "Report OS permission readiness and the current server action-policy mode.\n\nThis tool is permanently read-only: it probes OS permission records, the broker's declared capabilities, and live permission health without popping native permission dialogs or changing authorization. A live health probe may internally validate an already-granted capture path, but no image is returned.\n\nCapabilities are probes, not grants, and calling this tool cannot approve mutating or sensitive actions. Missing grants must be requested through the trusted ZCode host UI, outside the model-visible MCP surface.\n\nOn macOS this surfaces TCC grants; on Linux and Windows there are no TCC-style gates -- a healthy report means the broker + AX bus are reachable.",
  inputSchema: requestAccessSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    try {
      const params = {};
      if (args.capabilities !== void 0 && args.capabilities !== null) {
        params.capabilities = args.capabilities;
      }
      const brokerInfo = await callBroker(
        deps,
        "broker_info",
        {},
        {
          kind: "read"
        }
      );
      if (!brokerInfo || typeof brokerInfo !== "object" || Array.isArray(brokerInfo)) {
        throw new Error("request_access expected an object from broker_info");
      }
      const result = brokerInfo.platform === "darwin" ? await callBroker(deps, "permission_status", {}, { kind: "read" }) : await callBroker(deps, "request_access", params, { kind: "read" });
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("request_access expected an object permission report from the Helper");
      }
      const guardPayload = {
        ...result,
        requested_capabilities: args.capabilities ?? [],
        // A successful authenticated broker_info round trip is itself the
        // authoritative connectivity proof. Older Helpers omit `connected`
        // from broker_info, which made request_access report an indeterminate
        // broker and caused product-owner E2E reconciliation to fail despite
        // the live socket having just answered.
        broker: { ...brokerInfo, connected: true },
        side_effects: {
          permission_prompted: false,
          automation_warmup_attempted: false,
          screen_capture_attempted: false
        },
        guard: toolKillSwitch(deps).status()
      };
      return attachCuaRequestAccessStatusMeta(
        textResult3(toText3(guardPayload)),
        brokerInfo.platform,
        result
      );
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError3(e instanceof Error ? e.message : String(e), brokerErrorDetails(e));
    }
  }
};
var stopComputerControlTool = {
  name: "stop_computer_control",
  title: "Stop Computer Control",
  description: "Stop computer control for this session: refuses all further actions and releases a left mouse button held by this session (or recovers an orphaned button no session owns \u2014 e.g. a drag interrupted mid-gesture). Enforced, not just cooperative.",
  inputSchema: stopComputerControlSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    const killSwitch = toolKillSwitch(deps);
    killSwitch.stop(args.reason ?? null);
    let cancellationAvailable = false;
    try {
      cancellationAvailable = await cancelHeldKeys(deps);
    } catch {
    }
    let releasedLeftMouse = false;
    const sessionKey = toolSessionKey(deps);
    const recoverMouse = async () => {
      try {
        await callBroker(
          deps,
          "mouse_up",
          {
            button: "left",
            session_key: sessionKey,
            app_ref: deps.inputState?.appRef
          },
          { kind: "action" }
        );
        deps.pointerHoldGuard?.release(sessionKey);
        if (deps.inputState) {
          deps.inputState.leftMouseDown = false;
          deps.inputState.appRef = void 0;
        }
        releasedLeftMouse = true;
      } catch {
      }
    };
    if (cancellationAvailable) {
      await recoverMouse();
    } else {
      void recoverMouse();
    }
    const guardStatus = killSwitch.status();
    const payload = {
      stopped: true,
      // Report the effective, latched reason. A repeated stop is intentionally
      // idempotent and must not claim that its ignored reason took effect.
      reason: guardStatus.stop_reason,
      released_left_mouse: releasedLeftMouse,
      guard: guardStatus
    };
    return textResult3(JSON.stringify(payload));
  }
};
var waitTool = {
  name: "wait",
  title: "Wait",
  description: "Pause for a duration in seconds (clamped to 0..30). Re-observe afterwards.",
  inputSchema: waitSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    const duration3 = args.duration;
    if (duration3 < 0) {
      return toolError3(`wait duration must be non-negative (got ${duration3}).`);
    }
    const result = boundDuration(duration3, "duration");
    const bounded = result.value;
    const sleep = deps.sleep ?? defaultSleep2;
    try {
      await sleep(bounded);
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError3(e instanceof Error ? e.message : String(e), brokerErrorDetails(e));
    }
    return textResult3(waitNote(bounded, duration3));
  }
};
var readClipboardTool = {
  name: "read_clipboard",
  title: "Read Clipboard",
  description: "Read the system clipboard.",
  inputSchema: readClipboardSchema,
  buildHandler: (deps) => async () => {
    try {
      const result = await callBroker(deps, "read_clipboard", {}, { kind: "read" });
      if (typeof result !== "string") {
        throw new Error(
          `read_clipboard returned ${result === null ? "null" : typeof result}; expected a string from the Helper.`
        );
      }
      return textResult3(JSON.stringify({ text: result }));
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError3(e instanceof Error ? e.message : String(e), brokerErrorDetails(e));
    }
  }
};
var writeClipboardTool = {
  name: "write_clipboard",
  title: "Write Clipboard",
  description: "Write text to the system clipboard.",
  inputSchema: writeClipboardSchema,
  buildHandler: (deps) => async (input) => {
    const args = input;
    try {
      await callBroker(deps, "write_clipboard", { text: args.text }, { kind: "action" });
      return textResult3("Clipboard written.");
    } catch (e) {
      if (shouldPropagateToWrapper(e)) throw e;
      return toolError3(e instanceof Error ? e.message : String(e), brokerErrorDetails(e));
    }
  }
};
var keyboardRuntimeTools = [
  // KEYBOARD (5)
  typeTool,
  setValueTool,
  selectTextTool,
  keyTool,
  holdKeyTool,
  // SEMANTIC (1)
  performActionTool,
  // RUNTIME (5)
  requestAccessTool,
  stopComputerControlTool,
  waitTool,
  readClipboardTool,
  writeClipboardTool
];
export {
  AGENT_B64_BUDGET,
  APP_INSTRUCTIONS,
  AccessibilitySession,
  ActionTier,
  BLANK_CANDIDATE,
  CAPTURE_APP_TIMEOUT_MS,
  CUA_REQUEST_ACCESS_STATUS_META_KEY,
  DEFAULT_FRAME_TTL_MS,
  DEFAULT_JPEG_QUALITY,
  DEFAULT_MAX_EDGE,
  DEFAULT_MAX_FRAMES,
  DEFAULT_MAX_STATES,
  DEFAULT_MCP_SESSION_KEY,
  DRAG_NOTE,
  EMPTY_CAPTURE_GUIDANCE,
  FILE_URL_WINDOW_VERIFY_ATTEMPTS,
  FINITE_BOOL_MSG,
  FINITE_MSG,
  FINITE_STRING_MSG,
  FRAME_PIXEL_TRANSFORM_VERSION,
  FrameRegistry,
  FrameRegistryError,
  GLOBAL_SCREEN_COORDINATE_CONTRACT,
  HEAL_MAX_DISPLACEMENT_PX,
  InputHoldRegistry,
  InvalidTextRangeError,
  JFIF_APP0,
  KEY_REPEAT_MAX,
  KEY_REPEAT_MIN,
  KillSwitch,
  MAX_EDGE,
  MAX_EMPTY_TREE_WARMUPS,
  MIN_QUALITY,
  MOUSE_DOWN_NOTE,
  MOUSE_UP_NOTE,
  MOVE_NOTE,
  NUM_INT_BOOL_MSG,
  NUM_INT_INT_MSG,
  NUM_INT_STRING_MSG,
  NegativeDurationError,
  OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY,
  OPEN_APPLICATION_APP_PROPERTIES,
  PNG_SIG,
  POINTER_MODIFIER_ALIASES,
  PUBLIC_KEY_TOKENS,
  QUALITY_STEP,
  READ_ONLY_TOOLS,
  RESTRICTED_MODE_TIERS,
  SAFETY_CONTROL_TOOLS,
  SCROLL_AMOUNT_MAX,
  SCROLL_AMOUNT_MIN,
  SHRINK_FACTOR,
  SHRINK_MIN_EDGE,
  SKILL_REF,
  SKILL_REF2,
  TIER_TABLE,
  TargetResolveError,
  ZOOM_ERR_BOTH,
  ZOOM_ERR_NEITHER,
  actionDispatchReceiptFromError,
  actionReceiptBlock,
  appRef,
  appRefFromState,
  appRefHasIdentity,
  appRefMatchesFrame,
  appRefNullable,
  applicationName,
  asBounds,
  asBounds2,
  asElements,
  asRgbRawFromBuffer,
  asSurfaceKind,
  asSurfaceKind2,
  attachCuaRequestAccessStatusMeta,
  b64Len,
  bindFramePixelTarget,
  bindPointerTarget,
  boundDuration,
  boundsCenter,
  boundsNear,
  brokerErrorDetails,
  buildFromElement,
  bundleBranch,
  callPointerAction,
  cancelHeldKeys,
  captureFileUrlWindowBaseline,
  captureFingerprint,
  captureFreshElements,
  captureFreshFingerprintMatch,
  capturedDisplay,
  clampKeyRepeat,
  clampScrollAmount,
  classifyTier,
  cleanupStdioSession,
  clickShape,
  clickToolDef,
  cloneAndFreeze,
  closePipForEndedSession,
  coercePixel,
  composeSourceCrop,
  composeZoom,
  compositeAlphaOntoWhite,
  computeAgentSize,
  coordinateHitTestPreflight,
  coordinateTargetArg,
  coordinateTargetJSONSchema,
  createPointerHoldGuard,
  cuaRequestAccessStatusSchema,
  cursorPositionSchema,
  cursorPositionTool,
  deepFreeze,
  defaultKillSwitch,
  defaultLockPath,
  defaultSession,
  defaultSleep2,
  displayActionTools,
  displayTopologyFingerprint,
  distinguishableTargets,
  doubleClickSchema,
  doubleClickTool,
  elementCenter,
  elementPriority,
  elementRow,
  elementTargetArg,
  elementTargetJSONSchema,
  encodeJpegFromSharp,
  encodeScreenshotFromPng,
  encodeScreenshotRaw,
  encodeUnderBudget,
  explicitElementStateId,
  explicitElementTarget,
  extractAppRefPid,
  fileTarget,
  findAppInstruction,
  findFingerprintMatch,
  findSameCaptureVisualMatchInRawElements,
  findUnsupportedKeyToken,
  finiteFloat,
  flag,
  formatAppInstructions,
  formatAppStateTree,
  frameActionProvenance,
  frameBindingKind,
  frameDispatchIdentityError,
  frameScopedAppRef,
  freshSurfaceMatches,
  getAppStateSchema,
  getAppStateTool,
  getDefaultKillSwitch,
  getDefaultSession,
  globalPointerHoldGuard,
  hasOneToOneWindowMatch,
  holdKeySchema,
  holdKeyTool,
  imageBlock,
  imageRefBlock,
  imageWithRef,
  implicitFrameBindings,
  ingestCaptureAppResult,
  injectJfifApp0,
  isIncrementalSnapshotResult,
  issueCaptureFrame,
  keySchema,
  keyTool,
  keyboardDispatchErrorResult,
  keyboardIdentityConstraints,
  keyboardRuntimeTools,
  leftClickDragSchema,
  leftClickDragTool,
  leftClickSchema,
  leftClickTool,
  leftMouseDownSchema,
  leftMouseDownTool,
  leftMouseUpSchema,
  leftMouseUpTool,
  listAppsSchema,
  listAppsTool,
  listDisplaysSchema,
  listDisplaysTool,
  listWindowsSchema,
  listWindowsTool,
  loadRgbaRawFromBuffer,
  loadSharp,
  mapAppStateResult,
  mapRawCaptureAppResult,
  mapZoomResult,
  middleClickSchema,
  middleClickTool,
  mimeTypeFor,
  mouseMoveSchema,
  mouseMoveTool,
  mutationScopeFrom,
  mutationScopeHasAppIdentity,
  nameBranch,
  norm,
  normalizeActionDispatchReceipt,
  normalizeCandidate,
  normalizeImageFormat,
  normalizePointerModifiers,
  normalizeTitle,
  normalizeValue,
  noteObservation,
  numInt,
  observationFingerprint,
  observationTools,
  observationToolsByName,
  openApplicationAppArg,
  openApplicationAppArgJSONSchema,
  openApplicationAppBranch,
  openApplicationSchema,
  openApplicationTool,
  parseAppFrameSurfaceSet,
  parseAppRef,
  parseDisplay,
  parseScreenshotCaptureWindows,
  parseTarget,
  parseTopology,
  performActionSchema,
  performActionTool,
  pidBranch,
  pointerActionError,
  pointerDispatchErrorResult,
  pointerResolveError,
  pointerTools,
  pointerToolsByName,
  postActionObserve,
  present,
  probeScreenshotSize,
  processIsAlive,
  processScopedKeyboardAppRef,
  projectFramePixelToPointer,
  publicDisplayList,
  readClipboardSchema,
  readClipboardTool,
  readCuaRequestAccessStatus,
  releaseHeldPointer,
  renderInstructionBlock,
  requestAccessSchema,
  requestAccessTool,
  resizeLanczos,
  resolveActionAlias,
  resolveCapturedDisplay,
  resolveCoordinate,
  resolveCoordinateFrame,
  resolveCoordinateToNative,
  resolveElement,
  resolveExpectedPid,
  resolveFramePixelTarget,
  resolveTarget,
  resolveTargetForClick,
  resolveTargetOrSoftError,
  resolvedActionAppRef,
  returnStateEnum,
  rgbRawToSharp,
  rightClickSchema,
  rightClickTool,
  roundHalfToEven,
  runClick,
  runWithSession,
  sameApp,
  sameWindow,
  screenshotSchema,
  screenshotTool,
  scrollDirectionEnum,
  scrollNote,
  scrollSchema,
  scrollTool,
  selectTextSchema,
  selectTextTool,
  sessionContext,
  setValueSchema,
  setValueTool,
  sharedAppProperties,
  sharpPromise,
  softError,
  splitsUtf16SurrogatePair,
  stateUnavailableBlock,
  stopComputerControlSchema,
  stopComputerControlTool,
  strategyEnum,
  stringifiedJsonArray,
  stripPngIcc,
  switchDisplaySchema,
  switchDisplayTool,
  synthesizeLabel,
  targetArg,
  targetArgJSONSchema,
  targetArgNullable,
  targetHasFrameAuthority,
  textBlock,
  textBlock2,
  textBlock3,
  textRangeSplitsUtf16SurrogatePair,
  textResult,
  textResult2,
  textResult3,
  titleMatches,
  toText,
  toText2,
  toText3,
  toolAnnotationsFor,
  toolError,
  toolError2,
  toolError3,
  toolKillSwitch,
  toolSession,
  toolSessionKey,
  tripleClickSchema,
  tripleClickTool,
  truncate,
  typeSchema,
  typeTool,
  typeViaAppOrFocus,
  typedTextNote,
  unsentPointerIdentityError,
  unwrapStringifiedObject,
  validateTextRange,
  verifiedPointerAppRef,
  verifyCompoundKeyboardAppRef,
  verifyFileUrlWindowEffect,
  visibleElementCenter,
  waitNote,
  waitSchema,
  waitTool,
  windowIds,
  withOfficialFrameIntegrity,
  writeClipboardSchema,
  writeClipboardTool,
  zoomSchema,
  zoomTool
};
