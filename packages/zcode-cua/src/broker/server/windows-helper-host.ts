// oxlint-disable-file
// 发行 bundle 还原稿：结构忠实于原编译产物，待语义化拆分。
function Pe(scope: string) {
  // 发行包中 Pe 为作用域日志工厂；本还原以静默实现保持默认行为。
  return { debug() {}, info() {}, warn() {}, error() {} };
}

import { z } from "zod";
import { HELPER_ADDON_ENV_VALUE } from "./region-constants.js";
// oxlint-disable-file -- 还原草稿：仅供继续手工重建参考，不参与编译
import { CUA_PIP_NO_ACTIVE_SESSION_V2, CUA_PIP_SESSION_PROTOCOL } from "./region-constants.js";

import {
  closeSync as yXe,
  fstatSync as wXe,
  lstatSync as vXe,
  openSync as SXe,
  readFileSync as kXe,
  readSync as PXe,
} from "node:fs";
import { fork as Rae } from "node:child_process";
import { randomBytes as Aae, randomUUID } from "node:crypto";
import { Ft, Qu } from "./permission-broker-client.js";
import { Uh } from "./orphan-reaper.js";
import { Uu } from "../socket-path.js";
import { lW } from "./helper-installer.js";
import { probeHelperHealth } from "../index.js";

// 还原草稿（块级切分，待手工修正导入与类型）

export var RXe = Object.freeze(new Set(["schema", "kind", "deadlineEpochMs"]));

export var iy = lW,
  p$ = HELPER_ADDON_ENV_VALUE,
  f$ = {
    fork(e, t, n) {
      let [r, ...o] = t;
      if (!r) throw new Error("Windows Computer Use Helper entry path is required");
      return Rae(r, o, {
        ...n,
        execPath: e,
      });
    },
  },
  m$ = Uu,
  g$ = (e, t) =>
    probeHelperHealth(e, {
      timeoutMs: t,
    }),
  sy = class {
    constructor(t) {
      this.logger = t;
    }
    logger;
    static {}
    async terminate(t, n, r) {
      if (t.exitObserved) {
        t.removeMainListeners();
        return;
      }
      let o = this.waitForExit(t, "first-wait", r);
      if ((this.sendShutdown(t, n), await o)) {
        t.removeMainListeners();
        return;
      }
      let s: any = this.waitForExit(t, "second-wait", r);
      if ((this.kill(t, n), await s)) {
        t.removeMainListeners();
        return;
      }
      let a = new Error(
        "Windows Computer Use Helper termination blocker: child did not exit after kill",
      );
      throw (this.logFailure(t.id, t.child.pid, `${n}-termination-blocker`, a), a);
    }
    sendShutdown(t, n) {
      try {
        t.child.send({
          protocol: iy,
          type: "shutdown",
        });
      } catch (r) {
        this.logFailure(t.id, t.child.pid, `${n}-send`, r);
      }
    }
    kill(t, n) {
      try {
        t.child.kill();
      } catch (r) {
        this.logFailure(t.id, t.child.pid, `${n}-kill`, r);
      }
    }
    on(t, n, r, o, s) {
      try {
        return (t.on(n, r), !0);
      } catch (a) {
        return (this.logFailure(o, t.pid, s, a), !1);
      }
    }
    off(t, n, r, o, s) {
      try {
        t.off(n, r);
      } catch (a) {
        this.logFailure(o, t.pid, s, a);
      }
    }
    logFailure(t, n, r, o) {
      this.logger.warn(void 0, "Windows Computer Use Helper lifecycle failure", {
        generation: t,
        pid: n,
        errorClass: r,
        error: o instanceof Error ? o.name : typeof o,
      });
    }
    waitForExit(t, n, r) {
      return t.exitObserved
        ? Promise.resolve(!0)
        : new Promise((o) => {
            let s = !1,
              a = (l) => {
                s ||
                  ((s = !0), clearTimeout(d), this.off(t.child, "exit", c, t.id, `${n}-off`), o(l));
              },
              c = () => {
                ((t.exitObserved = !0), a(!0));
              },
              d = setTimeout(() => a(!1), r);
            (d.unref?.(),
              this.on(t.child, "exit", c, t.id, `${n}-on`) ? t.exitObserved && a(!0) : a(!1));
          });
    }
  };

export function h$(e) {
  if (!e || typeof e != "object") return null;
  let t: any = e;
  return t.protocol !== iy
    ? "ignore"
    : t.type === "error"
      ? typeof t.message != "string" || t.message.length === 0
        ? null
        : {
            protocol: iy,
            type: "error",
            message: t.message,
          }
      : t.type !== "ready" && t.type !== "transport_ready"
        ? "ignore"
        : typeof t.socketPath != "string" || !t.socketPath || !Number.isInteger(t.pid) || t.pid <= 0
          ? null
          : {
              protocol: iy,
              type: t.type,
              socketPath: t.socketPath,
              pid: t.pid,
            };
}

h$;

export function y$(e, t) {
  return Number.isInteger(e.pid) && e.pid > 0 && e.pid === t;
}

y$;

export function ay(e) {
  return e instanceof Error ? e : new Error(String(e));
}

export var Eae = () => Aae(16).toString("hex"),
  w$ = 3e4,
  v$ = 1e3,
  ep = class {
    constructor(t) {
      this.options = t;
      ((this.childProcess = t.childProcess ?? f$),
        (this.mintSocketPath = t.mintSocketPath ?? m$),
        (this.healthProbe = t.healthProbe ?? g$),
        (this.startupTimeoutMs = t.startupTimeoutMs ?? w$),
        (this.shutdownTimeoutMs = t.shutdownTimeoutMs ?? v$),
        (this.logger = t.logger ?? Pe("windows-cua-helper-host")),
        (this.childLifecycle = new sy(this.logger)),
        (this.authority = (t.mintPluginAuthority ?? Eae)()));
    }
    options;
    static {}
    childProcess;
    mintSocketPath;
    healthProbe;
    startupTimeoutMs;
    shutdownTimeoutMs;
    logger;
    childLifecycle;
    authority;
    handle = null;
    lastAgentVisibleTransport = null;
    current = null;
    lifecycleTail = Promise.resolve();
    terminationBlocker = null;
    startInFlight = null;
    startInFlightEpoch = null;
    restartInFlight = null;
    restartAfterStartInFlight = null;
    restartPreservingTransportInFlight = null;
    transportReadyInFlight = null;
    transportReadyResolve = null;
    transportReadyReject = null;
    nextGeneration = 0;
    externalStopEpoch = 0;
    get running() {
      return this.handle !== null;
    }
    get socketPath() {
      return this.handle?.socketPath ?? null;
    }
    get pluginAuthority() {
      return this.handle ? this.authority : null;
    }
    waitForTransport(t = w$) {
      if (this.handle)
        return Promise.resolve({
          socketPath: this.handle.socketPath,
          pluginAuthority: this.handle.pluginAuthority,
        });
      let n = this.transportReadyInFlight;
      return n
        ? new Promise((r, o) => {
            let s = setTimeout(() => {
              o(new Error(`Windows Computer Use Helper transport timed out after ${t}ms`));
            }, t);
            (s.unref?.(),
              n.then(
                (a) => {
                  (clearTimeout(s), r(a));
                },
                (a) => {
                  (clearTimeout(s), o(a));
                },
              ));
          })
        : Promise.reject(new Error("Windows Computer Use Helper is not starting"));
    }
    start() {
      let t = this.externalStopEpoch;
      if (this.startInFlight && this.startInFlightEpoch === t) return this.startInFlight;
      this.createTransportReadyPromise();
      let n = this.transportReadyInFlight,
        r = this.lastAgentVisibleTransport ?? void 0,
        o = this.enqueue(() => this.startNow(t, r))
          .catch((s) => {
            throw (this.transportReadyInFlight === n && this.rejectTransportReady(s), s);
          })
          .finally(() => {
            this.startInFlight === o &&
              ((this.startInFlight = null), (this.startInFlightEpoch = null));
          });
      return ((this.startInFlight = o), (this.startInFlightEpoch = t), o.catch(() => {}), o);
    }
    stop() {
      let t = this.current,
        n = this.invalidateForExternalStop(t);
      return this.enqueue(async () => {
        try {
          await n;
        } finally {
          t && this.current?.id === t.id && (this.current = null);
        }
      });
    }
    restart() {
      if (this.restartInFlight) return this.restartInFlight;
      let t = this.externalStopEpoch,
        n = this.enqueue(async () => (await this.stopNow("restart"), this.startNow(t))).finally(
          () => {
            this.restartInFlight === n && (this.restartInFlight = null);
          },
        );
      return ((this.restartInFlight = n), n);
    }
    restartAfterCurrentStart() {
      if (this.restartAfterStartInFlight) return this.restartAfterStartInFlight;
      let t = this.externalStopEpoch,
        n = this.enqueue(
          async () => (await this.stopNow("permission-restart"), this.startNow(t)),
        ).finally(() => {
          this.restartAfterStartInFlight === n && (this.restartAfterStartInFlight = null);
        });
      return ((this.restartAfterStartInFlight = n), n);
    }
    restartAfterCurrentStartPreservingTransport(t: { beforeFreshStart?: () => void } = {}) {
      if (this.restartPreservingTransportInFlight) return this.restartPreservingTransportInFlight;
      let n = this.externalStopEpoch,
        r = this.enqueue(async () => {
          let o = this.handle ?? this.lastAgentVisibleTransport;
          if ((await this.stopNow("preserving-transport-restart"), n !== this.externalStopEpoch))
            throw new Error("Windows Computer Use Helper startup stopped");
          return o
            ? {
                handle: await this.startNow(n, o),
                reused: !0,
              }
            : (t.beforeFreshStart?.(),
              (this.lastAgentVisibleTransport = null),
              {
                handle: await this.startNow(n),
                reused: !1,
              });
        }).finally(() => {
          this.restartPreservingTransportInFlight === r &&
            (this.restartPreservingTransportInFlight = null);
        });
      return ((this.restartPreservingTransportInFlight = r), r);
    }
    async checkHealth(t = v$) {
      let n = this.handle;
      if (!n) throw new Error("Windows Computer Use Helper is not running");
      return this.healthProbe(n.socketPath, t);
    }
    enqueue(t) {
      let n = this.lifecycleTail.then(async () => {
        if (this.terminationBlocker) throw this.terminationBlocker;
        return t();
      });
      return (
        (this.lifecycleTail = n.then(
          () => {},
          () => {},
        )),
        n
      );
    }
    startNow(t, n?) {
      return t !== this.externalStopEpoch
        ? Promise.reject(new Error("Windows Computer Use Helper startup stopped"))
        : this.handle
          ? Promise.resolve(this.handle)
          : this.terminationBlocker
            ? Promise.reject(this.terminationBlocker)
            : this.startGeneration(t, n);
    }
    createTransportReadyPromise() {
      this.transportReadyInFlight ||
        ((this.transportReadyInFlight = new Promise((t, n) => {
          ((this.transportReadyResolve = t), (this.transportReadyReject = n));
        })),
        this.transportReadyInFlight.catch(() => {}));
    }
    resolveTransportReady(t) {
      ((this.lastAgentVisibleTransport = {
        socketPath: t.socketPath,
      }),
        this.transportReadyResolve?.(t),
        (this.transportReadyResolve = null),
        (this.transportReadyReject = null));
    }
    rejectTransportReady(t) {
      (this.transportReadyReject?.(t), this.invalidateTransportReady());
    }
    invalidateTransportReady() {
      ((this.transportReadyResolve = null),
        (this.transportReadyReject = null),
        (this.transportReadyInFlight = null));
    }
    async stopNow(t) {
      let n = this.current;
      n &&
        ((this.handle = null),
        t !== "preserving-transport-restart" && (this.lastAgentVisibleTransport = null),
        (n.stopped = !0),
        await this.terminateGeneration(n, t),
        this.current?.id === n.id && (this.current = null),
        this.invalidateTransportReady());
    }
    startGeneration(t, n) {
      let r = ++this.nextGeneration,
        o = n?.socketPath ?? this.mintSocketPath(),
        s = [this.options.runtime.entryPath, "--socket", o, "--parent-pid", String(process.pid)],
        a;
      try {
        a = this.childProcess.fork(this.options.runtime.command, s, {
          cwd: this.options.runtime.root,
          env: {
            ...process.env,
            ...this.options.runtime.commandEnv,
            [p$]: this.options.runtime.addonPath,
            ELECTRON_RUN_AS_NODE: "1",
          },
        });
      } catch (c) {
        let d = ay(c);
        return (
          this.rejectTransportReady(d),
          this.childLifecycle.logFailure(r, void 0, "fork", d),
          Promise.reject(d)
        );
      }
      return new Promise((c, d) => {
        let l = !1,
          p,
          u,
          f = (C, A) => {
            if (l) return;
            ((l = !0), p && clearTimeout(p));
            let D = ay(C);
            ((this.handle = null),
              this.rejectTransportReady(D),
              (u.stopped = !0),
              this.childLifecycle.logFailure(r, a.pid, A, D),
              this.terminateGeneration(u, A).then(
                () => d(D),
                (U) => {
                  (this.childLifecycle.logFailure(r, a.pid, `${A}-cleanup`, U), d(D));
                },
              ));
          },
          g = (C) => {
            l ||
              ((l = !0),
              p && clearTimeout(p),
              (this.handle = null),
              this.rejectTransportReady(C),
              d(C));
          },
          v = (C) => f(C, "child-error"),
          S = (C) => {
            ((u.exitObserved = !0),
              l
                ? !u.stopped &&
                  this.current?.id === r &&
                  ((this.handle = null),
                  (this.current = null),
                  this.invalidateTransportReady(),
                  this.logger.warn(
                    void 0,
                    "Windows Computer Use Helper exited unexpectedly",
                    {
                      generation: r,
                      pid: a.pid,
                      errorClass: "unexpected-exit",
                    },
                  ),
                  this.options.onUnexpectedExit?.({
                    generation: r,
                    pid: a.pid,
                  }))
                : f(
                    new Error(
                      `Windows Computer Use Helper exited before ready (${String(C)})`,
                    ),
                    "early-exit",
                  ));
          },
          k = (C) => {
            if (u.stopped || t !== this.externalStopEpoch || this.current?.id !== r) return;
            let A: any = h$(C);
            if (A !== "ignore") {
              if (!A)
                return f(
                  new Error("Invalid Windows Computer Use Helper control message"),
                  "malformed-message",
                );
              if (A.type === "error") return f(new Error(A.message), "helper-reported-error");
              if (A.socketPath === o) {
                if (A.pid !== a.pid)
                  return f(new Error("ready-pid-mismatch"), "ready-pid-mismatch");
                (this.resolveTransportReady({
                  socketPath: o,
                  pluginAuthority: this.authority,
                }),
                  A.type !== "transport_ready" &&
                    this.healthProbe(o, this.startupTimeoutMs).then(
                      (D) => {
                        if (
                          l ||
                          u.stopped ||
                          t !== this.externalStopEpoch ||
                          this.current?.id !== r
                        )
                          return;
                        if (!y$(D, a.pid))
                          return f(new Error("health-pid-mismatch"), "health-pid-mismatch");
                        ((l = !0), p && clearTimeout(p));
                        let U = {
                          socketPath: o,
                          launchSocketPath: o,
                          pluginAuthority: this.authority,
                          helperAppPath: this.options.runtime.entryPath,
                          bundleId: D.bundleId,
                          pid: D.pid,
                        };
                        ((this.handle = U),
                          this.logger.info(void 0, "Windows Computer Use Helper ready", {
                            generation: r,
                            pid: D.pid,
                          }),
                          c(U));
                      },
                      (D) => f(D, "health-failed"),
                    ));
              }
            }
          };
        if (
          ((u = {
            id: r,
            child: a,
            socketPath: o,
            stopped: !1,
            exitObserved: !1,
            abort: g,
            removeMainListeners: () => {
              (this.childLifecycle.off(a, "message", k, r, "cleanup-off-message"),
                this.childLifecycle.off(a, "error", v, r, "cleanup-off-error"),
                this.childLifecycle.off(a, "exit", S, r, "cleanup-off-exit"));
            },
          }),
          (this.current = u),
          !this.childLifecycle.on(a, "message", k, r, "setup-on-message") ||
            !this.childLifecycle.on(a, "error", v, r, "setup-on-error") ||
            !this.childLifecycle.on(a, "exit", S, r, "setup-on-exit"))
        ) {
          f(
            new Error("Windows Computer Use Helper listener setup failed"),
            "listener-setup",
          );
          return;
        }
        ((p = setTimeout(
          () =>
            f(new Error("Windows Computer Use Helper startup timed out"), "startup-timeout"),
          this.startupTimeoutMs,
        )),
          p.unref?.());
      });
    }
    terminateGeneration(t, n) {
      if (t.terminationPromise) return t.terminationPromise;
      let r = this.terminateGenerationOnce(t, n);
      return ((t.terminationPromise = r), r);
    }
    async terminateGenerationOnce(t, n) {
      try {
        await this.childLifecycle.terminate(t, n, this.shutdownTimeoutMs);
      } catch (r) {
        throw ((this.terminationBlocker = ay(r)), r);
      }
    }
    invalidateForExternalStop(t) {
      if (((this.externalStopEpoch += 1), (this.lastAgentVisibleTransport = null), !t))
        return (
          this.rejectTransportReady(
            new Error("Windows Computer Use Helper startup stopped"),
          ),
          Promise.resolve()
        );
      ((this.handle = null),
        (t.stopped = !0),
        t.abort?.(new Error("Windows Computer Use Helper startup stopped")),
        this.invalidateTransportReady());
      let n = this.terminateGeneration(t, "stop");
      return (n.catch(() => {}), n);
    }
  };

// host 侧镜像 helper 的 pipSessionEventSchema（见 zcode-cua-helper
// src/pip-session/contract.ts）；两份 schema 必须逐字段一致，任何一侧收紧
// 都要先同步另一侧，否则握手成功但事件转发会在 parse 阶段被拒。

var identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.includes("\0"), "identifier cannot contain NUL")
  .refine(
    (value) => value !== CUA_PIP_NO_ACTIVE_SESSION_V2,
    "identifier is reserved by the PiP session runtime",
  );
var sequenceSchema = z.number().int().nonnegative().safe();

var Wh = z.discriminatedUnion("kind", [
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

export function Tae(e) {
  return new Ft(e, {
    code: "version_mismatch",
  });
}

export function S$(e) {
  let t = new Qu(e.socketPath, {
      authenticateParams: {
        role: "presentation",
      },
      timeoutMs: e.timeoutMs ?? 3e3,
      peerChecker: e.peerChecker,
    }),
    n = Math.max(0, e.reconnectAttempts ?? 2),
    r = Math.max(0, e.reconnectDelayMs ?? 50),
    o = !1,
    s = !1,
    a = null,
    c = Promise.resolve(),
    d = !1,
    l = (v) => {
      if (!d) {
        d = !0;
        try {
          e.onDiagnostic?.(v);
        } catch {}
      }
    },
    p = (v) => {
      ((s = !1),
        (a = v),
        l({
          code: "version_mismatch",
          message: v.message,
        }));
    },
    u = async (v, S) => {
      let k;
      for (let C = 0; C <= n; C += 1)
        try {
          return await t.call(v, S);
        } catch (A) {
          if (((k = A), A instanceof Ft && A.code === "version_mismatch")) throw (p(A), A);
          if (!(A instanceof Ft) || A.code !== "broker_unavailable" || C === n)
            throw (
              A instanceof Ft &&
                A.code === "broker_unavailable" &&
                C === n &&
                l({
                  code: "transport_unavailable",
                  message: A.message,
                }),
              A
            );
          r > 0 && (await new Promise((D) => setTimeout(D, r)));
        }
      throw k;
    },
    f = async () => {
      if (o) throw new Error("PiP session client is closed");
      if (a) throw a;
      if (s) return;
      let S = await u("pip_session_handshake", {
        protocolVersion: Uh,
        runtimeId: CUA_PIP_SESSION_PROTOCOL,
      });
      if (S.ready !== !0 || S.protocolVersion !== Uh || S.runtimeId !== CUA_PIP_SESSION_PROTOCOL) {
        let k = Tae(
          "PiP session handshake returned a different protocol/runtime; Auto-PiP is disabled",
        );
        throw (p(k), k);
      }
      s = !0;
    },
    g = (v) => {
      let S = c.then(v, v);
      return (
        (c = S.then(
          () => {},
          () => {},
        )),
        S
      );
    };
  return {
    connect: () => g(f),
    send: (v) =>
      g(async () => {
        if (a) throw a;
        let S = Wh.parse(v);
        return (
          await f(),
          await u("pip_session_event", {
            event: S,
          })
        );
      }),
    get enabled() {
      return !o && a === null;
    },
    close() {
      ((o = !0), (s = !1));
    },
  };
}

S$;

export function Wi(e) {
  return e.kind === "focus-changed"
    ? {
        kind: e.kind,
        revision: e.revision,
        sessionId: e.sessionId,
        sourceWindowId: e.sourceWindowId,
      }
    : {
        eventId: e.eventId,
        kind: e.kind,
        sequenceNumber: e.sequenceNumber,
        sessionId: e.sessionId,
        ...(e.kind === "session-closed"
          ? {}
          : {
              turnId: e.turnId,
            }),
        ...(e.kind === "turn-ended"
          ? {
              outcome: e.outcome,
            }
          : {}),
      };
}
