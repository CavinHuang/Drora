import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
declare var PermissionBrokerClient: {
    new (socketPath: any, options: any): {
        socketPath: any;
        timeoutMs: any;
        token: any;
        peerChecker: any;
        maxFrameBytes: any;
        nowMs: any;
        cancelSignal: any;
        onPresentation: any;
        _nextId: number;
        /**
         * Allocate the next request id. Mirror Python `_request_id()` (broker.py:484-487):
         * first call returns 1; auth line uses the fixed id 0; subsequent calls
         * monotonically increment. Single-threaded JS makes `++` atomic without a
         * lock — Python's `threading.Lock` is for thread-safety we don't need.
         */
        requestId(): number;
        /**
         * Perform one authenticated broker RPC.
         *
         * Resolves to the helper's `result` on `ok:true`. Throws a classified
         * {@link PermissionBrokerError} on every other outcome:
         *   - `broker_unavailable` + `request_delivery_state` ∈ {not_sent, possibly_sent}
         *   - `permission_denied` / `not_authorized` → `permissionError: true`
         *     (PermissionBrokerPermissionError equivalent)
         *   - other helper codes → preserved as-is
         */
        call(method: any, params: any, _opts?: any): Promise<any>;
    };
};
declare function wrapTransportError(error51: any, sanitize: any, state: any, errorType?: any): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
declare function wrapPeerCheckError(error51: any, state: any): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
declare function invalidResponseError(message: any, brokerResponseState: any): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
declare function brokerUnavailableFromTransport(message: any, state: any, errorType: any): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
declare var ZCODE_CUA_BROKER_REFRESH_MARKER_ENV_KEY: string;
declare var MARKER_KEYS: Readonly<Set<string>>;
declare var MARKER_SCHEMA: number;
declare var MARKER_KIND: string;
declare var MAX_MARKER_BYTES: number;
declare var DEFAULT_BACKOFF_BASE: number;
declare var DEFAULT_BACKOFF_CAP: number;
declare function normalizeRefreshMarkerPath(value: any, env?: NodeJS.ProcessEnv): any;
declare function expandVarsAndUser(input: any, env: any): any;
declare function isAbsolutePath(p: any): any;
declare function isWindowsAbsolutePath(p: any): boolean;
declare function normalizePath(p: any): string;
declare function readPermissionRefreshMarkerWin32(normalizedPath: any, nowMs: any): {
    deadlineEpochMs: number;
};
declare function readPermissionRefreshMarker(path: any, nowMs?: () => number): {
    deadlineEpochMs: number;
};
declare function validateParentStat(info: any, path: any): void;
declare function validateMarkerStat(info: any, path: any): void;
declare function readBounded(fd: any, max: any): Buffer<ArrayBuffer>;
declare function parseMarker(data: any, nowMs: any): {
    deadlineEpochMs: number;
};
declare function hasDuplicateKeys(jsonText: any): boolean;
declare function sameKeySet(record2: any, expected: any): boolean;
declare function markerUnavailable(reason: any, retryable: any, _cause?: any): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
declare var PermissionBrokerRefreshGate: {
    new (markerPath: any, options?: any): {
        markerPath: any;
        backoffBaseMs: any;
        backoffCapMs: any;
        nowMs: any;
        sleep: any;
        cancelSignal: any;
        reader: any;
        /**
         * Wait to the first deadline and report whether a marker was observed.
         *
         * Returns true iff a marker was seen at least once before it cleared
         * (Python: `marker_observed`). Throws {@link PermissionBrokerError}
         * (code=broker_unavailable) when the deadline elapses or the marker is
         * corrupt/unsafe.
         */
        waitUntilClear(absoluteDeadlineMs: any, callCancelSignal: any): Promise<boolean>;
    };
};
declare function computeAbsoluteDeadline(startedAtMs: any, method: any, params: any, options?: any): any;
declare function callWithWarmupRetry(client: any, method: any, params: any, options: any): Promise<any>;
declare function resolveWarmupConfig(options?: any): {
    warmupDeadlineMs: any;
    backoffBaseMs: any;
    backoffCapMs: any;
    rpcDeadlineCapMs: any;
};
declare function resolvePositiveFloat(value: any, defaultValue: any, field: any, allowZero: any): any;
declare var defaultSleep: (ms: any, cancelSignal: any) => Promise<void>;
declare var CUA_APP_ASSOCIATIONS_META_KEY: string;
declare var CUA_APP_ASSOCIATIONS_MAX_META_BYTES: number;
declare var CUA_APP_ASSOCIATIONS_MAX_ITEMS: number;
declare var CUA_APP_ASSOCIATIONS_MAX_ICON_BYTES: number;
declare var CUA_APP_ASSOCIATIONS_MAX_ITEM_ICON_BYTES: number;
declare var cuaApplicationIconSchema: z.ZodObject<{
    mimeType: z.ZodLiteral<"image/png">;
    data: z.ZodString;
}, z.core.$strict>;
declare var cuaApplicationPresentationSchema: z.ZodObject<{
    appKey: z.ZodString;
    displayName: z.ZodOptional<z.ZodString>;
    icon: z.ZodOptional<z.ZodObject<{
        mimeType: z.ZodLiteral<"image/png">;
        data: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
declare var cuaAppAssociationsSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    primary: z.ZodOptional<z.ZodObject<{
        appKey: z.ZodString;
        displayName: z.ZodOptional<z.ZodString>;
        icon: z.ZodOptional<z.ZodObject<{
            mimeType: z.ZodLiteral<"image/png">;
            data: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    items: z.ZodOptional<z.ZodArray<z.ZodObject<{
        resultIndex: z.ZodNumber;
        application: z.ZodObject<{
            appKey: z.ZodString;
            displayName: z.ZodOptional<z.ZodString>;
            icon: z.ZodOptional<z.ZodObject<{
                mimeType: z.ZodLiteral<"image/png">;
                data: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
    }, z.core.$strict>>>;
}, z.core.$strict>;
declare var invocationStorage: AsyncLocalStorage<unknown>;
declare function normalizedText(value: any): string;
declare function normalizePid(value: any): number;
declare function normalizedWindowsPath(value: any): string;
declare function deriveApplicationKey(evidence: any, platform?: NodeJS.Platform): any;
declare function validPngData(value: any): string;
declare function presentationFromEvidence(evidence: any): {
    icon?: {
        mimeType: string;
        data: string;
    };
    displayName?: string;
    appKey: any;
};
declare function runWithTargetAppDisplayContext(operation: any): unknown;
declare function displayLookupKey(evidence: any): any;
declare function beginTargetAppDisplayLookup(evidence: any): boolean;
declare function recordTargetAppDisplayEvidence(evidence: any): void;
declare function recordAppAssociationItems(items: any): void;
declare function fitItemsToBudgets(items: any): any;
declare function readAppAssociations(mode: any): {
    schemaVersion: 1;
    primary?: {
        appKey: string;
        displayName?: string;
        icon?: {
            mimeType: "image/png";
            data: string;
        };
    };
    items?: {
        resultIndex: number;
        application: {
            appKey: string;
            displayName?: string;
            icon?: {
                mimeType: "image/png";
                data: string;
            };
        };
    }[];
};
declare function attachAppAssociationsMeta(result: any, mode?: string): any;
declare var storage: AsyncLocalStorage<unknown>;
declare function parsePipToolRequestContext(value: any): {
    sessionId: any;
    turnId: any;
};
declare function runWithPipToolRequestContext(value: any, operation: any): any;
declare function currentPipToolRequestContext(): unknown;
declare var BrokerClient: {
    new (options: any): {
        socketPath: any;
        token: any;
        warmup: {
            warmupDeadlineMs: any;
            backoffBaseMs: any;
            backoffCapMs: any;
            rpcDeadlineCapMs: any;
        };
        claimPromise: any;
        refreshCheck: any;
        refreshGate: any;
        screenshot(options?: any): Promise<{
            capture_windows?: any;
            coordinate_contract?: any;
            display_topology?: any;
            display?: any;
            format: any;
            data: string;
        }>;
        /**
         * One-shot `broker_info` probe that authenticates + claims the Helper.
         *
         * BUG-1 fix (real-model baseline a537): the Helper's startup-claim watchdog
         * (helperMain.ts `DEFAULT_STARTUP_CLAIM_TTL_MS = 90_000`) lifts ONLY on a
         * successful `broker_info` response — not on `authenticate`, not on any
         * other tool RPC. The standalone-CLI auto-launch path already sends this
         * probe (connection.ts:83); the TS server's regular tool-call client did
         * NOT, so any externally-launched Helper (e2e harness, dev broker, dogfood)
         * self-terminated at 90s mid-suite — the first ~8 tool calls reached the
         * broker, then every subsequent call returned ENOENT.
         *
         * We now claim lazily on the first real call (see `call`), so ANY TS-server
         * consumer keeps the Helper alive, not just the standalone CLI. Mirrors
         * `connectToHelper` minus the orchestration steps.
         *
         * Idempotent: the claim runs at most once per successful probe. A claim
         * failure is swallowed (the real tool call surfaces the actionable error
         * through its own warmup-retry layer) and `claimPromise` cleared so the next
         * call re-attempts.
         */
        claim(): Promise<any>;
        /**
         * Generic broker RPC with delivery-safety + warmup-retry. Returns the
         * broker's `result` field directly; throws on transport failure or helper
         * error envelope. The thrown error is a PermissionBrokerError (extends
         * Error) carrying `code` + `details.request_delivery_state`; tool handlers
         * catch `Error` and surface the message to the model as a soft MCP error.
         *
         * Before the first real call, `claim()` sends a one-shot `broker_info` so
         * the Helper's startup-claim watchdog lifts (BUG-1). No-op after the first
         * success.
         *
         * Per-call wiring:
         *   1. Build a fresh PermissionBrokerClient (per-call connection, matching
         *      Python's `BrokerBackend._call_client_once`). The peer-check runs
         *      on connect, BEFORE any token/method bytes leave this process.
         *   2. Compute one monotonic absolute deadline covering the whole call
         *      (computeAbsoluteDeadline = rpc-deadline-cap + bounded-hold, capped
         *      by the outer per-call timeoutMs). This is the hard upper bound the
         *      warmup loop can never overrun.
         *   3. callWithWarmupRetry retries broker_unavailable+not_sent (connect /
         *      auth / peer-check failures) with bounded exponential backoff, up to
         *      retryDeadlineMs. A possibly_sent failure is re-thrown immediately —
         *      no duplicate click/type/press.
         */
        call(method: any, params: any, opts: any): Promise<any>;
        invoke(method: any, params: any, opts: any): Promise<any>;
        /** 只由真实 Helper adapter 提供的宿主展示身份解析；测试 fake 未实现时保持原调用顺序。 */
        resolveTargetAppDisplay(appRef2: any): Promise<any>;
    };
};
declare function callBroker(deps: any, method: any, params: any, opts: any): Promise<any>;
declare function readAppRef(value: any): any;
declare function recordBrokerTargetApp(value: any): void;
declare function recordBrokerPresentation(value: any): void;
declare function startTargetAppDisplayLookup(deps: any, appRef2: any): any;
declare function recordBrokerResultTargetApp(deps: any, method: any, value: any): Promise<void>;
declare function callBrokerControl(deps: any, method: any, params: any, opts: any): Promise<any>;
declare var globalActionTail: Promise<void>;
declare var globalQueuedActionCount: number;
declare var globalLongInputHoldActive: boolean;
declare var ControlStopped: {
    new (message: any): {
        name: string;
        message: string;
        stack?: string;
        cause?: unknown;
    };
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;
    prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
    stackTraceLimit: number;
};
export { BrokerClient, CUA_APP_ASSOCIATIONS_MAX_ICON_BYTES, CUA_APP_ASSOCIATIONS_MAX_ITEMS, CUA_APP_ASSOCIATIONS_MAX_ITEM_ICON_BYTES, CUA_APP_ASSOCIATIONS_MAX_META_BYTES, CUA_APP_ASSOCIATIONS_META_KEY, ControlStopped, DEFAULT_BACKOFF_BASE, DEFAULT_BACKOFF_CAP, MARKER_KEYS, MARKER_KIND, MARKER_SCHEMA, MAX_MARKER_BYTES, PermissionBrokerClient, PermissionBrokerRefreshGate, ZCODE_CUA_BROKER_REFRESH_MARKER_ENV_KEY, attachAppAssociationsMeta, beginTargetAppDisplayLookup, brokerUnavailableFromTransport, callBroker, callBrokerControl, callWithWarmupRetry, computeAbsoluteDeadline, cuaAppAssociationsSchema, cuaApplicationIconSchema, cuaApplicationPresentationSchema, currentPipToolRequestContext, defaultSleep, deriveApplicationKey, displayLookupKey, expandVarsAndUser, fitItemsToBudgets, globalActionTail, globalLongInputHoldActive, globalQueuedActionCount, hasDuplicateKeys, invalidResponseError, invocationStorage, isAbsolutePath, isWindowsAbsolutePath, markerUnavailable, normalizePath, normalizePid, normalizeRefreshMarkerPath, normalizedText, normalizedWindowsPath, parseMarker, parsePipToolRequestContext, presentationFromEvidence, readAppAssociations, readAppRef, readBounded, readPermissionRefreshMarker, readPermissionRefreshMarkerWin32, recordAppAssociationItems, recordBrokerPresentation, recordBrokerResultTargetApp, recordBrokerTargetApp, recordTargetAppDisplayEvidence, resolvePositiveFloat, resolveWarmupConfig, runWithPipToolRequestContext, runWithTargetAppDisplayContext, sameKeySet, startTargetAppDisplayLookup, storage, validPngData, validateMarkerStat, validateParentStat, wrapPeerCheckError, wrapTransportError, };
