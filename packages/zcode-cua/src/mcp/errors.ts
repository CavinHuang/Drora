import { AsyncLocalStorage } from "node:async_hooks";
import { statSync } from "node:fs";
var BROKER_UNAVAILABLE_CODE = "broker_unavailable";
function legacyHelperMessageProvesActionNotSent(message) {
  return (
    /\braw foreground event\b.*\brefused because\b/i.test(message) ||
    /\bmodifiers must be a '\+'-separated chord\b/i.test(message) ||
    /\belement \([^)]*\) is not settable; refuse set_value\b/i.test(message) ||
    /\belement \([^)]*\) is not selectable; refuse select_text\b/i.test(message)
  );
}
var PermissionBrokerError = class extends Error {
  code;
  details;
  permissionError;
  constructor(message = "unknown broker error", init: any = {}) {
    const baseMessage =
      (message && message.length > 0
        ? message
        : (init as any).code && (init as any).code.length > 0
          ? (init as any).code
          : "unknown broker error") || "unknown broker error";
    const actionProvenNotSent =
      (init as any).details?.action_sent === false ||
      legacyHelperMessageProvesActionNotSent(baseMessage);
    const normalizedMessage =
      actionProvenNotSent && !/\baction_sent\s*=\s*false\b/i.test(baseMessage)
        ? `${baseMessage.replace(/\s+$/u, "")} action_sent=false.`
        : baseMessage;
    super(
      normalizedMessage,
      (init as any).cause !== void 0 ? { cause: (init as any).cause } : void 0,
    );
    this.name = "PermissionBrokerError";
    this.code =
      typeof (init as any).code === "string" && (init as any).code.trim().length > 0
        ? (init as any).code.trim()
        : null;
    this.details = (init as any).details ? { ...(init as any).details } : {};
    this.permissionError = (init as any).permissionError === true;
  }
};
function permissionBrokerPermissionError(message, init: any = {}) {
  const merged = { ...init, permissionError: true };
  return new PermissionBrokerError(message, merged);
}
function isBrokerUnavailableException(exc) {
  return exc instanceof PermissionBrokerError && exc.code === BROKER_UNAVAILABLE_CODE;
}
function shouldPropagateToWrapper(exc) {
  return isBrokerUnavailableException(exc);
}
var MAX_FRAME_BYTES = 64 * 1024 * 1024;
var MAX_HOLD_DURATION = 30;
var HOLD_RESPONSE_CLEANUP_GRACE = 5;
var DEFAULT_RPC_DEADLINE_CAP = 45;
var DEFAULT_WARMUP_DEADLINE = 2;
var DEFAULT_WARMUP_BACKOFF_BASE = 0.15;
var DEFAULT_WARMUP_BACKOFF_CAP = 0.75;
var ALLOW_ANY_PEER_ENV = "ZCODE_CUA_BROKER_ALLOW_ANY_PEER";
var ALLOW_DEV_BROKER_ENV = "ZCODE_CUA_ALLOW_DEV_BROKER";
var DEV_BROKER_TRUTHY = Object.freeze(["1", "true", "yes", "on"]);
var CUA_NOT_READY_KIND = "CUA_NOT_READY";
var REASON_BROKER_NOT_ACCEPTING = "broker_not_accepting";
var REASON_PERMISSION_REFRESH_IN_PROGRESS = "permission_refresh_in_progress";
var REASON_PERMISSION_REFRESH_INVALID = "permission_refresh_invalid";
var REASON_BROKER_RESPONSE_AMBIGUOUS = "broker_response_ambiguous";
var REASON_CALLER_TIMEOUT = "caller_timeout";
var REASON_RESTART_DEFERRED_ACTIVE_TURN = "restart_deferred_active_turn";
var REASON_RETRYABLE = Object.freeze({
  [REASON_BROKER_NOT_ACCEPTING]: true,
  [REASON_PERMISSION_REFRESH_IN_PROGRESS]: true,
  [REASON_PERMISSION_REFRESH_INVALID]: false,
  [REASON_BROKER_RESPONSE_AMBIGUOUS]: false,
  [REASON_CALLER_TIMEOUT]: true,
  [REASON_RESTART_DEFERRED_ACTIVE_TURN]: true,
});
var ALL_REASON_CODES = Object.freeze([
  REASON_BROKER_NOT_ACCEPTING,
  REASON_PERMISSION_REFRESH_IN_PROGRESS,
  REASON_PERMISSION_REFRESH_INVALID,
  REASON_BROKER_RESPONSE_AMBIGUOUS,
  REASON_CALLER_TIMEOUT,
  REASON_RESTART_DEFERRED_ACTIVE_TURN,
]);
var NOT_READY_MESSAGE =
  "The ZCode Computer Use is starting up and its permission broker socket is not accepting connections yet. Retry the same tool call after a brief wait.";
var BROKER_RESPONSE_AMBIGUOUS_MESSAGE =
  "The Helper may have accepted this action, but its response was lost. Do not replay it automatically; observe the target state first.";
var PERMISSION_REFRESH_IN_PROGRESS_MESSAGE =
  "ZCode is still refreshing the permission Helper. Retry after the refresh finishes.";
var PERMISSION_REFRESH_INVALID_MESSAGE =
  "ZCode's permission refresh marker is invalid or unsafe. ZCode must recreate the marker in its private runtime directory.";
var REASON_MESSAGE = Object.freeze({
  broker_not_accepting: NOT_READY_MESSAGE,
  broker_response_ambiguous: BROKER_RESPONSE_AMBIGUOUS_MESSAGE,
  permission_refresh_in_progress: PERMISSION_REFRESH_IN_PROGRESS_MESSAGE,
  permission_refresh_invalid: PERMISSION_REFRESH_INVALID_MESSAGE,
});
function cuaNotReadyPayload(opts: any = {}) {
  const reasonCode = (opts as any).reasonCode ?? REASON_BROKER_NOT_ACCEPTING;
  const message = (opts as any).message ?? NOT_READY_MESSAGE;
  const retryable = (opts as any).retryable ?? true;
  const payload = {
    kind: CUA_NOT_READY_KIND,
    reasonCode,
    retryable,
    message,
  };
  if ((opts as any).details !== void 0) {
    (payload as any).details = { ...(opts as any).details };
  }
  return payload;
}
var NOT_READY_DETAILS_KEYS = [
  "socket_path",
  "error_type",
  "refresh_marker_state",
  "refresh_marker_retryable",
  "rpc_deadline_state",
  "rotation_state",
  "broker_response_state",
  "request_delivery_state",
];
function notReadyDetails(toolName, exc) {
  const details = { tool: toolName, code: exc.code };
  for (const key of NOT_READY_DETAILS_KEYS) {
    if (key in exc.details) {
      details[key] = exc.details[key];
    }
  }
  return details;
}
function notReadyResultForException(toolName, exc) {
  if (!isBrokerUnavailableException(exc)) {
    throw new TypeError(
      `notReadyResultForException: expected code=${JSON.stringify(BROKER_UNAVAILABLE_CODE)} but got code=${JSON.stringify(exc.code)} (message=${JSON.stringify(exc.message)})`,
    );
  }
  const details = notReadyDetails(toolName, exc);
  if (exc.details.request_delivery_state === "possibly_sent") {
    return cuaNotReadyPayload({
      reasonCode: REASON_BROKER_RESPONSE_AMBIGUOUS,
      message: BROKER_RESPONSE_AMBIGUOUS_MESSAGE,
      retryable: false,
      details,
    });
  }
  const markerRetryable = exc.details.refresh_marker_retryable;
  if (markerRetryable === true) {
    return cuaNotReadyPayload({
      reasonCode: REASON_PERMISSION_REFRESH_IN_PROGRESS,
      message: exc.message,
      // Python parity: passes upstream's pinned literal through
      retryable: true,
      details,
    });
  }
  if (markerRetryable === false) {
    return cuaNotReadyPayload({
      reasonCode: REASON_PERMISSION_REFRESH_INVALID,
      message: exc.message,
      // Python parity: passes upstream's pinned literal through
      retryable: false,
      details,
    });
  }
  return cuaNotReadyPayload({ details });
}
var MAX_HOLD_DURATION_MS = MAX_HOLD_DURATION * 1e3;
var HOLD_RESPONSE_CLEANUP_GRACE_MS = HOLD_RESPONSE_CLEANUP_GRACE * 1e3;
function boundedHoldDuration(method, params) {
  if (method !== "hold_key" && method !== "hold_key_to_app") {
    return 0;
  }
  const raw = (params ?? {}).duration;
  if (typeof raw === "boolean") return 0;
  if (typeof raw !== "number") return 0;
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  return Math.min(raw, MAX_HOLD_DURATION) * 1e3;
}
function businessResponseTimeout(selfTimeoutMs, method, params) {
  if (method !== "hold_key" && method !== "hold_key_to_app") {
    return selfTimeoutMs;
  }
  const boundedMs = boundedHoldDuration(method, params);
  if (boundedMs <= 0) {
    return selfTimeoutMs;
  }
  return Math.max(selfTimeoutMs, boundedMs + HOLD_RESPONSE_CLEANUP_GRACE_MS);
}
function isValidErrorEnvelope(error51) {
  if (error51 === null || typeof error51 !== "object" || Array.isArray(error51)) {
    return false;
  }
  const env = error51;
  const message = env.message;
  const code = env.code;
  const details = env.details;
  if (message !== void 0 && (typeof message !== "string" || message.trim().length === 0)) {
    return false;
  }
  if (code !== void 0 && (typeof code !== "string" || code.trim().length === 0)) {
    return false;
  }
  if (
    details !== void 0 &&
    (details === null || typeof details !== "object" || Array.isArray(details))
  ) {
    return false;
  }
  return (
    (typeof message === "string" && message.trim().length > 0) ||
    (typeof code === "string" && code.trim().length > 0)
  );
}
function parseErrorPayload(error51) {
  if (error51 !== null && typeof error51 === "object" && !Array.isArray(error51)) {
    const env = error51;
    const rawCode = env.code;
    const code = typeof rawCode === "string" && rawCode.trim().length > 0 ? rawCode.trim() : null;
    const rawMessage = env.message;
    const message =
      (typeof rawMessage === "string" && rawMessage.trim().length > 0
        ? String(rawMessage)
        : null) ??
      code ??
      "unknown broker error";
    const details =
      env.details !== null && typeof env.details === "object" && !Array.isArray(env.details)
        ? { ...env.details }
        : {};
    return { message: String(message), code, details };
  }
  return {
    message: String(error51 ?? "unknown broker error"),
    code: null,
    details: {},
  };
}
function extractAuthErrorMessage(reply) {
  const error51 = reply.error;
  if (error51 !== null && typeof error51 === "object" && !Array.isArray(error51)) {
    const env = error51;
    const message = env.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return "auth rejected";
}
var WIN32_NAMED_PIPE_NAME_RE = /^\\\\\.\\pipe\\zcode-cua-helper-(?:[0-9a-f]{8,}|default)$/;
function devBrokerOptIn(env = process.env) {
  const raw = env[ALLOW_DEV_BROKER_ENV];
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return DEV_BROKER_TRUTHY.includes(value);
}
function allowAnyPeer(env = process.env) {
  const raw = env[ALLOW_ANY_PEER_ENV];
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return value.length > 0;
}
function defaultPeerCredentialChecker(env = process.env) {
  return {
    verifySocketPeer(socketPath, _socket) {
      if (allowAnyPeer(env) && devBrokerOptIn(env)) {
        return;
      }
      if (process.platform === "win32") {
        if (!WIN32_NAMED_PIPE_NAME_RE.test(socketPath)) {
          throw new PermissionBrokerError(
            `refusing broker pipe outside zcode-cua-helper namespace: ${socketPath}`,
            { code: "untrusted_socket" },
          );
        }
        return;
      }
      const euid = typeof process.geteuid === "function" ? process.geteuid() : void 0;
      if (euid === void 0) {
        return;
      }
      let info;
      try {
        const stat = statSync(socketPath);
        info = { uid: stat.uid, mode: stat.mode };
      } catch {
        return;
      }
      if (info.uid !== euid && info.uid !== 0) {
        throw new PermissionBrokerError(
          `refusing broker socket ${socketPath}: owned by uid ${info.uid}, expected ${euid}`,
          { code: "untrusted_socket" },
        );
      }
      if (info.mode & 2) {
        throw new PermissionBrokerError(`refusing broker socket ${socketPath}: world-writable`, {
          code: "untrusted_socket",
        });
      }
    },
  };
}
var NOOP_PEER_CHECKER = Object.freeze({
  verifySocketPeer(_socketPath, _socket) {},
});
var cancelContext = new AsyncLocalStorage();
function brokerCancelSignalFromAbortSignal(signal) {
  return {
    get cancelled() {
      return signal.aborted;
    },
    onCancel(listener) {
      if (signal.aborted) {
        listener();
        return () => void 0;
      }
      signal.addEventListener("abort", listener, { once: true });
      return () => signal.removeEventListener("abort", listener);
    },
  };
}
function runWithBrokerCancelSignal(signal, callback) {
  return cancelContext.run(signal, callback);
}
function currentBrokerCancelSignal() {
  return cancelContext.getStore();
}
var interruptibleBrokerSleep = async (ms, cancelSignal) => {
  if (ms <= 0 || cancelSignal?.cancelled) return;
  const onCancel = cancelSignal?.onCancel;
  if (onCancel) {
    await new Promise<void>((resolve22) => {
      let unsubscribe = () => void 0;
      const done = () => {
        clearTimeout(timer);
        unsubscribe();
        resolve22();
      };
      const timer = setTimeout(done, ms);
      unsubscribe = onCancel(done);
    });
    return;
  }
  const startedAt = Date.now();
  const slice = Math.min(ms, 50);
  while (Date.now() - startedAt < ms) {
    if (cancelSignal?.cancelled) return;
    const remaining = ms - (Date.now() - startedAt);
    await new Promise<void>((resolve22) => setTimeout(resolve22, Math.min(slice, remaining)));
  }
};
function cancelledBrokerError() {
  return new PermissionBrokerError(
    "ZCode permission broker RPC was cancelled before the next socket transition",
    {
      code: BROKER_UNAVAILABLE_CODE,
      details: {
        rpc_deadline_state: "cancelled",
        request_delivery_state: "not_sent",
      },
    },
  );
}
export {
  ALLOW_ANY_PEER_ENV,
  ALLOW_DEV_BROKER_ENV,
  ALL_REASON_CODES,
  BROKER_RESPONSE_AMBIGUOUS_MESSAGE,
  BROKER_UNAVAILABLE_CODE,
  CUA_NOT_READY_KIND,
  DEFAULT_RPC_DEADLINE_CAP,
  DEFAULT_WARMUP_BACKOFF_BASE,
  DEFAULT_WARMUP_BACKOFF_CAP,
  DEFAULT_WARMUP_DEADLINE,
  DEV_BROKER_TRUTHY,
  HOLD_RESPONSE_CLEANUP_GRACE,
  HOLD_RESPONSE_CLEANUP_GRACE_MS,
  MAX_FRAME_BYTES,
  MAX_HOLD_DURATION,
  MAX_HOLD_DURATION_MS,
  NOOP_PEER_CHECKER,
  NOT_READY_DETAILS_KEYS,
  NOT_READY_MESSAGE,
  PERMISSION_REFRESH_INVALID_MESSAGE,
  PERMISSION_REFRESH_IN_PROGRESS_MESSAGE,
  PermissionBrokerError,
  REASON_BROKER_NOT_ACCEPTING,
  REASON_BROKER_RESPONSE_AMBIGUOUS,
  REASON_CALLER_TIMEOUT,
  REASON_MESSAGE,
  REASON_PERMISSION_REFRESH_INVALID,
  REASON_PERMISSION_REFRESH_IN_PROGRESS,
  REASON_RESTART_DEFERRED_ACTIVE_TURN,
  REASON_RETRYABLE,
  WIN32_NAMED_PIPE_NAME_RE,
  allowAnyPeer,
  boundedHoldDuration,
  brokerCancelSignalFromAbortSignal,
  businessResponseTimeout,
  cancelContext,
  cancelledBrokerError,
  cuaNotReadyPayload,
  currentBrokerCancelSignal,
  defaultPeerCredentialChecker,
  devBrokerOptIn,
  extractAuthErrorMessage,
  interruptibleBrokerSleep,
  isBrokerUnavailableException,
  isValidErrorEnvelope,
  legacyHelperMessageProvesActionNotSent,
  notReadyDetails,
  notReadyResultForException,
  parseErrorPayload,
  permissionBrokerPermissionError,
  runWithBrokerCancelSignal,
  shouldPropagateToWrapper,
};
