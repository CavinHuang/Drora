// oxlint-disable-file
// 还原草稿：仅供继续手工重建参考，不参与编译
import { CUA_DEV_TIMEOUT_MS, HELPER_BUNDLE_ID_VALUE, dn } from "./region-constants.js";

import {
  basename as Bre,
  basename as rKe,
  dirname as kz,
  isAbsolute as Pz,
  join as KC,
  join as ks,
  relative,
  resolve as Cz,
} from "node:path";
import {
  chmod as yz,
  mkdir as wz,
  open as Tre,
  realpath as eKe,
  realpath as vz,
  rm as Fre,
  rm as tKe,
} from "node:fs/promises";
import { execFile as Nz } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync as Lz,
  existsSync as Nre,
  readFileSync as jre,
  realpathSync as Sz,
  rmSync as Kre,
  writeFileSync as Lre,
  writeFileSync as Xje,
} from "node:fs";
import { randomUUID as Dre } from "node:crypto";
import { CuaHelperError } from "../client.js";
import { bn } from "./trust-policy.js";
import { fa, ma } from "../socket-path.js";
import { use } from "./helper-installer.js";
import { yh } from "./refresh-marker.js";

// 还原草稿（块级切分，待手工修正导入与类型）

export var lz = "/usr/bin:/bin:/usr/sbin:/sbin";

export var uz = 4096,
  pz = 4277009102,
  fz = 4277009103,
  mz = 3405691582,
  jC = 3405691583,
  Mre = 4278190080,
  xre = new Map([
    ["7:3", "i386"],
    ["16777223:3", "x86_64"],
    ["16777223:8", "x86_64h"],
    ["12:6", "armv6"],
    ["12:9", "armv7"],
    ["12:11", "armv7s"],
    ["12:12", "armv7k"],
    ["16777228:0", "arm64"],
    ["16777228:1", "arm64v8"],
    ["16777228:2", "arm64e"],
    ["33554444:1", "arm64_32"],
  ]);

export function gz(e, t) {
  let n: any = (t & ~Mre) >>> 0,
    r = xre.get(`${e >>> 0}:${n}`);
  return (
    r ||
    `unknown(0x${(e >>> 0).toString(16).padStart(8, "0")},0x${n.toString(16).padStart(8, "0")})`
  );
}

export function Ore(e) {
  if (e.length < 8) throw new Error("not a Mach-O file: header shorter than 8 bytes");
  let t = e.readUInt32BE(0),
    n = e.readUInt32LE(0),
    r = t === mz || t === jC;
  if (r || n === mz || n === jC) {
    let c = r ? t : n,
      d = (g) => (r ? e.readUInt32BE(g) : e.readUInt32LE(g)),
      l = d(4),
      p = c === jC ? 32 : 20,
      u = 8 + l * p;
    if (u > e.length)
      throw new Error(
        `not a Mach-O file: relative header declares ${l} slices (needs ${u} bytes, have ${e.length})`,
      );
    let f = [];
    for (let g = 0; g < l; g += 1) {
      let v = 8 + g * p;
      f.push(gz(d(v), d(v + 4)));
    }
    return f;
  }
  let s: any = t === pz || t === fz;
  if (s || n === pz || n === fz) {
    if (e.length < 12)
      throw new Error("not a Mach-O file: thin header truncated before cpusubtype");
    let c = (d) => (s ? e.readUInt32BE(d) : e.readUInt32LE(d));
    return [gz(c(4), c(8))];
  }
  throw new Error(`not a Mach-O file: unrecognized magic 0x${t.toString(16).padStart(8, "0")}`);
}

export async function hz(e) {
  let t = await Tre(e, "r");
  try {
    let n = Buffer.alloc(uz),
      { bytesRead: r } = await t.read(n, 0, uz, 0);
    return Ore(n.subarray(0, r));
  } finally {
    await t.close();
  }
}

export var bz = "--broker-launch-deadline-epoch-ms",
  Iz = "--broker-launch-cancel-file",
  _z = ".launch-cancel",
  Ure =
    /^\.broker-launch-cancel-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.sentinel$/u,
  zre = 3e5,
  Wre = 5e3;

export function Rz(e) {
  return ma(e) ? fa(process.env) : kz(Cz(e));
}

export function Az(e) {
  return ma(e) || Pz(e);
}

export function $re(e) {
  if (!Az(e)) return null;
  try {
    return KC(Sz(Rz(e)), _z);
  } catch {
    return null;
  }
}

$re;

export function vh(e, t) {
  if (
    !Number.isSafeInteger(t.deadlineEpochMs) ||
    t.deadlineEpochMs <= 0 ||
    !Pz(t.cancelFilePath) ||
    !Ure.test(Bre(t.cancelFilePath))
  )
    return !1;
  let n = $re(e);
  if (!n) return !1;
  try {
    return Sz(kz(Cz(t.cancelFilePath))) === n;
  } catch {
    return !1;
  }
}

export async function Ez(e) {
  let t = e.now ?? Date.now();
  if (
    !Az(e.socketPath) ||
    !Number.isSafeInteger(e.deadlineEpochMs) ||
    e.deadlineEpochMs <= t ||
    e.deadlineEpochMs - t > zre
  )
    throw new CuaHelperError(
      "launch_failed",
      "Refusing to prepare an unsafe Computer Use Helper broker launch guard",
    );
  let n;
  try {
    let s = Rz(e.socketPath);
    (await wz(s, {
      recursive: !0,
      mode: 448,
    }),
      await yz(s, 448),
      (n = await vz(s)));
  } catch (s) {
    throw new CuaHelperError(
      "launch_failed",
      `Failed to resolve the Computer Use Helper broker runtime directory: ${s instanceof Error ? s.message : String(s)}`,
      {
        cause: s,
      },
    );
  }
  let r = KC(n, _z);
  if (
    (await wz(r, {
      recursive: !0,
      mode: 448,
    }),
    await yz(r, 448),
    (await vz(r)) !== r)
  )
    throw new CuaHelperError(
      "launch_failed",
      "Refusing to use a redirected Computer Use Helper launch-cancel directory",
    );
  let o = e.mintId ?? Dre;
  for (let s = 0; s < 5; s += 1) {
    let a = o().trim().toLowerCase(),
      c = {
        cancelFilePath: KC(r, `.broker-launch-cancel-${a}.sentinel`),
        deadlineEpochMs: e.deadlineEpochMs,
      };
    if (vh(e.socketPath, c) && !Nre(c.cancelFilePath)) return c;
  }
  throw new CuaHelperError(
    "launch_failed",
    "Failed to allocate a unique Computer Use Helper broker launch guard",
  );
}

export function Tz(e, t) {
  if (!vh(e, t))
    throw new CuaHelperError(
      "termination_failed",
      "Refusing to publish an unsafe Computer Use Helper broker launch cancellation sentinel",
    );
  try {
    Lre(
      t.cancelFilePath,
      `canceled

`,
      {
        encoding: "utf8",
        mode: 384,
        flag: "wx",
      },
    );
  } catch (n) {
    if (n.code === "EEXIST") return;
    throw n;
  }
}

export async function qC(e) {
  await Fre(e.cancelFilePath, {
    force: !0,
  });
}

export function Mz(e, t: { now?: () => number; setTimer?: typeof setTimeout } = {}) {
  let n = t.now ?? Date.now,
    r = t.setTimer ?? setTimeout,
    o = Math.max(1e3, e.deadlineEpochMs - n() + Wre);
  r(() => {
    qC(e).catch(() => {});
  }, o).unref?.();
}

export var xt = "ZCode Computer Use.app",
  DEV_HELPER_APP_NAME_APP = "ZCode Computer Use Dev.app";

export var Ss = "dev.zcode.cua-helper",
  DEV_CUA_HELPER_BUNDLE_ID_VALUE = "dev.zcode.cua-helper.dev";

export var ha = "8A5X4JJ39T",
  GC = "ZCODE_CUA_LAUNCHER_PID",
  HELPER_INSTALL_VARIANT_ENV = "ZCODE_CUA_HELPER_INSTALL_VARIANT",
  $u = ["stable", "preview", "dev-desktop", "standalone"],
  Sh = "--controller-variant",
  kh = "--disable-cps-activation";

export function xz(e = process.env) {
  let t = e.ZCODE_CUA_DISABLE_CPS_ACTIVATION?.trim().toLowerCase();
  return t === "1" || t === "true" || t === "on" || t === "yes";
}

export var Ph = "--allow-unsigned-launcher-local-dev",
  Ch = "--allow-external-broker-client-local-dev",
  bh = "--ghost-cursor-overlay",
  Ih = "--background-mode",
  _h = "--pip-mode",
  Rh = "--pip-live-probe",
  HELPER_ADDON_ENV_VALUE = "ZCODE_CUA_HELPER_ADDON",
  Ah = "--ghost-cursor-capture";

export var Eh = "--permission-preflight",
  Th = "--permission-preflight-result-file";

export var VC = class extends CuaHelperError {
  static {}
  constructor(t) {
    let n =
      t instanceof CuaHelperError
        ? t
        : new CuaHelperError("launch_failed", t instanceof Error ? t.message : String(t), {
            cause: t,
          });
    (super(n.code, n.message, {
      cause: t,
    }),
      (this.name = "CuaHelperLaunchAttemptError"));
  }
};

export function qre(e) {
  if (!bn(e)) return !1;
  let t = e.ZCODE_CUA_HELPER_ALLOW_UNSIGNED_LOCAL?.trim().toLowerCase();
  return t === "1" || t === "true" || t === "on" || yh(e);
}

export function xh(e = process.env) {
  return qre(e) ? DEV_HELPER_APP_NAME_APP : xt;
}

export function Gre(e = process.env) {
  let t = e[GC];
  if (typeof t == "string") {
    let n = Number.parseInt(t.trim(), 10);
    if (Number.isInteger(n) && n > 1) return n;
  }
  return process.pid;
}

export function JC(e, t) {
  let n = ["-n", "-g", e.appPath, "--args", "--socket", e.socketPath],
    r = e.version?.trim();
  // 原版 mac 3.11.2 发射序（asar Uxe）：token 文件紧跟 --socket，先于 --version。
  // LaunchServices 不透传 env，token 只能走一次性文件（0.5.13 win32 线走 env，属两线演进差）。
  e.tokenFile && n.push("--token-file", e.tokenFile);
  e.presentationTokenFile && n.push("--presentation-token-file", e.presentationTokenFile);
  r && n.push("--version", r);
  let o = e.expectedAppBundlePath?.trim();
  if (
    (o && n.push("--expected-app-bundle-path", o),
    e.controllerVariant && n.push(Sh, e.controllerVariant),
    e.disableCpsActivation && n.push(kh, "1"),
    e.brokerLaunchGuard)
  ) {
    if (!vh(e.socketPath, e.brokerLaunchGuard))
      throw new CuaHelperError(
        "launch_failed",
        "Refusing to pass an unsafe Computer Use Helper broker launch guard to LaunchServices",
      );
    n.push(bz, String(e.brokerLaunchGuard.deadlineEpochMs), Iz, e.brokerLaunchGuard.cancelFilePath);
  }
  return (
    n.push("--exit-log", e.exitLogPath?.trim() || `${e.socketPath}.exit.log`),
    typeof t == "number" && Number.isInteger(t) && t > 0 && n.push("--launcher-pid", String(t)),
    e.allowUnsignedLauncherLocalDev === !0 && n.push(Ph),
    e.allowExternalBrokerClientLocalDev === !0 && n.push(Ch),
    e.ghostCursorOverlay === !0 && n.push(bh),
    e.backgroundMode === !0 && n.push(Ih),
    e.pipMode === !0 && n.push(_h),
    e.pipLiveProbe === !0 && n.push(Rh),
    e.ghostCursorCapture === !0 && n.push(Ah),
    n
  );
}

export function Vre(e, t) {
  return ["-W", "-n", "-g", e, "--args", Eh, "screen_recording", Th, t];
}

export var Jre = 8e3,
  Yre = new Set(["granted", "denied", "unknown"]);

export function Xre(e) {
  if (!e) return null;
  let t;
  try {
    t = JSON.parse(e);
  } catch {
    return null;
  }
  if (!t || typeof t != "object" || Array.isArray(t)) return null;
  let n = t;
  if (n.permission !== "screen_recording") return null;
  let r = n.state;
  return typeof r == "string" && Yre.has(r) ? r : null;
}

export var Qre = {
  launchOpen: (e, t, n, r) =>
    Nz(
      dn.open,
      e,
      {
        env: t,
        timeout: n,
      },
      (o) => r(o),
    ),
};

export function eoe(e) {
  try {
    return Lz(e) ? jre(e, "utf8") : null;
  } catch {
    return null;
  }
}

export function toe(e) {
  try {
    Kre(e, {
      force: !0,
    });
  } catch {}
}

export async function Fz(e) {
  let t = e.dependencies ?? Qre,
    n = t.readResult ?? eoe,
    r = t.removeResult ?? toe,
    o = e.timeoutMs ?? Jre;
  try {
    return (await new Promise((a) => {
      t.launchOpen(Vre(e.appPath, e.resultFilePath), Uz(void 0), o, a);
    }))
      ? null
      : Xre(n(e.resultFilePath));
  } finally {
    r(e.resultFilePath);
  }
}

// —— 一次性 token 文件链（原版 mac 3.11.2 发射器 F9/Xxe/Yxe 的还原）——
// LaunchServices(`open`) 不向目标 app 透传环境变量，mac 产品模式的 broker token
// 只能经文件交付：socket 同目录 `.tokens/` 下的一次性文件，helper 读取后即删。
var HELPER_TOKEN_FILE_CLEANUP_MS = 6e4;

export async function writeOneShotHelperTokenFile(e) {
  let t = KC(kz(e.socketPath), ".tokens");
  await wz(t, { recursive: !0, mode: 448 });
  await yz(t, 448);
  for (let n = 0; n < 5; n += 1) {
    let o = KC(t, `.broker-token-${process.pid}-${randomBytes(8).toString("hex")}`);
    try {
      return (
        Lre(o, e.token, { encoding: "utf8", mode: 384, flag: "wx" }),
        o
      );
    } catch (r) {
      if (r.code === "EEXIST") continue;
      throw new CuaHelperError(
        "launch_failed",
        `Failed to write one-shot Computer Use Helper token file: ${r instanceof Error ? r.message : String(r)}`,
        { cause: r },
      );
    }
  }
  throw new CuaHelperError(
    "launch_failed",
    "Failed to write one-shot Computer Use Helper token file: exhausted unique filename retries",
  );
}

export function createHelperTokenFileReceipt(e) {
  let t = e.filter(Boolean);
  return {
    tokenFiles: t,
    revokeTokenFile: async () => {
      for (let n of t) await Fre(n, { force: !0 });
    },
  };
}

export function scheduleHelperTokenFileCleanup(e) {
  setTimeout(() => {
    e.revokeTokenFile().catch(() => {});
  }, HELPER_TOKEN_FILE_CLEANUP_MS).unref?.();
}

export function Bz() {
  return {
    launch: async (e) => {
      let t, n, o;
      try {
        (t = await writeOneShotHelperTokenFile(e)),
          (n = e.presentationToken
            ? await writeOneShotHelperTokenFile({ ...e, token: e.presentationToken })
            : void 0),
          (o = createHelperTokenFileReceipt([t, n]));
      } catch (r) {
        throw r instanceof VC ? r : new VC(r);
      }
      try {
        await ooe({ ...e, tokenFile: t, presentationTokenFile: n });
      } catch (r) {
        try {
          await o.revokeTokenFile();
        } catch {}
        throw r instanceof VC ? r : new VC(r);
      }
      scheduleHelperTokenFileCleanup(o);
    },
  };
}

export var noe = new Set([
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "__CF_USER_TEXT_ENCODING",
  "ZCODE_CUA_PIP_DEBUG",
]);

export function roe(e) {
  let t = e.toUpperCase();
  return noe.has(t) || t.startsWith("LC_");
}

export function Uz(e?: NodeJS.ProcessEnv) {
  let t = e ?? process.env,
    n: NodeJS.ProcessEnv = {};
  for (let [r, o] of Object.entries(t)) o !== void 0 && roe(r) && (n[r] = o);
  return ((n.PATH = lz), n);
}

export async function ooe(e) {
  return new Promise<void>((t, n) => {
    try {
      (e.assertHelperUnchangedBeforeLaunch?.(),
        Nz(
          dn.open,
          JC(e, Gre()),
          {
            env: Uz(e.env),
            timeout: CUA_DEV_TIMEOUT_MS,
            killSignal: "SIGKILL",
          },
          (r) => {
            if (r) {
              n(
                new CuaHelperError("launch_failed", ioe(e.appPath, r), {
                  cause: r,
                }),
              );
              return;
            }
            t();
          },
        ));
    } catch (r) {
      n(
        new CuaHelperError(
          "launch_failed",
          `Refusing to launch a changed ZCode Computer Use: ${r instanceof Error ? r.message : String(r)}`,
          {
            cause: r,
          },
        ),
      );
    }
  });
}

export function ioe(e, t) {
  let n = t instanceof Error ? t.message : String(t),
    r = `Failed to launch ${e} via LaunchServices (open): ${n}`;
  return soe(t, n)
    ? `${r}

LaunchServices timed out after ${CUA_DEV_TIMEOUT_MS}ms while dispatching ZCode Computer Use. This usually means macOS is still verifying the helper, Gatekeeper blocked first launch, the installed bundle still carries a quarantine attribute, or a stale running Helper instance prevented fresh broker arguments from being delivered. Ask the user to open ZCode's CUA readiness panel, reveal the helper, repair the helper install, or fully quit ZCode and retry; diagnostic command: xattr -dr com.apple.quarantine ${JSON.stringify(e)}`
    : r;
}

export function soe(e, t) {
  if (
    /(?:_LSOpenURLsWithCompletionHandler|LaunchServices|AppleEvent).*(?:-1712|timed out)/iu.test(t)
  )
    return !0;
  if (typeof e != "object" || e === null) return !1;
  let n = e;
  return n.code === "ETIMEDOUT" || (n.killed === !0 && n.signal === "SIGKILL");
}

export function Hc(e) {
  return e.ZCODE_HOME?.trim() || (e.HOME?.trim() ? ks(e.HOME.trim(), ".zcode") : null);
}

export function YC(e) {
  let t = e[HELPER_INSTALL_VARIANT_ENV]?.trim();
  return t && $u.includes(t)
    ? t
    : t
      ? null
      : bn(e)
        ? "dev-desktop"
        : e.ZCODE_ENV?.trim().toLowerCase() === "test"
          ? "preview"
          : "stable";
}

export function XC(e) {
  let t = Hc(e);
  if (!t) return null;
  let n = ks(t, "computer-use"),
    r = YC(e);
  return r
    ? r === "dev-desktop" || xh(e) === DEV_HELPER_APP_NAME_APP
      ? ks(n, "dev")
      : r === "preview"
        ? ks(n, "preview")
        : n
    : null;
}

export function zz(e = process.env) {
  let t = Hc(e);
  if (!t) return [];
  let n = ks(t, "computer-use");
  return [n, ks(n, "dev"), ...$u.map((r) => ks(n, r))];
}

export function QC(e = process.env) {
  let t = XC(e);
  return t ? [ks(t, xh(e))] : [];
}

export function Wz(e = process.env) {
  return QC(e);
}
