import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
declare var KillSwitch: {
    new (): {
        stopped: boolean;
        stopReason: any;
        /** Latch the kill-switch. Idempotent — calling twice keeps the first
         * reason (Python: `stopped=True` assignment + `stop_reason` overwrite,
         * but we keep the original reason to preserve audit order). */
        stop(reason: any): void;
        /**
         * Tool-entry preflight. Throws {@link ControlStopped} after `stop()` has
         * fired. Call before any backend read or target revalidation so the
         * kill-switch fails hard before touching the machine (Python:
         * `state.guard.ensure_running()` at the top of every tool body).
         */
        ensureRunning(): void;
        isStopped(): boolean;
        status(): {
            stopped: boolean;
            stop_reason: any;
        };
        /** Test hook — reset to the un-stopped state. */
        resetForTest(): void;
    };
};
declare var defaultKillSwitch: any;
declare function getDefaultKillSwitch(): any;
declare function processIsAlive(pid: any): boolean;
declare function defaultLockPath(): string;
declare function createPointerHoldGuard(options?: any): {
    acquire(sessionKey: any): "none" | "same" | "other";
    ownerState: (sessionKey: any) => "none" | "same" | "other";
    release(sessionKey: any): boolean;
};
declare var globalPointerHoldGuard: {
    acquire(sessionKey: any): "none" | "same" | "other";
    ownerState: (sessionKey: any) => "none" | "same" | "other";
    release(sessionKey: any): boolean;
};
declare var InputHoldRegistry: {
    new (sessionKey: any): {
        nextId: number;
        active: Set<unknown>;
        cancellationClaimed: Set<unknown>;
        begin(): {
            key: string;
            end: () => void;
        };
        activeKeys(): unknown[];
        claimCancellation(key: any): boolean;
        cancellationWasClaimed(key: any): boolean;
    };
};
declare var FRAME_PIXEL_TRANSFORM_VERSION: string;
declare var FrameRegistryError: {
    new (reason: any, message: any, frame_id?: any): {
        reason: any;
        frame_id: any;
        name: string;
        message: string;
        stack?: string;
        cause?: unknown;
    };
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;
    prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
    stackTraceLimit: number;
};
declare function cloneAndFreeze(value: any): any;
declare function deepFreeze(value: any): any;
declare var FrameRegistry: {
    new (options: any): {
        session_id: any;
        maxFrames: any;
        maxTombstones: any;
        now: any;
        frames: Map<any, any>;
        latestActionableFrameId: any;
        tombstones: Map<any, any>;
        register(input: any): any;
        resolve(frame_id: any): any;
        /**
         * Resolve model-supplied pixel authority. Retained descriptors remain
         * actionable until TTL/LRU/actionability checks fail them closed.
         */
        resolveForAction(frame_id: any): any;
        /**
         * Bind model-visible pixels to this transport's current raster authority.
         *
         * frame_id 是 transport 内部权限，默认坐标动作不要求模型转抄。这里仍复用
         * resolveForAction 的 TTL/actionability 检查；没有权威帧时 fail-closed。
         */
        resolveLatestForAction(): any;
        get(frame_id: any): any;
        tombstoneReason(frame_id: any): any;
        clear(): void;
        evictOverflow(): void;
        rememberTombstone(frame_id: any, reason: any): void;
        recoveryMessage(frame_id: any, reason: any): string;
    };
};
declare var DEFAULT_MAX_STATES: number;
declare var DEFAULT_MAX_FRAMES: number;
declare var DEFAULT_FRAME_TTL_MS: number;
declare var MAX_EMPTY_TREE_WARMUPS: number;
declare var AccessibilitySession: {
    new (maxStates?: number): {
        /** Insertion-ordered map — `Map` iteration is insertion order, so the
         * first entry is the least-recently-used. Re-touching on `get` moves an
         * entry to the end (most-recently-used). */
        entries: Map<any, any>;
        maxStates: any;
        counter: number;
        frameRegistry: any;
        frameSessionId: any;
        issuedFrameIds: Set<unknown>;
        frameGeneration: number;
        /** Stable native display id selected by this MCP transport. */
        selectedDisplayId: any;
        /** Consecutive observation state is transport-scoped just like state ids
         * and visual frames. One HTTP client must not nudge another client to act. */
        lastObservationKey: any;
        observationRepeatCount: number;
        /** App/window identities that already received the one-shot empty AX-tree warmup. */
        emptyTreeWarmups: Set<unknown>;
        /** 动作进入原生调用后，本次引用的旧观察不再具有执行权限。 */
        supersededStateIds: Set<unknown>;
        issueFrame(input: any): any;
        /** Next monotonic state_id `s-N`, matching Python's `f"s-{self._counter}"`. */
        nextStateId(): string;
        /** Cache a freshly observed state. Re-inserting an existing state_id
         * refreshes its LRU position (mirrors `_states[state_id] = state` followed
         * by the move_to_end in Python's per-app LRU). Evicts the oldest entry
         * when over capacity. */
        remember(state: any): void;
        /** Look up a cached state. Returns null if unknown/evicted (mirrors
         * Python's `StateError` path — callers surface that as a soft MCP error
         * so the model re-runs `get_app_state`). Touches the entry to refresh its
         * LRU position on hit. */
        get(state_id: any): any;
        has(state_id: any): boolean;
        isSuperseded(state_id: any): boolean;
        /** 在原生调用前冻结基线，不改变任何可执行状态。 */
        beginMutation(appRef2: any, preStateId: any): {
            scope: {
                pid: any;
                bundle_id: any;
                name: any;
                window_id: any;
            };
            preActionState: any;
        };
        /**
         * 原生调用已经开始：不能再依据 AX 返回值猜测副作用是否发生。只废弃本次动作
         * 实际引用的 pre_state_id；同 app/window 的其它已观察状态不被 scope-wide 锁死。
         */
        markMutationDispatched(ticket: any): void;
        /** 废弃动作明确引用、但已被 Helper 证明失效的唯一 state。 */
        consumeReferencedState(ticket: any): void;
        requiresRefresh(appRef2: any): boolean;
        /**
         * The most-recently-used state_id (last key — `Map` iteration is touch
         * order, so the last key is MRU), or null when no state is cached. Used to
         * tell the model which state_id to reuse for a delta/no_change response,
         * which does not ingest a fresh tree and therefore does not assign a new
         * session id. Never surface the broker's own snapshot counter id — the
         * resolver only knows session-assigned ids.
         */
        lastStateId(): any;
        /**
         * Return the newest cached state that belongs to the observed app/window.
         * Incremental broker replies carry no element tree, so their frontend
         * state_id may only reuse a baseline with the same ownership boundary.
         */
        lastStateIdFor(app: any, window2: any, options?: any): any;
        /**
         * Return the newest cached pre-action state matching an app_ref. Action
         * verification uses this immutable observation as its baseline; the broker
         * may successfully accept an input event while the target UI ignores it.
         */
        latestStateForAppRef(appRef2: any, options?: any): any;
        selectDisplay(displayId: any): void;
        selectedDisplay(): any;
        clearSelectedDisplay(): void;
        /** Record a fingerprint and return its consecutive count in this session. */
        noteObservation(key: any): number;
        /** Reset only the repeat-observation streak (test/diagnostic helper). */
        resetObservationFingerprint(): void;
        /**
         * Claim the one allowed empty-tree warmup for this app/window in this
         * transport session. Stable canvas/video windows may legitimately expose
         * no AX nodes, so repeated observations must not pay another capture.
         */
        claimEmptyTreeWarmup(app: any, window2: any): boolean;
        /** Test hook — drop every cached state and reset the counter. */
        clear(): void;
        /** Current cache size (test/diagnostic helper). */
        get size(): number;
    };
};
declare function mutationScopeFrom(appRef2: any, fallback: any): {
    pid: any;
    bundle_id: any;
    name: any;
    window_id: any;
};
declare function mutationScopeHasAppIdentity(scope: any): boolean;
declare function sameApp(cached2: any, observed: any): boolean;
declare function sameWindow(cached2: any, observed: any): any;
declare var defaultSession: any;
declare var sessionContext: AsyncLocalStorage<unknown>;
declare function getDefaultSession(): any;
declare function runWithSession(session: any, callback: any): unknown;
declare var ActionTier: {
    READ_ONLY: string;
    T1_INPUT: string;
    SAFETY_CONTROL: string;
};
declare var READ_ONLY_TOOLS: Set<string>;
declare var SAFETY_CONTROL_TOOLS: Set<string>;
declare var TIER_TABLE: Readonly<{
    list_apps: string;
    open_application: string;
    list_windows: string;
    get_app_state: string;
    screenshot: string;
    zoom: string;
    list_displays: string;
    switch_display: string;
    cursor_position: string;
    left_click: string;
    double_click: string;
    triple_click: string;
    right_click: string;
    middle_click: string;
    scroll: string;
    left_click_drag: string;
    mouse_move: string;
    left_mouse_down: string;
    left_mouse_up: string;
    type: string;
    set_value: string;
    select_text: string;
    key: string;
    hold_key: string;
    perform_action: string;
    request_access: string;
    stop_computer_control: string;
    wait: string;
    read_clipboard: string;
    write_clipboard: string;
}>;
declare function classifyTier(name: any): string;
declare var RESTRICTED_MODE_TIERS: Set<string>;
declare function toolAnnotationsFor(name: any): {
    readOnlyHint: boolean;
    destructiveHint: boolean;
};
declare var DEFAULT_MCP_SESSION_KEY: string;
declare function toolSession(deps: any): any;
declare function toolSessionKey(deps: any): any;
declare function toolKillSwitch(deps: any): any;
declare var sharpPromise: any;
declare function loadSharp(): any;
declare function asSurfaceKind(value: any): any;
declare function parseAppFrameSurfaceSet(value: any): {
    presentation_window_id: any;
    before_fingerprint: any;
    after_fingerprint: any;
    order: string;
    surfaces: any;
};
declare function asBounds(value: any, where: any): number[];
declare function asElements(raw: any): any;
declare function asSurfaceKind2(value: any): any;
declare function probeScreenshotSize(screenshot: any): Promise<{
    width: any;
    height: any;
}>;
declare function issueCaptureFrame(raw: any, app: any, window2: any, session: any): Promise<any>;
declare function ingestCaptureAppResult(raw: any, options: any): Promise<{
    state_id: any;
    app: {
        bundle_id: any;
        pid: any;
        name: any;
        window_id: any;
        aumid: any;
        executable_path: any;
        icon_png: any;
    };
    window: {
        title: any;
        bounds: number[];
        window_id: any;
        window_id_fallback: true;
        empty_capture_reason: any;
        note: any;
        actual_window_id: any;
        presentation_window_id: any;
        surface_kind: any;
        surface_lifecycle: any;
    };
    elements: any;
    has_image: boolean;
    image_size: {
        width: any;
        height: any;
    };
    screenshot_blank: true;
}>;
declare var GLOBAL_SCREEN_COORDINATE_CONTRACT: string;
declare var EMPTY_CAPTURE_GUIDANCE: {
    "cg-only-no-ax-window": string;
    "ax-window-empty-tree": string;
};
declare function flag(value: any, label: any): any;
declare function synthesizeLabel(el: any, index: any): string;
declare function elementRow(index: any, el: any, detail: any): string;
declare function truncate(text: any, max: any): any;
declare function formatAppStateTree(state: any, detail?: string): string;
declare function elementPriority(el: any, windowBounds: any): number;
declare function projectFramePixelToPointer(frame: any, pixel: any): {
    x: any;
    y: any;
};
declare var implicitFrameBindings: WeakSet<WeakKey>;
declare function frameBindingKind(target: any): "implicit" | "explicit";
declare function bindFramePixelTarget(target: any, context: any): {
    type: string;
    frame_id: any;
    x: any;
    y: any;
};
declare function resolveFramePixelTarget(target: any, context: any): {
    frame_id: any;
    point: {
        x: any;
        y: any;
    };
};
declare function unwrapStringifiedObject(value: any): any;
declare function present(value: any, key: any, obj: any): boolean;
declare function parseAppRef(value: any): {};
declare var appRef: z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>;
declare var appRefNullable: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
declare var elementTargetJSONSchema: {
    type: string;
    required: string[];
    description: string;
    properties: {
        type: {
            const: string;
        };
        state_id: {
            type: string;
            description: string;
        };
        index: {
            type: string;
            description: string;
        };
    };
    additionalProperties: boolean;
};
declare var coordinateTargetJSONSchema: {
    type: string;
    required: string[];
    description: string;
    properties: {
        type: {
            const: string;
        };
        frame_id: {
            type: string;
            minLength: number;
            description: string;
        };
        x: {
            type: string;
            minimum: number;
        };
        y: {
            type: string;
            minimum: number;
        };
    };
    additionalProperties: boolean;
};
declare var targetArgJSONSchema: {
    description: string;
    anyOf: ({
        type: string;
        required: string[];
        description: string;
        properties: {
            type: {
                const: string;
            };
            state_id: {
                type: string;
                description: string;
            };
            index: {
                type: string;
                description: string;
            };
        };
        additionalProperties: boolean;
    } | {
        type: string;
        required: string[];
        description: string;
        properties: {
            type: {
                const: string;
            };
            frame_id: {
                type: string;
                minLength: number;
                description: string;
            };
            x: {
                type: string;
                minimum: number;
            };
            y: {
                type: string;
                minimum: number;
            };
        };
        additionalProperties: boolean;
    })[];
};
declare var OPEN_APPLICATION_APP_PROPERTIES: {
    bundle_id: {
        type: string;
        description: string;
    };
    name: {
        type: string;
        description: string;
    };
    pid: {
        type: string;
        description: string;
    };
    url: {
        type: string;
        description: string;
    };
    urls: {
        type: string;
        items: {
            type: string;
        };
        description: string;
    };
};
declare function openApplicationAppBranch(required2: any): {
    type: string;
    required: any[];
    properties: {
        bundle_id: {
            type: string;
            description: string;
        };
        name: {
            type: string;
            description: string;
        };
        pid: {
            type: string;
            description: string;
        };
        url: {
            type: string;
            description: string;
        };
        urls: {
            type: string;
            items: {
                type: string;
            };
            description: string;
        };
    };
    additionalProperties: boolean;
};
declare var openApplicationAppArgJSONSchema: {
    description: string;
    anyOf: {
        type: string;
        required: any[];
        properties: {
            bundle_id: {
                type: string;
                description: string;
            };
            name: {
                type: string;
                description: string;
            };
            pid: {
                type: string;
                description: string;
            };
            url: {
                type: string;
                description: string;
            };
            urls: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
        };
        additionalProperties: boolean;
    }[];
};
declare function coercePixel(value: any, name: any): number;
declare function parseTarget(value: any): {
    type: string;
    state_id: string;
    index: number;
} | {
    x: number;
    y: number;
    frame_id?: any;
    type: string;
    state_id?: undefined;
    index?: undefined;
};
declare var targetArg: z.ZodUnknown;
declare var targetArgNullable: z.ZodOptional<z.ZodUnknown>;
declare function elementTargetArg(opts: any): z.ZodUnknown | z.ZodOptional<z.ZodUnknown>;
declare function coordinateTargetArg(opts: any): z.ZodUnknown | z.ZodOptional<z.ZodUnknown>;
declare function boundsCenter(bounds: any): {
    x: any;
    y: any;
};
declare function normalizeTitle(title: any): any;
declare function normalizeValue(value: any): string;
declare var HEAL_MAX_DISPLACEMENT_PX: number;
declare function boundsNear(a: any, b: any, maxPx?: number): boolean;
declare function captureFingerprint(element: any, bundleId: any, surface: any): {
    role: any;
    title: any;
    value: string;
    bounds: any;
    editable: any;
    bundle_id: string;
    actual_window_id: any;
    presentation_window_id: any;
};
declare function findFingerprintMatch(stored: any, candidates: any, options?: any): {
    reason: string;
    match_criteria: string;
    confidence: string;
    value_matched: boolean;
    native: any;
    bounds: any;
    value: any;
};
declare function findSameCaptureVisualMatchInRawElements(stored: any, storedNative: any, rawElements: any): {
    reason: string;
    match_criteria: string;
    confidence: string;
    value_matched: boolean;
    native: any;
    bounds: any;
    value: any;
} | {
    role: any;
    kind: any;
    title: any;
    value: any;
    bounds: number[];
    enabled: any;
    editable: any;
    actions: any;
    focused: any;
    pressable: any;
    has_menu: any;
    native: any;
    owner_pid: any;
};
declare function captureFreshElements(deps: any, appRef2: any): Promise<{
    elements: {
        role: any;
        kind: any;
        title: any;
        value: any;
        bounds: number[];
        enabled: any;
        editable: any;
        actions: any;
        focused: any;
        pressable: any;
        has_menu: any;
        native: any;
        owner_pid: any;
    }[];
    actual_window_id: any;
    presentation_window_id: any;
}>;
declare function freshSurfaceMatches(stored: any, fresh: any): boolean;
declare function captureFreshFingerprintMatch(deps: any, ctx: any): Promise<{
    reason: string;
    match_criteria: string;
    confidence: string;
    value_matched: boolean;
    native: any;
    bounds: any;
    value: any;
}>;
declare function normalizeCandidate(entry: any): {
    role: any;
    kind: any;
    title: any;
    value: any;
    bounds: number[];
    enabled: any;
    editable: any;
    actions: any;
    focused: any;
    pressable: any;
    has_menu: any;
    native: any;
    owner_pid: any;
};
declare var BLANK_CANDIDATE: {
    role: string;
    kind: string;
    title: any;
    value: any;
    bounds: number[];
    enabled: boolean;
    editable: boolean;
    actions: any[];
    focused: boolean;
    pressable: boolean;
    has_menu: boolean;
    native: string;
    owner_pid: any;
};
declare function asBounds2(value: any): number[];
declare var TargetResolveError: {
    new (reason: any, message: any, stateId?: any): {
        reason: any;
        stateId: any;
        name: string;
        message: string;
        stack?: string;
        cause?: unknown;
    };
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;
    prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
    stackTraceLimit: number;
};
declare function elementCenter(bounds: any): {
    x: any;
    y: any;
};
declare function visibleElementCenter(elementBounds: any, windowBounds: any): {
    x: any;
    y: any;
};
declare function appRefFromState(state: any): {};
declare function resolveElement(target: any, ctx: any): {
    app_ref: {};
    isElement: boolean;
    kind: string;
    observedValue: any;
};
declare function buildFromElement(element: any, state: any): {
    app_ref: {};
    isElement: boolean;
    kind: string;
    observedValue: any;
};
declare function resolveCoordinate(target: any, ctx: any, bindingKind: any): {
    point: {
        x: any;
        y: any;
    };
    app_ref: {
        window_id?: any;
        pid?: any;
        bundle_id?: any;
    };
    isElement: boolean;
    kind: string;
};
declare function resolveTarget(target: any, ctx: any): {
    app_ref: {};
    isElement: boolean;
    kind: string;
    observedValue: any;
} | {
    point: {
        x: any;
        y: any;
    };
    app_ref: {
        window_id?: any;
        pid?: any;
        bundle_id?: any;
    };
    isElement: boolean;
    kind: string;
};
declare function displayTopologyFingerprint(displays: any): string;
declare function parseDisplay(value: any): {
    index: any;
    id: any;
    bounds: any[];
    main: boolean;
    scale_factor: number;
};
declare function parseTopology(value: any): {
    index: any;
    id: any;
    bounds: any[];
    main: boolean;
    scale_factor: number;
}[];
declare function capturedDisplay(selected: any, topology: any): {
    index: any;
    id: any;
    bounds: any;
    topology_fingerprint: string;
};
declare function resolveCapturedDisplay(_deps: any, reply: any): Promise<{
    index: any;
    id: any;
    bounds: any;
    topology_fingerprint: string;
}>;
declare function roundHalfToEven(n: any): number;
declare var MAX_EDGE: number;
declare function computeAgentSize(w: any, h: any, maxEdge?: number): {
    w: any;
    h: any;
};
declare function resizeLanczos(input: any, w: any, h: any): Promise<any>;
declare var AGENT_B64_BUDGET: number;
declare var MIN_QUALITY: number;
declare var QUALITY_STEP: number;
declare var SHRINK_FACTOR: number;
declare var SHRINK_MIN_EDGE: number;
declare function b64Len(byteLen: any): number;
declare var JFIF_APP0: Buffer<ArrayBuffer>;
declare function injectJfifApp0(jpeg: any): any;
declare function encodeJpegFromSharp(img: any, quality: any): Promise<any>;
declare function encodeUnderBudget(inputRgb: any, inputW: any, inputH: any, quality: any, maxB64: any): Promise<{
    bytes: any;
    finalQuality: any;
    finalWidth: any;
    finalHeight: any;
    shrinkTrail: any[];
}>;
declare var NUM_INT_BOOL_MSG: string;
declare var NUM_INT_STRING_MSG: string;
declare var NUM_INT_INT_MSG: string;
declare var numInt: z.ZodUnknown;
declare var FINITE_BOOL_MSG: string;
declare var FINITE_STRING_MSG: string;
declare var FINITE_MSG: string;
declare var finiteFloat: z.ZodUnknown;
declare var SCROLL_AMOUNT_MAX: number;
declare var SCROLL_AMOUNT_MIN: number;
declare var KEY_REPEAT_MAX: number;
declare var KEY_REPEAT_MIN: number;
declare var CAPTURE_APP_TIMEOUT_MS: number;
declare var NegativeDurationError: {
    new (field: any): {
        name: string;
        message: string;
        stack?: string;
        cause?: unknown;
    };
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;
    prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
    stackTraceLimit: number;
};
declare var InvalidTextRangeError: {
    new (reason: any): {
        name: string;
        message: string;
        stack?: string;
        cause?: unknown;
    };
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;
    prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
    stackTraceLimit: number;
};
declare function boundDuration(duration3: any, field: any): {
    value: number;
    clamped: boolean;
    requested: any;
} | {
    value: any;
    clamped: boolean;
    requested?: undefined;
};
declare function clampScrollAmount(scrollAmount: any): {
    value: number;
    clamped: boolean;
    requested: any;
} | {
    value: any;
    clamped: boolean;
    requested?: undefined;
};
declare function clampKeyRepeat(repeat: any): {
    value: number;
    clamped: boolean;
    requested: any;
} | {
    value: any;
    clamped: boolean;
    requested?: undefined;
};
declare function validateTextRange(textRange: any): number[];
declare function waitNote(bounded: any, requested: any): string;
declare function scrollNote(applied: any, requested: any): string;
declare var strategyEnum: z.ZodEnum<{
    event: "event";
    auto: "auto";
    a11y: "a11y";
}>;
declare var returnStateEnum: z.ZodEnum<{
    none: "none";
    full: "full";
    compact: "compact";
}>;
declare var scrollDirectionEnum: z.ZodEnum<{
    left: "left";
    right: "right";
    down: "down";
    up: "up";
}>;
declare function stringifiedJsonArray(schema: any): z.ZodPreprocess<any, unknown>;
declare var applicationName: z.ZodString;
declare var sharedAppProperties: {
    bundle_id: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    pid: z.ZodOptional<z.ZodNumber>;
    window_id: z.ZodOptional<z.ZodNumber>;
    url: z.ZodOptional<z.ZodString>;
    urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
};
declare var bundleBranch: z.ZodObject<{
    bundle_id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    pid: z.ZodOptional<z.ZodNumber>;
    window_id: z.ZodOptional<z.ZodNumber>;
    url: z.ZodOptional<z.ZodString>;
    urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
}, z.core.$strict>;
declare var nameBranch: z.ZodObject<{
    name: z.ZodString;
    bundle_id: z.ZodOptional<z.ZodString>;
    pid: z.ZodOptional<z.ZodNumber>;
    window_id: z.ZodOptional<z.ZodNumber>;
    url: z.ZodOptional<z.ZodString>;
    urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
}, z.core.$strict>;
declare var pidBranch: z.ZodObject<{
    pid: z.ZodNumber;
    bundle_id: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    window_id: z.ZodOptional<z.ZodNumber>;
    url: z.ZodOptional<z.ZodString>;
    urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
}, z.core.$strict>;
declare var openApplicationAppArg: z.ZodPreprocess<z.ZodUnion<readonly [z.ZodObject<{
    bundle_id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    pid: z.ZodOptional<z.ZodNumber>;
    window_id: z.ZodOptional<z.ZodNumber>;
    url: z.ZodOptional<z.ZodString>;
    urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
}, z.core.$strict>, z.ZodObject<{
    name: z.ZodString;
    bundle_id: z.ZodOptional<z.ZodString>;
    pid: z.ZodOptional<z.ZodNumber>;
    window_id: z.ZodOptional<z.ZodNumber>;
    url: z.ZodOptional<z.ZodString>;
    urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
}, z.core.$strict>, z.ZodObject<{
    pid: z.ZodNumber;
    bundle_id: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    window_id: z.ZodOptional<z.ZodNumber>;
    url: z.ZodOptional<z.ZodString>;
    urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
}, z.core.$strict>]>, unknown>;
declare var listAppsSchema: z.ZodObject<{}, z.core.$strict>;
declare var openApplicationSchema: z.ZodObject<{
    app: z.ZodPreprocess<z.ZodUnion<readonly [z.ZodObject<{
        bundle_id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        pid: z.ZodOptional<z.ZodNumber>;
        window_id: z.ZodOptional<z.ZodNumber>;
        url: z.ZodOptional<z.ZodString>;
        urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
    }, z.core.$strict>, z.ZodObject<{
        name: z.ZodString;
        bundle_id: z.ZodOptional<z.ZodString>;
        pid: z.ZodOptional<z.ZodNumber>;
        window_id: z.ZodOptional<z.ZodNumber>;
        url: z.ZodOptional<z.ZodString>;
        urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
    }, z.core.$strict>, z.ZodObject<{
        pid: z.ZodNumber;
        bundle_id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        window_id: z.ZodOptional<z.ZodNumber>;
        url: z.ZodOptional<z.ZodString>;
        urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
    }, z.core.$strict>]>, unknown>;
    activate: z.ZodDefault<z.ZodBoolean>;
    new_instance: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
declare var listWindowsSchema: z.ZodObject<{
    app_ref: z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>;
}, z.core.$strict>;
declare var getAppStateSchema: z.ZodObject<{
    app_ref: z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>;
    detail: z.ZodDefault<z.ZodEnum<{
        full: "full";
        compact: "compact";
    }>>;
    include_screenshot: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
declare var screenshotSchema: z.ZodObject<{}, z.core.$strict>;
declare var zoomSchema: z.ZodObject<{
    frame_id: z.ZodOptional<z.ZodString>;
    region: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<any, unknown>>>;
    target: z.ZodUnknown | z.ZodOptional<z.ZodUnknown>;
}, z.core.$strict>;
declare var listDisplaysSchema: z.ZodObject<{}, z.core.$strict>;
declare var switchDisplaySchema: z.ZodObject<{
    index: z.ZodUnknown;
}, z.core.$strict>;
declare var cursorPositionSchema: z.ZodObject<{}, z.core.$strict>;
declare var clickShape: {
    target: z.ZodUnknown;
    modifiers: z.ZodDefault<z.ZodString>;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
};
declare var leftClickSchema: z.ZodObject<{
    target: z.ZodUnknown;
    modifiers: z.ZodDefault<z.ZodString>;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
}, z.core.$strict>;
declare var doubleClickSchema: z.ZodObject<{
    target: z.ZodUnknown;
    modifiers: z.ZodDefault<z.ZodString>;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
}, z.core.$strict>;
declare var tripleClickSchema: z.ZodObject<{
    target: z.ZodUnknown;
    modifiers: z.ZodDefault<z.ZodString>;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
}, z.core.$strict>;
declare var rightClickSchema: z.ZodObject<{
    target: z.ZodUnknown;
    modifiers: z.ZodDefault<z.ZodString>;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
}, z.core.$strict>;
declare var middleClickSchema: z.ZodObject<{
    target: z.ZodUnknown;
    modifiers: z.ZodDefault<z.ZodString>;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
}, z.core.$strict>;
declare var scrollSchema: z.ZodObject<{
    target: z.ZodUnknown;
    scroll_direction: z.ZodEnum<{
        left: "left";
        right: "right";
        down: "down";
        up: "up";
    }>;
    scroll_amount: z.ZodUnknown;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
}, z.core.$strict>;
declare var leftClickDragSchema: z.ZodObject<{
    from_target: z.ZodUnknown;
    to: z.ZodUnknown;
    modifiers: z.ZodDefault<z.ZodString>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
}, z.core.$strict>;
declare var mouseMoveSchema: z.ZodObject<{
    coordinate: z.ZodUnknown | z.ZodOptional<z.ZodUnknown>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
}, z.core.$strict>;
declare var leftMouseDownSchema: z.ZodObject<{
    target: z.ZodUnknown;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
}, z.core.$strict>;
declare var leftMouseUpSchema: z.ZodObject<{
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
}, z.core.$strict>;
declare var PUBLIC_KEY_TOKENS: Set<string>;
declare function findUnsupportedKeyToken(text: any): any;
declare var typeSchema: z.ZodObject<{
    text: z.ZodString;
    target: z.ZodOptional<z.ZodUnknown>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
}, z.core.$strict>;
declare var setValueSchema: z.ZodObject<{
    target: z.ZodUnknown;
    value: z.ZodString;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
}, z.core.$strict>;
declare var selectTextSchema: z.ZodObject<{
    target: z.ZodUnknown;
    text_range: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<any, unknown>>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
}, z.core.$strict>;
declare var keySchema: z.ZodObject<{
    text: z.ZodString;
    repeat: z.ZodOptional<z.ZodNullable<z.ZodUnknown>>;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
}, z.core.$strict>;
declare var holdKeySchema: z.ZodObject<{
    text: z.ZodString;
    duration: z.ZodUnknown;
    app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
    strategy: z.ZodDefault<z.ZodEnum<{
        event: "event";
        auto: "auto";
        a11y: "a11y";
    }>>;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
}, z.core.$strict>;
declare var performActionSchema: z.ZodObject<{
    target: z.ZodUnknown;
    action: z.ZodString;
    return_state: z.ZodDefault<z.ZodEnum<{
        none: "none";
        full: "full";
        compact: "compact";
    }>>;
}, z.core.$strict>;
declare var requestAccessSchema: z.ZodObject<{
    capabilities: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<any, unknown>>>;
}, z.core.$strict>;
declare var stopComputerControlSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
declare var waitSchema: z.ZodObject<{
    duration: z.ZodUnknown;
}, z.core.$strict>;
declare var readClipboardSchema: z.ZodObject<{}, z.core.$strict>;
declare var writeClipboardSchema: z.ZodObject<{
    text: z.ZodString;
}, z.core.$strict>;
declare var DEFAULT_JPEG_QUALITY: number;
declare var DEFAULT_MAX_EDGE: number;
declare var ZOOM_ERR_BOTH: string;
declare var ZOOM_ERR_NEITHER: string;
declare function composeSourceCrop(parent: any, crop: any): {
    left: any;
    top: any;
    right: any;
    bottom: any;
};
declare function composeZoom(deps: any, args: any, options: any): Promise<{
    image: {
        data: any;
        format: string;
    };
    image_ref: any;
    text_blocks: any[];
}>;
declare var APP_INSTRUCTIONS: {
    app: string;
    bundle_ids: string[];
    name_patterns: string[];
    instructions: string[];
}[];
declare function norm(value: any): any;
declare function findAppInstruction(input: any): {
    app: string;
    bundle_ids: string[];
    name_patterns: string[];
    instructions: string[];
};
declare function formatAppInstructions(input: any): string;
declare function renderInstructionBlock(entry: any): string;
declare var PNG_SIG: Buffer<ArrayBuffer>;
declare function stripPngIcc(png: any): any;
declare function loadRgbaRawFromBuffer(png: any): Promise<{
    data: any;
    width: any;
    height: any;
    channels: any;
}>;
declare function compositeAlphaOntoWhite(rgba: any): {
    data: Buffer<ArrayBuffer>;
    width: any;
    height: any;
    channels: number;
};
declare function asRgbRawFromBuffer(png: any): Promise<{
    data: any;
    width: any;
    height: any;
    channels: any;
}>;
declare function rgbRawToSharp(rgb: any): Promise<any>;
declare function encodeScreenshotRaw(rgb: any, opts?: any): Promise<{
    originalBytes: any;
    agentBytes: any;
    mediaFormat: string;
    geometry: {
        original: {
            width: any;
            height: any;
        };
        agent: {
            width: any;
            height: any;
        };
    };
    finalQuality: any;
    shrinkTrail: any[];
}>;
declare function encodeScreenshotFromPng(png: any, opts: any): Promise<{
    originalBytes: any;
    agentBytes: any;
    mediaFormat: string;
    geometry: {
        original: {
            width: any;
            height: any;
        };
        agent: {
            width: any;
            height: any;
        };
    };
    finalQuality: any;
    shrinkTrail: any[];
}>;
declare var FILE_URL_WINDOW_VERIFY_ATTEMPTS: number;
declare function fileTarget(rawUrl: any): {
    filename: any;
    stem: any;
};
declare function windowIds(windows: any): Set<unknown>;
declare function titleMatches(title: any, target: any): any;
declare function distinguishableTargets(targets: any): any;
declare function hasOneToOneWindowMatch(windows: any, baseline: any): any;
declare function captureFileUrlWindowBaseline(listWindows: any, urls: any): Promise<{
    targets: any;
    windowIds: Set<unknown>;
    windowTitles: Map<unknown, unknown>;
}>;
declare function verifyFileUrlWindowEffect(listWindows: any, baseline: any, options?: any): Promise<"unavailable" | "verified">;
declare var OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY: string;
declare function textBlock(text: any): {
    type: string;
    text: any;
};
declare function imageBlock(data: any, format: any): {
    type: string;
    data: any;
    mimeType: string;
};
declare function imageRefBlock(imageRef: any): {
    type: string;
    text: any;
};
declare function imageWithRef(imageRef: any, data: any, format: any): ({
    type: string;
    text: any;
} | {
    type: string;
    data: any;
    mimeType: string;
})[];
declare function withOfficialFrameIntegrity(result: any, imageRef: any, data: any, format: any, session: any): any;
declare function mimeTypeFor(format: any): string;
declare function normalizeImageFormat(format: any): any;
declare function textResult(text: any): {
    content: {
        type: string;
        text: any;
    }[];
};
declare function toolError(text: any, details?: unknown): {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent?: undefined;
} | {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent: any;
};
declare function toText(value: any): string;
declare function mapAppStateResult(result: any): {
    content: {
        type: string;
        text: any;
    }[];
} | {
    isError?: boolean;
    content: any;
};
declare function mapRawCaptureAppResult(result: any, detail: any, includeTree: any, options: any): Promise<any>;
declare function actionReceiptBlock(receipt: any): {
    type: string;
    text: any;
};
declare function stateUnavailableBlock(error51: any): {
    type: string;
    text: any;
};
declare function normalizeActionDispatchReceipt(result: any): {
    target_verification_status?: any;
    ax_error?: any;
    action_sent: boolean;
    dispatch_status: any;
};
declare function actionDispatchReceiptFromError(error51: any): {
    ax_error?: any;
    action_sent: boolean;
    dispatch_status: string;
};
declare function postActionObserve(deps: any, opts: any): Promise<any>;
declare function mapZoomResult(result: any, session: any): any;
declare function observationFingerprint(raw: any): string;
declare function noteObservation(raw: any, session?: any): any;
declare var listAppsTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{}, z.core.$strict>;
    buildHandler: (deps: any) => () => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
};
declare var openApplicationTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        app: z.ZodPreprocess<z.ZodUnion<readonly [z.ZodObject<{
            bundle_id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            pid: z.ZodOptional<z.ZodNumber>;
            window_id: z.ZodOptional<z.ZodNumber>;
            url: z.ZodOptional<z.ZodString>;
            urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
        }, z.core.$strict>, z.ZodObject<{
            name: z.ZodString;
            bundle_id: z.ZodOptional<z.ZodString>;
            pid: z.ZodOptional<z.ZodNumber>;
            window_id: z.ZodOptional<z.ZodNumber>;
            url: z.ZodOptional<z.ZodString>;
            urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
        }, z.core.$strict>, z.ZodObject<{
            pid: z.ZodNumber;
            bundle_id: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            window_id: z.ZodOptional<z.ZodNumber>;
            url: z.ZodOptional<z.ZodString>;
            urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
        }, z.core.$strict>]>, unknown>;
        activate: z.ZodDefault<z.ZodBoolean>;
        new_instance: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
};
declare var listWindowsTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        app_ref: z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
};
declare var getAppStateTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        app_ref: z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>;
        detail: z.ZodDefault<z.ZodEnum<{
            full: "full";
            compact: "compact";
        }>>;
        include_screenshot: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare function isIncrementalSnapshotResult(result: any): boolean;
declare var screenshotTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{}, z.core.$strict>;
    buildHandler: (deps: any) => () => Promise<any>;
};
declare var zoomTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        frame_id: z.ZodOptional<z.ZodString>;
        region: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<any, unknown>>>;
        target: z.ZodUnknown | z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var listDisplaysTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{}, z.core.$strict>;
    buildHandler: (deps: any) => () => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
};
declare var switchDisplayTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        index: z.ZodUnknown;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
};
declare function publicDisplayList(value: any): any[];
declare function parseScreenshotCaptureWindows(value: any): {
    fingerprint: any;
    order: string;
    windows: {
        accepts_left_mouse_down?: any;
        window_id: any;
        owner_pid: any;
        owner_bundle_id: any;
        layer: any;
        bounds: any[];
    }[];
};
declare var cursorPositionTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{}, z.core.$strict>;
    buildHandler: (deps: any) => () => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
};
declare var observationTools: ({
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        app: z.ZodPreprocess<z.ZodUnion<readonly [z.ZodObject<{
            bundle_id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            pid: z.ZodOptional<z.ZodNumber>;
            window_id: z.ZodOptional<z.ZodNumber>;
            url: z.ZodOptional<z.ZodString>;
            urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
        }, z.core.$strict>, z.ZodObject<{
            name: z.ZodString;
            bundle_id: z.ZodOptional<z.ZodString>;
            pid: z.ZodOptional<z.ZodNumber>;
            window_id: z.ZodOptional<z.ZodNumber>;
            url: z.ZodOptional<z.ZodString>;
            urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
        }, z.core.$strict>, z.ZodObject<{
            pid: z.ZodNumber;
            bundle_id: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            window_id: z.ZodOptional<z.ZodNumber>;
            url: z.ZodOptional<z.ZodString>;
            urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
        }, z.core.$strict>]>, unknown>;
        activate: z.ZodDefault<z.ZodBoolean>;
        new_instance: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        app_ref: z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        app_ref: z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>;
        detail: z.ZodDefault<z.ZodEnum<{
            full: "full";
            compact: "compact";
        }>>;
        include_screenshot: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{}, z.core.$strict>;
    buildHandler: (deps: any) => () => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        frame_id: z.ZodOptional<z.ZodString>;
        region: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<any, unknown>>>;
        target: z.ZodUnknown | z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
})[];
declare var displayActionTools: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        index: z.ZodUnknown;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
}[];
declare var observationToolsByName: Map<string, {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        app: z.ZodPreprocess<z.ZodUnion<readonly [z.ZodObject<{
            bundle_id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            pid: z.ZodOptional<z.ZodNumber>;
            window_id: z.ZodOptional<z.ZodNumber>;
            url: z.ZodOptional<z.ZodString>;
            urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
        }, z.core.$strict>, z.ZodObject<{
            name: z.ZodString;
            bundle_id: z.ZodOptional<z.ZodString>;
            pid: z.ZodOptional<z.ZodNumber>;
            window_id: z.ZodOptional<z.ZodNumber>;
            url: z.ZodOptional<z.ZodString>;
            urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
        }, z.core.$strict>, z.ZodObject<{
            pid: z.ZodNumber;
            bundle_id: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            window_id: z.ZodOptional<z.ZodNumber>;
            url: z.ZodOptional<z.ZodString>;
            urls: z.ZodOptional<z.ZodPreprocess<any, unknown>>;
        }, z.core.$strict>]>, unknown>;
        activate: z.ZodDefault<z.ZodBoolean>;
        new_instance: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        app_ref: z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        app_ref: z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>;
        detail: z.ZodDefault<z.ZodEnum<{
            full: "full";
            compact: "compact";
        }>>;
        include_screenshot: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{}, z.core.$strict>;
    buildHandler: (deps: any) => () => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        frame_id: z.ZodOptional<z.ZodString>;
        region: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<any, unknown>>>;
        target: z.ZodUnknown | z.ZodOptional<z.ZodUnknown>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        index: z.ZodUnknown;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
}>;
declare function textBlock2(text: any): {
    type: string;
    text: any;
};
declare function textResult2(text: any): {
    content: {
        type: string;
        text: any;
    }[];
};
declare function toolError2(text: any, details?: any, _cause?: unknown): {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent?: undefined;
} | {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent: any;
};
declare function pointerResolveError(error51: any): {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent?: undefined;
} | {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent: any;
};
declare function bindPointerTarget(deps: any, rawTarget: any): {
    type: string;
    frame_id: any;
    x: any;
    y: any;
} | {
    type: string;
    state_id: string;
    index: number;
} | {
    x: number;
    y: number;
    frame_id?: any;
    type: string;
    state_id?: undefined;
    index?: undefined;
};
declare function resolveCoordinateFrame(deps: any, target: any, bindingKind?: string): any;
declare var POINTER_MODIFIER_ALIASES: {
    cmd: string;
    command: string;
    super: string;
    meta: string;
    shift: string;
    opt: string;
    option: string;
    alt: string;
    ctrl: string;
    control: string;
};
declare function normalizePointerModifiers(value: any, method: any): string;
declare function pointerActionError(error51: any, method: any): {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent?: undefined;
} | {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent: any;
};
declare function pointerDispatchErrorResult(deps: any, error51: any, options: any): Promise<any> | {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent?: undefined;
} | {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent: any;
};
declare function toText2(value: any): string;
declare function resolvedActionAppRef(result: any, fallback: any): any;
declare function resolveTargetForClick(deps: any, target: any): Promise<{
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent?: undefined;
} | {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent: any;
} | {
    point: any;
    app_ref: {};
    fingerprint: any;
    native: any;
}>;
declare function extractAppRefPid(appRef2: any): number;
declare function unsentPointerIdentityError(error51: any): Error;
declare function callPointerAction(deps: any, method: any, params: any, targets: any): Promise<any>;
declare function resolveExpectedPid(deps: any, appRef2: any, alreadyVerified?: boolean): Promise<number>;
declare function verifiedPointerAppRef(appRef2: any, pid: any): any;
declare function frameActionProvenance(deps: any, ...targets: any[]): {
    contract: string;
    frame_id: any;
    expires_at_ms: any;
    delivered: {
        width: any;
        height: any;
    };
    source: any;
    pointer: any;
    app: any;
    window: any;
    display: {
        display_id: any;
        topology_fingerprint: any;
    };
    capture_windows: any;
    capture_surfaces: any;
    pixel: {
        x: any;
        y: any;
    };
    projected_point: any;
    endpoint_index: number;
}[];
declare function appRefMatchesFrame(rawAppRef: any, frame: any): boolean;
declare function frameScopedAppRef(deps: any, fallback: any, ...targets: any[]): any;
declare function frameDispatchIdentityError(deps: any, appRef2: any, ...targets: any[]): {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent?: undefined;
} | {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent: any;
};
declare function targetHasFrameAuthority(rawTarget: any): boolean;
declare function runClick(deps: any, input: any, button: any, clicks: any): Promise<any>;
declare function clickToolDef(opts: any): {
    name: any;
    title: any;
    description: any;
    inputSchema: any;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var SKILL_REF: string;
declare var leftClickTool: {
    name: any;
    title: any;
    description: any;
    inputSchema: any;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var doubleClickTool: {
    name: any;
    title: any;
    description: any;
    inputSchema: any;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var tripleClickTool: {
    name: any;
    title: any;
    description: any;
    inputSchema: any;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var rightClickTool: {
    name: any;
    title: any;
    description: any;
    inputSchema: any;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var middleClickTool: {
    name: any;
    title: any;
    description: any;
    inputSchema: any;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var scrollTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        target: z.ZodUnknown;
        scroll_direction: z.ZodEnum<{
            left: "left";
            right: "right";
            down: "down";
            up: "up";
        }>;
        scroll_amount: z.ZodUnknown;
        strategy: z.ZodDefault<z.ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
        app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var DRAG_NOTE: string;
declare var leftClickDragTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        from_target: z.ZodUnknown;
        to: z.ZodUnknown;
        modifiers: z.ZodDefault<z.ZodString>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
        app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var MOVE_NOTE: string;
declare var mouseMoveTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        coordinate: z.ZodUnknown | z.ZodOptional<z.ZodUnknown>;
        app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var MOUSE_DOWN_NOTE: string;
declare var leftMouseDownTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        target: z.ZodUnknown;
        app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var MOUSE_UP_NOTE: string;
declare var leftMouseUpTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var pointerTools: {
    name: any;
    title: any;
    description: any;
    inputSchema: any;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
}[];
declare var pointerToolsByName: Map<any, {
    name: any;
    title: any;
    description: any;
    inputSchema: any;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
}>;
declare function closePipForEndedSession(_deps: any): Promise<void>;
declare function releaseHeldPointer(deps: any): Promise<boolean>;
declare function cleanupStdioSession(deps: any, lifecycleCleanup: any): Promise<void>;
declare function cancelHeldKeys(deps: any): Promise<boolean>;
declare function softError(message: any): {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
};
declare function resolveCoordinateToNative(deps: any, target: any): Promise<{
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
} | {
    native: string;
    app_ref: {
        pid: number;
    };
}>;
declare function resolveTargetOrSoftError(target: any, session: any): {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
} | {
    resolved: {
        app_ref: {};
        isElement: boolean;
        kind: string;
        observedValue: any;
    } | {
        point: {
            x: any;
            y: any;
        };
        app_ref: {
            window_id?: any;
            pid?: any;
            bundle_id?: any;
        };
        isElement: boolean;
        kind: string;
    };
};
declare function splitsUtf16SurrogatePair(text: any, offset: any): boolean;
declare function textRangeSplitsUtf16SurrogatePair(text: any, range: any): boolean;
declare var CUA_REQUEST_ACCESS_STATUS_META_KEY: string;
declare var cuaRequestAccessStatusSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    platform: z.ZodLiteral<"darwin">;
    grantOwner: z.ZodString;
    accessibility: z.ZodEnum<{
        granted: "granted";
        stale: "stale";
        denied: "denied";
    }>;
    screenRecording: z.ZodEnum<{
        granted: "granted";
        denied: "denied";
        unknown: "unknown";
    }>;
}, z.core.$strict>;
declare function readCuaRequestAccessStatus(platform: any, report: any): {
    schemaVersion: 1;
    platform: "darwin";
    grantOwner: string;
    accessibility: "granted" | "stale" | "denied";
    screenRecording: "granted" | "denied" | "unknown";
};
declare function attachCuaRequestAccessStatusMeta(result: any, platform: any, report: any): any;
declare function explicitElementTarget(target: any): {
    type: string;
    state_id: string;
    index: number;
} | {
    x: number;
    y: number;
    frame_id?: any;
    type: string;
    state_id?: undefined;
    index?: undefined;
};
declare function explicitElementStateId(target: any): string;
declare function keyboardIdentityConstraints(appRef2: any): any;
declare function processScopedKeyboardAppRef(appRef2: any): any;
declare function verifyCompoundKeyboardAppRef(deps: any, appRef2: any, method: any): Promise<void>;
declare var SKILL_REF2: string;
declare function textBlock3(text: any): {
    type: string;
    text: any;
};
declare function textResult3(text: any): {
    content: {
        type: string;
        text: any;
    }[];
};
declare function brokerErrorDetails(error51: any): any;
declare function toolError3(text: any, details?: unknown, _cause?: unknown, _meta?: unknown): {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent?: undefined;
} | {
    isError: boolean;
    content: {
        type: string;
        text: any;
    }[];
    structuredContent: any;
};
declare function keyboardDispatchErrorResult(deps: any, error51: any, options: any): Promise<any>;
declare function appRefHasIdentity(appRef2: any): boolean;
declare function toText3(value: any): string;
declare function typedTextNote(text: any): string;
declare function defaultSleep2(seconds: any): Promise<void>;
declare function typeViaAppOrFocus(deps: any, text: any, returnState: any, appRef2: any, strategy: any): Promise<any>;
declare function coordinateHitTestPreflight(deps: any, target: any, resolved: any): Promise<{
    native: any;
    app_ref: any;
    note: string;
    softError: any;
} | {
    softError: {
        isError: boolean;
        content: {
            type: string;
            text: any;
        }[];
    };
    native?: undefined;
    app_ref?: undefined;
    note?: undefined;
}>;
declare var typeTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        text: z.ZodString;
        target: z.ZodOptional<z.ZodUnknown>;
        app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
        strategy: z.ZodDefault<z.ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var setValueTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        target: z.ZodUnknown;
        value: z.ZodString;
        strategy: z.ZodDefault<z.ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var selectTextTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        target: z.ZodUnknown;
        text_range: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<any, unknown>>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var keyTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        text: z.ZodString;
        repeat: z.ZodOptional<z.ZodNullable<z.ZodUnknown>>;
        app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
        strategy: z.ZodDefault<z.ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var holdKeyTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        text: z.ZodString;
        duration: z.ZodUnknown;
        app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
        strategy: z.ZodDefault<z.ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare function resolveActionAlias(requested: any, allowed: any): any;
declare var performActionTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        target: z.ZodUnknown;
        action: z.ZodString;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var requestAccessTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        capabilities: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<any, unknown>>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
};
declare var stopComputerControlTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
};
declare var waitTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        duration: z.ZodUnknown;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
};
declare var readClipboardTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{}, z.core.$strict>;
    buildHandler: (deps: any) => () => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
};
declare var writeClipboardTool: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        text: z.ZodString;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
};
declare var keyboardRuntimeTools: ({
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        text: z.ZodString;
        target: z.ZodOptional<z.ZodUnknown>;
        app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
        strategy: z.ZodDefault<z.ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        target: z.ZodUnknown;
        value: z.ZodString;
        strategy: z.ZodDefault<z.ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        target: z.ZodUnknown;
        text_range: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<any, unknown>>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        text: z.ZodString;
        repeat: z.ZodOptional<z.ZodNullable<z.ZodUnknown>>;
        app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
        strategy: z.ZodDefault<z.ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        text: z.ZodString;
        duration: z.ZodUnknown;
        app_ref: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodTransform<any, unknown>>>;
        strategy: z.ZodDefault<z.ZodEnum<{
            event: "event";
            auto: "auto";
            a11y: "a11y";
        }>>;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        target: z.ZodUnknown;
        action: z.ZodString;
        return_state: z.ZodDefault<z.ZodEnum<{
            none: "none";
            full: "full";
            compact: "compact";
        }>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        capabilities: z.ZodOptional<z.ZodNullable<z.ZodPreprocess<any, unknown>>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<any>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        reason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        duration: z.ZodUnknown;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{}, z.core.$strict>;
    buildHandler: (deps: any) => () => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
} | {
    name: string;
    title: string;
    description: string;
    inputSchema: z.ZodObject<{
        text: z.ZodString;
    }, z.core.$strict>;
    buildHandler: (deps: any) => (input: any) => Promise<{
        content: {
            type: string;
            text: any;
        }[];
    }>;
})[];
export { AGENT_B64_BUDGET, APP_INSTRUCTIONS, AccessibilitySession, ActionTier, BLANK_CANDIDATE, CAPTURE_APP_TIMEOUT_MS, CUA_REQUEST_ACCESS_STATUS_META_KEY, DEFAULT_FRAME_TTL_MS, DEFAULT_JPEG_QUALITY, DEFAULT_MAX_EDGE, DEFAULT_MAX_FRAMES, DEFAULT_MAX_STATES, DEFAULT_MCP_SESSION_KEY, DRAG_NOTE, EMPTY_CAPTURE_GUIDANCE, FILE_URL_WINDOW_VERIFY_ATTEMPTS, FINITE_BOOL_MSG, FINITE_MSG, FINITE_STRING_MSG, FRAME_PIXEL_TRANSFORM_VERSION, FrameRegistry, FrameRegistryError, GLOBAL_SCREEN_COORDINATE_CONTRACT, HEAL_MAX_DISPLACEMENT_PX, InputHoldRegistry, InvalidTextRangeError, JFIF_APP0, KEY_REPEAT_MAX, KEY_REPEAT_MIN, KillSwitch, MAX_EDGE, MAX_EMPTY_TREE_WARMUPS, MIN_QUALITY, MOUSE_DOWN_NOTE, MOUSE_UP_NOTE, MOVE_NOTE, NUM_INT_BOOL_MSG, NUM_INT_INT_MSG, NUM_INT_STRING_MSG, NegativeDurationError, OFFICIAL_CUA_FRAME_INTEGRITY_META_KEY, OPEN_APPLICATION_APP_PROPERTIES, PNG_SIG, POINTER_MODIFIER_ALIASES, PUBLIC_KEY_TOKENS, QUALITY_STEP, READ_ONLY_TOOLS, RESTRICTED_MODE_TIERS, SAFETY_CONTROL_TOOLS, SCROLL_AMOUNT_MAX, SCROLL_AMOUNT_MIN, SHRINK_FACTOR, SHRINK_MIN_EDGE, SKILL_REF, SKILL_REF2, TIER_TABLE, TargetResolveError, ZOOM_ERR_BOTH, ZOOM_ERR_NEITHER, actionDispatchReceiptFromError, actionReceiptBlock, appRef, appRefFromState, appRefHasIdentity, appRefMatchesFrame, appRefNullable, applicationName, asBounds, asBounds2, asElements, asRgbRawFromBuffer, asSurfaceKind, asSurfaceKind2, attachCuaRequestAccessStatusMeta, b64Len, bindFramePixelTarget, bindPointerTarget, boundDuration, boundsCenter, boundsNear, brokerErrorDetails, buildFromElement, bundleBranch, callPointerAction, cancelHeldKeys, captureFileUrlWindowBaseline, captureFingerprint, captureFreshElements, captureFreshFingerprintMatch, capturedDisplay, clampKeyRepeat, clampScrollAmount, classifyTier, cleanupStdioSession, clickShape, clickToolDef, cloneAndFreeze, closePipForEndedSession, coercePixel, composeSourceCrop, composeZoom, compositeAlphaOntoWhite, computeAgentSize, coordinateHitTestPreflight, coordinateTargetArg, coordinateTargetJSONSchema, createPointerHoldGuard, cuaRequestAccessStatusSchema, cursorPositionSchema, cursorPositionTool, deepFreeze, defaultKillSwitch, defaultLockPath, defaultSession, defaultSleep2, displayActionTools, displayTopologyFingerprint, distinguishableTargets, doubleClickSchema, doubleClickTool, elementCenter, elementPriority, elementRow, elementTargetArg, elementTargetJSONSchema, encodeJpegFromSharp, encodeScreenshotFromPng, encodeScreenshotRaw, encodeUnderBudget, explicitElementStateId, explicitElementTarget, extractAppRefPid, fileTarget, findAppInstruction, findFingerprintMatch, findSameCaptureVisualMatchInRawElements, findUnsupportedKeyToken, finiteFloat, flag, formatAppInstructions, formatAppStateTree, frameActionProvenance, frameBindingKind, frameDispatchIdentityError, frameScopedAppRef, freshSurfaceMatches, getAppStateSchema, getAppStateTool, getDefaultKillSwitch, getDefaultSession, globalPointerHoldGuard, hasOneToOneWindowMatch, holdKeySchema, holdKeyTool, imageBlock, imageRefBlock, imageWithRef, implicitFrameBindings, ingestCaptureAppResult, injectJfifApp0, isIncrementalSnapshotResult, issueCaptureFrame, keySchema, keyTool, keyboardDispatchErrorResult, keyboardIdentityConstraints, keyboardRuntimeTools, leftClickDragSchema, leftClickDragTool, leftClickSchema, leftClickTool, leftMouseDownSchema, leftMouseDownTool, leftMouseUpSchema, leftMouseUpTool, listAppsSchema, listAppsTool, listDisplaysSchema, listDisplaysTool, listWindowsSchema, listWindowsTool, loadRgbaRawFromBuffer, loadSharp, mapAppStateResult, mapRawCaptureAppResult, mapZoomResult, middleClickSchema, middleClickTool, mimeTypeFor, mouseMoveSchema, mouseMoveTool, mutationScopeFrom, mutationScopeHasAppIdentity, nameBranch, norm, normalizeActionDispatchReceipt, normalizeCandidate, normalizeImageFormat, normalizePointerModifiers, normalizeTitle, normalizeValue, noteObservation, numInt, observationFingerprint, observationTools, observationToolsByName, openApplicationAppArg, openApplicationAppArgJSONSchema, openApplicationAppBranch, openApplicationSchema, openApplicationTool, parseAppFrameSurfaceSet, parseAppRef, parseDisplay, parseScreenshotCaptureWindows, parseTarget, parseTopology, performActionSchema, performActionTool, pidBranch, pointerActionError, pointerDispatchErrorResult, pointerResolveError, pointerTools, pointerToolsByName, postActionObserve, present, probeScreenshotSize, processIsAlive, processScopedKeyboardAppRef, projectFramePixelToPointer, publicDisplayList, readClipboardSchema, readClipboardTool, readCuaRequestAccessStatus, releaseHeldPointer, renderInstructionBlock, requestAccessSchema, requestAccessTool, resizeLanczos, resolveActionAlias, resolveCapturedDisplay, resolveCoordinate, resolveCoordinateFrame, resolveCoordinateToNative, resolveElement, resolveExpectedPid, resolveFramePixelTarget, resolveTarget, resolveTargetForClick, resolveTargetOrSoftError, resolvedActionAppRef, returnStateEnum, rgbRawToSharp, rightClickSchema, rightClickTool, roundHalfToEven, runClick, runWithSession, sameApp, sameWindow, screenshotSchema, screenshotTool, scrollDirectionEnum, scrollNote, scrollSchema, scrollTool, selectTextSchema, selectTextTool, sessionContext, setValueSchema, setValueTool, sharedAppProperties, sharpPromise, softError, splitsUtf16SurrogatePair, stateUnavailableBlock, stopComputerControlSchema, stopComputerControlTool, strategyEnum, stringifiedJsonArray, stripPngIcc, switchDisplaySchema, switchDisplayTool, synthesizeLabel, targetArg, targetArgJSONSchema, targetArgNullable, targetHasFrameAuthority, textBlock, textBlock2, textBlock3, textRangeSplitsUtf16SurrogatePair, textResult, textResult2, textResult3, titleMatches, toText, toText2, toText3, toolAnnotationsFor, toolError, toolError2, toolError3, toolKillSwitch, toolSession, toolSessionKey, tripleClickSchema, tripleClickTool, truncate, typeSchema, typeTool, typeViaAppOrFocus, typedTextNote, unsentPointerIdentityError, unwrapStringifiedObject, validateTextRange, verifiedPointerAppRef, verifyCompoundKeyboardAppRef, verifyFileUrlWindowEffect, visibleElementCenter, waitNote, waitSchema, waitTool, windowIds, withOfficialFrameIntegrity, writeClipboardSchema, writeClipboardTool, zoomSchema, zoomTool, };
