var DEFAULT_LAUNCHER_WATCHDOG_INTERVAL_MS = 5e3;
function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error51) {
    return error51.code === "EPERM";
  }
}
export function startLauncherLivenessWatchdog(launcherPid, onLauncherGone, options: any = {}) {
  const intervalMs: any = options.intervalMs ?? DEFAULT_LAUNCHER_WATCHDOG_INTERVAL_MS;
  const isProcessAlive: any = options.isProcessAlive ?? defaultIsProcessAlive;
  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    if (!isProcessAlive(launcherPid)) {
      fired = true;
      clearInterval(timer);
      onLauncherGone();
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

export function parseLauncherPid(raw) {
  if (raw === void 0) return null;
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}
export function parseStartupTtlMs(raw) {
  if (raw === void 0) return void 0;
  const ms = Number(raw);
  return Number.isInteger(ms) && ms >= 0 ? ms : void 0;
}
