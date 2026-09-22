declare const __ZCODE_ENV__: string | undefined;
import { randomUUID, timingSafeEqual } from "node:crypto";
import { constants, Http2ServerRequest } from "node:http2";
import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  JSONRPCMessageSchema,
  isInitializeRequest,
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/sdk/types.js";
import { BrokerClient, callBroker } from "./client.js";
import {
  AccessibilitySession,
  InputHoldRegistry,
  KillSwitch,
  cancelHeldKeys,
  cleanupStdioSession,
  globalPointerHoldGuard,
  releaseHeldPointer,
  toolAnnotationsFor,
} from "./session.js";
import {
  TOOL_DEF_BY_NAME,
  TOOL_NAMES,
  TOOL_REGISTRY_MAP,
  withKillSwitchPreflight,
} from "./tools.js";
function registerAllTools(server, deps) {
  const registered = [];
  for (const name of TOOL_NAMES) {
    const meta3 = TOOL_REGISTRY_MAP.get(name);
    if (meta3 === void 0) {
      throw new Error(
        `registerAllTools: "${name}" is in TOOL_NAMES but missing from TOOL_REGISTRY (manifest drift)`,
      );
    }
    const annotations = toolAnnotationsFor(name);
    const def = TOOL_DEF_BY_NAME.get(name);
    if (def === void 0) {
      throw new Error(
        `registerAllTools: no ToolDef for "${name}" \u2014 every TOOL_NAMES entry needs a handler in observation/pointer/keyboard-runtime`,
      );
    }
    server.registerTool(
      name,
      {
        title: (def as any).title,
        description: (def as any).description,
        inputSchema: (def as any).inputSchema,
        annotations,
      },
      withKillSwitchPreflight(name, (def as any).buildHandler(deps), deps),
    );
    registered.push(name);
  }
  return registered;
}
var SERVER_NAME = "zcode-cua";
var SERVER_VERSION = (() => {
  if ("0.5.14".trim().length > 0) {
    return "0.5.14";
  }
  try {
    const require2 = createRequire(import.meta.url);
    return require2("../../package.json").version;
  } catch (e) {
    console.warn(
      `[Computer Use] Could not read version from package.json (${e instanceof Error ? e.message : e}); falling back to "0.0.0-unknown".`,
    );
    return "0.0.0-unknown";
  }
})();
var RejectUnexpandedEnvPlaceholderError = class extends Error {
  code = "reject_unexpanded_env_placeholder";
  constructor(message) {
    super(message);
    this.name = "RejectUnexpandedEnvPlaceholderError";
  }
};
function assertNoUnexpandedPlaceholder(path) {
  if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(path)) {
    throw new RejectUnexpandedEnvPlaceholderError(
      `broker socket path "${path}" contains an unexpanded $VAR placeholder`,
    );
  }
}
function buildServer(opts) {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  const socket = opts.brokerSocketPath?.trim();
  const token = opts.brokerToken?.trim();
  if (!socket || !token) {
    return { server, registeredTools: [] };
  }
  assertNoUnexpandedPlaceholder(socket);
  const broker = new BrokerClient({
    socketPath: socket,
    token,
    refreshMarkerPath: opts.refreshMarkerPath,
  });
  const sessionKey = opts.sessionKey ?? randomUUID();
  const deps = {
    broker,
    session: opts.session ?? new AccessibilitySession(),
    sessionKey,
    killSwitch: opts.killSwitch ?? new KillSwitch(),
    inputState: { leftMouseDown: false },
    pointerHoldGuard: globalPointerHoldGuard,
    inputHolds: new InputHoldRegistry(sessionKey),
    requestLifecycle: opts.requestLifecycle,
  };
  const registeredTools = registerAllTools(server, deps);
  return { server, registeredTools, deps };
}
var ReadBuffer = class {
  append(chunk) {
    (this as any)._buffer = (this as any)._buffer
      ? Buffer.concat([(this as any)._buffer, chunk])
      : chunk;
  }
  readMessage() {
    if (!(this as any)._buffer) {
      return null;
    }
    const index = (this as any)._buffer.indexOf("\n");
    if (index === -1) {
      return null;
    }
    const line = (this as any)._buffer.toString("utf8", 0, index).replace(/\r$/, "");
    (this as any)._buffer = (this as any)._buffer.subarray(index + 1);
    return deserializeMessage(line);
  }
  clear() {
    (this as any)._buffer = void 0;
  }
};
function deserializeMessage(line) {
  return JSONRPCMessageSchema.parse(JSON.parse(line));
}
function serializeMessage(message) {
  return JSON.stringify(message) + "\n";
}
var StdioServerTransport = class {
  _ondata: any;
  _onerror: any;
  _readBuffer: any;
  _started: any;
  _stdin: any;
  _stdout: any;
  onerror: any;
  onclose: any;

  constructor(_stdin = process.stdin, _stdout = process.stdout) {
    (this as any)._stdin = _stdin;
    (this as any)._stdout = _stdout;
    (this as any)._readBuffer = new ReadBuffer();
    this._started = false;
    this._ondata = (chunk) => {
      this._readBuffer.append(chunk);
      this.processReadBuffer();
    };
    this._onerror = (error51) => {
      this.onerror?.(error51);
    };
  }
  /**
   * Starts listening for messages on stdin.
   */
  async start() {
    if (this._started) {
      throw new Error(
        "StdioServerTransport already started! If using Server class, note that connect() calls start() automatically.",
      );
    }
    (this as any)._started = true;
    this._stdin.on("data", this._ondata);
    this._stdin.on("error", this._onerror);
  }
  processReadBuffer() {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) {
          break;
        }
        (this as any).onmessage?.(message);
      } catch (error51) {
        this.onerror?.(error51);
      }
    }
  }
  async close() {
    this._stdin.off("data", this._ondata);
    this._stdin.off("error", this._onerror);
    const remainingDataListeners = this._stdin.listenerCount("data");
    if (remainingDataListeners === 0) {
      this._stdin.pause();
    }
    this._readBuffer.clear();
    this.onclose?.();
  }
  send(message) {
    return new Promise<void>((resolve22) => {
      const json2 = serializeMessage(message);
      if (this._stdout.write(json2)) {
        resolve22();
      } else {
        this._stdout.once("drain", resolve22);
      }
    });
  }
};
function createStdioTransport(beforeClose, stdin?, stdout?) {
  const transport = new StdioServerTransport(stdin, stdout);
  const input = stdin ?? process.stdin;
  let closing = false;
  const closeOnEnd = () => {
    if (closing) return;
    closing = true;
    void (beforeClose?.() ?? Promise.resolve())
      .catch((error51) => {
        transport.onerror?.(error51 instanceof Error ? error51 : new Error(String(error51)));
      })
      .finally(() => transport.close());
  };
  input.once("end", closeOnEnd);
  transport.onclose = () => {
    input.off("end", closeOnEnd);
  };
  return transport;
}
async function resetPipDismissedForNewSession(deps) {
  if (!deps?.broker) return;
  try {
    await callBroker(deps, "pip_clear_dismissed", {}, { kind: "read", timeoutMs: 2e3 });
  } catch {}
}
function hostHeaderValidation(allowedHostnames, _options?) {
  return (req, res, next) => {
    const hostHeader = req.headers.host;
    if (!hostHeader) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32e3,
          message: "Missing Host header",
        },
        id: null,
      });
      return;
    }
    let hostname3;
    try {
      hostname3 = new URL(`http://${hostHeader}`).hostname;
    } catch {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32e3,
          message: `Invalid Host header: ${hostHeader}`,
        },
        id: null,
      });
      return;
    }
    if (!allowedHostnames.includes(hostname3)) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: {
          code: -32e3,
          message: `Invalid Host: ${hostname3}`,
        },
        id: null,
      });
      return;
    }
    next();
  };
}
function localhostHostValidation() {
  return hostHeaderValidation(["localhost", "127.0.0.1", "[::1]"]);
}
function createMcpExpressApp(options: any = {}) {
  const { host = "127.0.0.1", allowedHosts } = options;
  const app = express();
  app.use(express.json());
  if (allowedHosts) {
    app.use(hostHeaderValidation(allowedHosts));
  } else {
    const localhostHosts = ["127.0.0.1", "localhost", "::1"];
    if (localhostHosts.includes(host)) {
      app.use(localhostHostValidation());
    } else if (host === "0.0.0.0" || host === "::") {
      console.warn(
        `Warning: Server is binding to ${host} without DNS rebinding protection. Consider using the allowedHosts option to restrict allowed hosts, or use authentication to protect your server.`,
      );
    }
  }
  return app;
}
var RequestError = class extends Error {
  constructor(message, options?) {
    super(message, options);
    this.name = "RequestError";
  }
};
var toRequestError = (e) => {
  if (e instanceof RequestError) {
    return e;
  }
  return new RequestError(e.message, { cause: e });
};
var GlobalRequest = global.Request;
var Request = class extends GlobalRequest {
  constructor(input, options) {
    if (typeof input === "object" && getRequestCache in input) {
      input = input[getRequestCache]();
    }
    if (typeof options?.body?.getReader !== "undefined") {
      options.duplex ??= "half";
    }
    super(input, options);
  }
};
var newHeadersFromIncoming = (incoming) => {
  const headerRecord = [];
  const rawHeaders = incoming.rawHeaders;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const { [i]: key, [i + 1]: value } = rawHeaders;
    if (key.charCodeAt(0) !== 58) {
      headerRecord.push([key, value]);
    }
  }
  return new Headers(headerRecord);
};
var wrapBodyStream = Symbol("wrapBodyStream");
var newRequestFromIncoming = (method, url2, headers, incoming, abortController) => {
  const init = {
    method,
    headers,
    signal: abortController.signal,
  };
  if (method === "TRACE") {
    init.method = "GET";
    const req = new Request(url2, init);
    Object.defineProperty(req, "method", {
      get() {
        return "TRACE";
      },
    });
    return req;
  }
  if (!(method === "GET" || method === "HEAD")) {
    if ("rawBody" in incoming && incoming.rawBody instanceof Buffer) {
      (init as any).body = new ReadableStream({
        start(controller) {
          controller.enqueue(incoming.rawBody);
          controller.close();
        },
      });
    } else if (incoming[wrapBodyStream]) {
      let reader;
      (init as any).body = new ReadableStream({
        async pull(controller) {
          try {
            reader ||= Readable.toWeb(incoming).getReader();
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
            } else {
              controller.enqueue(value);
            }
          } catch (error51) {
            controller.error(error51);
          }
        },
      });
    } else {
      (init as any).body = Readable.toWeb(incoming);
    }
  }
  return new Request(url2, init);
};
var getRequestCache = Symbol("getRequestCache");
var requestCache = Symbol("requestCache");
var incomingKey = Symbol("incomingKey");
var urlKey = Symbol("urlKey");
var headersKey = Symbol("headersKey");
var abortControllerKey = Symbol("abortControllerKey");
var getAbortController = Symbol("getAbortController");
var requestPrototype = {
  get method() {
    return this[incomingKey].method || "GET";
  },
  get url() {
    return this[urlKey];
  },
  get headers() {
    return (this[headersKey] ||= newHeadersFromIncoming(this[incomingKey]));
  },
  [getAbortController]() {
    this[getRequestCache]();
    return this[abortControllerKey];
  },
  [getRequestCache]() {
    this[abortControllerKey] ||= new AbortController();
    return (this[requestCache] ||= newRequestFromIncoming(
      this.method,
      this[urlKey],
      this.headers,
      this[incomingKey],
      this[abortControllerKey],
    ));
  },
};
[
  "body",
  "bodyUsed",
  "cache",
  "credentials",
  "destination",
  "integrity",
  "mode",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "keepalive",
].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    get() {
      return this[getRequestCache]()[k];
    },
  });
});
["arrayBuffer", "blob", "clone", "formData", "json", "text"].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    value: function () {
      return this[getRequestCache]()[k]();
    },
  });
});
Object.defineProperty(requestPrototype, Symbol.for("nodejs.util.inspect.custom"), {
  value: function (depth, options, inspectFn) {
    const props = {
      method: this.method,
      url: this.url,
      headers: this.headers,
      nativeRequest: this[requestCache],
    };
    return `Request (lightweight) ${inspectFn(props, { ...options, depth: depth == null ? null : depth - 1 })}`;
  },
});
Object.setPrototypeOf(requestPrototype, Request.prototype);
var newRequest = (incoming, defaultHostname) => {
  const req = Object.create(requestPrototype);
  req[incomingKey] = incoming;
  const incomingUrl = incoming.url || "";
  if (
    incomingUrl[0] !== "/" && // short-circuit for performance. most requests are relative URL.
    (incomingUrl.startsWith("http://") || incomingUrl.startsWith("https://"))
  ) {
    if (incoming instanceof Http2ServerRequest) {
      throw new RequestError("Absolute URL for :path is not allowed in HTTP/2");
    }
    try {
      const url22 = new URL(incomingUrl);
      req[urlKey] = url22.href;
    } catch (e) {
      throw new RequestError("Invalid absolute URL", { cause: e });
    }
    return req;
  }
  const host =
    (incoming instanceof Http2ServerRequest ? incoming.authority : incoming.headers.host) ||
    defaultHostname;
  if (!host) {
    throw new RequestError("Missing host header");
  }
  let scheme;
  if (incoming instanceof Http2ServerRequest) {
    scheme = incoming.scheme;
    if (!(scheme === "http" || scheme === "https")) {
      throw new RequestError("Unsupported scheme");
    }
  } else {
    scheme = incoming.socket && incoming.socket.encrypted ? "https" : "http";
  }
  const url2 = new URL(`${scheme}://${host}${incomingUrl}`);
  if (url2.hostname.length !== host.length && url2.hostname !== host.replace(/:\d+$/, "")) {
    throw new RequestError("Invalid host header");
  }
  req[urlKey] = url2.href;
  return req;
};
var responseCache = Symbol("responseCache");
var getResponseCache = Symbol("getResponseCache");
var cacheKey = Symbol("cache");
var GlobalResponse = global.Response;
var Response2 = class _Response {
  #body;
  #init;
  [getResponseCache]() {
    delete (this as any)[cacheKey];
    return ((this as any)[responseCache] ||= new GlobalResponse(this.#body, this.#init));
  }
  constructor(body, init) {
    let headers;
    this.#body = body;
    if (init instanceof _Response) {
      const cachedGlobalResponse = init[responseCache];
      if (cachedGlobalResponse) {
        this.#init = cachedGlobalResponse;
        this[getResponseCache]();
        return;
      } else {
        this.#init = init.#init;
        headers = new Headers(init.#init.headers);
      }
    } else {
      this.#init = init;
    }
    if (
      typeof body === "string" ||
      typeof body?.getReader !== "undefined" ||
      body instanceof Blob ||
      body instanceof Uint8Array
    ) {
      (this as any)[cacheKey] = [init?.status || 200, body, headers || init?.headers];
    }
  }
  get headers() {
    const cache = (this as any)[cacheKey];
    if (cache) {
      if (!(cache[2] instanceof Headers)) {
        cache[2] = new Headers(cache[2] || { "content-type": "text/plain; charset=UTF-8" });
      }
      return cache[2];
    }
    return this[getResponseCache]().headers;
  }
  get status() {
    return (this as any)[cacheKey]?.[0] ?? this[getResponseCache]().status;
  }
  get ok() {
    const status = this.status;
    return status >= 200 && status < 300;
  }
};
["body", "bodyUsed", "redirected", "statusText", "trailers", "type", "url"].forEach((k) => {
  Object.defineProperty(Response2.prototype, k, {
    get() {
      return this[getResponseCache]()[k];
    },
  });
});
["arrayBuffer", "blob", "clone", "formData", "json", "text"].forEach((k) => {
  Object.defineProperty(Response2.prototype, k, {
    value: function () {
      return this[getResponseCache]()[k]();
    },
  });
});
Object.defineProperty(Response2.prototype, Symbol.for("nodejs.util.inspect.custom"), {
  value: function (depth, options, inspectFn) {
    const props = {
      status: this.status,
      headers: this.headers,
      ok: this.ok,
      nativeResponse: (this as any)[responseCache],
    };
    return `Response (lightweight) ${inspectFn(props, { ...options, depth: depth == null ? null : depth - 1 })}`;
  },
});
Object.setPrototypeOf(Response2, GlobalResponse);
Object.setPrototypeOf(Response2.prototype, GlobalResponse.prototype);
async function readWithoutBlocking(readPromise) {
  return Promise.race([readPromise, Promise.resolve().then(() => Promise.resolve(void 0))]);
}
function writeFromReadableStreamDefaultReader(reader, writable, currentReadPromise?) {
  const cancel = (error51) => {
    reader.cancel(error51).catch(() => {});
  };
  writable.on("close", cancel);
  writable.on("error", cancel);
  (currentReadPromise ?? reader.read()).then(flow, handleStreamError);
  return reader.closed.finally(() => {
    writable.off("close", cancel);
    writable.off("error", cancel);
  });
  function handleStreamError(error51) {
    if (error51) {
      writable.destroy(error51);
    }
  }
  function onDrain() {
    reader.read().then(flow, handleStreamError);
  }
  function flow({ done, value }) {
    try {
      if (done) {
        writable.end();
      } else if (!writable.write(value)) {
        writable.once("drain", onDrain);
      } else {
        return reader.read().then(flow, handleStreamError);
      }
    } catch (e) {
      handleStreamError(e);
    }
  }
}
function writeFromReadableStream(stream, writable) {
  if (stream.locked) {
    throw new TypeError("ReadableStream is locked.");
  } else if (writable.destroyed) {
    return;
  }
  return writeFromReadableStreamDefaultReader(stream.getReader(), writable);
}
var buildOutgoingHttpHeaders = (headers) => {
  const res = {};
  if (!(headers instanceof Headers)) {
    headers = new Headers(headers ?? void 0);
  }
  const cookies = [];
  for (const [k, v] of headers) {
    if (k === "set-cookie") {
      cookies.push(v);
    } else {
      res[k] = v;
    }
  }
  if (cookies.length > 0) {
    res["set-cookie"] = cookies;
  }
  res["content-type"] ??= "text/plain; charset=UTF-8";
  return res;
};
var X_ALREADY_SENT = "x-hono-already-sent";
if (typeof global.crypto === "undefined") {
  global.crypto = crypto;
}
var outgoingEnded = Symbol("outgoingEnded");
var incomingDraining = Symbol("incomingDraining");
var DRAIN_TIMEOUT_MS = 500;
var MAX_DRAIN_BYTES = 64 * 1024 * 1024;
var drainIncoming = (incoming) => {
  const incomingWithDrainState = incoming;
  if (incoming.destroyed || incomingWithDrainState[incomingDraining]) {
    return;
  }
  incomingWithDrainState[incomingDraining] = true;
  if (incoming instanceof Http2ServerRequest) {
    try {
      incoming.stream?.close?.(constants.NGHTTP2_NO_ERROR);
    } catch {}
    return;
  }
  let bytesRead = 0;
  const cleanup = () => {
    clearTimeout(timer);
    incoming.off("data", onData);
    incoming.off("end", cleanup);
    incoming.off("error", cleanup);
  };
  const forceClose = () => {
    cleanup();
    const socket = incoming.socket;
    if (socket && !socket.destroyed) {
      socket.destroySoon();
    }
  };
  const timer = setTimeout(forceClose, DRAIN_TIMEOUT_MS);
  timer.unref?.();
  const onData = (chunk) => {
    bytesRead += chunk.length;
    if (bytesRead > MAX_DRAIN_BYTES) {
      forceClose();
    }
  };
  incoming.on("data", onData);
  incoming.on("end", cleanup);
  incoming.on("error", cleanup);
  incoming.resume();
};
var handleRequestError = () =>
  new Response(null, {
    status: 400,
  });
var handleFetchError = (e) =>
  new Response(null, {
    status:
      e instanceof Error && (e.name === "TimeoutError" || e.constructor.name === "TimeoutError")
        ? 504
        : 500,
  });
var handleResponseError = (e, outgoing) => {
  const err = e instanceof Error ? e : new Error("unknown error", { cause: e });
  if ((err as any).code === "ERR_STREAM_PREMATURE_CLOSE") {
    console.info("The user aborted a request.");
  } else {
    console.error(e);
    if (!outgoing.headersSent) {
      outgoing.writeHead(500, { "Content-Type": "text/plain" });
    }
    outgoing.end(`Error: ${err.message}`);
    outgoing.destroy(err);
  }
};
var flushHeaders = (outgoing) => {
  if ("flushHeaders" in outgoing && outgoing.writable) {
    outgoing.flushHeaders();
  }
};
var responseViaCache = async (res, outgoing) => {
  let [status, body, header] = res[cacheKey];
  let hasContentLength = false;
  if (!header) {
    header = { "content-type": "text/plain; charset=UTF-8" };
  } else if (header instanceof Headers) {
    hasContentLength = header.has("content-length");
    header = buildOutgoingHttpHeaders(header);
  } else if (Array.isArray(header)) {
    const headerObj = new Headers(header);
    hasContentLength = headerObj.has("content-length");
    header = buildOutgoingHttpHeaders(headerObj);
  } else {
    for (const key in header) {
      if (key.length === 14 && key.toLowerCase() === "content-length") {
        hasContentLength = true;
        break;
      }
    }
  }
  if (!hasContentLength) {
    if (typeof body === "string") {
      header["Content-Length"] = Buffer.byteLength(body);
    } else if (body instanceof Uint8Array) {
      header["Content-Length"] = body.byteLength;
    } else if (body instanceof Blob) {
      header["Content-Length"] = body.size;
    }
  }
  outgoing.writeHead(status, header);
  if (typeof body === "string" || body instanceof Uint8Array) {
    outgoing.end(body);
  } else if (body instanceof Blob) {
    outgoing.end(new Uint8Array(await body.arrayBuffer()));
  } else {
    flushHeaders(outgoing);
    await writeFromReadableStream(body, outgoing)?.catch((e) => handleResponseError(e, outgoing));
  }
  outgoing[outgoingEnded]?.();
};
var isPromise = (res) => typeof res.then === "function";
var responseViaResponseObject = async (res, outgoing, options: any = {}) => {
  if (isPromise(res)) {
    if (options.errorHandler) {
      try {
        res = await res;
      } catch (err) {
        const errRes = await options.errorHandler(err);
        if (!errRes) {
          return;
        }
        res = errRes;
      }
    } else {
      res = await res.catch(handleFetchError);
    }
  }
  if (cacheKey in res) {
    return responseViaCache(res, outgoing);
  }
  const resHeaderRecord = buildOutgoingHttpHeaders(res.headers);
  if (res.body) {
    const reader = res.body.getReader();
    const values = [];
    let done = false;
    let currentReadPromise = void 0;
    if (resHeaderRecord["transfer-encoding"] !== "chunked") {
      let maxReadCount = 2;
      for (let i = 0; i < maxReadCount; i++) {
        currentReadPromise ||= reader.read();
        const chunk = await readWithoutBlocking(currentReadPromise).catch((e) => {
          console.error(e);
          done = true;
        });
        if (!chunk) {
          if (i === 1) {
            await new Promise<void>((resolve22) => setTimeout(resolve22));
            maxReadCount = 3;
            continue;
          }
          break;
        }
        currentReadPromise = void 0;
        if (chunk.value) {
          values.push(chunk.value);
        }
        if (chunk.done) {
          done = true;
          break;
        }
      }
      if (done && !("content-length" in resHeaderRecord)) {
        resHeaderRecord["content-length"] = values.reduce((acc, value) => acc + value.length, 0);
      }
    }
    outgoing.writeHead(res.status, resHeaderRecord);
    values.forEach((value) => {
      outgoing.write(value);
    });
    if (done) {
      outgoing.end();
    } else {
      if (values.length === 0) {
        flushHeaders(outgoing);
      }
      await writeFromReadableStreamDefaultReader(reader, outgoing, currentReadPromise);
    }
  } else if (resHeaderRecord[X_ALREADY_SENT]) {
  } else {
    outgoing.writeHead(res.status, resHeaderRecord);
    outgoing.end();
  }
  outgoing[outgoingEnded]?.();
};
var getRequestListener = (fetchCallback, options: any = {}) => {
  const autoCleanupIncoming = options.autoCleanupIncoming ?? true;
  if (options.overrideGlobalObjects !== false && global.Request !== Request) {
    Object.defineProperty(global, "Request", {
      value: Request,
    });
    Object.defineProperty(global, "Response", {
      value: Response2,
    });
  }
  return async (incoming, outgoing) => {
    let res, req;
    try {
      req = newRequest(incoming, options.hostname);
      let incomingEnded =
        !autoCleanupIncoming || incoming.method === "GET" || incoming.method === "HEAD";
      if (!incomingEnded) {
        incoming[wrapBodyStream] = true;
        incoming.on("end", () => {
          incomingEnded = true;
        });
        if (incoming instanceof Http2ServerRequest) {
          outgoing[outgoingEnded] = () => {
            if (!incomingEnded) {
              setTimeout(() => {
                if (!incomingEnded) {
                  setTimeout(() => {
                    drainIncoming(incoming);
                  });
                }
              });
            }
          };
        }
        outgoing.on("finish", () => {
          if (!incomingEnded) {
            drainIncoming(incoming);
          }
        });
      }
      outgoing.on("close", () => {
        const abortController = req[abortControllerKey];
        if (abortController) {
          if (incoming.errored) {
            req[abortControllerKey].abort(incoming.errored.toString());
          } else if (!outgoing.writableFinished) {
            req[abortControllerKey].abort("Client connection prematurely closed.");
          }
        }
        if (!incomingEnded) {
          setTimeout(() => {
            if (!incomingEnded) {
              setTimeout(() => {
                drainIncoming(incoming);
              });
            }
          });
        }
      });
      res = fetchCallback(req, { incoming, outgoing });
      if (cacheKey in res) {
        return responseViaCache(res, outgoing);
      }
    } catch (e) {
      if (!res) {
        if (options.errorHandler) {
          res = await options.errorHandler(req ? e : toRequestError(e));
          if (!res) {
            return;
          }
        } else if (!req) {
          res = handleRequestError();
        } else {
          res = handleFetchError(e);
        }
      } else {
        return handleResponseError(e, outgoing);
      }
    }
    try {
      return await responseViaResponseObject(res, outgoing, options);
    } catch (e) {
      return handleResponseError(e, outgoing);
    }
  };
};
var WebStandardStreamableHTTPServerTransport = class {
  _allowedHosts: any;
  _allowedOrigins: any;
  _enableDnsRebindingProtection: any;
  _enableJsonResponse: any;
  _eventStore: any;
  _initialized: any;
  _onsessionclosed: any;
  _onsessioninitialized: any;
  _requestResponseMap: any;
  _requestToStreamMapping: any;
  _retryInterval: any;
  _started: any;
  _streamMapping: any;
  onerror: any;
  onmessage: any;
  sessionId: any;
  sessionIdGenerator: any;
  _hasHandledRequest: any;
  _standaloneSseStreamId: any;
  onclose: any;

  constructor(options: any = {}) {
    (this as any)._started = false;
    this._hasHandledRequest = false;
    (this as any)._streamMapping = /* @__PURE__ */ new Map();
    (this as any)._requestToStreamMapping = /* @__PURE__ */ new Map();
    (this as any)._requestResponseMap = /* @__PURE__ */ new Map();
    (this as any)._initialized = false;
    (this as any)._enableJsonResponse = false;
    (this as any)._standaloneSseStreamId = "_GET_stream";
    (this as any).sessionIdGenerator = options.sessionIdGenerator;
    (this as any)._enableJsonResponse = options.enableJsonResponse ?? false;
    (this as any)._eventStore = options.eventStore;
    this._onsessioninitialized = options.onsessioninitialized;
    this._onsessionclosed = options.onsessionclosed;
    this._allowedHosts = options.allowedHosts;
    this._allowedOrigins = options.allowedOrigins;
    this._enableDnsRebindingProtection = options.enableDnsRebindingProtection ?? false;
    this._retryInterval = options.retryInterval;
  }
  /**
   * Starts the transport. This is required by the Transport interface but is a no-op
   * for the Streamable HTTP transport as connections are managed per-request.
   */
  async start() {
    if (this._started) {
      throw new Error("Transport already started");
    }
    this._started = true;
  }
  /**
   * Helper to create a JSON error response
   */
  createJsonErrorResponse(status, code, message, options?: unknown) {
    const error51 = { code, message };
    if ((options as any)?.data !== void 0) {
      (error51 as any).data = (options as any).data;
    }
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: error51,
        id: null,
      }),
      {
        status,
        headers: {
          "Content-Type": "application/json",
          ...(options as any)?.headers,
        },
      },
    );
  }
  /**
   * Validates request headers for DNS rebinding protection.
   * @returns Error response if validation fails, undefined if validation passes.
   */
  validateRequestHeaders(req) {
    if (!this._enableDnsRebindingProtection) {
      return void 0;
    }
    if (this._allowedHosts && this._allowedHosts.length > 0) {
      const hostHeader = req.headers.get("host");
      if (!hostHeader || !this._allowedHosts.includes(hostHeader)) {
        const error51 = `Invalid Host header: ${hostHeader}`;
        this.onerror?.(new Error(error51));
        return this.createJsonErrorResponse(403, -32e3, error51);
      }
    }
    if (this._allowedOrigins && this._allowedOrigins.length > 0) {
      const originHeader = req.headers.get("origin");
      if (originHeader && !this._allowedOrigins.includes(originHeader)) {
        const error51 = `Invalid Origin header: ${originHeader}`;
        this.onerror?.(new Error(error51));
        return this.createJsonErrorResponse(403, -32e3, error51);
      }
    }
    return void 0;
  }
  /**
   * Handles an incoming HTTP request, whether GET, POST, or DELETE
   * Returns a Response object (Web Standard)
   */
  async handleRequest(req, options) {
    if (!this.sessionIdGenerator && this._hasHandledRequest) {
      throw new Error(
        "Stateless transport cannot be reused across requests. Create a new transport per request.",
      );
    }
    this._hasHandledRequest = true;
    const validationError = this.validateRequestHeaders(req);
    if (validationError) {
      return validationError;
    }
    switch (req.method) {
      case "POST":
        return this.handlePostRequest(req, options);
      case "GET":
        return this.handleGetRequest(req);
      case "DELETE":
        return this.handleDeleteRequest(req);
      default:
        return this.handleUnsupportedRequest();
    }
  }
  /**
   * Writes a priming event to establish resumption capability.
   * Only sends if eventStore is configured (opt-in for resumability) and
   * the client's protocol version supports empty SSE data (>= 2025-11-25).
   */
  async writePrimingEvent(controller, encoder, streamId, protocolVersion) {
    if (!this._eventStore) {
      return;
    }
    if (protocolVersion < "2025-11-25") {
      return;
    }
    const primingEventId = await this._eventStore.storeEvent(streamId, {});
    let primingEvent = `id: ${primingEventId}
data: 

`;
    if (this._retryInterval !== void 0) {
      primingEvent = `id: ${primingEventId}
retry: ${this._retryInterval}
data: 

`;
    }
    controller.enqueue(encoder.encode(primingEvent));
  }
  /**
   * Handles GET requests for SSE stream
   */
  async handleGetRequest(req) {
    const acceptHeader = req.headers.get("accept");
    if (!acceptHeader?.includes("text/event-stream")) {
      this.onerror?.(new Error("Not Acceptable: Client must accept text/event-stream"));
      return this.createJsonErrorResponse(
        406,
        -32e3,
        "Not Acceptable: Client must accept text/event-stream",
      );
    }
    const sessionError = this.validateSession(req);
    if (sessionError) {
      return sessionError;
    }
    const protocolError = this.validateProtocolVersion(req);
    if (protocolError) {
      return protocolError;
    }
    if ((this as any)._eventStore) {
      const lastEventId = req.headers.get("last-event-id");
      if (lastEventId) {
        return this.replayEvents(lastEventId);
      }
    }
    if (this._streamMapping.get(this._standaloneSseStreamId) !== void 0) {
      this.onerror?.(new Error("Conflict: Only one SSE stream is allowed per session"));
      return this.createJsonErrorResponse(
        409,
        -32e3,
        "Conflict: Only one SSE stream is allowed per session",
      );
    }
    const encoder = new TextEncoder();
    let streamController;
    const readable = new ReadableStream({
      start: (controller) => {
        streamController = controller;
      },
      cancel: () => {
        this._streamMapping.delete(this._standaloneSseStreamId);
      },
    });
    const headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    };
    if (this.sessionId !== void 0) {
      headers["mcp-session-id"] = this.sessionId;
    }
    this._streamMapping.set(this._standaloneSseStreamId, {
      controller: streamController,
      encoder,
      cleanup: () => {
        this._streamMapping.delete(this._standaloneSseStreamId);
        try {
          streamController.close();
        } catch {}
      },
    });
    return new Response(readable, { headers });
  }
  /**
   * Replays events that would have been sent after the specified event ID
   * Only used when resumability is enabled
   */
  async replayEvents(lastEventId) {
    if (!this._eventStore) {
      this.onerror?.(new Error("Event store not configured"));
      return this.createJsonErrorResponse(400, -32e3, "Event store not configured");
    }
    try {
      let streamId;
      if (this._eventStore.getStreamIdForEventId) {
        streamId = await this._eventStore.getStreamIdForEventId(lastEventId);
        if (!streamId) {
          this.onerror?.(new Error("Invalid event ID format"));
          return this.createJsonErrorResponse(400, -32e3, "Invalid event ID format");
        }
        if (this._streamMapping.get(streamId) !== void 0) {
          this.onerror?.(new Error("Conflict: Stream already has an active connection"));
          return this.createJsonErrorResponse(
            409,
            -32e3,
            "Conflict: Stream already has an active connection",
          );
        }
      }
      const headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      };
      if (this.sessionId !== void 0) {
        headers["mcp-session-id"] = this.sessionId;
      }
      const encoder = new TextEncoder();
      let streamController;
      const readable = new ReadableStream({
        start: (controller) => {
          streamController = controller;
        },
        cancel: () => {},
      });
      const replayedStreamId = await this._eventStore.replayEventsAfter(lastEventId, {
        send: async (eventId, message) => {
          const success2 = this.writeSSEEvent(streamController, encoder, message, eventId);
          if (!success2) {
            this.onerror?.(new Error("Failed replay events"));
            try {
              streamController.close();
            } catch {}
          }
        },
      });
      this._streamMapping.set(replayedStreamId, {
        controller: streamController,
        encoder,
        cleanup: () => {
          this._streamMapping.delete(replayedStreamId);
          try {
            streamController.close();
          } catch {}
        },
      });
      return new Response(readable, { headers });
    } catch (error51) {
      this.onerror?.(error51);
      return this.createJsonErrorResponse(500, -32e3, "Error replaying events");
    }
  }
  /**
   * Writes an event to an SSE stream via controller with proper formatting
   */
  writeSSEEvent(controller, encoder, message, eventId) {
    try {
      let eventData = `event: message
`;
      if (eventId) {
        eventData += `id: ${eventId}
`;
      }
      eventData += `data: ${JSON.stringify(message)}

`;
      controller.enqueue(encoder.encode(eventData));
      return true;
    } catch (error51) {
      this.onerror?.(error51);
      return false;
    }
  }
  /**
   * Handles unsupported requests (PUT, PATCH, etc.)
   */
  handleUnsupportedRequest() {
    this.onerror?.(new Error("Method not allowed."));
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32e3,
          message: "Method not allowed.",
        },
        id: null,
      }),
      {
        status: 405,
        headers: {
          Allow: "GET, POST, DELETE",
          "Content-Type": "application/json",
        },
      },
    );
  }
  /**
   * Handles POST requests containing JSON-RPC messages
   */
  async handlePostRequest(req, options) {
    try {
      const acceptHeader = req.headers.get("accept");
      if (
        !acceptHeader?.includes("application/json") ||
        !acceptHeader.includes("text/event-stream")
      ) {
        this.onerror?.(
          new Error(
            "Not Acceptable: Client must accept both application/json and text/event-stream",
          ),
        );
        return this.createJsonErrorResponse(
          406,
          -32e3,
          "Not Acceptable: Client must accept both application/json and text/event-stream",
        );
      }
      const ct = req.headers.get("content-type");
      if (!ct || !ct.includes("application/json")) {
        this.onerror?.(new Error("Unsupported Media Type: Content-Type must be application/json"));
        return this.createJsonErrorResponse(
          415,
          -32e3,
          "Unsupported Media Type: Content-Type must be application/json",
        );
      }
      const requestInfo = {
        headers: Object.fromEntries(req.headers.entries()),
        url: new URL(req.url),
      };
      let rawMessage;
      if (options?.parsedBody !== void 0) {
        rawMessage = options.parsedBody;
      } else {
        try {
          rawMessage = await req.json();
        } catch {
          this.onerror?.(new Error("Parse error: Invalid JSON"));
          return this.createJsonErrorResponse(400, -32700, "Parse error: Invalid JSON");
        }
      }
      let messages;
      try {
        if (Array.isArray(rawMessage)) {
          messages = rawMessage.map((msg) => JSONRPCMessageSchema.parse(msg));
        } else {
          messages = [JSONRPCMessageSchema.parse(rawMessage)];
        }
      } catch {
        this.onerror?.(new Error("Parse error: Invalid JSON-RPC message"));
        return this.createJsonErrorResponse(400, -32700, "Parse error: Invalid JSON-RPC message");
      }
      const isInitializationRequest = messages.some(isInitializeRequest);
      if (isInitializationRequest) {
        if (this._initialized && this.sessionId !== void 0) {
          this.onerror?.(new Error("Invalid Request: Server already initialized"));
          return this.createJsonErrorResponse(
            400,
            -32600,
            "Invalid Request: Server already initialized",
          );
        }
        if (messages.length > 1) {
          this.onerror?.(new Error("Invalid Request: Only one initialization request is allowed"));
          return this.createJsonErrorResponse(
            400,
            -32600,
            "Invalid Request: Only one initialization request is allowed",
          );
        }
        this.sessionId = this.sessionIdGenerator?.();
        this._initialized = true;
        if (this.sessionId && this._onsessioninitialized) {
          await Promise.resolve(this._onsessioninitialized(this.sessionId));
        }
      }
      if (!isInitializationRequest) {
        const sessionError = this.validateSession(req);
        if (sessionError) {
          return sessionError;
        }
        const protocolError = this.validateProtocolVersion(req);
        if (protocolError) {
          return protocolError;
        }
      }
      const hasRequests = messages.some(isJSONRPCRequest);
      if (!hasRequests) {
        for (const message of messages) {
          this.onmessage?.(message, { authInfo: options?.authInfo, requestInfo });
        }
        return new Response(null, { status: 202 });
      }
      const streamId = crypto.randomUUID();
      const initRequest = messages.find((m) => isInitializeRequest(m));
      const clientProtocolVersion = initRequest
        ? initRequest.params.protocolVersion
        : (req.headers.get("mcp-protocol-version") ?? DEFAULT_NEGOTIATED_PROTOCOL_VERSION);
      if (this._enableJsonResponse) {
        return new Promise<void>((resolve22) => {
          this._streamMapping.set(streamId, {
            resolveJson: resolve22,
            cleanup: () => {
              this._streamMapping.delete(streamId);
            },
          });
          for (const message of messages) {
            if (isJSONRPCRequest(message)) {
              this._requestToStreamMapping.set(message.id, streamId);
            }
          }
          for (const message of messages) {
            this.onmessage?.(message, { authInfo: options?.authInfo, requestInfo });
          }
        });
      }
      const encoder = new TextEncoder();
      let streamController;
      const readable = new ReadableStream({
        start: (controller) => {
          streamController = controller;
        },
        cancel: () => {
          this._streamMapping.delete(streamId);
        },
      });
      const headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      };
      if (this.sessionId !== void 0) {
        headers["mcp-session-id"] = this.sessionId;
      }
      for (const message of messages) {
        if (isJSONRPCRequest(message)) {
          this._streamMapping.set(streamId, {
            controller: streamController,
            encoder,
            cleanup: () => {
              this._streamMapping.delete(streamId);
              try {
                streamController.close();
              } catch {}
            },
          });
          this._requestToStreamMapping.set(message.id, streamId);
        }
      }
      await this.writePrimingEvent(streamController, encoder, streamId, clientProtocolVersion);
      for (const message of messages) {
        let closeSSEStream;
        let closeStandaloneSSEStream;
        if (
          isJSONRPCRequest(message) &&
          this._eventStore &&
          clientProtocolVersion >= "2025-11-25"
        ) {
          closeSSEStream = () => {
            this.closeSSEStream(message.id);
          };
          closeStandaloneSSEStream = () => {
            this.closeStandaloneSSEStream();
          };
        }
        this.onmessage?.(message, {
          authInfo: options?.authInfo,
          requestInfo,
          closeSSEStream,
          closeStandaloneSSEStream,
        });
      }
      return new Response(readable, { status: 200, headers });
    } catch (error51) {
      this.onerror?.(error51);
      return this.createJsonErrorResponse(400, -32700, "Parse error", { data: String(error51) });
    }
  }
  /**
   * Handles DELETE requests to terminate sessions
   */
  async handleDeleteRequest(req) {
    const sessionError = this.validateSession(req);
    if (sessionError) {
      return sessionError;
    }
    const protocolError = this.validateProtocolVersion(req);
    if (protocolError) {
      return protocolError;
    }
    await Promise.resolve(this._onsessionclosed?.(this.sessionId));
    await this.close();
    return new Response(null, { status: 200 });
  }
  /**
   * Validates session ID for non-initialization requests.
   * Returns Response error if invalid, undefined otherwise
   */
  validateSession(req) {
    if (this.sessionIdGenerator === void 0) {
      return void 0;
    }
    if (!this._initialized) {
      this.onerror?.(new Error("Bad Request: Server not initialized"));
      return this.createJsonErrorResponse(400, -32e3, "Bad Request: Server not initialized");
    }
    const sessionId = req.headers.get("mcp-session-id");
    if (!sessionId) {
      this.onerror?.(new Error("Bad Request: Mcp-Session-Id header is required"));
      return this.createJsonErrorResponse(
        400,
        -32e3,
        "Bad Request: Mcp-Session-Id header is required",
      );
    }
    if (sessionId !== this.sessionId) {
      this.onerror?.(new Error("Session not found"));
      return this.createJsonErrorResponse(404, -32001, "Session not found");
    }
    return void 0;
  }
  /**
   * Validates the MCP-Protocol-Version header on incoming requests.
   *
   * For initialization: Version negotiation handles unknown versions gracefully
   * (server responds with its supported version).
   *
   * For subsequent requests with MCP-Protocol-Version header:
   * - Accept if in supported list
   * - 400 if unsupported
   *
   * For HTTP requests without the MCP-Protocol-Version header:
   * - Accept and default to the version negotiated at initialization
   */
  validateProtocolVersion(req) {
    const protocolVersion = req.headers.get("mcp-protocol-version");
    if (protocolVersion !== null && !SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
      this.onerror?.(
        new Error(
          `Bad Request: Unsupported protocol version: ${protocolVersion} (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`,
        ),
      );
      return this.createJsonErrorResponse(
        400,
        -32e3,
        `Bad Request: Unsupported protocol version: ${protocolVersion} (supported versions: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")})`,
      );
    }
    return void 0;
  }
  async close() {
    this._streamMapping.forEach(({ cleanup }) => {
      cleanup();
    });
    this._streamMapping.clear();
    this._requestResponseMap.clear();
    this.onclose?.();
  }
  /**
   * Close an SSE stream for a specific request, triggering client reconnection.
   * Use this to implement polling behavior during long-running operations -
   * client will reconnect after the retry interval specified in the priming event.
   */
  closeSSEStream(requestId) {
    const streamId = this._requestToStreamMapping.get(requestId);
    if (!streamId) return;
    const stream = this._streamMapping.get(streamId);
    if (stream) {
      stream.cleanup();
    }
  }
  /**
   * Close the standalone GET SSE stream, triggering client reconnection.
   * Use this to implement polling behavior for server-initiated notifications.
   */
  closeStandaloneSSEStream() {
    const stream = this._streamMapping.get(this._standaloneSseStreamId);
    if (stream) {
      stream.cleanup();
    }
  }
  async send(message, options) {
    let requestId = options?.relatedRequestId;
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      requestId = message.id;
    }
    if (requestId === void 0) {
      if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
        throw new Error(
          "Cannot send a response on a standalone SSE stream unless resuming a previous client request",
        );
      }
      let eventId;
      if (this._eventStore) {
        eventId = await this._eventStore.storeEvent(this._standaloneSseStreamId, message);
      }
      const standaloneSse = this._streamMapping.get(this._standaloneSseStreamId);
      if (standaloneSse === void 0) {
        return;
      }
      if (standaloneSse.controller && standaloneSse.encoder) {
        this.writeSSEEvent(standaloneSse.controller, standaloneSse.encoder, message, eventId);
      }
      return;
    }
    const streamId = this._requestToStreamMapping.get(requestId);
    if (!streamId) {
      throw new Error(`No connection established for request ID: ${String(requestId)}`);
    }
    const stream = this._streamMapping.get(streamId);
    if (!this._enableJsonResponse && stream?.controller && stream?.encoder) {
      let eventId;
      if (this._eventStore) {
        eventId = await this._eventStore.storeEvent(streamId, message);
      }
      this.writeSSEEvent(stream.controller, stream.encoder, message, eventId);
    }
    if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
      this._requestResponseMap.set(requestId, message);
      const relatedIds = Array.from(this._requestToStreamMapping.entries())
        .filter(([_, sid]) => sid === streamId)
        .map(([id]) => id);
      const allResponsesReady = relatedIds.every((id) => this._requestResponseMap.has(id));
      if (allResponsesReady) {
        if (!stream) {
          throw new Error(`No connection established for request ID: ${String(requestId)}`);
        }
        if (this._enableJsonResponse && stream.resolveJson) {
          const headers = {
            "Content-Type": "application/json",
          };
          if (this.sessionId !== void 0) {
            headers["mcp-session-id"] = this.sessionId;
          }
          const responses = relatedIds.map((id) => this._requestResponseMap.get(id));
          if (responses.length === 1) {
            stream.resolveJson(
              new Response(JSON.stringify(responses[0]), { status: 200, headers }),
            );
          } else {
            stream.resolveJson(new Response(JSON.stringify(responses), { status: 200, headers }));
          }
        } else {
          stream.cleanup();
        }
        for (const id of relatedIds) {
          this._requestResponseMap.delete(id);
          this._requestToStreamMapping.delete(id);
        }
      }
    }
  }
};
var StreamableHTTPServerTransport = class {
  _requestContext: any;
  _requestListener: any;
  _webStandardTransport: any;
  constructor(options: any = {}) {
    this._requestContext = /* @__PURE__ */ new WeakMap();
    this._webStandardTransport = new WebStandardStreamableHTTPServerTransport(options);
    this._requestListener = getRequestListener(
      async (webRequest) => {
        const context = this._requestContext.get(webRequest);
        return this._webStandardTransport.handleRequest(webRequest, {
          authInfo: context?.authInfo,
          parsedBody: context?.parsedBody,
        });
      },
      { overrideGlobalObjects: false },
    );
  }
  /**
   * Gets the session ID for this transport instance.
   */
  get sessionId() {
    return this._webStandardTransport.sessionId;
  }
  /**
   * Sets callback for when the transport is closed.
   */
  set onclose(handler) {
    this._webStandardTransport.onclose = handler;
  }
  get onclose() {
    return this._webStandardTransport.onclose;
  }
  /**
   * Sets callback for transport errors.
   */
  set onerror(handler) {
    this._webStandardTransport.onerror = handler;
  }
  get onerror() {
    return this._webStandardTransport.onerror;
  }
  /**
   * Sets callback for incoming messages.
   */
  set onmessage(handler) {
    this._webStandardTransport.onmessage = handler;
  }
  get onmessage() {
    return this._webStandardTransport.onmessage;
  }
  /**
   * Starts the transport. This is required by the Transport interface but is a no-op
   * for the Streamable HTTP transport as connections are managed per-request.
   */
  async start() {
    return (this as any)._webStandardTransport.start();
  }
  /**
   * Closes the transport and all active connections.
   */
  async close() {
    return (this as any)._webStandardTransport.close();
  }
  /**
   * Sends a JSON-RPC message through the transport.
   */
  async send(message, options) {
    return this._webStandardTransport.send(message, options);
  }
  /**
   * Handles an incoming HTTP request, whether GET or POST.
   *
   * This method converts Node.js HTTP objects to Web Standard Request/Response
   * and delegates to the underlying WebStandardStreamableHTTPServerTransport.
   *
   * @param req - Node.js IncomingMessage, optionally with auth property from middleware
   * @param res - Node.js ServerResponse
   * @param parsedBody - Optional pre-parsed body from body-parser middleware
   */
  async handleRequest(req, res, parsedBody) {
    const authInfo = req.auth;
    const handler = getRequestListener(
      async (webRequest) => {
        return this._webStandardTransport.handleRequest(webRequest, {
          authInfo,
          parsedBody,
        });
      },
      { overrideGlobalObjects: false },
    );
    await handler(req, res);
  }
  /**
   * Close an SSE stream for a specific request, triggering client reconnection.
   * Use this to implement polling behavior during long-running operations -
   * client will reconnect after the retry interval specified in the priming event.
   */
  closeSSEStream(requestId) {
    this._webStandardTransport.closeSSEStream(requestId);
  }
  /**
   * Close the standalone GET SSE stream, triggering client reconnection.
   * Use this to implement polling behavior for server-initiated notifications.
   */
  closeStandaloneSSEStream() {
    this._webStandardTransport.closeStandaloneSSEStream();
  }
};
var LOOPBACK_HOSTS = /* @__PURE__ */ new Set(["127.0.0.1", "localhost", "::1"]);
function createSessionRequestLifecycle() {
  const controller = new AbortController();
  const active = /* @__PURE__ */ new Set();
  return {
    signal: controller.signal,
    track(operation) {
      let settled;
      settled = operation
        .then(
          () => void 0,
          () => void 0,
        )
        .finally(() => active.delete(settled));
      active.add(settled);
      return operation;
    },
    async abortAndDrain() {
      controller.abort("HTTP session closed");
      await Promise.all(active);
    },
  };
}
function errorMessage(error51) {
  return error51 instanceof Error ? error51.message : String(error51);
}
function combinedCleanupError(scope, errors) {
  return new AggregateError(errors, `${scope} failed: ${errors.map(errorMessage).join("; ")}`);
}
function validateOptions(options) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8001;
  const maxSessions = options.maxSessions ?? 64;
  const sessionIdleTimeoutMs = options.sessionIdleTimeoutMs ?? 18e5;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`port must be an integer in 0..65535 (got ${port})`);
  }
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new Error(`maxSessions must be a positive integer (got ${maxSessions})`);
  }
  if (!Number.isFinite(sessionIdleTimeoutMs) || sessionIdleTimeoutMs <= 0) {
    throw new Error(
      `sessionIdleTimeoutMs must be positive and finite (got ${sessionIdleTimeoutMs})`,
    );
  }
  if (!LOOPBACK_HOSTS.has(host) && options.allowUnauthenticatedRemoteHttp !== true) {
    throw new Error(
      `refusing plaintext streamable-http on non-loopback host "${host}": bind to 127.0.0.1/localhost/::1 and use a TLS tunnel or reverse proxy, or explicitly pass --allow-unauthenticated-remote-http only on an isolated test network`,
    );
  }
  return { host, port, maxSessions, sessionIdleTimeoutMs };
}
function jsonError(res, status, message) {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32e3, message },
    id: null,
  });
}
async function startStreamableHttpServer(options) {
  const { host, port, maxSessions, sessionIdleTimeoutMs } = validateOptions(options);
  const httpAuthToken = options.httpAuthToken?.trim();
  if (!LOOPBACK_HOSTS.has(host)) {
    console.error(
      `[Computer Use] DANGER: allowing plaintext streamable-http on ${host}; ${httpAuthToken ? "bearer credentials and control traffic can be intercepted" : "any reachable client can control this machine"}`,
    );
  }
  const app = createMcpExpressApp({ host });
  const sessions = /* @__PURE__ */ new Map();
  let pendingSessions = 0;
  const closeSession = async (sessionId) => {
    const entry = sessions.get(sessionId);
    if (!entry) return;
    if (entry.closing) return entry.closing;
    const cleanup = (async () => {
      clearTimeout(entry.idleTimer);
      const errors = [];
      try {
        await entry.cancelInputHolds();
      } catch (error51) {
        errors.push(error51);
      }
      try {
        await entry.abortRequests();
      } catch (error51) {
        errors.push(error51);
      }
      try {
        await entry.releaseInput();
      } catch (error51) {
        errors.push(error51);
      }
      if (errors.length > 0) {
        throw combinedCleanupError(`HTTP session ${sessionId} cleanup`, errors);
      }
      try {
        await entry.transport.close();
      } catch (error51) {
        errors.push(error51);
      }
      try {
        await entry.server.close();
      } catch (error51) {
        errors.push(error51);
      }
      if (errors.length > 0) {
        throw combinedCleanupError(`HTTP session ${sessionId} cleanup`, errors);
      }
      sessions.delete(sessionId);
    })();
    entry.closing = cleanup;
    try {
      await cleanup;
    } finally {
      if (sessions.get(sessionId) === entry && entry.closing === cleanup) {
        entry.closing = void 0;
      }
    }
  };
  const closeSessionInBackground = (sessionId, trigger) => {
    void closeSession(sessionId).catch((error51) => {
      console.error(`[Computer Use] HTTP ${trigger} cleanup failed: ${errorMessage(error51)}`);
    });
  };
  const armIdleTimer = (sessionId, entry) => {
    clearTimeout(entry.idleTimer);
    if (entry.activeRequests > 0 || entry.closing) return;
    entry.idleTimer = setTimeout(() => {
      closeSessionInBackground(sessionId, "idle-session");
    }, sessionIdleTimeoutMs);
    entry.idleTimer.unref();
  };
  app.all("/mcp", async (req, res) => {
    if (httpAuthToken) {
      const expected = Buffer.from(`Bearer ${httpAuthToken}`, "utf8");
      const received = Buffer.from(req.header("authorization") ?? "", "utf8");
      const authenticated =
        expected.length === received.length && timingSafeEqual(expected, received);
      if (!authenticated) {
        res.setHeader("www-authenticate", 'Bearer realm="zcode-cua"');
        jsonError(res, 401, "Unauthorized: valid bearer token required");
        return;
      }
    }
    const origin = req.header("origin");
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const requestOrigin = new URL(`${req.protocol}://${req.get("host")}`);
        if (originUrl.origin !== requestOrigin.origin) {
          jsonError(res, 403, "Forbidden: Origin does not match the MCP endpoint");
          return;
        }
      } catch {
        jsonError(res, 403, "Forbidden: invalid Origin header");
        return;
      }
    }
    const sessionHeader = req.header("mcp-session-id");
    const sessionId = sessionHeader?.trim();
    let entry = sessionId ? sessions.get(sessionId) : void 0;
    if (!entry && req.method === "POST" && !sessionId && isInitializeRequest(req.body)) {
      if (sessions.size + pendingSessions >= maxSessions) {
        jsonError(res, 503, `MCP session capacity reached (${maxSessions})`);
        return;
      }
      pendingSessions += 1;
      let pending = true;
      const settlePending = () => {
        if (!pending) return;
        pending = false;
        pendingSessions -= 1;
      };
      let initializedId;
      let provisional;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => {
          settlePending();
          initializedId = id;
          if (provisional) {
            sessions.set(id, provisional);
            armIdleTimer(id, provisional);
          }
        },
        // DELETE is an acknowledged request, so its 200 response must mean
        // input cleanup actually completed. The SDK awaits this callback
        // before closing the transport and constructing the response.
        onsessionclosed: async (id) => {
          await closeSession(id);
        },
      });
      const sessionKey = randomUUID();
      const requestLifecycle = createSessionRequestLifecycle();
      const built = buildServer({
        brokerSocketPath: options.brokerSocketPath,
        brokerToken: options.brokerToken,
        refreshMarkerPath: options.refreshMarkerPath,
        session: new AccessibilitySession(),
        sessionKey,
        killSwitch: new KillSwitch(),
        requestLifecycle,
      });
      provisional = {
        transport,
        server: built.server,
        idleTimer: setTimeout(() => void 0, sessionIdleTimeoutMs),
        async cancelInputHolds() {
          await cancelHeldKeys(built.deps);
        },
        abortRequests: () => requestLifecycle.abortAndDrain(),
        async releaseInput() {
          await releaseHeldPointer(built.deps);
        },
        activeRequests: 0,
      };
      provisional.idleTimer.unref();
      transport.onclose = () => {
        if (initializedId) {
          closeSessionInBackground(initializedId, "transport-close");
        }
      };
      try {
        await built.server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        if (!initializedId) {
          settlePending();
          clearTimeout(provisional.idleTimer);
          await transport.close();
          await built.server.close();
        }
      } catch (error51) {
        settlePending();
        clearTimeout(provisional.idleTimer);
        await transport.close().catch(() => void 0);
        await built.server.close().catch(() => void 0);
        if (!res.headersSent) {
          jsonError(res, 500, error51 instanceof Error ? error51.message : "Internal server error");
        }
      }
      return;
    }
    if (!entry) {
      jsonError(res, sessionId ? 404 : 400, "Invalid or missing MCP session ID");
      return;
    }
    if (req.method === "GET") {
      armIdleTimer(sessionId, entry);
    } else {
      clearTimeout(entry.idleTimer);
      entry.activeRequests += 1;
    }
    try {
      await entry.transport.handleRequest(req, res, req.body);
      if (req.method === "DELETE") {
        await closeSession(sessionId);
      }
    } catch (error51) {
      if (!res.headersSent) {
        jsonError(res, 500, error51 instanceof Error ? error51.message : "Internal server error");
      } else {
        console.error(
          `[Computer Use] HTTP request cleanup failed after response: ${errorMessage(error51)}`,
        );
      }
    } finally {
      if (req.method !== "GET") {
        entry.activeRequests = Math.max(0, entry.activeRequests - 1);
        if (req.method !== "DELETE" && sessions.has(sessionId)) {
          armIdleTimer(sessionId, entry);
        }
      }
    }
  });
  const httpServer = await new Promise<void>((resolve22, reject) => {
    const listener = app.listen(port, host, () => resolve22(listener));
    listener.once("error", reject);
  });
  const address = (httpServer as any).address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  const urlHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return {
    host,
    port: boundPort,
    url: `http://${urlHost.includes(":") ? `[${urlHost}]` : urlHost}:${boundPort}/mcp`,
    sessionCount: () => sessions.size,
    async close() {
      const errors = [];
      const sessionResults = await Promise.allSettled([...sessions.keys()].map(closeSession));
      for (const result of sessionResults) {
        if (result.status === "rejected") errors.push(result.reason);
      }
      if (errors.length > 0) {
        throw combinedCleanupError("HTTP server shutdown", errors);
      }
      try {
        await new Promise<void>((resolve22, reject) => {
          (httpServer as any).close((error51: Error | null) =>
            error51 ? reject(error51) : resolve22(),
          );
        });
      } catch (error51) {
        errors.push(error51);
      }
      if (errors.length > 0) {
        throw combinedCleanupError("HTTP server shutdown", errors);
      }
    },
  };
}
var SOCKET_FLAG = "--permission-broker-socket";
var TRANSPORT_FLAG = "--transport";
var HOST_FLAG = "--host";
var PORT_FLAG = "--port";
var MAX_SESSIONS_FLAG = "--max-sessions";
var SESSION_IDLE_TIMEOUT_FLAG = "--session-idle-timeout";
var ALLOW_UNAUTHENTICATED_REMOTE_HTTP_FLAG = "--allow-unauthenticated-remote-http";
var HTTP_AUTH_TOKEN_FLAG = "--http-auth-token";
var ARGUMENT_TERMINATOR = "--";
var UnexpandedEnvPlaceholderError = class extends Error {
  code = "reject_unexpanded_env_placeholder";
  constructor(message) {
    super(message);
    this.name = "UnexpandedEnvPlaceholderError";
  }
};
function rejectUnexpandedPlaceholder(value, flag2) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new UnexpandedEnvPlaceholderError(
      `${flag2} value is empty; refusing to start with an unresolved placeholder`,
    );
  }
  if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(trimmed)) {
    throw new UnexpandedEnvPlaceholderError(
      `${flag2} value "${trimmed}" contains an unexpanded $VAR placeholder`,
    );
  }
}
function singleFlagValue(args, flag2) {
  const values = [];
  const terminatorIndex = args.indexOf(ARGUMENT_TERMINATOR);
  const optionEnd = terminatorIndex === -1 ? args.length : terminatorIndex;
  for (let index = 0; index < optionEnd; index += 1) {
    const arg = args[index];
    if (arg === flag2) {
      const next = args[index + 1];
      values.push(next?.trim() ?? "");
      index += 1;
      continue;
    }
    if (arg?.startsWith(`${flag2}=`)) {
      values.push(arg.slice(flag2.length + 1).trim());
    }
  }
  if (values.length === 0) return void 0;
  if (values.length > 1) {
    throw new Error(`${flag2} must appear at most once (got ${values.length})`);
  }
  return values[0];
}
function terminatorStart(args) {
  return args.indexOf(ARGUMENT_TERMINATOR);
}
function hasBooleanFlag(args, flag2) {
  const optionEnd = terminatorStart(args);
  const search = optionEnd === -1 ? args : args.slice(0, optionEnd);
  const count = search.filter((arg) => arg === flag2).length;
  if (count > 1) throw new Error(`${flag2} must appear at most once (got ${count})`);
  return count === 1;
}
function parseIntegerFlag(raw, flag2, min, max) {
  if (raw === void 0) return void 0;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${flag2} must be an integer in ${min}..${max} (got "${raw}")`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${flag2} must be an integer in ${min}..${max} (got "${raw}")`);
  }
  return value;
}
function parsePositiveSeconds(raw) {
  if (raw === void 0) return void 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${SESSION_IDLE_TIMEOUT_FLAG} must be positive and finite (got "${raw}")`);
  }
  return value * 1e3;
}
function parseServerArgs(argv) {
  const socketRaw = singleFlagValue(argv, SOCKET_FLAG);
  const transportRaw = singleFlagValue(argv, TRANSPORT_FLAG);
  const hostRaw = singleFlagValue(argv, HOST_FLAG);
  const portRaw = singleFlagValue(argv, PORT_FLAG);
  const maxSessionsRaw = singleFlagValue(argv, MAX_SESSIONS_FLAG);
  const idleTimeoutRaw = singleFlagValue(argv, SESSION_IDLE_TIMEOUT_FLAG);
  const httpAuthTokenRaw = singleFlagValue(argv, HTTP_AUTH_TOKEN_FLAG);
  if (transportRaw !== void 0 && transportRaw !== "stdio" && transportRaw !== "streamable-http") {
    throw new Error(
      `${TRANSPORT_FLAG} must be "stdio" or "streamable-http" (got "${transportRaw}")`,
    );
  }
  if (hostRaw !== void 0 && hostRaw.length === 0) {
    throw new Error(`${HOST_FLAG} must not be empty`);
  }
  let brokerSocketPath;
  if (socketRaw !== void 0) {
    rejectUnexpandedPlaceholder(socketRaw, SOCKET_FLAG);
    brokerSocketPath = socketRaw;
  }
  const trailingIndex = terminatorStart(argv);
  const trailing = trailingIndex === -1 ? [] : argv.slice(trailingIndex + 1);
  return {
    brokerSocketPath,
    transport: transportRaw,
    host: hostRaw,
    port: parseIntegerFlag(portRaw, PORT_FLAG, 1, 65535),
    maxSessions: parseIntegerFlag(maxSessionsRaw, MAX_SESSIONS_FLAG, 1, 1e4),
    sessionIdleTimeoutMs: parsePositiveSeconds(idleTimeoutRaw),
    allowUnauthenticatedRemoteHttp: hasBooleanFlag(argv, ALLOW_UNAUTHENTICATED_REMOTE_HTTP_FLAG),
    httpAuthToken: httpAuthTokenRaw || void 0,
    trailing,
  };
}
function parsedArgsToOptions(parsed) {
  const opts: any = {};
  if (parsed.brokerSocketPath !== void 0) opts.brokerSocketPath = parsed.brokerSocketPath;
  if (parsed.transport !== void 0) opts.transport = parsed.transport;
  if (parsed.host !== void 0) opts.host = parsed.host;
  if (parsed.port !== void 0) opts.port = parsed.port;
  if (parsed.maxSessions !== void 0) opts.maxSessions = parsed.maxSessions;
  if (parsed.sessionIdleTimeoutMs !== void 0) {
    opts.sessionIdleTimeoutMs = parsed.sessionIdleTimeoutMs;
  }
  if (parsed.allowUnauthenticatedRemoteHttp === true) {
    opts.allowUnauthenticatedRemoteHttp = true;
  }
  if (parsed.httpAuthToken !== void 0) opts.httpAuthToken = parsed.httpAuthToken;
  return opts;
}
var BROKER_METHODS = [
  // 诊断
  "broker_info",
  "controller_status",
  "controller_takeover",
  "controller_stop",
  "request_access",
  "permission_status",
  "input_permission_status",
  "screen_capture_status",
  "screen_capture_probe",
  "supports_accessibility",
  // 观测
  "screen_size",
  "cursor_position",
  "screenshot",
  "list_displays",
  "list_applications",
  "application_info",
  "list_windows",
  "capture_app",
  "get_skyshot",
  "element_at_point",
  "read_element",
  // 动作
  "set_display",
  "move_to",
  "click",
  "scroll",
  "drag",
  "mouse_down",
  "mouse_up",
  "type_text",
  "type_text_into_current_focus",
  "type_text_to_app",
  "press_key",
  "press_key_to_app",
  "hold_key",
  "hold_key_to_app",
  "cancel_input_holds",
  "key_down",
  "key_up",
  "read_clipboard",
  "write_clipboard",
  "open_application",
  "element_press",
  "element_show_menu",
  "element_focus",
  "element_set_value",
  "element_perform_action",
  "element_select_text",
  // Phase 0 不抢焦点:AX hit-test 坐标点击 + preventActivation 门。
  "click_element_at_point",
  "prevent_activation",
  "reenable_activation",
  "is_focus_steal_prevented",
  // Phase 2 实时画中画（policy-on：exact SCWindow + SCScreenshotManager → NSImageView）。
  "pip_start",
  "pip_stop",
  "pip_is_running",
  "pip_clear_dismissed",
  // Producer-owned PiP presentation channel. The broker server applies a
  // dedicated presentation-token gate before dispatching either method.
  "pip_session_handshake",
  "pip_session_event",
  "pip_live_probe_start_test_panel",
  "pip_live_probe_window_bounds",
  "pip_live_probe_drag_panel",
  "pip_live_probe_move_test_panel",
  "pip_live_probe_sample_ownership",
  "pip_live_probe_initial_hit_surface",
];
var BROKER_METHOD_SET = new Set(BROKER_METHODS);
var BROKER_PRESENTED_RESULT = Symbol("zcode.cua.broker-presented-result");
var BROKER_TOKEN_ENV = "ZCODE_CUA_PERMISSION_BROKER_TOKEN";
var BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
function isWindowsNamedPipePath(path) {
  return path.startsWith("\\\\.\\pipe\\");
}
var DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;
var CUA_PERMISSION_BROKER_GRACEFUL_STOP_TIMEOUT_MS = 8e3;
var COMPILED_LOCAL_DEVELOPMENT_RUNTIME =
  typeof __ZCODE_LOCAL_DEVELOPMENT_RUNTIME__ !== "undefined"
    ? __ZCODE_LOCAL_DEVELOPMENT_RUNTIME__
    : true;
var DEFAULT_CUA_LAUNCHER_BUNDLE_ID = "dev.zcode.app";
var PREVIEW_CUA_LAUNCHER_BUNDLE_ID = "dev.zcode.app.preview";
var DEFAULT_CUA_LAUNCHER_BUNDLE_IDS = Object.freeze([
  DEFAULT_CUA_LAUNCHER_BUNDLE_ID,
  PREVIEW_CUA_LAUNCHER_BUNDLE_ID,
]);
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
    const prevBySig = new Map(prevLines.map((l) => [l.sig, l]));
    let nextIndex = (this.prevMaxIndex.get(appKey) ?? 0) + 1;
    const out = [];
    if (header) out.push(header);
    out.push("The following is a diff from the previous accessibility tree (~ changed, + added).");
    const currSigs = /* @__PURE__ */ new Set();
    for (const l of lines) {
      currSigs.add(l.sig);
      const p = prevBySig.get(l.sig);
      if (p) {
        if ((p as any).text !== l.text) out.push(`~ ${l.depth}	${(p as any).index} ${l.text}`);
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
var TEXT_ENTRY_KINDS = /* @__PURE__ */ new Set([
  "textfield",
  "textarea",
  "searchfield",
  "securefield",
  "combobox",
]);
var VALUE_SET_KINDS = /* @__PURE__ */ new Set([...TEXT_ENTRY_KINDS, "slider", "stepper"]);
var KEY_CHORD_KEYS = /* @__PURE__ */ new Set([
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
  "tab",
  "space",
  "backspace",
  "delete",
  "esc",
  "command",
  "meta",
  "super",
  "win",
  "shift",
  "capslock",
  "alt",
  "ctrl",
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
  ...Array.from({ length: 16 }, (_, index) => `f${index + 1}`),
]);
var MAX_SAMPLE_DIMENSION = 64;
var MAX_SAMPLED_PIXELS = MAX_SAMPLE_DIMENSION * MAX_SAMPLE_DIMENSION;
var MAX_BLANK_SAMPLE_DIMENSION = 64;
var MAX_BLANK_SAMPLED_PIXELS = MAX_BLANK_SAMPLE_DIMENSION * MAX_BLANK_SAMPLE_DIMENSION;
var APPLICATION_SEARCH_MAX_BYTES = 1024 * 1024;
var CLIPBOARD_MAX_BUFFER = 16 * 1024 * 1024;
var MAX_PNG_BYTES = 128 * 1024 * 1024;
var CONTROL_TYPE_TO_KIND = Object.freeze({
  // Buttons (all collapse to button — parity with macOS AXButton/AXMenuButton).
  Button: "button",
  SplitButton: "button",
  // Menus (all collapse to menuitem — parity with macOS AXMenuItem/AXMenuBarItem).
  MenuItem: "menuitem",
  Menu: "menuitem",
  MenuBar: "menuitem",
  // Text entry.
  Edit: "textfield",
  Document: "textarea",
  Password: "securefield",
  // Selection / dropdowns.
  ComboBox: "combobox",
  CheckBox: "checkbox",
  RadioButton: "radio",
  // Navigation.
  Hyperlink: "link",
  // Range / progress.
  Slider: "slider",
  ProgressBar: "slider",
  // Static content.
  Text: "text",
  StatusBar: "text",
  Image: "image",
  // Rows (selectable items in List/Tree/DataGrid). The Python parity reference
  // treats ListItem/DataItem/TreeItem as the semantic "row" for click-target
  // purposes (zcode_cua/accessibility/filtering.py).
  ListItem: "row",
  DataItem: "row",
  TreeItem: "row",
  // Tabs.
  TabItem: "tab",
  // Unknown — excluded from re-resolution (broker treats kind:"" specially).
  Custom: "",
  // Containers — not actionable themselves; their children are.
  Pane: "",
  Window: "",
  Group: "",
});
var TEXT_ENTRY_KINDS2 = /* @__PURE__ */ new Set([
  "textfield",
  "textarea",
  "securefield",
  "combobox",
]);
var VALUE_SET_KINDS2 = /* @__PURE__ */ new Set([...TEXT_ENTRY_KINDS2, "slider", "stepper"]);
var IN_TREE_ADDON_REL = join("build", "Release", "ax_native.node");
var PIP_SESSION_HIDDEN_GROUP_ID = "__zcode_pip_no_active_session_v2__";
var identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.includes("\0"), "identifier cannot contain NUL")
  .refine(
    (value) => value !== PIP_SESSION_HIDDEN_GROUP_ID,
    "identifier is reserved by the PiP session runtime",
  );
var sequenceSchema = z.number().int().nonnegative().safe();
var pipSessionEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("focus-changed"),
      revision: sequenceSchema,
      sourceWindowId: identifierSchema,
      sessionId: identifierSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("turn-started"),
      sessionId: identifierSchema,
      turnId: identifierSchema,
      sequenceNumber: sequenceSchema,
      eventId: identifierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("turn-ended"),
      sessionId: identifierSchema,
      turnId: identifierSchema,
      sequenceNumber: sequenceSchema,
      eventId: identifierSchema,
      outcome: z.enum(["completed", "failed"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("session-closed"),
      sessionId: identifierSchema,
      sequenceNumber: sequenceSchema,
      eventId: identifierSchema,
    })
    .strict(),
]);
var pipCaptureTargetSchema = z
  .object({
    windowId: z.number().int().positive().safe(),
    presentationWindowId: z.number().int().positive().safe().optional(),
    pid: z.number().int().positive().safe(),
    bundleId: z.string().trim().min(1).max(255),
  })
  .strict();
var handshakeSchema = z
  .object({
    protocolVersion: z.number().int(),
    runtimeId: z.string(),
  })
  .strict();
var eventRequestSchema = z.object({ event: pipSessionEventSchema }).strict();
(() => {
  const idx = process.argv.indexOf("--exit-log");
  const logPath = idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
  if (!logPath) return;
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    try {
      appendFileSync(logPath, typeof chunk === "string" ? chunk : String(chunk));
    } catch {}
    return originalWrite(chunk, ...rest);
  };
})();
var configSchema = z.object({
  platform: z.literal("win32"),
  socketPath: z
    .string()
    .refine((path) => isWindowsNamedPipePath(path) && path.length > "\\\\.\\pipe\\".length),
  parentPid: z.coerce.number().int().positive(),
  token: z.string().trim().min(1),
});
function normalizeZCodeEnv(value) {
  return value?.trim().toLowerCase() === "production" ? "production" : "test";
}
var ZCODE_ENV = normalizeZCodeEnv(typeof __ZCODE_ENV__ !== "undefined" ? __ZCODE_ENV__ : void 0);
var RUNTIME_ZCODE_DEBUG = typeof process !== "undefined" ? process.env.ZCODE_DEBUG : void 0;
var DEFAULT_INTRANET_MACHINE_HOST = "studio.zcode-ai.com";
function readProcessEnv() {
  const maybeProcess = globalThis.process;
  return maybeProcess?.env ?? {};
}
function resolveIntranetMachineHost(env = readProcessEnv()) {
  return env.INTRANET_MACHINE_HOST?.trim() || DEFAULT_INTRANET_MACHINE_HOST;
}
var INTRANET_MACHINE_HOST = resolveIntranetMachineHost();
var INTRANET_ASSET_SERVICE_PORT = 12345;
var INTRANET_ASSET_BASE_URL = `http://${INTRANET_MACHINE_HOST}:${INTRANET_ASSET_SERVICE_PORT}/zcode`;
var INTRANET_DEPS_BASE_URL = `${INTRANET_ASSET_BASE_URL}/deps`;
var INTRANET_PROBE_SERVICE_PORT = 3850;
var INTRANET_PROBE_SERVICE_PATH = "/api/intranet/probe";
var INTRANET_PROBE_SERVICE_URL = `http://${INTRANET_MACHINE_HOST}:${INTRANET_PROBE_SERVICE_PORT}${INTRANET_PROBE_SERVICE_PATH}`;
var DEFAULT_HELPER_MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;
var DEV_BROKER_CREDENTIALS_DIR = join("computer-use", "run");
var CUA_PERMISSION_REFRESH_TERM_GRACE_MS = CUA_PERMISSION_BROKER_GRACEFUL_STOP_TIMEOUT_MS + 2e3;
var PROJECT_CONFIG_FILES = ["zcode.json", join(".zcode", "config.json")];
var BROKER_REFRESH_MARKER_ENV = "ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER";
var HTTP_AUTH_TOKEN_ENV = "ZCODE_CUA_HTTP_AUTH_TOKEN";
function readTrimmed(env, key) {
  const raw = env[key];
  if (typeof raw !== "string") return void 0;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}
function readBrokerEnv(env) {
  return {
    brokerSocketPath: readTrimmed(env, BROKER_SOCKET_ENV),
    brokerToken: readTrimmed(env, BROKER_TOKEN_ENV),
    refreshMarkerPath: readTrimmed(env, BROKER_REFRESH_MARKER_ENV),
    httpAuthToken: readTrimmed(env, HTTP_AUTH_TOKEN_ENV),
  };
}
async function main(opts: any = {}) {
  if (opts.transport === "streamable-http") {
    const running = await startStreamableHttpServer({
      brokerSocketPath: opts.brokerSocketPath,
      brokerToken: opts.brokerToken,
      refreshMarkerPath: opts.refreshMarkerPath,
      host: opts.host,
      port: opts.port,
      maxSessions: opts.maxSessions,
      sessionIdleTimeoutMs: opts.sessionIdleTimeoutMs,
      httpAuthToken: opts.httpAuthToken,
      allowUnauthenticatedRemoteHttp: opts.allowUnauthenticatedRemoteHttp,
    });
    console.error(`[Computer Use] Streamable HTTP MCP listening at ${running.url}`);
    await new Promise<void>((resolve22) => {
      let closing = false;
      const shutdown = () => {
        if (closing) return;
        closing = true;
        void running
          .close()
          .catch((error51) => {
            console.error(
              `[Computer Use] HTTP shutdown failed: ${error51 instanceof Error ? error51.message : String(error51)}`,
            );
            process.exitCode = 1;
          })
          .finally(resolve22);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
    return;
  }
  const built = buildServer({
    brokerSocketPath: opts.brokerSocketPath,
    brokerToken: opts.brokerToken,
    refreshMarkerPath: opts.refreshMarkerPath,
  });
  await resetPipDismissedForNewSession(built.deps);
  let stdioCleanupPromise;
  const runStdioCleanup = () => {
    if (stdioCleanupPromise) return stdioCleanupPromise;
    stdioCleanupPromise = cleanupStdioSession(built.deps, opts.stdioLifecycleCleanup);
    return stdioCleanupPromise;
  };
  await built.server.connect(
    createStdioTransport(async () => {
      try {
        await runStdioCleanup();
      } catch (error51) {
        console.error(
          `[Computer Use] stdin close input cleanup failed: ${error51 instanceof Error ? error51.message : String(error51)}`,
        );
        process.exitCode = 1;
        throw error51;
      }
    }),
  );
  const stdioShutdown = () => {
    void runStdioCleanup()
      .catch((error51) => {
        console.error(
          `[Computer Use] signal shutdown input cleanup failed: ${error51 instanceof Error ? error51.message : String(error51)}`,
        );
        process.exitCode = 1;
      })
      .finally(() => process.exit());
  };
  process.once("SIGINT", stdioShutdown);
  process.once("SIGTERM", stdioShutdown);
}
export {
  ALLOW_UNAUTHENTICATED_REMOTE_HTTP_FLAG,
  APPLICATION_SEARCH_MAX_BYTES,
  ARGUMENT_TERMINATOR,
  BROKER_METHODS,
  BROKER_METHOD_SET,
  BROKER_PRESENTED_RESULT,
  BROKER_REFRESH_MARKER_ENV,
  BROKER_SOCKET_ENV,
  BROKER_TOKEN_ENV,
  CLIPBOARD_MAX_BUFFER,
  COMPILED_LOCAL_DEVELOPMENT_RUNTIME,
  CONTROL_TYPE_TO_KIND,
  CUA_PERMISSION_BROKER_GRACEFUL_STOP_TIMEOUT_MS,
  CUA_PERMISSION_REFRESH_TERM_GRACE_MS,
  DEFAULT_CUA_LAUNCHER_BUNDLE_ID,
  DEFAULT_CUA_LAUNCHER_BUNDLE_IDS,
  DEFAULT_HELPER_MAX_DOWNLOAD_BYTES,
  DEFAULT_INTRANET_MACHINE_HOST,
  DEFAULT_MAX_LINE_BYTES,
  DEV_BROKER_CREDENTIALS_DIR,
  DRAIN_TIMEOUT_MS,
  GlobalRequest,
  GlobalResponse,
  HOST_FLAG,
  HTTP_AUTH_TOKEN_ENV,
  HTTP_AUTH_TOKEN_FLAG,
  INTRANET_ASSET_BASE_URL,
  INTRANET_ASSET_SERVICE_PORT,
  INTRANET_DEPS_BASE_URL,
  INTRANET_MACHINE_HOST,
  INTRANET_PROBE_SERVICE_PATH,
  INTRANET_PROBE_SERVICE_PORT,
  INTRANET_PROBE_SERVICE_URL,
  IN_TREE_ADDON_REL,
  KEY_CHORD_KEYS,
  LOOPBACK_HOSTS,
  MAX_BLANK_SAMPLED_PIXELS,
  MAX_BLANK_SAMPLE_DIMENSION,
  MAX_DRAIN_BYTES,
  MAX_PNG_BYTES,
  MAX_SAMPLED_PIXELS,
  MAX_SAMPLE_DIMENSION,
  MAX_SESSIONS_FLAG,
  PIP_SESSION_HIDDEN_GROUP_ID,
  PORT_FLAG,
  PREVIEW_CUA_LAUNCHER_BUNDLE_ID,
  PROJECT_CONFIG_FILES,
  RUNTIME_ZCODE_DEBUG,
  ReadBuffer,
  RejectUnexpandedEnvPlaceholderError,
  Request,
  RequestError,
  Response2,
  SERVER_NAME,
  SERVER_VERSION,
  SESSION_IDLE_TIMEOUT_FLAG,
  SKYSHOT_ROLE,
  SOCKET_FLAG,
  SkyshotDiffer,
  StdioServerTransport,
  StreamableHTTPServerTransport,
  TEXT_ENTRY_KINDS,
  TEXT_ENTRY_KINDS2,
  TRANSPORT_FLAG,
  UnexpandedEnvPlaceholderError,
  VALUE_SET_KINDS,
  VALUE_SET_KINDS2,
  WebStandardStreamableHTTPServerTransport,
  X_ALREADY_SENT,
  ZCODE_ENV,
  abortControllerKey,
  assertNoUnexpandedPlaceholder,
  buildOutgoingHttpHeaders,
  buildServer,
  buildSkyshotLines,
  cacheKey,
  combinedCleanupError,
  configSchema,
  createMcpExpressApp,
  createSessionRequestLifecycle,
  createStdioTransport,
  deserializeMessage,
  drainIncoming,
  errorMessage,
  eventRequestSchema,
  flushHeaders,
  getAbortController,
  getRequestCache,
  getRequestListener,
  getResponseCache,
  handleFetchError,
  handleRequestError,
  handleResponseError,
  handshakeSchema,
  hasBooleanFlag,
  headersKey,
  hostHeaderValidation,
  identifierSchema,
  incomingDraining,
  incomingKey,
  isPromise,
  isWindowsNamedPipePath,
  jsonError,
  lineOf,
  localhostHostValidation,
  main,
  newHeadersFromIncoming,
  newRequest,
  newRequestFromIncoming,
  normalizeZCodeEnv,
  outgoingEnded,
  parseIntegerFlag,
  parsePositiveSeconds,
  parseServerArgs,
  parsedArgsToOptions,
  pipCaptureTargetSchema,
  pipSessionEventSchema,
  readBrokerEnv,
  readProcessEnv,
  readTrimmed,
  readWithoutBlocking,
  registerAllTools,
  rejectUnexpandedPlaceholder,
  requestCache,
  requestPrototype,
  resetPipDismissedForNewSession,
  resolveIntranetMachineHost,
  responseCache,
  responseViaCache,
  responseViaResponseObject,
  roleOf,
  sequenceSchema,
  serializeMessage,
  serializeSkyshot,
  sharedDiffer,
  sigOf,
  singleFlagValue,
  startStreamableHttpServer,
  stateOf,
  summarizeRanges,
  terminatorStart,
  toRequestError,
  urlKey,
  validateOptions,
  wrapBodyStream,
  writeFromReadableStream,
  writeFromReadableStreamDefaultReader,
};
