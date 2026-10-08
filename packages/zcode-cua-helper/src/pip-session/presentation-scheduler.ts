import { PIP_SESSION_HIDDEN_GROUP_ID } from "./contract.js";

var DEFAULT_RETRY_DELAYS_MS = [250, 1e3, 2e3, 1e3];
var DEFAULT_MAX_QUEUED_CAPTURES = 64;
function captureKey(binding) {
  const presentationWindowId = binding.target.presentationWindowId ?? binding.target.windowId;
  return [binding.sessionId, binding.turnId, binding.target.pid, presentationWindowId].join("\0");
}
function toStartTarget(binding) {
  return {
    sessionId: binding.sessionId,
    turnId: binding.turnId,
    windowId: binding.target.windowId,
    presentationWindowId: binding.target.presentationWindowId ?? binding.target.windowId,
    pid: binding.target.pid,
    bundleId: binding.target.bundleId,
  };
}
function captureOperation(binding) {
  let interrupt;
  const interrupted = new Promise((resolve2) => {
    interrupt = resolve2;
  });
  return {
    kind: "capture",
    key: captureKey(binding),
    target: toStartTarget(binding),
    cancelled: false,
    interrupted,
    interrupt,
  };
}
export function createPipPresentationScheduler(options) {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maxQueuedCaptures = Math.max(1, options.maxQueuedCaptures ?? DEFAULT_MAX_QUEUED_CAPTURES);
  const sleep =
    options.sleep ??
    ((delayMs) =>
      new Promise((resolve2) => {
        const timer = setTimeout(resolve2, delayMs);
        timer.unref?.();
      }));
  const queue = [];
  const pendingCaptures = /* @__PURE__ */ new Map();
  const sessions = /* @__PURE__ */ new Map();
  const idleWaiters = /* @__PURE__ */ new Set<any>();
  let activeSessionId = null;
  let activeCapture = null;
  let draining = false;
  let disposed = false;
  const resolveIdle = () => {
    if (draining || queue.length > 0) return;
    for (const resolve2 of idleWaiters) resolve2();
    idleWaiters.clear();
  };
  const removePendingCapture = (operation) => {
    if (pendingCaptures.get(operation.key) === operation) {
      pendingCaptures.delete(operation.key);
    }
  };
  const cancelQueuedCaptures = (matches) => {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const operation = queue[index];
      if (operation?.kind !== "capture" || !matches(operation)) continue;
      operation.cancelled = true;
      removePendingCapture(operation);
      queue.splice(index, 1);
    }
    if (activeCapture && matches(activeCapture)) {
      activeCapture.cancelled = true;
      return activeCapture;
    }
    return null;
  };
  const removeQueuedTerminalForSession = (sessionId) => {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const operation = queue[index];
      if (operation?.kind !== "terminal" || operation.sessionId !== sessionId) continue;
      queue.splice(index, 1);
    }
  };
  const dropOverflowCapture = () => {
    const captures = queue.filter(
      (operation) => operation.kind === "capture" && !operation.cancelled,
    );
    if (captures.length <= maxQueuedCaptures) return;
    const dropped =
      captures.find((operation) => operation.target.sessionId !== activeSessionId) ?? captures[0];
    if (!dropped) return;
    dropped.cancelled = true;
    removePendingCapture(dropped);
    const index = queue.indexOf(dropped);
    if (index >= 0) queue.splice(index, 1);
    options.onCaptureDropped?.(dropped.target);
    options.warn?.("PiP presentation capture queue overflowed", {
      sessionId: dropped.target.sessionId,
      presentationWindowId: dropped.target.presentationWindowId,
    });
  };
  const startCapture = async (operation) => {
    for (let attempt = 0; ; attempt += 1) {
      if (disposed || operation.cancelled) return;
      let started = false;
      const nativeAttempt = Promise.resolve()
        .then(() => options.native.startComposite(operation.target))
        .then(
          (value) => ({ kind: "settled", started: value === true }),
          (error51) => ({ kind: "failed", error: error51 }),
        );
      const result = await Promise.race([
        nativeAttempt,
        operation.interrupted.then(() => ({ kind: "interrupted" })),
      ]);
      if (result.kind === "interrupted") return;
      if (result.kind === "failed") {
        options.debug?.("PiP native presentation start rejected", {
          attempt,
          error: result.error instanceof Error ? result.error.name : "UnknownError",
          presentationWindowId: operation.target.presentationWindowId,
        });
      } else {
        started = result.started;
      }
      if (started) return;
      if (disposed || operation.cancelled) return;
      if (attempt >= retryDelaysMs.length) {
        options.warn?.("PiP native presentation start exhausted retries", {
          sessionId: operation.target.sessionId,
          presentationWindowId: operation.target.presentationWindowId,
        });
        return;
      }
      await sleep(Math.max(0, retryDelaysMs[attempt] ?? 0));
    }
  };
  const execute = async (operation) => {
    switch (operation.kind) {
      case "capture":
        if (operation.cancelled) return;
        activeCapture = operation;
        try {
          await startCapture(operation);
        } finally {
          activeCapture = null;
        }
        return;
      case "terminal":
        options.native.taskCompleted(operation.sessionId, operation.outcome === "completed");
        return;
      case "close":
        options.native.freezeGroup(operation.sessionId);
    }
  };
  const drain = async () => {
    if (draining || disposed) return;
    draining = true;
    try {
      while (!disposed && queue.length > 0) {
        const operation = queue.shift();
        if (!operation) continue;
        if (operation.kind === "capture") removePendingCapture(operation);
        try {
          await execute(operation);
        } catch (error51) {
          const sessionId =
            operation.kind === "capture" ? operation.target.sessionId : operation.sessionId;
          const turnId =
            operation.kind === "capture"
              ? operation.target.turnId
              : operation.kind === "close"
                ? void 0
                : operation.turnId;
          options.warn?.("PiP presentation lifecycle operation failed", {
            kind: operation.kind,
            sessionId,
            ...(turnId ? { turnId } : {}),
            ...(operation.kind === "capture"
              ? {
                  presentationWindowId: operation.target.presentationWindowId,
                }
              : {}),
            error: error51 instanceof Error ? error51.name : "UnknownError",
          });
        }
      }
    } finally {
      draining = false;
      resolveIdle();
      if (!disposed && queue.length > 0) void drain();
    }
  };
  const enqueue = (operation) => {
    if (disposed) return;
    queue.push(operation);
    if (operation.kind === "capture") {
      pendingCaptures.set(operation.key, operation);
      dropOverflowCapture();
    }
    void drain();
  };
  return {
    focusChanged(event) {
      if (disposed) return;
      activeSessionId = event.sessionId;
      try {
        options.native.setActiveGroup(event.sessionId ?? PIP_SESSION_HIDDEN_GROUP_ID);
      } catch (error51) {
        options.warn?.("PiP presentation focus operation failed", {
          error: error51 instanceof Error ? error51.name : "UnknownError",
        });
      }
    },
    turnStarted(event) {
      if (disposed) return false;
      const supersededCapture = cancelQueuedCaptures(
        (operation) => operation.target.sessionId === event.sessionId,
      );
      removeQueuedTerminalForSession(event.sessionId);
      try {
        options.native.beginTurn(event.sessionId);
        supersededCapture?.interrupt();
        sessions.set(event.sessionId, { turnId: event.turnId, state: "running" });
        options.info?.("PiP presentation turn reset applied", {
          sessionId: event.sessionId,
          turnId: event.turnId,
          supersededCapture: supersededCapture !== null,
        });
        return true;
      } catch (error51) {
        supersededCapture?.interrupt();
        options.warn?.("PiP presentation lifecycle operation failed", {
          kind: "begin-turn",
          sessionId: event.sessionId,
          turnId: event.turnId,
          error: error51 instanceof Error ? error51.name : "UnknownError",
        });
        return false;
      }
    },
    turnEnded(event) {
      if (disposed) return;
      const session = sessions.get(event.sessionId);
      if (!session || session.turnId !== event.turnId) return;
      session.state = event.outcome;
      if (event.outcome === "failed") {
        cancelQueuedCaptures(
          (operation) =>
            operation.target.sessionId === event.sessionId &&
            operation.target.turnId === event.turnId,
        );
      }
      enqueue({
        kind: "terminal",
        sessionId: event.sessionId,
        turnId: event.turnId,
        outcome: event.outcome,
      });
    },
    sessionClosed(event) {
      if (disposed) return;
      sessions.delete(event.sessionId);
      cancelQueuedCaptures((operation) => operation.target.sessionId === event.sessionId);
      enqueue({ kind: "close", sessionId: event.sessionId });
    },
    captureAccepted(binding) {
      if (disposed) {
        options.warn?.("PiP presentation capture dropped: scheduler disposed", {
          sessionId: binding.sessionId,
          turnId: binding.turnId,
        });
        return;
      }
      const session = sessions.get(binding.sessionId);
      if (!session) {
        options.warn?.("PiP presentation capture dropped: no such session", {
          sessionId: binding.sessionId,
          turnId: binding.turnId,
        });
        return;
      }
      if (session.state !== "running") {
        options.warn?.("PiP presentation capture dropped: session not running", {
          sessionId: binding.sessionId,
          turnId: binding.turnId,
          sessionState: session.state,
        });
        return;
      }
      if (session.turnId !== binding.turnId) {
        options.warn?.("PiP presentation capture dropped: turn mismatch", {
          sessionId: binding.sessionId,
          schedulerTurnId: session.turnId,
          bindingTurnId: binding.turnId,
        });
        return;
      }
      const key = captureKey(binding);
      const queued = pendingCaptures.get(key);
      if (queued) {
        queued.target = toStartTarget(binding);
        options.debug?.("PiP presentation capture coalesced", {
          sessionId: binding.sessionId,
          presentationWindowId: queued.target.presentationWindowId,
        });
        return;
      }
      enqueue(captureOperation(binding));
    },
    idle() {
      if (!draining && queue.length === 0) return Promise.resolve();
      return new Promise((resolve2) => idleWaiters.add(resolve2));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (activeCapture) activeCapture.cancelled = true;
      for (const operation of queue) {
        if (operation.kind === "capture") operation.cancelled = true;
      }
      queue.length = 0;
      pendingCaptures.clear();
      sessions.clear();
      resolveIdle();
    },
  };
}
