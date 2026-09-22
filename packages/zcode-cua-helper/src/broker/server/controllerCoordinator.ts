// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
// controller 仲裁协调器：租约 + 视觉开关 + takeover 生命周期。

import { controllerBusy } from "../types.js";

function controllerSourceName(owner) {
  switch (owner.variant) {
    case "stable":
      return "ZCode";
    case "preview":
      return "ZCode Preview";
    case "dev-desktop":
      return "ZCode Dev";
    case "standalone":
      return "Standalone";
    default:
      return owner.appIdentity.name ?? owner.variant;
  }
}
function publicOwner(owner) {
  return {
    variant: owner.variant,
    pid: owner.pid,
    version: owner.version,
    display_name: controllerSourceName(owner),
    bundle_id: owner.appIdentity.bundleId ?? null,
  };
}
export function createCuaControllerCoordinator(options) {
  let handle = null;
  let visualsEnabled = false;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((durationMs) => new Promise((resolve3) => setTimeout(resolve3, durationMs)));
  const terminateOwner = options.terminateOwner ?? ((pid) => process.kill(pid, "SIGTERM"));
  function enableVisuals() {
    if (visualsEnabled) return;
    const source = controllerSourceName(options.owner);
    options.visuals.ghostSetControllerStatus?.(
      `ZCode Computer Use \xB7 ${source} v${options.owner.version} \xB7 PID ${options.owner.pid}`,
    );
    if (options.wantsGhostCursor) options.visuals.ghostSetEnabled?.(true);
    if (options.wantsGhostCapture) options.visuals.ghostSetCapture?.(true);
    visualsEnabled = true;
  }
  async function release() {
    if (visualsEnabled) {
      options.visuals.ghostHide?.();
      options.visuals.ghostSetCapture?.(false);
      options.visuals.ghostSetEnabled?.(false);
      options.visuals.ghostSetControllerStatus?.(null);
      visualsEnabled = false;
    }
    const held = handle;
    handle = null;
    await held?.release();
  }
  async function acquireOrThrow() {
    if (handle) return;
    const result = await options.lease.acquire(options.owner);
    if (result.state === "acquired" || result.state === "reentrant") {
      handle = result;
      enableVisuals();
      return;
    }
    if (result.state === "busy") {
      throw controllerBusy(
        `CUA_CONTROLLER_BUSY: controlled by ${controllerSourceName(result.owner)} ${result.owner.version}, pid=${result.owner.pid}. action_sent=false.`,
        { action_sent: false, controller: publicOwner(result.owner) },
      );
    }
    if (result.state === "blocked") {
      throw controllerBusy(
        `CUA_CONTROLLER_BUSY: controller ownership could not be established (${result.reason}). action_sent=false.`,
        { action_sent: false, reason: result.reason },
      );
    }
    throw controllerBusy(
      "CUA_CONTROLLER_BUSY: controller admission did not converge. action_sent=false.",
      { action_sent: false },
    );
  }
  return {
    ownsLease: () => handle !== null,
    admitAction: acquireOrThrow,
    async status() {
      const leaseStatus = await options.lease.status({
        pid: options.owner.pid,
        processIdentity: handle?.owner.processIdentity,
      });
      if (leaseStatus.state === "owned") {
        return {
          state: leaseStatus.relationship === "same" ? "controller" : "observer",
          owner: publicOwner(leaseStatus.owner),
        };
      }
      return {
        state: leaseStatus.state,
        ...(leaseStatus.state === "blocked" ? { reason: leaseStatus.reason } : {}),
      };
    },
    async takeover() {
      const current = await options.lease.status();
      if (current.state === "owned" && current.owner.pid !== options.owner.pid) {
        const evidence = options.helperPidEvidence(current.owner.pid, {
          socketPath: current.owner.socketPath,
          helperAppPath: current.owner.helperPath,
        });
        if (evidence.state !== "helper") {
          throw controllerBusy(
            `CUA_CONTROLLER_BUSY: current controller identity could not be safely stopped (${evidence.state}). action_sent=false.`,
            { action_sent: false, reason: `owner_${evidence.state}` },
          );
        }
        await terminateOwner(current.owner.pid);
      }
      const deadline = now() + (options.takeoverTimeoutMs ?? 8e3);
      while (now() < deadline) {
        const result = await options.lease.acquire(options.owner);
        if (result.state === "acquired" || result.state === "reentrant") {
          handle = result;
          enableVisuals();
          return { ok: true, controller: publicOwner(result.owner) };
        }
        if (result.state === "blocked" && result.reason !== "lease_reclaim_in_progress") {
          throw controllerBusy(
            `CUA_CONTROLLER_BUSY: takeover could not establish ownership (${result.reason}). action_sent=false.`,
            { action_sent: false, reason: result.reason },
          );
        }
        await sleep(100);
      }
      throw controllerBusy(
        "CUA_CONTROLLER_BUSY: timed out waiting for the previous controller to stop. action_sent=false.",
        { action_sent: false, reason: "takeover_timeout" },
      );
    },
    async stop() {
      await release();
      return { ok: true };
    },
    release,
  };
}
