import { AsyncLocalStorage } from "node:async_hooks";
declare var BROKER_UNAVAILABLE_CODE: string;
declare function legacyHelperMessageProvesActionNotSent(message: any): boolean;
declare var PermissionBrokerError: {
    new (message?: string, init?: any): {
        code: any;
        details: any;
        permissionError: any;
        name: string;
        message: string;
        stack?: string;
        cause?: unknown;
    };
    captureStackTrace(targetObject: object, constructorOpt?: Function): void;
    prepareStackTrace(err: Error, stackTraces: NodeJS.CallSite[]): any;
    stackTraceLimit: number;
};
declare function permissionBrokerPermissionError(message: any, init?: any): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
declare function isBrokerUnavailableException(exc: any): boolean;
declare function shouldPropagateToWrapper(exc: any): boolean;
declare var MAX_FRAME_BYTES: number;
declare var MAX_HOLD_DURATION: number;
declare var HOLD_RESPONSE_CLEANUP_GRACE: number;
declare var DEFAULT_RPC_DEADLINE_CAP: number;
declare var DEFAULT_WARMUP_DEADLINE: number;
declare var DEFAULT_WARMUP_BACKOFF_BASE: number;
declare var DEFAULT_WARMUP_BACKOFF_CAP: number;
declare var ALLOW_ANY_PEER_ENV: string;
declare var ALLOW_DEV_BROKER_ENV: string;
declare var DEV_BROKER_TRUTHY: readonly string[];
declare var CUA_NOT_READY_KIND: string;
declare var REASON_BROKER_NOT_ACCEPTING: string;
declare var REASON_PERMISSION_REFRESH_IN_PROGRESS: string;
declare var REASON_PERMISSION_REFRESH_INVALID: string;
declare var REASON_BROKER_RESPONSE_AMBIGUOUS: string;
declare var REASON_CALLER_TIMEOUT: string;
declare var REASON_RESTART_DEFERRED_ACTIVE_TURN: string;
declare var REASON_RETRYABLE: Readonly<{
    [REASON_BROKER_NOT_ACCEPTING]: true;
    [REASON_PERMISSION_REFRESH_IN_PROGRESS]: true;
    [REASON_PERMISSION_REFRESH_INVALID]: false;
    [REASON_BROKER_RESPONSE_AMBIGUOUS]: false;
    [REASON_CALLER_TIMEOUT]: true;
    [REASON_RESTART_DEFERRED_ACTIVE_TURN]: true;
}>;
declare var ALL_REASON_CODES: readonly string[];
declare var NOT_READY_MESSAGE: string;
declare var BROKER_RESPONSE_AMBIGUOUS_MESSAGE: string;
declare var PERMISSION_REFRESH_IN_PROGRESS_MESSAGE: string;
declare var PERMISSION_REFRESH_INVALID_MESSAGE: string;
declare var REASON_MESSAGE: Readonly<{
    broker_not_accepting: string;
    broker_response_ambiguous: string;
    permission_refresh_in_progress: string;
    permission_refresh_invalid: string;
}>;
declare function cuaNotReadyPayload(opts?: any): {
    kind: string;
    reasonCode: any;
    retryable: any;
    message: any;
};
declare var NOT_READY_DETAILS_KEYS: string[];
declare function notReadyDetails(toolName: any, exc: any): {
    tool: any;
    code: any;
};
declare function notReadyResultForException(toolName: any, exc: any): {
    kind: string;
    reasonCode: any;
    retryable: any;
    message: any;
};
declare var MAX_HOLD_DURATION_MS: number;
declare var HOLD_RESPONSE_CLEANUP_GRACE_MS: number;
declare function boundedHoldDuration(method: any, params: any): number;
declare function businessResponseTimeout(selfTimeoutMs: any, method: any, params: any): any;
declare function isValidErrorEnvelope(error51: any): boolean;
declare function parseErrorPayload(error51: any): {
    message: string;
    code: string;
    details: any;
};
declare function extractAuthErrorMessage(reply: any): string;
declare var WIN32_NAMED_PIPE_NAME_RE: RegExp;
declare function devBrokerOptIn(env?: NodeJS.ProcessEnv): boolean;
declare function allowAnyPeer(env?: NodeJS.ProcessEnv): boolean;
declare function defaultPeerCredentialChecker(env?: NodeJS.ProcessEnv): {
    verifySocketPeer(socketPath: any, _socket: any): void;
};
declare var NOOP_PEER_CHECKER: Readonly<{
    verifySocketPeer(_socketPath: any, _socket: any): void;
}>;
declare var cancelContext: AsyncLocalStorage<unknown>;
declare function brokerCancelSignalFromAbortSignal(signal: any): {
    readonly cancelled: any;
    onCancel(listener: any): () => any;
};
declare function runWithBrokerCancelSignal(signal: any, callback: any): unknown;
declare function currentBrokerCancelSignal(): unknown;
declare var interruptibleBrokerSleep: (ms: any, cancelSignal: any) => Promise<void>;
declare function cancelledBrokerError(): {
    code: any;
    details: any;
    permissionError: any;
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
};
export { ALLOW_ANY_PEER_ENV, ALLOW_DEV_BROKER_ENV, ALL_REASON_CODES, BROKER_RESPONSE_AMBIGUOUS_MESSAGE, BROKER_UNAVAILABLE_CODE, CUA_NOT_READY_KIND, DEFAULT_RPC_DEADLINE_CAP, DEFAULT_WARMUP_BACKOFF_BASE, DEFAULT_WARMUP_BACKOFF_CAP, DEFAULT_WARMUP_DEADLINE, DEV_BROKER_TRUTHY, HOLD_RESPONSE_CLEANUP_GRACE, HOLD_RESPONSE_CLEANUP_GRACE_MS, MAX_FRAME_BYTES, MAX_HOLD_DURATION, MAX_HOLD_DURATION_MS, NOOP_PEER_CHECKER, NOT_READY_DETAILS_KEYS, NOT_READY_MESSAGE, PERMISSION_REFRESH_INVALID_MESSAGE, PERMISSION_REFRESH_IN_PROGRESS_MESSAGE, PermissionBrokerError, REASON_BROKER_NOT_ACCEPTING, REASON_BROKER_RESPONSE_AMBIGUOUS, REASON_CALLER_TIMEOUT, REASON_MESSAGE, REASON_PERMISSION_REFRESH_INVALID, REASON_PERMISSION_REFRESH_IN_PROGRESS, REASON_RESTART_DEFERRED_ACTIVE_TURN, REASON_RETRYABLE, WIN32_NAMED_PIPE_NAME_RE, allowAnyPeer, boundedHoldDuration, brokerCancelSignalFromAbortSignal, businessResponseTimeout, cancelContext, cancelledBrokerError, cuaNotReadyPayload, currentBrokerCancelSignal, defaultPeerCredentialChecker, devBrokerOptIn, extractAuthErrorMessage, interruptibleBrokerSleep, isBrokerUnavailableException, isValidErrorEnvelope, legacyHelperMessageProvesActionNotSent, notReadyDetails, notReadyResultForException, parseErrorPayload, permissionBrokerPermissionError, runWithBrokerCancelSignal, shouldPropagateToWrapper, };
