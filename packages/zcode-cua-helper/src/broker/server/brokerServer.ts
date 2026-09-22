/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname } from "node:path";
import {
  dispatchRequest,
  errorResponse,
  errorResponseFromException,
  okResponse,
  parseRequestLine,
  serializeResponse,
} from "../brokerProtocol.js";
import { CUA_BROKER_IPC_VERSION } from "../ipcVersion.js";
import { silentBrokerLogger } from "../logging.js";
import { tokensMatch } from "../brokerAuth.js";
import { isPipSessionBrokerMethod, isReadOnlyBrokerMethod } from "../types.js";

var DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;
var DEFAULT_REQUEST_TIMEOUT_MS = 15e3;
var CUA_PERMISSION_BROKER_GRACEFUL_STOP_TIMEOUT_MS = 8e3;
function parseConnectionIdentity(params, connectionId) {
  const p: any = params ?? {};
  const rawType = typeof p.client_type === "string" ? p.client_type.trim() : "";
  const clientType =
    rawType === "zcode_cua_mcp" || rawType === "legacy" || rawType === "anonymous"
      ? rawType
      : "legacy";
  return {
    clientType,
    workspaceKey: optionalIdentityString(p.workspace_key),
    sessionId: optionalIdentityString(p.session_id),
    threadId: optionalIdentityString(p.thread_id),
    connectionId,
    credentialId: optionalIdentityString(p.connection_id),
  };
}
function optionalIdentityString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}
var GracefulStopTimeoutError = class extends Error {
  safeRetryReady;
  constructor(timeoutMs, safeRetryReady) {
    super(
      `CUA permission broker graceful stop timed out after ${timeoutMs}ms; refusing to report a clean shutdown while admitted requests may still be active`,
    );
    this.safeRetryReady = safeRetryReady;
    this.name = "GracefulStopTimeoutError";
  }
  waitUntilSafeToRetry() {
    return this.safeRetryReady;
  }
};
function normalizeRequestTimeoutMs(value) {
  if (value === void 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`requestTimeoutMs must be a finite non-negative number, got ${value}`);
  }
  return value;
}
function normalizeGracefulStopTimeoutMs(value) {
  if (value === void 0) return CUA_PERMISSION_BROKER_GRACEFUL_STOP_TIMEOUT_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`gracefulStopTimeoutMs must be a finite positive number, got ${value}`);
  }
  return value;
}
export var CuaPermissionBrokerServer = class {
  socketPath;
  backend;
  logger;
  maxLineBytes;
  requestTimeoutMs;
  gracefulStopTimeoutMs;
  server = null;
  connections = /* @__PURE__ */ new Map();
  acceptingRequests = false;
  startInFlight = null;
  stopInFlight = null;
  serverCloseInFlight = null;
  verifyPeer;
  authToken;
  presentationAuthToken;
  useSocketLock;
  lockFilePath;
  idleExit;
  onIdleExit;
  socketLockHandle = null;
  idleTimer = null;
  idleSince = 0;
  onClientAuthenticated;
  clientAuthenticatedFired = false;
  onClientClaim;
  onTerminalStopCommitted;
  onTerminalWorkDrained;
  terminalStopCommitted = false;
  terminalWorkDrained = false;
  beforeListen;
  admitControllerAction;
  clientClaimFired = false;
  // startup TTL 触发后同步冻结。冻结后 broker_info 即使已排队也不能再回 health success / claim；
  // JS 单线程保证 claim commit 与 freeze 二者有唯一先后关系。
  clientClaimAdmissionOpen = true;
  // broker_info success 从 write() 到 write callback 之间是一个已越过 claim marker 的旧 epoch
  // reservation。startup watchdog 若在这个窄窗口触发，先等 callback：flush 成功则 claim 赢并保留
  // listener；write error/close 则 timeout epoch 赢并继续 fail-closed stop。
  clientClaimWrites = /* @__PURE__ */ new Set<any>();
  constructor(options) {
    this.socketPath = options.socketPath;
    this.backend = options.backend;
    this.logger = options.logger ?? silentBrokerLogger;
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.requestTimeoutMs = normalizeRequestTimeoutMs(options.requestTimeoutMs);
    this.gracefulStopTimeoutMs = normalizeGracefulStopTimeoutMs(options.gracefulStopTimeoutMs);
    this.authToken = options.authToken ?? null;
    this.presentationAuthToken = options.presentationAuthToken ?? null;
    if (
      this.authToken !== null &&
      this.presentationAuthToken !== null &&
      tokensMatch(this.authToken, this.presentationAuthToken)
    ) {
      throw new Error("tool and presentation broker tokens must be different");
    }
    this.verifyPeer = options.verifyPeer;
    this.useSocketLock = options.useSocketLock === true;
    this.lockFilePath = options.lockFilePath ?? `${this.socketPath}.lock`;
    this.idleExit = options.idleExit
      ? {
          timeoutMs: Math.max(1, options.idleExit.timeoutMs),
          pollMs: Math.max(1, options.idleExit.pollMs ?? 1e3),
          reason: options.idleExit.reason ?? "idle_timeout_reached",
        }
      : null;
    this.onIdleExit = options.onIdleExit;
    this.onClientAuthenticated = options.onClientAuthenticated;
    this.onClientClaim = options.onClientClaim;
    this.onTerminalStopCommitted = options.onTerminalStopCommitted;
    this.onTerminalWorkDrained = options.onTerminalWorkDrained;
    this.beforeListen = options.beforeListen;
    this.admitControllerAction = options.admitControllerAction;
  }
  // 置位连接为已认证，并在**首个**成功认证时回调一次 onClientAuthenticated（"认领"信号）。
  // identity 由 handleAuthenticate 从 client_hello 解析；dev/匿名或未走 authenticate 的连接传 undefined。
  markConnectionAuthenticated(conn, identity, role = "tool") {
    conn.authenticated = true;
    conn.authRole = role;
    if (identity) conn.identity = identity;
    if (this.clientAuthenticatedFired) return;
    this.clientAuthenticatedFired = true;
    try {
      this.onClientAuthenticated?.();
    } catch (error51) {
      this.logger.debug?.(void 0, "cua broker onClientAuthenticated callback threw", error51);
    }
  }
  // 首个成功服务的 broker_info（且响应真正返回给了 client）→ 认领完成信号，回调一次 onClientClaim。
  markClientClaimed(reservedBeforeFreeze = false) {
    if ((!this.clientClaimAdmissionOpen && !reservedBeforeFreeze) || this.clientClaimFired) {
      return;
    }
    this.clientClaimFired = true;
    try {
      this.onClientClaim?.();
    } catch (error51) {
      this.logger.debug?.(void 0, "cua broker onClientClaim callback threw", error51);
    }
  }
  reserveClientClaimWrite() {
    if (!this.clientClaimAdmissionOpen || this.clientClaimFired) return null;
    let resolvePromise: any = () => {};
    const promise2 = new Promise((resolve2) => {
      resolvePromise = resolve2;
    });
    const claimWrite = {
      promise: promise2,
      settled: false,
      resolve: () => {
        if (claimWrite.settled) return;
        claimWrite.settled = true;
        this.clientClaimWrites.delete(claimWrite);
        resolvePromise();
      },
    };
    this.clientClaimWrites.add(claimWrite);
    return claimWrite;
  }
  settleClientClaimWrite(claimWrite, flushed) {
    if (flushed) this.markClientClaimed(true);
    claimWrite.resolve();
  }
  get path() {
    return this.socketPath;
  }
  isRunning() {
    return this.server !== null && this.acceptingRequests;
  }
  start() {
    if (this.stopInFlight) {
      return Promise.reject(
        new Error("CUA permission broker cannot start while a graceful stop is incomplete"),
      );
    }
    if (this.server && this.acceptingRequests) return Promise.resolve();
    if (this.startInFlight) return this.startInFlight;
    if (this.server) {
      return Promise.reject(
        new Error("CUA permission broker cannot start while a graceful stop is incomplete"),
      );
    }
    const operation = this.performStart();
    const tracked = operation.finally(() => {
      if (this.startInFlight === tracked) this.startInFlight = null;
    });
    this.startInFlight = tracked;
    return tracked;
  }
  /** 读 lock 文件里的持锁 pid 并探活（process.kill(pid,0)）；不可读/不存在视为死锁残留。 */
  async lockHolderIsDead() {
    try {
      const content = await readFile(this.lockFilePath, "utf8");
      const pid = Number.parseInt(content.trim(), 10);
      if (!Number.isInteger(pid) || pid <= 1) return true;
      process.kill(pid, 0);
      return false;
    } catch (error51) {
      return error51.code === "ESRCH";
    }
  }
  /** M2 idle：连接增删 / ping / 业务请求都刷新活动时刻；空闲判定 = 无连接 && 无 in-flight。 */
  noteActivity() {
    this.idleSince = Date.now();
  }
  scheduleIdleCheck() {
    if (!this.idleExit || this.idleTimer) return;
    this.idleSince = Date.now();
    const { timeoutMs, pollMs, reason } = this.idleExit;
    this.idleTimer = setInterval(() => {
      if (this.server === null) {
        if (this.idleTimer) clearInterval(this.idleTimer);
        this.idleTimer = null;
        return;
      }
      const busy = this.connections.size > 0 || Date.now() - this.idleSince < timeoutMs;
      if (busy) return;
      if (this.idleTimer) clearInterval(this.idleTimer);
      this.idleTimer = null;
      try {
        this.onIdleExit?.(reason);
      } finally {
        void this.stop().catch(() => {});
      }
    }, pollMs);
    this.idleTimer.unref?.();
  }
  async performStart() {
    await this.ensureSocketDirectory();
    if (this.useSocketLock && !this.isWindowsNamedPipeTransport()) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          this.socketLockHandle = await open(this.lockFilePath, "wx", 384);
          await this.socketLockHandle.write(
            `${process.pid}
`,
            0,
            "utf8",
          );
          break;
        } catch (error51) {
          const code = error51.code;
          if (code !== "EEXIST") throw error51;
          if (attempt > 0 || !(await this.lockHolderIsDead())) {
            throw new Error("another Computer Use Helper instance already holds the broker lock");
          }
          await unlink(this.lockFilePath).catch(() => {});
        }
      }
    }
    await this.unlinkStaleSocketIfSafe();
    if (this.beforeListen && !this.beforeListen()) {
      throw new Error(
        "Computer Use Helper broker launch was canceled or expired before socket listen",
      );
    }
    const server = createServer((socket) => this.handleConnection(socket));
    await new Promise<void>((resolve2, reject) => {
      const onError = (error51) => {
        server.off("listening", onListening);
        reject(error51);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve2();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.socketPath);
    });
    if (!this.isWindowsNamedPipeTransport()) {
      await chmod(this.socketPath, 384);
    }
    this.server = server;
    if (this.idleExit) this.scheduleIdleCheck();
    this.serverCloseInFlight = null;
    this.terminalStopCommitted = false;
    this.terminalWorkDrained = false;
    this.acceptingRequests = this.stopInFlight === null;
    this.logger.info(void 0, "cua permission broker listening");
    this.logger.debug?.(void 0, `cua permission broker socket=${this.socketPath}`);
  }
  stop(mode = "normal") {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    const lockHandle = this.socketLockHandle;
    this.socketLockHandle = null;
    if (lockHandle) {
      void lockHandle.close().catch(() => {});
      void unlink(this.lockFilePath).catch(() => {});
    }
    if (mode === "startup-claim-timeout") {
      this.clientClaimAdmissionOpen = false;
      this.revokeStopDrainLeases();
    }
    if (this.stopInFlight) return this.stopInFlight;
    if (!this.server && !this.startInFlight) return Promise.resolve();
    this.acceptingRequests = false;
    const operation =
      mode === "startup-claim-timeout"
        ? this.performStartupClaimTimeoutStop()
        : this.performGracefulStop(mode);
    const tracked = operation.finally(() => {
      if (this.stopInFlight === tracked) this.stopInFlight = null;
    });
    this.stopInFlight = tracked;
    return tracked;
  }
  /**
   * terminal lifecycle 使用此入口：预算超时先通过 `onRetry` 暴露，再保持 admission 冻结，
   * 不发 KILL 地等待已 dispatch 工作完成并自动重试。非 timeout 错误仍原样抛给调用方。
   */
  async stopEventually(mode = "normal", onRetry?) {
    for (;;) {
      try {
        await this.stop(mode);
        return;
      } catch (error51) {
        if (!(error51 instanceof GracefulStopTimeoutError)) throw error51;
        onRetry?.(error51);
        await error51.waitUntilSafeToRetry();
      }
    }
  }
  async performStartupClaimTimeoutStop() {
    const writesAtFreeze = [...this.clientClaimWrites].map((claimWrite) => claimWrite.promise);
    await Promise.all(writesAtFreeze);
    if (this.clientClaimFired) {
      this.clientClaimAdmissionOpen = true;
      this.acceptingRequests = true;
      return;
    }
    await this.performGracefulStop("startup-claim-timeout");
  }
  async performGracefulStop(mode) {
    const start = this.startInFlight;
    if (start) await start;
    const server = this.server;
    if (!server) return;
    if (!this.terminalStopCommitted) {
      try {
        const cleaned = this.onTerminalStopCommitted?.();
        if (cleaned === false) {
          throw new Error("native input cleanup failed");
        }
      } catch (error51) {
        this.logger.error(void 0, `cua broker terminal-stop hook failed (${mode})`, error51);
        throw new Error(
          "CUA permission broker native input cleanup failed; refusing to report a clean stop",
          { cause: error51 },
        );
      }
      this.terminalStopCommitted = true;
    }
    const deadline = Date.now() + this.gracefulStopTimeoutMs;
    const admittedWork = [...this.connections.values()].map((connection) =>
      this.prepareConnectionForStop(connection, mode === "normal"),
    );
    await this.waitWithinGracefulStopBudget(
      Promise.all(admittedWork).then(() => void 0),
      deadline,
    );
    if (!this.terminalWorkDrained) {
      try {
        const cleaned = await this.waitWithinGracefulStopBudget(
          Promise.resolve(this.onTerminalWorkDrained?.()),
          deadline,
        );
        if (cleaned === false) {
          throw new Error("post-drain native pointer cleanup failed");
        }
      } catch (error51) {
        this.logger.error(void 0, `cua broker post-drain input cleanup failed (${mode})`, error51);
        throw new Error(
          "CUA permission broker could not release drained pointer input; refusing to report a clean stop",
          { cause: error51 },
        );
      }
      this.terminalWorkDrained = true;
    }
    const serverClosed = this.beginServerClose(server);
    const sockets = [...this.connections.keys()];
    await this.waitWithinGracefulStopBudget(
      Promise.all(sockets.map((socket) => this.endSocketAfterFlush(socket))).then(() => void 0),
      deadline,
    );
    await this.waitWithinGracefulStopBudget(serverClosed, deadline);
    if (this.server === server) this.server = null;
    this.serverCloseInFlight = null;
    this.connections.clear();
    await this.unlinkSocketFileIfOwned();
    this.logger.info(void 0, "cua permission broker stopped");
    this.logger.debug?.(void 0, `cua permission broker stopped socket=${this.socketPath}`);
  }
  beginServerClose(server) {
    if (this.serverCloseInFlight) return this.serverCloseInFlight;
    this.serverCloseInFlight = new Promise<void>((resolve2, reject) => {
      server.close((error51) => {
        if (error51) reject(error51);
        else resolve2();
      });
    });
    return this.serverCloseInFlight;
  }
  prepareConnectionForStop(conn, allowPreSignalDrain) {
    if (conn.closed || conn.businessRequestsAdmitted > 0 || !allowPreSignalDrain) {
      return conn.processing;
    }
    if (conn.stopDrain) return conn.stopDrain.promise;
    let resolvePromise: any = () => {};
    const promise2 = new Promise((resolve2) => {
      resolvePromise = resolve2;
    });
    const stopDrain = {
      allowAuthenticate: conn.authenticateRequestsAdmitted === 0,
      allowBusinessRequest: true,
      promise: promise2,
      revoked: false,
      settled: false,
      resolve: () => {
        if (stopDrain.settled) return;
        stopDrain.settled = true;
        resolvePromise();
      },
    };
    conn.stopDrain = stopDrain;
    return promise2;
  }
  async waitWithinGracefulStopBudget(work, deadline) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw this.gracefulStopTimeoutError();
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(this.gracefulStopTimeoutError()), remainingMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  gracefulStopTimeoutError() {
    const safeRetryReady = this.revokeStopDrainLeases();
    return new GracefulStopTimeoutError(this.gracefulStopTimeoutMs, safeRetryReady);
  }
  revokeStopDrainLeases() {
    const admittedWork = [];
    for (const conn of this.connections.values()) {
      const drain = conn.stopDrain;
      if (drain && !drain.settled) {
        drain.revoked = true;
        drain.allowAuthenticate = false;
        drain.allowBusinessRequest = false;
        const processingAtRevoke = conn.processing;
        void processingAtRevoke.then(() => drain.resolve());
      }
      admittedWork.push(conn.processing);
    }
    return Promise.all(admittedWork).then(() => void 0);
  }
  endSocketAfterFlush(socket) {
    if (socket.destroyed) return Promise.resolve();
    return new Promise<void>((resolve2) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        socket.off("close", finish);
        socket.destroy();
        resolve2();
      };
      socket.once("close", finish);
      socket.end(finish);
    });
  }
  async ensureSocketDirectory() {
    if (this.isWindowsNamedPipeTransport()) return;
    const socketDir = dirname(this.socketPath);
    await mkdir(socketDir, { recursive: true, mode: 448 });
    const stats = await stat(socketDir);
    this.assertCurrentUserOwner(socketDir, stats.uid);
    if ((stats.mode & 511) !== 448) {
      await chmod(socketDir, 448);
    }
  }
  async unlinkStaleSocketIfSafe() {
    if (this.isWindowsNamedPipeTransport()) return;
    const stats = await this.statSocketPath();
    if (!stats) return;
    this.assertCurrentUserOwner(this.socketPath, stats.uid);
    if (!stats.isSocket()) {
      throw new Error(`refusing to remove non-socket broker path: ${this.socketPath}`);
    }
    if (await this.canConnectToExistingSocket()) {
      throw new Error(`permission broker socket is already in use: ${this.socketPath}`);
    }
    await this.unlinkSocketFileIfOwned();
  }
  async unlinkSocketFileIfOwned() {
    if (this.isWindowsNamedPipeTransport()) return;
    const stats = await this.statSocketPath();
    if (!stats) return;
    this.assertCurrentUserOwner(this.socketPath, stats.uid);
    try {
      await unlink(this.socketPath);
    } catch (error51) {
      this.logger.warn(void 0, "failed to unlink stale broker socket", error51);
      this.logger.debug?.(void 0, `failed to unlink stale broker socket=${this.socketPath}`);
    }
  }
  /**
   * True iff the broker transport is a Windows named pipe (`\\.\pipe\...`).
   *
   * Transport is determined by the OS, not the path shape: a win32 server
   * always listens on a named pipe (see `mintBrokerSocketPath` in
   * `@zcode/cua-helper/socketPath`). All fs-node assumptions in this server
   * (mkdir a parent dir, chmod the socket node, unlink a stale socket file,
   * stat-based owner checks) are POSIX-only and skipped on win32 — pipe
   * security rests on the `CreateNamedPipe` SECURITY_ATTRIBUTES (native
   * extension point, design doc §3 R10) plus the peer-verification gate.
   *
   * Mirrors `defaultPeerCredentialChecker`'s win32 branch in cua-helper.
   */
  isWindowsNamedPipeTransport() {
    return process.platform === "win32";
  }
  async statSocketPath() {
    try {
      return await lstat(this.socketPath);
    } catch {
      return null;
    }
  }
  assertCurrentUserOwner(path, uid) {
    const getuid = process.getuid;
    if (typeof getuid !== "function") return;
    const currentUid = getuid.call(process);
    if (uid !== currentUid) {
      throw new Error(`refusing to use broker path not owned by current user: ${path}`);
    }
  }
  canConnectToExistingSocket() {
    return new Promise((resolve2) => {
      const socket = createConnection(this.socketPath);
      const finish = (connected) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve2(connected);
      };
      socket.setTimeout(200);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  }
  handleConnection(socket) {
    if (!this.acceptingRequests) {
      socket.destroy();
      return;
    }
    if (this.verifyPeer && !this.verifyPeer(socket)) {
      this.logger.warn(void 0, "cua broker rejected connection: peer verification failed");
      socket.destroy();
      return;
    }
    // 与原版一致：两端 token 都未配置（dev）才默认放行；配置了任一 token 就必须走 authenticate。
    const developmentNoAuth = this.authToken === null && this.presentationAuthToken === null;
    const conn: any = {
      authenticated: developmentNoAuth,
      authRole: developmentNoAuth ? "tool" : null,
      closeAfterWrite: false,
      processing: Promise.resolve(),
      closed: false,
      authenticateRequestsAdmitted: 0,
      businessRequestsAdmitted: 0,
      connectionId: randomBytes(8).toString("hex"),
      identity: null,
    };
    this.connections.set(socket, conn);
    this.noteActivity();
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > this.maxLineBytes) {
        this.logger.warn(void 0, "cua broker request line exceeded max bytes; dropping connection");
        socket.destroy();
        return;
      }
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.trim().length > 0) {
          if (this.acceptingRequests) {
            this.enqueueLine(socket, conn, line, false);
          } else {
            this.enqueueLineDuringStop(socket, conn, line);
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    });
    socket.on("error", (error51) => {
      this.logger.debug?.(void 0, "cua broker socket error", error51);
    });
    socket.on("close", () => {
      conn.closed = true;
      const processingAtClose = conn.processing;
      void processingAtClose.finally(() => {
        conn.stopDrain?.resolve();
        if (conn.processing === processingAtClose && this.connections.get(socket) === conn) {
          this.connections.delete(socket);
          this.noteActivity();
        }
      });
    });
  }
  enqueueLineDuringStop(socket, conn, line) {
    const drain = conn.stopDrain;
    if (!drain || drain.revoked || drain.settled) return;
    const parsed = parseRequestLine(line);
    const authenticate = parsed.ok && parsed.request.method === "authenticate";
    if (authenticate && drain.allowAuthenticate) {
      drain.allowAuthenticate = false;
      this.enqueueLine(socket, conn, line, false);
      return;
    }
    if (!authenticate && drain.allowBusinessRequest) {
      drain.allowAuthenticate = false;
      drain.allowBusinessRequest = false;
      const processing2 = this.enqueueLine(socket, conn, line, true);
      void processing2.then(() => drain.resolve());
      return;
    }
    drain.allowAuthenticate = false;
    drain.allowBusinessRequest = false;
    const processing = conn.processing.then(() => {
      if (!conn.closed && socket.writable) socket.end();
    });
    conn.processing = processing;
    void processing.then(() => drain.resolve());
  }
  enqueueLine(socket, conn, line, endAfterResponse) {
    const parsed = parseRequestLine(line);
    if (parsed.ok && parsed.request.method === "authenticate") {
      conn.authenticateRequestsAdmitted += 1;
    } else {
      conn.businessRequestsAdmitted += 1;
    }
    const processing = conn.processing
      .then(async () => {
        await this.processLine(socket, conn, line);
        if (endAfterResponse && !conn.closed && socket.writable) socket.end();
      })
      .catch((error51) => {
        this.logger.debug?.(void 0, "cua broker processLine failed", error51);
      });
    conn.processing = processing;
    return processing;
  }
  async processLine(socket, conn, line) {
    if (conn.closed) return;
    const parsed = parseRequestLine(line);
    let response: any = await this.handleLineWithTimeout(conn, line);
    const isSuccessfulBrokerInfo: any =
      parsed.ok && parsed.request.method === "broker_info" && response.ok;
    if (isSuccessfulBrokerInfo && !this.clientClaimAdmissionOpen) {
      response = errorResponse(
        parsed.request.id,
        "not_authorized",
        "broker startup claim window has closed",
      );
    }
    if (conn.closed || !socket.writable) return;
    const claimWrite =
      isSuccessfulBrokerInfo && response.ok && !this.clientClaimFired
        ? this.reserveClientClaimWrite()
        : null;
    if (isSuccessfulBrokerInfo && response.ok && !this.clientClaimFired && claimWrite === null) {
      response = errorResponse(
        parsed.ok ? parsed.request.id : 0,
        "not_authorized",
        "broker startup claim window has closed",
      );
    }
    const flushed = await this.writeResponse(socket, response);
    if (claimWrite) this.settleClientClaimWrite(claimWrite, flushed);
    if (!flushed) return;
    if (conn.closeAfterWrite) {
      socket.end();
    }
  }
  writeResponse(socket, response) {
    let payload;
    try {
      payload = serializeResponse(response);
    } catch {
      return Promise.resolve(false);
    }
    return new Promise((resolve2) => {
      let settled = false;
      const finish = (flushed) => {
        if (settled) return;
        settled = true;
        socket.off("close", onClose);
        resolve2(flushed);
      };
      const onClose = () => finish(false);
      if (socket.destroyed) {
        resolve2(false);
        return;
      }
      socket.once("close", onClose);
      try {
        socket.write(payload, (error51) => {
          finish(error51 === void 0 || error51 === null);
        });
      } catch {
        finish(false);
      }
    });
  }
  async handleLineWithTimeout(conn, line) {
    const parsed = parseRequestLine(line);
    if (!parsed.ok) {
      if (!conn.authenticated) conn.closeAfterWrite = true;
      return errorResponse(parsed.id, parsed.code, parsed.message);
    }
    const request = parsed.request;
    if (request.method === "authenticate") {
      const clientVersion = request.params?.clientApiVersion;
      if (
        typeof clientVersion === "number" &&
        Number.isSafeInteger(clientVersion) &&
        clientVersion > CUA_BROKER_IPC_VERSION
      ) {
        conn.closeAfterWrite = true;
        return errorResponse(
          request.id,
          "version_mismatch",
          `Computer Use broker IPC version ${CUA_BROKER_IPC_VERSION} is older than the client's ${clientVersion}; upgrade ZCode/Helper and retry`,
        );
      }
      return this.handleAuthenticate(conn, request);
    }
    if (request.method === "ping") {
      const clientVersion = request.params?.clientApiVersion;
      if (
        typeof clientVersion === "number" &&
        Number.isSafeInteger(clientVersion) &&
        clientVersion > CUA_BROKER_IPC_VERSION
      ) {
        return errorResponse(
          request.id,
          "version_mismatch",
          `Computer Use broker IPC version ${CUA_BROKER_IPC_VERSION} is older than the client's ${clientVersion}; upgrade ZCode/Helper and retry`,
        );
      }
      this.noteActivity();
      return okResponse(request.id, { serverApiVersion: CUA_BROKER_IPC_VERSION });
    }
    if (!conn.authenticated) {
      conn.closeAfterWrite = true;
      return errorResponse(
        request.id,
        "not_authorized",
        "broker requires authenticate as the first request",
      );
    }
    const presentationMethod = isPipSessionBrokerMethod(request.method);
    if (presentationMethod && conn.authRole !== "presentation") {
      return errorResponse(
        request.id,
        "not_authorized",
        "PiP session methods require presentation authority",
      );
    }
    if (!presentationMethod && conn.authRole === "presentation") {
      return errorResponse(
        request.id,
        "not_authorized",
        "presentation authority cannot invoke CUA tool methods",
      );
    }
    const isControllerCommand =
      request.method === "controller_takeover" || request.method === "controller_stop";
    if (!presentationMethod && !isReadOnlyBrokerMethod(request.method) && !isControllerCommand) {
      try {
        await this.admitControllerAction?.(request, conn.identity);
      } catch (error51) {
        return errorResponseFromException(request.id, error51);
      }
    }
    const work = dispatchRequest(this.backend, request);
    const canSoftTimeout =
      isReadOnlyBrokerMethod(request.method) &&
      Number.isFinite(this.requestTimeoutMs) &&
      this.requestTimeoutMs > 0;
    if (!canSoftTimeout) {
      return work;
    }
    void work.catch(() => {});
    let timer;
    try {
      return await Promise.race([
        work,
        new Promise((resolve2) => {
          timer = setTimeout(() => {
            resolve2(
              errorResponse(
                request.id,
                "timeout",
                `permission broker request ${request.method} timed out after ${this.requestTimeoutMs}ms`,
              ),
            );
          }, this.requestTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  // authenticate 处理：连接身份已由 verifyPeer 的签名三道门证明，这里只承载 client_hello 寻址与
  // 角色声明。presentation 角色不能自报：只有对端 SecCode identifier 属于 ZCode 主进程的连接才可声明。
  handleAuthenticate(conn, request) {
    const identity = parseConnectionIdentity(request.params, conn.connectionId);
    // authenticate 处理（与原版发行物一致）：token 未配置 → no-op ok（让带 token 的 client
    // 也能连 dev server）；配置了 → 常量时间比对，成功置位、失败回 not_authorized 并标记断开。
    if (this.authToken === null && this.presentationAuthToken === null) {
      this.markConnectionAuthenticated(conn, identity, "tool");
      return okResponse(request.id, { authenticated: true });
    }
    if (tokensMatch(this.authToken ?? "", request.params?.token)) {
      this.markConnectionAuthenticated(conn, identity, "tool");
      return okResponse(request.id, { authenticated: true });
    }
    if (tokensMatch(this.presentationAuthToken ?? "", request.params?.token)) {
      this.markConnectionAuthenticated(conn, identity, "presentation");
      return okResponse(request.id, { authenticated: true, role: "presentation" });
    }
    conn.closeAfterWrite = true;
    return errorResponse(request.id, "not_authorized", "invalid or missing broker auth token");
  }
};
