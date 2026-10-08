var PIP_RETRY_DELAYS_MS = [250, 1e3, 2e3, 1e3];
var PIP_INTERACTION_READY_POLL_MS = 50;
var PIP_INTERACTION_READY_TIMEOUT_MS = 3600;
var PIP_START_SETTLE_TIMEOUT_MS = 4e3;
function decidePipAction(current, next) {
  if (!next) {
    return current ? { kind: "stop" } : { kind: "skip" };
  }
  if (
    current &&
    current.windowId === next.windowId &&
    current.pid === next.pid &&
    (current.bundleId ?? null) === (next.bundleId ?? null)
  ) {
    return { kind: "skip" };
  }
  return { kind: "restart" };
}
function pipTargetsEqual(a, b) {
  if (!a || !b) return a === b;
  return (
    a.windowId === b.windowId && a.pid === b.pid && (a.bundleId ?? null) === (b.bundleId ?? null)
  );
}
function pipPresentationsEqual(a, b) {
  if (!a || !b) return a === b;
  return (
    (a.presentationWindowId ?? a.windowId) === (b.presentationWindowId ?? b.windowId) &&
    a.pid === b.pid &&
    (a.bundleId ?? null) === (b.bundleId ?? null)
  );
}
export function createPipAutoStarter(adapter) {
  let current = null;
  let pending = null;
  let desired = null;
  let retryAttempt = 0;
  let retryTimer = null;
  let readinessTimer = null;
  let startFenceTimer = null;
  let seq = 0;
  const cancelRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const cancelReadiness = () => {
    if (readinessTimer !== null) clearTimeout(readinessTimer);
    readinessTimer = null;
  };
  const cancelStartFence = () => {
    if (startFenceTimer !== null) clearTimeout(startFenceTimer);
    startFenceTimer = null;
  };
  const stop = () => {
    try {
      adapter.pipStop?.();
    } catch {}
  };
  const nativeRunning = () => {
    try {
      return typeof adapter.pipIsRunning === "function" ? adapter.pipIsRunning() === true : true;
    } catch {
      return false;
    }
  };
  const nativeInteractionReady = () => {
    try {
      return typeof adapter.pipIsInteractionReady === "function"
        ? adapter.pipIsInteractionReady() === true
        : nativeRunning();
    } catch {
      return false;
    }
  };
  const userDismissed = () => {
    try {
      return typeof adapter.pipIsDismissed === "function"
        ? adapter.pipIsDismissed() === true
        : false;
    } catch {
      return false;
    }
  };
  const start = (target) => {
    cancelRetry();
    cancelReadiness();
    cancelStartFence();
    const mySeq = ++seq;
    pending = target;
    const settle = (committed) => {
      if (mySeq !== seq) return;
      cancelStartFence();
      cancelReadiness();
      pending = null;
      if (committed) {
        current = target;
        retryAttempt = 0;
        return;
      }
      if (
        !pipTargetsEqual(desired, target) ||
        userDismissed() ||
        retryAttempt >= PIP_RETRY_DELAYS_MS.length
      ) {
        return;
      }
      const delay = PIP_RETRY_DELAYS_MS[retryAttempt++];
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (pipTargetsEqual(desired, target) && !current && !pending && !userDismissed()) {
          start(target);
        }
      }, delay);
    };
    const waitUntilInteractionReady = () => {
      const deadline = Date.now() + PIP_INTERACTION_READY_TIMEOUT_MS;
      const poll = () => {
        if (mySeq !== seq) return;
        readinessTimer = null;
        if (!pipTargetsEqual(desired, target) || userDismissed()) {
          settle(false);
          return;
        }
        if (!nativeRunning()) {
          settle(false);
          return;
        }
        if (nativeInteractionReady()) {
          settle(true);
          return;
        }
        if (Date.now() >= deadline) {
          stop();
          settle(false);
          return;
        }
        readinessTimer = setTimeout(poll, PIP_INTERACTION_READY_POLL_MS);
      };
      poll();
    };
    try {
      if (target.bundleId && adapter.pipStartVerifiedComposite) {
        startFenceTimer = setTimeout(() => {
          if (mySeq !== seq || !pipTargetsEqual(pending, target)) return;
          stop();
          settle(false);
          if (mySeq === seq) seq++;
        }, PIP_START_SETTLE_TIMEOUT_MS);
        const startPromise = adapter.pipStartVerifiedComposite(
          target.presentationWindowId ?? target.windowId,
          target.windowId,
          target.pid,
          target.bundleId,
        );
        Promise.resolve(startPromise)
          .then((ok) => {
            if (mySeq !== seq) return;
            cancelStartFence();
            if (ok === true) waitUntilInteractionReady();
            else settle(false);
          })
          .catch(() => settle(false));
        return;
      }
      settle(false);
    } catch {
      settle(false);
    }
  };
  return {
    onCaptureWindow: (target) => {
      if (target?.pid === process.pid) target = null;
      const targetChanged = !pipTargetsEqual(desired, target);
      desired = target;
      if (targetChanged) {
        cancelRetry();
        cancelReadiness();
        cancelStartFence();
        retryAttempt = 0;
      }
      if (target && userDismissed()) {
        cancelRetry();
        cancelReadiness();
        cancelStartFence();
        seq++;
        current = null;
        pending = null;
        return;
      }
      if (target && pipTargetsEqual(pending, target)) return;
      if (
        target &&
        current &&
        !pipTargetsEqual(current, target) &&
        pipPresentationsEqual(current, target) &&
        adapter.pipStartVerifiedComposite
      ) {
        start(target);
        return;
      }
      if (!target && pending) {
        cancelRetry();
        cancelReadiness();
        cancelStartFence();
        stop();
        seq++;
        current = null;
        pending = null;
        return;
      }
      if (target && pipTargetsEqual(current, target) && !nativeRunning()) {
        current = null;
      }
      const action = decidePipAction(current, target);
      if (action.kind === "skip") return;
      const stopIfAny = () => {
        if (current || pending) stop();
      };
      if (action.kind === "stop") {
        cancelRetry();
        cancelReadiness();
        cancelStartFence();
        stopIfAny();
        seq++;
        current = null;
        pending = null;
        return;
      }
      stopIfAny();
      current = null;
      pending = null;
      if (!target) return;
      start(target);
    },
    getCurrentTarget: () => current,
    getPendingTarget: () => pending,
  };
}
