// oxlint-disable-file
// 还原自原版 helper SEA payload（未混淆 esbuild bundle，模块边界注释保留原始路径）。
// controller 租约文件（controller-lease.json）的获取/续期/抢占。
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import process from "node:process";
import { brokerRuntimeDir } from "../socketPath.js";

var LEASE_FILE_NAME = "controller-lease.json";
var RECLAIM_LOCK_DIR_NAME = ".controller-lease-reclaim.lock";
var LEASE_SCHEMA = 1;
var MAX_LEASE_BYTES = 8192;
function defaultIsProcessAlive2(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error51) {
    return error51.code === "EPERM";
  }
}
function defaultProcessIdentityForPid(pid) {
  if (process.platform === "win32") {
    return pid === process.pid ? `win32:${pid}:${process.execPath}` : null;
  }
  try {
    const output = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart=", "-o", "comm="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1e3,
      maxBuffer: 8192,
    }).trim();
    return output ? `${process.platform}:${pid}:${output}` : null;
  } catch {
    return null;
  }
}
function positivePid(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function normalizeOptionalString(value) {
  if (value === null || value === void 0) return value;
  if (typeof value !== "string") return void 0;
  return value;
}
function parseOwner(value) {
  if (typeof value !== "object" || value === null) return null;
  const record2 = value;
  const appIdentity = record2.appIdentity;
  if (typeof appIdentity !== "object" || appIdentity === null) return null;
  const app = appIdentity;
  const bundleId = normalizeOptionalString(app.bundleId);
  const name = normalizeOptionalString(app.name);
  const teamId = normalizeOptionalString(app.teamId);
  if (bundleId === void 0 || name === void 0 || teamId === void 0) {
    return null;
  }
  if (
    record2.schema !== LEASE_SCHEMA ||
    !positivePid(record2.pid) ||
    !nonEmptyString(record2.processIdentity) ||
    !nonEmptyString(record2.variant) ||
    !nonEmptyString(record2.version) ||
    !positivePid(record2.startedAtEpochMs) ||
    !nonEmptyString(record2.socketPath) ||
    !nonEmptyString(record2.helperPath)
  ) {
    return null;
  }
  return {
    schema: LEASE_SCHEMA,
    pid: record2.pid,
    processIdentity: record2.processIdentity,
    appIdentity: { bundleId, name, teamId },
    variant: record2.variant,
    version: record2.version,
    startedAtEpochMs: record2.startedAtEpochMs,
    socketPath: record2.socketPath,
    helperPath: record2.helperPath,
  };
}
function stableJson(owner) {
  return `${JSON.stringify(owner, null, 2)}
`;
}
function sameOwner(owner, perspective) {
  return owner.pid === perspective?.pid && owner.processIdentity === perspective.processIdentity;
}
async function ensurePrivateRuntimeDir(runtimeDir, currentUid, platform2) {
  await mkdir(runtimeDir, { recursive: true, mode: 448 });
  const stat2 = await lstat(runtimeDir);
  if (!stat2.isDirectory()) return "runtime_not_directory";
  if (stat2.isSymbolicLink()) return "runtime_symlink";
  if (currentUid !== null && stat2.uid !== currentUid) {
    return "runtime_owner_mismatch";
  }
  if (platform2 !== "win32" && (stat2.mode & 63) !== 0) {
    return "runtime_not_private";
  }
  return null;
}
async function readOwnerFile(leasePath, currentUid, platform2) {
  let stat2;
  try {
    stat2 = await lstat(leasePath);
  } catch (error51) {
    if (error51.code === "ENOENT") {
      return { state: "missing" };
    }
    return { state: "blocked", reason: "lease_lstat_failed" };
  }
  if (!stat2.isFile()) return { state: "blocked", reason: "lease_not_regular" };
  if (currentUid !== null && stat2.uid !== currentUid) {
    return { state: "blocked", reason: "lease_owner_mismatch" };
  }
  if (platform2 !== "win32" && (stat2.mode & 18) !== 0) {
    return { state: "blocked", reason: "lease_writable_by_group_or_world" };
  }
  if (stat2.size > MAX_LEASE_BYTES) {
    return { state: "blocked", reason: "lease_too_large" };
  }
  let handle;
  try {
    handle = await open(leasePath, "r");
    const openStat = await handle.stat();
    if (openStat.dev !== stat2.dev || openStat.ino !== stat2.ino) {
      return { state: "blocked", reason: "lease_replaced_while_opening" };
    }
    const raw = await handle.readFile({ encoding: "utf8" });
    const parsed = parseOwner(JSON.parse(raw));
    if (!parsed) return { state: "blocked", reason: "lease_invalid_shape" };
    return { state: "ok", owner: parsed };
  } catch (error51) {
    if (error51 instanceof SyntaxError) {
      return { state: "blocked", reason: "lease_invalid_json" };
    }
    return { state: "blocked", reason: "lease_read_failed" };
  } finally {
    await handle?.close().catch(() => {});
  }
}
function materializeOwner(input, deps) {
  const processIdentity = input.processIdentity ?? deps.processIdentityForPid(input.pid);
  const owner = parseOwner({
    ...input,
    schema: LEASE_SCHEMA,
    processIdentity,
    startedAtEpochMs: input.startedAtEpochMs ?? deps.now(),
  });
  return owner;
}
async function acquireReclaimLock(runtimeDir, mintId, currentPid, isProcessAlive) {
  const lockDir = join(runtimeDir, RECLAIM_LOCK_DIR_NAME);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDir, { mode: 448 });
      await writeFile(
        join(lockDir, "owner"),
        `${currentPid}:${mintId()}
`,
        {
          encoding: "utf8",
          mode: 384,
          flag: "wx",
        },
      );
      return {
        release: async () => {
          await rm(lockDir, { recursive: true, force: true });
        },
      };
    } catch (error51) {
      if (error51.code !== "EEXIST") throw error51;
      if (attempt > 0) return null;
      try {
        const rawOwner = await readFile(join(lockDir, "owner"), "utf8");
        const lockPid = Number.parseInt(rawOwner.split(":", 1)[0] ?? "", 10);
        if (!positivePid(lockPid) || isProcessAlive(lockPid)) return null;
        await rm(lockDir, { recursive: true, force: true });
      } catch {
        return null;
      }
    }
  }
  return null;
}
export function createCuaControllerLease(options: any = {}) {
  options = options ?? {};
  const env = options.env ?? process.env;
  const runtimeDir = options.runtimeDir ?? brokerRuntimeDir(env);
  const leasePath = join(runtimeDir, LEASE_FILE_NAME);
  const currentUid =
    options.currentUid ?? (typeof process.getuid === "function" ? process.getuid() : null);
  const currentPid = options.currentPid ?? process.pid;
  const platform2 = options.platform ?? process.platform;
  const now = options.now ?? Date.now;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive2;
  const processIdentityForPid = options.processIdentityForPid ?? defaultProcessIdentityForPid;
  const mintId = options.mintId ?? randomUUID;
  async function status(perspective) {
    const dirProblem = await ensurePrivateRuntimeDir(runtimeDir, currentUid, platform2);
    if (dirProblem) return { state: "blocked", reason: dirProblem };
    const read = await readOwnerFile(leasePath, currentUid, platform2);
    if (read.state === "missing") return { state: "free" };
    if (read.state === "blocked") return read;
    let live = false;
    try {
      live = isProcessAlive(read.owner.pid);
    } catch {
      return {
        state: "blocked",
        reason: "owner_liveness_unknown",
        owner: read.owner,
      };
    }
    if (!live) return { state: "stale", owner: read.owner };
    const liveIdentity = processIdentityForPid(read.owner.pid);
    if (liveIdentity !== null && liveIdentity !== read.owner.processIdentity) {
      return { state: "stale", owner: read.owner };
    }
    return {
      state: "owned",
      relationship: sameOwner(read.owner, perspective) ? "same" : "other",
      owner: read.owner,
    };
  }
  async function writeFreshOwner(owner) {
    try {
      await writeFile(leasePath, stableJson(owner), {
        encoding: "utf8",
        mode: 384,
        flag: "wx",
      });
      return "created";
    } catch (error51) {
      if (error51.code === "EEXIST") return "exists";
      throw error51;
    }
  }
  async function acquire(input) {
    const owner = materializeOwner(input, {
      currentPid,
      now,
      processIdentityForPid,
    });
    if (!owner) {
      return { state: "blocked", reason: "invalid_owner_metadata" };
    }
    const perspective = {
      pid: owner.pid,
      processIdentity: owner.processIdentity,
    };
    const dirProblem = await ensurePrivateRuntimeDir(runtimeDir, currentUid, platform2);
    if (dirProblem) return { state: "blocked", reason: dirProblem };
    if ((await writeFreshOwner(owner)) === "created") {
      return {
        state: "acquired",
        owner,
        release: () => release(perspective),
      };
    }
    const current = await status(perspective);
    if (current.state === "owned" && (current as any).relationship === "same") {
      return {
        state: "reentrant",
        owner: current.owner,
        release: () => release(perspective),
      };
    }
    if (current.state === "owned") {
      return { state: "busy", owner: current.owner };
    }
    if (current.state === "blocked") return current;
    if (current.state === "free") {
      return { state: "blocked", reason: "lease_raced_during_acquire" };
    }
    const reclaimLock = await acquireReclaimLock(runtimeDir, mintId, currentPid, isProcessAlive);
    if (!reclaimLock) {
      return {
        state: "blocked",
        reason: "lease_reclaim_in_progress",
        owner: current.owner,
      };
    }
    try {
      const checked = await status(perspective);
      if (checked.state === "owned" && (checked as any).relationship === "same") {
        return {
          state: "reentrant",
          owner: checked.owner,
          release: () => release(perspective),
        };
      }
      if (checked.state === "owned") return { state: "busy", owner: checked.owner };
      if (checked.state === "blocked") return checked;
      if (checked.state === "stale") {
        await rm(leasePath, { force: true });
        if ((await writeFreshOwner(owner)) === "created") {
          return {
            state: "acquired",
            owner,
            release: () => release(perspective),
          };
        }
        return { state: "blocked", reason: "lease_raced_during_reclaim" };
      }
      if ((await writeFreshOwner(owner)) === "created") {
        return {
          state: "acquired",
          owner,
          release: () => release(perspective),
        };
      }
      return { state: "blocked", reason: "lease_raced_during_reclaim" };
    } finally {
      await reclaimLock.release();
    }
  }
  async function release(
    perspective = {
      pid: currentPid,
      processIdentity: processIdentityForPid(currentPid) ?? void 0,
    },
  ) {
    const current = await status(perspective);
    if (current.state === "free") return { released: false, reason: "free" };
    if (current.state === "blocked") {
      return {
        released: false,
        reason: "blocked",
        detail: current.reason,
        owner: current.owner,
      };
    }
    if (current.state === "stale" || (current as any).relationship === "other") {
      return {
        released: false,
        reason: "not_owner",
        owner: current.owner,
      };
    }
    await rm(leasePath, { force: true });
    return { released: true };
  }
  return { leasePath, acquire, status, release };
}
