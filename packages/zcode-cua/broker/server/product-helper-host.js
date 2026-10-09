// oxlint-disable-file
// 还原草稿：仅供继续手工重建参考，不参与编译
import { dirname as Yse, join as Tb, resolve as Xse, } from "node:path";
import { existsSync as e$, readFileSync as Vse, statSync as Jse, } from "node:fs";
import { Bz, Wz } from "./helper-launcher.js";
import { CuaHelperError } from "../client.js";
import { Nh } from "./orphan-reaper.js";
import { CuaHelperHost } from "./helper-host.js";
import { ZC, cz, dz, ga, wh } from "./permission-broker-config.js";
import { qu } from "./helper-installer.js";
// 还原草稿（块级切分，待手工修正导入与类型）
export function JW(e) {
    let t = e.env ?? process.env, n = e.helperInstaller === !1
        ? void 0
        : (e.helperInstaller ??
            qu({
                logger: e.logger,
                env: t,
                bundledAppPath: e.bundledHelperAppPath,
            }));
    return new CuaHelperHost({
        launcher: e.launcher ?? Bz(),
        helperAppCandidates: Wz(t),
        helperInstaller: n,
        healthTimeoutMs: e.healthTimeoutMs,
        expectedBundleId: Nh(t),
        logger: e.logger,
        env: t,
        ghostCursorOverlay: !0,
        verifyLiveProcessIdentity: e.verifyLiveProcessIdentity,
        ...(e.screenRecordingPreflight
            ? {
                screenRecordingPreflight: e.screenRecordingPreflight,
            }
            : {}),
        pipMode: !0,
    });
}
export function Eb(e, t = () => { }) {
    let n = !1, r = () => {
        n || ((n = !0), t());
    };
    return (e.restartAfterCurrentStartPreservingTransport
        ? e.restartAfterCurrentStartPreservingTransport({
            beforeFreshStart: r,
        })
        : (r(),
            e.restartAfterCurrentStart().then((s) => ({
                handle: s,
                reused: !1,
            })))).then((s) => {
        if (!s.reused && !n)
            throw new CuaHelperError("launch_failed", "Computer Use Helper fresh permission restart launched before the unavailable generation was published");
        return s;
    });
}
export var Kse = 1e4, Gu = new WeakMap();
export function qse(e) {
    let t = Gu.get(e);
    return (t ||
        ((t = {
            generation: 0,
            pendingGeneration: null,
        }),
            Gu.set(e, t)),
        t);
}
export function zi(e) {
    let t = qse(e);
    return ((t.generation += 1), (t.pendingGeneration = t.generation), t.generation);
}
export function YW(e) {
    return Gu.get(e)?.pendingGeneration ?? null;
}
export function Gse(e, t) {
    let n = Gu.get(e);
    return !n || n.pendingGeneration !== t ? !1 : ((n.pendingGeneration = null), !0);
}
export function Rr(e) {
    return YW(e) !== null;
}
export function XW(e) {
    let t = Gu.get(e);
    t && (t.pendingGeneration = null);
}
export async function Vu(e, t = Kse) {
    let n;
    try {
        return await Promise.race([
            e,
            new Promise((r, o) => {
                n = setTimeout(() => {
                    o(new CuaHelperError("caller_timeout", `ZCode Computer Use is still starting after ${t}ms; retry the task shortly`));
                }, t);
            }),
        ]);
    }
    finally {
        n && clearTimeout(n);
    }
}
export function QW(e, t = {}) {
    let n = null, r = null, o = null, s = null, a = 0, c = Promise.resolve(), d = new Map(), l = new Set();
    function p() {
        if (o)
            return o.then((O) => O.handle);
        if (n)
            return n;
        let F = e.start().finally(() => {
            n === F && (n = null);
        });
        return ((n = F), F);
    }
    function u() {
        if (r)
            return r;
        let M = o, O = (async () => (M && (await M.catch(() => { })), (await Eb(e, () => zi(e))).handle))().finally(() => {
            r === O && (r = null);
        });
        return ((r = O), O);
    }
    function f() {
        if (o)
            return o;
        let M = r, O = (async () => (M && (await M.catch(() => { })), Eb(e, () => zi(e))))().finally(() => {
            o === O && (o = null);
        });
        return ((o = O), O);
    }
    function g() {
        return o ? o.then((M) => M.handle) : (r ?? n);
    }
    async function v() {
        (await u(), await D());
    }
    async function S() {
        (await f(), await D());
    }
    function k(M) {
        let O = M?.trim() || `anonymous-grant-${++a}`;
        if (l.has(O))
            return Promise.resolve();
        let L = d.get(O);
        if (L)
            return L;
        let q = c, ie = (async () => {
            if ((await q.catch(() => { }), await S(), l.add(O), l.size > 64)) {
                let X = l.values().next().value;
                X && l.delete(X);
            }
        })().finally(() => {
            d.get(O) === ie && d.delete(O);
        });
        return (d.set(O, ie), (c = ie.catch(() => { })), ie);
    }
    function C() {
        let M = e.running, F = e.socketPath, O = e.pluginAuthority;
        return !M || !F || !O
            ? null
            : {
                socketPath: F,
                pluginAuthority: O,
            };
    }
    function A(M) {
        let F = C();
        return F !== null && (F.socketPath !== M.socketPath || F.pluginAuthority !== M.pluginAuthority);
    }
    async function D() {
        for (;;) {
            if (!s) {
                if (!Rr(e))
                    return;
                s = (async () => {
                    for (;;) {
                        let M = g();
                        if (M) {
                            await Vu(M);
                            continue;
                        }
                        let F = YW(e);
                        if (F === null)
                            return;
                        C() && Gse(e, F);
                        return;
                    }
                })().finally(() => {
                    s = null;
                });
            }
            if ((await s, !Rr(e)))
                return;
        }
    }
    async function U() {
        for (;;) {
            let M = g();
            if (M) {
                try {
                    await Vu(M);
                }
                catch (O) {
                    throw (Rr(e) || zi(e), O);
                }
                continue;
            }
            if ((await D(), g() || Rr(e)))
                continue;
            let F = C();
            if (F)
                return F;
            throw (zi(e),
                new CuaHelperError("launch_failed", "ZCode Computer Use lifecycle completed without a live broker credential tuple"));
        }
    }
    async function j() {
        let M = C();
        if (!g() && M)
            try {
                await e.checkHealth(1e3);
            }
            catch {
                if (t.hasActiveTurn?.())
                    throw new CuaHelperError("restart_deferred_active_turn", "cua helper is unhealthy but an agent turn is active; deferring restart to the next request boundary");
                !g() && !A(M) && u();
            }
        else
            !g() && !M && p();
        return U();
    }
    function B() {
        if (e.running || g())
            return;
        p().catch(() => { });
    }
    async function W(M) {
        let F = M?.filter(ga);
        if (!M || !F?.length) {
            if (!e.running)
                return (B(), M);
            try {
                await j();
            }
            catch { }
            return M;
        }
        let O = e.pluginAuthority ?? void 0;
        if (!F.some((Y) => ZC(Y) && wh(Y, O)))
            return M.filter((Y) => !ga(Y));
        let L;
        try {
            L = await j();
        }
        catch {
            return (Rr(e) || zi(e), M.filter((Y) => !ga(Y)));
        }
        let q = M.filter((Y) => !ga(Y) || wh(Y, L.pluginAuthority));
        return cz(q, L);
    }
    return {
        async resolveMcpServers(M) {
            let F = await W(M);
            return dz(F);
        },
        async restart() {
            await v();
        },
        async restartAfterPermissionGrant(M) {
            await k(M);
        },
        async reconcileRecoveredHelper() {
            g() || (Rr(e) && C() && (await D()));
        },
    };
}
export var Vh = class {
    static { }
    targetsByWorkspaceKey = new Map();
    setEnabled(t, n) {
        if (!n) {
            this.targetsByWorkspaceKey.delete(t.workspaceKey);
            return;
        }
        let r = {
            workspacePath: t.workspacePath,
            ...(t.workspaceIdentity
                ? {
                    workspaceIdentity: t.workspaceIdentity,
                }
                : {}),
        };
        this.targetsByWorkspaceKey.set(t.workspaceKey, r);
    }
    snapshot() {
        return [...this.targetsByWorkspaceKey.values()];
    }
    pruneDisabled(t) {
        for (let [n, r] of this.targetsByWorkspaceKey)
            t(r) || this.targetsByWorkspaceKey.delete(n);
    }
};
export var Jh = class {
    static { }
    stopInstance;
    current;
    retiring;
    terminal = !1;
    transitionTail = Promise.resolve();
    disposePromise;
    constructor(t) {
        this.stopInstance = t;
    }
    get disposed() {
        return this.terminal;
    }
    isCurrent(t) {
        return !this.terminal && this.current === t;
    }
    peek() {
        return this.terminal ? void 0 : this.current;
    }
    acquire(t) {
        return this.enqueue(async () => {
            if (!this.terminal && (await this.finishRetiringInstance(), !this.terminal)) {
                if (!t.isAdmitted()) {
                    await this.stopCurrentIfNeeded(t.shouldRetainCurrent);
                    return;
                }
                return (this.current || (this.current = t.create()), this.current);
            }
        });
    }
    reconcile(t) {
        return this.enqueue(async () => {
            this.terminal ||
                (await this.finishRetiringInstance(),
                    !this.terminal && (await this.stopCurrentIfNeeded(t)));
        });
    }
    dispose() {
        return this.disposePromise
            ? this.disposePromise
            : ((this.terminal = !0),
                (this.disposePromise = this.enqueue(async () => {
                    let t = this.current, n = this.retiring;
                    ((this.current = void 0), (this.retiring = void 0));
                    let r = [n, t].filter((s, a, c) => s !== void 0 && c.indexOf(s) === a), o = [];
                    for (let s of r)
                        try {
                            await this.stopInstance(s);
                        }
                        catch (a) {
                            o.push(a);
                        }
                    if (o.length === 1)
                        throw o[0];
                    if (o.length > 1)
                        throw new AggregateError(o, "Failed to stop Computer Use Helper instances");
                })),
                this.disposePromise);
    }
    async stopCurrentIfNeeded(t) {
        let n = this.current;
        !n ||
            t(n) ||
            ((this.current = void 0), (this.retiring = n), await this.finishRetiringInstance());
    }
    async finishRetiringInstance() {
        let t = this.retiring;
        t && (await this.stopInstance(t), this.retiring === t && (this.retiring = void 0));
    }
    enqueue(t) {
        let n = this.transitionTail.then(t, t);
        return ((this.transitionTail = n.then(() => { }, () => { })),
            n);
    }
};
export var Qse = ["zcode.json", Tb(".zcode", "config.json")], eae = ".git";
export function tae(e) {
    let t = Xse(e ?? process.cwd());
    return rae(t).flatMap((n) => Qse.map((r) => Tb(n, r)).filter((r) => e$(r)));
}
export function t$(e) {
    return nae(e).enabled;
}
t$;
export function nae(e) {
    let t = !0, n = !0, r = !1, o = !1, s = [
        ...(e.userConfigPath ? [e.userConfigPath] : []),
        ...tae(e.workingDirectory),
        ...(e.projectConfigPath ? [e.projectConfigPath] : []),
    ];
    for (let a of s) {
        let c = iae(a);
        if (c) {
            if (Vc(c, "features")) {
                let d = Yh(c.features);
                d ? Vc(d, "mcp") && (t = d.mcp === !0) : (t = !1);
            }
            if (Vc(c, "plugins")) {
                let d = Yh(c.plugins);
                if (!d) {
                    ((n = !1), (r = !1), (o = !0));
                    continue;
                }
                if ((Vc(d, "enabled") && (n = d.enabled === !0), Vc(d, "enabledPlugins"))) {
                    let l = Yh(d.enabledPlugins);
                    l ? Vc(l, e.pluginId) && ((r = l[e.pluginId] === !0), (o = !0)) : ((r = !1), (o = !0));
                }
            }
        }
    }
    return {
        configured: o,
        enabled: t && n && r,
    };
}
export function rae(e) {
    let t = [], n = e;
    for (;;) {
        if ((t.push(n), oae(n)))
            return t.reverse();
        let r = Yse(n);
        if (r === n)
            break;
        n = r;
    }
    return [e];
}
export function oae(e) {
    let t = Tb(e, eae);
    try {
        if (!e$(t))
            return !1;
        let n = Jse(t);
        return n.isDirectory() || n.isFile();
    }
    catch {
        return !1;
    }
}
export function iae(e) {
    try {
        return Yh(JSON.parse(Vse(e, "utf8")));
    }
    catch {
        return;
    }
}
export function Yh(e) {
    return typeof e == "object" && e !== null && !Array.isArray(e) ? e : void 0;
}
export function Vc(e, t) {
    return Object.prototype.hasOwnProperty.call(e, t);
}
