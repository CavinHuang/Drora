import { execFileSync } from "node:child_process";
import { platform } from "node:os";

var XKB_DIRECT_ENGINE = "xkb:us::eng";
var IBUS_TIMEOUT_MS = 1500;
function readIbusEngine() {
  try {
    const out = execFileSync("ibus", ["engine"], {
      encoding: "utf8",
      timeout: IBUS_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}
function setIbusEngine(engine) {
  try {
    execFileSync("ibus", ["engine", engine], {
      encoding: "utf8",
      timeout: IBUS_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}
function isDirectKeyboardEngine(engine) {
  return engine.startsWith("xkb:");
}
export function withIbusBypassSync(fn) {
  if (platform() !== "linux") return fn();
  const original = readIbusEngine();
  if (!original || isDirectKeyboardEngine(original)) return fn();
  if (!setIbusEngine(XKB_DIRECT_ENGINE)) return fn();
  try {
    return fn();
  } finally {
    setIbusEngine(original);
  }
}
export async function withIbusBypassAsync(fn) {
  if (platform() !== "linux") return fn();
  const original = readIbusEngine();
  if (!original || isDirectKeyboardEngine(original)) return fn();
  if (!setIbusEngine(XKB_DIRECT_ENGINE)) return fn();
  try {
    return await fn();
  } finally {
    setIbusEngine(original);
  }
}
