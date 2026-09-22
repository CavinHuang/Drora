import { AsyncLocalStorage } from "node:async_hooks";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { basename, isAbsolute, win32 } from "node:path";
import { z } from "zod";
import {
  BROKER_UNAVAILABLE_CODE,
  DEFAULT_RPC_DEADLINE_CAP,
  DEFAULT_WARMUP_BACKOFF_BASE,
  DEFAULT_WARMUP_BACKOFF_CAP,
  DEFAULT_WARMUP_DEADLINE,
  MAX_FRAME_BYTES,
  PERMISSION_REFRESH_INVALID_MESSAGE,
  PERMISSION_REFRESH_IN_PROGRESS_MESSAGE,
  PermissionBrokerError,
  boundedHoldDuration,
  businessResponseTimeout,
  cancelledBrokerError,
  currentBrokerCancelSignal,
  defaultPeerCredentialChecker,
  extractAuthErrorMessage,
  interruptibleBrokerSleep,
  isValidErrorEnvelope,
  parseErrorPayload,
  permissionBrokerPermissionError,
} from "./errors.js";
var PermissionBrokerClient = class {
  socketPath;
  timeoutMs;
  token;
  peerChecker;
  maxFrameBytes;
  nowMs;
  cancelSignal;
  onPresentation;
  _nextId = 0;
  constructor(socketPath, options) {
    if (!socketPath || !socketPath.trim()) {
      throw new Error("permission broker socket path must be non-empty");
    }
    if (
      typeof options.timeoutMs !== "number" ||
      !Number.isFinite(options.timeoutMs) ||
      options.timeoutMs <= 0
    ) {
      throw new Error(
        `permission broker timeout must be a finite, positive number of milliseconds, got ${options.timeoutMs}`,
      );
    }
    this.socketPath = socketPath;
    this.timeoutMs = options.timeoutMs;
    this.token =
      typeof options.token === "string" && options.token.trim().length > 0
        ? options.token.trim()
        : null;
    this.peerChecker = options.peerChecker ?? defaultPeerCredentialChecker();
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES;
    this.nowMs = options.nowMs ?? Date.now;
    this.cancelSignal = options.cancelSignal;
    this.onPresentation = options.onPresentation;
  }
  /**
   * Allocate the next request id. Mirror Python `_request_id()` (broker.py:484-487):
   * first call returns 1; auth line uses the fixed id 0; subsequent calls
   * monotonically increment. Single-threaded JS makes `++` atomic without a
   * lock — Python's `threading.Lock` is for thread-safety we don't need.
   */
  requestId() {
    this._nextId += 1;
    return this._nextId;
  }
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
  async call(method, params, _opts: any = {}) {
    if (this.cancelSignal?.cancelled) {
      throw cancelledBrokerError();
    }
    const requestId = this.requestId();
    const methodLine = `${JSON.stringify({ id: requestId, method, params })}
`;
    const authLine =
      this.token !== null
        ? `${JSON.stringify({ id: 0, method: "authenticate", params: { token: this.token } })}
`
        : null;
    const businessTimeoutMs = businessResponseTimeout(this.timeoutMs, method, params);
    let requestDeliveryState = "not_sent";
    const sanitize = (text) => text.split(this.socketPath).join("<socket>");
    let buffer = "";
    let authed = false;
    const outcome = { result: null, error: null };
    const socket = createConnection(this.socketPath);
    const settlement = new Promise<void>((resolve22) => {
      let settled = false;
      let unsubscribeCancel = () => void 0;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        unsubscribeCancel();
        try {
          socket.destroy();
        } catch {}
        fn();
        resolve22();
      };
      const cancelBeforeSend = () => {
        if (requestDeliveryState !== "not_sent") return;
        finish(() => {
          outcome.error = cancelledBrokerError();
        });
      };
      if (this.cancelSignal?.onCancel) {
        unsubscribeCancel = this.cancelSignal.onCancel(cancelBeforeSend);
      }
      if (this.cancelSignal?.cancelled) {
        cancelBeforeSend();
      }
      socket.on("close", () => {
        if (authed && outcome.result) return;
        if (outcome.error) return;
        const state = requestDeliveryState;
        finish(() => {
          outcome.error = brokerUnavailableFromTransport(
            sanitize("broker connection closed before reply"),
            state,
            "connection_closed",
          );
        });
      });
      socket.on("error", (error51) => {
        if (outcome.error || outcome.result) return;
        const state = requestDeliveryState;
        finish(() => {
          outcome.error = wrapTransportError(error51, sanitize, state);
        });
      });
      socket.setTimeout(businessTimeoutMs);
      socket.setEncoding("utf8");
      socket.on("timeout", () => {
        if (outcome.error || outcome.result) return;
        const state = requestDeliveryState;
        finish(() => {
          outcome.error = wrapTransportError(
            new Error(sanitize("broker exchange timed out")),
            sanitize,
            state,
            "timeout",
          );
        });
      });
      socket.on("connect", () => {
        try {
          this.peerChecker.verifySocketPeer(this.socketPath, socket);
        } catch (error51) {
          const state = requestDeliveryState;
          finish(() => {
            outcome.error = wrapPeerCheckError(error51, state);
          });
          return;
        }
        if (authLine !== null) {
          socket.write(authLine);
        } else {
          requestDeliveryState = "possibly_sent";
          authed = true;
          socket.write(methodLine);
        }
      });
      socket.on("data", (chunk) => {
        buffer += chunk;
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const raw = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (!raw.trim()) continue;
          if (raw.length > this.maxFrameBytes) {
            const state = requestDeliveryState;
            finish(() => {
              outcome.error = new PermissionBrokerError(
                `ZCode permission broker frame exceeded ${this.maxFrameBytes} bytes`,
                {
                  code: BROKER_UNAVAILABLE_CODE,
                  details: { request_delivery_state: state },
                },
              );
            });
            return;
          }
          let reply;
          try {
            reply = JSON.parse(raw);
          } catch {
            const state = authed ? "possibly_sent" : requestDeliveryState;
            finish(() => {
              outcome.error = new PermissionBrokerError(
                "ZCode permission broker returned invalid JSON",
                {
                  code: BROKER_UNAVAILABLE_CODE,
                  details: {
                    broker_response_state: "invalid_json",
                    request_delivery_state: state,
                  },
                },
              );
            });
            return;
          }
          if (!authed && authLine !== null) {
            if (reply === null || typeof reply !== "object" || Array.isArray(reply)) {
              finish(() => {
                outcome.error = permissionBrokerPermissionError(
                  "ZCode permission broker returned a non-object authenticate response",
                  { code: "not_authorized" },
                );
              });
              return;
            }
            if (reply.ok === true) {
              authed = true;
              requestDeliveryState = "possibly_sent";
              socket.write(methodLine);
              continue;
            }
            const message2 = extractAuthErrorMessage(reply);
            finish(() => {
              outcome.error = permissionBrokerPermissionError(
                `ZCode permission broker rejected the auth token: ${message2}`,
                { code: "not_authorized" },
              );
            });
            return;
          }
          if (reply === null || typeof reply !== "object" || Array.isArray(reply)) {
            finish(() => {
              outcome.error = invalidResponseError(
                "ZCode permission broker response must be a JSON object",
                "non_object",
              );
            });
            return;
          }
          if (reply.id !== requestId) {
            finish(() => {
              outcome.error = invalidResponseError(
                `ZCode permission broker response id mismatch: expected ${requestId}, got ${JSON.stringify(reply.id)}`,
                "id_mismatch",
              );
            });
            return;
          }
          if (typeof reply.ok !== "boolean") {
            finish(() => {
              outcome.error = invalidResponseError(
                "ZCode permission broker response has an invalid ok field",
                "invalid_envelope",
              );
            });
            return;
          }
          if (reply.ok === true) {
            finish(() => {
              if (reply.presentation !== void 0) {
                try {
                  this.onPresentation?.(reply.presentation);
                } catch {}
              }
              outcome.result = { value: reply.result };
            });
            return;
          }
          if (!isValidErrorEnvelope(reply.error)) {
            finish(() => {
              outcome.error = invalidResponseError(
                "ZCode permission broker returned an invalid error envelope",
                "invalid_envelope",
              );
            });
            return;
          }
          const { message, code, details } = parseErrorPayload(reply.error);
          if (code === "permission_denied" || code === "not_authorized") {
            finish(() => {
              outcome.error = permissionBrokerPermissionError(message, {
                code,
                details,
              });
            });
          } else {
            finish(() => {
              outcome.error = new PermissionBrokerError(message, {
                code,
                details,
              });
            });
          }
          return;
        }
      });
    });
    await settlement;
    if (outcome.error) {
      throw outcome.error;
    }
    if (outcome.result) {
      return outcome.result.value;
    }
    throw new PermissionBrokerError("ZCode permission broker exchange ended without a reply", {
      code: BROKER_UNAVAILABLE_CODE,
      details: { request_delivery_state: requestDeliveryState },
    });
  }
};
function wrapTransportError(error51, sanitize, state, errorType?) {
  const message = error51 instanceof Error ? error51.message : String(error51 ?? "transport error");
  const errorTypeResolved =
    errorType ??
    (error51 instanceof Error ? error51.name : typeof error51 === "string" ? "string" : "unknown");
  return new PermissionBrokerError(sanitize(`ZCode permission broker is unavailable: ${message}`), {
    code: BROKER_UNAVAILABLE_CODE,
    details: {
      error_type: errorTypeResolved,
      request_delivery_state: state,
    },
  });
}
function wrapPeerCheckError(error51, state) {
  if (error51 instanceof PermissionBrokerError) {
    if (error51.code === BROKER_UNAVAILABLE_CODE) {
      const details = { ...error51.details, request_delivery_state: state };
      return new PermissionBrokerError(error51.message, {
        code: error51.code,
        details,
        permissionError: error51.permissionError,
      });
    }
    return error51;
  }
  return new PermissionBrokerError(
    `peer credential check raised unexpectedly: ${String(error51)}`,
    {
      code: BROKER_UNAVAILABLE_CODE,
      details: { request_delivery_state: state },
    },
  );
}
function invalidResponseError(message, brokerResponseState) {
  return new PermissionBrokerError(message, {
    code: BROKER_UNAVAILABLE_CODE,
    details: {
      broker_response_state: brokerResponseState,
      request_delivery_state: "possibly_sent",
    },
  });
}
function brokerUnavailableFromTransport(message, state, errorType) {
  return new PermissionBrokerError(message, {
    code: BROKER_UNAVAILABLE_CODE,
    details: {
      error_type: errorType,
      request_delivery_state: state,
    },
  });
}
var ZCODE_CUA_BROKER_REFRESH_MARKER_ENV_KEY = "ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER";
var MARKER_KEYS = Object.freeze(/* @__PURE__ */ new Set(["schema", "kind", "deadlineEpochMs"]));
var MARKER_SCHEMA = 1;
var MARKER_KIND = "permission_refresh";
var MAX_MARKER_BYTES = 4096;
var DEFAULT_BACKOFF_BASE = 0.05;
var DEFAULT_BACKOFF_CAP = 0.25;
function normalizeRefreshMarkerPath(value, env = process.env) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("permission_broker_refresh_marker must be a non-empty string or None");
  }
  const expanded = expandVarsAndUser(value.trim(), env);
  if (process.platform === "win32") {
    if (!isWindowsAbsolutePath(expanded)) {
      throw new Error("permission_broker_refresh_marker must be an absolute path");
    }
    return expanded;
  }
  if (!isAbsolutePath(expanded)) {
    throw new Error("permission_broker_refresh_marker must be an absolute path");
  }
  return normalizePath(expanded);
}
function expandVarsAndUser(input, env) {
  let out = input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name) => env[name] ?? "");
  out = out.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name) => env[name] ?? "");
  if (out.startsWith("~")) {
    const os = createRequire(import.meta.url)("node:os");
    out = os.homedir() + out.slice(1);
  }
  return out;
}
function isAbsolutePath(p) {
  return p.startsWith("/");
}
function isWindowsAbsolutePath(p) {
  return /^[A-Za-z]:[\\/]/.test(p) || /^[\\/][\\/][^\\/]+[\\/][^\\/]+/.test(p);
}
function normalizePath(p) {
  const parts = p.split("/");
  const stack = [];
  for (const segment of parts) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (stack.length > 0) stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return "/" + stack.join("/");
}
function readPermissionRefreshMarkerWin32(normalizedPath, nowMs) {
  let data;
  try {
    data = readFileSync(normalizedPath);
  } catch (cause) {
    if (cause.code === "ENOENT") return null;
    throw markerUnavailable("open_failed", false, cause);
  }
  if (data.length > MAX_MARKER_BYTES) {
    throw markerUnavailable("marker_too_large", false);
  }
  return parseMarker(data, nowMs);
}
function readPermissionRefreshMarker(path, nowMs = Date.now) {
  const normalized = normalizeRefreshMarkerPath(path);
  if (normalized === null) {
    throw new Error("permission broker refresh marker path is required");
  }
  if (process.platform === "win32") {
    return readPermissionRefreshMarkerWin32(normalized, nowMs);
  }
  const lastSlash = normalized.lastIndexOf("/");
  const parentPath = lastSlash <= 0 ? "/" : normalized.slice(0, lastSlash);
  let parentBefore;
  try {
    parentBefore = lstatSync(parentPath, { throwIfNoEntry: false });
  } catch (cause) {
    throw markerUnavailable("parent_lstat_failed", false, cause);
  }
  if (parentBefore === void 0) {
    return null;
  }
  validateParentStat(parentBefore, parentPath);
  let before;
  try {
    before = lstatSync(normalized, { throwIfNoEntry: false });
  } catch (cause) {
    throw markerUnavailable("lstat_failed", false, cause);
  }
  if (before === void 0) {
    return null;
  }
  validateMarkerStat(before, normalized);
  let fd;
  try {
    fd = openSync(normalized, "r");
  } catch (cause) {
    if (cause.code === "ENOENT") {
      return null;
    }
    throw markerUnavailable("open_failed", false, cause);
  }
  let data;
  try {
    const opened = fstatSync(fd);
    validateMarkerStat(opened, normalized);
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw markerUnavailable("replaced_while_opening", true);
    }
    data = readBounded(fd, MAX_MARKER_BYTES);
  } catch (cause) {
    if (cause instanceof PermissionBrokerError) throw cause;
    throw markerUnavailable("read_failed", false, cause);
  } finally {
    try {
      closeSync(fd);
    } catch {}
  }
  return parseMarker(data, nowMs);
}
function validateParentStat(info, path) {
  const euid = typeof process.geteuid === "function" ? process.geteuid() : void 0;
  if (euid === void 0) {
    throw markerUnavailable("euid_unavailable", false);
  }
  if (info.uid !== euid) {
    throw markerUnavailable("parent_owner_mismatch", false);
  }
  if (!info.isDirectory()) {
    throw markerUnavailable("parent_not_directory", false);
  }
  if ((info.mode & 511) !== 448) {
    throw markerUnavailable("parent_not_private", false);
  }
  void path;
}
function validateMarkerStat(info, path) {
  const euid = typeof process.geteuid === "function" ? process.geteuid() : void 0;
  if (euid === void 0) {
    throw markerUnavailable("euid_unavailable", false);
  }
  if (info.uid !== euid) {
    throw markerUnavailable("owner_mismatch", false);
  }
  if (!info.isFile()) {
    throw markerUnavailable("not_regular_file", false);
  }
  if (info.mode & 18) {
    throw markerUnavailable("writable_by_group_or_world", false);
  }
  void path;
}
function readBounded(fd, max) {
  const chunks = [];
  let remaining = max + 1;
  while (remaining > 0) {
    const buf = Buffer.alloc(Math.min(remaining, 4096));
    let bytesRead;
    try {
      bytesRead = readSync(fd, buf, 0, buf.length, null);
    } catch (cause) {
      throw markerUnavailable("read_failed", false, cause);
    }
    if (bytesRead === 0) break;
    chunks.push(buf.subarray(0, bytesRead));
    remaining -= bytesRead;
  }
  const data = Buffer.concat(chunks);
  if (data.length > max) {
    throw markerUnavailable("marker_too_large", false);
  }
  return data;
}
function parseMarker(data, nowMs) {
  const text = data.toString("utf8");
  let payload;
  try {
    payload = JSON.parse(text, (key, value) => {
      return value;
    });
  } catch (cause) {
    throw markerUnavailable("invalid_json", false, cause);
  }
  if (hasDuplicateKeys(text)) {
    throw markerUnavailable("invalid_json", false);
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw markerUnavailable("invalid_shape", false);
  }
  const record2 = payload;
  if (!sameKeySet(record2, MARKER_KEYS)) {
    throw markerUnavailable("invalid_shape", false);
  }
  if (record2.schema !== MARKER_SCHEMA) {
    throw markerUnavailable("invalid_schema", false);
  }
  if (record2.kind !== MARKER_KIND) {
    throw markerUnavailable("invalid_kind", false);
  }
  const deadline = record2.deadlineEpochMs;
  if (typeof deadline === "boolean" || typeof deadline !== "number") {
    throw markerUnavailable("invalid_deadline", false);
  }
  if (!Number.isFinite(deadline)) {
    throw markerUnavailable("invalid_deadline", false);
  }
  if (deadline <= nowMs()) {
    throw markerUnavailable("deadline_elapsed", true);
  }
  return { deadlineEpochMs: deadline };
}
function hasDuplicateKeys(jsonText) {
  const keys = ['"schema"', '"kind"', '"deadlineEpochMs"'];
  for (const k of keys) {
    let count = 0;
    let idx = 0;
    while ((idx = jsonText.indexOf(k, idx)) !== -1) {
      count += 1;
      idx += k.length;
      if (count > 1) return true;
    }
  }
  return false;
}
function sameKeySet(record2, expected) {
  const actual = Object.keys(record2);
  if (actual.length !== expected.size) return false;
  for (const k of actual) {
    if (!expected.has(k)) return false;
  }
  return true;
}
function markerUnavailable(reason, retryable, _cause?) {
  return new PermissionBrokerError(
    retryable ? PERMISSION_REFRESH_IN_PROGRESS_MESSAGE : PERMISSION_REFRESH_INVALID_MESSAGE,
    {
      code: BROKER_UNAVAILABLE_CODE,
      details: {
        refresh_marker_state: reason,
        refresh_marker_retryable: retryable,
        // The refresh gate is only entered before a wire attempt (admission)
        // or after a failure already classified as not_sent. No method frame
        // can have crossed the socket while this error is produced.
        request_delivery_state: "not_sent",
      },
    },
  );
}
var PermissionBrokerRefreshGate = class {
  markerPath;
  backoffBaseMs;
  backoffCapMs;
  nowMs;
  sleep;
  cancelSignal;
  reader;
  constructor(markerPath, options: any = {}) {
    const normalized = normalizeRefreshMarkerPath(markerPath);
    if (normalized === null) {
      throw new Error("permission broker refresh marker path is required");
    }
    this.markerPath = normalized;
    const base = (options as any).backoffBaseMs ?? DEFAULT_BACKOFF_BASE * 1e3;
    const cap = (options as any).backoffCapMs ?? DEFAULT_BACKOFF_CAP * 1e3;
    if (!(base > 0) || !(cap > 0)) {
      throw new Error("permission broker refresh marker backoff must be positive");
    }
    this.backoffBaseMs = base;
    this.backoffCapMs = Math.max(cap, base);
    this.nowMs = (options as any).nowMs ?? Date.now;
    this.sleep = (options as any).sleep ?? interruptibleBrokerSleep;
    this.cancelSignal = (options as any).cancelSignal;
    this.reader = (options as any).reader ?? ((p) => readPermissionRefreshMarker(p, this.nowMs));
  }
  /**
   * Wait to the first deadline and report whether a marker was observed.
   *
   * Returns true iff a marker was seen at least once before it cleared
   * (Python: `marker_observed`). Throws {@link PermissionBrokerError}
   * (code=broker_unavailable) when the deadline elapses or the marker is
   * corrupt/unsafe.
   */
  async waitUntilClear(absoluteDeadlineMs, callCancelSignal) {
    if (!Number.isFinite(absoluteDeadlineMs)) {
      throw new Error("permission broker RPC absolute deadline must be finite");
    }
    let delay = this.backoffBaseMs;
    let markerDeadlineMs = null;
    let markerObserved = false;
    while (true) {
      const cancelSignal = callCancelSignal ?? this.cancelSignal;
      if (cancelSignal?.cancelled) {
        throw cancelledBrokerError();
      }
      let marker;
      try {
        marker = this.reader(this.markerPath);
      } catch (cause) {
        if (cause instanceof PermissionBrokerError) throw cause;
        throw markerUnavailable("read_failed", false, cause);
      }
      if (marker === null) {
        return markerObserved;
      }
      markerObserved = true;
      const nowMs = this.nowMs();
      markerDeadlineMs =
        markerDeadlineMs === null
          ? marker.deadlineEpochMs
          : Math.min(markerDeadlineMs, marker.deadlineEpochMs);
      const markerRemainingMs = markerDeadlineMs - nowMs;
      if (markerRemainingMs <= 0) {
        throw markerUnavailable("deadline_elapsed", true);
      }
      const clientRemainingMs = absoluteDeadlineMs - nowMs;
      if (clientRemainingMs <= 0) {
        throw markerUnavailable("client_deadline_elapsed", true);
      }
      await this.sleep(Math.min(delay, markerRemainingMs, clientRemainingMs), cancelSignal);
      if (cancelSignal?.cancelled) {
        throw cancelledBrokerError();
      }
      delay = Math.min(delay * 2, this.backoffCapMs);
    }
  }
};
function computeAbsoluteDeadline(startedAtMs, method, params, options: any = {}) {
  const capMs = (options as any).rpcDeadlineCapMs ?? DEFAULT_RPC_DEADLINE_CAP * 1e3;
  const holdMs = boundedHoldDuration(method, params ?? {});
  const local = startedAtMs + capMs + holdMs;
  return (options as any).outerDeadlineMs !== void 0
    ? Math.min(local, (options as any).outerDeadlineMs)
    : local;
}
async function callWithWarmupRetry(client, method, params, options) {
  const monotonic = options.monotonic ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const invoke = options.callOnce ?? ((c, m, p) => c.call(m, p));
  let refreshObserved = options.refreshObserved === true;
  let currentClient = client;
  let attempt = 0;
  while (true) {
    if (options.cancelSignal?.cancelled) {
      throw cancelledBrokerError();
    }
    if (monotonic() >= options.absoluteDeadlineMs) {
      throw new PermissionBrokerError("ZCode permission broker RPC exceeded its client deadline", {
        code: BROKER_UNAVAILABLE_CODE,
        details: { rpc_deadline_state: "elapsed" },
      });
    }
    try {
      return await invoke(currentClient, method, params);
    } catch (exc) {
      if (!(exc instanceof PermissionBrokerError)) throw exc;
      if (exc.code !== BROKER_UNAVAILABLE_CODE) {
        throw exc;
      }
      if (exc.details.request_delivery_state === "possibly_sent") {
        throw exc;
      }
      attempt += 1;
      if (monotonic() >= options.absoluteDeadlineMs) {
        throw exc;
      }
      if (options.refreshCheck !== void 0) {
        const observed = await options.refreshCheck(
          options.absoluteDeadlineMs,
          options.cancelSignal,
        );
        refreshObserved = refreshObserved || observed;
      }
      const stopAt = refreshObserved
        ? options.absoluteDeadlineMs
        : Math.min(options.absoluteDeadlineMs, options.retryDeadlineMs);
      if (monotonic() >= stopAt) {
        throw exc;
      }
      const remaining = stopAt - monotonic();
      if (remaining <= 0) {
        throw exc;
      }
      const cap = Math.max(options.backoffBaseMs, options.backoffCapMs);
      const raw = options.backoffBaseMs * Math.pow(2, attempt - 1);
      const delay = Math.min(raw, cap, remaining);
      await sleep(Math.max(0, delay), options.cancelSignal);
      if (options.cancelSignal?.cancelled) {
        throw cancelledBrokerError();
      }
      if (monotonic() >= stopAt) {
        throw exc;
      }
    }
  }
}
function resolveWarmupConfig(options: any = {}) {
  const warmupDeadlineMs = resolvePositiveFloat(
    (options as any).warmupDeadlineMs,
    DEFAULT_WARMUP_DEADLINE * 1e3,
    "warmup_deadline_ms",
    true,
  );
  const backoffBaseMs = resolvePositiveFloat(
    (options as any).backoffBaseMs,
    DEFAULT_WARMUP_BACKOFF_BASE * 1e3,
    "warmup_backoff_base_ms",
    false,
  );
  let backoffCapMs = resolvePositiveFloat(
    (options as any).backoffCapMs,
    DEFAULT_WARMUP_BACKOFF_CAP * 1e3,
    "warmup_backoff_cap_ms",
    false,
  );
  if (backoffCapMs < backoffBaseMs) {
    backoffCapMs = backoffBaseMs;
  }
  const rpcDeadlineCapMs = resolvePositiveFloat(
    (options as any).rpcDeadlineCapMs,
    DEFAULT_RPC_DEADLINE_CAP * 1e3,
    "rpc_deadline_cap_ms",
    false,
  );
  return { warmupDeadlineMs, backoffBaseMs, backoffCapMs, rpcDeadlineCapMs };
}
function resolvePositiveFloat(value, defaultValue, field, allowZero) {
  if (value === void 0) return defaultValue;
  const bad =
    typeof value !== "number" || !Number.isFinite(value) || value < 0 || (!allowZero && value <= 0);
  if (bad) {
    const kind = allowZero ? "a finite, non-negative" : "a strictly positive";
    throw new Error(`${field} must be ${kind} number of ms, got ${value}`);
  }
  return value;
}
var defaultSleep = interruptibleBrokerSleep;
var CUA_APP_ASSOCIATIONS_META_KEY = "zcode.cua/app-associations-v1";
var CUA_APP_ASSOCIATIONS_MAX_META_BYTES = 384 * 1024;
var CUA_APP_ASSOCIATIONS_MAX_ITEMS = 128;
var CUA_APP_ASSOCIATIONS_MAX_ICON_BYTES = 24 * 1024;
var CUA_APP_ASSOCIATIONS_MAX_ITEM_ICON_BYTES = 256 * 1024;
var cuaApplicationIconSchema = z
  .object({
    mimeType: z.literal("image/png"),
    data: z
      .string()
      .min(1)
      .max(Math.ceil((CUA_APP_ASSOCIATIONS_MAX_ICON_BYTES * 4) / 3) + 8),
  })
  .strict();
var cuaApplicationPresentationSchema = z
  .object({
    appKey: z.string().trim().min(1).max(2048),
    displayName: z.string().trim().min(1).max(512).optional(),
    icon: cuaApplicationIconSchema.optional(),
  })
  .strict();
var cuaAppAssociationsSchema = z
  .object({
    schemaVersion: z.literal(1),
    primary: cuaApplicationPresentationSchema.optional(),
    items: z
      .array(
        z
          .object({
            resultIndex: z.number().int().min(0),
            application: cuaApplicationPresentationSchema,
          })
          .strict(),
      )
      .max(CUA_APP_ASSOCIATIONS_MAX_ITEMS)
      .optional(),
  })
  .strict();
var invocationStorage = new AsyncLocalStorage();
function normalizedText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function normalizePid(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
function normalizedWindowsPath(value) {
  return win32.normalize(value.replaceAll("/", "\\")).toLowerCase();
}
function deriveApplicationKey(evidence, platform = process.platform) {
  const aumid = normalizedText(evidence.aumid);
  const bundleId = normalizedText(evidence.bundle_id);
  const executablePath = normalizedText(evidence.executable_path) ?? bundleId;
  let key;
  if (platform === "darwin") key = bundleId ? `darwin:${bundleId.toLowerCase()}` : void 0;
  if (platform === "win32") {
    if (aumid) key = `windows-aumid:${aumid.toLowerCase()}`;
    else if (
      executablePath &&
      win32.isAbsolute(executablePath) &&
      basename(executablePath).toLowerCase() !== "applicationframehost.exe"
    ) {
      key = `windows-exe:${normalizedWindowsPath(executablePath)}`;
    }
  }
  if (platform === "linux") {
    if (executablePath && isAbsolute(executablePath)) key = `linux-exe:${executablePath}`;
  }
  return key && key.length <= 2048 ? key : void 0;
}
function validPngData(value) {
  const data = normalizedText(value);
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/u.test(data)) return void 0;
  const bytes = Buffer.from(data, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > CUA_APP_ASSOCIATIONS_MAX_ICON_BYTES) {
    return void 0;
  }
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, pngSignature.length).equals(pngSignature) || bytes.byteLength < 24) {
    return void 0;
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && width <= 32 && height > 0 && height <= 32 ? data : void 0;
}
function presentationFromEvidence(evidence) {
  const appKey = deriveApplicationKey(evidence);
  if (!appKey) return void 0;
  const displayName = normalizedText(evidence.name);
  const iconPng = validPngData(evidence.icon_png);
  return {
    appKey,
    ...(displayName ? { displayName } : {}),
    ...(iconPng ? { icon: { mimeType: "image/png", data: iconPng } } : {}),
  };
}
function runWithTargetAppDisplayContext(operation) {
  return invocationStorage.run(
    {
      items: /* @__PURE__ */ new Map(),
      lookupAttempts: /* @__PURE__ */ new Set(),
      conflicted: false,
    },
    operation,
  );
}
function displayLookupKey(evidence) {
  const identity = deriveApplicationKey(evidence);
  if (identity) return identity;
  const pid = normalizePid(evidence.pid);
  if (pid) return `pid:${pid}`;
  const name = normalizedText(evidence.name)?.toLowerCase();
  if (name) return `name:${name}`;
  const windowId = normalizePid(evidence.window_id);
  return windowId ? `window:${windowId}` : void 0;
}
function beginTargetAppDisplayLookup(evidence) {
  const state = invocationStorage.getStore();
  const key = displayLookupKey(evidence);
  if (!state || !key || (state as any).conflicted || (state as any).primary?.icon) return false;
  if ((state as any).lookupAttempts.has(key)) return false;
  (state as any).lookupAttempts.add(key);
  return true;
}
function recordTargetAppDisplayEvidence(evidence) {
  const state = invocationStorage.getStore();
  const presentation = presentationFromEvidence(evidence);
  if (!state || !presentation || (state as any).conflicted) return;
  if ((state as any).primaryIdentity && (state as any).primaryIdentity !== presentation.appKey) {
    (state as any).conflicted = true;
    (state as any).primary = void 0;
    return;
  }
  (state as any).primaryIdentity ??= presentation.appKey;
  (state as any).primary = {
    appKey: presentation.appKey,
    ...((state as any).primary?.displayName || presentation.displayName
      ? { displayName: (state as any).primary?.displayName ?? presentation.displayName }
      : {}),
    ...((state as any).primary?.icon || presentation.icon
      ? { icon: (state as any).primary?.icon ?? presentation.icon }
      : {}),
  };
}
function recordAppAssociationItems(items) {
  const state = invocationStorage.getStore();
  if (!state) return;
  for (const item of items.slice(0, CUA_APP_ASSOCIATIONS_MAX_ITEMS)) {
    if (!Number.isInteger(item.resultIndex) || item.resultIndex < 0) continue;
    const presentation = presentationFromEvidence(item.evidence);
    if (presentation) {
      (state as any).items.set(item.resultIndex, {
        application: presentation,
        active: item.evidence.active === true,
      });
    }
  }
}
function fitItemsToBudgets(items) {
  const iconPriority = [...items]
    .filter((item) => item.application.icon)
    .sort((left, right) => Number(right.active) - Number(left.active));
  const keptIcons = /* @__PURE__ */ new Set();
  let iconBytes = 0;
  for (const item of iconPriority) {
    const icon = item.application.icon;
    const bytes = Buffer.from(icon.data, "base64").byteLength;
    if (iconBytes + bytes <= CUA_APP_ASSOCIATIONS_MAX_ITEM_ICON_BYTES) {
      iconBytes += bytes;
      keptIcons.add(item.resultIndex);
    }
  }
  const projected = items.map(({ resultIndex, application }) => {
    if (!application.icon || keptIcons.has(resultIndex)) return { resultIndex, application };
    const { icon: _icon, ...withoutIcon } = application;
    return { resultIndex, application: withoutIcon };
  });
  for (const candidate of [...iconPriority].reverse()) {
    if (
      Buffer.byteLength(JSON.stringify({ schemaVersion: 1, items: projected }), "utf8") <=
      CUA_APP_ASSOCIATIONS_MAX_META_BYTES
    ) {
      break;
    }
    const projectedItem = projected.find((item) => item.resultIndex === candidate.resultIndex);
    if (!projectedItem?.application.icon) continue;
    const { icon: _icon, ...withoutIcon } = projectedItem.application;
    projectedItem.application = withoutIcon;
  }
  return projected;
}
function readAppAssociations(mode) {
  const state = invocationStorage.getStore();
  if (!state || mode === "none") return void 0;
  const value =
    mode === "items"
      ? {
          schemaVersion: 1,
          items: fitItemsToBudgets(
            [...(state as any).items.entries()].map(([resultIndex, item]) => ({
              resultIndex,
              ...item,
            })),
          ),
        }
      : {
          schemaVersion: 1,
          ...((state as any).primary ? { primary: (state as any).primary } : {}),
        };
  if (
    (mode === "primary" && !(value as any).primary) ||
    (mode === "items" && !value.items?.length)
  ) {
    return void 0;
  }
  const parsed = cuaAppAssociationsSchema.safeParse(value);
  if (!parsed.success) return void 0;
  return Buffer.byteLength(JSON.stringify(parsed.data), "utf8") <=
    CUA_APP_ASSOCIATIONS_MAX_META_BYTES
    ? parsed.data
    : void 0;
}
function attachAppAssociationsMeta(result, mode = "primary") {
  const associations = readAppAssociations(mode);
  if (!associations) return result;
  return {
    ...result,
    _meta: {
      ...result._meta,
      [CUA_APP_ASSOCIATIONS_META_KEY]: associations,
    },
  };
}
var storage = new AsyncLocalStorage();
function parsePipToolRequestContext(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record2 = value;
  const sessionId = typeof record2.session_id === "string" ? record2.session_id.trim() : "";
  const turnId = typeof record2.turn_id === "string" ? record2.turn_id.trim() : "";
  const valid = (identifier) =>
    identifier.length > 0 && identifier.length <= 255 && !identifier.includes("\0");
  return valid(sessionId) && valid(turnId) ? { sessionId, turnId } : null;
}
function runWithPipToolRequestContext(value, operation) {
  const context = parsePipToolRequestContext(value);
  return context ? storage.run(context, operation) : operation();
}
function currentPipToolRequestContext() {
  return storage.getStore() ?? null;
}
var BrokerClient = class {
  socketPath;
  token;
  // Warmup retry config (Python defaults: 2s retry window, 150ms→750ms backoff).
  // Resolved once at construction; the values come from the M3 constants module
  // (broker.py:93-95 byte-equal), so a parity change there flows through here
  // without a matching edit.
  warmup = resolveWarmupConfig();
  // Cached broker_info claim (see claim()). Undefined = not yet attempted (or a
  // prior attempt failed and was cleared for retry). A resolved promise = the
  // Helper has been claimed and its startup-claim watchdog lifted.
  claimPromise;
  // P1-d: permission-refresh marker fence. Undefined when no marker path is
  // configured (standalone mode without a Host, or a Host that doesn't
  // publish markers). When set, `invoke()` passes `refreshCheck` into
  // callWithWarmupRetry; the gate polls the marker file on every
  // broker_unavailable retry and waits for it to clear before the next
  // attempt. Observing a marker invalidates the cached claim (see below).
  refreshCheck;
  refreshGate;
  constructor(options) {
    this.socketPath = options.socketPath;
    this.token = options.token;
    const markerPath = options.refreshMarkerPath?.trim();
    if (markerPath) {
      const gate = new PermissionBrokerRefreshGate(markerPath);
      this.refreshGate = gate;
      this.refreshCheck = async (absoluteDeadlineMs, cancelSignal) => {
        const observed = await gate.waitUntilClear(absoluteDeadlineMs, cancelSignal);
        if (observed) {
          this.claimPromise = void 0;
        }
        return observed;
      };
    }
  }
  // ---------------------------------------------------------------------------
  // Screenshot — typed convenience over the generic `call`. The Helper returns
  // a base64 PNG; the screenshot tool handler decodes + re-encodes via sharp.
  // Uses kind:"read" so a soft timeout is safe (D-021); still routes through
  // the delivery-safety client so even reads get the envelope/peer-check
  // hardening — never the raw brokerExchange path.
  // ---------------------------------------------------------------------------
  async screenshot(options: any = {}) {
    const timeoutMs = (options as any).timeoutMs ?? 5e3;
    const result = await this.call(
      "screenshot",
      { display_id: (options as any).displayId ?? null },
      { kind: "read", timeoutMs },
    );
    const data = result?.data;
    if (typeof data !== "string" || data.length === 0) {
      throw new Error("broker screenshot returned empty image data");
    }
    return {
      format: typeof result?.format === "string" ? result.format : "image/png",
      data,
      ...(result?.display === void 0 ? {} : { display: result.display }),
      ...(result?.display_topology === void 0 ? {} : { display_topology: result.display_topology }),
      ...(result?.coordinate_contract === void 0
        ? {}
        : { coordinate_contract: result.coordinate_contract }),
      ...(result?.capture_windows === void 0 ? {} : { capture_windows: result.capture_windows }),
    };
  }
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
  async claim() {
    if (this.claimPromise) return this.claimPromise;
    this.claimPromise = (async () => {
      try {
        await this.invoke("broker_info", {}, { kind: "read", timeoutMs: 5e3 });
      } catch {
        this.claimPromise = void 0;
      }
    })();
    return this.claimPromise;
  }
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
  async call(method, params, opts) {
    await this.claim();
    return this.invoke(method, params, opts);
  }
  async invoke(method, params, opts) {
    const timeoutMs = opts.timeoutMs ?? (opts.kind === "read" ? 5e3 : 3e4);
    const cancelSignal = currentBrokerCancelSignal();
    const startedAt = Date.now();
    const absoluteDeadlineMs = computeAbsoluteDeadline(startedAt, method, params, {
      outerDeadlineMs: startedAt + timeoutMs,
    });
    const retryDeadlineMs = Math.min(this.warmup.warmupDeadlineMs, timeoutMs);
    let refreshObserved = false;
    if (this.refreshGate) {
      refreshObserved = await this.refreshGate.waitUntilClear(absoluteDeadlineMs, cancelSignal);
      if (refreshObserved) {
        this.claimPromise = void 0;
      }
    }
    const wireClient = new PermissionBrokerClient(this.socketPath, {
      timeoutMs,
      token: this.token,
      cancelSignal,
      onPresentation: recordBrokerPresentation,
    });
    const result = await callWithWarmupRetry(wireClient, method, params, {
      absoluteDeadlineMs,
      retryDeadlineMs,
      backoffBaseMs: this.warmup.backoffBaseMs,
      backoffCapMs: this.warmup.backoffCapMs,
      // P1-d: re-enter the marker fence on every broker_unavailable retry.
      // When the host rotates the Helper (TCC grant), this gate holds the
      // call until the new instance is listening, instead of surfacing
      // CUA_NOT_READY for the ~30s rotation window. Undefined when no marker
      // path was configured (callWithWarmupRetry then skips the fence).
      refreshCheck: this.refreshCheck,
      refreshObserved,
      cancelSignal,
    });
    return result;
  }
  /** 只由真实 Helper adapter 提供的宿主展示身份解析；测试 fake 未实现时保持原调用顺序。 */
  async resolveTargetAppDisplay(appRef2) {
    return this.call("application_info", { app_ref: appRef2 }, { kind: "read", timeoutMs: 500 });
  }
};
async function callBroker(deps, method, params, opts) {
  if (method === "capture_app") {
    const context = currentPipToolRequestContext();
    if (context) {
      params = {
        ...params,
        pip_session_context: {
          session_id: (context as any).sessionId,
          turn_id: (context as any).turnId,
        },
      };
    }
  }
  const appRef2 = readAppRef(params.app_ref);
  const displayLookup =
    method !== "application_info" && appRef2 ? startTargetAppDisplayLookup(deps, appRef2) : void 0;
  if (opts.kind === "read") {
    const result2 = await deps.broker.call(method, params, opts);
    await displayLookup;
    await recordBrokerResultTargetApp(deps, method, result2);
    return result2;
  }
  const isLongInputHold = method === "hold_key" || method === "hold_key_to_app";
  if (globalLongInputHoldActive || (isLongInputHold && globalQueuedActionCount > 0)) {
    throw new Error(
      `${method}: input_busy; another physical desktop action is active or queued, so this request was rejected before broker dispatch and no events were sent. action_sent=false.`,
    );
  }
  if (isLongInputHold) {
    globalLongInputHoldActive = true;
    let result2;
    try {
      result2 = await deps.broker.call(method, params, opts);
    } finally {
      globalLongInputHoldActive = false;
    }
    await displayLookup;
    await recordBrokerResultTargetApp(deps, method, result2);
    return result2;
  }
  globalQueuedActionCount += 1;
  const run = globalActionTail.then(
    () => deps.broker.call(method, params, opts),
    () => deps.broker.call(method, params, opts),
  );
  globalActionTail = run.then(
    () => void 0,
    () => void 0,
  );
  let result;
  try {
    result = await run;
  } finally {
    globalQueuedActionCount -= 1;
  }
  await displayLookup;
  await recordBrokerResultTargetApp(deps, method, result);
  return result;
}
function readAppRef(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record2 = value;
  return ["pid", "bundle_id", "name", "window_id"].some((key) => record2[key] != null)
    ? record2
    : null;
}
function recordBrokerTargetApp(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  recordTargetAppDisplayEvidence(value);
}
function recordBrokerPresentation(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const presentation = value;
  recordBrokerTargetApp(presentation.primary);
  if (!Array.isArray(presentation.items)) return;
  recordAppAssociationItems(
    presentation.items.flatMap((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
      const record2 = item;
      if (
        typeof record2.resultIndex !== "number" ||
        !Number.isInteger(record2.resultIndex) ||
        typeof record2.application !== "object" ||
        record2.application === null ||
        Array.isArray(record2.application)
      ) {
        return [];
      }
      return [
        {
          resultIndex: record2.resultIndex,
          evidence: record2.application,
        },
      ];
    }),
  );
}
function startTargetAppDisplayLookup(deps, appRef2) {
  if (!deps.broker.resolveTargetAppDisplay || !beginTargetAppDisplayLookup(appRef2)) {
    return void 0;
  }
  return deps.broker
    .resolveTargetAppDisplay(appRef2)
    .then(recordBrokerTargetApp)
    .catch(() => {});
}
async function recordBrokerResultTargetApp(deps, method, value) {
  if (method === "application_info") {
    recordBrokerTargetApp(value);
    return;
  }
  if (
    method !== "capture_app" &&
    method !== "open_application" &&
    method !== "activate_application"
  )
    return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return;
  const record2 = value;
  const evidence = record2.app ?? record2.resolved_app_ref ?? value;
  recordBrokerTargetApp(evidence);
  if (method !== "open_application" || !deps.broker.resolveTargetAppDisplay) return;
  const app =
    typeof evidence === "object" && evidence !== null && !Array.isArray(evidence)
      ? evidence
      : void 0;
  if (typeof app?.pid !== "number") return;
  await startTargetAppDisplayLookup(deps, { pid: app.pid });
}
async function callBrokerControl(deps, method, params, opts) {
  if (opts.kind !== "action") {
    throw new Error("broker control calls must use action delivery semantics");
  }
  return deps.broker.call(method, params, opts);
}
var globalActionTail = Promise.resolve();
var globalQueuedActionCount = 0;
var globalLongInputHoldActive = false;
var ControlStopped = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ControlStopped";
  }
};
export {
  BrokerClient,
  CUA_APP_ASSOCIATIONS_MAX_ICON_BYTES,
  CUA_APP_ASSOCIATIONS_MAX_ITEMS,
  CUA_APP_ASSOCIATIONS_MAX_ITEM_ICON_BYTES,
  CUA_APP_ASSOCIATIONS_MAX_META_BYTES,
  CUA_APP_ASSOCIATIONS_META_KEY,
  ControlStopped,
  DEFAULT_BACKOFF_BASE,
  DEFAULT_BACKOFF_CAP,
  MARKER_KEYS,
  MARKER_KIND,
  MARKER_SCHEMA,
  MAX_MARKER_BYTES,
  PermissionBrokerClient,
  PermissionBrokerRefreshGate,
  ZCODE_CUA_BROKER_REFRESH_MARKER_ENV_KEY,
  attachAppAssociationsMeta,
  beginTargetAppDisplayLookup,
  brokerUnavailableFromTransport,
  callBroker,
  callBrokerControl,
  callWithWarmupRetry,
  computeAbsoluteDeadline,
  cuaAppAssociationsSchema,
  cuaApplicationIconSchema,
  cuaApplicationPresentationSchema,
  currentPipToolRequestContext,
  defaultSleep,
  deriveApplicationKey,
  displayLookupKey,
  expandVarsAndUser,
  fitItemsToBudgets,
  globalActionTail,
  globalLongInputHoldActive,
  globalQueuedActionCount,
  hasDuplicateKeys,
  invalidResponseError,
  invocationStorage,
  isAbsolutePath,
  isWindowsAbsolutePath,
  markerUnavailable,
  normalizePath,
  normalizePid,
  normalizeRefreshMarkerPath,
  normalizedText,
  normalizedWindowsPath,
  parseMarker,
  parsePipToolRequestContext,
  presentationFromEvidence,
  readAppAssociations,
  readAppRef,
  readBounded,
  readPermissionRefreshMarker,
  readPermissionRefreshMarkerWin32,
  recordAppAssociationItems,
  recordBrokerPresentation,
  recordBrokerResultTargetApp,
  recordBrokerTargetApp,
  recordTargetAppDisplayEvidence,
  resolvePositiveFloat,
  resolveWarmupConfig,
  runWithPipToolRequestContext,
  runWithTargetAppDisplayContext,
  sameKeySet,
  startTargetAppDisplayLookup,
  storage,
  validPngData,
  validateMarkerStat,
  validateParentStat,
  wrapPeerCheckError,
  wrapTransportError,
};
