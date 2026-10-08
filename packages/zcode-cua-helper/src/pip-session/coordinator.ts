import { PIP_SESSION_CAPTURE_PENDING_TTL_MS } from "./contract.js";

export function createPipSessionCoordinator(options) {
  const sessions = /* @__PURE__ */ new Map();
  const seenEventIds = /* @__PURE__ */ new Set();
  const seenEventOrder = [];
  const pendingCaptures = /* @__PURE__ */ new Map();
  const droppedCaptures = /* @__PURE__ */ new Map();
  const DROPPED_CAPTURE_TOMBSTONES = 32;
  const now = options.now ?? Date.now;
  const pendingTtlMs = options.capturePendingTtlMs ?? PIP_SESSION_CAPTURE_PENDING_TTL_MS;
  let activeSessionId = null;
  let focusRevision = -1;
  const pendingKey = (sessionId, turnId) => `${sessionId}\0${turnId}`;
  function rememberEvent(eventId) {
    if (seenEventIds.has(eventId)) return false;
    seenEventIds.add(eventId);
    seenEventOrder.push(eventId);
    while (seenEventOrder.length > 4096) {
      const removed = seenEventOrder.shift();
      if (removed) seenEventIds.delete(removed);
    }
    return true;
  }
  function forgetEvent(eventId) {
    if (!seenEventIds.delete(eventId)) return;
    const index = seenEventOrder.lastIndexOf(eventId);
    if (index >= 0) seenEventOrder.splice(index, 1);
  }
  function sessionFor(sessionId) {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const created = {
      activeTurnId: null,
      lastTerminalTurnId: null,
      lastSequence: -1,
      status: "idle",
    };
    sessions.set(sessionId, created);
    return created;
  }
  function acceptSequence(event) {
    if (!rememberEvent(event.eventId)) {
      return { accepted: false, result: { applied: false, reason: "duplicate" } };
    }
    const session = sessionFor(event.sessionId);
    if (event.sequenceNumber <= session.lastSequence) {
      return {
        accepted: false,
        result: { applied: false, reason: "stale-sequence" },
      };
    }
    return {
      accepted: true,
      session,
      commit: () => {
        session.lastSequence = event.sequenceNumber;
      },
    };
  }
  function rememberDroppedCapture(key, ttlMs) {
    droppedCaptures.set(key, { expiredAt: now(), ttlMs });
    while (droppedCaptures.size > DROPPED_CAPTURE_TOMBSTONES) {
      const oldest = droppedCaptures.keys().next();
      if (oldest.done) break;
      droppedCaptures.delete(oldest.value);
    }
  }
  function flushPending(sessionId, turnId) {
    const key = pendingKey(sessionId, turnId);
    const pending = pendingCaptures.get(key);
    if (!pending) {
      const dropped = droppedCaptures.get(key);
      if (dropped) {
        droppedCaptures.delete(key);
        options.warn?.("PiP turn opened after its capture had already been dropped", {
          sessionId,
          turnId,
          capturePendingTtlMs: dropped.ttlMs,
          // turn 比它自己的 capture 晚了多久。真机实测量级 ~21s（补发迟到 23.1s − TTL 2s）。
          turnLateByMs: now() - dropped.expiredAt,
        });
      }
      return;
    }
    pendingCaptures.delete(key);
    clearTimeout(pending.timer);
    if (pending.expiresAt >= now()) {
      options.effects.captureAccepted(pending);
      return;
    }
    rememberDroppedCapture(key, pendingTtlMs);
    options.warn?.("PiP pending capture was already past its TTL when the turn opened", {
      sessionId,
      turnId,
      capturePendingTtlMs: pendingTtlMs,
      expiredAgoMs: now() - pending.expiresAt,
    });
  }
  function clearPendingForSession(sessionId) {
    const prefix = `${sessionId}\0`;
    for (const [key, pending] of pendingCaptures) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(pending.timer);
      pendingCaptures.delete(key);
    }
  }
  function applyEvent(event) {
    if (event.kind === "focus-changed") {
      if (event.revision <= focusRevision) return { applied: false, reason: "stale-focus" };
      focusRevision = event.revision;
      activeSessionId = event.sessionId;
      options.effects.focusChanged(event);
      return { applied: true, reason: "applied" };
    }
    const admitted = acceptSequence(event);
    if (!admitted.accepted) return admitted.result;
    const session = admitted.session;
    if (session.status === "closed") {
      admitted.commit();
      return { applied: false, reason: "session-closed" };
    }
    if (event.kind === "turn-started") {
      if (session.lastTerminalTurnId === event.turnId) {
        admitted.commit();
        return { applied: false, reason: "turn-mismatch" };
      }
      if (session.status === "running" && session.activeTurnId === event.turnId) {
        admitted.commit();
        return { applied: true, reason: "applied" };
      }
      const resetApplied = options.effects.turnStarted(event);
      if (resetApplied === false) {
        forgetEvent(event.eventId);
        return { applied: false, reason: "native-reset-failed" };
      }
      admitted.commit();
      session.activeTurnId = event.turnId;
      session.status = "running";
      flushPending(event.sessionId, event.turnId);
      return { applied: true, reason: "applied" };
    }
    if (event.kind === "turn-ended") {
      if (session.activeTurnId !== event.turnId) {
        admitted.commit();
        return { applied: false, reason: "turn-mismatch" };
      }
      admitted.commit();
      session.status = event.outcome;
      session.activeTurnId = null;
      session.lastTerminalTurnId = event.turnId;
      options.effects.turnEnded({
        ...event,
        visible: activeSessionId === event.sessionId,
      });
      return { applied: true, reason: "applied" };
    }
    session.activeTurnId = null;
    session.status = "closed";
    admitted.commit();
    clearPendingForSession(event.sessionId);
    options.effects.sessionClosed({ sessionId: event.sessionId, showSuccess: false });
    return { applied: true, reason: "applied" };
  }
  function bindCapture(binding) {
    const session = sessions.get(binding.sessionId);
    if (session?.status === "closed") {
      return { applied: false, reason: "session-closed" };
    }
    if (session?.lastTerminalTurnId === binding.turnId) {
      return { applied: false, reason: "turn-mismatch" };
    }
    if (session?.status === "running") {
      if (session.activeTurnId !== binding.turnId) {
        return { applied: false, reason: "turn-mismatch" };
      }
      options.effects.captureAccepted(binding);
      return { applied: true, reason: "applied" };
    }
    if (session?.activeTurnId && session.activeTurnId !== binding.turnId) {
      return { applied: false, reason: "turn-mismatch" };
    }
    const record2 = sessionFor(binding.sessionId);
    const openApplied = options.effects.turnStarted({
      sessionId: binding.sessionId,
      turnId: binding.turnId,
    });
    if (openApplied !== false) {
      record2.activeTurnId = binding.turnId;
      record2.status = "running";
      options.effects.captureAccepted(binding);
      return { applied: true, reason: "applied" };
    }
    const key = pendingKey(binding.sessionId, binding.turnId);
    const previous = pendingCaptures.get(key);
    if (previous) clearTimeout(previous.timer);
    const expiresAt = now() + pendingTtlMs;
    const timer = setTimeout(() => {
      const current = pendingCaptures.get(key);
      if (current?.expiresAt !== expiresAt) return;
      pendingCaptures.delete(key);
      rememberDroppedCapture(key, pendingTtlMs);
      options.warn?.("PiP pending capture expired before its turn opened", {
        sessionId: binding.sessionId,
        turnId: binding.turnId,
        windowId: binding.target.windowId,
        presentationWindowId: binding.target.presentationWindowId,
        capturePendingTtlMs: pendingTtlMs,
      });
    }, pendingTtlMs);
    pendingCaptures.set(key, { ...binding, expiresAt, timer });
    return { applied: false, reason: "pending-turn" };
  }
  return {
    applyEvent,
    bindCapture,
    snapshot: () => ({
      activeSessionId,
      focusRevision,
      sessions: [...sessions.entries()].map(([sessionId, session]) => ({
        sessionId,
        ...session,
      })),
    }),
    dispose: () => {
      for (const pending of pendingCaptures.values()) clearTimeout(pending.timer);
      pendingCaptures.clear();
    },
  };
}
