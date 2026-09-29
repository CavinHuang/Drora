// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
function e(e) {
  let t = Object.values(e).filter((e) => typeof e == `number`);
  return Object.entries(e)
    .filter(([e, n]) => t.indexOf(+e) === -1)
    .map(([e, t]) => t);
}
function t(e, t = `|`) {
  return e.map((e) => de(e)).join(t);
}
function n(e, t) {
  return typeof t == `bigint` ? t.toString() : t;
}
var r = class {
  constructor(e) {
    ((this._getter = e), (this._value = void 0));
  }
  get value() {
    let e = this._getter;
    return (e !== void 0 && ((this._value = e()), (this._getter = void 0)), this._value);
  }
};
function i(e) {
  return new r(e);
}
function a(e) {
  return e == null;
}
function o(e) {
  let t = +!!e.startsWith(`^`),
    n = e.endsWith(`$`) ? e.length - 1 : e.length;
  return e.slice(t, n);
}
function s(e, t) {
  let n = e / t,
    r = Math.round(n),
    i = 4 * 2 ** -52 * Math.max(Math.abs(n), 1);
  return Math.abs(n - r) < i ? 0 : n - r;
}
function c(e, t, n) {
  Object.defineProperty(e, t, { value: n, writable: !0, enumerable: !0, configurable: !0 });
}
function l(e) {
  let t = Object.getOwnPropertyDescriptor(e, `shape`);
  return t?.get ? t.get.raw : t?.value;
}
function u(e) {
  return l(e._zod.def) ?? e._zod.def.shape;
}
function d(e, t, n) {
  Object.defineProperty(e, t, {
    get() {
      let e = n();
      return (c(this, t, e), e);
    },
    enumerable: !0,
    configurable: !0,
  });
}
function f(e, t, n) {
  t in e ? c(e, t, n) : (e[t] = n);
}
function p(e, t, n, r) {
  let i = u(t);
  for (let a of n) {
    let n = Object.getOwnPropertyDescriptor(i, a);
    n.enumerable &&
      (n.get
        ? d(e, a, () => {
            let e = t._zod.def.shape[a];
            return r ? r(e, a) : e;
          })
        : f(e, a, r ? r(n.value, a) : n.value));
  }
}
function ee(e, t) {
  for (let n of Reflect.ownKeys(t)) {
    let r = Object.getOwnPropertyDescriptor(t, n);
    r.enumerable && (r.get ? d(e, n, () => t[n]) : f(e, n, r.value));
  }
}
function m(...e) {
  let t = {};
  for (let n of e) Object.assign(t, Object.getOwnPropertyDescriptors(n));
  return Object.defineProperties({}, t);
}
function te(e) {
  return JSON.stringify(e);
}
function ne(e) {
  return e
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, ``)
    .replace(/[\s_-]+/g, `-`)
    .replace(/^-+|-+$/g, ``);
}
var re = `captureStackTrace` in Error ? Error.captureStackTrace : (...e) => {};
function ie(e) {
  return typeof e == `object` && !!e && !Array.isArray(e);
}
var ae = i(() => {
  if ($e.jitless || (typeof navigator < `u` && navigator?.userAgent?.includes(`Cloudflare`)))
    return !1;
  try {
    return (Function(``), !0);
  } catch {
    return !1;
  }
});
function oe(e) {
  if (ie(e) === !1) return !1;
  let t = e.constructor;
  if (t === void 0 || typeof t != `function`) return !0;
  let n = t.prototype;
  return !(ie(n) === !1 || Object.prototype.hasOwnProperty.call(n, `isPrototypeOf`) === !1);
}
function se(e) {
  return oe(e)
    ? { ...e }
    : Array.isArray(e)
      ? [...e]
      : e instanceof Map
        ? new Map(e)
        : e instanceof Set
          ? new Set(e)
          : e;
}
var ce = new Set([`string`, `number`, `symbol`]);
function le(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`);
}
function ue(e, t, n) {
  let r = new e._zod.constr(t ?? e._zod.def);
  return ((!t || n?.parent) && (r._zod.parent = e), r);
}
function h(e) {
  let t = e;
  if (!t) return {};
  if (typeof t == `string`) return { error: () => t };
  if (t?.message !== void 0) {
    if (t?.error !== void 0) throw Error("Cannot specify both `message` and `error` params");
    t.error = t.message;
  }
  return (delete t.message, typeof t.error == `string` ? { ...t, error: () => t.error } : t);
}
function de(e) {
  return typeof e == `bigint` ? e.toString() + `n` : typeof e == `string` ? `"${e}"` : `${e}`;
}
function fe(e) {
  return Object.keys(e).filter(
    (t) => e[t]._zod.optin !== void 0 && e[t]._zod.optout === `optional`,
  );
}
var pe = {
    safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
    int32: [-2147483648, 2147483647],
    uint32: [0, 4294967295],
    float32: [-34028234663852886e22, 34028234663852886e22],
    float64: [-Number.MAX_VALUE, Number.MAX_VALUE],
  },
  me = {
    int64: [BigInt(`-9223372036854775808`), BigInt(`9223372036854775807`)],
    uint64: [BigInt(0), BigInt(`18446744073709551615`)],
  };
function he(e, t) {
  let n = e._zod.def,
    r = n.checks;
  if (r && r.length > 0)
    throw Error(`.pick() cannot be used on object schemas containing refinements`);
  let i = {};
  return (p(i, e, ge(e, t)), ue(e, m(n, { shape: i, checks: [] })));
}
function ge(e, t) {
  let n = u(e),
    r = [];
  for (let e of Reflect.ownKeys(t)) {
    if (!Object.getOwnPropertyDescriptor(n, e)?.enumerable)
      throw Error(`Unrecognized key: "${String(e)}"`);
    t[e] && r.push(e);
  }
  return r;
}
function _e(e, t) {
  let n = e._zod.def,
    r = n.checks;
  if (r && r.length > 0)
    throw Error(`.omit() cannot be used on object schemas containing refinements`);
  let i = new Set(ge(e, t)),
    a = {};
  return (
    p(
      a,
      e,
      Reflect.ownKeys(u(e)).filter((e) => !i.has(e)),
    ),
    ue(e, m(n, { shape: a, checks: [] }))
  );
}
function ve(e, t) {
  if (!oe(t)) throw Error(`Invalid input to extend: expected a plain object`);
  let n = e._zod.def.checks;
  if (n && n.length > 0) {
    let n = u(e);
    for (let e of Reflect.ownKeys(t))
      if (Object.getOwnPropertyDescriptor(n, e) !== void 0)
        throw Error(
          "Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.",
        );
  }
  return ue(e, m(e._zod.def, { shape: ye(e, t) }));
}
function ye(e, t) {
  let n = {};
  return (p(n, e, Reflect.ownKeys(u(e))), ee(n, t), n);
}
function be(e, t) {
  if (!oe(t)) throw Error(`Invalid input to safeExtend: expected a plain object`);
  return ue(e, m(e._zod.def, { shape: ye(e, t) }));
}
function xe(e, t) {
  if (!t?._zod?.def)
    throw Error(
      "Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.",
    );
  if (e._zod.def.checks?.length)
    throw Error(
      `.merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.`,
    );
  let n = {};
  return (
    p(n, e, Reflect.ownKeys(u(e))),
    p(n, t, Reflect.ownKeys(u(t))),
    ue(
      e,
      m(e._zod.def, {
        shape: n,
        get catchall() {
          return t._zod.def.catchall;
        },
        checks: t._zod.def.checks ?? [],
      }),
    )
  );
}
function Se(e, t, n, r = `partial`) {
  let i = t._zod.def.checks;
  if (i && i.length > 0)
    throw Error(`.${r}() cannot be used on object schemas containing refinements`);
  let a = n ? new Set(ge(t, n)) : void 0,
    o = {};
  return (
    p(
      o,
      t,
      Reflect.ownKeys(u(t)),
      e && ((t, n) => (a && !a.has(n) ? t : new e({ type: `optional`, innerType: t }))),
    ),
    ue(t, m(t._zod.def, { shape: o, checks: [] }))
  );
}
function Ce(e, t, n) {
  let r = n ? new Set(ge(t, n)) : void 0,
    i = {};
  return (
    p(i, t, Reflect.ownKeys(u(t)), (t, n) =>
      r && !r.has(n) ? t : new e({ type: `nonoptional`, innerType: t }),
    ),
    ue(t, m(t._zod.def, { shape: i }))
  );
}
function we(e, t = 0) {
  if (e.aborted === !0) return !0;
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue !== !0) return !0;
  return !1;
}
function Te(e, t = 0) {
  if (e.aborted === !0) return !0;
  for (let n = t; n < e.issues.length; n++) if (e.issues[n]?.continue === !1) return !0;
  return !1;
}
function Ee(e, t) {
  return t.map((t) => {
    var n;
    return ((n = t).path ?? (n.path = []), t.path.unshift(e), t);
  });
}
function De(e) {
  return typeof e == `string` ? e : e?.message;
}
function Oe(e, t, n) {
  var r;
  for (let i = t; i < e.length; i++) (r = e[i]).schema ?? (r.schema = n);
}
function ke(e, t, n) {
  var r;
  let i = e.inst?._zod?.traits;
  i?.has(`$ZodType`) &&
    (i.has(`$ZodCheck`) ? ((r = e).schema ?? (r.schema = e.inst)) : (e.schema = e.inst));
  let a = e.schema === e.inst ? void 0 : e.schema?._zod.def?.error,
    o = e.message
      ? e.message
      : (De(e.inst?._zod.def?.error?.(e)) ??
        De(a?.(e)) ??
        De(t?.error?.(e)) ??
        De(n.customError?.(e)) ??
        De(n.localeError?.(e)) ??
        `Invalid input`),
    s = {};
  for (let t of Object.keys(e))
    t === `inst` ||
      t === `schema` ||
      t === `continue` ||
      t === `input` ||
      t === `__proto__` ||
      (s[t] = e[t]);
  return ((s.path ??= []), (s.message = o), t?.reportInput && (s.input = e.input), s);
}
var Ae = /[\uD800-\uDBFF]/;
function je(e) {
  let t = e.length;
  if (!Ae.test(e)) return t;
  let n = t;
  for (let r = 0; r < t - 1; r++)
    (e.charCodeAt(r) & 64512) == 55296 && (e.charCodeAt(r + 1) & 64512) == 56320 && (n--, r++);
  return n;
}
function Me(e) {
  return Array.isArray(e) ? `array` : typeof e == `string` ? `string` : `unknown`;
}
function Ne(e) {
  let t = typeof e;
  switch (t) {
    case `number`:
      return Number.isNaN(e) ? `nan` : `number`;
    case `object`: {
      if (e === null) return `null`;
      if (Array.isArray(e)) return `array`;
      let t = e;
      if (t && Object.getPrototypeOf(t) !== Object.prototype && `constructor` in t && t.constructor)
        return t.constructor.name;
    }
  }
  return t;
}
function Pe(...e) {
  let [t, n, r] = e;
  return typeof t == `string` ? { message: t, code: `custom`, input: n, inst: r } : { ...t };
}
function Fe(e, t) {
  for (let n in t) {
    let r = Object.getOwnPropertyDescriptor(t, n);
    r.get ? Object.defineProperty(e, n, { ...r, enumerable: !1 }) : ze(e, n, r.value);
  }
}
function Ie(e, t, n, r = !0) {
  return (
    Object.defineProperty(e, t, { configurable: !0, writable: !0, enumerable: r, value: n }), n
  );
}
function Le(e, t, n) {
  return Ie(e, t, n, !1);
}
function Re(e, t) {
  for (let n in e) {
    let r = e[n];
    Object.defineProperty(t, n, {
      configurable: !0,
      enumerable: !0,
      get() {
        return Ie(this, n, r(this));
      },
      set(e) {
        Ie(this, n, e);
      },
    });
  }
  return t;
}
function ze(e, t, n) {
  Object.defineProperty(e, t, {
    configurable: !0,
    get() {
      return this == null ? n : Ie(this, t, n.bind(this));
    },
    set(e) {
      Ie(this, t, e);
    },
  });
}
function Be(e, t) {
  let n = Object.getPrototypeOf(e);
  return t in n ? void 0 : n;
}
var Ve,
  He = !1,
  Ue = {
    configurable: !0,
    get() {
      He = !0;
    },
  };
function g(e, t, n) {
  let r = Object.getPrototypeOf(e._zod);
  if (t in r && Ve !== e._zod) {
    Ve = void 0;
    return;
  }
  ((Ve = e._zod),
    Object.defineProperty(r, t, {
      configurable: !0,
      get() {
        Object.defineProperty(this, t, Ue);
        let e = He;
        He = !1;
        try {
          let r = n(this);
          return (
            He
              ? delete this[t]
              : Object.defineProperty(this, t, { configurable: !0, writable: !0, value: r }),
            (He ||= e),
            r
          );
        } catch (n) {
          throw (delete this[t], (He ||= e), n);
        }
      },
      set(e) {
        Object.defineProperty(this, t, { configurable: !0, writable: !0, value: e });
      },
    }));
}
function We(e, t, n, r) {
  let i = Be(e, t);
  i &&
    Object.defineProperty(i, t, {
      configurable: !0,
      get() {
        let e = { configurable: !0, writable: !0, enumerable: r, value: void 0 };
        return (
          Object.defineProperty(this, t, e),
          (e.value = n(this)),
          Object.defineProperty(this, t, e),
          e.value
        );
      },
      set(e) {
        Object.defineProperty(this, t, { configurable: !0, writable: !0, enumerable: r, value: e });
      },
    });
}
var Ge = `~constantCatch`;
function Ke(e) {
  let t = () => e;
  return ((t[Ge] = !0), t);
}
var qe,
  Je = { value: void 0, enumerable: !1 },
  Ye = `captureStackTrace` in Error ? Error : null;
function Xe(e) {
  let t = Ye;
  if (t) {
    let n = t.stackTraceLimit;
    if (typeof n == `number`) {
      try {
        t.stackTraceLimit = 0;
      } catch {
        return ((Ye = null), new e());
      }
      try {
        return new e();
      } finally {
        t.stackTraceLimit = n;
      }
    }
  }
  return new e();
}
function _(e, t, n, r) {
  let i = {};
  function a(e) {
    ((this.def = e), (this.constr = d), (this.traits = new Set()));
  }
  a.prototype = i;
  let o = n,
    s = o && new WeakSet();
  function c(n, r) {
    if (!n._zod) {
      Je.value = new a(r);
      try {
        Object.defineProperty(n, `_zod`, Je);
      } finally {
        Je.value = void 0;
      }
    } else if (n._zod.traits.has(e)) return;
    if ((n._zod.traits.add(e), t(n, r), s)) {
      let e = Object.getPrototypeOf(n),
        t = n._zod.constr.prototype,
        r = e;
      for (; r && r !== t; ) r = Object.getPrototypeOf(r);
      let i = r ?? e;
      s.has(i) || (s.add(i), Fe(i, o));
    }
    let i = d.prototype;
    for (let e in i)
      Object.prototype.hasOwnProperty.call(i, e) && (e in n || (n[e] = i[e].bind(n)));
  }
  let l = r?.Parent ?? Object;
  class u extends l {}
  Object.defineProperty(u, `name`, { value: e });
  function d(e) {
    let t = r?.Parent ? Xe(u) : this;
    c(t, e);
    let n = t._zod.deferred;
    if (n) {
      for (let e of n) e();
      t._zod.deferred = void 0;
    }
    let i = globalThis.__zod_globalConfig?.postProcessor;
    return (i && i(t), t);
  }
  return (
    Object.defineProperty(d, `init`, { value: c }),
    Object.defineProperty(d, Symbol.hasInstance, {
      value: (t) => (r?.Parent && t instanceof r.Parent ? !0 : t?._zod?.traits?.has(e)),
    }),
    Object.defineProperty(d, `name`, { value: e }),
    d
  );
}
var Ze = class extends Error {
    constructor() {
      super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
    }
  },
  Qe = class extends Error {
    constructor(e) {
      (super(`Encountered unidirectional transform during encode: ${e}`),
        (this.name = `ZodEncodeError`));
    }
  };
(qe = globalThis).__zod_globalConfig ?? (qe.__zod_globalConfig = {});
var $e = globalThis.__zod_globalConfig;
function et(e) {
  return (e && Object.assign($e, e), $e);
}
function tt() {
  let e = this._zod;
  return ((e.message ??= JSON.stringify(e.def, n, 2)), e.message);
}
function nt(e) {
  this._zod.message = e;
}
var rt = { get: tt, set: nt, enumerable: !0, configurable: !0 },
  it = { value: void 0, enumerable: !1 },
  at = new WeakSet([Object.prototype, Error.prototype]),
  ot = (e, t) => {
    ((e.name = `$ZodError`),
      (it.value = t),
      Object.defineProperty(e, `issues`, it),
      (it.value = void 0),
      Object.defineProperty(e, `message`, rt));
    let n = Object.getPrototypeOf(e);
    at.has(n) ||
      (at.add(n),
      Object.defineProperty(n, `toString`, {
        configurable: !0,
        enumerable: !1,
        get() {
          let e = () => this.message;
          return (
            Object.defineProperty(this, `toString`, { value: e, configurable: !0, writable: !0 }), e
          );
        },
        set(e) {
          Object.defineProperty(this, `toString`, { value: e, configurable: !0, writable: !0 });
        },
      }));
  },
  st = _(`$ZodError`, ot);
_(`$ZodError`, ot, void 0, { Parent: Error });
function ct(e, t, n) {
  return (
    Object.prototype.hasOwnProperty.call(e, t) ||
      (t === `__proto__`
        ? Object.defineProperty(e, t, {
            value: n(),
            writable: !0,
            enumerable: !0,
            configurable: !0,
          })
        : (e[t] = n())),
    e[t]
  );
}
function lt(e, t = (e) => e.message) {
  let n = {},
    r = [];
  for (let i of e.issues) i.path.length > 0 ? ct(n, i.path[0], () => []).push(t(i)) : r.push(t(i));
  return { formErrors: r, fieldErrors: n };
}
function ut(e, t = (e) => e.message) {
  let n = { _errors: [] },
    r = (e, i = []) => {
      for (let a of e.issues)
        if (a.code === `invalid_union` && a.errors.length)
          a.errors.map((e) => r({ issues: e }, [...i, ...a.path]));
        else if (a.code === `invalid_key`) r({ issues: a.issues }, [...i, ...a.path]);
        else if (a.code === `invalid_element`) r({ issues: a.issues }, [...i, ...a.path]);
        else {
          let e = [...i, ...a.path];
          if (e.length === 0) n._errors.push(t(a));
          else {
            let r = n,
              i = 0;
            for (; i < e.length; ) {
              let n = e[i],
                o = i === e.length - 1;
              if (n === `_errors`) {
                (o && r._errors.push(t(a)), i++);
                continue;
              }
              Object.prototype.hasOwnProperty.call(r, n) ||
                Object.defineProperty(r, n, {
                  value: { _errors: [] },
                  enumerable: !0,
                  writable: !0,
                  configurable: !0,
                });
              let s = r[n];
              (o && s._errors.push(t(a)), (r = s), i++);
            }
          }
        }
    };
  return (r(e), n);
}
function dt(e, t) {
  return { callee: t?.callee ?? e, Err: t?.Err };
}
var ft = (e) => {
    let t = (n, r, i, a) => {
      let o = i ? { ...i, async: !1 } : { async: !1 },
        s = n._zod.run({ value: r, issues: [] }, o);
      if (s instanceof Promise) throw new Ze();
      if (s.issues.length) {
        let n = new (a?.Err ?? e)(s.issues.map((e) => ke(e, o, et())));
        throw (re(n, a?.callee ?? t), n);
      }
      return s.value;
    };
    return t;
  },
  pt = (e) => {
    let t = async (n, r, i, a) => {
      let o = i ? { ...i, async: !0 } : { async: !0 },
        s = n._zod.run({ value: r, issues: [] }, o);
      if ((s instanceof Promise && (s = await s), s.issues.length)) {
        let n = new (a?.Err ?? e)(s.issues.map((e) => ke(e, o, et())));
        throw (re(n, a?.callee ?? t), n);
      }
      return s.value;
    };
    return t;
  },
  mt = (e) => (t, n, r) => {
    let i = r ? { ...r, async: !1 } : { async: !1 },
      a = t._zod.run({ value: n, issues: [] }, i);
    if (a instanceof Promise) throw new Ze();
    return a.issues.length ? ht(e, a.issues, i) : { success: !0, data: a.value };
  };
function ht(e, t, n) {
  let r;
  return {
    success: !1,
    get error() {
      return (r || ((r = new e(t.map((e) => ke(e, n, et())))), (t = void 0), (n = void 0)), r);
    },
    set error(e) {
      ((r = e), (t = void 0), (n = void 0));
    },
  };
}
var gt = (e) => async (t, n, r) => {
    let i = r ? { ...r, async: !0 } : { async: !0 },
      a = t._zod.run({ value: n, issues: [] }, i);
    return (
      a instanceof Promise && (a = await a),
      a.issues.length ? ht(e, a.issues, i) : { success: !0, data: a.value }
    );
  },
  _t = Symbol.for(`zod.compile.invalid`),
  vt = Symbol.for(`zod.compile.fallback`),
  yt = (e, t, n) => {
    let r = e._zod.bag.validator;
    if (r !== void 0) {
      if (r(t) !== _t) return !0;
      if (r.definite === !0 && n === void 0) return !1;
    }
    return bt(e, t, n);
  };
function bt(e, t, n) {
  let r = n ? { ...n, async: !1, abortEarly: !0 } : { async: !1, abortEarly: !0 },
    i = e._zod.bag.fallbackRun,
    a;
  if (
    (i
      ? ((r[vt] = !0), (a = i({ value: t, issues: [] }, r)))
      : (a = e._zod.run({ value: t, issues: [] }, r)),
    a instanceof Promise)
  )
    throw new Ze();
  return a.issues.length === 0;
}
var xt = async (e, t, n) => {
    let r = n ? { ...n, async: !0, abortEarly: !0 } : { async: !0, abortEarly: !0 },
      i = e._zod.run({ value: t, issues: [] }, r);
    return (i instanceof Promise && (i = await i), i.issues.length === 0);
  },
  St = (e) => {
    let t = ft(e),
      n = (e, r, i, a) =>
        t(e, r, i ? { ...i, direction: `backward` } : { direction: `backward` }, dt(n, a));
    return n;
  },
  Ct = (e) => {
    let t = ft(e),
      n = (e, r, i, a) => t(e, r, i, dt(n, a));
    return n;
  },
  wt = (e) => {
    let t = pt(e),
      n = async (e, r, i, a) =>
        await t(e, r, i ? { ...i, direction: `backward` } : { direction: `backward` }, dt(n, a));
    return n;
  },
  Tt = (e) => {
    let t = pt(e),
      n = async (e, r, i, a) => await t(e, r, i, dt(n, a));
    return n;
  },
  Et = (e) => (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` };
    return mt(e)(t, n, i);
  },
  Dt = (e) => (t, n, r) => mt(e)(t, n, r),
  Ot = (e) => async (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` };
    return gt(e)(t, n, i);
  },
  kt = (e) => async (t, n, r) => gt(e)(t, n, r),
  At = /^[cC][0-9a-z]{6,}$/,
  jt = /^[0-9a-z]+$/,
  Mt = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/,
  Nt = /^[0-9a-vA-V]{20}$/,
  Pt = /^[A-Za-z0-9]{27}$/,
  Ft = /^[a-zA-Z0-9_-]{21}$/;
function It(e) {
  return RegExp(`^[a-zA-Z0-9_-]{${e}}$`);
}
var Lt =
    /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/,
  Rt = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  zt = (e) =>
    e
      ? RegExp(
          `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`,
        )
      : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/,
  Bt =
    /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/,
  Vt = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function Ht() {
  return new RegExp(Vt, `u`);
}
var Ut =
    /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
  Wt =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/,
  Gt =
    /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/,
  Kt =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
  qt = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/,
  Jt = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/,
  Yt = /^https?$/,
  Xt = /^\+[1-9]\d{6,14}$/,
  Zt = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function Qt(e) {
  return RegExp(`^${e}$`);
}
var $t = Qt(Zt);
function en(e) {
  let t = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  return typeof e.precision == `number`
    ? e.precision === -1
      ? `${t}`
      : e.precision === 0
        ? `${t}:[0-5]\\d`
        : `${t}:[0-5]\\d\\.\\d{${e.precision}}`
    : e.seconds
      ? `${t}:[0-5]\\d(?:\\.\\d+)?`
      : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function tn(e) {
  return RegExp(`^${en(e)}$`);
}
function nn(e) {
  let t = [`Z`];
  e.offset && t.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  let n = `${en({ precision: e.precision, seconds: !0 })}(?:${t.join(`|`)})`,
    r = e.local ? `${n}|${en({ precision: e.precision })}` : n;
  return RegExp(`^${Zt}T(?:${r})$`);
}
var rn = /^[\s\S]{0,}$/,
  an = /^-?\d+$/,
  on = /^-?\d+(?:\.\d+)?$/,
  sn = /^(?:true|false)$/i,
  cn = /^undefined$/i,
  ln = /^[^A-Z]*$/,
  un = /^[^a-z]*$/,
  dn = _(`$ZodCheck`, (e, t) => {
    var n;
    ((e._zod ??= {}), (e._zod.def = t), (n = e._zod).onattach ?? (n.onattach = []));
  }),
  fn = (e) => {
    let t = e.value;
    return !a(t) && t.length !== void 0;
  },
  pn = { number: `number`, bigint: `bigint`, object: `date` },
  mn = _(`$ZodCheckLessThan`, (e, t) => {
    dn.init(e, t);
    let n = pn[typeof t.value];
    e._zod.check = (r) => {
      (t.inclusive ? r.value <= t.value : r.value < t.value) ||
        r.issues.push({
          origin: pn[typeof r.value] ?? n,
          code: `too_big`,
          maximum: typeof t.value == `object` ? t.value.getTime() : t.value,
          input: r.value,
          inclusive: t.inclusive,
          inst: e,
          continue: !t.abort,
        });
    };
  }),
  hn = _(`$ZodCheckGreaterThan`, (e, t) => {
    dn.init(e, t);
    let n = pn[typeof t.value];
    e._zod.check = (r) => {
      (t.inclusive ? r.value >= t.value : r.value > t.value) ||
        r.issues.push({
          origin: pn[typeof r.value] ?? n,
          code: `too_small`,
          minimum: typeof t.value == `object` ? t.value.getTime() : t.value,
          input: r.value,
          inclusive: t.inclusive,
          inst: e,
          continue: !t.abort,
        });
    };
  }),
  gn = _(`$ZodCheckMultipleOf`, (e, t) => {
    (dn.init(e, t),
      (e._zod.check = (n) => {
        if (typeof n.value != typeof t.value)
          throw Error(`Cannot mix number and bigint in multiple_of check.`);
        (typeof n.value == `bigint`
          ? t.value !== BigInt(0) && n.value % t.value === BigInt(0)
          : s(n.value, t.value) === 0) ||
          n.issues.push({
            origin: typeof n.value,
            code: `not_multiple_of`,
            divisor: t.value,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  _n = _(`$ZodCheckNumberFormat`, (e, t) => {
    (dn.init(e, t), (t.format = t.format || `float64`));
    let n = t.format?.includes(`int`),
      r = n ? `int` : `number`,
      [i, a] = pe[t.format];
    e._zod.check = (o) => {
      let s = o.value;
      if (n) {
        if (!Number.isInteger(s)) {
          o.issues.push({
            expected: r,
            format: t.format,
            code: `invalid_type`,
            continue: !1,
            input: s,
            inst: e,
          });
          return;
        }
        if (!Number.isSafeInteger(s)) {
          s > 0
            ? o.issues.push({
                input: s,
                code: `too_big`,
                maximum: 2 ** 53 - 1,
                note: `Integers must be within the safe integer range.`,
                inst: e,
                origin: r,
                inclusive: !0,
                continue: !t.abort,
              })
            : o.issues.push({
                input: s,
                code: `too_small`,
                minimum: -(2 ** 53 - 1),
                note: `Integers must be within the safe integer range.`,
                inst: e,
                origin: r,
                inclusive: !0,
                continue: !t.abort,
              });
          return;
        }
      }
      (s < i &&
        o.issues.push({
          origin: `number`,
          input: s,
          code: `too_small`,
          minimum: i,
          inclusive: !0,
          inst: e,
          continue: !t.abort,
        }),
        s > a &&
          o.issues.push({
            origin: `number`,
            input: s,
            code: `too_big`,
            maximum: a,
            inclusive: !0,
            inst: e,
            continue: !t.abort,
          }));
    };
  }),
  vn = _(`$ZodCheckMaxLength`, (e, t) => {
    var n;
    (dn.init(e, t),
      (n = e._zod.def).when ?? (n.when = fn),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length;
        if ((typeof r == `string` && i > t.maximum ? je(r) : i) <= t.maximum) return;
        let a = Me(r);
        n.issues.push({
          origin: a,
          code: `too_big`,
          maximum: t.maximum,
          inclusive: !0,
          input: r,
          inst: e,
          continue: !t.abort,
        });
      }));
  }),
  yn = _(`$ZodCheckMinLength`, (e, t) => {
    var n;
    (dn.init(e, t),
      (n = e._zod.def).when ?? (n.when = fn),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length;
        if ((typeof r == `string` && i >= t.minimum && i < t.minimum * 2 ? je(r) : i) >= t.minimum)
          return;
        let a = Me(r);
        n.issues.push({
          origin: a,
          code: `too_small`,
          minimum: t.minimum,
          inclusive: !0,
          input: r,
          inst: e,
          continue: !t.abort,
        });
      }));
  }),
  bn = _(`$ZodCheckLengthEquals`, (e, t) => {
    var n;
    (dn.init(e, t),
      (n = e._zod.def).when ?? (n.when = fn),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length,
          a = typeof r == `string` && i >= t.length && i <= t.length * 2 ? je(r) : i;
        if (a === t.length) return;
        let o = Me(r),
          s = a > t.length;
        n.issues.push({
          origin: o,
          ...(s
            ? { code: `too_big`, maximum: t.length }
            : { code: `too_small`, minimum: t.length }),
          inclusive: !0,
          exact: !0,
          input: n.value,
          inst: e,
          continue: !t.abort,
        });
      }));
  }),
  xn = _(`$ZodCheckStringFormat`, (e, t) => {
    var n, r;
    (dn.init(e, t),
      t.pattern
        ? ((n = e._zod).check ??
          (n.check = (n) => {
            ((t.pattern.lastIndex = 0),
              !t.pattern.test(n.value) &&
                n.issues.push({
                  origin: `string`,
                  code: `invalid_format`,
                  format: t.format,
                  input: n.value,
                  ...(t.pattern ? { pattern: t.pattern.toString() } : {}),
                  inst: e,
                  continue: !t.abort,
                }));
          }))
        : ((r = e._zod).check ?? (r.check = () => {})));
  }),
  Sn = _(`$ZodCheckRegex`, (e, t) => {
    (xn.init(e, t),
      (e._zod.check = (n) => {
        ((t.pattern.lastIndex = 0),
          !t.pattern.test(n.value) &&
            n.issues.push({
              origin: `string`,
              code: `invalid_format`,
              format: `regex`,
              input: n.value,
              pattern: t.pattern.toString(),
              inst: e,
              continue: !t.abort,
            }));
      }));
  }),
  Cn = _(`$ZodCheckLowerCase`, (e, t) => {
    ((t.pattern ??= ln), xn.init(e, t));
  }),
  wn = _(`$ZodCheckUpperCase`, (e, t) => {
    ((t.pattern ??= un), xn.init(e, t));
  }),
  Tn = _(`$ZodCheckIncludes`, (e, t) => {
    dn.init(e, t);
    let n = le(t.includes);
    ((t.pattern = new RegExp(typeof t.position == `number` ? `^.{${t.position},}${n}` : n)),
      (e._zod.check = (n) => {
        n.value.includes(t.includes, t.position) ||
          n.issues.push({
            origin: `string`,
            code: `invalid_format`,
            format: `includes`,
            includes: t.includes,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  En = _(`$ZodCheckStartsWith`, (e, t) => {
    dn.init(e, t);
    let n = RegExp(`^${le(t.prefix)}.*`);
    ((t.pattern ??= n),
      (e._zod.check = (n) => {
        n.value.startsWith(t.prefix) ||
          n.issues.push({
            origin: `string`,
            code: `invalid_format`,
            format: `starts_with`,
            prefix: t.prefix,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  Dn = _(`$ZodCheckEndsWith`, (e, t) => {
    dn.init(e, t);
    let n = RegExp(`.*${le(t.suffix)}$`);
    ((t.pattern ??= n),
      (e._zod.check = (n) => {
        n.value.endsWith(t.suffix) ||
          n.issues.push({
            origin: `string`,
            code: `invalid_format`,
            format: `ends_with`,
            suffix: t.suffix,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  On = _(`$ZodCheckOverwrite`, (e, t) => {
    (dn.init(e, t),
      (e._zod.check = (e) => {
        e.value = t.tx(e.value);
      }));
  }),
  kn = class {
    constructor(e = [], t = {}) {
      ((this.content = []), (this.indent = 0), (this.args = e), (this.closed = t));
    }
    indented(e) {
      this.indent += 1;
      try {
        e(this);
      } finally {
        --this.indent;
      }
    }
    write(e) {
      if (typeof e == `function`) {
        (e(this, { execution: `sync` }), e(this, { execution: `async` }));
        return;
      }
      let t = e
          .split(`
`)
          .filter((e) => e),
        n = Math.min(...t.map((e) => e.length - e.trimStart().length)),
        r = t.map((e) => e.slice(n)).map((e) => ` `.repeat(this.indent * 2) + e);
      for (let e of r) this.content.push(e);
    }
    compile() {
      let e = Function,
        t = this?.content ?? [``];
      return new e(
        ...Object.keys(this.closed),
        `return function (${this.args.join(`, `)}) {\n${t.join(`
`)}\n};`,
      )(...Object.values(this.closed));
    }
  },
  An = { major: 4, minor: 6, patch: 5 },
  v = _(
    `$ZodType`,
    (e, t) => {
      var n;
      ((e ??= {}), (e._zod.def = t), (e._zod.bag = e._zod.bag || {}), (e._zod.version = An));
      let r = e._zod.def.checks,
        i = e._zod.traits.has(`$ZodCheck`) ? [e, ...(r ?? [])] : r?.length ? [...r] : [];
      for (let t of i) for (let n of t._zod.onattach) n(e);
      if (i.length === 0)
        ((n = e._zod).deferred ?? (n.deferred = []),
          e._zod.deferred?.push(() => {
            e._zod.run = e._zod.parse;
          }));
      else {
        let t = (t, n, r) => {
            if (t.memo) return t;
            let i = we(t),
              a;
            for (let o of n) {
              if (o._zod.def.when) {
                if (Te(t) || !o._zod.def.when(t)) continue;
              } else if (i) continue;
              let n = t.issues.length,
                s = o._zod.check(t);
              if (s instanceof Promise && r?.async === !1) throw new Ze();
              if (a || s instanceof Promise)
                a = (a ?? Promise.resolve()).then(async () => {
                  (await s, t.issues.length !== n && (Oe(t.issues, n, e), (i ||= we(t, n))));
                });
              else {
                if (t.issues.length === n) continue;
                (Oe(t.issues, n, e), (i ||= we(t, n)));
              }
            }
            return a ? a.then(() => t) : t;
          },
          n = (n, r, a) => {
            if (we(n)) return ((n.aborted = !0), n);
            let o = t(r, i, a);
            if (o instanceof Promise) {
              if (a.async === !1) throw new Ze();
              return o.then((t) => e._zod.parse(t, a));
            }
            return e._zod.parse(o, a);
          };
        e._zod.run = (r, a) => {
          if (a.skipChecks) return e._zod.parse(r, a);
          if (a.direction === `backward`) {
            let t = e._zod.parse({ value: r.value, issues: [] }, { ...a, skipChecks: !0 });
            return t instanceof Promise ? t.then((e) => n(e, r, a)) : n(t, r, a);
          }
          let o = e._zod.parse(r, a);
          if (o instanceof Promise) {
            if (a.async === !1) throw new Ze();
            return o.then((e) => t(e, i, a));
          }
          return t(o, i, a);
        };
      }
    },
    {
      get "~standard"() {
        return Le(this, `~standard`, Nn(this));
      },
      set "~standard"(e) {
        Ie(this, `~standard`, e);
      },
    },
  ),
  jn = (e, t) =>
    e.issues.length ? { issues: e.issues.map((e) => ke(e, t, et())) } : { value: e.value };
async function Mn(e, t) {
  let n = { async: !0 };
  return jn(await e._zod.run({ value: t, issues: [] }, n), n);
}
function Nn(e) {
  return {
    validate: (t) => {
      let n = { async: !1 };
      try {
        let r = e._zod.run({ value: t, issues: [] }, n);
        if (!(r instanceof Promise)) return jn(r, n);
      } catch {}
      return Mn(e, t);
    },
    vendor: `zod`,
    version: 1,
  };
}
var Pn = _(`$ZodString`, (e, t) => {
    (v.init(e, t),
      (e._zod.pattern = t.pattern ?? rn),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = String(n.value);
          } catch {}
        return (
          typeof n.value == `string` ||
            n.issues.push({ expected: `string`, code: `invalid_type`, input: n.value, inst: e }),
          n
        );
      }));
  }),
  y = _(`$ZodStringFormat`, (e, t) => {
    (xn.init(e, t), Pn.init(e, t));
  }),
  Fn = _(`$ZodGUID`, (e, t) => {
    ((t.pattern ??= Rt), y.init(e, t));
  }),
  In = _(`$ZodUUID`, (e, t) => {
    if (t.version) {
      let e = { v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8 }[t.version];
      if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`);
      t.pattern ??= zt(e);
    } else t.pattern ??= zt();
    y.init(e, t);
  }),
  Ln = _(`$ZodEmail`, (e, t) => {
    ((t.pattern ??= Bt), y.init(e, t));
  });
function Rn(e) {
  try {
    return typeof URL < `u` && typeof URL.canParse == `function`
      ? URL.canParse(e)
      : (new URL(e), !0);
  } catch {
    return !1;
  }
}
function zn(e, t) {
  return !(`normalize` in t) && !(`hostname` in t) && !(`protocol` in t) ? Rn(e) || 2 : Bn(e, t);
}
function Bn(e, t) {
  if (!t.normalize && t.protocol?.source === Yt.source && !/^https?:\/\//i.test(e)) return 1;
  try {
    if (typeof URL < `u`) {
      let t = URL;
      if (typeof t.parse == `function`) return t.parse(e) ?? 2;
    }
    return new URL(e);
  } catch {
    return 2;
  }
}
var Vn = /[\t\n\r]/g;
function Hn(e) {
  return e.replace(Vn, ``);
}
function Un(e, t) {
  return ((t.lastIndex = 0), t.test(e.hostname));
}
function Wn(e, t) {
  return (
    (t.lastIndex = 0), t.test(e.protocol.endsWith(`:`) ? e.protocol.slice(0, -1) : e.protocol)
  );
}
var Gn = _(`$ZodURL`, (e, t) => {
    (y.init(e, t),
      (e._zod.check = (n) => {
        try {
          let r = n.value.trim(),
            i = zn(r, t);
          if (i === 1) {
            n.issues.push({
              code: `invalid_format`,
              format: `url`,
              note: `Invalid URL format`,
              input: n.value,
              inst: e,
              continue: !t.abort,
            });
            return;
          }
          if (i === 2) {
            n.issues.push({
              code: `invalid_format`,
              format: `url`,
              input: n.value,
              inst: e,
              continue: !t.abort,
            });
            return;
          }
          if (i === !0) {
            n.value = Hn(r);
            return;
          }
          (t.hostname &&
            !Un(i, t.hostname) &&
            n.issues.push({
              code: `invalid_format`,
              format: `url`,
              note: `Invalid hostname`,
              pattern: t.hostname.source,
              input: n.value,
              inst: e,
              continue: !t.abort,
            }),
            t.protocol &&
              !Wn(i, t.protocol) &&
              n.issues.push({
                code: `invalid_format`,
                format: `url`,
                note: `Invalid protocol`,
                pattern: t.protocol.source,
                input: n.value,
                inst: e,
                continue: !t.abort,
              }),
            (n.value = t.normalize ? i.href : Hn(r)));
          return;
        } catch {
          n.issues.push({
            code: `invalid_format`,
            format: `url`,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
        }
      }));
  }),
  Kn = _(`$ZodEmoji`, (e, t) => {
    ((t.pattern ??= Ht()), y.init(e, t));
  }),
  qn = _(`$ZodNanoID`, (e, t) => {
    if (t.length !== void 0 && (!Number.isInteger(t.length) || t.length < 1))
      throw Error(`Invalid nanoid length: ${t.length}`);
    ((t.pattern ??= t.length === void 0 ? Ft : It(t.length)), y.init(e, t));
  }),
  Jn = _(`$ZodCUID`, (e, t) => {
    ((t.pattern ??= At), y.init(e, t));
  }),
  Yn = _(`$ZodCUID2`, (e, t) => {
    ((t.pattern ??= jt), y.init(e, t));
  }),
  Xn = _(`$ZodULID`, (e, t) => {
    ((t.pattern ??= Mt), y.init(e, t));
  }),
  Zn = _(`$ZodXID`, (e, t) => {
    ((t.pattern ??= Nt), y.init(e, t));
  }),
  Qn = _(`$ZodKSUID`, (e, t) => {
    ((t.pattern ??= Pt), y.init(e, t));
  }),
  $n = _(`$ZodISODateTime`, (e, t) => {
    ((t.pattern ??= nn(t)), y.init(e, t));
  }),
  er = _(`$ZodISODate`, (e, t) => {
    ((t.pattern ??= $t), y.init(e, t));
  }),
  tr = _(`$ZodISOTime`, (e, t) => {
    ((t.pattern ??= tn(t)), y.init(e, t));
  }),
  nr = _(`$ZodISODuration`, (e, t) => {
    ((t.pattern ??= Lt), y.init(e, t));
  }),
  rr = _(`$ZodIPv4`, (e, t) => {
    ((t.pattern ??= Ut), y.init(e, t));
  }),
  ir = /^[0-9a-fA-F:.]+$/;
function ar(e) {
  return ir.test(e) ? Rn(`http://[${e}]`) : !1;
}
var or = _(`$ZodIPv6`, (e, t) => {
    ((t.pattern ??= Wt),
      y.init(e, t),
      (e._zod.check = (n) => {
        ar(n.value) ||
          n.issues.push({
            code: `invalid_format`,
            format: `ipv6`,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  sr = _(`$ZodCIDRv4`, (e, t) => {
    ((t.pattern ??= Gt), y.init(e, t));
  });
function cr(e) {
  let t = e.split(`/`);
  if (t.length !== 2) return !1;
  let [n, r] = t;
  if (!r) return !1;
  let i = Number(r);
  return `${i}` !== r || i < 0 || i > 128 ? !1 : ar(n);
}
var lr = _(`$ZodCIDRv6`, (e, t) => {
  ((t.pattern ??= Kt),
    y.init(e, t),
    (e._zod.check = (n) => {
      cr(n.value) ||
        n.issues.push({
          code: `invalid_format`,
          format: `cidrv6`,
          input: n.value,
          inst: e,
          continue: !t.abort,
        });
    }));
});
function ur(e) {
  if (e === ``) return !0;
  if (/\s/.test(e) || e.length % 4 != 0) return !1;
  try {
    return (atob(e), !0);
  } catch {
    return !1;
  }
}
var dr = /^[0-9a-zA-Z+/]*={0,2}$/,
  fr = _(`$ZodBase64`, (e, t) => {
    ((t.pattern ??= dr),
      y.init(e, t),
      (e._zod.check = (n) => {
        ur(n.value) ||
          n.issues.push({
            code: `invalid_format`,
            format: `base64`,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  pr = /^[A-Za-z0-9_-]*$/;
function mr(e) {
  if (!pr.test(e)) return !1;
  let t = e.replace(/[-_]/g, (e) => (e === `-` ? `+` : `/`));
  return ur(t.padEnd(Math.ceil(t.length / 4) * 4, `=`));
}
var hr = _(`$ZodBase64URL`, (e, t) => {
    ((t.pattern ??= pr),
      y.init(e, t),
      (e._zod.check = (n) => {
        mr(n.value) ||
          n.issues.push({
            code: `invalid_format`,
            format: `base64url`,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  gr = _(`$ZodE164`, (e, t) => {
    ((t.pattern ??= Xt), y.init(e, t));
  });
function _r(e, t = null) {
  try {
    let n = e.split(`.`);
    if (n.length !== 3) return !1;
    let [r] = n;
    if (!r) return !1;
    let i = JSON.parse(atob(r));
    return !((`typ` in i && i?.typ !== `JWT`) || !i.alg || (t && (!(`alg` in i) || i.alg !== t)));
  } catch {
    return !1;
  }
}
var vr = _(`$ZodJWT`, (e, t) => {
    (y.init(e, t),
      (e._zod.check = (n) => {
        _r(n.value, t.alg) ||
          n.issues.push({
            code: `invalid_format`,
            format: `jwt`,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  yr = _(`$ZodNumber`, (e, t) => {
    (v.init(e, t),
      (e._zod.pattern = on),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = Number(n.value);
          } catch {}
        let i = n.value;
        if (typeof i == `number` && !Number.isNaN(i) && Number.isFinite(i)) return n;
        let a =
          typeof i == `number`
            ? Number.isNaN(i)
              ? `NaN`
              : Number.isFinite(i)
                ? void 0
                : String(i)
            : void 0;
        return (
          n.issues.push({
            expected: `number`,
            code: `invalid_type`,
            input: i,
            inst: e,
            ...(a ? { received: a } : {}),
          }),
          n
        );
      }));
  }),
  br = _(`$ZodNumberFormat`, (e, t) => {
    (_n.init(e, t), yr.init(e, t));
  }),
  xr = _(`$ZodBoolean`, (e, t) => {
    (v.init(e, t),
      (e._zod.pattern = sn),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = !!n.value;
          } catch {}
        let i = n.value;
        return (
          typeof i == `boolean` ||
            n.issues.push({ expected: `boolean`, code: `invalid_type`, input: i, inst: e }),
          n
        );
      }));
  }),
  Sr = _(`$ZodUndefined`, (e, t) => {
    (v.init(e, t),
      (e._zod.pattern = cn),
      (e._zod.values = new Set([void 0])),
      (e._zod.parse = (t, n) => {
        let r = t.value;
        return (
          r === void 0 ||
            t.issues.push({ expected: `undefined`, code: `invalid_type`, input: r, inst: e }),
          t
        );
      }));
  }),
  Cr = _(`$ZodUnknown`, (e, t) => {
    (v.init(e, t), (e._zod.parse = (e) => e));
  }),
  wr = _(`$ZodNever`, (e, t) => {
    (v.init(e, t),
      (e._zod.parse = (t, n) => (
        t.issues.push({ expected: `never`, code: `invalid_type`, input: t.value, inst: e }), t
      )));
  }),
  Tr = _(`$ZodDate`, (e, t) => {
    (v.init(e, t),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = new Date(n.value);
          } catch {}
        let i = n.value,
          a = i instanceof Date;
        return (
          (a && !Number.isNaN(i.getTime())) ||
            n.issues.push({
              expected: `date`,
              code: `invalid_type`,
              input: i,
              ...(a ? { received: `Invalid Date` } : {}),
              inst: e,
            }),
          n
        );
      }));
  });
function Er(e, t, n) {
  (e.issues.length && t.issues.push(...Ee(n, e.issues)), (t.value[n] = e.value));
}
var Dr = _(`$ZodArray`, (e, t) => {
  v.init(e, t);
  let n = $e.memoizer;
  (n?.attach(e),
    (e._zod.parse = (r, i) => {
      let a = r.value;
      if (!Array.isArray(a))
        return (r.issues.push({ expected: `array`, code: `invalid_type`, input: a, inst: e }), r);
      r.value = n ? n.alloc(e, r, Array(a.length), i) : Array(a.length);
      let o = [],
        s = i?.abortEarly;
      for (let e = 0; e < a.length; e++) {
        let n = a[e],
          c = t.element._zod.run({ value: n, issues: [] }, i);
        if (c instanceof Promise) o.push(c.then((t) => Er(t, r, e)));
        else if ((Er(c, r, e), s && c.issues.length !== 0 && we(c))) break;
      }
      return o.length ? Promise.all(o).then(() => r) : r;
    }));
});
function Or(e, t, n, r, i, a) {
  let o = n in r,
    s = a === `optional`;
  if (!(!o && s && i === `optional`)) {
    if (e.issues.length) {
      if (i !== void 0 && s && !o) return;
      t.issues.push(...Ee(n, e.issues));
    }
    if (!o && i === void 0) {
      e.issues.length ||
        t.issues.push({ code: `invalid_type`, expected: `nonoptional`, input: void 0, path: [n] });
      return;
    }
    e.value === void 0
      ? (o || (i === `defaulted` && !s)) && (t.value[n] = void 0)
      : (t.value[n] = e.value);
  }
}
var kr = [];
function Ar(e) {
  let t = Object.keys(e.shape),
    n = Object.getOwnPropertySymbols(e.shape),
    r = n.length ? n : kr,
    i = r.length ? [...t, ...r] : t;
  for (let t of i)
    if (!e.shape?.[t]?._zod?.traits?.has(`$ZodType`))
      throw Error(`Invalid element at key "${String(t)}": expected a Zod schema`);
  let a = fe(e.shape);
  return {
    ...e,
    allKeys: i,
    symbolKeys: r,
    keySet: new Set(t),
    numKeys: t.length,
    optionalKeys: new Set(a),
  };
}
function jr(e, t, n, r, i, a, o) {
  let s = [],
    c = i.keySet,
    l = i.catchall._zod,
    u = l.def.type,
    d = l.optin,
    f = l.optout,
    p = 0;
  for (let i in t) {
    if (o && n.issues.length !== p) {
      if (we(n, p)) break;
      p = n.issues.length;
    }
    if (c.has(i)) continue;
    if (i === `__proto__`) {
      u === `never` && s.push(i);
      continue;
    }
    if (u === `never`) {
      s.push(i);
      continue;
    }
    let a = l.run({ value: t[i], issues: [] }, r);
    a instanceof Promise ? e.push(a.then((e) => Or(e, n, i, t, d, f))) : Or(a, n, i, t, d, f);
  }
  return (
    s.length &&
      n.issues.push({ code: `unrecognized_keys`, keys: s, input: t, inst: a, continue: !0 }),
    e.length ? Promise.all(e).then(() => n) : n
  );
}
var Mr = _(`$ZodObject`, (e, t) => {
    v.init(e, t);
    let n = Object.getOwnPropertyDescriptor(t, `shape`),
      r = n?.get ? n.get.raw : (t.shape ?? {});
    if (r) {
      let e = () => {
        let n = { ...r };
        return (Object.defineProperty(t, `shape`, { value: n }), (e.raw = n), n);
      };
      ((e.raw = r), Object.defineProperty(t, `shape`, { get: e }));
    }
    let a = i(() => Ar(t));
    g(e, `propValues`, (e) => {
      let t = e.def.shape,
        n = {};
      for (let e in t) {
        let r = t[e]._zod;
        if (r.values) {
          Object.prototype.hasOwnProperty.call(n, e) || c(n, e, new Set());
          for (let t of r.values) n[e].add(t);
          r.optin !== void 0 && n[e].add(void 0);
        }
      }
      return n;
    });
    let o = ie,
      s = t.catchall,
      l,
      u = $e.memoizer;
    (u?.attach(e),
      (e._zod.parse = (t, n) => {
        l ??= a.value;
        let r = t.value;
        if (!o(r))
          return (
            t.issues.push({ expected: `object`, code: `invalid_type`, input: r, inst: e }), t
          );
        t.value = u ? u.alloc(e, t, {}, n) : {};
        let i = [],
          c = l.shape,
          d = n?.abortEarly,
          f = t.issues.length;
        for (let e of l.allKeys) {
          if (d && t.issues.length !== f) {
            if (we(t, f)) break;
            f = t.issues.length;
          }
          if (e === `__proto__`) continue;
          let a = c[e],
            o = a._zod.optin,
            s = a._zod.optout,
            l = a._zod.run({ value: r[e], issues: [] }, n);
          l instanceof Promise ? i.push(l.then((n) => Or(n, t, e, r, o, s))) : Or(l, t, e, r, o, s);
        }
        return s
          ? jr(i, r, t, n, a.value, e, d === !0)
          : i.length
            ? Promise.all(i).then(() => t)
            : t;
      }));
  }),
  Nr = _(`$ZodObjectJIT`, (e, t) => {
    Mr.init(e, t);
    let n = e._zod.parse,
      r = i(() => Ar(t)),
      a = $e.memoizer,
      o = (t) => {
        let n = r.value,
          i = n.symbolKeys,
          o = new kn([`payload`, `ctx`], { shape: t, inst: e, memo: a, syms: i }),
          s = (e) => `shape[${e}]._zod.run({ value: input[${e}], issues: [] }, ctx)`,
          c = (e, t) => `
          let ${e}_ab = false;
          for (let i = 0; i < ${e}.issues.length; i++) {
            const iss = ${e}.issues[i];
            iss.path = iss.path ? [${t}, ...iss.path] : [${t}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${e}_ab = true;
          }
          if (${e}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
        o.write(`const input = payload.value;`);
        let l = Object.create(null),
          u = 0;
        for (let e of n.allKeys) l[e] = `key_${u++}`;
        o.write(
          a ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`,
        );
        for (let e of n.allKeys) {
          if (e === `__proto__`) continue;
          let n = l[e],
            r = typeof e == `symbol` ? `syms[${i.indexOf(e)}]` : te(e),
            a = `${r} in input`,
            u = t[e],
            d = u?._zod?.optin,
            f = d !== void 0,
            p = u?._zod?.optout === `optional`;
          if ((o.write(`const ${n} = ${s(r)};`), f && p)) {
            let e = d === `optional` ? `${n}_present` : `${n}.value !== undefined || ${n}_present`;
            o.write(`
        const ${n}_present = ${a};
        if (!${n}.issues.length || ${n}_present) {
          if (${n}.issues.length) {${c(n, r)}
          }

          if (${e}) {
            newResult[${r}] = ${n}.value;
          }
        }

      `);
          } else
            f
              ? (o.write(`
        if (${n}.issues.length) {${c(n, r)}
        }
      `),
                d === `defaulted`
                  ? o.write(`newResult[${r}] = ${n}.value;`)
                  : o.write(`
        if (${n}.value !== undefined || ${a}) {
          newResult[${r}] = ${n}.value;
        }
      `))
              : o.write(`
        const ${n}_present = ${a};
        if (${n}.issues.length) {${c(n, r)}
        }
        if (!${n}_present && !${n}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${r}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${n}_present) {
          newResult[${r}] = ${n}.value;
        }

      `);
        }
        return (o.write(`payload.value = newResult;`), o.write(`return payload;`), o.compile());
      },
      s,
      c = ie,
      l = !$e.jitless,
      u = l && ae.value,
      d = t.catchall,
      f;
    e._zod.parse = (i, a) => {
      f ??= r.value;
      let p = i.value;
      return c(p)
        ? l && u && a?.async === !1 && a.jitless !== !0
          ? ((s ||= o(t.shape)), (i = s(i, a)), d ? jr([], p, i, a, f, e, a?.abortEarly === !0) : i)
          : n(i, a)
        : (i.issues.push({ expected: `object`, code: `invalid_type`, input: p, inst: e }), i);
    };
  });
function Pr(e, t, n, r) {
  for (let n of e) if (n.issues.length === 0) return ((t.value = n.value), t);
  let i = e.filter((e) => !we(e));
  return i.length === 1
    ? ((t.value = i[0].value), i[0])
    : (t.issues.push({
        code: `invalid_union`,
        input: t.value,
        inst: n,
        errors: e.map((e) => e.issues.map((e) => ke(e, r, et()))),
      }),
      t);
}
var Fr = _(`$ZodUnion`, (e, t) => {
  (v.init(e, t),
    g(e, `optin`, (e) =>
      e.def.options.some((e) => e._zod.optin === `defaulted`)
        ? `defaulted`
        : e.def.options.some((e) => e._zod.optin !== void 0)
          ? `optional`
          : void 0,
    ),
    g(e, `optout`, (e) =>
      e.def.options.some((e) => e._zod.optout === `optional`) ? `optional` : void 0,
    ),
    g(e, `values`, (e) => {
      if (e.def.options.every((e) => e._zod.values))
        return new Set(e.def.options.flatMap((e) => Array.from(e._zod.values)));
    }),
    g(e, `pattern`, (e) => {
      if (e.def.options.every((e) => e._zod.pattern)) {
        let t = e.def.options.map((e) => e._zod.pattern);
        return RegExp(`^(${t.map((e) => o(e.source)).join(`|`)})$`);
      }
    }));
  let n = t.options.length === 1 ? t.options[0]._zod.run : null;
  e._zod.parse = (r, i) => {
    if (n) return n(r, i);
    let a = !1,
      o = [];
    for (let e of t.options) {
      let t = e._zod.run({ value: r.value, issues: [] }, i);
      if (t instanceof Promise) (o.push(t), (a = !0));
      else {
        if (t.issues.length === 0) return t;
        o.push(t);
      }
    }
    return a ? Promise.all(o).then((t) => Pr(t, r, e, i)) : Pr(o, r, e, i);
  };
});
function Ir(e) {
  let t = new Map();
  for (let n of e.options) {
    let r = n._zod.propValues?.[e.discriminator];
    if (!r || r.size === 0)
      throw Error(`Invalid discriminated union option at index "${e.options.indexOf(n)}"`);
    for (let e of r)
      if (t.has(e)) {
        if (e !== void 0) throw Error(`Duplicate discriminator value "${String(e)}"`);
        t.set(e, null);
      } else t.set(e, n);
  }
  return t;
}
var Lr = _(`$ZodDiscriminatedUnion`, (e, t) => {
    ((t.inclusive = !1), Fr.init(e, t));
    let n = e._zod.parse;
    (g(e, `propValues`, (e) => {
      let t = {},
        n = 0;
      for (let r of e.def.options) {
        let i = r._zod.propValues;
        if (!i || Object.keys(i).length === 0)
          throw Error(`Invalid discriminated union option at index "${e.def.options.indexOf(r)}"`);
        i[e.def.discriminator]?.has(void 0) && n++;
        for (let [e, n] of Object.entries(i)) {
          Object.prototype.hasOwnProperty.call(t, e) || c(t, e, new Set());
          for (let r of n) t[e].add(r);
        }
      }
      return (!e.def.unionFallback && n > 1 && t[e.def.discriminator]?.delete(void 0), t);
    }),
      t.options.forEach((e, n) => {
        let r = l(e._zod.def);
        if (r && !Object.prototype.hasOwnProperty.call(r, t.discriminator))
          throw Error(`Invalid discriminated union option at index "${n}"`);
      }));
    let r = i(() => Ir(t));
    e._zod.parse = (i, a) => {
      let o = i.value;
      if (!ie(o))
        return (i.issues.push({ code: `invalid_type`, expected: `object`, input: o, inst: e }), i);
      let s = o?.[t.discriminator],
        c = r.value.get(s);
      return c && (s !== void 0 || a.direction !== `backward`)
        ? c._zod.run(i, a)
        : t.unionFallback || a.direction === `backward`
          ? n(i, a)
          : (i.issues.push({
              code: `invalid_union`,
              errors: [],
              note: `No matching discriminator`,
              discriminator: t.discriminator,
              options: Array.from(r.value.keys()).filter((e) => r.value.get(e) !== null),
              input: o,
              path: [t.discriminator],
              inst: e,
            }),
            i);
    };
  }),
  Rr = _(`$ZodIntersection`, (e, t) => {
    (v.init(e, t),
      (e._zod.parse = (e, n) => {
        let r = e.value,
          i = t.left._zod.run({ value: r, issues: [] }, n),
          a = t.right._zod.run({ value: r, issues: [] }, n);
        return i instanceof Promise || a instanceof Promise
          ? Promise.all([i, a]).then(([t, n]) => Br(e, t, n))
          : Br(e, i, a);
      }));
  });
function zr(e, t) {
  if (e === t || (e instanceof Date && t instanceof Date && +e == +t))
    return { valid: !0, data: e };
  if (oe(e) && oe(t)) {
    let n = Object.keys(t),
      r = Object.keys(e).filter((e) => n.indexOf(e) !== -1),
      i = { ...e, ...t };
    Object.prototype.hasOwnProperty.call(i, `__proto__`) && delete i.__proto__;
    for (let n of r) {
      if (n === `__proto__`) continue;
      let r = zr(e[n], t[n]);
      if (!r.valid) return { valid: !1, mergeErrorPath: [n, ...r.mergeErrorPath] };
      i[n] = r.data;
    }
    return { valid: !0, data: i };
  }
  if (Array.isArray(e) && Array.isArray(t)) {
    if (e.length !== t.length) return { valid: !1, mergeErrorPath: [] };
    let n = [];
    for (let r = 0; r < e.length; r++) {
      let i = e[r],
        a = t[r],
        o = zr(i, a);
      if (!o.valid) return { valid: !1, mergeErrorPath: [r, ...o.mergeErrorPath] };
      n.push(o.data);
    }
    return { valid: !0, data: n };
  }
  return { valid: !1, mergeErrorPath: [] };
}
function Br(e, t, n) {
  let r = new Map(),
    i,
    a = new Map(),
    o = (e, t) => {
      let n;
      if (e.code === `unrecognized_keys` && !e.path?.length) ((i ??= e), (n = e.keys));
      else if (e.code === `invalid_key` && e.origin === `record` && e.path?.length === 1) {
        let t = String(e.path[0]);
        (a.has(t) || a.set(t, e), (n = [t]));
      } else return !1;
      for (let e of n) (r.has(e) || r.set(e, {}), (r.get(e)[t] = !0));
      return !0;
    };
  for (let n of t.issues) o(n, `l`) || e.issues.push(n);
  for (let t of n.issues) o(t, `r`) || e.issues.push(t);
  let s = [...r].filter(([, e]) => e.l && e.r).map(([e]) => e);
  if (s.length) {
    let t = i ? s.filter((e) => i.keys.includes(e)) : [];
    t.length && e.issues.push({ ...i, keys: t });
    for (let n of s) !t.includes(n) && a.has(n) && e.issues.push(a.get(n));
  }
  let c = zr(t.value, n.value);
  if (!c.valid) {
    if (we(e)) return e;
    throw Error(`Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`);
  }
  return ((e.value = c.data), e);
}
var Vr = _(`$ZodRecord`, (e, t) => {
    v.init(e, t);
    let n = $e.memoizer;
    (n?.attach(e),
      (e._zod.parse = (r, i) => {
        let a = r.value;
        if (!oe(a))
          return (
            r.issues.push({ expected: `record`, code: `invalid_type`, input: a, inst: e }), r
          );
        let o = [],
          s = t.keyType._zod.values;
        if (s && !t.partial) {
          r.value = n ? n.alloc(e, r, {}, i) : {};
          let c = new Set();
          for (let n of s)
            if (typeof n == `string` || typeof n == `number` || typeof n == `symbol`) {
              if ((c.add(typeof n == `number` ? n.toString() : n), n === `__proto__`)) continue;
              let s = t.keyType._zod.run({ value: n, issues: [] }, i);
              if (s instanceof Promise)
                throw Error(`Async schemas not supported in object keys currently`);
              if (s.issues.length) {
                r.issues.push({
                  code: `invalid_key`,
                  origin: `record`,
                  issues: s.issues.map((e) => ke(e, i, et())),
                  input: n,
                  path: [n],
                  inst: e,
                });
                continue;
              }
              let l = s.value;
              if (l === `__proto__`) continue;
              let u = t.valueType._zod.run({ value: a[n], issues: [] }, i);
              u instanceof Promise
                ? o.push(
                    u.then((e) => {
                      (e.issues.length && r.issues.push(...Ee(n, e.issues)),
                        (r.value[l] = e.value));
                    }),
                  )
                : (u.issues.length && r.issues.push(...Ee(n, u.issues)), (r.value[l] = u.value));
            }
          let l;
          for (let e in a)
            if (!c.has(e))
              if (t.mode === `loose`) {
                if (e === `__proto__`) continue;
                r.value[e] = a[e];
              } else ((l ??= []), l.push(e));
          l &&
            l.length > 0 &&
            r.issues.push({ code: `unrecognized_keys`, input: a, inst: e, keys: l, continue: !0 });
        } else {
          r.value = n ? n.alloc(e, r, {}, i) : {};
          let c;
          for (let n of Reflect.ownKeys(a)) {
            if (n === `__proto__` || !Object.prototype.propertyIsEnumerable.call(a, n)) continue;
            let l = t.keyType._zod.run({ value: n, issues: [] }, i);
            if (l instanceof Promise)
              throw Error(`Async schemas not supported in object keys currently`);
            if (typeof n == `string` && on.test(n) && l.issues.length) {
              let e = t.keyType._zod.run({ value: Number(n), issues: [] }, i);
              if (e instanceof Promise)
                throw Error(`Async schemas not supported in object keys currently`);
              e.issues.length === 0 && (l = e);
            }
            if (l.issues.length) {
              t.mode === `loose`
                ? (r.value[n] = a[n])
                : s
                  ? ((c ??= []), c.push(n))
                  : r.issues.push({
                      code: `invalid_key`,
                      origin: `record`,
                      issues: l.issues.map((e) => ke(e, i, et())),
                      input: n,
                      path: [n],
                      inst: e,
                    });
              continue;
            }
            let u = l.value;
            if (u === `__proto__`) continue;
            let d = t.valueType._zod.run({ value: a[n], issues: [] }, i);
            d instanceof Promise
              ? o.push(
                  d.then((e) => {
                    (e.issues.length && r.issues.push(...Ee(n, e.issues)), (r.value[u] = e.value));
                  }),
                )
              : (d.issues.length && r.issues.push(...Ee(n, d.issues)), (r.value[u] = d.value));
          }
          c &&
            c.length > 0 &&
            r.issues.push({ code: `unrecognized_keys`, input: a, inst: e, keys: c, continue: !0 });
        }
        return o.length ? Promise.all(o).then(() => r) : r;
      }));
  }),
  Hr = _(`$ZodEnum`, (t, n) => {
    v.init(t, n);
    let r = e(n.entries),
      i = new Set(r);
    ((t._zod.values = i),
      g(t, `pattern`, (t) => {
        let n = e(t.def.entries).filter((e) => ce.has(typeof e));
        return RegExp(n.length ? `^(${n.map((e) => le(e.toString())).join(`|`)})$` : `^[^\\s\\S]$`);
      }),
      (t._zod.parse = (e, n) => {
        let a = e.value;
        return (
          i.has(a) || e.issues.push({ code: `invalid_value`, values: r, input: a, inst: t }), e
        );
      }));
  }),
  Ur = _(`$ZodLiteral`, (e, t) => {
    v.init(e, t);
    let n = new Set(t.values);
    ((e._zod.values = n),
      g(e, `pattern`, (e) => {
        let t = e.def.values;
        return RegExp(
          t.length
            ? `^(${t.map((e) => (typeof e == `string` ? le(e) : e ? le(e.toString()) : String(e))).join(`|`)})$`
            : `^[^\\s\\S]$`,
        );
      }),
      (e._zod.parse = (r, i) => {
        let a = r.value;
        return (
          n.has(a) || r.issues.push({ code: `invalid_value`, values: t.values, input: a, inst: e }),
          r
        );
      }));
  }),
  Wr = _(`$ZodTransform`, (e, t) => {
    (v.init(e, t),
      (e._zod.optin = `optional`),
      $e.memoizer?.guard(e),
      (e._zod.parse = (n, r) => {
        if (r.direction === `backward`) throw new Qe(e.constructor.name);
        let i = t.transform(n.value, n);
        if (r.async)
          return (i instanceof Promise ? i : Promise.resolve(i)).then((e) => ((n.value = e), n));
        if (i instanceof Promise) throw new Ze();
        return ((n.value = i), n);
      }));
  });
function Gr(e, t) {
  return ((e.value = t.issues.length ? void 0 : t.value), e);
}
var Kr = _(`$ZodOptional`, (e, t) => {
    (v.init(e, t),
      g(e, `optin`, (e) => (e.def.innerType._zod.optin === `defaulted` ? `defaulted` : `optional`)),
      (e._zod.optout = `optional`),
      g(e, `values`, (e) => {
        let t = e.def.innerType._zod.values;
        return t ? new Set([...t, void 0]) : void 0;
      }),
      g(e, `pattern`, (e) => {
        let t = e.def.innerType._zod.pattern;
        return t ? RegExp(`^(${o(t.source)})?$`) : void 0;
      }),
      (e._zod.parse = (e, n) => {
        if (e.value === void 0) {
          if (t.innerType._zod.optin !== `defaulted`) return e;
          let r = t.innerType._zod.run({ value: e.value, issues: [] }, n);
          return r instanceof Promise ? r.then((t) => Gr(e, t)) : Gr(e, r);
        }
        return t.innerType._zod.run(e, n);
      }));
  }),
  qr = _(`$ZodExactOptional`, (e, t) => {
    (Kr.init(e, t),
      g(e, `values`, (e) => e.def.innerType._zod.values),
      g(e, `pattern`, (e) => e.def.innerType._zod.pattern),
      (e._zod.parse = (e, n) => t.innerType._zod.run(e, n)));
  }),
  Jr = _(`$ZodNullable`, (e, t) => {
    (v.init(e, t),
      g(e, `optin`, (e) => e.def.innerType._zod.optin),
      g(e, `optout`, (e) => e.def.innerType._zod.optout),
      g(e, `pattern`, (e) => {
        let t = e.def.innerType._zod.pattern;
        return t ? RegExp(`^(${o(t.source)}|null)$`) : void 0;
      }),
      g(e, `values`, (e) =>
        e.def.innerType._zod.values ? new Set([...e.def.innerType._zod.values, null]) : void 0,
      ),
      (e._zod.parse = (e, n) => (e.value === null ? e : t.innerType._zod.run(e, n))));
  }),
  Yr = _(`$ZodDefault`, (e, t) => {
    (v.init(e, t),
      (e._zod.optin = `defaulted`),
      g(e, `values`, (e) => e.def.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n);
        if (e.value === void 0) return ((e.value = t.defaultValue), e);
        let r = t.innerType._zod.run(e, n);
        return r instanceof Promise ? r.then((e) => Xr(e, t)) : Xr(r, t);
      }));
  });
function Xr(e, t) {
  return (e.value === void 0 && (e.value = t.defaultValue), e);
}
var Zr = _(`$ZodPrefault`, (e, t) => {
    (v.init(e, t),
      (e._zod.optin = `defaulted`),
      g(e, `values`, (e) => e.def.innerType._zod.values),
      (e._zod.parse = (e, n) => (
        n.direction === `backward` || (e.value === void 0 && (e.value = t.defaultValue)),
        t.innerType._zod.run(e, n)
      )));
  }),
  Qr = _(`$ZodNonOptional`, (e, t) => {
    (v.init(e, t),
      g(e, `values`, (e) => {
        let t = e.def.innerType._zod.values;
        return t ? new Set([...t].filter((e) => e !== void 0)) : void 0;
      }),
      (e._zod.parse = (n, r) => {
        let i = t.innerType._zod.run(n, r);
        return i instanceof Promise ? i.then((t) => $r(t, e)) : $r(i, e);
      }));
  });
function $r(e, t) {
  return (
    !e.issues.length &&
      e.value === void 0 &&
      e.issues.push({ code: `invalid_type`, expected: `nonoptional`, input: e.value, inst: t }),
    e
  );
}
function ei(e, t, n, r) {
  return t.issues.length
    ? ((e.value = n.catchValue({
        ...t,
        value: e.value,
        error: { issues: t.issues.map((e) => ke(e, r, et())) },
        input: e.value,
      })),
      e)
    : ((e.value = t.value), t.memo && (e.memo = !0), e);
}
var ti = _(`$ZodCatch`, (e, t) => {
    (v.init(e, t),
      g(e, `optin`, (e) => (e.def.innerType._zod.optin === `defaulted` ? `defaulted` : `optional`)),
      g(e, `optout`, (e) => e.def.innerType._zod.optout),
      g(e, `values`, (e) => e.def.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n);
        let r = t.innerType._zod.run({ value: e.value, issues: [] }, n);
        return r instanceof Promise ? r.then((r) => ei(e, r, t, n)) : ei(e, r, t, n);
      }));
  }),
  ni = _(`$ZodPipe`, (e, t) => {
    (v.init(e, t),
      g(e, `values`, (e) => e.def.in._zod.values),
      g(e, `optin`, (e) => e.def.in._zod.optin),
      g(e, `optout`, (e) => e.def.out._zod.optout),
      g(e, `propValues`, (e) => e.def.in._zod.propValues),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) {
          let r = t.out._zod.run(e, n);
          return r instanceof Promise ? r.then((e) => ri(e, t.in, n)) : ri(r, t.in, n);
        }
        let r = t.in._zod.run(e, n);
        return r instanceof Promise ? r.then((e) => ri(e, t.out, n)) : ri(r, t.out, n);
      }));
  });
function ri(e, t, n) {
  return e.issues.some((e) => e.code !== `unrecognized_keys`)
    ? ((e.aborted = !0), e)
    : t._zod.run({ value: e.value, issues: e.issues }, n);
}
var ii = _(`$ZodPreprocess`, (e, t) => {
    ni.init(e, t);
  }),
  ai = _(`$ZodReadonly`, (e, t) => {
    (v.init(e, t),
      g(e, `propValues`, (e) => e.def.innerType._zod.propValues),
      g(e, `values`, (e) => e.def.innerType._zod.values),
      g(e, `optin`, (e) => e.def.innerType?._zod?.optin),
      g(e, `optout`, (e) => e.def.innerType?._zod?.optout),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n);
        let r = t.innerType._zod.run(e, n);
        return r instanceof Promise ? r.then(oi) : oi(r);
      }));
  });
function oi(e) {
  return (e.memo || (e.value = Object.freeze(e.value)), e);
}
var si = _(`$ZodCustom`, (e, t) => {
  (dn.init(e, t),
    v.init(e, t),
    (e._zod.parse = (e, t) => e),
    (e._zod.check = (n) => {
      let r = n.value,
        i = t.fn(r);
      if (i instanceof Promise) return i.then((t) => ci(t, n, r, e));
      ci(i, n, r, e);
    }));
});
function ci(e, t, n, r) {
  if (!e) {
    let e = {
      code: `custom`,
      input: n,
      inst: r,
      path: [...(r._zod.def.path ?? [])],
      continue: !r._zod.def.abort,
    };
    (r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Pe(e)));
  }
}
var li = class extends Error {
    constructor() {
      (super(`Cannot parse a reference cycle that closes through a transform`),
        (this.name = `ZodCyclicError`));
    }
  },
  ui = `~memo`,
  di = [];
function fi(e) {
  return typeof e == `object` && !!e;
}
function pi(e) {
  return e.map((e) => (e.path ? { ...e, path: e.path.slice() } : { ...e }));
}
var mi = new WeakMap(),
  hi = 0,
  gi = 1,
  _i = 2;
function vi(e, t, n) {
  let r = mi.get(e);
  if (r !== void 0) return r ? _i : hi;
  if (t.has(e)) return _i;
  t.add(e);
  let i = hi,
    a = (e) => {
      if (i !== _i && e?._zod) {
        let r = vi(e, t, n);
        r > i && (i = r);
      }
    },
    o = (e, r) => {
      let i = hi;
      for (let a of Reflect.ownKeys(e)) {
        let o = Object.getOwnPropertyDescriptor(e, a);
        if (r && !o.enumerable) continue;
        let s = o.get ? gi : o.value?._zod ? vi(o.value, t, n) : hi;
        s > i && (i = s);
      }
      return i;
    },
    s = (e) => {
      e > i && (i = e);
    },
    c = e._zod.def;
  switch (c.type) {
    case `object`: {
      let e = l(c);
      (s(e ? o(e, !0) : gi), a(c.catchall));
      break;
    }
    case `array`:
      a(c.element);
      break;
    case `tuple`:
      for (let e of c.items) a(e);
      a(c.rest);
      break;
    case `record`:
    case `map`:
      (a(c.keyType), a(c.valueType));
      break;
    case `set`:
      a(c.valueType);
      break;
    case `union`:
      for (let e of c.options) a(e);
      break;
    case `intersection`:
      (a(c.left), a(c.right));
      break;
    case `optional`:
    case `nullable`:
    case `default`:
    case `prefault`:
    case `catch`:
    case `readonly`:
    case `nonoptional`:
    case `promise`:
    case `success`:
      a(c.innerType);
      break;
    case `pipe`:
      (a(c.in), a(c.out));
      break;
    case `function`:
      (a(c.input), a(c.output));
      break;
    case `lazy`: {
      let r = c._cachedInner ?? (n ? e._zod.innerType : void 0);
      s(r ? vi(r, t, !1) : gi);
      break;
    }
    case `template_literal`:
    case `string`:
    case `number`:
    case `int`:
    case `boolean`:
    case `bigint`:
    case `symbol`:
    case `undefined`:
    case `null`:
    case `void`:
    case `never`:
    case `any`:
    case `unknown`:
    case `date`:
    case `nan`:
    case `enum`:
    case `literal`:
    case `file`:
    case `transform`:
    case `custom`:
      break;
    default:
      for (let e in c) {
        let t = Object.getOwnPropertyDescriptor(c, e);
        if (!t || t.get) continue;
        let n = t.value;
        if (!(!n || typeof n != `object`)) {
          if (n._zod) a(n);
          else if (Array.isArray(n)) for (let e of n) a(e);
        }
      }
  }
  return (t.delete(e), yi(e, i));
}
function yi(e, t) {
  return (t !== gi && mi.set(e, t === _i), t);
}
function bi(e, t) {
  let n = e.buckets.get(t);
  return (n || ((n = new WeakMap()), e.buckets.set(t, n)), n);
}
var xi,
  Si = [],
  Ci = {
    alloc(e, t, n) {
      let r = xi;
      if (!r) return n;
      xi = void 0;
      let i = { value: n, issues: null };
      return (r.set(t.value, i), Si.push(i), n);
    },
    guard(e) {
      var t;
      ((t = e._zod).deferred ?? (t.deferred = []),
        e._zod.deferred.push(() => {
          let t = e._zod.parse,
            n = (e, n) => {
              if (n.direction !== `backward` && Ti(n, e.value)) throw new li();
              return t(e, n);
            };
          ((e._zod.parse = n), e._zod.run === t && (e._zod.run = n));
        }));
    },
    attach(e) {
      var t;
      let n,
        r = !1,
        i,
        a;
      ((t = e._zod).deferred ?? (t.deferred = []),
        e._zod.deferred.push(() => {
          let t = e._zod.parse,
            o = (s, c) => {
              if (n === void 0) {
                let i = vi(e, new Set(), !1);
                if (i === hi)
                  return ((e._zod.parse = t), e._zod.run === o && (e._zod.run = t), t(s, c));
                i === _i || r ? (n = !0) : (r = !0);
              }
              let l = s.value;
              if (!fi(l)) return t(s, c);
              let u = c[ui];
              u || ((u = { buckets: new WeakMap(), backEdges: void 0 }), (c[ui] = u));
              let d;
              i === c ? (d = a) : ((d = bi(u, e)), (i = c), (a = d));
              let f = d.get(l);
              if (f)
                return (
                  (s.value = f.value),
                  f.issues
                    ? f.issues.length && s.issues.push(...pi(f.issues))
                    : ((s.memo = !0), (u.backEdges ??= new WeakSet()), u.backEdges.add(f.value)),
                  s
                );
              xi = d;
              let p = Si.length,
                ee = t(s, c);
              xi = void 0;
              let m = Si.length > p ? Si.pop() : void 0;
              return ee instanceof Promise
                ? ee.then((e) => (m && (m.issues = e.issues.length ? pi(e.issues) : di), e))
                : (m && (m.issues = ee.issues.length ? pi(ee.issues) : di), ee);
            };
          ((e._zod.parse = o), e._zod.run === t && (e._zod.run = o));
        }));
    },
  };
function wi() {
  return Ci;
}
function Ti(e, t) {
  let n = e[ui]?.backEdges;
  return n !== void 0 && fi(t) && n.has(t);
}
var Ei = () => {
  let e = {
    string: { unit: `characters`, verb: `to have` },
    file: { unit: `bytes`, verb: `to have` },
    array: { unit: `items`, verb: `to have` },
    set: { unit: `items`, verb: `to have` },
    map: { unit: `entries`, verb: `to have` },
  };
  function n(t) {
    return e[t] ?? null;
  }
  let r = {
      regex: `input`,
      email: `email address`,
      url: `URL`,
      emoji: `emoji`,
      uuid: `UUID`,
      uuidv4: `UUIDv4`,
      uuidv6: `UUIDv6`,
      nanoid: `nanoid`,
      guid: `GUID`,
      cuid: `cuid`,
      cuid2: `cuid2`,
      ulid: `ULID`,
      xid: `XID`,
      ksuid: `KSUID`,
      datetime: `ISO datetime`,
      date: `ISO date`,
      time: `ISO time`,
      duration: `ISO duration`,
      ipv4: `IPv4 address`,
      ipv6: `IPv6 address`,
      mac: `MAC address`,
      cidrv4: `IPv4 range`,
      cidrv6: `IPv6 range`,
      base64: `base64-encoded string`,
      base64url: `base64url-encoded string`,
      json_string: `JSON string`,
      e164: `E.164 number`,
      currency_code: `currency code`,
      credit_card: `credit card number`,
      iban: `IBAN`,
      jwt: `JWT`,
      template_literal: `input`,
    },
    i = { nan: `NaN` };
  function a(e, t) {
    return e === `number` && typeof t == `number` && !Number.isFinite(t) ? String(t) : (i[e] ?? e);
  }
  return (e) => {
    switch (e.code) {
      case `invalid_type`:
        return `Invalid input: expected ${a(e.expected)}, received ${a(Ne(e.input), e.input)}`;
      case `invalid_value`:
        return e.values.length === 1
          ? `Invalid input: expected ${de(e.values[0])}`
          : `Invalid option: expected one of ${t(e.values, `|`)}`;
      case `too_big`: {
        let t = e.exact ? `exactly ` : e.inclusive ? `<=` : `<`,
          r = n(e.origin);
        return r
          ? `Too big: expected ${e.origin ?? `value`} to have ${t}${e.maximum.toString()} ${r.unit ?? `elements`}`
          : `Too big: expected ${e.origin ?? `value`} to be ${t}${e.maximum.toString()}`;
      }
      case `too_small`: {
        let t = e.exact ? `exactly ` : e.inclusive ? `>=` : `>`,
          r = n(e.origin);
        return r
          ? `Too small: expected ${e.origin} to have ${t}${e.minimum.toString()} ${r.unit}`
          : `Too small: expected ${e.origin} to be ${t}${e.minimum.toString()}`;
      }
      case `invalid_format`: {
        let t = e;
        return t.format === `starts_with`
          ? `Invalid string: must start with "${t.prefix}"`
          : t.format === `ends_with`
            ? `Invalid string: must end with "${t.suffix}"`
            : t.format === `includes`
              ? `Invalid string: must include "${t.includes}"`
              : t.format === `regex`
                ? `Invalid string: must match pattern ${t.pattern}`
                : `Invalid ${r[t.format] ?? e.format}`;
      }
      case `not_multiple_of`:
        return `Invalid number: must be a multiple of ${e.divisor}`;
      case `unrecognized_keys`:
        return `Unrecognized key${e.keys.length > 1 ? `s` : ``}: ${t(e.keys, `, `)}`;
      case `invalid_key`:
        return `Invalid key in ${e.origin}`;
      case `invalid_union`:
        return e.options && Array.isArray(e.options) && e.options.length > 0
          ? `Invalid discriminator value. Expected ${e.options.map((e) => `'${e}'`).join(` | `)}`
          : e.inclusive === !1
            ? `Invalid input: more than one option matched`
            : `Invalid input`;
      case `invalid_element`:
        return `Invalid value in ${e.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function Di() {
  return { localeError: Ei() };
}
var Oi,
  ki = class {
    constructor() {
      ((this._map = new WeakMap()), (this._idmap = new Map()));
    }
    add(e, ...t) {
      let n = t[0];
      return (
        this._map.set(e, n),
        n && typeof n == `object` && `id` in n && this._idmap.set(n.id, e),
        this
      );
    }
    clear() {
      return ((this._map = new WeakMap()), (this._idmap = new Map()), this);
    }
    remove(e) {
      let t = this._map.get(e);
      return (
        t && typeof t == `object` && `id` in t && this._idmap.delete(t.id),
        this._map.delete(e),
        this
      );
    }
    get(e) {
      let t = e._zod.parent;
      if (t) {
        let n = { ...(this.get(t) ?? {}) };
        delete n.id;
        let r = { ...n, ...this._map.get(e) };
        return Object.keys(r).length ? r : void 0;
      }
      return this._map.get(e);
    }
    has(e) {
      return this._map.has(e);
    }
  };
function Ai() {
  return new ki();
}
(Oi = globalThis).__zod_globalRegistry ?? (Oi.__zod_globalRegistry = Ai());
var ji = globalThis.__zod_globalRegistry;
function Mi(e) {
  return ((e.checks &&= [...e.checks]), e);
}
function Ni(e, t) {
  return new e(Mi({ type: `string`, ...h(t) }));
}
function Pi(e, t) {
  return new e({ type: `string`, format: `email`, check: `string_format`, abort: !1, ...h(t) });
}
function Fi(e, t) {
  return new e({ type: `string`, format: `guid`, check: `string_format`, abort: !1, ...h(t) });
}
function Ii(e, t) {
  return new e({ type: `string`, format: `uuid`, check: `string_format`, abort: !1, ...h(t) });
}
function Li(e, t) {
  return new e({
    type: `string`,
    format: `uuid`,
    check: `string_format`,
    abort: !1,
    version: `v4`,
    ...h(t),
  });
}
function Ri(e, t) {
  return new e({
    type: `string`,
    format: `uuid`,
    check: `string_format`,
    abort: !1,
    version: `v6`,
    ...h(t),
  });
}
function zi(e, t) {
  return new e({
    type: `string`,
    format: `uuid`,
    check: `string_format`,
    abort: !1,
    version: `v7`,
    ...h(t),
  });
}
function Bi(e, t) {
  return new e({ type: `string`, format: `url`, check: `string_format`, abort: !1, ...h(t) });
}
function Vi(e, t) {
  return new e({ type: `string`, format: `emoji`, check: `string_format`, abort: !1, ...h(t) });
}
function Hi(e, t) {
  return new e({ type: `string`, format: `nanoid`, check: `string_format`, abort: !1, ...h(t) });
}
function Ui(e, t) {
  return new e({ type: `string`, format: `cuid`, check: `string_format`, abort: !1, ...h(t) });
}
function Wi(e, t) {
  return new e({ type: `string`, format: `cuid2`, check: `string_format`, abort: !1, ...h(t) });
}
function Gi(e, t) {
  return new e({ type: `string`, format: `ulid`, check: `string_format`, abort: !1, ...h(t) });
}
function Ki(e, t) {
  return new e({ type: `string`, format: `xid`, check: `string_format`, abort: !1, ...h(t) });
}
function qi(e, t) {
  return new e({ type: `string`, format: `ksuid`, check: `string_format`, abort: !1, ...h(t) });
}
function Ji(e, t) {
  return new e({ type: `string`, format: `ipv4`, check: `string_format`, abort: !1, ...h(t) });
}
function Yi(e, t) {
  return new e({ type: `string`, format: `ipv6`, check: `string_format`, abort: !1, ...h(t) });
}
function Xi(e, t) {
  return new e({ type: `string`, format: `cidrv4`, check: `string_format`, abort: !1, ...h(t) });
}
function Zi(e, t) {
  return new e({ type: `string`, format: `cidrv6`, check: `string_format`, abort: !1, ...h(t) });
}
function Qi(e, t) {
  return new e({ type: `string`, format: `base64`, check: `string_format`, abort: !1, ...h(t) });
}
function $i(e, t) {
  return new e({ type: `string`, format: `base64url`, check: `string_format`, abort: !1, ...h(t) });
}
function ea(e, t) {
  return new e({ type: `string`, format: `e164`, check: `string_format`, abort: !1, ...h(t) });
}
function ta(e, t) {
  return new e({ type: `string`, format: `jwt`, check: `string_format`, abort: !1, ...h(t) });
}
function na(e, t) {
  return new e({
    type: `string`,
    format: `datetime`,
    check: `string_format`,
    offset: !1,
    local: !1,
    precision: null,
    ...h(t),
  });
}
function ra(e, t) {
  return new e({ type: `string`, format: `date`, check: `string_format`, ...h(t) });
}
function ia(e, t) {
  return new e({
    type: `string`,
    format: `time`,
    check: `string_format`,
    precision: null,
    ...h(t),
  });
}
function aa(e, t) {
  return new e({ type: `string`, format: `duration`, check: `string_format`, ...h(t) });
}
function oa(e, t) {
  return new e(Mi({ type: `number`, checks: [], ...h(t) }));
}
function sa(e, t) {
  return new e({ type: `number`, check: `number_format`, abort: !1, format: `safeint`, ...h(t) });
}
function ca(e, t) {
  return new e({ type: `boolean`, ...h(t) });
}
function la(e, t) {
  return new e({ type: `undefined`, ...h(t) });
}
function ua(e) {
  return new e({ type: `unknown` });
}
function da(e, t) {
  return new e({ type: `never`, ...h(t) });
}
function fa(e, t) {
  return new e({ type: `date`, ...h(t) });
}
function pa(e, t) {
  return new mn({ check: `less_than`, ...h(t), value: e, inclusive: !1 });
}
function ma(e, t) {
  return new mn({ check: `less_than`, ...h(t), value: e, inclusive: !0 });
}
function ha(e, t) {
  return new hn({ check: `greater_than`, ...h(t), value: e, inclusive: !1 });
}
function ga(e, t) {
  return new hn({ check: `greater_than`, ...h(t), value: e, inclusive: !0 });
}
function _a(e, t) {
  return new gn({ check: `multiple_of`, ...h(t), value: e });
}
function va(e, t) {
  return new vn({ check: `max_length`, ...h(t), maximum: e });
}
function ya(e, t) {
  return new yn({ check: `min_length`, ...h(t), minimum: e });
}
function ba(e, t) {
  return new bn({ check: `length_equals`, ...h(t), length: e });
}
function xa(e, t) {
  return new Sn({ check: `string_format`, format: `regex`, ...h(t), pattern: e });
}
function Sa(e) {
  return new Cn({ check: `string_format`, format: `lowercase`, ...h(e) });
}
function Ca(e) {
  return new wn({ check: `string_format`, format: `uppercase`, ...h(e) });
}
function wa(e, t) {
  return new Tn({ check: `string_format`, format: `includes`, ...h(t), includes: e });
}
function Ta(e, t) {
  return new En({ check: `string_format`, format: `starts_with`, ...h(t), prefix: e });
}
function Ea(e, t) {
  return new Dn({ check: `string_format`, format: `ends_with`, ...h(t), suffix: e });
}
function Da(e) {
  return new On({ check: `overwrite`, tx: e });
}
function Oa(e) {
  return Da((t) => t.normalize(e));
}
function ka() {
  return Da((e) => e.trim());
}
function Aa() {
  return Da((e) => e.toLowerCase());
}
function ja() {
  return Da((e) => e.toUpperCase());
}
function Ma() {
  return Da((e) => ne(e));
}
function Na(e, t, n) {
  return new e({ type: `array`, element: t, ...h(n) });
}
function Pa(e, t, n) {
  return new e({ type: `custom`, check: `custom`, fn: t, ...h(n) });
}
function Fa(e, t) {
  let n = Ia(
    (t) => (
      (t.addIssue = (e) => {
        if (typeof e == `string`) t.issues.push(Pe(e, t.value, n._zod.def));
        else {
          let r = e;
          (r.fatal && (r.continue = !1),
            (r.code ??= `custom`),
            `input` in r || (r.input = t.value),
            (r.inst ??= n),
            (r.continue ??= !n._zod.def.abort),
            t.issues.push(Pe(r)));
        }
      }),
      e(t.value, t)
    ),
    t,
  );
  return n;
}
function Ia(e, t) {
  let n = new dn({ check: `custom`, ...h(t) });
  return ((n._zod.check = e), n);
}
function La(e, ...t) {
  for (let n of t)
    for (let t of Reflect.ownKeys(n))
      Object.prototype.propertyIsEnumerable.call(n, t) && c(e, t, n[t]);
  return e;
}
function Ra(e) {
  let t = e?.target ?? `draft-2020-12`;
  return (
    t === `draft-4` && (t = `draft-04`),
    t === `draft-7` && (t = `draft-07`),
    {
      processors: e.processors ?? {},
      metadataRegistry: e?.metadata ?? ji,
      target: t,
      unrepresentable: e?.unrepresentable ?? `throw`,
      override: e?.override ?? (() => {}),
      io: e?.io ?? `output`,
      counter: 0,
      seen: new Map(),
      sharedDefsExtractedFor: void 0,
      sharedEmitDoneFor: void 0,
      cycles: e?.cycles ?? `ref`,
      reused: e?.reused ?? `inline`,
      intersections: [],
      deferred: [],
      external: e?.external ?? void 0,
    }
  );
}
function za(e, t, n, r, i) {
  let a =
    typeof t.unrepresentable == `function`
      ? t.unrepresentable({ zodSchema: e, path: r.path, message: i })
      : t.unrepresentable;
  if (a === `any`) return !1;
  if (a === void 0 || a === `throw`) throw Error(i);
  return (Object.assign(n, a), !0);
}
function b(e, t, n = { path: [], schemaPath: [] }) {
  var r;
  let i = e._zod.def,
    a = t.seen.get(e);
  if (a) return (a.count++, n.schemaPath.includes(e) && (a.cycle = n.path), a.schema);
  let o = { schema: {}, count: 1, cycle: void 0, path: n.path };
  (t.seen.set(e, o), (t.sharedDefsExtractedFor = void 0), (t.sharedEmitDoneFor = void 0));
  let s = e._zod.toJSONSchema?.();
  if (s) o.schema = s;
  else {
    let r = { ...n, schemaPath: [...n.schemaPath, e], path: n.path };
    if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, o.schema, r);
    else {
      let n = o.schema,
        a = t.processors[i.type];
      if (!a) throw Error(`[toJSONSchema]: Non-representable type encountered: ${i.type}`);
      a(e, t, n, r);
    }
    let a = e._zod.parent;
    a && ((o.ref ||= a), b(a, t, r), (t.seen.get(a).isParent = !0));
  }
  let c = t.metadataRegistry.get(e);
  return (
    c && La(o.schema, c),
    t.io === `input` && Ya(e) && (delete o.schema.examples, delete o.schema.default),
    t.io === `input` &&
      `_prefault` in o.schema &&
      ((r = o.schema).default ?? (r.default = o.schema._prefault)),
    delete o.schema._prefault,
    t.seen.get(e).schema
  );
}
function Ba(e) {
  return e.replace(/~/g, `~0`).replace(/\//g, `~1`);
}
function Va(e, t) {
  let n = e.seen.get(t);
  if (!n) throw Error(`Unprocessed schema. This is a bug in Zod.`);
  if (e.external && e.sharedDefsExtractedFor === e.external) return;
  let r = new Map();
  for (let t of e.seen.entries()) {
    let n = e.metadataRegistry.get(t[0])?.id;
    if (n) {
      let e = r.get(n);
      if (e && e !== t[0])
        throw Error(
          `Duplicate schema id "${n}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`,
        );
      r.set(n, t[0]);
    }
  }
  let i = (t) => {
      let r = e.target === `draft-2020-12` ? `$defs` : `definitions`;
      if (e.external) {
        let n = e.external.registry.get(t[0])?.id,
          i = e.external.uri ?? ((e) => e);
        if (n) return { ref: i(n) };
        let a = t[1].defId ?? t[1].schema.id ?? `schema${e.counter++}`;
        return ((t[1].defId = a), { defId: a, ref: `${i(`__shared`)}#/${r}/${Ba(a)}` });
      }
      let i = `#/${r}/`;
      if (t[1] === n && !t[1].schema.id) return { ref: `#` };
      let a = t[1].schema.id ?? `__schema${e.counter++}`;
      return { defId: a, ref: i + Ba(a) };
    },
    a = (e) => {
      if (e[1].schema.$ref) return;
      let t = e[1],
        { ref: n, defId: r } = i(e);
      ((t.def = { ...t.schema }), r && (t.defId = r));
      let a = t.schema;
      for (let e in a) delete a[e];
      a.$ref = n;
    };
  if (e.cycles === `throw`)
    for (let t of e.seen.entries()) {
      let e = t[1];
      if (e.cycle)
        throw Error(`Cycle detected: #/${e.cycle?.join(`/`)}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
    }
  for (let n of e.seen.entries()) {
    let r = n[1];
    if (t === n[0]) {
      a(n);
      continue;
    }
    if (e.external) {
      let r = e.external.registry.get(n[0])?.id;
      if (t !== n[0] && r) {
        a(n);
        continue;
      }
    }
    if (e.metadataRegistry.get(n[0])?.id) {
      a(n);
      continue;
    }
    if (r.cycle) {
      a(n);
      continue;
    }
    r.count > 1 && e.reused === `ref` && a(n);
  }
  e.external && (e.sharedDefsExtractedFor = e.external);
}
function Ha(e) {
  let t = e.anyOf;
  if (!Array.isArray(t) || t.length === 0 || e.type !== void 0) return;
  let n = [];
  for (let e of t) {
    if (!e || typeof e != `object`) return;
    Ha(e);
    let t = Object.keys(e);
    if (t.length !== 1 || t[0] !== `type`) return;
    let r = e.type;
    for (let e of Array.isArray(r) ? r : [r]) {
      if (typeof e != `string`) return;
      n.includes(e) || n.push(e);
    }
  }
  (delete e.anyOf, (e.type = n.length === 1 ? n[0] : n));
}
var Ua = new Set([`type`, `properties`, `required`, `additionalProperties`]),
  Wa = [`oneOf`, `anyOf`];
function Ga(e) {
  let t = e.additionalProperties;
  return t === void 0 || t === !1 || typeof t != `object` || !t
    ? null
    : Object.keys(t).length
      ? t
      : null;
}
function Ka(e) {
  let t = [];
  for (let n of e) {
    if (typeof n != `object` || n.type !== `object`) return null;
    for (let e in n) if (!Ua.has(e)) return null;
    t.push(n);
  }
  let n = {},
    r = new Set();
  for (let e of t) {
    for (let r in e.properties) {
      if (Object.prototype.hasOwnProperty.call(n, r)) continue;
      let e = [];
      for (let n of t) {
        let t = n.properties?.[r] ?? Ga(n);
        t != null && (e.some((e) => JSON.stringify(e) === JSON.stringify(t)) || e.push(t));
      }
      c(n, r, e.length === 1 ? e[0] : (Ka(e) ?? { allOf: e }));
    }
    for (let t of e.required ?? []) r.add(t);
  }
  let i = { type: `object`, properties: n };
  if ((r.size && (i.required = [...r]), t.every((e) => e.additionalProperties === !1)))
    i.additionalProperties = !1;
  else {
    let e = [];
    for (let n of t) {
      let t = Ga(n);
      t && !e.some((e) => JSON.stringify(e) === JSON.stringify(t)) && e.push(t);
    }
    e.length === 1
      ? (i.additionalProperties = e[0])
      : e.length > 1 && (i.additionalProperties = { allOf: e });
  }
  return i;
}
function qa(e) {
  let t = e.allOf;
  if (!Array.isArray(t) || t.length < 2) return;
  for (let t of Ua) if (t in e) return;
  let n = t.filter((e) => Wa.some((t) => Array.isArray(e[t]))),
    r = null;
  if (!n.length) r = Ka(t);
  else {
    let e = n[0],
      i = Wa.find((t) => Array.isArray(e[t]));
    if (Object.keys(e).length !== 1) return;
    let a = t.filter((t) => t !== e),
      o = e[i].map((e) => Ka([...a, e]));
    if (o.some((e) => !e)) return;
    r = { [i]: o };
  }
  r && (delete e.allOf, La(e, r));
}
function Ja(e, t) {
  let n = e.seen.get(t);
  if (!n) throw Error(`Unprocessed schema. This is a bug in Zod.`);
  let r = (t) => {
    let n = e.seen.get(t);
    if (n.ref === null) return;
    let i = n.def ?? n.schema,
      a = { ...i },
      o = n.ref;
    if (((n.ref = null), o)) {
      r(o);
      let n = e.seen.get(o),
        s = n.schema;
      if (
        (s.$ref &&
        (e.target === `draft-07` || e.target === `draft-04` || e.target === `openapi-3.0`)
          ? ((i.allOf = i.allOf ?? []), i.allOf.push(s))
          : La(i, s),
        La(i, a),
        t._zod.parent === o)
      )
        for (let e in i) e === `$ref` || e === `allOf` || e in a || delete i[e];
      if (s.$ref && n.def)
        for (let e in i)
          e === `$ref` ||
            e === `allOf` ||
            (e in n.def && JSON.stringify(i[e]) === JSON.stringify(n.def[e]) && delete i[e]);
    }
    let s = t._zod.parent;
    if (s && s !== o) {
      r(s);
      let t = e.seen.get(s);
      if (t?.schema.$ref && ((i.$ref = t.schema.$ref), t.def))
        for (let e in i)
          e === `$ref` ||
            e === `allOf` ||
            (e in t.def && JSON.stringify(i[e]) === JSON.stringify(t.def[e]) && delete i[e]);
    }
    e.override({ zodSchema: t, jsonSchema: i, path: n.path ?? [] });
  };
  if (!e.external || e.sharedEmitDoneFor !== e.external) {
    for (let t of [...e.seen.entries()].reverse()) r(t[0]);
    if (e.target !== `openapi-3.0`) for (let t of e.seen.entries()) Ha(t[1].def ?? t[1].schema);
    for (let t of e.deferred) t();
    if (e.intersections.length) {
      let t = new Map();
      for (let n of e.seen.values())
        for (let e of [n.schema, n.def]) {
          let n = e?.allOf;
          if (!Array.isArray(n)) continue;
          let r = t.get(n);
          r ? r.push(e) : t.set(n, [e]);
        }
      for (let n of e.intersections) for (let e of t.get(n) ?? []) qa(e);
    }
  }
  let i = {};
  if (
    (e.target === `draft-2020-12`
      ? (i.$schema = `https://json-schema.org/draft/2020-12/schema`)
      : e.target === `draft-07`
        ? (i.$schema = `http://json-schema.org/draft-07/schema#`)
        : e.target === `draft-04`
          ? (i.$schema = `http://json-schema.org/draft-04/schema#`)
          : e.target,
    e.external?.uri)
  ) {
    let n = e.external.registry.get(t)?.id;
    if (!n) throw Error("Schema is missing an `id` property");
    i.$id = e.external.uri(n);
  }
  La(i, n.defId ? n.schema : (n.def ?? n.schema));
  let a = e.metadataRegistry.get(t)?.id;
  a !== void 0 && i.id === a && delete i.id;
  let o = e.external?.defs ?? {};
  if (!e.external || e.sharedEmitDoneFor !== e.external)
    for (let t of e.seen.entries()) {
      let e = t[1];
      e.def && e.defId && (e.def.id === e.defId && delete e.def.id, c(o, e.defId, e.def));
    }
  (e.external && (e.sharedEmitDoneFor = e.external),
    e.external ||
      (Object.keys(o).length > 0 &&
        (e.target === `draft-2020-12` ? (i.$defs = o) : (i.definitions = o))));
  try {
    let n = JSON.parse(JSON.stringify(i));
    return (
      Object.defineProperty(n, `~standard`, {
        value: {
          ...t[`~standard`],
          jsonSchema: {
            input: Za(t, `input`, e.processors),
            output: Za(t, `output`, e.processors),
          },
        },
        enumerable: !1,
        writable: !1,
      }),
      n
    );
  } catch {
    throw Error(`Error converting schema to JSON.`);
  }
}
function Ya(e, t) {
  let n = t ?? { seen: new Set() };
  if (n.seen.has(e)) return !1;
  n.seen.add(e);
  let r = e._zod.def;
  if (r.type === `transform`) return !0;
  if (r.type === `array`) return Ya(r.element, n);
  if (r.type === `set`) return Ya(r.valueType, n);
  if (r.type === `lazy`) return Ya(r.getter(), n);
  if (
    r.type === `promise` ||
    r.type === `optional` ||
    r.type === `nonoptional` ||
    r.type === `nullable` ||
    r.type === `readonly` ||
    r.type === `default` ||
    r.type === `prefault` ||
    r.type === `catch`
  )
    return Ya(r.innerType, n);
  if (r.type === `intersection`) return Ya(r.left, n) || Ya(r.right, n);
  if (r.type === `record` || r.type === `map`) return Ya(r.keyType, n) || Ya(r.valueType, n);
  if (r.type === `pipe`) return e._zod.traits.has(`$ZodCodec`) ? !0 : Ya(r.in, n) || Ya(r.out, n);
  if (r.type === `object`) {
    for (let e in r.shape) if (Ya(r.shape[e], n)) return !0;
    return !1;
  }
  if (r.type === `union`) {
    for (let e of r.options) if (Ya(e, n)) return !0;
    return !1;
  }
  if (r.type === `tuple`) {
    for (let e of r.items) if (Ya(e, n)) return !0;
    return !!(r.rest && Ya(r.rest, n));
  }
  return !1;
}
var Xa =
    (e, t = {}) =>
    (n) => {
      let r = Ra({ ...n, processors: t });
      return (b(e, r), Va(r, e), Ja(r, e));
    },
  Za =
    (e, t, n = {}) =>
    (r) => {
      let { libraryOptions: i, target: a } = r ?? {},
        o = Ra({ ...(i ?? {}), target: a, io: t, processors: n });
      return (b(e, o), Va(o, e), Ja(o, e));
    },
  Qa = (e, t, n) => {
    (e[t] === void 0 || n > e[t]) && (e[t] = n);
  },
  $a = (e, t, n) => {
    (e[t] === void 0 || n < e[t]) && (e[t] = n);
  },
  eo = (e, t) => {
    (Qa(e, `minimum`, t), $a(e, `maximum`, t));
  },
  to = (e, t) => {
    ((e.multipleOf ??= []), e.multipleOf.includes(t) || e.multipleOf.push(t));
  },
  no = (e, t) => {
    ((e.patterns ??= new Set()), e.patterns.add(t));
  },
  ro = (e, t) => {
    e.mime = e.mime ? e.mime.filter((e) => t.includes(e)) : [...t];
  },
  io = (e, t) => {
    ((e.format = t), t.includes(`int`) && (e.isInt = !0));
  },
  ao = (e, t) => Qa(e, `minimum`, t.minimum),
  oo = (e, t) => $a(e, `maximum`, t.maximum),
  so = (e) => (t, n) => {
    io(t, n.format);
    let [r, i] = e[n.format];
    (Qa(t, `minimum`, r), $a(t, `maximum`, i));
  },
  co = {
    greater_than: (e, t) => Qa(e, t.inclusive ? `minimum` : `exclusiveMinimum`, t.value),
    less_than: (e, t) => $a(e, t.inclusive ? `maximum` : `exclusiveMaximum`, t.value),
    multiple_of: (e, t) => to(e, t.value),
    number_format: so(pe),
    bigint_format: so(me),
    min_length: ao,
    max_length: oo,
    length_equals: (e, t) => eo(e, t.length),
    min_size: ao,
    max_size: oo,
    size_equals: (e, t) => eo(e, t.size),
    string_format: (e, t) => {
      (io(e, t.format),
        t.pattern && no(e, t.pattern),
        (t.format === `base64` || t.format === `base64url`) && (e.contentEncoding = t.format),
        (t.local || t.precision === -1) && (e.laxFormat = !0));
    },
    mime_type: (e, t) => ro(e, t.mime),
  };
function lo(e) {
  let t = {},
    n = e._zod.def,
    r = e._zod.traits.has(`$ZodCheck`) ? [e, ...(n.checks ?? [])] : (n.checks ?? []);
  for (let e of r) co[e._zod.def.check]?.(t, e._zod.def);
  let i = e._zod.bag;
  (i.minimum !== void 0 && Qa(t, `minimum`, i.minimum),
    i.exclusiveMinimum !== void 0 && Qa(t, `exclusiveMinimum`, i.exclusiveMinimum),
    i.maximum !== void 0 && $a(t, `maximum`, i.maximum),
    i.exclusiveMaximum !== void 0 && $a(t, `exclusiveMaximum`, i.exclusiveMaximum),
    i.multipleOf !== void 0 && to(t, i.multipleOf),
    i.format !== void 0 && ((t.format ??= i.format), i.format.includes(`int`) && (t.isInt = !0)),
    i.mime && ro(t, i.mime));
  for (let e of i.patterns ?? []) no(t, e);
  return t;
}
var uo = { guid: `uuid`, url: `uri`, datetime: `date-time`, json_string: `json-string`, regex: `` },
  fo = new Map([
    [dr, qt],
    [pr, Jt],
  ]),
  po = (e) => fo.get(e) ?? e,
  mo = (e, t, n, r) => {
    let i = n;
    i.type = `string`;
    let {
      minimum: a,
      maximum: o,
      format: s,
      patterns: c,
      contentEncoding: l,
      laxFormat: u,
    } = lo(e);
    if (
      (typeof a == `number` && (i.minLength = a),
      typeof o == `number` && (i.maxLength = o),
      s &&
        ((i.format = uo[s] ?? s),
        i.format === `` && delete i.format,
        (s === `time` || u) && delete i.format),
      l && (i.contentEncoding = l),
      c && c.size > 0)
    ) {
      let e = [...c].map(po);
      e.length === 1
        ? (i.pattern = e[0].source)
        : e.length > 1 &&
          (i.allOf = [
            ...e.map((e) => ({
              ...(t.target === `draft-07` || t.target === `draft-04` || t.target === `openapi-3.0`
                ? { type: `string` }
                : {}),
              pattern: e.source,
            })),
          ]);
    }
  },
  ho = (e, t, n, r) => {
    let i = n,
      {
        minimum: a,
        maximum: o,
        multipleOf: s,
        exclusiveMaximum: c,
        exclusiveMinimum: l,
        isInt: u,
      } = lo(e);
    i.type = u ? `integer` : `number`;
    let d = typeof l == `number` && l >= (a ?? -1 / 0),
      f = typeof c == `number` && c <= (o ?? 1 / 0),
      p = t.target === `draft-04` || t.target === `openapi-3.0`;
    if (
      (d
        ? p
          ? ((i.minimum = l), (i.exclusiveMinimum = !0))
          : (i.exclusiveMinimum = l)
        : typeof a == `number` && (i.minimum = a),
      f
        ? p
          ? ((i.maximum = c), (i.exclusiveMaximum = !0))
          : (i.exclusiveMaximum = c)
        : typeof o == `number` && (i.maximum = o),
      s)
    ) {
      let n = new Set();
      for (let a of s)
        Number.isFinite(a) && a !== 0
          ? n.add(Math.abs(a))
          : za(e, t, i, r, `A multipleOf divisor of ${a} cannot be represented in JSON Schema`);
      let [a, ...o] = n;
      (a !== void 0 && (i.multipleOf = a),
        o.length && (i.allOf = [...(i.allOf ?? []), ...o.map((e) => ({ multipleOf: e }))]));
    }
  },
  go = (e, t, n, r) => {
    n.type = `boolean`;
  },
  _o = (e, t, n, r) => {
    za(e, t, n, r, `Undefined cannot be represented in JSON Schema`);
  },
  vo = (e, t, n, r) => {
    n.not = {};
  },
  yo = (e, t, n, r) => {
    za(e, t, n, r, `Date cannot be represented in JSON Schema`);
  },
  bo = (t, n, r, i) => {
    let a = t._zod.def,
      o = e(a.entries);
    if (o.length === 0) {
      r.not = {};
      return;
    }
    (o.every((e) => typeof e == `number`) && (r.type = `number`),
      o.every((e) => typeof e == `string`) && (r.type = `string`),
      (r.enum = o));
  },
  xo = (e, t, n, r) => {
    let i = e._zod.def;
    if (i.values.length === 0) {
      n.not = {};
      return;
    }
    let a = [];
    for (let o of i.values)
      if (o === void 0) {
        if (za(e, t, n, r, "Literal `undefined` cannot be represented in JSON Schema")) return;
      } else if (typeof o == `bigint`) {
        if (za(e, t, n, r, `BigInt literals cannot be represented in JSON Schema`)) return;
        a.push(Number(o));
      } else a.push(o);
    if (a.length !== 0)
      if (a.length === 1) {
        let e = a[0];
        ((n.type = e === null ? `null` : typeof e),
          t.target === `draft-04` || t.target === `openapi-3.0` ? (n.enum = [e]) : (n.const = e));
      } else
        (a.every((e) => typeof e == `number`) && (n.type = `number`),
          a.every((e) => typeof e == `string`) && (n.type = `string`),
          a.every((e) => typeof e == `boolean`) && (n.type = `boolean`),
          a.every((e) => e === null) && (n.type = `null`),
          (n.enum = a));
  },
  So = (e, t, n, r) => {
    za(e, t, n, r, `Custom types cannot be represented in JSON Schema`);
  },
  Co = (e, t, n, r) => {
    za(e, t, n, r, `Transforms cannot be represented in JSON Schema`);
  },
  wo = (e, t, n, r) => {
    let i = n,
      a = e._zod.def,
      { minimum: o, maximum: s } = lo(e);
    (typeof o == `number` && (i.minItems = o),
      typeof s == `number` && (i.maxItems = s),
      (i.type = `array`),
      (i.items = b(a.element, t, { ...r, path: [...r.path, `items`] })));
  };
function To(e) {
  let t = e._zod.def;
  return t.type === `pipe` && t.in._zod.traits.has(`$ZodTransform`)
    ? To(t.out)
    : t.type === `catch`
      ? To(t.innerType)
      : e._zod.optin;
}
var Eo = (e, t, n, r) => {
    let i = n,
      a = e._zod.def,
      o = a.shape;
    if (
      Object.getOwnPropertySymbols(o).length &&
      za(e, t, i, r, `Symbol keys cannot be represented in JSON Schema`)
    )
      return;
    ((i.type = `object`), (i.properties = {}));
    for (let e in o) c(i.properties, e, b(o[e], t, { ...r, path: [...r.path, `properties`, e] }));
    let s = [];
    for (let e of Object.keys(o)) {
      let n = a.shape[e];
      (t.io === `input` ? To(n) === void 0 : n._zod.optout === void 0) && s.push(e);
    }
    (s.length > 0 && (i.required = s),
      a.catchall?._zod.def.type === `never`
        ? (i.additionalProperties = !1)
        : a.catchall
          ? a.catchall &&
            (i.additionalProperties = b(a.catchall, t, {
              ...r,
              path: [...r.path, `additionalProperties`],
            }))
          : t.io === `output` && (i.additionalProperties = !1));
  },
  Do = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.inclusive === !1,
      o = i.options.map((e, n) => b(e, t, { ...r, path: [...r.path, a ? `oneOf` : `anyOf`, n] }));
    a ? (n.oneOf = o) : (n.anyOf = o);
  },
  Oo = (e, t, n, r) => {
    let i = e._zod.def,
      a = b(i.left, t, { ...r, path: [...r.path, `allOf`, 0] }),
      o = b(i.right, t, { ...r, path: [...r.path, `allOf`, 1] }),
      s = (e) => `allOf` in e && Object.keys(e).length === 1,
      c = [...(s(a) ? a.allOf : [a]), ...(s(o) ? o.allOf : [o])];
    ((n.allOf = c), t.intersections.push(c));
  };
function ko(e, t, n) {
  if (t.$ref) {
    if (n.has(t)) return t;
    n.add(t);
    let r = e.get(t)?.def;
    if (!r) return t;
    let i = ko(e, r, n);
    return i === r ? t : i;
  }
  for (let r of [`anyOf`, `oneOf`]) {
    let i = t[r];
    if (!Array.isArray(i)) continue;
    let a = i.map((t) => ko(e, t, n));
    a.some((e, t) => e !== i[t]) && (t = { ...t, [r]: a });
  }
  let r = Array.isArray(t.type) ? t.type : [t.type],
    i = !r.includes(`string`) && r.some((e) => e === `number` || e === `integer`),
    a = t.enum ?? (t.const === void 0 ? void 0 : [t.const]);
  if (!i && !a?.some((e) => typeof e == `number`)) return t;
  let {
    minimum: o,
    maximum: s,
    exclusiveMinimum: c,
    exclusiveMaximum: l,
    multipleOf: u,
    format: d,
    id: f,
    ...p
  } = t;
  return (
    p.enum
      ? (p.enum = p.enum.map((e) => (typeof e == `number` ? String(e) : e)))
      : typeof p.const == `number` && (p.const = String(p.const)),
    i ? ((p.type = `string`), a || (p.pattern = (r.includes(`number`) ? on : an).source), p) : p
  );
}
var Ao = new WeakMap();
function jo(e) {
  let t = new Map();
  for (let n of e.seen.values()) n.def && !t.has(n.schema) && t.set(n.schema, n);
  let n = new Map();
  for (let r of Ao.get(e) ?? []) {
    let i = e.seen.get(r),
      a = (i?.def ?? i?.schema)?.propertyNames;
    if (!a || a === !0 || n.has(a)) continue;
    let o = ko(t, a, new Set());
    o !== a && n.set(a, o);
  }
  if (n.size)
    for (let t of e.seen.values())
      for (let e of [t.schema, t.def]) {
        let t = e && n.get(e.propertyNames);
        t && (e.propertyNames = t);
      }
}
var Mo = (e, t, n, r) => {
    let i = n,
      a = e._zod.def;
    i.type = `object`;
    let o = a.keyType,
      s = lo(o).patterns;
    if (a.mode === `loose` && s && s.size > 0) {
      let e = b(a.valueType, t, { ...r, path: [...r.path, `patternProperties`, `*`] });
      i.patternProperties = {};
      for (let t of s) c(i.patternProperties, po(t).source, e);
    } else {
      if (t.target === `draft-07` || t.target === `draft-2020-12`) {
        i.propertyNames = b(a.keyType, t, { ...r, path: [...r.path, `propertyNames`] });
        let n = Ao.get(t);
        (n || ((n = []), Ao.set(t, n), t.deferred.push(() => jo(t))), n.push(e));
      }
      i.additionalProperties = b(a.valueType, t, {
        ...r,
        path: [...r.path, `additionalProperties`],
      });
    }
    let l = o._zod.values,
      u = t.io === `input` && To(a.valueType) !== void 0;
    if (l && !a.partial && !u) {
      let e = [...l].filter((e) => typeof e == `string` || typeof e == `number`);
      e.length > 0 && (i.required = e.map(String));
    }
  },
  No = (e, t, n, r) => {
    let i = e._zod.def,
      a = b(i.innerType, t, r),
      o = t.seen.get(e);
    t.target === `openapi-3.0`
      ? ((o.ref = i.innerType), (n.nullable = !0))
      : (n.anyOf = [a, { type: `null` }]);
  },
  Po = (e, t, n, r) => {
    let i = e._zod.def;
    b(i.innerType, t, r);
    let a = t.seen.get(e);
    a.ref = i.innerType;
  },
  Fo = Symbol();
function Io(e, t, n, r, i) {
  let a = !1,
    o = JSON.stringify(e, (e, t) => (typeof t == `bigint` ? ((a = !0), null) : t));
  return a
    ? (za(t, n, r, i, `BigInt defaults cannot be represented in JSON Schema`), Fo)
    : JSON.parse(o);
}
var Lo = (e, t, n, r) => {
    let i = e._zod.def;
    b(i.innerType, t, r);
    let a = t.seen.get(e);
    a.ref = i.innerType;
    let o = Io(i.defaultValue, e, t, n, r);
    o !== Fo && (n.default = o);
  },
  Ro = (e, t, n, r) => {
    let i = e._zod.def;
    b(i.innerType, t, r);
    let a = t.seen.get(e);
    if (((a.ref = i.innerType), t.io !== `input`)) return;
    let o = Io(i.defaultValue, e, t, n, r);
    o !== Fo && (n._prefault = o);
  },
  zo = (e, t, n, r) => {
    let i = e._zod.def;
    b(i.innerType, t, r);
    let a = t.seen.get(e);
    a.ref = i.innerType;
    let o;
    try {
      o = i.catchValue(void 0);
    } catch {
      za(e, t, n, r, `Dynamic catch values are not supported in JSON Schema`);
      return;
    }
    n.default = o;
  },
  Bo = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.in._zod.traits.has(`$ZodTransform`),
      o = t.io === `input` ? (a ? i.out : i.in) : i.out;
    b(o, t, r);
    let s = t.seen.get(e);
    s.ref = o;
  },
  Vo = (e, t, n, r) => {
    let i = e._zod.def;
    b(i.innerType, t, r);
    let a = t.seen.get(e);
    ((a.ref = i.innerType), (n.readOnly = !0));
  },
  Ho = (e, t, n, r) => {
    let i = e._zod.def;
    b(i.innerType, t, r);
    let a = t.seen.get(e);
    a.ref = i.innerType;
  },
  Uo = new WeakSet([Object.prototype, Error.prototype]);
function Wo(e, t, n) {
  Object.defineProperty(e, t, {
    configurable: !0,
    enumerable: !1,
    get() {
      let e = n(this);
      return (Object.defineProperty(this, t, { value: e, configurable: !0, writable: !0 }), e);
    },
    set(e) {
      Object.defineProperty(this, t, { value: e, configurable: !0, writable: !0 });
    },
  });
}
var Go = _(
    `ZodError`,
    (e, t) => {
      (st.init(e, t), (e.name = `ZodError`));
      let r = Object.getPrototypeOf(e);
      Uo.has(r) ||
        (Uo.add(r),
        Wo(r, `format`, (e) => (t) => ut(e, t)),
        Wo(r, `flatten`, (e) => (t) => lt(e, t)),
        Wo(r, `addIssue`, (e) => (t) => {
          (e.issues.push(t), (e.message = JSON.stringify(e.issues, n, 2)));
        }),
        Wo(r, `addIssues`, (e) => (t) => {
          (e.issues.push(...t), (e.message = JSON.stringify(e.issues, n, 2)));
        }),
        Object.defineProperty(r, `isEmpty`, {
          configurable: !0,
          enumerable: !1,
          get() {
            return this.issues.length === 0;
          },
        }));
    },
    void 0,
    { Parent: Error },
  ),
  Ko = ft(Go),
  qo = pt(Go),
  Jo = mt(Go),
  Yo = gt(Go),
  Xo = St(Go),
  Zo = Ct(Go),
  Qo = wt(Go),
  $o = Tt(Go),
  es = Et(Go),
  ts = Dt(Go),
  ns = Ot(Go),
  rs = kt(Go);
function is() {
  $e.localeError || et(Di());
}
function as() {
  $e.memoizer || et({ memoizer: wi() });
}
var x = _(`ZodType`, (e, t) => (is(), v.init(e, t), (e.def = t), (e.type = t.type), e), {
    check(...e) {
      let t = this.def;
      return this.clone(
        m(t, {
          checks: [
            ...(t.checks ?? []),
            ...e.map((e) =>
              typeof e == `function`
                ? { _zod: { check: e, def: { check: `custom` }, onattach: [] } }
                : e,
            ),
          ],
        }),
        { parent: !0 },
      );
    },
    with(...e) {
      return this.check(...e);
    },
    clone(e, t) {
      return ue(this, e, t);
    },
    brand() {
      return this;
    },
    register(e, t) {
      return (e.add(this, t), this);
    },
    refine(e, t) {
      return this.check(Sc(e, t));
    },
    superRefine(e, t) {
      return this.check(Cc(e, t));
    },
    overwrite(e) {
      return this.check(Da(e));
    },
    optional() {
      return rc(this);
    },
    exactOptional() {
      return ac(this);
    },
    nullable() {
      return sc(this);
    },
    nullish() {
      return rc(sc(this));
    },
    nonoptional(e) {
      return pc(this, e);
    },
    array() {
      return D(this);
    },
    or(e) {
      return k([this, e]);
    },
    and(e) {
      return Ys(this, e);
    },
    transform(e) {
      return _c(this, tc(e));
    },
    default(e) {
      return lc(this, e);
    },
    prefault(e) {
      return dc(this, e);
    },
    catch(e) {
      return hc(this, e);
    },
    pipe(e) {
      return _c(this, e);
    },
    readonly() {
      return bc(this);
    },
    describe(e) {
      let t = this.clone();
      return (ji.add(t, { description: e }), t);
    },
    meta(...e) {
      if (e.length === 0) return ji.get(this);
      let t = this.clone();
      return (ji.add(t, e[0]), t);
    },
    isOptional() {
      return this.safeParse(void 0).success;
    },
    isNullable() {
      return this.safeParse(null).success;
    },
    apply(e, ...t) {
      return t.length === 0 ? e(this) : e(this, ...t);
    },
    get "~standard"() {
      return Le(this, `~standard`, {
        ...Nn(this),
        jsonSchema: { input: Za(this, `input`), output: Za(this, `output`) },
      });
    },
    set "~standard"(e) {
      Ie(this, `~standard`, e);
    },
    parse: function e(t, n) {
      return Ko(this, t, n, { callee: e });
    },
    parseAsync: async function e(t, n) {
      return await qo(this, t, n, { callee: e });
    },
    safeParse(e, t) {
      return Jo(this, e, t);
    },
    async safeParseAsync(e, t) {
      return Yo(this, e, t);
    },
    get spa() {
      return this?.safeParseAsync;
    },
    set spa(e) {
      Ie(this, `spa`, e);
    },
    validate(e, t) {
      return yt(this, e, t);
    },
    validateAsync(e, t) {
      return xt(this, e, t);
    },
    encode: function e(t, n) {
      return Xo(this, t, n, { callee: e });
    },
    decode: function e(t, n) {
      return Zo(this, t, n, { callee: e });
    },
    encodeAsync: async function e(t, n) {
      return await Qo(this, t, n, { callee: e });
    },
    decodeAsync: async function e(t, n) {
      return await $o(this, t, n, { callee: e });
    },
    safeEncode(e, t) {
      return es(this, e, t);
    },
    safeDecode(e, t) {
      return ts(this, e, t);
    },
    async safeEncodeAsync(e, t) {
      return ns(this, e, t);
    },
    async safeDecodeAsync(e, t) {
      return rs(this, e, t);
    },
    toJSONSchema(e) {
      return Xa(this, {})(e);
    },
    get description() {
      return ji.get(this)?.description;
    },
    get _def() {
      return this._zod.def;
    },
  }),
  os = _(
    `_ZodString`,
    (e, t) => {
      (Pn.init(e, t), x.init(e, t), (e._zod.processJSONSchema = (t, n, r) => mo(e, t, n, r)));
    },
    Re(
      {
        format: (e) => lo(e).format ?? null,
        minLength: (e) => lo(e).minimum ?? null,
        maxLength: (e) => lo(e).maximum ?? null,
      },
      {
        regex(...e) {
          return this.check(xa(...e));
        },
        includes(...e) {
          return this.check(wa(...e));
        },
        startsWith(...e) {
          return this.check(Ta(...e));
        },
        endsWith(...e) {
          return this.check(Ea(...e));
        },
        min(...e) {
          return this.check(ya(...e));
        },
        max(...e) {
          return this.check(va(...e));
        },
        length(...e) {
          return this.check(ba(...e));
        },
        nonempty(...e) {
          return this.check(ya(1, ...e));
        },
        lowercase(e) {
          return this.check(Sa(e));
        },
        uppercase(e) {
          return this.check(Ca(e));
        },
        trim() {
          return this.check(ka());
        },
        normalize(...e) {
          return this.check(Oa(...e));
        },
        toLowerCase() {
          return this.check(Aa());
        },
        toUpperCase() {
          return this.check(ja());
        },
        slugify() {
          return this.check(Ma());
        },
      },
    ),
  ),
  ss = _(
    `ZodString`,
    (e, t) => {
      (Pn.init(e, t), os.init(e, t));
    },
    {
      email(e) {
        return this.check(Pi(fs, e));
      },
      url(e) {
        return this.check(Bi(gs, e));
      },
      jwt(e) {
        return this.check(ta(js, e));
      },
      emoji(e) {
        return this.check(Vi(_s, e));
      },
      guid(e) {
        return this.check(Fi(ps, e));
      },
      uuid(e) {
        return this.check(Ii(ms, e));
      },
      uuidv4(e) {
        return this.check(Li(ms, e));
      },
      uuidv6(e) {
        return this.check(Ri(ms, e));
      },
      uuidv7(e) {
        return this.check(zi(ms, e));
      },
      nanoid(e) {
        return this.check(Hi(vs, e));
      },
      cuid(e) {
        return this.check(Ui(ys, e));
      },
      cuid2(e) {
        return this.check(Wi(bs, e));
      },
      ulid(e) {
        return this.check(Gi(xs, e));
      },
      base64(e) {
        return this.check(Qi(Os, e));
      },
      base64url(e) {
        return this.check($i(ks, e));
      },
      xid(e) {
        return this.check(Ki(Ss, e));
      },
      ksuid(e) {
        return this.check(qi(Cs, e));
      },
      ipv4(e) {
        return this.check(Ji(ws, e));
      },
      ipv6(e) {
        return this.check(Yi(Ts, e));
      },
      cidrv4(e) {
        return this.check(Xi(Es, e));
      },
      cidrv6(e) {
        return this.check(Zi(Ds, e));
      },
      e164(e) {
        return this.check(ea(As, e));
      },
      datetime(e) {
        return this.check(na(cs, e));
      },
      date(e) {
        return this.check(ra(ls, e));
      },
      time(e) {
        return this.check(ia(us, e));
      },
      duration(e) {
        return this.check(aa(ds, e));
      },
    },
  );
function S(e) {
  return Ni(ss, e);
}
var C = _(`ZodStringFormat`, (e, t) => {
    (y.init(e, t), os.init(e, t));
  }),
  cs = _(`ZodISODateTime`, (e, t) => {
    ($n.init(e, t), C.init(e, t));
  }),
  ls = _(`ZodISODate`, (e, t) => {
    (er.init(e, t), C.init(e, t));
  }),
  us = _(`ZodISOTime`, (e, t) => {
    (tr.init(e, t), C.init(e, t));
  }),
  ds = _(`ZodISODuration`, (e, t) => {
    (nr.init(e, t), C.init(e, t));
  }),
  fs = _(`ZodEmail`, (e, t) => {
    (Ln.init(e, t), C.init(e, t));
  }),
  ps = _(`ZodGUID`, (e, t) => {
    (Fn.init(e, t), C.init(e, t));
  }),
  ms = _(`ZodUUID`, (e, t) => {
    (In.init(e, t), C.init(e, t));
  });
function hs(e) {
  return Ii(ms, e);
}
var gs = _(`ZodURL`, (e, t) => {
    (Gn.init(e, t), C.init(e, t));
  }),
  _s = _(`ZodEmoji`, (e, t) => {
    (Kn.init(e, t), C.init(e, t));
  }),
  vs = _(`ZodNanoID`, (e, t) => {
    (qn.init(e, t), C.init(e, t));
  }),
  ys = _(`ZodCUID`, (e, t) => {
    (Jn.init(e, t), C.init(e, t));
  }),
  bs = _(`ZodCUID2`, (e, t) => {
    (Yn.init(e, t), C.init(e, t));
  }),
  xs = _(`ZodULID`, (e, t) => {
    (Xn.init(e, t), C.init(e, t));
  }),
  Ss = _(`ZodXID`, (e, t) => {
    (Zn.init(e, t), C.init(e, t));
  }),
  Cs = _(`ZodKSUID`, (e, t) => {
    (Qn.init(e, t), C.init(e, t));
  }),
  ws = _(`ZodIPv4`, (e, t) => {
    (rr.init(e, t), C.init(e, t));
  }),
  Ts = _(`ZodIPv6`, (e, t) => {
    (or.init(e, t), C.init(e, t));
  }),
  Es = _(`ZodCIDRv4`, (e, t) => {
    (sr.init(e, t), C.init(e, t));
  }),
  Ds = _(`ZodCIDRv6`, (e, t) => {
    (lr.init(e, t), C.init(e, t));
  }),
  Os = _(`ZodBase64`, (e, t) => {
    (fr.init(e, t), C.init(e, t));
  }),
  ks = _(`ZodBase64URL`, (e, t) => {
    (hr.init(e, t), C.init(e, t));
  }),
  As = _(`ZodE164`, (e, t) => {
    (gr.init(e, t), C.init(e, t));
  }),
  js = _(`ZodJWT`, (e, t) => {
    (vr.init(e, t), C.init(e, t));
  }),
  Ms = _(
    `ZodNumber`,
    (e, t) => {
      (yr.init(e, t),
        x.init(e, t),
        (e._zod.processJSONSchema = (t, n, r) => ho(e, t, n, r)),
        (e.isFinite = !0));
    },
    Re(
      {
        minValue: (e) => {
          let { minimum: t, exclusiveMinimum: n } = lo(e);
          return Math.max(t ?? -1 / 0, n ?? -1 / 0);
        },
        maxValue: (e) => {
          let { maximum: t, exclusiveMaximum: n } = lo(e);
          return Math.min(t ?? 1 / 0, n ?? 1 / 0);
        },
        isInt: (e) => {
          let { isInt: t, multipleOf: n } = lo(e);
          return !!t || !!n?.some(Number.isSafeInteger);
        },
        format: (e) => lo(e).format ?? null,
      },
      {
        gt(e, t) {
          return this.check(ha(e, t));
        },
        gte(e, t) {
          return this.check(ga(e, t));
        },
        min(e, t) {
          return this.check(ga(e, t));
        },
        lt(e, t) {
          return this.check(pa(e, t));
        },
        lte(e, t) {
          return this.check(ma(e, t));
        },
        max(e, t) {
          return this.check(ma(e, t));
        },
        int(e) {
          return this.check(Ps(e));
        },
        safe(e) {
          return this.check(Ps(e));
        },
        positive(e) {
          return this.check(ha(0, e));
        },
        nonnegative(e) {
          return this.check(ga(0, e));
        },
        negative(e) {
          return this.check(pa(0, e));
        },
        nonpositive(e) {
          return this.check(ma(0, e));
        },
        multipleOf(e, t) {
          return this.check(_a(e, t));
        },
        step(e, t) {
          return this.check(_a(e, t));
        },
        finite() {
          return this;
        },
      },
    ),
  );
function w(e) {
  return oa(Ms, e);
}
var Ns = _(`ZodNumberFormat`, (e, t) => {
  (br.init(e, t), Ms.init(e, t));
});
function Ps(e) {
  return sa(Ns, e);
}
var Fs = _(`ZodBoolean`, (e, t) => {
  (xr.init(e, t), x.init(e, t), (e._zod.processJSONSchema = (t, n, r) => go(e, t, n, r)));
});
function T(e) {
  return ca(Fs, e);
}
var Is = _(`ZodUndefined`, (e, t) => {
  (Sr.init(e, t), x.init(e, t), (e._zod.processJSONSchema = (t, n, r) => _o(e, t, n, r)));
});
function Ls(e) {
  return la(Is, e);
}
var Rs = _(`ZodUnknown`, (e, t) => {
  (Cr.init(e, t), x.init(e, t), (e._zod.processJSONSchema = (e, t, n) => void 0));
});
function E() {
  return ua(Rs);
}
var zs = _(`ZodNever`, (e, t) => {
  (wr.init(e, t), x.init(e, t), (e._zod.processJSONSchema = (t, n, r) => vo(e, t, n, r)));
});
function Bs(e) {
  return da(zs, e);
}
var Vs = _(
  `ZodDate`,
  (e, t) => {
    (Tr.init(e, t),
      x.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => yo(e, t, n, r)),
      (e.min = (t, n) => e.check(ga(t, n))),
      (e.max = (t, n) => e.check(ma(t, n))));
  },
  Re(
    {
      minDate: (e) => {
        let { minimum: t } = lo(e);
        return t ? new Date(t) : null;
      },
      maxDate: (e) => {
        let { maximum: t } = lo(e);
        return t ? new Date(t) : null;
      },
    },
    {},
  ),
);
function Hs(e) {
  return fa(Vs, e);
}
var Us = _(
  `ZodArray`,
  (e, t) => {
    (as(),
      Dr.init(e, t),
      x.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => wo(e, t, n, r)),
      (e.element = t.element));
  },
  {
    min(e, t) {
      return this.check(ya(e, t));
    },
    nonempty(e) {
      return this.check(ya(1, e));
    },
    max(e, t) {
      return this.check(va(e, t));
    },
    length(e, t) {
      return this.check(ba(e, t));
    },
    unwrap() {
      return this.element;
    },
  },
);
function D(e, t) {
  return Na(Us, e, t);
}
var Ws = _(
  `ZodObject`,
  (e, t) => {
    (as(),
      Nr.init(e, t),
      x.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => Eo(e, t, n, r)),
      We(e, `shape`, (e) => e._zod.def.shape, !1));
  },
  {
    keyof() {
      return M(Object.keys(this._zod.def.shape));
    },
    catchall(e) {
      return this.clone(m(this._zod.def, { catchall: e }));
    },
    passthrough() {
      return this.clone(m(this._zod.def, { catchall: E() }));
    },
    loose() {
      return this.clone(m(this._zod.def, { catchall: E() }));
    },
    strict() {
      return this.clone(m(this._zod.def, { catchall: Bs() }));
    },
    strip() {
      return this.clone(m(this._zod.def, { catchall: void 0 }));
    },
    extend(e) {
      return ve(this, e);
    },
    safeExtend(e) {
      return be(this, e);
    },
    merge(e) {
      return xe(this, e);
    },
    pick(e) {
      return he(this, e);
    },
    omit(e) {
      return _e(this, e);
    },
    partial(...e) {
      return Se(nc, this, e[0]);
    },
    exactPartial(...e) {
      return Se(ic, this, e[0], `exactPartial`);
    },
    required(...e) {
      return Ce(fc, this, e[0]);
    },
  },
);
function O(e, t) {
  return new Ws({ type: `object`, shape: e ?? {}, ...h(t) });
}
function Gs(e, t) {
  return new Ws({ type: `object`, shape: e, catchall: Bs(), ...h(t) });
}
var Ks = _(`ZodUnion`, (e, t) => {
  (Fr.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Do(e, t, n, r)),
    (e.options = t.options));
});
function k(e, t) {
  return new Ks({ type: `union`, options: e, ...h(t) });
}
var qs = _(`ZodDiscriminatedUnion`, (e, t) => {
  (Ks.init(e, t), Lr.init(e, t));
});
function A(e, t, n) {
  return new qs({ type: `union`, options: t, discriminator: e, ...h(n) });
}
var Js = _(`ZodIntersection`, (e, t) => {
  (Rr.init(e, t), x.init(e, t), (e._zod.processJSONSchema = (t, n, r) => Oo(e, t, n, r)));
});
function Ys(e, t) {
  return new Js({ type: `intersection`, left: e, right: t });
}
var Xs = _(`ZodRecord`, (e, t) => {
  (as(),
    Vr.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Mo(e, t, n, r)),
    (e.keyType = t.keyType),
    (e.valueType = t.valueType));
});
function j(e, t, n) {
  return !t || !t._zod
    ? new Xs({ type: `record`, keyType: S(), valueType: e, ...h(t) })
    : new Xs({ type: `record`, keyType: e, valueType: t, ...h(n) });
}
function Zs(e, t, n) {
  return new Xs({ type: `record`, keyType: e, valueType: t, ...h(n), partial: !0 });
}
var Qs = _(`ZodEnum`, (e, t) => {
  (Hr.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => bo(e, t, n, r)),
    (e.enum = t.entries),
    (e.options = [...e._zod.values]));
  let n = new Set(Object.keys(t.entries));
  ((e.extract = (e, r) => {
    let i = {};
    for (let r of e)
      if (n.has(r)) i[r] = t.entries[r];
      else throw Error(`Key ${r} not found in enum`);
    return new Qs({ ...t, checks: [], ...h(r), entries: i });
  }),
    (e.exclude = (e, r) => {
      let i = { ...t.entries };
      for (let t of e)
        if (n.has(t)) delete i[t];
        else throw Error(`Key ${t} not found in enum`);
      return new Qs({ ...t, checks: [], ...h(r), entries: i });
    }));
});
function M(e, t) {
  return new Qs({
    type: `enum`,
    entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
    ...h(t),
  });
}
var $s = _(`ZodLiteral`, (e, t) => {
  (Ur.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => xo(e, t, n, r)),
    (e.values = new Set(t.values)),
    Object.defineProperty(e, `value`, {
      get() {
        if (t.values.length > 1)
          throw Error("This schema contains multiple valid literal values. Use `.values` instead.");
        return t.values[0];
      },
    }));
});
function N(e, t) {
  return new $s({ type: `literal`, values: Array.isArray(e) ? e : [e], ...h(t) });
}
var ec = _(`ZodTransform`, (e, t) => {
  (as(),
    Wr.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Co(e, t, n, r)),
    (e._zod.parse = (n, r) => {
      if (r.direction === `backward`) throw new Qe(e.constructor.name);
      n.addIssue = (r) => {
        if (typeof r == `string`) n.issues.push(Pe(r, n.value, t));
        else {
          let t = r;
          (t.fatal && (t.continue = !1),
            (t.code ??= `custom`),
            `input` in t || (t.input = n.value),
            (t.inst ??= e),
            n.issues.push(Pe(t)));
        }
      };
      let i = t.transform(n.value, n);
      return i instanceof Promise ? i.then((e) => ((n.value = e), n)) : ((n.value = i), n);
    }));
});
function tc(e) {
  return new ec({ type: `transform`, transform: e });
}
var nc = _(`ZodOptional`, (e, t) => {
  (Kr.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ho(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function rc(e) {
  return new nc({ type: `optional`, innerType: e });
}
var ic = _(`ZodExactOptional`, (e, t) => {
  (qr.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ho(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function ac(e) {
  return new ic({ type: `optional`, innerType: e });
}
var oc = _(`ZodNullable`, (e, t) => {
  (Jr.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => No(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function sc(e) {
  return new oc({ type: `nullable`, innerType: e });
}
var cc = _(`ZodDefault`, (e, t) => {
  (Yr.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Lo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeDefault = e.unwrap));
});
function lc(e, t) {
  return new cc({
    type: `default`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : se(t);
    },
  });
}
var uc = _(`ZodPrefault`, (e, t) => {
  (Zr.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ro(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function dc(e, t) {
  return new uc({
    type: `prefault`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : se(t);
    },
  });
}
var fc = _(`ZodNonOptional`, (e, t) => {
  (Qr.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Po(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function pc(e, t) {
  return new fc({ type: `nonoptional`, innerType: e, ...h(t) });
}
var mc = _(`ZodCatch`, (e, t) => {
  (ti.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => zo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeCatch = e.unwrap));
});
function hc(e, t) {
  return new mc({ type: `catch`, innerType: e, catchValue: typeof t == `function` ? t : Ke(t) });
}
var gc = _(`ZodPipe`, (e, t) => {
  (ni.init(e, t),
    x.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Bo(e, t, n, r)),
    (e.in = t.in),
    (e.out = t.out));
});
function _c(e, t) {
  return new gc({ type: `pipe`, in: e, out: t });
}
var vc = _(`ZodPreprocess`, (e, t) => {
    (gc.init(e, t), ii.init(e, t));
  }),
  yc = _(`ZodReadonly`, (e, t) => {
    (ai.init(e, t),
      x.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => Vo(e, t, n, r)),
      (e.unwrap = () => e._zod.def.innerType));
  });
function bc(e) {
  return new yc({ type: `readonly`, innerType: e });
}
var xc = _(`ZodCustom`, (e, t) => {
  (si.init(e, t), x.init(e, t), (e._zod.processJSONSchema = (t, n, r) => So(e, t, n, r)));
});
function Sc(e, t = {}) {
  return Pa(xc, e, t);
}
function Cc(e, t) {
  return Fa(e, t);
}
function wc(e, t) {
  return new vc({ type: `pipe`, in: tc(e), out: t });
}
var P = {
    invalid_type: `invalid_type`,
    too_big: `too_big`,
    too_small: `too_small`,
    invalid_format: `invalid_format`,
    not_multiple_of: `not_multiple_of`,
    unrecognized_keys: `unrecognized_keys`,
    invalid_union: `invalid_union`,
    invalid_key: `invalid_key`,
    invalid_element: `invalid_element`,
    invalid_value: `invalid_value`,
    custom: `custom`,
  },
  Tc;
(function (e) {})((Tc ||= {}));
var Ec = O({
    variant: M([``, `default`, `outline`, `secondary`, `ghost`, `destructive`, `warning`, `link`])
      .optional()
      .transform((e) => e || `default`),
    class: S().max(512).optional(),
    style: S().max(512).optional(),
  }),
  Dc = S()
    .max(4096)
    .url()
    .refine(
      (e) =>
        URL.canParse(e) && /^https?:\/\//iu.test(e) && !new URL(e).username && !new URL(e).password,
    ),
  Oc = S().min(1).max(128),
  kc = O({
    type: N(`image`),
    src: Dc,
    darkSrc: Dc.optional(),
    alt: S().max(500),
    fit: M([`cover`, `contain`]).optional(),
  }),
  Ac = O({
    format: N(`zip`),
    url: Dc,
    entry: S().min(1).max(240),
    sha256: S().regex(/^[a-f0-9]{64}$/u),
    sizeBytes: w()
      .int()
      .positive()
      .max(8 * 1024 * 1024)
      .optional(),
  }),
  jc = A(`type`, [
    kc,
    O({
      type: N(`video`),
      src: Dc,
      darkSrc: Dc.optional(),
      poster: Dc,
      autoplay: T().optional(),
      loop: T().optional(),
      muted: N(!0),
      fit: M([`cover`, `contain`]).optional(),
    }),
    O({
      type: N(`lottie`),
      src: Dc,
      darkSrc: Dc.optional(),
      autoplay: T().optional(),
      loop: T().optional(),
      speed: w().min(0.1).max(4).optional(),
      fallback: kc.optional(),
    }),
    O({
      type: N(`interactive_bundle`),
      runtime: N(`zcode-hero-sandbox-v1`),
      bundle: Ac,
      viewport: O({ aspectRatio: N(`4:3`) }),
      data: j(S(), E()).refine((e) => JSON.stringify(e).length <= 64e3),
      events: j(Oc, Oc).refine((e) => Object.keys(e).length <= 16),
      fallback: kc.optional(),
    }),
  ]),
  Mc = A(`type`, [
    O({ type: N(`close`) }),
    O({ type: N(`dismiss_content`) }),
    O({ type: N(`navigate`), destination: M([`model_settings`, `plugin_store`, `settings`]) }),
    O({ type: N(`copy_text`), text: S().max(2e4) }),
    O({ type: N(`open_external`), url: Dc }),
    O({ type: N(`claim_plan`), planId: Oc }),
  ]);
O({
  schemaVersion: N(1),
  id: Oc,
  revision: w().int().positive(),
  kind: M([`campaign`, `feature`, `notice`]),
  locale: M([`zh-CN`, `en-US`]),
  dialog: O({
    title: S().min(1).max(500),
    description: O({ format: M([`plain_text`, `html`, `markdown`]), text: S().max(2e4) }),
    hero: jc,
    buttons: D(
      O({
        id: Oc,
        label: S().min(1).max(200),
        variant: M([`primary`, `secondary`, `link`]),
        theme: Ec.nullish(),
        actionId: Oc,
      }),
    ).max(4),
  }),
  actions: j(Oc, Mc).refine((e) => Object.keys(e).length <= 16),
}).superRefine((e, t) => {
  let n = new Set();
  for (let r of e.dialog.buttons)
    ((n.has(r.id) || !Object.hasOwn(e.actions, r.actionId)) &&
      t.addIssue({ code: `custom`, message: `Duplicate button or missing action` }),
      n.add(r.id));
});
var Nc = `zh-CN`,
  Pc = `3.14.3`;
function Fc(e) {
  if (e.kind === `ssh`) {
    let { password: t, privateKeyPassphrase: n, ...r } = e;
    return r;
  }
  if (e.kind === `server`) {
    let { token: t, ...n } = e;
    return n;
  }
  return e;
}
function Ic(e) {
  let t = e.match(/^([A-Z]:)\/(.*)$/);
  if (t) return { prefix: `${t[1]}/`, body: t[2] ?? ``, blocksParentTraversal: !0 };
  if (e.startsWith(`//`)) {
    let t = e.slice(2).split(`/`).filter(Boolean);
    if (t.length >= 2) {
      let [e, n, ...r] = t;
      return { prefix: `//${e}/${n}/`, body: r.join(`/`), blocksParentTraversal: !0 };
    }
    return { prefix: `//`, body: t.join(`/`), blocksParentTraversal: !0 };
  }
  if (e.startsWith(`/`))
    return { prefix: `/`, body: e.replace(/^\/+/, ``), blocksParentTraversal: !0 };
  if (e.startsWith(`~/`)) return { prefix: `~/`, body: e.slice(2), blocksParentTraversal: !1 };
  let n = e.match(/^([A-Z]:)(.*)$/);
  return n
    ? { prefix: n[1] ?? ``, body: n[2] ?? ``, blocksParentTraversal: !1 }
    : { prefix: ``, body: e, blocksParentTraversal: !1 };
}
function Lc(e) {
  let t = e?.trim();
  if (!t) return ``;
  let n = Ic(t.replace(/\\/g, `/`).replace(/^([a-z]):/i, (e, t) => `${t.toUpperCase()}:`)),
    r = [];
  for (let e of n.body.split(`/`))
    if (!(!e || e === `.`)) {
      if (e === `..`) {
        if (r.length > 0 && r.at(-1) !== `..`) {
          r.pop();
          continue;
        }
        if (n.blocksParentTraversal) continue;
        r.push(e);
        continue;
      }
      r.push(e);
    }
  return `${n.prefix}${r.join(`/`)}` || n.prefix;
}
function Rc(e) {
  return e.privateKeyPath?.trim()
    ? `private-key`
    : (`password` in e && typeof e.password == `string`) ||
        (`passwordCredentialKey` in e && e.passwordCredentialKey?.trim())
      ? `password`
      : `agent`;
}
function zc(e) {
  return JSON.stringify([
    `ssh:v1`,
    e.host.trim().toLowerCase(),
    e.port ?? 22,
    e.username.trim(),
    Rc(e),
    Lc(e.privateKeyPath),
  ]);
}
var Bc = [
  {
    id: `openCommandCenter`,
    channel: `window`,
    defaultBindings: [`CmdOrCtrl+k`, `CmdOrCtrl+Shift+p`],
  },
  { id: `openSettings`, channel: `window`, defaultBindings: [`CmdOrCtrl+,`] },
  { id: `findInTask`, channel: `window`, defaultBindings: [`CmdOrCtrl+f`] },
  { id: `toggleSidebar`, channel: `window`, defaultBindings: [`CmdOrCtrl+b`] },
  { id: `switchTheme`, channel: `window`, defaultBindings: [`CmdOrCtrl+Shift+l`] },
  { id: `toggleTerminal`, channel: `window`, defaultBindings: [`CmdOrCtrl+j`] },
  { id: `toggleSidePane`, channel: `window`, defaultBindings: [`CmdOrCtrl+Alt+b`] },
  { id: `previousConversation`, channel: `window`, defaultBindings: [`CmdOrCtrl+Shift+[`] },
  { id: `nextConversation`, channel: `window`, defaultBindings: [`CmdOrCtrl+Shift+]`] },
  { id: `navigateBack`, channel: `window`, defaultBindings: [`CmdOrCtrl+[`] },
  { id: `navigateForward`, channel: `window`, defaultBindings: [`CmdOrCtrl+]`] },
  { id: `openModelMenu`, channel: `window`, defaultBindings: [`Ctrl+m`] },
  { id: `cycleSessionMode`, channel: `window`, defaultBindings: [`Ctrl+Shift+m`] },
  { id: `cycleThoughtLevel`, channel: `window`, defaultBindings: [`Ctrl+t`] },
  { id: `newTask`, channel: `menu`, defaultBindings: [`CmdOrCtrl+n`] },
  { id: `openWorkspace`, channel: `menu`, defaultBindings: [`CmdOrCtrl+o`] },
  { id: `closeActiveContext`, channel: `menu`, defaultBindings: [`CmdOrCtrl+w`] },
  { id: `zoomIn`, channel: `menu`, defaultBindings: [`CmdOrCtrl+=`] },
  { id: `zoomOut`, channel: `menu`, defaultBindings: [`CmdOrCtrl+-`] },
  { id: `resetZoom`, channel: `menu`, defaultBindings: [`CmdOrCtrl+0`] },
  { id: `composerSend`, channel: `window`, scope: `composer`, defaultBindings: [`Enter`] },
  {
    id: `composerInsertNewline`,
    channel: `window`,
    scope: `composer`,
    defaultBindings: [`Shift+Enter`],
  },
  { id: `toggleInterfaceMode`, channel: `window`, defaultBindings: [`CmdOrCtrl+Shift+u`] },
  { id: `openOnboarding`, channel: `window`, defaultBindings: [`CmdOrCtrl+Shift+o`] },
];
function Vc(e) {
  return Bc.find((t) => t.id === e)?.defaultBindings ?? [];
}
var Hc = [
    [`CmdOrCtrl`, `cmdOrCtrl`],
    [`Ctrl`, `ctrl`],
    [`Alt`, `alt`],
    [`Shift`, `shift`],
    [`AltGr`, `altGr`],
  ],
  Uc = { Plus: `=`, Equal: `=`, Minus: `-` },
  Wc = /^[a-z0-9[\]=\-,./;'\\`]$/,
  Gc = new Set([
    ...Array.from({ length: 12 }, (e, t) => `F${t + 1}`),
    `ArrowUp`,
    `ArrowDown`,
    `ArrowLeft`,
    `ArrowRight`,
    `Home`,
    `End`,
    `PageUp`,
    `PageDown`,
    `Delete`,
    `Insert`,
    `Enter`,
  ]);
function Kc(e) {
  let t = Uc[e] ?? e;
  return Wc.test(t) || Gc.has(t) ? t : null;
}
function qc(e) {
  let t = e.split(`+`),
    n = t[t.length - 1];
  if (n === void 0 || n === ``) return null;
  let r = { cmdOrCtrl: !1, ctrl: !1, alt: !1, shift: !1, altGr: !1, key: `` };
  for (let e of t.slice(0, -1)) {
    let t = Hc.find(([t]) => t === e);
    if (!t || r[t[1]]) return null;
    r[t[1]] = !0;
  }
  let i = Kc(n);
  return i === null ? null : ((r.key = i), r);
}
function Jc(e) {
  let t = Kc(e.key);
  if (t === null) return null;
  let n = [];
  for (let [t, r] of Hc) e[r] && n.push(t);
  return (n.push(t), n.join(`+`));
}
function Yc(e) {
  return e?.trim().toLowerCase() === `production` ? `production` : `test`;
}
var Xc = Yc(`production`);
function Zc(e, t) {
  let n = e?.trim().toLowerCase();
  return n === `production` || n === `preview` ? n : t === `production` ? `production` : `preview`;
}
var Qc = Zc(typeof __ZCODE_PRODUCT_FLAVOR__ < `u` ? __ZCODE_PRODUCT_FLAVOR__ : void 0, Xc);
typeof process < `u` && {}.ZCODE_DEBUG;
function $c(e) {
  return typeof e == `object` && !!e;
}
function el(e) {
  if (typeof e == `string` || typeof e == `number` || typeof e == `bigint`) return String(e);
}
function tl(e) {
  return !$c(e) || !(`error` in e) || !$c(e.error)
    ? e
    : `message` in e.error || `code` in e.error
      ? e.error
      : e;
}
var nl = `ZCODE_FILE_LOCK_TIMEOUT`;
function rl(e) {
  if (typeof e == `string`) return e;
  if (e === null) return `null`;
  if (e === void 0) return `undefined`;
  if (typeof e == `number` || typeof e == `boolean` || typeof e == `bigint`) return String(e);
  try {
    let t = JSON.stringify(e);
    if (t !== void 0) return t;
  } catch {}
  return String(e);
}
function il(e) {
  let t = tl(e);
  if (t instanceof Error) {
    let e = t;
    return { message: t.message || t.name || String(t), code: el(e.code) };
  }
  if ($c(t)) {
    let e = `code` in t ? el(t.code) : void 0,
      n = `message` in t ? rl(t.message) : rl(t);
    return { message: n !== `undefined` && n.length > 0 ? n : rl(t), code: e };
  }
  return { message: rl(t) };
}
function al(e) {
  return il(e).code === nl;
}
var ol = `zcode-desktop-renderer`,
  sl = 0.2,
  cl = M([`core`, `settings`, `workbench`, `extensions`, `automation`, `account`]);
O({
  enabled: T(),
  localTtftEnabled: T().optional(),
  sampleRatio: w().finite().min(0).max(sl),
  enabledGroups: D(cl).max(6),
  configVersion: S().trim().min(1).max(128),
}).strict();
var ll = S().regex(/^[0-9a-f]{32}$/u),
  ul = S().regex(/^[0-9a-f]{16}$/u),
  dl = S()
    .trim()
    .regex(/^[A-Za-z0-9._:-]{1,128}$/u),
  fl = S()
    .trim()
    .regex(/^[A-Za-z0-9._:-]{1,64}$/u),
  pl = O({
    feature_id: dl,
    action: dl,
    catalog_group: cl,
    operation_kind: M([`navigation`, `preference`, `command`, `management`, `destructive`]),
    surface: dl,
    trigger: M([`button`, `keyboard`, `shortcut`, `menu`, `switch`, `select`, `drag`]),
    outcome: M([`completed`, `failed`, `rejected`, `cancelled`, `noop`, `abandoned`]),
    result_source: M([
      `local_commit`,
      `shared_settings`,
      `setting_service`,
      `platform_result`,
      `authority_ack`,
      `optimistic_projection`,
    ]).optional(),
    failure_stage: dl.optional(),
    state_after: M([`enabled`, `disabled`]).optional(),
    configured: T().optional(),
    requires_restart: T().optional(),
    section_id: dl.optional(),
    value_after: fl.optional(),
    workspace_kind: M([`local`, `remote`]).optional(),
    remote_kind: M([`ssh`, `wsl`, `docker`, `server`]).optional(),
    admission_result: M([
      `accepted`,
      `rejected`,
      `stale`,
      `duplicate`,
      `noop`,
      `not_applicable`,
    ]).optional(),
    automation_kind: M([`scheduled`, `off_peak`]).optional(),
    action_id: S().uuid(),
  }).strict(),
  ml = O({
    traceId: ll,
    spanId: ul,
    name: N(`ui_action`),
    startTimeUnixMs: w().finite().nonnegative(),
    endTimeUnixMs: w().finite().nonnegative(),
    status: M([`unset`, `ok`, `error`]),
    attributes: pl,
  })
    .strict()
    .superRefine((e, t) => {
      e.endTimeUnixMs < e.startTimeUnixMs &&
        t.addIssue({
          code: `custom`,
          message: `endTimeUnixMs must be greater than or equal to startTimeUnixMs`,
          path: [`endTimeUnixMs`],
        });
    }),
  hl = O({
    serviceName: N(ol),
    serviceVersion: dl,
    deploymentEnvironment: M([`development`, `test`, `production`]),
    rendererInstanceId: dl,
  }).strict();
O({
  version: N(1),
  rendererInstanceId: dl,
  sequence: w().int().nonnegative(),
  droppedSinceLastFlush: w().int().nonnegative(),
  resource: hl,
  spans: D(ml).max(32),
})
  .strict()
  .superRefine((e, t) => {
    e.resource.rendererInstanceId !== e.rendererInstanceId &&
      t.addIssue({
        code: `custom`,
        message: `rendererInstanceId must match the resource`,
        path: [`resource`, `rendererInstanceId`],
      });
  });
var gl = M([
    `storage_full`,
    `permission_denied`,
    `io_error`,
    `out_of_memory`,
    `corrupt`,
    `open_failed`,
    `lock_timeout`,
    `checksum_mismatch`,
    `sql_failed`,
    `startup_status_timeout`,
    `transport_closed`,
    `unsupported_runtime`,
  ]),
  _l = O({
    sqliteCode: w().int().optional(),
    systemCode: S().max(64).optional(),
    migrationId: S().max(128).optional(),
  }),
  vl = O({
    scopeId: S().max(128),
    observedAvailableDropPeakBytes: w().finite().nonnegative().nullable(),
    minAvailableBytes: w().finite().nonnegative().nullable(),
    quality: M([`complete`, `partial`, `unknown`]),
    sampledAt: w().finite().nonnegative().nullable(),
  }).strict(),
  yl = M([
    `starting`,
    `preparing_host_storage`,
    `preparing_session_storage`,
    `starting_services`,
    `ready`,
    `failed`,
  ]),
  bl = S().regex(/^[a-zA-Z_0-9-]{1,128}$/),
  xl = O({
    kind: M([`none`, `initialize`, `upgrade`]),
    executedCount: w().int().nonnegative(),
    committedCount: w().int().nonnegative(),
    lastAppliedMigrationId: bl.nullable().optional(),
  })
    .strict()
    .superRefine((e, t) => {
      (e.committedCount > e.executedCount || (e.kind === `none` && e.executedCount !== 0)) &&
        t.addIssue({ code: `custom`, message: `Invalid migration execution facts` });
    }),
  Sl = O({
    schemaVersion: N(1),
    startupId: S().min(1).max(128),
    attemptId: S().min(1).max(128),
    sequence: w().int().nonnegative(),
    startedAt: w().finite().nonnegative(),
    updatedAt: w().finite().nonnegative(),
    phase: yl,
    databasePhase: M([
      `checking`,
      `waiting_for_lock`,
      `migrating`,
      `committing`,
      `maintaining`,
      `ready`,
    ]).optional(),
    migration: xl.optional(),
    currentMigration: xl.optional(),
    migrationBaselines: D(
      O({
        databaseId: S().min(1).max(128),
        databaseKind: M([`tasks-index`, `session`]),
        lastAppliedMigrationId: bl.nullable().optional(),
      }).strict(),
    ).optional(),
    finalDatabase: T().optional(),
    failedPhase: yl.optional(),
    errorCode: gl.optional(),
    ..._l.shape,
    disk: D(vl).max(8),
  }).strict();
O({ databaseStartupId: S().min(1).max(128) }).strict();
var Cl = A(`action`, [
    O({ action: N(`snapshot`) }).strict(),
    O({ action: N(`exit`) }).strict(),
    O({ action: N(`retry`), attemptId: S().min(1).max(128) }).strict(),
  ]),
  wl = O({
    elementName: N(`session_create`),
    eventRegion: N(`app`),
    eventType: N(`result`),
    talkId: S().min(1).max(512),
    messageId: S().min(1).max(512),
    context: O({
      clientTimezone: S().max(128),
      clientLanguage: S().max(128),
      screenResolution: S().max(64),
    }).strict(),
    eventExtraDetail: O({
      create_source: M([`group`, `project`, `session`]),
      client_kind: N(`mobile`),
      workspace_kind: M([`local`, `remote`]),
      remote_kind: M([``, `ssh`, `wsl`, `docker`, `server`]),
    }).strict(),
  }).strict(),
  Tl = wl.extend({
    eventExtraDetail: wl.shape.eventExtraDetail.extend({
      create_source: M([`automation_idle`, `automation_scheduled`]),
      client_kind: N(`desktop`),
    }),
  }),
  El = 4e3,
  Dl = 16e3,
  Ol = M([`uncaughtException`, `unhandledRejection`]),
  kl = O({
    version: N(1),
    errorId: hs(),
    kind: Ol,
    origin: Ol,
    name: S().min(1).max(128),
    message: S().max(El),
    stack: S().max(Dl).optional(),
    occurredAt: w().int().nonnegative(),
  }).strict(),
  Al = { minWidth: 320, maxWidth: 3840, minHeight: 320, maxHeight: 2160 },
  jl = { width: 1280, height: 720 },
  Ml = O({ width: w().int().positive(), height: w().int().positive() }).strict(),
  Nl = Ml.extend({
    width: w().int().min(Al.minWidth).max(Al.maxWidth),
    height: w().int().min(Al.minHeight).max(Al.maxHeight),
  }),
  Pl = [`fit`, `50`, `75`, `100`, `125`, `150`, `200`],
  Fl = M(Pl),
  Il = O({ mode: M([`normal`, `responsive`]), viewport: Nl, zoom: Fl }).strict(),
  Ll = { mode: `normal`, viewport: { width: 393, height: 852 }, zoom: `fit` };
M(
  `navigate.back.forward.reload.snapshot.click.fill.type.press.cuaKeypress.scroll.cuaScroll.domCuaScroll.hover.select.check.drag.cuaDrag.screenshot.getState.elementInfo.evaluate.getDialog.handleDialog.waitFor.playwright.playwrightWaitForTimeout.capabilities.browserVisibilityGet.browserVisibilitySet.browserViewportSet.browserViewportReset.recordingStart.recordingStatus.recordingCancel.activateTab.newTab.finalize.finalizeTabs.listUserTabs.claimTab.markDeliverable.markHandoff.nameSession.turnEnded.closeSession.cancelRequest.close.list`.split(
    `.`,
  ),
);
var Rl = M([`desktop-continuous`, `web-remote-replayable`]);
O({
  workspaceKey: S().min(1),
  sessionId: S().min(1),
  tabId: S().min(1).optional(),
  requestId: S().min(1),
  clientMode: Rl,
}).strict();
var zl = M([
    `backend_unavailable`,
    `capability_unsupported`,
    `duplicate_request_id`,
    `ref_not_found`,
    `navigation_blocked`,
    `timeout`,
    `renderer_unreachable`,
    `cancelled`,
    `execution_error`,
  ]),
  Bl = O({
    url: S(),
    title: S(),
    canGoBack: T(),
    canGoForward: T(),
    scrollX: w().optional(),
    scrollY: w().optional(),
    viewportWidth: w().optional(),
    viewportHeight: w().optional(),
  }).strict(),
  Vl = M([`left`, `right`, `middle`]),
  Hl = M([`Alt`, `Control`, `ControlOrMeta`, `Meta`, `Shift`]),
  Ul = O({ x: w(), y: w() }).strict(),
  F = w().int().nonnegative().max(9e4),
  Wl = S().trim().min(1).max(2e3),
  Gl = A(`type`, [
    O({ type: N(`wait`), durationMs: F }).strict(),
    O({
      type: N(`click`),
      selector: Wl.optional(),
      x: w().optional(),
      y: w().optional(),
      button: Vl.optional(),
      doubleClick: T().optional(),
      delayAfterMs: F.optional(),
    }).strict(),
    O({ type: N(`type`), selector: Wl, text: S().max(1e5), delayAfterMs: F.optional() }).strict(),
    O({
      type: N(`hover`),
      selector: Wl.optional(),
      x: w().optional(),
      y: w().optional(),
      durationMs: F.optional(),
      delayAfterMs: F.optional(),
    }).strict(),
    O({
      type: N(`move`),
      x: w(),
      y: w(),
      durationMs: F.optional(),
      delayAfterMs: F.optional(),
    }).strict(),
    O({
      type: N(`scroll`),
      deltaX: w().optional(),
      deltaY: w(),
      durationMs: F.optional(),
      delayAfterMs: F.optional(),
    }).strict(),
    O({
      type: N(`scrollTo`),
      selector: Wl.optional(),
      x: w().optional(),
      y: w().optional(),
      durationMs: F.optional(),
      delayAfterMs: F.optional(),
    }).strict(),
    O({
      type: N(`wheel`),
      deltaX: w().optional(),
      deltaY: w(),
      times: w().int().min(1).max(100).optional(),
      intervalMs: F.optional(),
      delayAfterMs: F.optional(),
    }).strict(),
    O({
      type: N(`drag`),
      path: D(Ul).min(2).max(200),
      durationMs: F.optional(),
      delayAfterMs: F.optional(),
    }).strict(),
    O({
      type: N(`waitFor`),
      selector: Wl,
      state: M([`attached`, `detached`, `visible`, `hidden`]).optional(),
      timeoutMs: w().int().positive().max(3e4).optional(),
      delayAfterMs: F.optional(),
    }).strict(),
  ]),
  Kl = O({
    viewport: Nl.optional(),
    fps: w().int().min(1).max(60).optional(),
    jpegQuality: w().int().min(1).max(100).optional(),
    maxDurationMs: w().int().min(1e3).max(9e4).optional(),
    settleMs: F.optional(),
    showCursor: T().optional(),
    actions: D(Gl).max(500).optional(),
  }).strict(),
  ql = S()
    .trim()
    .min(1)
    .max(2e3)
    .refine((e) => !/^[/\\]/u.test(e) && !/^[A-Za-z]:[/\\]/u.test(e), {
      message: `recording outputPath must be relative to the workspace`,
    })
    .refine((e) => !e.split(/[\\/]+/u).some((e) => e === `..` || e === `.` || e.length === 0), {
      message: `recording outputPath cannot escape the workspace`,
    })
    .refine((e) => e.toLowerCase().endsWith(`.webm`), {
      message: `recording outputPath must end with .webm`,
    }),
  Jl = M([
    `allTextContents`,
    `click`,
    `count`,
    `dblclick`,
    `downloadMedia`,
    `evaluate`,
    `fill`,
    `getAttribute`,
    `innerText`,
    `isEnabled`,
    `isVisible`,
    `press`,
    `selectOption`,
    `setChecked`,
    `textContent`,
    `waitFor`,
  ]),
  Yl = M([`Alt`, `Control`, `ControlOrMeta`, `Meta`, `Shift`]),
  Xl = w().int().positive().optional(),
  Zl = O({
    value: S().optional(),
    label: S().optional(),
    index: w().int().nonnegative().optional(),
  })
    .strict()
    .refine(
      (e) => e.value !== void 0 || e.label !== void 0 || e.index !== void 0,
      `Select option requires value, label, or index`,
    ),
  Ql = A(`name`, [
    O({ name: N(`domSnapshot`) }).strict(),
    O({ name: N(`elementInfo`), x: w(), y: w(), includeNonInteractable: T().optional() }).strict(),
    O({
      name: N(`elementScreenshot`),
      x: w(),
      y: w(),
      includeNonInteractable: T().optional(),
    }).strict(),
    O({
      name: N(`evaluate`),
      expression: S().min(1),
      expressionKind: M([`string`, `function`]),
      arg: E().optional(),
      timeoutMs: Xl,
    }).strict(),
    O({
      name: N(`waitForLoadState`),
      state: M([`load`, `domcontentloaded`, `networkidle`]).optional(),
      timeoutMs: Xl,
    }).strict(),
    O({
      name: N(`waitForURL`),
      url: S().min(1),
      waitUntil: M([`load`, `domcontentloaded`, `networkidle`, `commit`]).optional(),
      timeoutMs: Xl,
    }).strict(),
    O({ name: N(`waitForEvent`), event: M([`download`, `filechooser`]), timeoutMs: Xl }).strict(),
    O({ name: N(`downloadPath`), downloadId: S().min(1), timeoutMs: Xl }).strict(),
    O({
      name: N(`fileChooserSetFiles`),
      fileChooserId: S().min(1),
      files: D(S()).min(1),
      timeoutMs: Xl,
    }).strict(),
    O({
      name: N(`locator`),
      selector: S().min(1),
      operation: Jl,
      value: E().optional(),
      arg: E().optional(),
      expression: S().min(1).optional(),
      expressionKind: M([`string`, `function`]).optional(),
      attribute: S().min(1).optional(),
      checked: T().optional(),
      replace: T().optional(),
      force: T().optional(),
      button: Vl.optional(),
      modifiers: D(Yl).optional(),
      state: M([`attached`, `detached`, `visible`, `hidden`]).optional(),
      selections: D(Zl).min(1).optional(),
      timeoutMs: Xl,
    }).strict(),
  ]),
  $l = A(`method`, [
    O({ method: N(`navigate`), url: S().min(1), tabId: S().optional() }).strict(),
    O({ method: N(`back`), tabId: S().optional() }).strict(),
    O({ method: N(`forward`), tabId: S().optional() }).strict(),
    O({ method: N(`reload`), tabId: S().optional() }).strict(),
    O({
      method: N(`snapshot`),
      maxElements: w().int().positive().optional(),
      includeHidden: T().optional(),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`click`),
      ref: S().min(1).optional(),
      x: w().optional(),
      y: w().optional(),
      button: Vl.optional(),
      doubleClick: T().optional(),
      modifiers: D(Hl).optional(),
      tabId: S().optional(),
    }).strict(),
    O({ method: N(`fill`), ref: S().min(1), value: S(), tabId: S().optional() }).strict(),
    O({ method: N(`type`), ref: S().min(1).optional(), text: S(), tabId: S().optional() }).strict(),
    O({
      method: N(`press`),
      key: S().min(1),
      ref: S().min(1).optional(),
      modifiers: D(Hl).optional(),
      tabId: S().optional(),
    }).strict(),
    O({ method: N(`cuaKeypress`), keys: D(S().min(1)).min(1), tabId: S().optional() }).strict(),
    O({
      method: N(`scroll`),
      ref: S().min(1).optional(),
      x: w().optional(),
      y: w().optional(),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`cuaScroll`),
      x: w(),
      y: w(),
      scrollX: w(),
      scrollY: w(),
      modifiers: D(Hl).optional(),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`domCuaScroll`),
      nodeId: S().min(1).optional(),
      scrollX: w(),
      scrollY: w(),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`screenshot`),
      ref: S().min(1).optional(),
      fullPage: T().optional(),
      clip: O({ x: w(), y: w(), width: w().positive(), height: w().positive() })
        .strict()
        .optional(),
      tabId: S().optional(),
    }).strict(),
    O({ method: N(`getState`), tabId: S().optional() }).strict(),
    O({
      method: N(`hover`),
      ref: S().min(1).optional(),
      x: w().optional(),
      y: w().optional(),
      modifiers: D(Hl).optional(),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`select`),
      ref: S().min(1),
      values: D(S()).min(1),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`check`),
      ref: S().min(1),
      checked: T().optional(),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`drag`),
      fromRef: S().min(1).optional(),
      toRef: S().min(1).optional(),
      from: Ul.optional(),
      to: Ul.optional(),
      modifiers: D(Hl).optional(),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`cuaDrag`),
      path: D(Ul).min(1),
      modifiers: D(Hl).optional(),
      tabId: S().optional(),
    }).strict(),
    O({ method: N(`elementInfo`), x: w(), y: w(), tabId: S().optional() }).strict(),
    O({ method: N(`evaluate`), expression: S().min(1), tabId: S().optional() }).strict(),
    O({ method: N(`getDialog`), tabId: S().optional() }).strict(),
    O({
      method: N(`handleDialog`),
      accept: T(),
      promptText: S().optional(),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`waitFor`),
      selector: S().min(1).optional(),
      text: S().min(1).optional(),
      textGone: S().min(1).optional(),
      timeoutMs: w().int().positive().optional(),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`playwrightWaitForTimeout`),
      timeoutMs: w().int().nonnegative(),
      tabId: S().optional(),
    }).strict(),
    O({ method: N(`playwright`), action: Ql, tabId: S().optional() }).strict(),
    O({ method: N(`capabilities`), tabId: S().optional() }).strict(),
    O({ method: N(`browserVisibilityGet`) }).strict(),
    O({ method: N(`browserVisibilitySet`), visible: T() }).strict(),
    Nl.extend({ method: N(`browserViewportSet`), tabId: S().optional() }).strict(),
    O({ method: N(`browserViewportReset`), tabId: S().optional() }).strict(),
    O({ method: N(`recordingStart`), options: Kl.optional(), tabId: S().optional() }).strict(),
    O({
      method: N(`recordingStatus`),
      recordingId: S().trim().min(1),
      outputPath: ql.optional(),
      tabId: S().optional(),
    }).strict(),
    O({
      method: N(`recordingCancel`),
      recordingId: S().trim().min(1),
      tabId: S().optional(),
    }).strict(),
    O({ method: N(`activateTab`), tabId: S().min(1) }).strict(),
    O({ method: N(`newTab`) }).strict(),
    O({ method: N(`listUserTabs`) }).strict(),
    O({ method: N(`claimTab`), tabId: S().min(1) }).strict(),
    O({
      method: N(`finalizeTabs`),
      keep: D(O({ tabId: S().min(1), status: M([`handoff`, `deliverable`]) }).strict()),
    }).strict(),
    O({ method: N(`markDeliverable`), tabId: S().min(1) }).strict(),
    O({ method: N(`markHandoff`), tabId: S().min(1) }).strict(),
    O({ method: N(`nameSession`), name: S().trim().min(1) }).strict(),
    O({ method: N(`finalize`), tabId: S().optional(), deliverable: T().optional() }).strict(),
    O({ method: N(`turnEnded`), turnId: S().min(1).optional() }).strict(),
    O({ method: N(`closeSession`) }).strict(),
    O({ method: N(`cancelRequest`), requestId: S().min(1) }).strict(),
    O({ method: N(`close`), tabId: S().optional() }).strict(),
    O({ method: N(`list`) }).strict(),
  ]),
  eu = M([`iab`, `extension`, `cdp`]),
  tu = O({ id: S().trim().min(1), description: S().trim().min(1) }).strict(),
  nu = O({
    id: S().trim().min(1),
    generation: w().int().nonnegative().default(0),
    type: eu,
    name: S().trim().min(1),
    capabilities: O({ browser: D(tu).optional(), tab: D(tu).optional() }).strict(),
    apiSupportOverrides: j(S(), T()).optional(),
    metadata: j(S(), S()).optional(),
  }).strict(),
  ru = M([`live`, `cached`]);
(O({
  requestId: S().trim().min(1),
  workspaceKey: S().trim().min(1),
  workspacePath: S().trim().min(1),
  workspaceIdentity: S().trim().min(1).optional(),
  remoteSessionId: S().trim().min(1).optional(),
  sessionId: S().trim().min(1),
  turnId: S().trim().min(1).optional(),
  clientMode: Rl,
  sessionContext: ru,
})
  .strict()
  .extend({ browserId: S().trim().min(1), browserGeneration: w().int().nonnegative() })
  .strict(),
  O({ browsers: D(nu) }).strict());
var iu = O({ x: w(), y: w(), width: w(), height: w() }).strict(),
  au = O({
    ref: S().min(1),
    tag: S(),
    role: S().optional(),
    name: S().optional(),
    text: S().optional(),
    value: S().optional(),
    disabled: T().optional(),
    checked: T().optional(),
    selector: S(),
    xpath: S(),
    rect: iu,
    inViewport: T(),
    parentRef: S().optional(),
    framePath: S().optional(),
    attributes: j(S(), S()).optional(),
  }).strict(),
  ou = O({
    tag: S(),
    depth: w().int().nonnegative(),
    inViewport: T(),
    ref: S().min(1).optional(),
    role: S().optional(),
    name: S().optional(),
    text: S().optional(),
    attributes: j(S(), S()).optional(),
  }).strict(),
  su = O({
    url: S(),
    title: S(),
    dom: D(ou).optional(),
    domTruncated: T().optional(),
    elements: D(au),
    truncated: T(),
  }).strict(),
  cu = O({
    tabId: S(),
    url: S(),
    title: S(),
    viewport: Ml,
    active: T().optional(),
    lifecycle: M([`active`, `deliverable`, `handoff`]).optional(),
  }).strict(),
  lu = O({
    id: S().min(1),
    lastOpened: S().optional(),
    tabGroup: S().optional(),
    title: S().optional(),
    url: S().optional(),
  }).strict(),
  uu = O({
    type: M([`alert`, `confirm`, `prompt`, `beforeunload`]),
    message: S(),
    defaultPrompt: S().optional(),
  }).strict(),
  du = O({
    browserUse: N(!0),
    backendType: eu,
    browserId: S().min(1),
    browserGeneration: w().int().nonnegative(),
    openTabIds: D(S()),
    tabId: S().optional(),
    currentUrl: S().optional(),
    lifecycle: M([`active`, `deliverable`, `handoff`, `closed`]).optional(),
  }).strict(),
  fu = O({
    path: S().min(1),
    mimeType: N(`video/webm`),
    width: w().int().positive(),
    height: w().int().positive(),
    fps: w().positive(),
    durationMs: w().nonnegative(),
    frameCount: w().int().nonnegative(),
  }).strict(),
  pu = O({
    id: S().min(1),
    status: M([`running`, `completed`, `failed`, `cancelled`]),
    phase: M([`preparing`, `capturing`, `finalizing`, `completed`, `failed`, `cancelled`]),
    progress: w().min(0).max(1),
    startedAt: w().nonnegative(),
    updatedAt: w().nonnegative(),
    artifact: fu.optional(),
    error: S().optional(),
  }).strict(),
  mu = O({
    ok: T(),
    state: Bl.optional(),
    snapshot: su.optional(),
    image: O({ base64: S(), mimeType: N(`image/png`) })
      .strict()
      .optional(),
    tabs: D(cu).optional(),
    userTabs: D(lu).optional(),
    tab: cu.optional(),
    value: E().optional(),
    element: au.optional(),
    dialog: uu.nullable().optional(),
    recording: pu.optional(),
    error: O({ code: zl, message: S(), sideEffect: M([`none`, `uncertain`]).optional() })
      .strict()
      .optional(),
    meta: du.optional(),
    elapsedMs: w().nonnegative(),
  }).strict(),
  hu = [`local-download-upload`, `remote-download`],
  gu = `local-download-upload`,
  _u = [`chat`, `plugin`, `mcp-status`],
  vu = {
    processWindow: `perf_process_window`,
    systemWindow: `perf_system_window`,
    toolExecResource: `perf_tool_exec_resource`,
  },
  yu = [`platform`, `app_version`, `arms_env`, `device_mid`];
([...yu], [...yu], [...yu], vu.processWindow, vu.systemWindow, vu.toolExecResource);
var bu = [`server-bundle`, `node-runtime`, `node-pty`, `glm`, `bfs`, `ripgrep`, `ugrep`],
  xu = [`server-bundle`, `node-runtime`, `node-pty`, `glm`, `bfs`, `ripgrep`, `ugrep`],
  Su = [`server-bundle`, `node-runtime`];
xu.filter((e) => !Su.includes(e));
var Cu = new Set(bu);
(new Set(xu), new Set(Su));
function wu(e) {
  return [...xu];
}
function Tu(e) {
  return Cu.has(e);
}
var Eu = M([`claude`, `opencode`, `gemini`, `codex`, `glm`]),
  I = O({
    providerId: S().trim().min(1),
    modelId: S().trim().min(1),
    options: O({ reasoningLevel: S().trim().min(1).optional() })
      .strict()
      .optional(),
  }).strict();
function Du(e) {
  if (!e) return ``;
  let t = `${e.providerId}/${e.modelId}`,
    n = e.options?.reasoningLevel;
  return n ? `${t}\$${n}` : t;
}
function Ou(e) {
  let t = e.trim(),
    n = t.indexOf(`/`);
  if (n <= 0) throw Error(`模型选择缺少 Provider: ${t}`);
  let r = t.slice(0, n),
    i = t.slice(n + 1),
    a = i.indexOf(`$`);
  return a <= 0 || a >= i.length - 1
    ? I.parse({ providerId: r, modelId: i })
    : I.parse({
        providerId: r,
        modelId: i.slice(0, a),
        options: { reasoningLevel: i.slice(a + 1) },
      });
}
var ku = S().trim().min(1),
  Au = A(`kind`, [
    O({ kind: N(`start-plan`) }).strict(),
    O({ kind: N(`individual-coding-plan`) }).strict(),
    O({ kind: N(`team-coding-plan`), productId: ku, organizationId: ku, projectId: ku }).strict(),
  ]),
  ju = O({ zai: Au.optional(), bigmodel: Au.optional() }).partial(),
  Mu = S().trim().min(1),
  Nu = M([
    `environment-online`,
    `personal-config`,
    `configured-default`,
    `account-settings`,
    `credential`,
  ]),
  Pu = M([`oauth-session`, `account-provider`]),
  Fu = O({
    providerConfigRules: O({ providerRules: D(E()) }).strict(),
    modelConfigRules: O({ providerModelRules: D(E()), manualProviderModelRules: D(E()) }).strict(),
    providerOrder: D(Mu).optional(),
    defaultModelSelection: I.optional(),
  }).strict(),
  Iu = O({
    providerFamilyDomain: M([`zai`, `bigmodel`]).nullable(),
    providerFamilyConnectionSelections: ju,
  }).strict(),
  Lu = O({ scope: Pu, key: Mu, value: S() }).strict();
(O({
  schemaVersion: N(1),
  syncId: Mu,
  personalConfig: Fu,
  accountSettings: Iu,
  credentials: D(Lu).max(256),
}).strict(),
  O({
    syncId: Mu,
    status: M([`applied`, `already-applied`, `unsupported`, `failed`, `rollback_failed`]),
    personalProviderCount: w().int().nonnegative(),
    credentialCount: w().int().nonnegative(),
    configRevision: Mu.optional(),
    errorMessage: S().optional(),
    rolledBack: T(),
  }).strict());
var Ru = O({
  kind: N(`bash_output`),
  output: S().max(15e4),
  truncated: T(),
  outputPath: S().min(1).max(32768).optional(),
}).strict();
k([
  Gs({
    kind: N(`output`),
    workId: S().min(1),
    status: M([`running`, `completed`, `failed`, `timed_out`, `cancelled`, `spawn_error`]),
    output: S().max(8192),
    truncated: T(),
    outputPath: S().min(1),
  }),
  Gs({
    kind: M([`unavailable`, `unsupported`, `read_failed`]),
    workId: S().min(1),
    code: S().optional(),
  }),
]);
var zu = 4096,
  Bu = O({
    text: S().max(zu),
    fullText: S().max(zu),
    totalLines: w().int().nonnegative(),
    totalBytes: w().int().nonnegative(),
    linesEstimated: T(),
  }).strict(),
  Vu = k([
    O({
      contextId: S().trim().min(1),
      title: S().trim().min(1),
      shareUrl: S()
        .url()
        .refine((e) => {
          try {
            let t = new URL(e);
            return (
              (t.protocol === `https:` || t.protocol === `http:`) &&
              t.search === `` &&
              t.hash === `` &&
              /^\/cn\/share\/[^/]+$/u.test(t.pathname)
            );
          } catch {
            return !1;
          }
        }, `shareUrl must use the canonical /cn/share/<code> path`),
      status: M([`pending`, `reserved`, `attached`, `discarded`]),
    }).strict(),
    O({ title: S().trim().min(1) }).strict(),
  ]),
  Hu = 30 * 1024 * 1024,
  Uu = `MEDIA_BUDGET_CURRENT_IMAGE_TOO_LARGE`,
  Wu = `MEDIA_BUDGET_CURRENT_VIDEO_TOO_LARGE`,
  Gu = `MEDIA_BUDGET_CURRENT_ATTACHMENT_TOO_LARGE`,
  Ku = O({ rowId: w().int().nonnegative(), entityId: S().trim().min(1) }).strict(),
  L = w(),
  qu = M([`text`, `inputText`, `output.text`, `summaryText`]),
  Ju = {
    maxFrameBytes: 1024 * 1024,
    logicalFrameAssemblyMaxBytes: 16 * 1024 * 1024,
    logicalFrameAssemblyMaxFragments: 1024,
    logicalFrameAssemblyMaxConcurrent: 32,
    logicalFrameAssemblyMaxStagedBytes: 32 * 1024 * 1024,
    logicalFrameAssemblyTimeoutMs: 3e4,
    transportEnvelopeIdMaxChars: 256,
    subscriberBufferMaxOps: 500,
    subscriberBufferMaxBytes: 1024 * 1024,
    eventRetentionPerSession: 2e3,
    snapshotTailWindowRows: 60,
    rowsRangeMaxLimit: 200,
    toolOutputFinalHeadBytes: 32 * 1024,
    toolOutputFinalTailBytes: 32 * 1024,
    goalVerificationsRetained: 20,
    pendingCommandsDisplayMax: 32,
    commandPendingTtlMs: 1440 * 60 * 1e3,
    idempotencyTablePerSession: 512,
    conversationQueryTimeoutMs: 1e4,
    attachmentMaxBytes: 20 * 1024 * 1024,
    attachmentChunkMaxBytes: 512 * 1024,
    attachmentPreviewMaxBytes: Hu,
    attachmentStatMaxBytes: 2 * 1024 * 1024 * 1024,
    attachmentPreviewMaxChunks: Hu / (512 * 1024),
    attachmentReadCacheMaxBytes: Hu,
    attachmentReadCacheTtlMs: 3e4,
    attachmentUploadMaxChunks: 64,
    attachmentUploadMaxConcurrent: 16,
    attachmentUploadMaxStagedBytes: 64 * 1024 * 1024,
    attachmentUploadTtlMs: 5 * 6e4,
    attachmentUnreferencedTtlMs: 1440 * 60 * 1e3,
  },
  Yu = O({ ref: S(), fileName: S(), mime: S(), bytes: w(), previewRef: S().optional() }).strict(),
  Xu = M([`build`, `edit`, `plan`, `yolo`]),
  Zu = O({ kind: N(`shared_context_import`), context_id: S().trim().min(1) }).strict(),
  Qu = O({
    requested: M([`auto`, `startNow`, `queue`, `guide`]),
    admitted: M([`startNow`, `queue`, `guide`]),
    fallbackReasonCode: S().optional(),
  }).strict(),
  $u = O({
    admissionSeq: w().int().nonnegative(),
    queuePosition: w().int().nonnegative().optional(),
  }).strict(),
  ed = O({
    state: M([`notRequested`, `submitting`, `steering`, `guided`, `fellBack`]),
    reasonCode: S().optional(),
  }).strict(),
  td = O({
    state: M([`admitted`, `queued`, `reserved`, `promoting`, `drained`]),
    reservationId: S().optional(),
  }).strict(),
  nd = O({
    sourceCommandId: S().min(1),
    queueItemId: S().min(1),
    clientId: S().min(1),
    kind: M([`sendText`, `sendGoalCommand`, `compact`]),
    text: S(),
    attachments: D(Yu).default([]),
    modelSelection: I.optional(),
    mode: Xu.optional(),
    planEnabled: T().optional(),
    sharedContextRefs: D(Zu).max(1).optional(),
    delivery: Qu,
    order: $u,
    steer: ed,
    dispatch: td,
    admittedAt: L,
    provenance: O({
      sourceCommandId: S().min(1),
      queueItemId: S().min(1).optional(),
      clientId: S().min(1).optional(),
    })
      .strict()
      .optional(),
  }).strict(),
  R = S().trim().min(1),
  rd = j(S(), E()),
  z = w().int().nonnegative(),
  id = M([`desktop-continuous`, `web-remote-replayable`]),
  ad = M([`user-visible`, `model-only`]),
  od = M([
    `background_task`,
    `fork`,
    `goal_state_change`,
    `goal-continuation`,
    `plugin_reference`,
    `rewind`,
    `selection_side_chat`,
    `subagent`,
    `subagent_message`,
    `todo_reminder`,
    `workflow_launch`,
    `shared_context`,
  ]),
  B = O({
    workspacePath: R,
    workspaceIdentity: R.optional(),
    remoteSessionId: R.optional(),
    workspaceKey: R,
  }).strict(),
  sd = M([`allow`, `deny`, `escalate`, `modify`]),
  cd = M([`allow`, `deny`, `ask`]),
  ld = `zcode:permission-capability:official_cua`,
  ud = `workflowRefine`,
  dd = O({ toolName: R, ruleContent: S().optional() }).strict(),
  fd = O({ type: N(`addRules`), behavior: cd, rules: D(dd).min(1) }).strict(),
  pd = O({
    decision: sd,
    reason: S().optional(),
    modifiedInput: E().optional(),
    permissionUpdates: D(fd).optional(),
  }).strict(),
  md = M([`plan`, `build`, `edit`, `yolo`, `auto`]),
  hd = M([`idle`, `running`, `waiting`, `paused`, `completed`, `error`]),
  gd = M([
    `interactive`,
    `fork`,
    `selection_side_chat`,
    `workflow_parent`,
    `workflow_child`,
    `subagent_child`,
    `nested_workflow_child`,
  ]),
  _d = O({
    sessionId: R,
    targetId: R,
    objective: R,
    summaryTitle: S().min(1).nullable().default(null),
    status: M([`active`, `paused`, `budget_limited`, `complete`]),
    tokenBudget: w().int().positive().nullable(),
    tokensUsed: w().int().nonnegative(),
    timeUsedSeconds: w().int().nonnegative(),
    activeInputId: R.nullable().optional(),
    activeRunStartedAtMs: z.nullable().optional(),
    activeRunLastSeenAtMs: z.nullable().optional(),
    createdAt: z,
    updatedAt: z,
  }).strict(),
  vd = O({ nextAction: S().nullable().optional(), passed: T(), reason: S() }).strict(),
  yd = O({
    version: N(1),
    kind: N(`synthetic`),
    type: N(`goal_verification`),
    display: N(`separator`),
    targetId: R,
    verificationId: R,
    status: M([`started`, `completed`, `failed_closed`, `cancelled`]),
    verification: vd.optional(),
    goalIteration: w().int().positive().optional(),
    anchorAssistantMessageId: R.optional(),
    anchorTurnId: R.optional(),
    startedAt: z.optional(),
    updatedAt: z,
  }).strict(),
  bd = O({
    sessionId: R,
    workspace: B,
    parentSessionId: R.optional(),
    traceId: R.optional(),
    sessionKind: gd,
    title: S(),
    titleSource: M([`default`, `first_input`, `generated`, `custom`]).optional(),
    mode: md,
    status: hd,
    model: I.optional(),
    target: _d.nullable().optional(),
    createdAt: z,
    updatedAt: z,
    archivedAt: z.optional(),
  }).strict(),
  xd = O({
    kind: N(`subagent`),
    agentId: R,
    agentType: R,
    childSessionId: R,
    childTurnId: R.optional(),
    description: S().optional(),
    parentSessionId: R,
    parentToolCallId: R.optional(),
    parentTurnId: R.optional(),
  }).strict(),
  Sd = O({ created: z, completed: z.optional() }).strict(),
  Cd = O({
    total: w().int().nonnegative().optional(),
    input: w().int().nonnegative(),
    output: w().int().nonnegative(),
    reasoning: w().int().nonnegative(),
    cache: O({ read: w().int().nonnegative(), write: w().int().nonnegative() }).strict(),
  }).strict(),
  wd = O({
    origin: M([`real_user`, `agent_runtime`, `system`, `migration`, `import`]),
    kind: M([
      `user_prompt`,
      `slash_command`,
      `system_reminder`,
      `background_notification`,
      `subagent_notification`,
      `todo_reminder`,
      `rewind_notice`,
      `fork_notice`,
      `timeline_event`,
      `compact_summary`,
      `shared_context`,
      `assistant_response`,
    ]),
    source: S().optional(),
    commandName: S().optional(),
    uiVisibility: M([`visible`, `hidden`, `debug`]),
    providerVisibility: M([`visible`, `hidden`]),
    transcriptVisibility: M([`visible`, `hidden`]),
  }).strict(),
  Td = A(`role`, [
    O({
      messageId: R,
      sessionId: R,
      role: N(`user`),
      time: Sd,
      agent: R,
      model: I.optional(),
      system: S().optional(),
      tools: j(S(), T()).optional(),
      synthetic: T().optional(),
      source: od.optional(),
      visibility: ad.optional(),
      semantics: wd.optional(),
      metadata: rd.optional(),
    }).strict(),
    O({
      messageId: R,
      sessionId: R,
      role: N(`assistant`),
      time: Sd,
      parentMessageId: R,
      agent: R,
      model: I.optional(),
      path: O({ cwd: R, root: R }).strict(),
      cost: w().nonnegative(),
      tokens: Cd,
      finish: S().optional(),
      error: rd.optional(),
      semantics: wd.optional(),
      structured: E().optional(),
    }).strict(),
  ]),
  Ed = O({ partId: R, sessionId: R, messageId: R }),
  Dd = A(`status`, [
    O({ status: N(`pending`), input: rd, raw: S() }).strict(),
    O({
      status: N(`running`),
      input: rd,
      title: S().optional(),
      metadata: rd.optional(),
      startedAt: z,
    }).strict(),
    O({
      status: N(`completed`),
      input: rd,
      output: S(),
      title: S(),
      metadata: rd,
      startedAt: z,
      completedAt: z,
    }).strict(),
    O({
      status: N(`error`),
      input: rd,
      error: S(),
      metadata: rd.optional(),
      startedAt: z,
      completedAt: z,
    }).strict(),
  ]),
  Od = I.extend({ label: S().optional() }),
  kd = O({ start: z.optional(), end: z.optional() }).strict(),
  Ad = Ed.extend({
    type: N(`timeline`),
    timelineType: M([`context_compaction`, `goal_verification`, `session_fork`, `model_change`]),
    display: M([`separator`, `worklog`]),
    status: S().optional(),
    anchorMessageId: R.optional(),
    anchorTurnId: R.optional(),
    time: kd.optional(),
    operationId: S().optional(),
    trigger: M([`manual`, `auto`, `partial`, `reactive`, `session_memory`]).optional(),
    phase: M([`standalone_turn`, `pre_request`, `mid_turn`, `reactive`]).optional(),
    compactReason: S().optional(),
    boundaryId: S().optional(),
    summaryMessageId: R.optional(),
    preCompactTokenCount: w().int().nonnegative().optional(),
    postCompactTokenCount: w().int().nonnegative().optional(),
    truePostCompactTokenCount: w().int().nonnegative().optional(),
    attempt: w().int().nonnegative().optional(),
    maxAttempts: w().int().nonnegative().optional(),
    reason: S().optional(),
    targetId: S().optional(),
    verificationId: S().optional(),
    goalIteration: w().int().nonnegative().optional(),
    verification: O({ passed: T(), reason: S(), nextAction: S().nullable().optional() })
      .strict()
      .optional(),
    parentSessionId: R.optional(),
    targetMessageId: R.optional(),
    targetCheckpointId: S().optional(),
    restoredFileCount: w().int().nonnegative().optional(),
    fromModel: Od.optional(),
    toModel: Od.extend({ label: R }).optional(),
  }).strict(),
  jd = A(`type`, [
    Ed.extend({
      type: N(`text`),
      text: S(),
      synthetic: T().optional(),
      ignored: T().optional(),
      metadata: rd.optional(),
    }).strict(),
    Ed.extend({ type: N(`reasoning`), text: S(), metadata: rd.optional() }).strict(),
    Ed.extend({
      type: N(`file`),
      mime: R,
      filename: S().optional(),
      url: R,
      metadata: rd.optional(),
    }).strict(),
    Ed.extend({ type: N(`tool`), callId: R, tool: R, state: Dd, metadata: rd.optional() }).strict(),
    Ed.extend({ type: N(`step-start`), snapshot: S().optional() }).strict(),
    Ed.extend({
      type: N(`step-finish`),
      reason: S(),
      snapshot: S().optional(),
      cost: w().nonnegative(),
      tokens: Cd,
    }).strict(),
    Ed.extend({ type: N(`snapshot`), snapshot: S() }).strict(),
    Ed.extend({ type: N(`patch`), hash: R, files: D(S()) }).strict(),
    Ed.extend({
      type: N(`compaction`),
      auto: T(),
      reason: S().optional(),
      summaryMessageId: R.optional(),
      metadata: rd.optional(),
    }).strict(),
    Ad,
    Ed.extend({
      type: N(`subagent`),
      prompt: S(),
      description: S(),
      agent: R,
      model: I.optional(),
      command: S().optional(),
    }).strict(),
    Ed.extend({ type: N(`agent`), name: R }).strict(),
    Ed.extend({ type: N(`retry`), attempt: w().int().nonnegative(), error: rd }).strict(),
  ]),
  Md = O({ info: Td, parts: D(jd) }).strict(),
  Nd = O({
    kind: N(`api_retry`),
    attempt: w().int().positive(),
    maxRetries: w().int().nonnegative(),
    retryDelayMs: w().int().nonnegative(),
    errorStatus: w().int().nonnegative().nullable(),
    error: S(),
  }).strict(),
  Pd = O({
    inputTokens: w().int().nonnegative(),
    cacheReadTokens: w().int().nonnegative(),
    cacheWriteTokens: w().int().nonnegative(),
    latestHitRate: w().nonnegative().nullable().optional(),
    hitRateRequestCount: w().int().nonnegative().optional(),
    totalInputTokens: w().int().nonnegative().optional(),
    totalCacheReadTokens: w().int().nonnegative().optional(),
    totalCacheWriteTokens: w().int().nonnegative().optional(),
    hitRate: w().nonnegative().nullable(),
  }).strict(),
  Fd = D(
    O({
      source: M([
        `system_prompt`,
        `meta_user_context`,
        `skills`,
        `tool_prompt`,
        `system_tool_schemas`,
        `mcp_tool_schemas`,
        `messages`,
      ]),
      chars: w().int().nonnegative(),
    }).strict(),
  ),
  Id = O({
    used: w().int().nonnegative(),
    size: w().int().positive(),
    cost: O({ amount: w().nonnegative(), currency: R }).strict().nullable().optional(),
    cache: Pd.optional(),
    breakdown: Fd.optional(),
  }).strict(),
  Ld = O({
    eventSeq: w().int().nonnegative(),
    stateRevision: w().int().nonnegative(),
    deliveryKind: id.optional(),
    activeTurnId: R.optional(),
    activeTurnKind: M([`regular`, `compact`, `rewind`]).optional(),
    pendingRequestIds: D(R),
    apiRetry: Nd.nullable().optional(),
    contextUsage: Id.optional(),
    goalVerifications: D(vd).optional(),
    goalVerificationTimeline: D(yd).optional(),
  }).strict();
function Rd(e) {
  return e
    .filter((e) => e.type === `text`)
    .map((e) => e.text)
    .join(``);
}
var zd = O({ head: S().min(1).max(128).optional(), tail: S().min(1).max(128).optional() }).strict(),
  Bd = O({ from: S().min(1).max(64), to: S().min(1).max(64), back: N(!0).optional() }).strict(),
  Vd = O({
    steps: D(
      O({
        id: S().min(1).max(64),
        kind: M([`ask`, `world-read`]),
        label: S().min(1).max(128),
        labelPattern: zd.optional(),
        line: w().int().positive().optional(),
        column: w().int().positive().optional(),
        lane: S().min(1).max(64),
        lanes: D(S().min(1).max(64)).max(32).optional(),
        source: S().min(1).max(64).optional(),
        phase: S().min(1).max(64).optional(),
        repeat: M([`stack`, `serial`]).optional(),
      }).strict(),
    ).max(64),
    lanes: D(
      O({
        id: S().min(1).max(64),
        name: S().min(1).max(128).optional(),
        namePattern: zd.optional(),
        line: w().int().positive().optional(),
        column: w().int().positive().optional(),
      }).strict(),
    ).max(32),
    participants: D(
      O({
        id: S().min(1).max(64),
        phase: S().min(1).max(64),
        lane: S().min(1).max(64),
        steps: D(S().min(1).max(64)).min(1).max(64),
        member: O({ index: w().int().nonnegative(), of: w().int().positive() }).strict().optional(),
        many: N(!0).optional(),
      }).strict(),
    ).max(64),
    handoffs: D(Bd.extend({ types: D(S().min(1).max(128)).min(1).max(8).optional() }).strict()).max(
      256,
    ),
    phases: D(
      O({
        id: S().min(1).max(64),
        name: S().min(1).max(128).optional(),
        line: w().int().positive().optional(),
        column: w().int().positive().optional(),
        alongside: D(S().min(1).max(64)).min(1).max(32).optional(),
      }).strict(),
    )
      .max(32)
      .optional(),
    phaseEdges: D(Bd).max(128).optional(),
    exits: D(S().min(1).max(64)).max(32).optional(),
    sink: D(S().min(1).max(64)).max(64).optional(),
    truncated: T().optional(),
  }).strict(),
  Hd = O({
    kind: N(`create_workflow`),
    ok: T(),
    errorCount: w().int().nonnegative(),
    diagnostics: D(
      O({
        line: w().int().nonnegative(),
        column: w().int().nonnegative(),
        code: w().int().nonnegative(),
        message: S().min(1).max(2048),
      }).strict(),
    ).max(100),
    causalityGraph: Vd.optional(),
    truncated: T().optional(),
  }).strict(),
  Ud = M([`file`, `markdown`, `chart`, `table`, `metrics`, `board`]),
  V = {
    maxIdLength: 64,
    maxTitleLength: 120,
    maxDescriptionLength: 500,
    maxVersions: 16,
    maxItemsPerPage: 500,
    defaultItemsPerPage: 200,
  },
  Wd = O({
    version: w().int().positive().max(V.maxVersions),
    title: S().min(1).max(V.maxTitleLength).optional(),
    description: S().min(1).max(V.maxDescriptionLength).optional(),
    contentType: S().min(1).max(128).optional(),
    bytes: w().int().nonnegative().optional(),
    uri: S().min(1).max(512).optional(),
    sourcePath: S().min(1).max(1024).optional(),
    spec: E().optional(),
    publishedAt: w().int().nonnegative(),
    primary: N(!0).optional(),
  }).strict(),
  Gd = O({
    id: S().min(1).max(V.maxIdLength),
    kind: Ud,
    title: S().min(1).max(V.maxTitleLength).optional(),
    description: S().min(1).max(V.maxDescriptionLength).optional(),
    contentType: S().min(1).max(128).optional(),
    sourcePath: S().min(1).max(1024).optional(),
    spec: E().optional(),
    version: w().int().positive().max(V.maxVersions),
    versions: D(Wd).max(V.maxVersions),
    itemCount: w().int().nonnegative(),
    primary: N(!0).optional(),
  }).strict(),
  Kd = O({
    id: S().min(1).max(V.maxIdLength),
    kind: Ud,
    title: S().min(1).max(V.maxTitleLength).optional(),
    version: w().int().positive().max(V.maxVersions),
    contentType: S().min(1).max(128).optional(),
    bytes: w().int().nonnegative().optional(),
    itemCount: w().int().nonnegative().optional(),
    primary: N(!0).optional(),
  }).strict();
(O({ sessionId: S().min(1), runId: S().min(1) }).strict(),
  O({ artifacts: D(Gd) }).strict(),
  O({
    sessionId: S().min(1),
    runId: S().min(1),
    artifactId: S().min(1).max(V.maxIdLength),
    afterSequence: w().int().nonnegative().optional(),
    limit: w().int().positive().max(V.maxItemsPerPage).optional(),
  }).strict(),
  O({
    items: D(
      O({
        sequence: w().int().nonnegative(),
        siteId: S().min(1).max(64),
        ordinal: w().int().nonnegative(),
        item: E(),
      }).strict(),
    ),
    hasMore: T(),
  }).strict(),
  O({
    sessionId: S().min(1),
    runId: S().min(1),
    artifactId: S().min(1).max(V.maxIdLength),
    version: w().int().positive().max(V.maxVersions),
    offset: w().int().nonnegative(),
    limit: w().int().positive().max(Ju.attachmentChunkMaxBytes),
  }).strict(),
  O({
    dataBase64: S(),
    mediaType: S().min(1).max(128),
    totalBytes: w().int().nonnegative().max(Ju.attachmentMaxBytes),
    nextOffset: w().int().positive().nullable(),
  })
    .strict()
    .superRefine((e, t) => {
      let n = qd(e.dataBase64);
      if (n === null) {
        t.addIssue({ code: `custom`, message: `invalid base64`, path: [`dataBase64`] });
        return;
      }
      (n > Ju.attachmentChunkMaxBytes &&
        t.addIssue({
          code: `too_big`,
          maximum: Ju.attachmentChunkMaxBytes,
          origin: `string`,
          inclusive: !0,
          message: `workflow artifact read chunk exceeds decoded byte limit`,
          path: [`dataBase64`],
        }),
        e.nextOffset !== null &&
          e.nextOffset > e.totalBytes &&
          t.addIssue({
            code: `custom`,
            message: `nextOffset exceeds totalBytes`,
            path: [`nextOffset`],
          }));
    }));
function qd(e) {
  if (e.length === 0) return 0;
  if (e.length % 4 != 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(e)) return null;
  let t = e.endsWith(`==`) ? 2 : +!!e.endsWith(`=`);
  return (e.length / 4) * 3 - t;
}
var H = {
    maxRuns: 8,
    maxActors: 1024,
    maxNodes: 1024,
    maxTotalEntries: 6144,
    maxReports: 64,
    maxReportPreviewLength: 2048,
    maxResultPreviewLength: 2048,
    maxErrorLength: 2048,
    maxPendingQuestions: 32,
    maxQuestionLength: 2048,
    maxConcurrencyKeyLength: 256,
    maxSubagentModelLength: 256,
    maxConcurrencyCeiling: 1024,
    maxActorNameLength: 128,
    maxArtifacts: 32,
    maxPhases: 32,
    maxPhaseNameLength: 128,
    maxInstructionsHeadLength: 240,
    maxLastToolNameLength: 64,
    maxLastToolTargetLength: 120,
  },
  Jd = O({ name: S().min(1).max(H.maxPhaseNameLength), rounds: w().int().positive() }),
  Yd = O({
    phaseName: S().min(1).max(H.maxPhaseNameLength).optional(),
    actors: w().int().nonnegative(),
    actorsSettled: w().int().nonnegative().optional(),
    actorsFailed: w().int().nonnegative().optional(),
    settled: w().int().nonnegative(),
  }),
  Xd = O({
    spentTokens: w().int().nonnegative(),
    nodesUsed: w().int().nonnegative(),
    nodesUnlisted: w().int().nonnegative().optional(),
    nodesUnlistedSettled: w().int().nonnegative().optional(),
  }),
  Zd = O({
    siteId: S().min(1).max(64),
    ordinal: w().int().nonnegative(),
    name: S().min(1).max(H.maxActorNameLength).optional(),
    sessionId: S().min(1).max(256).optional(),
    status: M([`waiting`, `running`, `completed`]),
    phaseName: S().min(1).max(H.maxPhaseNameLength).optional(),
  }),
  Qd = O({
    name: S().min(1).max(H.maxLastToolNameLength),
    target: S().min(1).max(H.maxLastToolTargetLength).optional(),
  }),
  $d = O({
    siteId: S().min(1).max(64),
    ordinal: w().int().nonnegative(),
    kind: M([`ask`, `world-read`]).optional(),
    phase: M([`queued`, `dispatched`, `executing`, `waiting`, `repairing`, `nudged`, `settled`]),
    outcome: M([`ok`, `failed`, `cancelled`]).optional(),
    cached: T().optional(),
    actorSiteId: S().min(1).max(64).optional(),
    actorOrdinal: w().int().nonnegative().optional(),
    phaseName: S().min(1).max(H.maxPhaseNameLength).optional(),
    instructionsHead: S().min(1).max(H.maxInstructionsHeadLength).optional(),
    turn: w().int().positive().optional(),
    toolCalls: w().int().nonnegative().optional(),
    lastTool: Qd.optional(),
  }),
  ef = O({
    key: S().min(1).max(H.maxConcurrencyKeyLength).optional(),
    cap: w().int().positive(),
    ceiling: w().int().positive(),
    limit: w().int().positive().optional(),
    cooldownMs: w().int().nonnegative().optional(),
  }),
  tf = O({
    siteId: S().min(1).max(64),
    ordinal: w().int().nonnegative(),
    preview: S().max(H.maxReportPreviewLength),
    artifactId: S().min(1).max(64).optional(),
  }),
  nf = O({
    qid: S().min(1).max(128),
    actorSiteId: S().min(1).max(64).optional(),
    actorOrdinal: w().int().nonnegative().optional(),
    actorName: S().min(1).max(H.maxActorNameLength).optional(),
    question: S().min(1).max(H.maxQuestionLength),
    context: S().min(1).max(H.maxQuestionLength).optional(),
    askedAt: w().int().nonnegative().optional(),
  }),
  rf = O({
    runId: S().min(1).max(128),
    toolCallId: S().min(1).max(128).optional(),
    status: M([`pending`, `running`, `completed`, `errored`, `stopped`]),
    stopReason: M([`user`, `model`, `provider`, `interrupted`, `superseded`]).optional(),
    resumedFrom: S().min(1).max(128).optional(),
    supersededBy: S().min(1).max(128).optional(),
    usage: Xd,
    error: S().min(1).max(H.maxErrorLength).optional(),
    resumable: N(!0).optional(),
    resultPreview: S().max(H.maxResultPreviewLength).optional(),
    actors: D(Zd).max(H.maxActors),
    nodes: D($d).max(H.maxNodes),
    reports: D(tf).max(H.maxReports).optional(),
    pendingQuestions: D(nf).max(H.maxPendingQuestions).optional(),
    concurrency: ef.optional(),
    concurrencyCeiling: w().int().positive().max(H.maxConcurrencyCeiling).optional(),
    subagentModel: S().min(1).max(H.maxSubagentModelLength).optional(),
    artifacts: D(Kd).max(H.maxArtifacts).optional(),
    phases: D(Jd).max(H.maxPhases).optional(),
    currentPhase: S().min(1).max(H.maxPhaseNameLength).optional(),
    phaseNames: D(S().min(1).max(H.maxPhaseNameLength)).max(H.maxPhases).optional(),
    phaseAlongside: D(D(w().int().nonnegative()).max(H.maxPhases)).max(H.maxPhases).optional(),
    unlistedByPhase: D(Yd)
      .max(H.maxPhases + 1)
      .optional(),
    truncated: T().optional(),
    lastEventSequence: w().int().nonnegative(),
  }),
  af = O({ revision: w().int().nonnegative(), runs: D(rf).max(H.maxRuns) }),
  of = A(`kind`, [
    O({
      kind: N(`terminal`),
      status: M([`completed`, `errored`, `stopped`]),
      stopReason: M([`user`, `model`, `provider`, `interrupted`, `superseded`]).optional(),
      summary: S().min(1).max(500),
      result: S().max(4e3).optional(),
      resultForm: M([`prose`, `json`]).optional(),
      resultTruncated: N(!0).optional(),
      error: S().max(2e3).optional(),
      reports: O({
        count: w().int().nonnegative(),
        shown: w().int().nonnegative(),
        preview: D(S().max(500)).max(8),
      }).optional(),
      artifacts: D(
        O({
          id: S().min(1).max(64),
          kind: M([`file`, `markdown`, `chart`, `table`, `metrics`, `board`]),
          title: S().max(120).optional(),
          version: w().int().positive(),
          contentType: S().max(255).optional(),
          primary: N(!0).optional(),
          description: S().max(500).optional(),
        }),
      )
        .max(8)
        .optional(),
      artifactsTruncated: N(!0).optional(),
      durationMs: w().nonnegative().optional(),
    }),
    O({
      kind: N(`escalation`),
      qid: S().min(1),
      actor: S().min(1),
      question: S().min(1).max(4e3),
      context: S().max(4e3).optional(),
      askedAt: w().optional(),
    }),
    O({
      kind: N(`stall`),
      sinceMs: w().int().nonnegative(),
      reason: S().max(64).optional(),
      cap: w().int().nonnegative().optional(),
    }),
  ]),
  sf = O({
    backgroundSource: M([`bash`, `subagent`, `workflow`]),
    workId: S().min(1),
    title: S().min(1),
    workflowNotification: of.optional(),
  }),
  cf = S().min(1).max(H.maxSubagentModelLength),
  lf = O({
    predecessorRunId: S().min(1).max(128).optional(),
    subagentModel: O({ from: cf.optional(), to: cf.optional() }).optional(),
    maxConcurrency: O({
      from: w().int().positive().optional(),
      to: w().int().positive().optional(),
    }).optional(),
    ceiling: w().int().positive().optional(),
  }),
  uf = O({
    runId: S().min(1).max(128),
    toolCallId: S().min(1).max(128),
    name: S().min(1).max(200).optional(),
    scope: M([`project`, `global`]).optional(),
    path: S().min(1).max(1024).optional(),
    args: j(S(), E())
      .refine((e) => JSON.stringify(e).length <= 4096, {
        message: `workflowLaunch.args JSON must be ≤ 4096 bytes`,
      })
      .optional(),
    description: S().max(500).optional(),
    display: Hd.optional().catch(void 0),
    script: S().max(256e3).optional(),
    amend: lf.optional(),
  }),
  df = [`quota_exceeded`, `coding_plan_required`];
new Set(df);
var ff = O({
  schemaVersion: N(1),
  platform: N(`darwin`),
  grantOwner: S().min(1),
  accessibility: M([`granted`, `stale`, `denied`]),
  screenRecording: M([`granted`, `denied`, `unknown`]),
}).strict();
function pf(e) {
  let t = [];
  return (
    (e.accessibility === `denied` || e.accessibility === `stale`) && t.push(`accessibility`),
    e.screenRecording === `denied` && t.push(`screen_recording`),
    t
  );
}
O({
  schemaVersion: N(1),
  eventId: S().min(1),
  eventSeq: w().int().nonnegative(),
  occurredAt: L,
  sessionId: S().min(1),
  turnId: S().min(1).optional(),
  toolCallId: S().min(1),
  permissionStatus: ff,
}).strict();
var mf = [`user`, `model`, `provider`, `interrupted`, `superseded`],
  hf = [`pending`, `running`, `completed`, `errored`, `stopped`],
  gf = O({
    spentTokens: w(),
    nodesObserved: w(),
    nodesRunning: w(),
    nodesCompleted: w(),
    nodesFailed: w(),
  }).strict(),
  _f = O({ siteId: S(), ordinal: w(), name: S().optional() }).strict(),
  vf = O({
    name: S().min(1).max(128),
    state: M([`done`, `current`, `ahead`, `unfinished`]),
    rounds: w().int().nonnegative(),
    nodesSettled: w().int().nonnegative(),
    nodesRunning: w().int().nonnegative(),
    enteredAt: w().optional(),
    exitedAt: w().optional(),
  }).strict(),
  yf = O({
    name: S().min(1).max(64),
    target: S().max(120).optional(),
    at: w().optional(),
  }).strict(),
  bf = O({
    siteId: S().min(1),
    ordinal: w().int().nonnegative(),
    name: S().max(128).optional(),
    state: M([`idle`, `executing`, `waiting`, `parked`, `done`, `failed`, `unfinished`]),
    phaseName: S().max(128).optional(),
    instructionsHead: S().max(240).optional(),
    startedAt: w().optional(),
    turn: w().int().nonnegative().optional(),
    toolCalls: w().int().nonnegative().optional(),
    lastTool: yf.optional(),
    waitCause: M([`slot`, `backoff`]).optional(),
    retryAfterMs: w().nonnegative().optional(),
    waitSince: w().optional(),
    parkedOn: S().optional(),
    stepsSettled: w().int().nonnegative(),
    stepsFailed: w().int().nonnegative(),
    tokens: w().int().nonnegative(),
    lastProgressAt: w().optional(),
  }).strict(),
  xf = O({
    lastProgressAt: w().optional(),
    stalledSince: w().optional(),
    concurrency: O({
      effective: w().int().nonnegative(),
      cap: w().int().positive(),
      reason: S().max(240).optional(),
      since: w().optional(),
    })
      .strict()
      .optional(),
    consecutiveFailures: w().int().nonnegative(),
    cachedSteps: w().int().nonnegative(),
    leftoverRunning: w().int().positive().optional(),
    pendingQuestionsKnown: T(),
  }).strict(),
  Sf = O({
    line: w().int().nonnegative(),
    column: w().int().nonnegative(),
    code: w().int().nonnegative(),
    message: S().min(1).max(2048),
  }).strict(),
  Cf = O({
    runId: S().min(1),
    label: S(),
    labelSource: M([`name`, `script`]),
    status: M(hf),
    stopReason: M(mf).optional(),
    ownedByThisSession: T(),
    possiblyInterrupted: T().optional(),
    createdAt: w(),
    updatedAt: w(),
    spentTokens: w(),
  }).strict(),
  wf = O({
    kind: N(`get_workflow_run`),
    runId: S().min(1),
    label: S(),
    status: M(hf),
    stopReason: M(mf).optional(),
    possiblyInterrupted: T().optional(),
    summary: S().max(400).optional(),
    generatedAt: w().optional(),
    usage: gf,
    phases: D(vf).max(32).optional(),
    subagents: D(bf).max(64).optional(),
    health: xf.optional(),
    actors: D(_f).max(32),
    logTail: D(O({ sequence: w(), message: S().max(1024), at: w().optional() }).strict()).max(40),
    result: S().max(4e3).optional(),
    error: O({ code: S(), message: S() }).strict().optional(),
    truncated: T().optional(),
  }).strict(),
  Tf = O({
    kind: N(`list_workflow_runs`),
    runs: D(Cf).max(50),
    truncated: T().optional(),
  }).strict(),
  Ef = O({
    kind: N(`eval_workflow_snippet`),
    ok: T(),
    diagnostics: D(Sf).max(100),
    logs: D(S().max(1024)).max(40),
    response: S().max(4e3),
    durationMs: w().int().nonnegative(),
    truncated: T().optional(),
  }).strict(),
  Df = O({
    kind: N(`saved_workflow_list`),
    workflows: D(
      O({
        name: S().min(1),
        description: S().max(2048).optional(),
        whenToUse: S().max(2048).optional(),
        scope: S(),
        path: S().min(1),
        argNames: D(S()).max(32),
      }).strict(),
    ).max(50),
    invalid: D(O({ path: S().min(1), reason: S().max(1024).optional() }).strict()).optional(),
    truncated: T().optional(),
  }).strict(),
  Of = O({
    kind: N(`list_models`),
    current: S().optional(),
    models: D(
      O({
        id: S().min(1),
        providerId: S().min(1),
        modelId: S().min(1),
        providerLabel: S().max(2048).optional(),
        reasoningLevels: D(S()),
        defaultReasoningLevel: S().optional(),
        contextWindow: w().optional(),
        disabledReason: S().max(2048).optional(),
      }).strict(),
    ).max(100),
    truncated: T().optional(),
  }).strict(),
  kf = O({ kind: N(`resume_workflow_run`), runId: S().min(1) }).strict(),
  Af = A(`kind`, [
    Ru,
    O({
      kind: N(`file_diff`),
      filePath: S().min(1),
      additions: w().int().nonnegative(),
      deletions: w().int().nonnegative(),
      structuredPatch: D(
        O({
          oldStart: w().int(),
          oldLines: w().int(),
          newStart: w().int(),
          newLines: w().int(),
          lines: D(S()),
        }),
      ),
      truncated: T().optional(),
    }),
    O({
      kind: N(`local_agent_message`),
      status: M([`success`, `failed`]),
      error: S().optional(),
      message: S().optional(),
    }),
    O({
      kind: N(`task_stop`),
      taskId: S().min(1),
      taskType: S().min(1),
      command: S().min(1).optional(),
      message: S().min(1),
      truncated: T().optional(),
    }),
    O({
      kind: N(`task_output`),
      retrievalStatus: M([`success`, `not_ready`, `timeout`]),
      taskStatus: S().min(1).max(64).optional(),
      output: S().min(1).max(2e3).optional(),
      truncated: N(!0).optional(),
    }),
    O({ kind: N(`respond_to_coordinator`), status: M([`success`, `failed`]) }),
    O({
      kind: N(`cua`),
      schemaVersion: N(1),
      toolName: S().min(1),
      status: M([`success`, `failed`]),
      input: S().optional(),
      structuredContent: S().optional(),
      text: S().optional(),
      errorCode: S().optional(),
      suggestedAction: S().optional(),
      permissionStatus: ff.optional(),
      targetApp: O({
        schemaVersion: N(1),
        displayName: S().trim().min(1).max(512).optional(),
        iconLocators: D(
          A(`kind`, [
            O({ kind: N(`darwin-bundle-id`), value: S().trim().min(1).max(512) }).strict(),
            O({ kind: N(`windows-executable-path`), value: S().trim().min(1).max(32768) }).strict(),
            O({ kind: N(`windows-aumid`), value: S().trim().min(1).max(512) }).strict(),
          ]),
        ).max(3),
      })
        .strict()
        .optional(),
      media: D(
        O({
          mimeType: S().min(1),
          data: S().min(1).max(349528).optional(),
          artifactUri: S().min(1).optional(),
        }),
      )
        .max(4)
        .optional(),
      truncated: T().optional(),
    }),
    O({
      kind: N(`mcp_tool`),
      serverName: S().min(1).max(256),
      toolName: S().min(1).max(256),
      description: S()
        .min(1)
        .max(4 * 1024)
        .optional(),
      unavailable: O({ code: M(df) })
        .strict()
        .optional(),
    }),
    Hd,
    wf,
    Tf,
    Ef,
    Df,
    Of,
    kf,
  ]),
  jf = O({
    text: S(),
    display: Af.optional().catch(void 0),
    truncated: O({ totalBytes: w(), ref: S() }).optional(),
  }),
  Mf = O({ bytes: w(), previewLine: S().optional(), updatedAt: L }),
  Nf = O({
    appKey: S().trim().min(1).max(2048),
    displayName: S().trim().min(1).max(512).optional(),
  }).strict(),
  Pf = A(`kind`, [
    O({
      kind: N(`node_repl_images`),
      images: D(
        O({
          base64: S()
            .min(1)
            .max(200 * 1024),
          mimeType: S().regex(/^image\/[a-z0-9.+-]+$/iu),
        }).strict(),
      )
        .min(1)
        .max(2)
        .optional(),
      app: Nf.optional(),
      truncated: T().optional(),
      source: N(`browser_turn_end`).optional(),
    }).strict(),
    O({
      kind: N(`task_output`),
      retrievalStatus: M([`success`, `not_ready`, `timeout`]),
      taskStatus: S().min(1).max(64).optional(),
      output: S().min(1).max(2e3).optional(),
      truncated: N(!0).optional(),
    }).strict(),
    O({ kind: N(`respond_to_coordinator`), status: M([`success`, `failed`]) }).strict(),
    O({
      kind: N(`mcp_tool`),
      serverName: S().min(1).max(256),
      toolName: S().min(1).max(256),
      description: S()
        .min(1)
        .max(4 * 1024)
        .optional(),
      unavailable: O({ code: M(df) })
        .strict()
        .optional(),
    }).strict(),
    Hd,
    wf,
    Tf,
    Ef,
    Df,
    Of,
    kf,
  ]),
  Ff = {
    rowId: w(),
    turnId: S(),
    entityId: S().min(1).optional(),
    productTurnId: S().min(1).optional(),
    visibility: N(`visible`).optional(),
    createdAt: L,
    createdAtSeq: w(),
    actions: O({
      canFork: N(!0).optional(),
      canEdit: N(!0).optional(),
      canRetry: N(!0).optional(),
      canRewindFiles: N(!0).optional(),
      editDisposition: M([`rewind`, `fork`]).optional(),
    }).optional(),
  };
Ff.actions;
var If = O({
    segmentId: S().min(1),
    triggerEntityId: S().min(1).optional(),
    startedAt: L,
    endedAt: L.optional(),
    activeMs: w().nonnegative().optional(),
  }),
  Lf = O({
    ...Ff,
    kind: N(`turnHeader`),
    origin: M([`userInput`, `backgroundResult`, `goalContinuation`, `editRerun`, `workflowLaunch`]),
    executionKind: M([`agent`, `controlOnly`]).optional(),
    sourceCommandId: S().optional(),
    historyRoundCount: w().int().nonnegative().optional(),
    state: M([`running`, `completedSuccess`, `completedInterrupted`, `failed`]),
    startedAt: L,
    endedAt: L.optional(),
    activeMs: w().optional(),
    workSegments: D(If).optional(),
    originMeta: sf.optional(),
    workflowLaunch: uf.optional(),
    fileChanges: O({
      additions: w(),
      deletions: w(),
      files: w(),
      state: M([`active`, `reverted`]).optional(),
    }).optional(),
  }),
  Rf = O({
    ...Ff,
    kind: N(`userInput`),
    text: S(),
    epilogueStart: w().int().nonnegative().optional(),
    origin: M([
      `realUser`,
      `backgroundResult`,
      `goalContinuation`,
      `mailbox`,
      `synthetic`,
      `workflowLaunch`,
    ]),
    originMeta: O({
      backgroundSource: M([`bash`, `subagent`, `workflow`]).optional(),
      workId: S().optional(),
      senderSessionId: S().optional(),
      senderLabel: S().optional(),
    }).optional(),
    workflowLaunch: uf.optional(),
    guided: N(!0).optional(),
    sourceCommandId: S().optional(),
    rootSourceCommandId: S().optional(),
    clientId: S().optional(),
    attachments: D(
      O({ ref: S(), fileName: S(), mime: S(), bytes: w(), previewRef: S().optional() }),
    ).optional(),
  }),
  zf = O({
    ...Ff,
    kind: N(`assistantText`),
    assistantResponseId: S().min(1).optional(),
    text: S(),
    state: M([`streaming`, `complete`, `interrupted`, `failed`]),
    model: S().optional(),
    feedback: M([`like`, `dislike`]).optional(),
  }),
  Bf = O({
    ...Ff,
    kind: N(`reasoning`),
    assistantResponseId: S().min(1).optional(),
    text: S(),
    state: M([`streaming`, `complete`, `interrupted`]),
    durationMs: w().optional(),
  }),
  Vf = O({
    pid: w().int().positive(),
    name: S().trim().min(1).max(256),
    bundleId: S().trim().min(1).max(512).optional(),
  }).strict(),
  Hf = O({
    ...Ff,
    kind: N(`toolCall`),
    assistantResponseId: S().min(1).optional(),
    toolCallId: S(),
    toolName: S(),
    status: M([`inputStreaming`, `pendingApproval`, `running`, `success`, `error`, `cancelled`]),
    inputText: S(),
    input: E().optional(),
    cuaApp: Vf.optional(),
    output: jf.optional(),
    display: Pf.optional().catch(void 0),
    error: O({ code: S(), message: S() }).optional(),
    progress: Mf.optional(),
    outputPreview: Bu.optional(),
    approvalInteractionId: S().optional(),
    backgrounded: N(!0).optional(),
    workId: S().optional(),
    startedAt: L.optional(),
    endedAt: L.optional(),
  }),
  Uf = M([`pdf`, `pptx`, `docx`, `xlsx`, `image`, `html`, `md`, `text`]),
  Wf = O({
    ...Ff,
    kind: N(`artifact`),
    artifactVersionId: S().trim().min(1),
    logicalArtifactKey: S().trim().min(1),
    displayName: S().trim().min(1),
    artifactType: Uf,
    mimeType: S().trim().min(1),
    sizeBytes: w().int().nonnegative(),
    sha256: S().regex(/^[0-9a-f]{64}$/u),
    ref: S().trim().min(1),
    state: N(`current`),
  }),
  Gf = O({
    ...Ff,
    kind: N(`subagent`),
    parentToolCallId: S().optional(),
    subagentType: S(),
    status: M([`running`, `success`, `failed`, `cancelled`]),
    summaryText: S(),
    childSessionId: S().optional(),
    backgrounded: N(!0).optional(),
    workId: S().optional(),
    startedAt: L.optional(),
    endedAt: L.optional(),
  });
O({
  clientVisible: N(!0),
  sourceKind: M([`user`, `plugin`, `project`, `internal`]),
  sourcePath: S().optional(),
  pluginId: S().optional(),
  pluginName: S().optional(),
  statusMessage: S().optional(),
  executionType: M([`process`, `command`]),
  executionMode: M([`foreground`, `background`]),
  commandDisplay: S(),
  timeoutMs: w().int().positive(),
}).strict();
var Kf = O({
    hookRunId: S().min(1),
    hookIndex: w().int().nonnegative(),
    didExecute: T(),
    state: M([`running`, `completed`, `failed`]),
    outcome: M([`success`, `blocked`, `failed`, `cancelled`, `timed_out`]).optional(),
    blockReason: S().trim().min(1).optional(),
    startedAt: L,
    endedAt: L.optional(),
    durationMs: w().nonnegative().optional(),
    displayName: S().trim().min(1),
    sourceKind: M([`user`, `plugin`, `project`]),
    pluginName: S().optional(),
    toolName: S().optional(),
  }).strict(),
  qf = O({
    ...Ff,
    kind: N(`hookInvocation`),
    hookInvocationId: S().min(1),
    hookEventName: M([
      `SessionStart`,
      `UserPromptSubmit`,
      `PreToolUse`,
      `PermissionRequest`,
      `PostToolUse`,
      `PostToolUseFailure`,
      `Stop`,
    ]),
    hookCount: w().int().positive(),
    state: M([`running`, `completed`, `failed`]),
    startedAt: L,
    endedAt: L.optional(),
    durationMs: w().nonnegative().optional(),
    lane: M([`assistantWork`, `toolBefore`, `toolAfter`]),
    anchorToolCallId: S().optional(),
    executions: D(Kf),
  }),
  Jf = k([
    O({
      type: N(`compact`),
      origin: M([`manual`, `auto`]),
      status: M([`running`, `success`, `failed`, `noop`, `cancelled`]),
      tokensBefore: w().optional(),
      tokensAfter: w().optional(),
      summaryRef: S().optional(),
    }),
    O({ type: N(`forkNotice`), parentSessionId: S(), parentRowId: w() }),
    O({ type: N(`forkCreated`), childSessionId: S(), atRowId: w() }),
    O({
      type: N(`modelChange`),
      fromProvider: S(),
      fromModel: S(),
      toProvider: S(),
      toModel: S(),
      toThought: S(),
    }),
    O({
      type: N(`modelChange`),
      fromProvider: Bs().optional(),
      fromModel: Bs().optional(),
      toProvider: S(),
      toModel: S(),
      toThought: S(),
    }),
    O({ type: N(`goalSet`), objective: S(), previousObjective: S().optional() }),
    O({
      type: N(`goalVerify`),
      iteration: w(),
      outcome: M([`running`, `pass`, `notSatisfied`, `failed`]),
      detail: S().optional(),
    }),
    O({ type: N(`retryNotice`), attempt: w(), reasonCode: S() }),
    O({ type: N(`checkpointRestored`), checkpointId: S() }),
  ]),
  Yf = M([`assistantWork`, `turnTailBoundary`, `lightBoundary`]),
  Xf = A(`kind`, [
    Lf,
    Rf,
    zf,
    Bf,
    Hf,
    Wf,
    Gf,
    qf,
    O({
      ...Ff,
      kind: N(`timelineMarker`),
      sourceCommandId: S().optional(),
      lane: Yf.optional(),
      marker: Jf,
    }),
  ]),
  U = S().trim().min(1),
  Zf = w().int().positive(),
  Qf = w().int().nonnegative(),
  $f = S().regex(/^[a-f0-9]{64}$/u),
  ep = M([
    `not_applicable`,
    `pending_trust`,
    `trusted_persistent`,
    `blocked_untrusted`,
    `blocked_policy`,
    `revoked`,
    `stale_digest`,
  ]),
  tp = O({ action: N(`trust_selected`), reviewItemIds: D(U).min(1) })
    .strict()
    .superRefine((e, t) => {
      `reviewItemIds` in e && e.reviewItemIds && op(e.reviewItemIds, t, [`reviewItemIds`]);
    }),
  np = O({
    sessionId: U,
    taskId: U,
    runId: U,
    remoteSessionId: U.optional(),
    workspaceIdentity: U,
    bundleDigest: $f,
    reviewFlowId: U,
    generation: Zf,
    interactionId: U,
  }).strict(),
  rp = O({
    sessionId: U,
    remoteSessionId: U.optional(),
    workspaceIdentity: U,
    bundleDigest: $f,
    hookDeclarationDigests: D($f).min(1),
  })
    .strict()
    .superRefine((e, t) => {
      op(e.hookDeclarationDigests, t, [`hookDeclarationDigests`]);
    }),
  ip = O({
    sessionId: U,
    remoteSessionId: U.optional(),
    workspaceIdentity: U,
    bundleDigest: $f,
  }).strict(),
  ap = O({
    kind: N(`workspaceHookReview`),
    reviewFlowId: U,
    generation: Zf,
    interactionId: U,
    sessionId: U,
    taskId: U,
    runId: U,
    workspaceIdentity: U,
    workspaceLabel: U,
    remoteSessionId: U.optional(),
    bundleDigest: $f,
    createdAt: L,
    deadlineAt: L,
    sourceFiles: D(O({ path: U, displayPath: U, editable: T() }).strict()),
    summary: O({ eventCount: Qf, hookCount: Qf, pendingCount: Qf }).strict(),
    items: D(
      O({
        reviewItemId: U,
        event: M([
          `SessionStart`,
          `UserPromptSubmit`,
          `PreToolUse`,
          `PermissionRequest`,
          `PostToolUse`,
          `PostToolUseFailure`,
          `Stop`,
        ]),
        matcher: S().optional(),
        type: M([`command`, `process`]),
        displayName: U,
        displayCommand: U,
        sourcePath: U,
        resolvedTimeoutMs: Zf,
        resolvedMaxOutputBytes: Zf,
        executionMode: M([`foreground`, `background`]),
        configuredEnabled: T(),
        editable: T(),
        trustState: ep,
      }).strict(),
    ),
    warningCode: N(`workspace_hooks_execute_code`),
  })
    .strict()
    .superRefine((e, t) => {
      (e.deadlineAt < e.createdAt &&
        t.addIssue({
          code: P.custom,
          path: [`deadlineAt`],
          message: `deadlineAt must not precede createdAt`,
        }),
        e.summary.hookCount !== e.items.length &&
          t.addIssue({
            code: P.custom,
            path: [`summary`, `hookCount`],
            message: `hookCount must match the immutable request items`,
          }));
      let n = new Set(e.items.map((e) => e.event)).size;
      e.summary.eventCount !== n &&
        t.addIssue({
          code: P.custom,
          path: [`summary`, `eventCount`],
          message: `eventCount must match the immutable request items`,
        });
      let r = e.items.filter((e) =>
        [`pending_trust`, `revoked`, `stale_digest`].includes(e.trustState),
      ).length;
      (e.summary.pendingCount !== r &&
        t.addIssue({
          code: P.custom,
          path: [`summary`, `pendingCount`],
          message: `pendingCount must match pending admission items`,
        }),
        op(
          e.items.map((e) => e.reviewItemId),
          t,
          [`items`],
        ));
    });
O({
  reviewFlowId: U,
  generation: Zf,
  interactionId: U,
  sessionId: U,
  workspaceIdentity: U,
  bundleDigest: $f,
  settingsSection: N(`hooks`),
  settingsScope: N(`workspace`),
}).strict();
function op(e, t, n) {
  new Set(e).size !== e.length &&
    t.addIssue({ code: P.custom, path: n, message: `review item ids must be unique` });
}
var sp = O({
    modelSelection: I.optional(),
    provider: S(),
    model: S(),
    thought: S(),
    thoughtLevels: D(S()).default([]),
    followupMode: M([`queue`, `guide`]),
    mode: S().default(`build`),
    planEnabled: T().optional(),
    permissionGrant: O({ interactionId: S().min(1) }).optional(),
    planTransition: O({ toolCallId: S(), planEnabled: T() }).optional(),
  }),
  cp = O({
    eventId: S().min(1),
    origin: N(`registryFallback`),
    from: O({ provider: S(), model: S() }),
    to: O({ provider: S(), model: S() }),
  }),
  lp = M([`draft`, `prewarming`, `running`, `completedSuccess`, `completedInterrupted`, `error`]),
  up = M([
    `assistant`,
    `tool`,
    `subagent`,
    `compact`,
    `goalVerifier`,
    `goalContinuation`,
    `turnSteer`,
    `mixed`,
    `unknown`,
  ]),
  dp = O({
    kind: M([
      `primaryTurn`,
      `foregroundSubagent`,
      `compact`,
      `goalVerifier`,
      `goalContinuation`,
      `turnSteer`,
    ]),
    foregroundExecutionId: S().min(1).optional(),
    startedAt: L,
  }),
  fp = O({
    source: M([`provider`, `runtime`, `tool`, `network`]).optional(),
    reason: S().min(1).max(160).optional(),
    errorPhase: M([
      `prepare`,
      `configuration`,
      `connect`,
      `response`,
      `stream`,
      `parse`,
      `validation`,
      `unhandled`,
    ]).optional(),
    exceptionKind: M([
      `api_call`,
      `generic`,
      `protocol`,
      `provider_business`,
      `transport`,
      `type_error`,
      `validation`,
    ]).optional(),
    providerId: S().min(1).max(160).optional(),
    modelId: S().min(1).max(160).optional(),
    providerKind: S().min(1).max(160).optional(),
    transport: M([`http`, `sse`, `websocket`]).optional(),
    statusCode: w().int().min(100).max(599).optional(),
    providerErrorCode: S().min(1).max(160).optional(),
    retryable: T().optional(),
  }).strict(),
  pp = O({
    code: S(),
    message: S(),
    recoverable: T(),
    at: L,
    source: M([`provider`, `runtime`, `tool`, `network`]),
    traceId: S().optional(),
    detail: S().optional(),
    underlyingErrorMessage: S().optional(),
    underlyingErrorDetail: S().optional(),
    attribution: fp.optional(),
  }),
  mp = O({ attempt: w(), maxAttempts: w(), nextRetryAt: L, reasonCode: S() }),
  hp = O({
    phase: lp,
    sessionEnded: T(),
    canStop: T(),
    stopState: M([`idle`, `stoppable`, `stopping`]),
    stopTargetKind: up,
    activeWorks: D(dp),
    lastError: pp.nullable(),
    apiRetry: mp.nullable(),
  }),
  gp = A(`allowed`, [O({ allowed: N(!0) }), O({ allowed: N(!1), reasonCode: S() })]),
  _p = O({
    fork: gp,
    compact: gp,
    switchModelConfig: gp,
    setFollowupMode: gp,
    queueEdit: gp,
    sendQueuedNow: gp,
    pauseGoal: gp,
    resumeGoal: gp,
  }),
  vp = O({
    mode: M([`startNow`, `enqueue`, `guide`, `reject`, `choice`]),
    reasonCode: S().optional(),
  }),
  yp = O({ title: S(), titleSource: M([`default`, `generated`, `custom`]) }),
  bp = O({
    contextWindow: O({
      usedTokens: w(),
      maxTokens: w(),
      autoCompactThresholdTokens: w().nullable(),
      cache: Pd.optional(),
      breakdown: Fd.optional(),
    }).nullable(),
    cumulative: O({
      inputTokens: w(),
      outputTokens: w(),
      cacheReadTokens: w(),
      cacheWriteTokens: w(),
    }),
  }),
  xp = O({
    items: D(
      nd.extend({
        dispatch: td.extend({ state: M([`queued`, `reserved`, `promoting`]) }),
        toolDisallowlist: D(S().min(1)).optional(),
      }),
    ),
    autoDrain: T(),
    pauseReason: M([`stopped`, `manual`, `error`]).optional(),
  }),
  Sp = 4096,
  Cp = `fullAccess`,
  wp = O({
    optionId: S(),
    label: S(),
    kind: M([`allowOnce`, `allowAlways`, `deny`, `custom`]),
    response: pd.optional(),
  }),
  Tp = O({
    kind: N(`permission`),
    toolCallId: S(),
    toolName: S(),
    summary: S(),
    detail: E(),
    freeText: T().optional(),
    origin: xd.optional(),
    display: Pf.optional().catch(void 0),
    fullAccessOption: wp.extend({ optionId: N(Cp), kind: N(`custom`) }).optional(),
    options: D(wp),
  }),
  Ep = O({ value: S(), label: S(), description: S().optional(), preview: S().optional() }),
  Dp = O({ question: S(), header: S(), options: D(Ep), multiSelect: T().optional() }),
  Op = O({
    kind: N(`userInput`),
    prompt: S(),
    freeText: T(),
    options: D(O({ optionId: S(), label: S() })).optional(),
    sensitive: T().optional(),
    toolName: S().optional(),
    toolCallId: S().optional(),
    traceId: S().optional(),
    input: E().optional(),
    schema: E().optional(),
    questions: D(Dp).optional(),
    currentQuestionIndex: w().optional(),
    answerDrafts: j(S(), D(S())).optional(),
    origin: xd.optional(),
  }),
  kp = A(`state`, [
    O({ state: M([`hiddenGrace`, `visibleCountdown`]), startedAt: L, visibleAt: L, deadlineAt: L }),
    O({ state: N(`snoozed`), startedAt: L, snoozedAt: L }),
  ]),
  Ap = O({
    interactionId: S(),
    kind: M([`permission`, `userInput`, `workspaceHookReview`]),
    anchorRowId: w().nullable(),
    createdAt: L,
    autoResolution: kp.optional(),
    payload: A(`kind`, [Tp, Op, ap]),
  }).superRefine((e, t) => {
    (e.kind !== e.payload.kind &&
      t.addIssue({
        code: P.custom,
        path: [`kind`],
        message: `pending interaction kind must match payload kind`,
      }),
      e.kind === `workspaceHookReview` &&
        e.autoResolution &&
        t.addIssue({
          code: P.custom,
          path: [`autoResolution`],
          message: `workspaceHookReview cannot use AskUserQuestion auto-resolution`,
        }),
      e.payload.kind === `workspaceHookReview` &&
        e.interactionId !== e.payload.interactionId &&
        t.addIssue({
          code: P.custom,
          path: [`interactionId`],
          message: `workspaceHookReview interaction id must match its immutable payload`,
        }));
  }),
  jp = O({ commandId: S(), clientId: S(), type: S(), state: M([`accepted`, `executing`]), at: L }),
  Mp = O({
    workId: S(),
    kind: M([`bash`, `subagent`, `workflow`]),
    title: S(),
    status: M([`running`, `resultPending`, `failed`, `cancelled`]),
    startedAt: L,
    endedAt: L.optional(),
    cancellable: T().optional(),
    blocked: T().optional(),
    anchorRowId: w().nullable(),
    childSessionId: S().optional(),
  }),
  Np = O({
    childSessionId: S(),
    agentId: S().optional(),
    toolCallId: S().optional(),
    subagentType: S(),
    title: S(),
    summary: S().optional(),
    status: M([`running`, `waiting`, `blocked`]),
    startedAt: L.optional(),
  }),
  Pp = O({
    revision: w().int().nonnegative(),
    childSessionIds: D(S()),
    running: D(Np),
    endedTotal: w().int().nonnegative(),
  }),
  Fp = O({ id: S(), content: S(), status: M([`pending`, `inProgress`, `completed`]) }),
  Ip = O({ iteration: w().int().positive(), items: D(Fp), updatedAt: L }),
  Lp = O({
    targetId: S().default(``),
    objective: S(),
    summaryTitle: S().nullable().default(null),
    timeUsedSeconds: w().int().nonnegative().default(0),
    activeRunStartedAtMs: w().int().nonnegative().nullable().default(null),
    status: M([`active`, `paused`, `verifying`, `verified`, `notSatisfied`, `failed`]),
    iteration: w(),
    verifications: D(
      O({
        iteration: w(),
        outcome: M([`pass`, `notSatisfied`, `failed`]),
        at: L,
        anchorRowId: w().nullable(),
        reason: S().optional(),
        nextAction: S().optional(),
      }),
    ),
    iterations: D(Ip).default([]),
  }),
  Rp = O({ items: D(Fp), updatedAt: L }),
  zp = O({ window: D(Xf), totalCount: w(), firstRowId: w().nullable() }),
  Bp = O({
    pendingCount: w().int().nonnegative(),
    bundleDigest: S(),
    workspaceIdentity: S().optional(),
  }),
  Vp = O({
    protocolVersion: N(1),
    sessionId: S(),
    logEpoch: S(),
    seq: w(),
    revision: w(),
    control: hp,
    availability: _p,
    inputRouting: vp,
    meta: yp.default({ title: ``, titleSource: `default` }),
    sharedContextImport: Vu.optional(),
    config: sp,
    modelTransition: cp.nullable().default(null),
    usage: bp,
    queue: xp,
    pendingInteractions: D(Ap),
    pendingCommands: D(jp),
    backgroundWorks: D(Mp),
    subagents: Pp.optional(),
    workflowRuns: af.optional(),
    goal: Lp.nullable(),
    plan: Rp.nullable(),
    workspaceHookAdmission: Bp.nullable().default(null),
    rows: zp,
  }),
  W = class extends Error {
    offset;
    constructor(e, t) {
      (super(`${e} at offset ${t}`), (this.name = `RestrictedCelError`), (this.offset = t));
    }
  };
function Hp(e, t) {
  return (Zp(t, e.offset), $p(Up(e, t)));
}
function Up(e, t) {
  switch (e.type) {
    case `literal`:
      return e.value;
    case `input`:
      return t;
    case `array`:
      return e.elements.map((e) => Up(e, t));
    case `object`: {
      let n = Object.create(null);
      for (let r of e.entries)
        Object.defineProperty(n, r.key, {
          configurable: !0,
          enumerable: !0,
          value: Up(r.value, t),
          writable: !0,
        });
      return n;
    }
    case `unary`:
      return Wp(e.operator, Up(e.operand, t), e.offset);
    case `binary`:
      return Gp(e, t);
    case `conditional`:
      return Jp(Up(e.condition, t), e.condition.offset) ? Up(e.whenTrue, t) : Up(e.whenFalse, t);
  }
}
function Wp(e, t, n) {
  if (e === `!`) return !Jp(t, n);
  let r = Yp(t, n);
  return Xp(e === `-` ? -r : r, n);
}
function Gp(e, t) {
  let n = Up(e.left, t);
  if (e.operator === `&&`) return Jp(n, e.left.offset) ? Jp(Up(e.right, t), e.right.offset) : !1;
  if (e.operator === `||`) return Jp(n, e.left.offset) ? !0 : Jp(Up(e.right, t), e.right.offset);
  let r = Up(e.right, t);
  switch (e.operator) {
    case `==`:
      return Qp(n, r);
    case `!=`:
      return !Qp(n, r);
    case `+`:
      return typeof n == `string` && typeof r == `string`
        ? n + r
        : Xp(Yp(n, e.left.offset) + Yp(r, e.right.offset), e.offset);
    case `-`:
      return Kp(n, r, e, (e, t) => e - t);
    case `*`:
      return Kp(n, r, e, (e, t) => e * t);
    case `/`:
      return Kp(n, r, e, (e, t) => e / t);
    case `%`:
      return Kp(n, r, e, (e, t) => e % t);
    case `<`:
    case `<=`:
    case `>`:
    case `>=`:
      return qp(n, r, e.operator, e.offset);
    default:
      throw new W(`unsupported operator ${e.operator}`, e.offset);
  }
}
function Kp(e, t, n, r) {
  return Xp(r(Yp(e, n.left.offset), Yp(t, n.right.offset)), n.offset);
}
function qp(e, t, n, r) {
  if (typeof e != typeof t || (typeof e != `number` && typeof e != `string`))
    throw new W(`comparison operands must have the same numeric or string type`, r);
  let i =
    typeof e == `number` && typeof t == `number`
      ? e < t
        ? -1
        : +(e > t)
      : String(e) < String(t)
        ? -1
        : +(String(e) > String(t));
  return n === `<` ? i < 0 : n === `<=` ? i <= 0 : n === `>` ? i > 0 : i >= 0;
}
function Jp(e, t) {
  if (typeof e != `boolean`) throw new W(`boolean operand required`, t);
  return e;
}
function Yp(e, t) {
  if (typeof e != `number`) throw new W(`numeric operand required`, t);
  return e;
}
function Xp(e, t) {
  if (!Number.isFinite(e) || (Number.isInteger(e) && !Number.isSafeInteger(e)))
    throw new W(`numeric result is not JSON-safe`, t);
  return e;
}
function Zp(e, t) {
  if (typeof e != `string`) {
    if (typeof e == `number`) {
      Xp(e, t);
      return;
    }
    throw new W(`input value must be a string or number`, t);
  }
}
function Qp(e, t) {
  if (Object.is(e, t)) return !0;
  if (Array.isArray(e) || Array.isArray(t))
    return (
      Array.isArray(e) &&
      Array.isArray(t) &&
      e.length === t.length &&
      e.every((e, n) => Qp(e, t[n]))
    );
  if (em(e) && em(t)) {
    let n = Object.keys(e),
      r = Object.keys(t);
    return n.length === r.length && n.every((n) => Object.hasOwn(t, n) && Qp(e[n], t[n]));
  }
  return !1;
}
function $p(e) {
  if (Array.isArray(e)) for (let t of e) $p(t);
  else if (em(e)) for (let t of Object.values(e)) $p(t);
  else return e;
  return Object.freeze(e);
}
function em(e) {
  return typeof e == `object` && !!e && !Array.isArray(e);
}
function tm(e, t) {
  return new nm(e, t).parse();
}
var nm = class {
    #e = 0;
    constructor(e, t) {
      ((this.tokens = e), (this.variableName = t));
    }
    parse() {
      let e = this.parseConditional(),
        t = this.current();
      if (t.kind !== `eof`)
        throw t.value === `.`
          ? new W(`member access is not supported`, t.offset)
          : t.value === `(`
            ? new W(`function calls are not supported`, t.offset)
            : new W(`unexpected token ${JSON.stringify(t.value)}`, t.offset);
      return e;
    }
    parseConditional() {
      let e = this.parseLogicalOr();
      if (!this.consume(`?`)) return e;
      let t = this.parseConditional();
      return (
        this.expect(`:`),
        {
          type: `conditional`,
          condition: e,
          whenTrue: t,
          whenFalse: this.parseConditional(),
          offset: e.offset,
        }
      );
    }
    parseLogicalOr() {
      return this.parseBinary(() => this.parseLogicalAnd(), new Set([`||`]));
    }
    parseLogicalAnd() {
      return this.parseBinary(() => this.parseEquality(), new Set([`&&`]));
    }
    parseEquality() {
      return this.parseBinary(() => this.parseRelational(), new Set([`==`, `!=`]));
    }
    parseRelational() {
      return this.parseBinary(() => this.parseAdditive(), new Set([`<`, `<=`, `>`, `>=`]));
    }
    parseAdditive() {
      return this.parseBinary(() => this.parseMultiplicative(), new Set([`+`, `-`]));
    }
    parseMultiplicative() {
      return this.parseBinary(() => this.parseUnary(), new Set([`*`, `/`, `%`]));
    }
    parseBinary(e, t) {
      let n = e();
      for (; this.current().kind === `operator` && t.has(this.current().value); ) {
        let t = this.advance();
        n = { type: `binary`, operator: t.value, left: n, right: e(), offset: t.offset };
      }
      return n;
    }
    parseUnary() {
      let e = this.current();
      return e.kind === `operator` && (e.value === `!` || e.value === `-` || e.value === `+`)
        ? (this.advance(),
          { type: `unary`, operator: e.value, operand: this.parseUnary(), offset: e.offset })
        : this.parsePrimary();
    }
    parsePrimary() {
      let e = this.advance();
      if (e.kind === `number`) {
        let t = Number(e.value);
        if (!Number.isFinite(t) || (Number.isInteger(t) && !Number.isSafeInteger(t)))
          throw new W(`number literal is not JSON-safe`, e.offset);
        return { type: `literal`, value: t, offset: e.offset };
      }
      if (e.kind === `string`) return { type: `literal`, value: e.value, offset: e.offset };
      if (e.kind === `identifier`) {
        if (this.current().value === `(`)
          throw new W(`function calls are not supported`, this.current().offset);
        if (e.value === this.variableName) return { type: `input`, offset: e.offset };
        if (e.value === `true` || e.value === `false`)
          return { type: `literal`, value: e.value === `true`, offset: e.offset };
        if (e.value === `null`) return { type: `literal`, value: null, offset: e.offset };
        throw new W(`unknown identifier ${JSON.stringify(e.value)}`, e.offset);
      }
      if (e.value === `(`) {
        let e = this.parseConditional();
        return (this.expect(`)`), e);
      }
      if (e.value === `[`) return this.parseArray(e.offset);
      if (e.value === `{`) return this.parseObject(e.offset);
      throw new W(`unexpected token ${JSON.stringify(e.value)}`, e.offset);
    }
    parseArray(e) {
      let t = [];
      if (!this.consume(`]`)) {
        do t.push(this.parseConditional());
        while (this.consume(`,`));
        this.expect(`]`);
      }
      return { type: `array`, elements: Object.freeze(t), offset: e };
    }
    parseObject(e) {
      let t = [],
        n = new Set();
      if (!this.consume(`}`)) {
        do {
          let e = this.advance();
          if (e.kind !== `string`) throw new W(`object keys must be string literals`, e.offset);
          if (n.has(e.value))
            throw new W(`duplicate object key ${JSON.stringify(e.value)}`, e.offset);
          (n.add(e.value),
            this.expect(`:`),
            t.push({ key: e.value, value: this.parseConditional(), offset: e.offset }));
        } while (this.consume(`,`));
        this.expect(`}`);
      }
      return { type: `object`, entries: Object.freeze(t), offset: e };
    }
    consume(e) {
      return this.current().value === e ? ((this.#e += 1), !0) : !1;
    }
    expect(e) {
      let t = this.current();
      if (t.value !== e) throw new W(`expected ${JSON.stringify(e)}`, t.offset);
      return ((this.#e += 1), t);
    }
    advance() {
      let e = this.current();
      return (e.kind !== `eof` && (this.#e += 1), e);
    }
    current() {
      return this.tokens[this.#e] ?? this.tokens[this.tokens.length - 1];
    }
  },
  rm = new Set([`&&`, `||`, `==`, `!=`, `<=`, `>=`]),
  im = new Set([`+`, `-`, `*`, `/`, `%`, `!`, `<`, `>`]),
  am = new Set([`{`, `}`, `[`, `]`, `(`, `)`, `,`, `:`, `?`, `.`]);
function om(e) {
  let t = [],
    n = 0;
  for (; n < e.length; ) {
    let r = e[n];
    if (/\s/u.test(r)) {
      n += 1;
      continue;
    }
    if (r === `'` || r === `"`) {
      let i = cm(e, n, r);
      (t.push(i), (n = i.end));
      continue;
    }
    if (/[0-9]/u.test(r)) {
      let r = sm(e, n);
      (t.push(r), (n = r.end));
      continue;
    }
    if (/[A-Za-z_]/u.test(r)) {
      let r = um(e, n + 1, /[A-Za-z0-9_]/u);
      (t.push({ kind: `identifier`, value: e.slice(n, r), offset: n, end: r }), (n = r));
      continue;
    }
    let i = e.slice(n, n + 2);
    if (rm.has(i)) {
      (t.push({ kind: `operator`, value: i, offset: n, end: n + 2 }), (n += 2));
      continue;
    }
    if (im.has(r)) {
      (t.push({ kind: `operator`, value: r, offset: n, end: n + 1 }), (n += 1));
      continue;
    }
    if (am.has(r)) {
      (t.push({ kind: `punctuation`, value: r, offset: n, end: n + 1 }), (n += 1));
      continue;
    }
    throw new W(`unsupported token ${JSON.stringify(r)}`, n);
  }
  return (t.push({ kind: `eof`, value: ``, offset: e.length, end: e.length }), Object.freeze(t));
}
function sm(e, t) {
  let n = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(e.slice(t));
  if (!n) throw new W(`invalid number literal`, t);
  let r = n[0];
  return { kind: `number`, value: r, offset: t, end: t + r.length };
}
function cm(e, t, n) {
  let r = t + 1,
    i = ``;
  for (; r < e.length; ) {
    let a = e[r];
    if (a === n) return { kind: `string`, value: i, offset: t, end: r + 1 };
    if (
      a ===
        `
` ||
      a === `\r`
    )
      throw new W(`unterminated string literal`, t);
    if (a !== `\\`) {
      ((i += a), (r += 1));
      continue;
    }
    let o = r;
    r += 1;
    let s = e[r];
    if (s === void 0) throw new W(`unterminated string escape`, o);
    let c = lm[s];
    if (c !== void 0) {
      ((i += c), (r += 1));
      continue;
    }
    if (s === `u`) {
      let t = e.slice(r + 1, r + 5);
      if (!/^[0-9A-Fa-f]{4}$/u.test(t)) throw new W(`invalid unicode escape`, o);
      ((i += String.fromCharCode(Number.parseInt(t, 16))), (r += 5));
      continue;
    }
    throw new W(`unsupported string escape \\${s}`, o);
  }
  throw new W(`unterminated string literal`, t);
}
var lm = Object.freeze({
  "'": `'`,
  '"': `"`,
  "\\": `\\`,
  b: `\b`,
  f: `\f`,
  n: `
`,
  r: `\r`,
  t: `	`,
});
function um(e, t, n) {
  let r = t;
  for (; r < e.length && n.test(e[r]); ) r += 1;
  return r;
}
var dm = new Map(),
  fm = new Map();
function pm(e, t) {
  let n = mm(e),
    r = gm(n, t),
    i = dm.get(r);
  if (i) return i;
  let a = hm(n, t);
  _m(a);
  let o = Object.freeze({
    source: n,
    evaluate(e) {
      let t = Hp(a, e);
      if (!vm(t)) throw new W(`model option map must return a JSON object`, 0);
      return t;
    },
  });
  return (dm.set(r, o), o);
}
function mm(e) {
  let t = e.trim();
  if (t.length === 0) throw new W(`expression must not be empty`, 0);
  return t;
}
function hm(e, t) {
  let n = gm(e, t),
    r = fm.get(n);
  if (r) return r;
  let i = tm(om(e), t);
  return (fm.set(n, i), i);
}
function gm(e, t) {
  return `${t}\0${e}`;
}
function _m(e) {
  if (e.type !== `object`) {
    if (e.type === `conditional`) {
      (_m(e.whenTrue), _m(e.whenFalse));
      return;
    }
    throw new W(`model option map must return a JSON object`, e.offset);
  }
}
function vm(e) {
  return typeof e == `object` && !!e && !Array.isArray(e);
}
function ym(e) {
  return Object.fromEntries(Object.entries(e).map(([e, t]) => [e, t.nullable().optional()]));
}
function bm(e) {
  return S()
    .min(1)
    .superRefine((t, n) => {
      try {
        pm(t, e);
      } catch (e) {
        n.addIssue({
          code: `custom`,
          message: e instanceof Error ? e.message : `Option map 无法编译`,
        });
      }
    });
}
var xm = O({
    values: D(S().refine((e) => e.trim().length > 0, `reasoningLevel.values 必须是非空字符串`))
      .min(1, `reasoningLevel.values 不能为空`)
      .refine((e) => new Set(e).size === e.length, `reasoningLevel.values 不能重复`)
      .readonly(),
    map: bm(`reasoningLevel`),
  }).strict(),
  Sm = O({ max: w().int().positive(), map: bm(`maxOutputTokens`) }).strict(),
  Cm = O(ym(xm.shape)).strict(),
  wm = O(ym(Sm.shape)).strict(),
  Tm = O({
    supportsText: T(),
    supportsImage: T(),
    supportsVideo: T(),
    supportsAudio: T(),
    supportsPdf: T(),
  }).strict(),
  Em = O({ supportsText: T() }).strict(),
  Dm = O(ym(Tm.shape)).strict(),
  Om = O(ym(Em.shape)).strict(),
  km = O({
    requiresMfjsToolSchema: T(),
    contextWindow: w().int().positive(),
    inputFormat: Tm,
    outputFormat: Em,
    supportsToolCall: T(),
    supportsJsonSchemaOutput: T(),
    supportsNativeWebSearch: T(),
    supportsMidConversationSystem: T(),
  }).strict(),
  Am = O({
    ...ym(km.shape),
    inputFormat: Dm.nullable().optional(),
    outputFormat: Om.nullable().optional(),
  }).strict(),
  jm = O({ reasoningLevel: xm, maxOutputTokens: Sm }).strict(),
  Mm = O({
    ...ym(jm.shape),
    reasoningLevel: Cm.nullable().optional(),
    maxOutputTokens: wm.nullable().optional(),
  }).strict(),
  Nm = O({ enabled: T(), properties: km, optionSpecs: jm }).strict(),
  Pm = O({
    ...ym(Nm.shape),
    properties: Am.nullable().optional(),
    optionSpecs: Mm.nullable().optional(),
  }).strict(),
  Fm = M([`not-authenticated`, `not-connected`, `credential-failed`, `not-entitled`]),
  Im = O({
    memoryExtraction: N(`skip`).optional(),
    selectionScope: N(`execution`),
    requestAuth: O({ apiKey: S().min(1).optional(), headers: j(S().min(1), S().min(1)).optional() })
      .strict()
      .optional(),
    subagents: O({ foregroundModel: N(`submission`), background: N(`deny`) })
      .strict()
      .optional(),
  }).strict(),
  Lm = [`all`, `7d`, `30d`],
  Rm = O({ modelId: S().nullable(), totalTokens: w(), share: w() }),
  zm = O({
    totalTokens: w(),
    inputTokens: w(),
    outputTokens: w(),
    reasoningTokens: w(),
    cacheCreationTokens: w(),
    cacheReadTokens: w(),
    cacheHitRate: w(),
    totalSessions: w(),
    totalTurns: w(),
    toolCallCount: w(),
    toolErrorRate: w(),
    modelErrorRate: w(),
    avgTimeToFirstTokenMs: w().nullable(),
    avgTurnDurationMs: w().nullable(),
    activeDays: w(),
    currentStreakDays: w(),
    longestSessionMs: w(),
    longestStreakDays: w(),
    peakDayTokens: w(),
    favoriteModel: Rm.nullable(),
  }),
  Bm = O({
    date: S(),
    level: k([N(0), N(1), N(2), N(3), N(4)]),
    totalTokens: w(),
    turnCount: w(),
    toolCallCount: w(),
  }),
  Vm = O({ weekIndex: w(), days: D(Bm.nullable()) }),
  Hm = O({ startDate: S().nullable(), endDate: S().nullable(), maxTokens: w(), weeks: D(Vm) }),
  Um = O({ modelId: S().nullable(), totalTokens: w() }),
  Wm = O({ date: S(), models: D(Um) }),
  Gm = O({
    modelId: S().nullable(),
    totalTokens: w(),
    inputTokens: w(),
    outputTokens: w(),
    requestCount: w(),
    share: w(),
  }),
  Km = O({
    toolName: S(),
    callCount: w(),
    errorCount: w(),
    errorRate: w(),
    avgDurationMs: w().nullable(),
  });
O({
  range: M(Lm),
  generatedAt: w(),
  timeZone: S(),
  source: N(`agent-db`),
  summary: zm,
  heatmap: Hm,
  dailyModelUsage: D(Wm),
  models: D(Gm),
  tools: D(Km),
});
var qm = `zcodeAgent`,
  Jm = [`glm`];
function Ym(e) {
  return `glm`;
}
function Xm(e) {
  return e === `glm`;
}
var Zm = [`telegram`, `webhook`, `feishu`, `lark`, `weixin`, `discord`, `wecom`],
  Qm = O({
    provider: M([`feishu`, `lark`, `weixin`]),
    botId: S().trim().min(1),
    providerUserId: S().trim().min(1),
    chatType: M([`private`, `group`]),
  }).strict();
function $m(e) {
  return e === `feishu` || e === `lark`;
}
var eh = [`assistant_changes`, `assistant_toolcalls_changes`, `summary_changes`, `streaming_card`],
  th = 3e4,
  nh = `bots:task`,
  rh = `bots:task-stream`,
  ih = O({
    status: T(),
    new: T(),
    workspace: T(),
    model: T(),
    mode: T().optional(),
    thoughtLevel: T(),
    sandboxMode: T().optional(),
    approvalPolicy: T().optional(),
    cli: T().optional(),
    reply: T(),
  }).strict(),
  ah = O({
    modelSelection: I.optional(),
    mode: S().min(1).optional(),
    sandboxMode: S().min(1).optional(),
    approvalPolicy: S().min(1).optional(),
    cli: M([`codex`, `claude`, `opencode`, `gemini`, `glm`]).optional(),
  }).strict(),
  oh = O({
    provider: M([`codex`, `claude`, `opencode`, `gemini`, `glm`]),
    modelSelection: I.optional(),
    mode: S().min(1).optional(),
  }).strict(),
  sh = O({ value: S(), label: S(), description: S().optional() }).strict(),
  ch = O({ question: S(), header: S(), options: D(sh), multiSelect: T().optional() }).strict(),
  lh = O({
    taskId: S().min(1),
    requestId: S().min(1),
    runId: S().min(1),
    origin: xd.optional(),
    actorKey: S().min(1).optional(),
    currentQuestionIndex: w().int().min(0),
    questions: D(ch),
    answers: j(S(), D(S())),
    renderContext: O({ kind: N(`plan_approval`), plan: S().min(1) })
      .strict()
      .optional(),
    expandedCustomAnswerQuestionIndexes: D(w().int().min(0)).optional(),
    handledAt: w().optional(),
  }).strict(),
  uh = O({
    id: S().min(1),
    name: S(),
    provider: M(Zm),
    enabled: T(),
    credentialRef: S().min(1).optional(),
    webhookSecretRef: S().min(1).optional(),
    webhookUrl: S().url().optional(),
    webhookAuthHeaderName: S().min(1).optional(),
    feishuAppId: S().min(1).optional(),
    providerUserId: S().min(1).optional(),
    displayName: S().optional(),
    allowedWorkspaces: D(S().min(1)),
    allowedCommands: ih,
    currentOptions: ah,
    replyMode: M([
      `assistant_changes`,
      `assistant_toolcalls_changes`,
      `summary_changes`,
      `streaming_card`,
    ]),
  }).strict();
(O({ version: N(3), bots: D(uh) }).strict(),
  O({
    version: N(3),
    bots: j(
      S(),
      O({
        botId: S().min(1),
        workspacePath: S().min(1),
        workspaceIdentity: S().min(1).optional(),
        workspaceId: S().min(1).optional(),
        mode: M([`draft`, `task`]),
        activeTaskId: S().min(1).nullable(),
        draftOptions: oh.optional(),
        pendingPermissionOptions: D(
          O({
            requestId: S().min(1),
            optionId: S().min(1),
            command: M([`approve`, `deny`]),
            label: S().min(1),
            response: pd,
            handledAt: w().optional(),
          }),
        ).optional(),
        pendingElicitation: lh.optional(),
        telegramOffset: w().optional(),
        weixinGetUpdatesBuf: S().optional(),
        weixinActivatedAt: w().optional(),
        updatedAt: w(),
      }),
    ),
  }).strict());
var dh = `assistant_changes`;
function fh(e) {
  return $m(e) ? [`streaming_card`] : eh.filter((e) => e !== `streaming_card`);
}
function ph(e, t) {
  let n = fh(e),
    r = t ?? `assistant_changes`;
  return n.includes(r) ? r : n[0];
}
function mh(e) {
  let t = e.trim();
  return (
    t.length > 0 &&
    t.length <= 64 &&
    !hh(t) &&
    !t.includes(`:`) &&
    !t.includes(`/`) &&
    !t.includes(`\\`)
  );
}
function hh(e) {
  for (let t of e) {
    let e = t.codePointAt(0) ?? 0;
    if (e < 32 || e === 127) return !0;
  }
  return !1;
}
var gh = S()
    .trim()
    .max(64)
    .refine((e) => e.length === 0 || mh(e), { message: `Invalid WSL user` }),
  _h = `https://zcode.z.ai`,
  vh = `https://zcode.chatglm.site`,
  yh = `https://bigmodel.cn`,
  bh = `https://dev.bigmodel.cn`,
  xh = `wss://zcode.z.ai/ws`,
  Sh = `3.4.0`;
function Ch(e) {
  if (!e) return !1;
  let t = e
    .trim()
    .replace(/^v/i, ``)
    .match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([^+]+))?(?:\+(.+))?$/);
  if (!t) return !1;
  let n = t[4]?.split(`.`),
    r =
      n === void 0 ||
      n.every((e) => /^[0-9A-Za-z-]+$/.test(e) && (!/^\d+$/.test(e) || /^(0|[1-9]\d*)$/.test(e))),
    i = t[5]?.split(`.`),
    a = i === void 0 || i.every((e) => /^[0-9A-Za-z-]+$/.test(e));
  if (!r || !a) return !1;
  let o = [Number(t[1]), Number(t[2]), Number(t[3])],
    s = Sh.split(`.`).map(Number);
  for (let e = 0; e < s.length; e += 1) if (o[e] !== s[e]) return o[e] > s[e];
  return n === void 0;
}
function wh(e, t) {
  return e[t]?.trim() || void 0;
}
function Th(e) {
  let t = e.trim();
  if (!t) throw Error(`ZCode endpoint origin is empty`);
  let n = new URL(t);
  if (n.protocol !== `https:` && n.protocol !== `http:`)
    throw Error(`ZCode endpoint origin must use http or https`);
  return n.origin;
}
function Eh(e) {
  return e === `localhost` || e === `127.0.0.1` || e === `::1`;
}
function Dh(e, t) {
  if (!e) return !1;
  try {
    let n = Th(e);
    if (
      n === `https://zcode.z.ai` ||
      n === `https://zcode.chatglm.site` ||
      n === `http://localhost:3000`
    )
      return !0;
    let r = new URL(n);
    return t?.e2eStoreBridgeEnabled === !0 && Eh(r.hostname);
  } catch {
    return !1;
  }
}
function Oh(e) {
  let t = e?.env ?? `test`,
    n = e?.envBaseOrigin?.trim();
  if (t === `production`) return n ? Th(n) : _h;
  let r = e?.overrideOrigin?.trim();
  return r ? Th(r) : n ? Th(n) : vh;
}
function kh(e = {}) {
  return e.ZCODE_ENV?.trim().toLowerCase() === `test` ? `test` : `production`;
}
function Ah(e = {}, t) {
  let n = kh(e),
    r = n === `production` ? wh(e, `ZCODE_PRODUCTION_BASE_URL`) : wh(e, `ZCODE_TEST_BASE_URL`);
  return Oh({
    env: n,
    envBaseOrigin: wh(e, `ZCODE_BASE_URL`) ?? wh(e, `ZCODE_ENDPOINT_ORIGIN`) ?? r,
    overrideOrigin: t?.overrideOrigin,
  });
}
function jh(e = {}) {
  return Lh(Ah(e));
}
function Mh(e) {
  return (
    e?.overrideUrl?.trim() ||
    (e?.endpointOrigin?.trim() === `https://zcode.chatglm.site`
      ? `wss://zcode.chatglm.site/ws`
      : xh)
  );
}
function Nh(e = {}) {
  let t = kh(e),
    n =
      t === `production`
        ? wh(e, `BIGMODEL_PRODUCTION_API_BASE_URL`)
        : wh(e, `BIGMODEL_TEST_API_BASE_URL`),
    r = t === `production` ? yh : bh;
  return Th(wh(e, `BIGMODEL_API_BASE_URL`) ?? n ?? r);
}
function Ph(e = {}, t) {
  let n = t.startsWith(`/`) ? t : `/${t}`;
  return `${Nh(e)}${n}`;
}
function Fh(e = {}) {
  return Ph(e, `/coding-plan/personal/overview`);
}
function Ih(e = {}) {
  return Ph(e, `/coding-plan/team/plans`);
}
function Lh(e, t = {}) {
  let n = Th(e),
    r = new URL(n),
    i = `${r.protocol === `https:` ? `wss:` : `ws:`}//${r.host}`,
    a = Ch(t.appVersion) ? `v4` : `v3`;
  return {
    origin: n,
    apiBaseUrl: `${n}/api/v1`,
    remoteUrl: `${n}/remote/${a}`,
    webRemoteCallbackUrl: `${n}/web-remote/callback`,
    webShareCallbackUrl: `${n}/cn/share/callback`,
    relayWsUrl: `${i}/ws`,
    zcodePlanOpenAiBaseUrl: `${n}/api/v1/zcode-plan`,
    zcodePlanAnthropicBaseUrl: `${n}/api/v1/zcode-plan/anthropic`,
    zcodePlanBillingCurrentUrl: `${n}/api/v1/zcode-plan/billing/current`,
    zcodePlanBillingBalanceUrl: `${n}/api/v1/zcode-plan/billing/balance`,
  };
}
var Rh = M([
    `office`,
    `developer`,
    `independent`,
    `infrastructure`,
    `product`,
    `design`,
    `student`,
    `creator`,
    `operations`,
    `marketing`,
    `finance`,
    `accounting`,
    `legal`,
    `other`,
  ]),
  G = S().trim().min(1),
  zh = M([`zh-CN`, `en-US`]),
  Bh = M([`system`, `zh-CN`, `en-US`]),
  Vh = M([`queue`, `guide`]),
  Hh = M([`stable`, `preview`]),
  Uh = w().int().min(-3).max(5),
  Wh = O({ width: w().int().min(480), height: w().int().min(640), maximized: T() }),
  Gh = A(`mode`, [
    O({ mode: N(`auto`) }),
    O({ mode: N(`shell`), dialect: M([`cmd`, `git-bash`]), id: G, label: G, path: G }),
  ]),
  Kh = D(Eu).transform(() => [...Jm]),
  qh = M([`zai`, `bigmodel`]),
  Jh = O({
    version: G,
    title: G,
    markdown: G,
    releaseDate: G.optional(),
    releaseNotesByLocale: Zs(zh, O({ title: G, markdown: G })).optional(),
  }),
  Yh = Zs(Hh, G).default({}),
  Xh = A(`kind`, [
    O({
      kind: N(`ssh`),
      host: G,
      port: w().int().positive().max(65535).optional(),
      username: G,
      sshConfigAlias: G.optional(),
      privateKeyPath: S().optional(),
      assetInstallMode: M(hu).optional(),
      resourcePackages: O({ selectedPackageIds: D(S().refine(Tu)).optional() }).optional(),
      passwordCredentialKey: G.optional(),
      privateKeyPassphraseCredentialKey: G.optional(),
    }),
    O({ kind: N(`wsl`), distro: S().optional(), user: gh.optional() }),
    O({ kind: N(`docker`), container: G }),
    O({
      kind: N(`server`),
      url: S().url(),
      name: G.optional(),
      workspacePath: S().optional(),
      serverId: G.optional(),
      tokenCredentialKey: G.optional(),
    }),
  ]),
  Zh = A(`kind`, [
    O({
      kind: N(`local`),
      workspacePath: G,
      workspacePurpose: M([`project`, `conversation`]).default(`project`),
    }),
    O({
      kind: N(`remote`),
      workspacePath: G,
      localWorkspacePath: G.optional(),
      workspaceIdentity: G.optional(),
      target: Xh,
      lastOpenedAt: w().int().nonnegative(),
      lastConnectionStatus: M([`connected`, `failed`]),
      lastConnectionError: S().optional(),
    }),
  ]),
  Qh = O({ deviceSid: G }),
  $h = O({ workspacePath: G, workspaceIdentity: G.optional(), initialTaskId: G.optional() }),
  eg = wc((e) => {
    if (typeof e != `string`) return;
    let t = e.trim();
    if (t)
      try {
        return Th(t);
      } catch {
        return;
      }
  }, S().optional());
function tg(e) {
  if (!e || typeof e != `object` || Array.isArray(e)) return e;
  let t = e;
  if (!(`zcodeEndpointOrigin` in t)) return e;
  let n = eg.safeParse(t.zcodeEndpointOrigin);
  if (n.success && typeof n.data == `string`) return { ...t, zcodeEndpointOrigin: n.data };
  let { zcodeEndpointOrigin: r, ...i } = t;
  return i;
}
function ng(e) {
  if (!e || typeof e != `object` || Array.isArray(e)) return e;
  let t = e;
  if (!(`desktopWindowSize` in t) || Wh.safeParse(t.desktopWindowSize).success) return e;
  let { desktopWindowSize: n, ...r } = t;
  return r;
}
function rg(e) {
  if (!e || typeof e != `object` || Array.isArray(e)) return e;
  let t = e;
  if (
    !(`embeddedBrowserViewportPreference` in t) ||
    Il.safeParse(t.embeddedBrowserViewportPreference).success
  )
    return e;
  let { embeddedBrowserViewportPreference: n, ...r } = t;
  return r;
}
function ig(e) {
  if (!e || typeof e != `object` || Array.isArray(e)) return e;
  let t = e;
  return t.closeToTrayOnWindowsMigrationInitialized === !0
    ? e
    : { ...t, closeToTrayOnWindows: !0, closeToTrayOnWindowsMigrationInitialized: !0 };
}
function ag(e) {
  if (!e || typeof e != `object` || Array.isArray(e)) return e;
  let t = e;
  return t.messageStreamShowReasoningMigrationInitialized === !0
    ? e
    : { ...t, messageStreamShowReasoning: !0, messageStreamShowReasoningMigrationInitialized: !0 };
}
function og(e) {
  if (!e || typeof e != `object` || Array.isArray(e)) return e;
  let t = e;
  if (`localePreference` in t || !(`locale` in t)) return e;
  let n = zh.safeParse(t.locale);
  return n.success ? { ...t, localePreference: n.data } : e;
}
var sg = O({
  id: G,
  workspacePath: G,
  localWorkspacePath: G.optional(),
  workspaceIdentity: G.optional(),
  target: Xh,
  lastOpenedAt: w().int().nonnegative(),
  lastConnectionStatus: M([`connected`, `failed`]),
  lastConnectionError: S().optional(),
});
function cg(e) {
  return !e || typeof e != `object` || Array.isArray(e)
    ? e
    : { ...e, enabledBuiltinAgentCliProviders: [...Jm] };
}
function lg(e) {
  if (!e || typeof e != `object` || Array.isArray(e)) return e;
  let t = e;
  if (t.kind !== `ssh` || !(`resourcePackages` in t)) return e;
  let { resourcePackages: n, ...r } = t;
  return r;
}
function ug(e) {
  if (!e || typeof e != `object` || Array.isArray(e)) return e;
  let t = e,
    n = { ...t },
    r = Array.isArray(t.lastWorkspaceSession) ? t.lastWorkspaceSession : [],
    i = r.some((e) => (!e || typeof e != `object` || Array.isArray(e) ? !1 : `historyId` in e)),
    a = Array.isArray(t.remoteWorkspaceHistory) ? t.remoteWorkspaceHistory : [],
    o = new Map(
      a.flatMap((e) => {
        let t = e && typeof e == `object` && !Array.isArray(e) ? { ...e, target: lg(e.target) } : e,
          n = sg.safeParse(t);
        return n.success ? [[n.data.id, n.data]] : [];
      }),
    ),
    s =
      r.length > 0
        ? r.flatMap((e) => {
            if (!e || typeof e != `object` || Array.isArray(e)) return [];
            let t = e;
            if (t.kind === `local` && typeof t.workspacePath == `string`)
              return [
                {
                  kind: `local`,
                  workspacePath: t.workspacePath,
                  workspacePurpose:
                    t.workspacePurpose === `conversation` ? `conversation` : `project`,
                },
              ];
            if (t.kind === `remote`) {
              if (typeof t.workspacePath == `string` && t.target)
                return [{ ...t, target: lg(t.target) }];
              if (typeof t.historyId == `string`) {
                let e = o.get(t.historyId);
                return e
                  ? [
                      {
                        kind: `remote`,
                        workspacePath: e.workspacePath,
                        ...(e.localWorkspacePath
                          ? { localWorkspacePath: e.localWorkspacePath }
                          : {}),
                        ...(e.workspaceIdentity ? { workspaceIdentity: e.workspaceIdentity } : {}),
                        target: lg(e.target),
                        lastOpenedAt: e.lastOpenedAt,
                        lastConnectionStatus: e.lastConnectionStatus,
                        ...(e.lastConnectionError
                          ? { lastConnectionError: e.lastConnectionError }
                          : {}),
                      },
                    ]
                  : [];
              }
            }
            return [];
          })
        : [],
    c = Array.isArray(t.lastOpenTabs)
      ? t.lastOpenTabs.flatMap((e) =>
          typeof e == `string`
            ? [{ kind: `local`, workspacePath: e, workspacePurpose: `project` }]
            : [],
        )
      : [],
    l = new Set(
      s.flatMap((e) =>
        e.kind === `local` && typeof e.workspacePath == `string` ? [e.workspacePath] : [],
      ),
    ),
    u = [...s, ...c.filter((e) => !l.has(e.workspacePath))];
  return (
    (u.length > 0 || i || Array.isArray(t.lastOpenTabs)) && (n.lastWorkspaceSession = u),
    delete n.lastOpenTabs,
    delete n.remoteWorkspaceHistory,
    n
  );
}
(wc(
  (e) => rg(ng(ag(ig(og(tg(ug(cg(e)))))))),
  O({
    recentProjects: D(S()).default([]),
    locale: zh.default(`zh-CN`),
    shortcutBindings: j(S(), D(S())).optional(),
    localePreference: Bh.default(`system`),
    terminalInheritSystemProfile: T().default(!0),
    terminalFontFamily: G.optional(),
    integratedTerminalShell: Gh.optional(),
    httpProxy: G.optional(),
    httpProxyNoProxy: G.optional(),
    httpProxyCaCertPath: G.optional(),
    embeddedBrowserAllowInsecureCertificates: T().default(!1),
    embeddedBrowserViewportPreference: Il.default(Ll),
    computerUseComposerEntryHidden: T().default(!0),
    taskAutoArchiveEnabled: T().default(!1),
    taskAutoArchiveOlderThanDays: w().int().positive().max(365).default(7),
    closeToTrayOnWindows: T().default(!0),
    closeToTrayOnWindowsMigrationInitialized: T().default(!0),
    keepAwakeWhileRunning: T().default(!1),
    desktopZoomLevel: Uh.optional(),
    desktopWindowSize: Wh.optional(),
    desktopChromiumHardwareAccelerationEnabled: T().default(!0),
    messageStreamShowReasoning: T().default(!0),
    messageStreamShowReasoningMigrationInitialized: T().default(!0),
    messageStreamShowTodos: T().default(!1),
    toolGroupingExploreEnabled: T().default(!0),
    toolGroupingTerminalEnabled: T().default(!0),
    toolGroupingChangesEnabled: T().default(!1),
    zcodeInteractionBehavior: Vh.default(`queue`),
    askUserQuestionAutoResolutionEnabled: T().default(!0),
    modelIoFullRetentionEnabled: T().default(!1),
    enabledBuiltinAgentCliProviders: Kh.default([...Jm]),
    startPlanRecommendationDismissed: T().default(!1),
    providerFamilyConnectionSelections: ju.default({}),
    providerFamilyDomain: qh.optional(),
    providerFamilyDomainUpdatedAt: w().int().nonnegative().optional(),
    providerFamilyDomainMigrated: T().default(!1),
    nativeSearchEnhancementsEnabled: T().default(!0),
    onboardingOccupation: Rh.nullish(),
    proactiveSuggestionsEnabled: T().optional(),
    memoryEnabled: T().default(!1),
    lastWorkspaceSession: D(Zh).default([]),
    lastActiveTabIndex: w().int().nonnegative().default(0),
    lastActiveTaskByWorkspace: j(S(), S()).optional(),
    dataBaseDir: S().trim().min(1).optional(),
    pendingPostUpdateReleaseNotes: Jh.optional(),
    receivePreviewUpdates: T().default(!1),
    autoDownloadAndInstallUpdates: T().default(!1),
    skippedElectronUpdateVersions: Yh,
    settingsSyncFirstRunPromptHandled: T().optional(),
    webRemoteControlExternalRelayDevice: Qh.optional(),
    webRemoteControlLastEnabledContext: $h.optional(),
    zcodeEndpointOrigin: eg.optional(),
  }),
),
  O({
    recentProjects: D(S()).optional(),
    locale: zh.optional(),
    shortcutBindings: j(S(), D(S())).optional(),
    localePreference: Bh.optional(),
    terminalInheritSystemProfile: T().optional(),
    terminalFontFamily: G.optional(),
    integratedTerminalShell: Gh.optional(),
    httpProxy: G.optional(),
    httpProxyNoProxy: G.optional(),
    httpProxyCaCertPath: G.optional(),
    embeddedBrowserAllowInsecureCertificates: T().optional(),
    embeddedBrowserViewportPreference: Il.optional(),
    computerUseComposerEntryHidden: T().optional(),
    taskAutoArchiveEnabled: T().optional(),
    taskAutoArchiveOlderThanDays: w().int().positive().max(365).optional(),
    closeToTrayOnWindows: T().optional(),
    keepAwakeWhileRunning: T().optional(),
    closeToTrayOnWindowsMigrationInitialized: T().optional(),
    desktopZoomLevel: Uh.optional(),
    desktopWindowSize: Wh.optional(),
    desktopChromiumHardwareAccelerationEnabled: T().optional(),
    messageStreamShowReasoning: T().optional(),
    messageStreamShowReasoningMigrationInitialized: T().optional(),
    messageStreamShowTodos: T().optional(),
    toolGroupingExploreEnabled: T().optional(),
    toolGroupingTerminalEnabled: T().optional(),
    toolGroupingChangesEnabled: T().optional(),
    zcodeInteractionBehavior: Vh.optional(),
    askUserQuestionAutoResolutionEnabled: T().optional(),
    modelIoFullRetentionEnabled: T().optional(),
    enabledBuiltinAgentCliProviders: Kh.optional(),
    startPlanRecommendationDismissed: T().optional(),
    providerFamilyConnectionSelections: ju.optional(),
    providerFamilyDomain: k([qh, N(``)]).optional(),
    providerFamilyDomainUpdatedAt: w().int().nonnegative().optional(),
    providerFamilyDomainMigrated: T().optional(),
    nativeSearchEnhancementsEnabled: T().optional(),
    onboardingOccupation: M([
      `office`,
      `developer`,
      `independent`,
      `infrastructure`,
      `product`,
      `design`,
      `student`,
      `creator`,
      `operations`,
      `marketing`,
      `finance`,
      `accounting`,
      `legal`,
      `other`,
    ]).nullish(),
    proactiveSuggestionsEnabled: T().optional(),
    memoryEnabled: T().optional(),
    lastWorkspaceSession: D(Zh).optional(),
    lastActiveTabIndex: w().int().nonnegative().optional(),
    lastActiveTaskByWorkspace: j(S(), S()).optional(),
    dataBaseDir: S().trim().min(1).optional(),
    pendingPostUpdateReleaseNotes: Jh.optional(),
    receivePreviewUpdates: T().optional(),
    autoDownloadAndInstallUpdates: T().optional(),
    skippedElectronUpdateVersions: Zs(Hh, G).optional(),
    settingsSyncFirstRunPromptHandled: T().optional(),
    webRemoteControlExternalRelayDevice: Qh.optional(),
    webRemoteControlLastEnabledContext: $h.optional(),
    zcodeEndpointOrigin: eg.optional(),
  }));
var dg = M([
    `default`,
    `yolo`,
    `plan`,
    `edit`,
    `acceptEdits`,
    `auto`,
    `dontAsk`,
    `bypassPermissions`,
    `autoEdit`,
    `build`,
  ]),
  fg = [
    ...Object.values({
      authorization: `Authorization`,
      codingPlanAuthorization: `X-Bigmodel-Authorization`,
      targetType: `Bigmodel-Target-Type`,
      organization: `Bigmodel-Organization`,
      project: `Bigmodel-Project`,
    }).map((e) => e.toLowerCase()),
    `x-coding-plan-api-key`,
    `mcp-session-id`,
    `mcp-protocol-version`,
  ];
new Set(fg);
var pg = [
    ...[`official_auth_unavailable`, `official_auth_plan_required`],
    `official_mcp_origin_untrusted`,
  ],
  mg = [
    `renderer_prepare`,
    `command_admission`,
    `execution_wait`,
    `request_prepare`,
    `model_request`,
    `output_return`,
  ],
  hg = [`context`, `hooks`, `persistence`, `compaction`, `mcp`, `tools`, `request_assembly`],
  gg = w().finite().nonnegative(),
  _g = O({
    id: S().min(1).max(128),
    stage: M([...hg, `attempt`, `retry_wait`, `user_confirmation`]),
    start: gg,
    end: gg.optional(),
    outcome: M([`completed`, `failed`, `cancelled`, `first_output`]).optional(),
    requestId: S().min(1).max(128).optional(),
    logicalCallId: S().min(1).max(128).optional(),
    role: M([`response`, `preparation`]).optional(),
    source: M([`renderer`, `cli`]),
  })
    .strict()
    .refine((e) => e.end === void 0 || e.end >= e.start),
  vg = w().finite().nonnegative(),
  K = S().min(1).max(128),
  yg = O({ version: N(1), observationId: S().uuid() }).strict(),
  bg = O({ instanceId: K, receivedAt: vg, sentAt: vg }).strict();
function xg(e, t, n) {
  let r = t - e - (n.sentAt - n.receivedAt);
  if (
    !(
      ![e, t, n.receivedAt, n.sentAt].every(Number.isFinite) ||
      t < e ||
      n.sentAt < n.receivedAt ||
      r < 0 ||
      r / 2 > 10
    )
  )
    return {
      instanceId: n.instanceId,
      offsetMs: (e + t - n.receivedAt - n.sentAt) / 2,
      errorMs: r / 2,
      measuredAt: t,
    };
}
var Sg = M([`text`, `reasoning`, `tool`]),
  Cg = O({
    ...yg.shape,
    instanceId: K,
    commandId: K,
    sessionId: K.optional(),
    turnId: K.optional(),
    productTurnId: K.optional(),
    queryId: K.optional(),
    requestId: K.optional(),
    logicalCallId: K.optional(),
    cliVersion: K.optional(),
    provider: K.optional(),
    model: K.optional(),
    details: D(_g).max(64).optional(),
    truncated: T().optional(),
    revision: w().int().nonnegative().optional(),
    sendMode: M([`idle`, `queued`, `guided`]).optional(),
    clockInvalid: T().optional(),
    receivedAt: vg,
    admittedAt: vg.optional(),
    executionAt: vg.optional(),
    requestAt: vg.optional(),
    outputAt: vg.optional(),
    outputKind: Sg.optional(),
    terminal: M([`completed`, `failed`, `cancelled`, `rejected`, `interrupted`]).optional(),
    excluded: M([`busy`, `retry`, `unsupported`, `failed`, `capacity`]).optional(),
  }).strict(),
  wg = O({ stage: M(mg), start: vg, end: vg, source: M([`renderer`, `cli`, `aligned`]) })
    .strict()
    .refine((e) => e.end >= e.start),
  Tg = O({
    version: N(1),
    observationId: S().uuid(),
    commandId: K.optional(),
    sessionId: K.optional(),
    turnId: K.optional(),
    productTurnId: K.optional(),
    queryId: K.optional(),
    requestId: K.optional(),
    logicalCallId: K.optional(),
    cliVersion: K.optional(),
    cliInstanceId: K.optional(),
    kind: M([`start`, `first_output`, `first_text`, `no_text`, `excluded`, `checkpoint`]),
    outcome: M([
      `success`,
      `busy`,
      `retry`,
      `unsupported`,
      `failed`,
      `cancelled`,
      `background`,
      `expired`,
      `capacity`,
      `recovery`,
      `resync`,
      `clock_invalid`,
      `rejected`,
      `interrupted`,
      `guided`,
      `unclosed`,
    ]),
    start: vg,
    end: vg,
    firstOutputKind: Sg.optional(),
    quality: M([`complete`, `missing`, `clock_invalid`]),
    clockErrorMs: vg.optional(),
    intervals: D(wg).max(6),
    checkpointId: K.optional(),
    details: D(_g).max(64).optional(),
    truncated: T().optional(),
    sendMode: M([`idle`, `queued`, `guided`]).optional(),
    visibility: M([`foreground`, `background`, `background_returned`]).optional(),
    visibilityChanges: D(O({ at: vg, foreground: T() }).strict())
      .max(32)
      .optional(),
    userWaitMs: vg.optional(),
    executionMs: vg.optional(),
    timingReliable: T().optional(),
    cliTimingReliable: T().optional(),
    provider: K.optional(),
    model: K.optional(),
  })
    .strict()
    .refine((e) => e.end >= e.start);
O({
  version: N(1),
  rendererInstanceId: K,
  sequence: w().int().nonnegative(),
  records: D(Tg).max(32),
  dropped: w().int().nonnegative(),
}).strict();
function Eg() {
  return performance.timeOrigin + performance.now();
}
var Dg = `ZCode Protocol`;
O({ independentPlanState: T().optional() });
var q = S().trim().min(1),
  J = j(S(), E()),
  Og = w().int().nonnegative(),
  kg = k([Og, q, Hs()]),
  Ag = O({
    kind: N(`node_repl_images`),
    images: D(
      O({
        base64: S()
          .min(1)
          .max(200 * 1024),
        mimeType: S().regex(/^image\/[a-z0-9.+-]+$/iu),
      }).strict(),
    )
      .min(1)
      .max(2),
    truncated: T().optional(),
    source: N(`browser_turn_end`).optional(),
  }).strict(),
  jg = O({ head: S().min(1).max(128).optional(), tail: S().min(1).max(128).optional() }).strict(),
  Mg = O({ from: S().min(1).max(64), to: S().min(1).max(64), back: N(!0).optional() }).strict(),
  Ng = O({
    steps: D(
      O({
        id: S().min(1).max(64),
        kind: M([`ask`, `world-read`]),
        label: S().min(1).max(128),
        labelPattern: jg.optional(),
        line: w().int().positive().optional(),
        column: w().int().positive().optional(),
        lane: S().min(1).max(64),
        lanes: D(S().min(1).max(64)).max(32).optional(),
        source: S().min(1).max(64).optional(),
        phase: S().min(1).max(64).optional(),
        repeat: M([`stack`, `serial`]).optional(),
      }).strict(),
    ).max(64),
    lanes: D(
      O({
        id: S().min(1).max(64),
        name: S().min(1).max(128).optional(),
        namePattern: jg.optional(),
        line: w().int().positive().optional(),
        column: w().int().positive().optional(),
      }).strict(),
    ).max(32),
    participants: D(
      O({
        id: S().min(1).max(64),
        phase: S().min(1).max(64),
        lane: S().min(1).max(64),
        steps: D(S().min(1).max(64)).min(1).max(64),
        member: O({ index: w().int().nonnegative(), of: w().int().positive() }).strict().optional(),
        many: N(!0).optional(),
      }).strict(),
    ).max(64),
    handoffs: D(Mg.extend({ types: D(S().min(1).max(128)).min(1).max(8).optional() }).strict()).max(
      256,
    ),
    phases: D(
      O({
        id: S().min(1).max(64),
        name: S().min(1).max(128).optional(),
        line: w().int().positive().optional(),
        column: w().int().positive().optional(),
        alongside: D(S().min(1).max(64)).min(1).max(32).optional(),
      }).strict(),
    )
      .max(32)
      .optional(),
    phaseEdges: D(Mg).max(128).optional(),
    exits: D(S().min(1).max(64)).max(32).optional(),
    sink: D(S().min(1).max(64)).max(64).optional(),
    truncated: T().optional(),
  }).strict(),
  Pg = O({
    kind: N(`create_workflow`),
    ok: T(),
    errorCount: w().int().nonnegative(),
    diagnostics: D(
      O({
        line: w().int().nonnegative(),
        column: w().int().nonnegative(),
        code: w().int().nonnegative(),
        message: S().min(1).max(2048),
      }).strict(),
    ).max(100),
    causalityGraph: Ng.optional(),
    truncated: T().optional(),
  }).strict(),
  Fg = J.superRefine((e, t) => {
    let n = e.display;
    if (typeof n != `object` || !n || Array.isArray(n)) return;
    let r = n.kind,
      i =
        typeof r == `string`
          ? { node_repl_images: Ag, create_workflow: Pg, bash_output: Ru }[r]
          : void 0;
    if (!i) return;
    let a = i.safeParse(n);
    if (!a.success)
      for (let e of a.error.issues) t.addIssue({ ...e, path: [`display`, ...e.path] });
  }),
  Ig = k([S(), w().int()]),
  Lg = O({
    traceId: q.optional(),
    parentId: q.optional(),
    spanId: q.optional(),
    traceparent: q.optional(),
  }).strict();
k([
  O({ id: Ig, method: q, params: E().optional(), trace: Lg.optional() }).strict(),
  O({ method: q, params: E().optional(), trace: Lg.optional() }).strict(),
  O({ id: Ig, result: E() }).strict(),
  O({ id: Ig, error: O({ code: w().int(), message: q, data: E().optional() }).strict() }).strict(),
]);
var Rg = O({
    schemaVersion: N(1),
    attemptId: S().min(1).max(128),
    sequence: w().int().positive(),
    databaseId: S().min(1).max(128),
    databaseKind: M([`session`, `tasks-index`]),
    phase: M([`checking`, `waiting_for_lock`, `migrating`, `committing`, `ready`, `failed`]),
    migration: xl.optional(),
    elapsedMs: w().nonnegative().finite(),
    completed: w().int().nonnegative().optional(),
    total: w().int().nonnegative().optional(),
    errorCode: gl.optional(),
    ..._l.shape,
  })
    .strict()
    .superRefine((e, t) => {
      e.phase === `failed` &&
        !e.errorCode &&
        t.addIssue({ code: `custom`, message: `failed requires errorCode` });
    }),
  zg = M([
    `aix`,
    `android`,
    `darwin`,
    `freebsd`,
    `haiku`,
    `linux`,
    `netbsd`,
    `openbsd`,
    `sunos`,
    `win32`,
    `cygwin`,
  ]),
  Bg = M([
    `arm`,
    `arm64`,
    `ia32`,
    `loong64`,
    `mips`,
    `mipsel`,
    `ppc`,
    `ppc64`,
    `riscv64`,
    `s390`,
    `s390x`,
    `x64`,
  ]),
  Vg = O({ arch: Bg, occurredAt: w().int().nonnegative(), platform: zg }).strict(),
  Hg = {
    mcpId: S().regex(
      /^(?:builtin:(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+(?::(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+)*|(?:plugin|custom):[a-f0-9]{12})$/,
    ),
    mcpInstanceId: q,
    mcpIsolation: M([`session`, `workspace`]),
    mcpSource: M([`builtin`, `plugin`, `custom`]),
  },
  Ug = A(`kind`, [
    Vg.extend({ kind: N(`process_start`), ...Hg }).strict(),
    Vg.extend({
      kind: N(`process_crash`),
      ...Hg,
      affectedSessionCount: w().int().nonnegative().max(1e4),
      exitCode: w().int().nullable(),
      signal: q.nullable(),
      uptimeMs: w()
        .finite()
        .nonnegative()
        .max(2 ** 53 - 1),
    }).strict(),
    Vg.extend({
      kind: N(`session_startup`),
      configuredCount: w().int().nonnegative().max(1e4),
      connectedCount: w().int().nonnegative().max(1e4),
      failedCount: w().int().nonnegative().max(1e4),
      processCount: w().int().nonnegative().max(1e4),
      sessionId: q,
    }).strict(),
    Vg.extend({
      kind: N(`memory`),
      ...Hg,
      memoryKb: w()
        .finite()
        .nonnegative()
        .max(2 ** 53 - 1),
      memoryScope: M([`process_tree`, `direct_process`]),
      orphanSuspected: T(),
      ownerSessionCount: w().int().nonnegative().max(1e4),
      unownedSeconds: w()
        .finite()
        .nonnegative()
        .max(2 ** 53 - 1),
    }).strict(),
  ]),
  Wg = D(
    O({
      mcpId: Hg.mcpId,
      instanceToken: S().regex(/^[A-Za-z0-9_-]{8,64}$/),
      sampledAt: w().int().nonnegative(),
      intervalMs: w().finite().positive(),
      processCount: w().int().positive().max(1e5),
      rssKbTotal: w()
        .finite()
        .nonnegative()
        .max(2 ** 53 - 1),
      rssKbMaxProcess: w()
        .finite()
        .nonnegative()
        .max(2 ** 53 - 1),
      cpuTimeMsDelta: w()
        .finite()
        .nonnegative()
        .max(2 ** 53 - 1),
      uptimeMinutes: w().int().nonnegative(),
      platform: zg,
      arch: Bg,
      logicalCpuCount: w().int().positive().max(4096),
      totalMemoryGb: w().int().nonnegative().max(1048576),
    }).strict(),
  ).max(1024),
  Gg = O({
    completionToken: S().uuid().optional(),
    platform: zg,
    toolName: N(`bash`),
    durationMs: w().finite().min(15e3),
    exitKind: M([`completed`, `timeout`, `killed`, `error`]),
    treeRssKbPeak: w().finite().nonnegative().optional(),
    treeCpuTimeMs: w().finite().nonnegative().optional(),
    sampleCount: w().int().nonnegative().max(20),
    cliRssKb: w().finite().nonnegative(),
    systemFreeMemoryKb: w().finite().nonnegative(),
  }).strict(),
  Kg = O({
    platform: M([
      `aix`,
      `android`,
      `darwin`,
      `freebsd`,
      `haiku`,
      `linux`,
      `netbsd`,
      `openbsd`,
      `sunos`,
      `win32`,
      `cygwin`,
    ]),
    arch: M([
      `arm`,
      `arm64`,
      `ia32`,
      `loong64`,
      `mips`,
      `mipsel`,
      `ppc`,
      `ppc64`,
      `riscv64`,
      `s390`,
      `s390x`,
      `x64`,
    ]),
    logicalCpuCount: w().int().positive().max(4096),
    intervalMs: w()
      .int()
      .positive()
      .max(10080 * 60 * 1e3),
    cpuCores: w().finite().nonnegative().max(4096),
    cpuPercent: w().finite().nonnegative().max(1e5),
    rssKb: w()
      .finite()
      .nonnegative()
      .max(2 ** 53 - 1),
    heapUsedKb: w()
      .finite()
      .nonnegative()
      .max(2 ** 53 - 1)
      .optional(),
    uptimeMinutes: w()
      .int()
      .nonnegative()
      .max(10 * 365 * 24 * 60)
      .optional(),
    totalMemoryGb: w().int().nonnegative().max(1048576).optional(),
    instanceToken: S()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .optional(),
  }).strict();
(O({}).strict(),
  O({
    processes: D(
      O({
        pid: w().int().positive(),
        serverName: q,
        mcpSource: M([`builtin`, `plugin`, `custom`]),
        pluginName: q.optional(),
      }).strict(),
    ).max(1e4),
  }).strict());
var qg = od,
  Jg = M([`immediate`, `deferred`]),
  Yg = O({ optionId: q, kind: q, name: q, description: S().optional(), response: pd }).strict(),
  Xg = O({ name: q, value: S() }).strict(),
  Zg = k([
    O({
      type: N(`client_credentials`),
      clientId: q,
      clientSecret: q,
      clientName: q.optional(),
      scope: S().optional(),
    }).strict(),
    O({
      type: N(`authorization_code`),
      clientId: q.optional(),
      clientSecret: q.optional(),
      clientName: q.optional(),
      redirectPath: q.optional(),
      scope: S().optional(),
    }).strict(),
  ]),
  Qg = k([
    O({
      name: q,
      command: q,
      args: D(S()),
      env: D(Xg),
      isolation: M([`session`, `workspace`]).optional(),
      protocolVersion: M([`legacy`, `auto`, `2026-07-28`]).optional(),
      timeoutMs: w().int().positive().optional(),
    }).strict(),
    O({
      name: q,
      type: M([`http`, `sse`]),
      url: q,
      headers: D(Xg),
      oauth: Zg.optional(),
      isolation: M([`session`, `workspace`]).optional(),
      protocolVersion: M([`legacy`, `auto`, `2026-07-28`]).optional(),
      timeoutMs: w().int().positive().optional(),
    }).strict(),
  ]),
  $g = M([`connecting`, `connected`, `disabled`, `disconnected`, `failed`, `untrusted`]),
  e_ = M([
    `config_invalid`,
    `runtime_unavailable`,
    `process_start_failed`,
    `network_unreachable`,
    `connection_timeout`,
    `protocol_negotiation_failed`,
    `tool_list_failed`,
    `unexpected_disconnect`,
    `oauth_authorization_failed`,
    `official_origin_untrusted`,
    `not_authenticated`,
    `coding_plan_required`,
    `server_not_found`,
    `server_unavailable`,
    `rate_limited`,
    `server_internal_error`,
    `protocol_error`,
    `status_unavailable`,
    `connection_failed`,
  ]),
  t_ = O({
    status: $g,
    transport: M([`stdio`, `http`, `sse`]),
    toolCount: w().int().nonnegative(),
    updatedAt: q,
    error: S().optional(),
    failureKind: e_.optional(),
    serverRequestId: q.optional(),
    protocolEra: M([`legacy`, `modern`]).optional(),
    authorization: O({ type: N(`oauth_authorization_code`), authorizationUrl: q, startedAt: q })
      .strict()
      .optional(),
  }).strict(),
  n_ = M([`connect`, `status`]);
(O({ workspace: B, mcpServers: D(Qg).optional(), mode: n_.default(`connect`) }).strict(),
  O({ statuses: j(S(), t_) }).strict());
var r_ = O({ role: M([`user`, `assistant`]), content: S(), timestamp: Og.optional() }).strict(),
  i_ = A(`source`, [
    O({
      source: N(`claudeCode`),
      title: S().optional(),
      createdAt: Og.optional(),
      updatedAt: Og.optional(),
      messages: D(r_).min(1),
    }).strict(),
    O({
      source: N(`sharedContext`),
      title: S().trim().min(1),
      createdAt: Og.optional(),
      markdown: S().min(1),
      provenance: O({
        shareId: S().trim().min(1),
        contextId: S().trim().min(1).optional(),
        shareUrl: S().url().optional(),
        status: M([`pending`, `reserved`, `attached`, `discarded`]).optional(),
        projectionSha256: S().regex(/^[0-9a-f]{64}$/u),
        artifactSetSha256: S().regex(/^[0-9a-f]{64}$/u),
        formatterVersion: N(1),
        markdownSha256: S().regex(/^[0-9a-f]{64}$/u),
        installedArtifacts: D(
          O({ artifactId: S().trim().min(1), workspaceRelativePath: S().trim().min(1) }).strict(),
        ),
      }).strict(),
    }).strict(),
  ]),
  a_ = O({ value: q, label: q, description: S().optional() }).strict(),
  o_ = O({ levels: D(a_), defaultLevel: q.optional() }).strict(),
  s_ = km.pick({ inputFormat: !0, outputFormat: !0 }),
  c_ = O({
    ref: I,
    label: q,
    providerLabel: q.optional(),
    description: S().optional(),
    contextWindow: w().int().positive().optional(),
    maxOutputTokens: w().int().positive().optional(),
    reasoning: o_.optional(),
    properties: s_,
    disabledReason: S().optional(),
  }).strict();
A(`planKind`, [
  O({
    type: N(`zhipu-account`),
    family: M([`zai`, `bigmodel`]),
    planKind: N(`start-plan`),
  }).strict(),
  O({
    type: N(`zhipu-account`),
    family: M([`zai`, `bigmodel`]),
    planKind: N(`individual-coding-plan`),
  }).strict(),
  O({
    type: N(`zhipu-account`),
    family: M([`zai`, `bigmodel`]),
    planKind: N(`team-coding-plan`),
    productId: q,
    organizationId: q,
    projectId: q,
  }).strict(),
]);
var l_ = O({
    type: N(`zhipu-account`),
    accountType: M([`zai`, `bigmodel`]),
    mode: M([`start-plan`, `individual-coding-plan`, `team-coding-plan`, `off-peak`]),
    entitled: T(),
  }).strict(),
  u_ = O({
    content: q,
    status: M([`pending`, `in_progress`, `completed`]),
    priority: M([`high`, `medium`, `low`]),
  }).strict(),
  d_ = O({
    timeUsedSeconds: w().int().nonnegative(),
    tokensUsed: w().int().nonnegative(),
    tokenBudget: w().int().positive().nullable(),
    contextUsed: w().int().nonnegative(),
    contextWindow: w().int().nonnegative(),
    toolCallCount: w().int().nonnegative(),
    iterationCount: w().int().nonnegative(),
  }).strict(),
  f_ = O({
    id: q,
    source: M([`goal_iteration`, `session`]),
    goalIteration: w().int().positive().optional(),
    targetId: q.optional(),
    startedAt: Og.optional(),
    updatedAt: Og.optional(),
    todos: D(u_),
  }).strict(),
  p_ = O({
    model: O({ current: I.optional(), available: D(c_), lastUsed: I.optional() }).strict(),
    thoughtLevel: O({
      enabled: T(),
      current: q.optional(),
      defaultLevel: q.optional(),
      available: D(a_),
    }).strict(),
    mode: O({ current: md }).strict(),
    permission: O({ mode: md.optional(), rulesRevision: w().int().nonnegative().optional() })
      .strict()
      .optional(),
  }).strict(),
  m_ = O({
    requestId: q,
    toolCallId: q,
    toolName: q,
    reason: S(),
    riskLevel: M([`low`, `medium`, `high`, `critical`]),
    input: E().optional(),
    origin: xd.optional(),
    options: D(Yg).min(1),
    requestedAt: Og,
  }).strict(),
  h_ = O({
    toolCallId: q,
    toolName: q,
    status: M([`pending`, `running`, `completed`, `failed`, `denied`]),
    startedAt: Og.optional(),
  }).strict(),
  g_ = O({
    sessionId: q,
    status: hd,
    mode: md,
    turnCount: w().int().nonnegative(),
    totalTokenCount: w().int().nonnegative(),
    contextUsed: w().int().nonnegative(),
    contextWindow: w().int().nonnegative(),
    currentTurnId: q.optional(),
    pendingPermissions: D(m_),
    activeToolCalls: D(h_),
    backgroundJobs: D(J),
    target: _d.nullable().optional(),
    lastError: O({
      type: q,
      code: q.optional(),
      message: q,
      detail: S().optional(),
      attribution: fp.optional(),
    })
      .strict()
      .optional(),
  }).strict(),
  __ = O({
    name: q,
    description: S(),
    inputHint: S().optional(),
    source: M([`builtin`, `custom`]).optional(),
  }).strict(),
  v_ = M([
    `start`,
    `finish`,
    `error`,
    `text_start`,
    `text_delta`,
    `text_end`,
    `reasoning_start`,
    `reasoning_delta`,
    `reasoning_end`,
    `tool_input_start`,
    `tool_input_delta`,
    `tool_input_end`,
    `tool_call`,
  ]),
  y_ = O({
    assistantMessageId: S().optional(),
    delta: S().optional(),
    done: T().optional(),
    input: E().optional(),
    kind: v_,
    partId: S().optional(),
    providerExecuted: T().optional(),
    toolCallId: S().optional(),
    toolName: S().optional(),
  }).strict(),
  b_ = O({
    protocol: O({ name: N(Dg), version: N(1) }).strict(),
    session: bd,
    settings: p_,
    projection: g_,
    runtime: Ld,
    messages: D(Md),
    goalStats: d_.optional(),
    todos: D(u_).optional(),
    todoGroups: D(f_).optional(),
    slashCommands: D(__).optional(),
  }).strict(),
  x_ = O({
    eventId: q,
    sessionId: q,
    turnId: q.optional(),
    seq: w().int().nonnegative(),
    traceId: q.optional(),
    timestamp: Og,
    deliveryKind: id.optional(),
  }).strict(),
  S_ = O({
    eventId: q,
    sequenceNumber: w().int().nonnegative(),
    sessionId: q,
    timestamp: Og,
  }).strict();
(A(`kind`, [
  S_.extend({ kind: N(`turn-started`), turnId: q }),
  S_.extend({ kind: N(`turn-completed`), turnId: q }),
  S_.extend({ kind: N(`turn-failed`), turnId: q }),
  S_.extend({
    kind: N(`tool-scheduled`),
    turnId: q,
    toolCallId: q,
    toolName: q,
    computerUse: N(!0).optional(),
  }),
  S_.extend({
    kind: N(`tool-started`),
    turnId: q.optional(),
    toolCallId: q,
    toolName: q.optional(),
  }),
  S_.extend({ kind: N(`session-closed`) }),
]),
  M([
    `session.created`,
    `session.resumed`,
    `session.updated`,
    `session.titleUpdated`,
    `session.closed`,
    `turn.started`,
    `turn.steerQueued`,
    `turn.steerDrained`,
    `turn.completed`,
    `turn.failed`,
    `message.upserted`,
    `message.removed`,
    `part.started`,
    `part.delta`,
    `part.upserted`,
    `part.removed`,
    `model.streaming`,
    `tool.updated`,
    `permission.requested`,
    `permission.resolved`,
    `userInput.requested`,
    `userInput.resolved`,
    `checkpoint.created`,
    `rewind.triggered`,
    `streamRecovery.updated`,
  ]));
var C_ = O({
    type: q,
    message: q,
    stack: S().optional(),
    code: S().optional(),
    detail: S().optional(),
    underlyingErrorMessage: S().optional(),
    underlyingErrorDetail: S().optional(),
    attribution: fp.optional(),
    retryable: T().optional(),
    data: E().optional(),
  }).strict(),
  w_ = O({ mode: md, contextWindow: w().int().nonnegative() }).strict(),
  T_ = O({
    directory: q,
    interruptedToolCount: w().int().nonnegative(),
    messageCount: w().int().nonnegative(),
    partCount: w().int().nonnegative(),
    recoveredCompactTimelineCount: w().int().nonnegative().optional(),
    recoveredSteerInputCount: w().int().nonnegative().optional(),
    resumedTodoCount: w().int().nonnegative().optional(),
  }).strict(),
  E_ = O({
    messageID: q.optional(),
    previousTitle: S(),
    source: M([`default`, `first_input`, `generated`, `custom`]),
    title: S(),
  }).strict(),
  D_ = O({
    turnNumber: w().int().nonnegative(),
    input: S(),
    inputId: q.optional(),
    queryId: q.optional(),
    inputSource: qg.optional(),
    inputVisibility: ad.optional(),
    executionKind: M([`agent`, `controlOnly`]).optional(),
    targetId: q.optional(),
    messageId: q.optional(),
    foregroundExecutionId: q.optional(),
    intent: J.optional(),
    originMeta: J.optional(),
    backgroundSource: M([`bash`, `subagent`]).optional(),
    attachments: D(J).optional(),
  }).strict(),
  O_ = M([`plan_approval_feedback`, `workflow_refine_feedback`]),
  k_ = M([`sendText`, `sendGoalCommand`, `compact`]),
  A_ = M([`queue`, `guide`]),
  j_ = O({
    pendingInputId: q,
    inputId: q.optional(),
    queryId: q.optional(),
    input: S(),
    inputPreview: S(),
    inputSize: w().int().nonnegative(),
    commandKind: k_.optional(),
    source: O_.optional(),
    toolDisallowlist: D(q).optional(),
    delivery: A_.optional(),
    targetTurnId: q,
    queueLength: w().int().nonnegative(),
    intent: J.optional(),
  }).strict(),
  M_ = O({
    pendingInputIds: D(q),
    queryIds: D(q).optional(),
    targetTurnId: q,
    injectedMessageIds: D(q),
    drainedInputs: D(
      O({
        pendingInputId: q,
        messageId: q,
        text: S(),
        delivery: A_.optional(),
        intent: J.optional(),
        toolDisallowlist: D(q).optional(),
      }).strict(),
    ).optional(),
  }).strict(),
  N_ = O({
    response: S(),
    tokenCount: w().int().nonnegative(),
    usage: E().optional(),
    toolCallCount: w().int().nonnegative(),
    historyRoundCount: w().int().nonnegative().optional(),
    duration: w().nonnegative(),
    cacheStats: O({
      totalMessages: w().int().nonnegative(),
      cachedMessages: w().int().nonnegative(),
      lastCacheHit: T(),
      cacheReadTokens: w().int().nonnegative().optional(),
    })
      .strict()
      .optional(),
    inputId: q.optional(),
    resultType: M([
      `success`,
      `cancelled`,
      `error_max_turns`,
      `error_max_budget`,
      `error_during_execution`,
      `error_max_tool_calls`,
    ]),
    backgroundSubagentResultConsumed: T().optional(),
  }).strict(),
  P_ = O({
    error: C_,
    turnPhase: S(),
    inputId: q.optional(),
    backgroundSubagentResultConsumed: T().optional(),
  }).strict(),
  F_ = O({
    content: S(),
    attachments: D(E()).optional(),
    toolCalls: D(E()).optional(),
    type: S().optional(),
    compactBoundary: E().optional(),
  }).strict(),
  I_ = O({ messageId: q, reason: S().optional() }).strict(),
  L_ = O({
    messageId: q,
    partId: q,
    field: M([`text`, `reasoning`, `input`, `output`]).optional(),
    delta: S(),
  }).strict(),
  R_ = O({ part: jd }).strict(),
  z_ = O({ messageId: q, partId: q, reason: S().optional() }).strict(),
  B_ = O({
    toolCallId: q,
    toolName: S().optional(),
    parentToolCallId: q.optional(),
    source: M([`subagent`]).optional(),
    agentId: q.optional(),
    agentType: q.optional(),
    background: T().optional(),
    childSessionId: q.optional(),
    childToolCallId: q.optional(),
    description: S().optional(),
  }).strict(),
  V_ = A(`kind`, [
    B_.extend({
      kind: N(`scheduled`),
      assistantMessageId: q.optional(),
      toolName: q,
      input: E().optional(),
      inputByteLength: w().int().nonnegative().optional(),
      inputOmitted: T().optional(),
      inputRef: N(`model_stream`).optional(),
      dependencies: D(q).optional(),
      parallelGroupIndex: w().int().nonnegative().optional(),
      canRunParallel: T().optional(),
      schedule: J.optional(),
    }).strict(),
    B_.extend({ kind: N(`started`), startedAt: kg }).strict(),
    B_.extend({
      kind: N(`progress`),
      elapsedMs: w().nonnegative().optional(),
      pid: w().int().optional(),
      stdoutBytes: w().int().nonnegative().optional(),
      stderrBytes: w().int().nonnegative().optional(),
      outputBytes: w().int().nonnegative().optional(),
      outputPreview: Bu.optional(),
      stdoutTail: S().optional(),
      stderrTail: S().optional(),
    }).strict(),
    B_.extend({ kind: N(`result`), result: Fg, duration: w().nonnegative() }).strict(),
    B_.extend({ kind: N(`error`), error: C_ }).strict(),
    O({
      kind: N(`batch`),
      toolCallIds: D(q),
      successCount: w().int().nonnegative(),
      errorCount: w().int().nonnegative(),
    }).strict(),
    B_.extend({ kind: N(`raw`), payload: J }).strict(),
  ]),
  H_ = O({
    requestId: q.optional(),
    toolCallId: q,
    toolName: q,
    riskLevel: M([`low`, `medium`, `high`, `critical`]),
    reason: S(),
    input: E(),
    suggestedPermissionUpdates: D(fd).optional(),
    origin: xd.optional(),
    options: D(Yg).min(1),
    childSessionId: q.optional(),
    background: T().optional(),
  }).strict(),
  U_ = O({
    requestId: q.optional(),
    toolCallId: q,
    toolName: q.optional(),
    decision: sd.optional(),
    reason: S().optional(),
    modifiedInput: E().optional(),
    inputSummary: E().optional(),
    childSessionId: q.optional(),
    background: T().optional(),
  }).strict(),
  W_ = O({
    requestId: q,
    prompt: S(),
    inputType: M([`text`, `choice`, `confirm`]).optional(),
    choices: D(S()).optional(),
  }).strict(),
  G_ = O({ requestId: q, value: E().optional(), cancelled: T().optional() }).strict(),
  K_ = O({ reason: S().optional() }).strict();
function Y(e, t) {
  return x_.extend({ type: N(e), payload: t.optional() });
}
var q_ = A(`type`, [
  Y(`session.created`, w_),
  Y(`session.resumed`, T_),
  Y(`session.updated`, J),
  Y(`session.titleUpdated`, E_),
  Y(`session.closed`, K_),
  Y(`turn.started`, D_),
  Y(`turn.steerQueued`, j_),
  Y(`turn.steerDrained`, M_),
  Y(`turn.completed`, N_),
  Y(`turn.failed`, P_),
  Y(`message.upserted`, F_),
  Y(`message.removed`, I_),
  Y(`part.started`, R_),
  Y(`part.delta`, L_),
  Y(`part.upserted`, R_),
  Y(`part.removed`, z_),
  Y(`model.streaming`, y_),
  Y(`tool.updated`, V_),
  Y(`permission.requested`, H_),
  Y(`permission.resolved`, U_),
  Y(`userInput.requested`, W_),
  Y(`userInput.resolved`, G_),
  Y(`checkpoint.created`, J),
  Y(`rewind.triggered`, J),
  Y(`streamRecovery.updated`, J),
]);
(O({ events: D(q_) }).strict(),
  O({ messages: D(Md) }).strict(),
  O({
    type: N(`state.updated`),
    scope: M([`server`, `workspace`, `session`]),
    workspace: B.optional(),
    sessionId: q.optional(),
    revision: w().int().nonnegative(),
    reason: S().optional(),
    patch: E(),
  }).strict(),
  O({
    sessionId: q,
    deliveryKind: id,
    afterSeq: w().int().nonnegative().optional(),
    includeSnapshot: T().default(!1),
  }).strict(),
  O({
    sessionId: q,
    eventSeq: w().int().nonnegative(),
    events: D(q_),
    snapshot: b_.optional(),
  }).strict(),
  O({ sessions: D(bd) }).strict());
var J_ = O({
    childSessionId: q,
    agentId: q.optional(),
    toolCallId: q.optional(),
    subagentType: q,
    title: q,
    summary: S().optional(),
    startedAt: w().int().nonnegative().optional(),
    endedAt: w().int().nonnegative().optional(),
  }).strict(),
  Y_ = J_.extend({ status: M([`running`, `waiting`, `blocked`]) }),
  X_ = J_.extend({ status: M([`success`, `failed`, `cancelled`, `lost`]) });
(O({
  revision: w().int().nonnegative(),
  childSessionIds: D(q),
  running: D(Y_),
  ended: O({ total: w().int().nonnegative(), items: D(X_), nextCursor: q.optional() }).strict(),
}).strict(),
  O({
    sessionId: q.optional(),
    workspace: B,
    parentSessionId: q.optional(),
    mode: md.optional(),
    model: I.optional(),
    persistence: Jg.optional(),
    thoughtLevel: q.optional(),
    titleGenerationEnabled: T().optional(),
    mcpServers: D(Qg).optional(),
    toolAllowlist: D(q).optional(),
    toolDenylist: D(q).optional(),
    importedHistory: i_.optional(),
    offPeakToolEnabled: T().optional(),
    dynamicWorkflowEnabled: T().optional(),
  }).strict(),
  O({
    sessionId: q,
    workspace: B.optional(),
    thoughtLevel: q.optional(),
    mcpServers: D(Qg).optional(),
    toolAllowlist: D(q).optional(),
    toolDenylist: D(q).optional(),
    offPeakToolEnabled: T().optional(),
    dynamicWorkflowEnabled: T().optional(),
  }).strict(),
  O({
    workspace: B.optional(),
    sessionIds: D(q).min(1).max(64).optional(),
    includeArchived: T().default(!1),
    limit: w().int().positive().optional(),
  }).strict(),
  O({
    sessionId: q,
    endedCursor: q.optional(),
    endedLimit: w().int().positive().max(100).default(20),
  }).strict(),
  O({ range: M(Lm), timeZone: S().optional() }).strict(),
  O({ sessionId: q }).strict(),
  O({
    sessionId: q,
    totalTokens: w().int().nonnegative(),
    inputTokens: w().int().nonnegative(),
    outputTokens: w().int().nonnegative(),
    reasoningTokens: w().int().nonnegative(),
    cacheCreationTokens: w().int().nonnegative(),
    cacheReadTokens: w().int().nonnegative(),
    modelRequestCount: w().int().nonnegative(),
    modelErrorCount: w().int().nonnegative(),
    inputBaselineBySource: j(S(), w().int().nonnegative()),
  }).strict(),
  O({
    sessionId: q,
    deliveryKind: id.optional(),
    messageLimit: w().int().positive().optional(),
    afterSeq: w().int().nonnegative().optional(),
  }).strict(),
  O({
    sessionId: q,
    afterMessageId: q.optional(),
    limit: w().int().positive().optional(),
  }).strict(),
  O({
    sessionId: q,
    afterSeq: w().int().nonnegative().optional(),
    limit: w().int().positive().optional(),
  }).strict(),
  O({ sessionId: q, scope: M([`runtime-materialization`, `user-execution`]) }).strict());
var Z_ = `preflight-v1`,
  Q_ = M([`legacy`, `preflight-v1`]);
O({
  nativeSearchEnhancementsEnabled: T(),
  memoryEnabled: T().default(!1),
  askUserQuestionAutoResolutionEnabled: T().default(!0),
  integratedTerminalShell: Gh.optional(),
  modelContextBudgetStrategy: Q_.default(Z_),
}).strict();
var $_ = O({
  tabCount: w().int().positive().max(100),
  currentUrl: S().trim().min(1).max(4096).optional(),
}).strict();
(O({
  sessionId: q,
  modelSelection: I.optional(),
  modelExecution: Im.optional(),
  inputId: q.optional(),
  queryId: q.optional(),
  content: S(),
  attachments: D(J).optional(),
  browserAmbientContext: $_.optional(),
  expectedRevision: w().int().nonnegative().optional(),
  expectedProviderRevision: q.optional(),
  automationId: q.optional(),
  offPeakTaskId: q.optional(),
  offPeakRunType: M([`init`, `resume`]).optional(),
  botDeliveryTarget: Qm.optional(),
  toolDenylist: D(q).optional(),
})
  .strict()
  .superRefine((e, t) => {
    (e.automationId &&
      e.offPeakTaskId &&
      t.addIssue({
        code: P.custom,
        message: `automationId and offPeakTaskId are mutually exclusive`,
      }),
      e.offPeakRunType &&
        !e.offPeakTaskId &&
        t.addIssue({
          code: P.custom,
          message: `offPeakRunType requires offPeakTaskId`,
          path: [`offPeakRunType`],
        }),
      e.modelExecution &&
        !e.modelSelection &&
        t.addIssue({
          code: P.custom,
          message: `modelExecution requires modelSelection`,
          path: [`modelExecution`],
        }));
  }),
  O({ sessionId: q, accepted: N(!0), stateRevision: w().int().nonnegative() }).strict(),
  O({
    sessionId: q,
    target: A(`kind`, [
      O({ kind: N(`turn`), turnIndex: w().int().nonnegative() }).strict(),
      O({ kind: N(`message`), messageId: q }).strict(),
      O({ kind: N(`checkpoint`), checkpointId: q }).strict(),
      O({ kind: N(`latestCheckpoint`) }).strict(),
    ]).default({ kind: `latestCheckpoint` }),
    expectedRevision: w().int().nonnegative().optional(),
  }).strict(),
  O({
    forkedSessionId: q,
    parentSessionId: q.optional(),
    targetMessageId: q.optional(),
    targetCheckpointId: q.optional(),
    response: S(),
    snapshot: b_,
  }).strict(),
  O({
    sessionId: q,
    inputId: q.optional(),
    instructions: S().optional(),
    expectedRevision: w().int().nonnegative().optional(),
  }).strict(),
  O({
    response: S(),
    snapshot: b_,
    compact: O({
      state: M([`accepted`, `already_running`]),
      inputId: q.optional(),
      operationId: q.optional(),
    })
      .strict()
      .optional(),
  }).strict());
var ev = M([`show`, `set`, `replace`, `pause`, `resume`, `clear`]);
(O({
  sessionId: q,
  inputId: q.optional(),
  action: ev,
  objective: S().optional(),
  expectedRevision: w().int().nonnegative().optional(),
}).strict(),
  O({ response: S(), snapshot: b_, startedTurn: T().optional() }).strict(),
  O({ sessionId: q }).strict());
var tv = M([`running`, `completed`, `failed`, `timed_out`, `cancelled`, `spawn_error`, `lost`]),
  nv = O({
    taskId: q,
    toolCallId: q.optional(),
    toolName: q.optional(),
    taskKind: M([`bash`, `subagent`]).optional(),
    blocked: T().optional(),
    blockedReason: S().optional(),
    cancellable: T().optional(),
    cancelRequestedAt: kg.optional(),
    command: S().optional(),
    description: S().optional(),
    status: tv,
    pid: w().int().positive().optional(),
    startedAt: kg.optional(),
    completedAt: kg.optional(),
    outputPath: S().optional(),
    stderrPersistedOutputPath: S().optional(),
    stdoutPersistedOutputPath: S().optional(),
    outputBytes: w().int().nonnegative().optional(),
    outputTruncated: T().optional(),
    outputTail: S().optional(),
    stderrBytes: w().int().nonnegative().optional(),
    stderrTail: S().optional(),
    stdoutBytes: w().int().nonnegative().optional(),
    stdoutTail: S().optional(),
    terminalId: q.optional(),
  }).strict();
(O({ sessionId: q, taskId: q }).strict(),
  O({
    cancelled: T(),
    reason: S().optional(),
    snapshot: nv.optional(),
    status: tv,
    taskId: q,
  }).strict(),
  O({
    sessionId: q,
    model: I,
    expectedRevision: w().int().nonnegative().optional(),
    persistAsWorkspaceLastUsed: T().default(!0),
  }).strict(),
  O({
    sessionId: q,
    thoughtLevel: q.optional(),
    expectedRevision: w().int().nonnegative().optional(),
    persistAsWorkspaceLastUsed: T().default(!0),
  }).strict(),
  O({ sessionId: q, mode: md, expectedRevision: w().int().nonnegative().optional() }).strict(),
  O({ sessionId: q, expectedPersistence: Jg.optional() }).strict(),
  O({ closed: T().optional() }).strict(),
  O({ workspace: B }).strict(),
  O({ workspace: B, mode: md, slashCommands: D(__) }).strict());
var rv = S().regex(/^[a-f0-9]{64}$/u);
O({ workspace: B, bundleDigest: rv, hookDeclarationDigest: rv }).strict();
var iv = M([
  `workspace_hooks_blocked_by_policy`,
  `workspace_hooks_bundle_changed`,
  `workspace_hooks_snapshot_mismatch`,
  `workspace_hooks_policy_requires_pretrust`,
  `workspace_hooks_trust_store_corrupt`,
  `workspace_hooks_config_unreadable`,
]);
O({ accepted: T(), reasonCode: iv.optional() }).strict();
var av = O({ id: q, name: q, input: E() }).strict(),
  ov = A(`role`, [
    O({ role: N(`system`), content: S() }).strict(),
    O({ role: N(`user`), content: S() }).strict(),
    O({ role: N(`assistant`), content: S(), toolCalls: D(av).optional() }).strict(),
    O({
      role: N(`tool`),
      content: S(),
      toolCallId: q,
      toolName: q,
      isError: T().optional(),
    }).strict(),
  ]),
  sv = O({ name: q, description: S().optional(), inputSchema: j(S(), E()) }).strict();
(O({
  workspace: B,
  selection: I,
  prompt: q.optional(),
  messages: D(ov).min(1).optional(),
  tools: D(sv).optional(),
  querySource: q,
  maxOutputTokens: w().int().positive().optional(),
  operationId: q.optional(),
})
  .strict()
  .refine((e) => e.prompt !== void 0 || e.messages !== void 0, {
    message: `prompt 或 messages 至少需要提供一个`,
  }),
  O({
    text: S(),
    selection: I,
    toolCalls: D(av).optional(),
    finishReason: S().optional(),
    usage: O({
      inputTokens: w().nonnegative().optional(),
      outputTokens: w().nonnegative().optional(),
      totalTokens: w().nonnegative().optional(),
      cacheReadTokens: w().nonnegative().optional(),
      cacheWriteTokens: w().nonnegative().optional(),
      reasoningTokens: w().nonnegative().optional(),
      serverToolUse: O({
        webSearchRequests: w().nonnegative().optional(),
        webFetchRequests: w().nonnegative().optional(),
      })
        .strict()
        .optional(),
    })
      .strict()
      .optional(),
  }).strict(),
  O({ operationId: q }).strict(),
  O({ operationId: q, cancelled: T() }).strict(),
  O({ workspace: B, selection: I }).strict(),
  O({ success: N(!0) }).strict(),
  O({
    revision: q,
    basedOnZCodeBuiltinRevision: q,
    providers: j(S(), E()),
    states: j(
      S(),
      O({
        availability: M([`available`, `pending`, `unavailable`, `unknown`]),
        entitled: T(),
        unavailableReason: Fm.optional(),
        current: T().optional(),
        connectionKey: S().optional(),
        effectiveAt: w().finite().optional(),
      }).strict(),
    ),
  }).strict(),
  O({
    receivedRevision: q,
    providerCount: w().int().nonnegative(),
    status: M([`received`, `unchanged`]),
  }).strict(),
  O({
    workspace: B,
    preferences: O({ askUserQuestionAutoResolutionEnabled: T() }).strict(),
  }).strict(),
  O({
    workspace: B,
    askUserQuestionAutoResolutionEnabled: T(),
    snoozedInteractionCount: w().int().nonnegative(),
  }).strict(),
  O({ workspace: B, preferences: O({ fullRetentionEnabled: T() }).strict() }).strict(),
  O({
    workspace: B,
    fullRetentionEnabled: T(),
    updatedSessionCount: w().int().nonnegative(),
  }).strict(),
  O({ workspace: B, enabled: T() }).strict(),
  O({ workspace: B, enabled: T() }).strict(),
  O({ workspace: B, enabled: T() }).strict(),
  O({ workspace: B, enabled: T() }).strict(),
  O({
    requestId: q,
    sessionId: q,
    turnId: q.optional(),
    toolCallId: q,
    toolName: q,
    reason: S(),
    riskLevel: M([`low`, `medium`, `high`, `critical`]),
    input: E(),
    origin: xd.optional(),
    options: D(Yg).min(1),
  }).strict(),
  O({
    requestId: q,
    sessionId: q,
    turnId: q.optional(),
    workspaceKey: q,
    workspacePath: q,
    workspaceIdentity: q.optional(),
    remoteSessionId: q.optional(),
    clientMode: Rl,
    sessionContext: ru,
  }).strict(),
  O({
    requestId: q,
    sessionId: q,
    turnId: q.optional(),
    browserId: q.optional(),
    browserGeneration: w().int().nonnegative().optional(),
    workspaceKey: q.optional(),
    workspacePath: q.optional(),
    workspaceIdentity: q.optional(),
    remoteSessionId: q.optional(),
    clientMode: Rl.optional(),
    sessionContext: ru.optional(),
    command: $l,
  }).strict());
var cv = O({
  question: q,
  header: q,
  options: D(
    O({ value: q, label: q, description: S().optional(), preview: S().optional() }).strict(),
  ).min(1),
  multiSelect: T().optional(),
}).strict();
(O({
  requestId: q,
  sessionId: q,
  turnId: q.optional(),
  toolCallId: q.optional(),
  toolName: q.optional(),
  prompt: S().optional(),
  questions: D(cv).min(1).optional(),
  input: E().optional(),
  origin: xd.optional(),
  schema: E().optional(),
}).strict(),
  O({
    action: M([`accept`, `decline`, `cancel`]),
    content: J.optional(),
    reason: S().optional(),
  }).strict());
var lv = M([`model-request`, `captcha-retry`]);
(O({
  requestId: q,
  sessionId: q,
  turnId: q.optional(),
  workspace: B,
  modelSelection: I,
  providerId: q,
  accountAccess: l_.optional(),
  reason: lv,
}).strict(),
  O({ requestId: q, sessionId: q, workspace: B }).strict(),
  A(`headersApplied`, [
    O({
      headersApplied: N(!0),
      requestAuth: O({ apiKey: q.optional(), headers: j(q, q).optional() }).strict(),
      errorMessage: q.optional(),
    }).strict(),
    O({ headersApplied: N(!1), errorMessage: q.optional() }).strict(),
  ]),
  O({ requestId: q, workspace: B, pluginId: q, mcpKey: q, targetOrigin: q }).strict());
var uv = M(pg);
A(`ok`, [O({ ok: N(!0), headers: j(S(), S()) }).strict(), O({ ok: N(!1), reason: uv }).strict()]);
var dv = k([S(), w(), T()]),
  fv = M([`user`, `workspace`]),
  pv = O({
    event: q,
    matcher: S().optional(),
    type: M([`command`, `process`]),
    command: q,
    args: D(S()).optional(),
    async: T().optional(),
    shell: k([N(!0), S()]).optional(),
    timeout: w().positive().optional(),
    timeoutMs: w().int().positive().optional(),
    statusMessage: S().optional(),
    sourcePath: S(),
    runnable: T(),
  }).strict(),
  mv = O({
    default: dv.optional(),
    description: S().optional(),
    required: T().optional(),
    sensitive: T().optional(),
    title: S().optional(),
    type: M([`string`, `number`, `boolean`, `directory`, `file`]).optional(),
  }).strict(),
  hv = O({
    kind: M([`agent`, `command`, `skill`, `hook`, `mcp`]),
    items: D(O({ name: q, description: S().optional() }).strict()),
  }).strict(),
  gv = O({
    id: q,
    name: q,
    description: S().optional(),
    version: S().optional(),
    enabled: T(),
    source: q,
    marketplace: q,
    author: S().optional(),
    authorUrl: S().optional(),
    homepage: S().optional(),
    skillCount: w().int().nonnegative().optional(),
    skillRootCount: w().int().nonnegative(),
    commandRootCount: w().int().nonnegative(),
    components: D(hv).optional(),
    declaredMcpServerNames: D(S()).optional(),
    hostMcpServerNames: D(S()).optional(),
    mcpServerNames: D(S()),
    hookDetails: D(pv).optional(),
    rootPath: S(),
    userConfig: j(S(), mv).optional(),
    configuredOptions: j(S(), dv).optional(),
    packageStatus: N(`missing`).optional(),
    rootSource: fv.optional(),
    enabledSource: fv.optional(),
    optionSources: j(S(), fv).optional(),
  }).strict(),
  _v = O({
    code: S(),
    message: S(),
    severity: M([`warning`, `error`]).optional(),
    pluginId: S().optional(),
  }).strict();
(O({ workspace: B, configScope: fv.optional() }).strict(),
  O({ plugins: D(gv), diagnostics: D(_v) }).strict());
var vv = O({
  category: q.optional(),
  pluginId: q,
  name: q,
  marketplace: q,
  icon: S().optional(),
  displayName: S().optional(),
  displayNameI18n: j(S(), S()).optional(),
  description: S().optional(),
  descriptionI18n: j(S(), S()).optional(),
  enabled: T(),
  conflictingPluginIds: D(q),
  skillQualifiedNames: D(q),
  mcpServerNames: D(q),
  subagentNames: D(q).default([]),
}).strict();
(O({ workspace: B, sessionId: q.optional() }).strict(),
  O({ authority: M([`session`, `workspace`]), plugins: D(vv) }).strict());
var yv = O({
  id: q,
  name: q,
  description: S(),
  path: q,
  scope: M([`workspace`, `user`, `plugin`]),
  enabled: N(!0),
  pluginName: q.optional(),
}).strict();
(O({ workspace: B, sessionId: q.optional() }).strict(),
  O({ authority: M([`session`, `workspace`]), skills: D(yv) }).strict());
var bv = O({
    type: M([`string`, `number`, `boolean`, `json`]),
    description: S().optional(),
    required: T().optional(),
    default: E().optional(),
  }).strict(),
  xv = j(S(), bv),
  Sv = O({ description: q, whenToUse: q.optional(), args: xv.optional() }).strict(),
  Cv = M([`project`, `global`]),
  wv = O({
    name: q,
    description: S(),
    whenToUse: S().optional(),
    args: xv.optional(),
    scope: Cv,
    path: q,
  }).strict(),
  Tv = O({ path: q, reason: q }).strict(),
  Ev = M([`invalid_name`, `not_found`, `parse_error`, `read_error`]),
  Dv = O({ ok: N(!1), reason: Ev, detail: S().optional() }).strict();
(O({ workspace: B, scope: Cv.optional() }).strict(),
  O({ workflows: D(wv), invalid: D(Tv), dir: q }).strict(),
  O({ workspace: B, name: q, scope: Cv.optional() }).strict(),
  k([O({ ok: N(!0), name: q, path: q, scope: Cv, meta: Sv, script: S() }).strict(), Dv]),
  O({ workspace: B, name: q, meta: Sv, scope: Cv.optional() }).strict(),
  k([O({ ok: N(!0), path: q }).strict(), Dv]),
  O({ workspace: B, name: q, scope: Cv.optional() }).strict(),
  k([O({ ok: N(!0), path: q }).strict(), Dv]),
  O({
    workspace: B,
    name: q.optional(),
    limit: w().int().min(1).max(50),
    scope: Cv.optional(),
  }).strict());
var Ov = M([`pending`, `running`, `completed`, `errored`, `stopped`]),
  kv = M([`user`, `model`, `provider`, `interrupted`, `superseded`]);
(O({
  runs: D(
    O({
      runId: q,
      name: S().optional(),
      status: Ov,
      stopReason: kv.optional(),
      createdAt: w(),
      updatedAt: w(),
      spentTokens: w(),
      parentSessionId: S().optional(),
      toolCallId: S().optional(),
      args: j(S(), E()).optional(),
      cwd: S().optional(),
      artifacts: D(
        O({
          id: q,
          kind: M([`file`, `markdown`, `chart`, `table`, `metrics`, `board`]),
          title: S().optional(),
          version: w(),
          contentType: S().optional(),
        }).strict(),
      )
        .max(8)
        .optional(),
    }).strict(),
  ),
  truncated: N(!0).optional(),
}).strict(),
  O({ workspace: B, name: q }).strict(),
  k([
    O({ ok: N(!0), from: q, to: q }).strict(),
    O({
      ok: N(!1),
      reason: M([`invalid_name`, `not_found`, `target_exists`, `read_error`, `write_error`]),
      path: S().optional(),
      detail: S().optional(),
    }).strict(),
  ]));
var Av = M([`ready`, `disabled`, `missing`, `conflict`, `unavailable`]);
(M([
  `checking`,
  `refreshing`,
  `installing`,
  `enabling`,
  `cancelling`,
  `cancelled`,
  `complete`,
  `failed`,
]),
  O({ operationId: q, state: N(`refreshing`) }).strict(),
  O({ workspace: B, stableId: q, operationId: q, clientMode: id, deliveryKind: id }).strict(),
  O({
    workspace: B,
    pluginId: q,
    enabled: T(),
    operationId: q.optional(),
    scope: fv.optional(),
  }).strict(),
  O({ plugin: gv, enabled: T() }).strict());
var jv = O({
  displayName: S().optional(),
  displayNameI18n: j(S(), S()).optional(),
  descriptionI18n: j(S(), S()).optional(),
  icon: S().optional(),
  category: S().optional(),
  author: S().optional(),
  authorUrl: S().optional(),
  homepage: S().optional(),
  privacyPolicy: S().optional(),
  termsOfService: S().optional(),
  heroImage: S().optional(),
  examplePrompts: D(S()).optional(),
  examplePromptsI18n: j(S(), D(S())).optional(),
  requiresPaidPlan: T().optional(),
}).strict();
O({
  stableId: q,
  status: Av,
  marketplace: q.optional(),
  pluginName: q.optional(),
  sourceTrust: N(`official`).optional(),
  icon: S().optional(),
  listing: jv.optional(),
  diagnostics: D(_v),
})
  .strict()
  .superRefine((e, t) => {
    (e.status !== `ready` && e.status !== `disabled` && e.status !== `missing`) ||
      ((!e.marketplace || !e.pluginName || e.sourceTrust !== `official`) &&
        t.addIssue({
          code: `custom`,
          message: `actionable suggested Plugin results require trusted install identity`,
        }));
  });
var Mv = O({
    id: q,
    name: q,
    source: J,
    description: S().optional(),
    lastUpdated: S().optional(),
    pluginCount: w().int().nonnegative(),
    isOfficial: T().optional(),
    featured: D(S()).optional(),
    refreshFailure: O({ code: S(), failedAt: S(), message: S() }).strict().optional(),
  }).strict(),
  Nv = O({
    id: q,
    name: q,
    marketplace: q,
    description: S().optional(),
    version: S().optional(),
    installed: T(),
    componentTypes: D(S()).optional(),
    listing: jv.optional(),
  }).strict(),
  Pv = O({
    id: q,
    name: q,
    marketplace: q,
    description: S().optional(),
    version: S().optional(),
    enabled: T(),
    scope: fv,
    installPath: S().optional(),
    installedAt: S().optional(),
    componentTypes: D(S()).optional(),
    hookDetails: D(pv).optional(),
    updateStatus: M([`none`, `update-available`, `version-changed`]).optional(),
    latestVersion: S().optional(),
    listing: jv.optional(),
  }).strict();
(O({ workspace: B, configScope: fv.optional() }).strict(),
  O({
    marketplaces: D(Mv),
    availablePlugins: D(Nv),
    installedPlugins: D(Pv),
    restorableBuiltins: D(Nv),
    diagnostics: D(_v),
    capability: O({ supported: T(), reason: S().optional() }).strict(),
  }).strict(),
  O({ workspace: B, source: q, dryRun: T().optional(), operationId: q.optional() }).strict(),
  O({ workspace: B, marketplace: q }).strict(),
  O({ workspace: B, marketplace: q.optional(), operationId: q.optional() }).strict(),
  O({
    marketplace: Mv.optional(),
    marketplaces: D(Mv).optional(),
    diagnostics: D(_v).optional(),
  }).strict(),
  O({
    workspace: B,
    pluginName: q,
    marketplace: q,
    scope: fv.optional(),
    dryRun: T().optional(),
    operationId: q.optional(),
  }).strict(),
  O({ operationId: q }).strict(),
  O({ operationId: q, cancelled: T() }).strict(),
  O({
    workspace: B,
    pluginId: q.optional(),
    pluginName: q.optional(),
    marketplace: q.optional(),
    removeCache: T().optional(),
  }).strict(),
  O({ installedPlugins: D(Pv), dependencyClosure: D(S()), diagnostics: D(_v) }).strict(),
  O({ removedPlugin: Pv.optional(), diagnostics: D(_v) }).strict(),
  O({ workspace: B, pluginId: q.optional(), marketplace: q.optional() }).strict(),
  O({ workspace: B, pluginId: q }).strict(),
  O({ pluginId: q, diagnostics: D(_v) }).strict(),
  O({
    workspace: B,
    pluginId: q,
    options: J,
    clearOptionKeys: D(q).optional(),
    scope: fv.optional(),
    dryRun: T().optional(),
  }).strict(),
  O({ pluginId: q, diagnostics: D(_v) }).strict(),
  O({ workspace: B, pluginId: q, scope: fv.optional() }).strict(),
  O({
    workspace: B,
    pluginName: q.optional(),
    marketplace: q.optional(),
    source: q.optional(),
  }).strict(),
  O({
    ok: T(),
    diagnostics: D(_v),
    compatibility: O({ runnable: D(S()), diagnosticOnly: D(S()), unsupported: D(S()) }).strict(),
  }).strict(),
  O({ workspace: B, pluginName: q, marketplace: q }).strict(),
  O({
    components: D(hv),
    diagnostics: D(_v).optional(),
    metadata: O({
      author: S().optional(),
      authorUrl: S().optional(),
      homepage: S().optional(),
      version: S().optional(),
    })
      .strict()
      .optional(),
  }).strict());
var Fv = O({
    unit: M([`minute`, `hourly`, `daily`, `weekly`, `monthly`, `yearly`]),
    interval: w().int().positive(),
    hour: w().int().min(0).max(23),
    minute: w().int().min(0).max(59),
    anchorAt: w().int(),
    weekdays: D(w().int().min(0).max(6)).optional(),
    monthDays: D(w().int().min(1).max(31)).optional(),
    months: D(w().int().min(1).max(12)).optional(),
    monthlyMode: M([`date`, `weekday`]).optional(),
  }).strict(),
  Iv = M([`minute`, `hourly`, `daily`, `weekly`, `monthly`, `yearly`]),
  Lv = O({
    automationId: q,
    title: S(),
    cronExpr: q,
    prompt: q,
    modelSelection: I.optional(),
    mode: dg.optional(),
    targetTaskId: q.optional(),
    enabled: T(),
    lifecycleStatus: M([`active`, `completed`, `failed`, `paused`]),
    nextRunAt: Og.optional(),
    lastRunAt: Og.optional(),
    runCount: w().int().nonnegative(),
    recurring: T(),
    maxRuns: w().int().positive().optional(),
    scheduleRule: Fv.optional(),
  }).strict();
(O({
  title: S().optional(),
  cronExpr: q,
  relativeDelayMinutes: w().int().positive().max(525600).optional(),
  prompt: q,
  modelSelection: I.optional(),
  mode: dg.optional(),
  targetTaskId: q.optional(),
  botDeliveryTarget: Qm.optional(),
  recurring: T().optional(),
  maxRuns: w().int().positive().optional(),
  intervalUnit: Iv.optional(),
  interval: w().int().min(1).max(200).optional(),
})
  .strict()
  .refine((e) => (e.intervalUnit === void 0) == (e.interval === void 0), {
    message: `intervalUnit and interval must be set together`,
    path: [`interval`],
  })
  .refine((e) => e.intervalUnit === void 0 || e.relativeDelayMinutes === void 0, {
    message: `intervalUnit cannot combine with a relative delayMinutes`,
    path: [`intervalUnit`],
  })
  .refine((e) => e.intervalUnit === void 0 || e.recurring !== !1, {
    message: `intervalUnit is a recurring carrier and cannot combine with recurring=false`,
    path: [`recurring`],
  })
  .refine((e) => e.intervalUnit === void 0 || e.maxRuns === void 0, {
    message: `intervalUnit is a recurring carrier and cannot combine with maxRuns`,
    path: [`maxRuns`],
  }),
  O({ automation: Lv }).strict(),
  O({
    automationId: q,
    title: q.optional(),
    cronExpr: q.optional(),
    prompt: q.optional(),
    recurring: T().optional(),
    maxRuns: w().int().positive().nullable().optional(),
    intervalUnit: Iv.optional(),
    interval: w().int().min(1).max(200).optional(),
  })
    .strict()
    .refine(
      (e) =>
        e.title !== void 0 ||
        e.cronExpr !== void 0 ||
        e.prompt !== void 0 ||
        e.recurring !== void 0 ||
        e.maxRuns !== void 0 ||
        e.intervalUnit !== void 0,
      { message: `automation update requires at least one field` },
    )
    .refine((e) => e.maxRuns !== null || e.recurring === !0, {
      message: `clearing maxRuns requires recurring=true`,
      path: [`maxRuns`],
    })
    .refine((e) => e.recurring !== !0 || typeof e.maxRuns != `number`, {
      message: `recurring=true cannot be combined with a numeric maxRuns`,
      path: [`maxRuns`],
    })
    .refine((e) => (e.intervalUnit === void 0) == (e.interval === void 0), {
      message: `intervalUnit and interval must be set together`,
      path: [`interval`],
    })
    .refine((e) => e.intervalUnit === void 0 || e.recurring !== !1, {
      message: `intervalUnit is a recurring carrier and cannot combine with recurring=false`,
      path: [`recurring`],
    })
    .refine(
      (e) =>
        e.intervalUnit === void 0 ||
        e.maxRuns === void 0 ||
        (e.maxRuns === null && e.recurring === !0),
      {
        message: `intervalUnit is a recurring carrier and only allows maxRuns=null with recurring=true`,
        path: [`maxRuns`],
      },
    ),
  O({ automation: Lv }).strict(),
  O({}).strict(),
  O({ automations: D(Lv) }).strict(),
  O({ targetTaskId: q }).strict(),
  O({ bound: T() }).strict(),
  O({ automationId: q }).strict(),
  O({ deleted: T() }).strict(),
  O({
    title: q,
    prompt: q,
    permissionMode: M([`build`, `edit`, `plan`, `yolo`]).optional(),
    model: q.optional(),
    thoughtLevel: q.optional(),
    boundSessionId: q.optional(),
  }).strict());
var Rv = O({
  offPeakTaskId: q,
  title: S(),
  status: M([`queued`, `paused`, `running`, `completed`, `failed`, `cancelled`]),
  queuePosition: w().int().positive().optional(),
  sessionId: q.optional(),
  createdAt: w().int().nonnegative(),
}).strict();
(A(`ok`, [
  O({ ok: N(!0), task: Rv }).strict(),
  O({
    ok: N(!1),
    failureStage: M([`client_validation`, `ticket_request`, `local_persist`]),
    errorCategory: M([
      `client_validation`,
      `eligibility_3101`,
      `quota_3103`,
      `network`,
      `invalid_response`,
      `local_persist`,
      `unknown`,
    ]),
    errorCode: S(),
  }).strict(),
]),
  O({}).strict(),
  O({ tasks: D(Rv) }).strict());
var zv = {
  runtimeCapabilities: `runtime/capabilities`,
  computerUseOperationEvent: `computer-use/operation-event`,
  sessionCreate: `session/create`,
  sessionResume: `session/resume`,
  sessionList: `session/list`,
  sessionSubagents: `session/subagents`,
  sessionRequestRuntimePreferences: `session/requestRuntimePreferences`,
  sessionRead: `session/read`,
  sessionMessages: `session/messages`,
  sessionEvents: `session/events`,
  sessionDebug: `session/debug`,
  sessionSubscribe: `session/subscribe`,
  sessionSend: `session/send`,
  sessionStop: `session/stop`,
  sessionCancelBackgroundTask: `session/cancelBackgroundTask`,
  sessionFork: `session/fork`,
  sessionCompact: `session/compact`,
  sessionGoal: `session/goal`,
  sessionClose: `session/close`,
  sessionSetModel: `session/setModel`,
  sessionSetThoughtLevel: `session/setThoughtLevel`,
  sessionSetMode: `session/setMode`,
  workspaceReadPresentation: `workspace/readPresentation`,
  workspaceHookTrustGrant: `workspace/hooks/trustGrant`,
  providerUpdateAccountConfig: `provider/updateAccountConfig`,
  workspaceUpdateInteractionPreferences: `workspace/updateInteractionPreferences`,
  workspaceUpdateModelIoPreferences: `workspace/updateModelIoPreferences`,
  workspaceUpdateOffPeakToolPolicy: `workspace/updateOffPeakToolPolicy`,
  workspaceUpdateDynamicWorkflowPolicy: `workspace/updateDynamicWorkflowPolicy`,
  workspaceGenerateText: `workspace/generateText`,
  workspaceCancelGenerateText: `workspace/cancelGenerateText`,
  providerTestModelConnectivity: `provider/testModelConnectivity`,
  mcpList: `mcp/list`,
  pluginsList: `plugins/list`,
  pluginsReferenceCatalog: `plugins/referenceCatalog`,
  pluginsReferenceCatalogWithCategory: `plugins/referenceCatalogWithCategory`,
  skillsReferenceCatalog: `skills/referenceCatalog`,
  workflowsList: `workflows/list`,
  workflowsGet: `workflows/get`,
  workflowsUpdateMeta: `workflows/updateMeta`,
  workflowsDelete: `workflows/delete`,
  workflowsRuns: `workflows/runs`,
  workflowsMove: `workflows/move`,
  pluginsResolveSuggestedReference: `plugins/resolveSuggestedReference`,
  pluginsSetEnabled: `plugins/setEnabled`,
  pluginsOverview: `plugins/overview`,
  pluginsMarketplaceAdd: `plugins/marketplace/add`,
  pluginsMarketplaceRemove: `plugins/marketplace/remove`,
  pluginsMarketplaceUpdate: `plugins/marketplace/update`,
  pluginsInstall: `plugins/install`,
  pluginsCancelOperation: `plugins/cancelOperation`,
  pluginsUninstall: `plugins/uninstall`,
  pluginsUpdate: `plugins/update`,
  pluginsRestoreBuiltin: `plugins/restoreBuiltin`,
  pluginsConfigure: `plugins/configure`,
  pluginsResetConfig: `plugins/resetConfig`,
  pluginsValidate: `plugins/validate`,
  pluginsDescribe: `plugins/describe`,
  automationCreate: `automation/create`,
  automationUpdate: `automation/update`,
  automationCheckTaskBinding: `automation/checkTaskBinding`,
  automationList: `automation/list`,
  automationDelete: `automation/delete`,
  offPeakCreate: `offPeak/create`,
  offPeakList: `offPeak/list`,
  usageStats: `usage/stats`,
  sessionUsage: `session/usage`,
  processChildProcesses: `process/childProcesses`,
  interactionRequestPermission: `interaction/requestPermission`,
  interactionRequestUserInput: `interaction/requestUserInput`,
  interactionRequestProviderRuntimeHeaders: `interaction/requestProviderRuntimeHeaders`,
  interactionRequestOfficialMcpAuthHeaders: `interaction/requestOfficialMcpAuthHeaders`,
  interactionBrowserList: `interaction/browserList`,
  interactionBrowserExecute: `interaction/browserExecute`,
};
(O({}).strict(),
  zv.workspaceHookTrustGrant,
  zv.mcpList,
  zv.interactionBrowserList,
  zv.interactionBrowserExecute,
  A(`method`, [
    O({
      method: N(`startup/storagePath`),
      params: O({ path: S().min(1).max(32768) }).strict(),
    }).strict(),
    O({ method: N(`startup/storagePrepared`), params: O({}).strict() }).strict(),
    O({ method: N(`startup/storageState`), params: Rg }).strict(),
  ]),
  O({ method: N(`startup/storagePathReady`), reuse: T().optional() }).strict());
var Bv = M([`pending`, `running`, `done`, `failed`]),
  Vv = O({
    name: S().min(1).max(H.maxPhaseNameLength),
    status: Bv,
    alongside: D(w().int().nonnegative()).max(H.maxPhases).optional(),
  }),
  Hv = O({
    runs: D(
      O({
        runId: S().min(1),
        toolCallId: S().min(1).optional(),
        name: S().min(1).optional(),
        status: rf.shape.status,
        stopReason: rf.shape.stopReason,
        startedAt: L.optional(),
        phases: D(Vv).max(H.maxPhases),
        currentPhase: S().min(1).max(H.maxPhaseNameLength).optional(),
        agentsWorking: w().int().nonnegative(),
      }),
    ).max(4),
  });
function Uv(e) {
  return e === `pending` || e === `running`;
}
var Wv = S()
  .min(4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
function Gv(e) {
  let t = 4294967295;
  for (let n of e) {
    t ^= n;
    for (let e = 0; e < 8; e += 1) t = (t >>> 1) ^ (t & 1 ? 3988292384 : 0);
  }
  return ((t ^ 4294967295) >>> 0).toString(16).padStart(8, `0`);
}
var Kv = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/`;
function qv(e) {
  let t = ``,
    n = [];
  for (let r = 0; r < e.byteLength; r += 3) {
    let i = e[r] ?? 0,
      a = r + 1 < e.byteLength,
      o = r + 2 < e.byteLength,
      s = a ? (e[r + 1] ?? 0) : 0,
      c = o ? (e[r + 2] ?? 0) : 0;
    (n.push(
      Kv[i >>> 2],
      Kv[((i & 3) << 4) | (s >>> 4)],
      a ? Kv[((s & 15) << 2) | (c >>> 6)] : `=`,
      o ? Kv[c & 63] : `=`,
    ),
      n.length >= 16384 && ((t += n.join(``)), (n = [])));
  }
  return t + n.join(``);
}
function Jv(e) {
  if (!Wv.safeParse(e).success) return null;
  let t = e.endsWith(`==`) ? 2 : +!!e.endsWith(`=`),
    n = new Uint8Array((e.length / 4) * 3 - t),
    r = 0;
  for (let t = 0; t < e.length; t += 4) {
    let i = Kv.indexOf(e[t]),
      a = Kv.indexOf(e[t + 1]),
      o = e[t + 2] === `=` ? 0 : Kv.indexOf(e[t + 2]),
      s = e[t + 3] === `=` ? 0 : Kv.indexOf(e[t + 3]);
    if (i < 0 || a < 0 || o < 0 || s < 0) return null;
    let c = (i << 18) | (a << 12) | (o << 6) | s;
    (r < n.length && (n[r++] = c >>> 16),
      r < n.length && (n[r++] = (c >>> 8) & 255),
      r < n.length && (n[r++] = c & 255));
  }
  return n;
}
var Yv = {
    maxPhysicalFrameBytes: Ju.maxFrameBytes,
    maxMessageBytes: 16 * 1024 * 1024,
    maxFragments: 64,
    assemblyTimeoutMs: 3e4,
    transportIdMaxChars: Ju.transportEnvelopeIdMaxChars,
  },
  Xv = w()
    .int()
    .positive()
    .max(2 ** 53 - 1),
  Zv = w()
    .int()
    .nonnegative()
    .max(2 ** 53 - 1),
  Qv = S()
    .min(1)
    .max(Yv.transportIdMaxChars)
    .regex(/^[A-Za-z0-9._~-]+$/u),
  $v = O({
    bridgeSessionId: Qv,
    bridgeGeneration: Zv.optional(),
    recoveryId: Qv.optional(),
  }).strict(),
  ey = O({ algorithm: N(`crc32`), value: S().regex(/^[0-9a-f]{8}$/u) }).strict();
function ty(e) {
  if (e.length < 4 || e.length > Yv.maxPhysicalFrameBytes) return !1;
  let t = Jv(e);
  return t !== null && t.byteLength > 0 && qv(t) === e;
}
var ny = O({
    zcode_type: N(`rpc-frame`),
    bridgeSessionId: Qv,
    bridgeGeneration: Zv.optional(),
    recoveryId: Qv.optional(),
    seq: Xv,
    messageSeq: Xv,
    fragmentIndex: w()
      .int()
      .nonnegative()
      .max(Yv.maxFragments - 1),
    fragmentCount: w().int().positive().max(Yv.maxFragments),
    messageBytes: w().int().positive().max(Yv.maxMessageBytes),
    checksum: ey,
    dataBase64: S().min(4).max(Yv.maxPhysicalFrameBytes).refine(ty),
  })
    .strict()
    .superRefine((e, t) => {
      (e.fragmentIndex >= e.fragmentCount &&
        t.addIssue({
          code: `custom`,
          path: [`fragmentIndex`],
          message: `fragmentIndex must be smaller than fragmentCount`,
        }),
        e.fragmentCount > e.messageBytes &&
          t.addIssue({
            code: `custom`,
            path: [`fragmentCount`],
            message: `non-empty fragments cannot exceed message bytes`,
          }));
    }),
  ry = O({
    zcode_type: N(`rpc-frame-ack`),
    bridgeSessionId: Qv,
    bridgeGeneration: Zv.optional(),
    recoveryId: Qv.optional(),
    ackMessageSeq: Xv,
  }).strict(),
  iy = k([ny, ry]);
O({ type: N(`data`), payload: iy, client_ts: Zv.optional(), server_ts: Zv.optional() }).strict();
function ay(e) {
  return new TextEncoder().encode(e).byteLength;
}
function oy(e, t = {}) {
  let n = t.clientTimestamp === void 0 ? 2 ** 53 - 1 : t.clientTimestamp,
    r = t.serverTimestamp === void 0 ? 2 ** 53 - 1 : t.serverTimestamp;
  return {
    type: `data`,
    payload: e,
    ...(n === null ? {} : { client_ts: n }),
    ...(r === null ? {} : { server_ts: r }),
  };
}
function sy(e, t) {
  return ay(JSON.stringify(oy(e, t)));
}
function cy(e, t, n) {
  let r = e ?? t;
  if (!Number.isSafeInteger(r) || r <= 0) throw new uy(n);
  return Math.min(r, t);
}
function ly(e) {
  let t = iy.safeParse(e);
  return t.success ? t.data : null;
}
var uy = class extends Error {
  constructor(e) {
    (super(e), (this.reasonCode = e), (this.name = `WebRemoteControlRpcTransportEncodingError`));
  }
};
function dy(e) {
  let t = $v.safeParse({
    bridgeSessionId: e.bridgeSessionId,
    ...(e.bridgeGeneration === void 0 ? {} : { bridgeGeneration: e.bridgeGeneration }),
    ...(e.recoveryId === void 0 ? {} : { recoveryId: e.recoveryId }),
  });
  if (!t.success) throw new uy(`remote.rpcFrame.invalidIdentity`);
  return t.data;
}
function fy(e, t) {
  if (!Number.isSafeInteger(e) || e <= 0) throw new uy(t);
}
function py(e) {
  return 4 * Math.ceil(e / 3);
}
function my(e) {
  return {
    zcode_type: `rpc-frame`,
    ...e.identity,
    seq: e.seq,
    messageSeq: e.messageSeq,
    fragmentIndex: e.fragmentIndex,
    fragmentCount: e.fragmentCount,
    messageBytes: e.messageBytes,
    checksum: e.checksum,
    dataBase64: e.dataBase64,
  };
}
function hy(e) {
  let t = sy(
      my({
        identity: e.identity,
        seq: e.endSeq,
        messageSeq: e.messageSeq,
        fragmentIndex: e.fragmentCount - 1,
        fragmentCount: e.fragmentCount,
        messageBytes: e.messageBytes,
        checksum: e.checksum,
        dataBase64: ``,
      }),
    ),
    n = 0,
    r = e.messageBytes;
  for (; n < r; ) {
    let i = Math.ceil((n + r) / 2);
    t + py(i) <= e.maxPhysicalFrameBytes ? (n = i) : (r = i - 1);
  }
  return n;
}
function gy(e, t) {
  let n = dy(t);
  (fy(t.firstPhysicalSeq, `remote.rpcFrame.invalidPhysicalSeq`),
    fy(t.messageSeq, `remote.rpcFrame.invalidMessageSeq`));
  let r = cy(
      t.maxPhysicalFrameBytes,
      Yv.maxPhysicalFrameBytes,
      `remote.rpcFrame.invalidPhysicalLimit`,
    ),
    i = cy(t.maxMessageBytes, Yv.maxMessageBytes, `remote.rpcFrame.invalidMessageLimit`),
    a = cy(t.maxFragments, Yv.maxFragments, `remote.rpcFrame.invalidFragmentLimit`);
  if (e.byteLength === 0) throw new uy(`remote.rpcFrame.emptyMessage`);
  if (e.byteLength > i) throw new uy(`remote.rpcFrame.messageTooLarge`);
  let o = Object.freeze({ algorithm: `crc32`, value: Gv(e) }),
    s = 1,
    c = 0;
  for (;;) {
    let i = t.firstPhysicalSeq + s - 1;
    if (!Number.isSafeInteger(i) || i > 2 ** 53 - 1)
      throw new uy(`remote.rpcFrame.sequenceOverflow`);
    if (
      ((c = hy({
        identity: n,
        endSeq: i,
        messageSeq: t.messageSeq,
        fragmentCount: s,
        messageBytes: e.byteLength,
        checksum: o,
        maxPhysicalFrameBytes: r,
      })),
      c < 1)
    )
      throw new uy(`remote.rpcFrame.envelopeTooLarge`);
    let l = Math.ceil(e.byteLength / c);
    if (l > a) throw new uy(`remote.rpcFrame.fragmentLimitExceeded`);
    if (l <= s) break;
    s = l;
  }
  let l = [];
  for (let i = 0; i < s; i += 1) {
    let a = i * c,
      u = Math.min(e.byteLength, a + c),
      d = my({
        identity: n,
        seq: t.firstPhysicalSeq + i,
        messageSeq: t.messageSeq,
        fragmentIndex: i,
        fragmentCount: s,
        messageBytes: e.byteLength,
        checksum: o,
        dataBase64: qv(e.subarray(a, u)),
      });
    if (sy(d) > r || !ny.safeParse(d).success)
      throw new uy(`remote.rpcFrame.internalEnvelopeError`);
    l.push(Object.freeze(d));
  }
  return Object.freeze(l);
}
function _y(e, t) {
  return (
    t.bridgeSessionId === e.bridgeSessionId &&
    t.bridgeGeneration === e.bridgeGeneration &&
    t.recoveryId === e.recoveryId
  );
}
function vy(e, t) {
  if (typeof t != `object` || !t) return !1;
  let n = t;
  return [`bridgeSessionId`, `bridgeGeneration`, `recoveryId`].some((e) => e in n)
    ? n.bridgeSessionId !== e.bridgeSessionId ||
        n.bridgeGeneration !== e.bridgeGeneration ||
        n.recoveryId !== e.recoveryId
    : !1;
}
function yy(e, t) {
  return {
    messageSeq: e.messageSeq,
    value: JSON.stringify([
      e.bridgeSessionId,
      e.bridgeGeneration ?? null,
      e.recoveryId ?? null,
      e.seq,
      e.messageSeq,
      e.fragmentIndex,
      e.fragmentCount,
      e.messageBytes,
      e.checksum.algorithm,
      e.checksum.value,
      t.byteLength,
      Gv(t),
    ]),
  };
}
function by(e, t) {
  return e.value === t.value;
}
var xy = class {
    identity;
    maxPhysicalFrameBytes;
    maxMessageBytes;
    maxFragments;
    timeoutMs;
    now;
    expectedPhysicalSeq;
    expectedMessageSeq;
    lastCompletedMessageSeq;
    physicalSequenceExhausted = !1;
    messageSequenceExhausted = !1;
    settledFrameFingerprintsBySeq = new Map();
    active = null;
    terminalReason = null;
    constructor(e) {
      ((this.identity = dy(e.identity)),
        (this.expectedPhysicalSeq = e.initialPhysicalSeq ?? 1),
        (this.expectedMessageSeq = e.initialMessageSeq ?? 1),
        fy(this.expectedPhysicalSeq, `remote.rpcFrame.invalidPhysicalSeq`),
        fy(this.expectedMessageSeq, `remote.rpcFrame.invalidMessageSeq`),
        (this.lastCompletedMessageSeq = this.expectedMessageSeq - 1),
        (this.maxPhysicalFrameBytes = cy(
          e.maxPhysicalFrameBytes,
          Yv.maxPhysicalFrameBytes,
          `remote.rpcFrame.invalidPhysicalLimit`,
        )),
        (this.maxMessageBytes = cy(
          e.maxMessageBytes,
          Yv.maxMessageBytes,
          `remote.rpcFrame.invalidMessageLimit`,
        )),
        (this.maxFragments = cy(
          e.maxFragments,
          Yv.maxFragments,
          `remote.rpcFrame.invalidFragmentLimit`,
        )),
        (this.timeoutMs = cy(e.timeoutMs, Yv.assemblyTimeoutMs, `remote.rpcFrame.invalidTimeout`)),
        (this.now = e.now ?? Date.now));
    }
    get nextExpiryAt() {
      return this.active ? this.active.firstSeenAt + this.timeoutMs : null;
    }
    fault(e, t, n) {
      return (
        t && ((this.terminalReason = e), (this.active = null)),
        {
          kind: `fault`,
          fault: {
            reasonCode: e,
            terminal: t,
            ...(typeof n?.seq == `number` ? { seq: n.seq } : {}),
            ...(typeof n?.messageSeq == `number` ? { messageSeq: n.messageSeq } : {}),
            expectedSeq: this.expectedPhysicalSeq,
            expectedMessageSeq: this.expectedMessageSeq,
          },
        }
      );
    }
    expire(e = this.now()) {
      return !this.active || e - this.active.firstSeenAt < this.timeoutMs
        ? null
        : this.fault(`remote.rpcFrame.assemblyTimeout`, !0, { messageSeq: this.active.messageSeq });
    }
    accept(e, t = this.now()) {
      if (vy(this.identity, e)) return this.fault(`remote.rpcFrame.identityMismatch`, !1);
      if (this.terminalReason) return this.fault(this.terminalReason, !0);
      let n = this.expire(t);
      if (n) return n;
      let r = typeof e == `object` && e && `dataBase64` in e ? e.dataBase64 : void 0;
      if (typeof r == `string` && (r.length > this.maxPhysicalFrameBytes || !ty(r)))
        return this.fault(`remote.rpcFrame.invalidBase64`, !0);
      let i = ny.safeParse(e);
      if (!i.success) return this.fault(`remote.rpcFrame.invalidMetadata`, !0);
      let a = i.data;
      if (!_y(this.identity, a)) return this.fault(`remote.rpcFrame.identityMismatch`, !1, a);
      if (a.messageBytes > this.maxMessageBytes)
        return this.fault(`remote.rpcFrame.messageTooLarge`, !0, a);
      if (a.fragmentCount > this.maxFragments)
        return this.fault(`remote.rpcFrame.fragmentLimitExceeded`, !0, a);
      if (sy(a) > this.maxPhysicalFrameBytes)
        return this.fault(`remote.rpcFrame.envelopeTooLarge`, !0, a);
      let o = Jv(a.dataBase64);
      if (!o || o.byteLength === 0) return this.fault(`remote.rpcFrame.invalidBase64`, !0, a);
      let s = yy(a, o),
        c = this.active?.frameFingerprintsBySeq.get(a.seq);
      if (c)
        return by(c, s)
          ? {
              kind: `duplicate`,
              ackMessageSeq: this.lastCompletedMessageSeq > 0 ? this.lastCompletedMessageSeq : null,
            }
          : this.fault(`remote.rpcFrame.conflictingDuplicate`, !0, a);
      let l = this.settledFrameFingerprintsBySeq.get(a.seq);
      if (l)
        return by(l, s)
          ? {
              kind: `duplicate`,
              ackMessageSeq: this.lastCompletedMessageSeq > 0 ? this.lastCompletedMessageSeq : null,
            }
          : this.physicalSequenceExhausted && a.messageSeq !== l.messageSeq
            ? this.fault(`remote.rpcFrame.physicalSequenceExhausted`, !0, a)
            : this.fault(`remote.rpcFrame.conflictingDuplicate`, !0, a);
      if (a.seq < this.expectedPhysicalSeq)
        return {
          kind: `duplicate`,
          ackMessageSeq: this.lastCompletedMessageSeq > 0 ? this.lastCompletedMessageSeq : null,
        };
      if (this.physicalSequenceExhausted)
        return this.fault(`remote.rpcFrame.physicalSequenceExhausted`, !0, a);
      if (this.messageSequenceExhausted && !this.active)
        return this.fault(`remote.rpcFrame.messageSequenceExhausted`, !0, a);
      if (a.seq > this.expectedPhysicalSeq) return this.fault(`remote.rpcFrame.physicalGap`, !0, a);
      if (a.messageSeq !== this.expectedMessageSeq)
        return this.fault(`remote.rpcFrame.messageGap`, !0, a);
      if (a.seq === 2 ** 53 - 1 && a.fragmentIndex + 1 < a.fragmentCount)
        return this.fault(`remote.rpcFrame.physicalSequenceExhausted`, !0, a);
      let u = this.active?.fragments.length ?? 0;
      if (a.fragmentIndex !== u) return this.fault(`remote.rpcFrame.fragmentGap`, !0, a);
      if (
        this.active &&
        (a.fragmentCount !== this.active.fragmentCount ||
          a.messageBytes !== this.active.messageBytes)
      )
        return this.fault(`remote.rpcFrame.metadataMismatch`, !0, a);
      if (this.active && a.checksum.value !== this.active.checksum.value)
        return this.fault(`remote.rpcFrame.checksumMismatch`, !0, a);
      if (
        ((this.active ||= {
          messageSeq: a.messageSeq,
          fragmentCount: a.fragmentCount,
          messageBytes: a.messageBytes,
          checksum: a.checksum,
          firstSeenAt: t,
          stagedBytes: 0,
          fragments: [],
          frameFingerprintsBySeq: new Map(),
        }),
        this.active.stagedBytes + o.byteLength > this.active.messageBytes)
      )
        return this.fault(`remote.rpcFrame.lengthMismatch`, !0, a);
      if (
        (this.active.fragments.push(o),
        this.active.frameFingerprintsBySeq.set(a.seq, s),
        (this.active.stagedBytes += o.byteLength),
        a.seq === 2 ** 53 - 1
          ? (this.physicalSequenceExhausted = !0)
          : (this.expectedPhysicalSeq += 1),
        this.active.fragments.length < this.active.fragmentCount)
      )
        return {
          kind: `incomplete`,
          messageSeq: a.messageSeq,
          receivedFragments: this.active.fragments.length,
        };
      if (this.active.stagedBytes !== this.active.messageBytes)
        return this.fault(`remote.rpcFrame.lengthMismatch`, !0, a);
      let d = new Uint8Array(this.active.messageBytes),
        f = 0;
      for (let e of this.active.fragments) (d.set(e, f), (f += e.byteLength));
      if (Gv(d) !== this.active.checksum.value)
        return this.fault(`remote.rpcFrame.checksumMismatch`, !0, a);
      let p = this.active,
        ee = p.messageSeq;
      return (
        (this.settledFrameFingerprintsBySeq = new Map(p.frameFingerprintsBySeq)),
        (this.active = null),
        (this.lastCompletedMessageSeq = ee),
        ee === 2 ** 53 - 1 ? (this.messageSequenceExhausted = !0) : (this.expectedMessageSeq += 1),
        { kind: `complete`, messageSeq: ee, bytes: d }
      );
    }
  },
  X = S().trim().min(1),
  Sy = [
    `default`,
    `yolo`,
    `plan`,
    `edit`,
    `acceptEdits`,
    `auto`,
    `dontAsk`,
    `bypassPermissions`,
    `autoEdit`,
    `build`,
  ],
  Cy = [`claude`, `opencode`, `gemini`, `codex`, `glm`],
  wy = [`claudeCode`],
  Ty = O({
    fileCount: w().int().nonnegative(),
    added: w().int().nonnegative(),
    removed: w().int().nonnegative(),
    files: D(
      O({
        path: S(),
        added: w().int().nonnegative(),
        removed: w().int().nonnegative(),
        writeCount: w().int().positive(),
        lastTurnIndex: w().int().nonnegative(),
      }).strict(),
    ),
  }).strict(),
  Ey = O({
    taskId: X,
    traceId: X,
    title: S(),
    titleOverridden: T().optional(),
    workspacePath: X,
    workspaceIdentity: X.optional(),
    createdAt: w().int().nonnegative(),
    updatedAt: w().int().nonnegative(),
    mode: M(Sy),
    model: S().optional(),
    runtimeEpoch: w().int().nonnegative().optional(),
    provider: M(Cy).optional(),
    migrationSource: M(wy).optional(),
    forkedFromTaskId: X.optional(),
    unreadAt: w().int().nonnegative().optional(),
    status: M([`running`, `completed`, `error`]).optional(),
    lastError: O({
      code: S().optional(),
      message: S().min(1),
      traceId: X.optional(),
      taskId: X.optional(),
      attribution: fp.optional(),
    }).optional(),
    changeSummary: Ty.optional(),
  });
function Dy(e) {
  return e.workspaceIdentity?.trim() || e.workspacePath;
}
var Oy = M([
    `task_created`,
    `user_message_saved`,
    `assistant_message_saved`,
    `task_status_changed`,
    `task_meta_changed`,
    `task_model_changed`,
    `task_title_changed`,
    `task_pinned`,
    `task_unpinned`,
    `task_archived`,
    `task_unarchived`,
    `task_deleted`,
    `stream_mirror_gap`,
    `stream_mirror_owner_lost`,
  ]),
  ky = M([`observer`, `relay_owner`]),
  Ay = M([`desktop_window`, `relay_bridge`]),
  jy = O({
    eventId: X,
    workspacePath: X,
    workspaceIdentity: X.optional(),
    workspaceKey: X,
    traceId: X,
    createdAt: w().int().nonnegative(),
  }).strict(),
  My = O({ runId: X, opSeq: w().int().nonnegative() }).strict(),
  Ny = jy.extend({ reason: Oy, streamWatermark: My.optional() }).strict(),
  Py = (e, t) => {
    let n = Dy(t);
    t.workspaceKey !== n &&
      e.addIssue({
        code: P.custom,
        path: [`workspaceKey`],
        message: `workspaceKey must match workspaceIdentity fallback rule`,
      });
  },
  Fy = (e, t) => {
    t.runId !== t.traceId &&
      e.addIssue({ code: P.custom, path: [`runId`], message: `runId must match traceId` });
  },
  Iy = Ny.extend({ type: N(`task_snapshot_invalidated`), taskId: X }).strict(),
  Ly = Ny.extend({
    type: N(`workspace_task_list_invalidated`),
    taskId: X.optional(),
    taskMeta: Ey.optional(),
  }).strict(),
  Ry = A(`kind`, [
    O({
      kind: N(`image`),
      filename: S(),
      mimeType: S(),
      sizeBytes: w().int().nonnegative().optional(),
      dataBase64: S().optional(),
      localPath: S().optional(),
    }).strict(),
    O({
      kind: N(`audio`),
      filename: S(),
      mimeType: S(),
      dataBase64: S().optional(),
      localPath: S().optional(),
    }).strict(),
    O({
      kind: N(`video`),
      filename: S(),
      mimeType: S(),
      sizeBytes: w().int().nonnegative().optional(),
      dataBase64: S().optional(),
      localPath: S().optional(),
    }).strict(),
    O({
      kind: N(`pdf`),
      filename: S(),
      mimeType: S(),
      sizeBytes: w().int().nonnegative().optional(),
      dataBase64: S().optional(),
      localPath: S().optional(),
    }).strict(),
    O({
      kind: N(`file`),
      filename: S(),
      mimeType: S(),
      sizeBytes: w().int().nonnegative(),
      dataBase64: S().optional(),
      textContent: S().optional(),
      localPath: S().optional(),
    }).strict(),
  ]),
  zy = O({ type: X, taskId: X, traceId: X }).passthrough(),
  By = O({
    kind: N(`user_message`),
    messageId: X,
    content: S(),
    attachments: D(Ry).optional(),
    timestamp: w().finite(),
  }).strict(),
  Vy = O({ kind: N(`stream_event`), event: zy }).strict(),
  Hy = A(`kind`, [By, Vy]),
  Uy = A(`kind`, [
    By.extend({ seq: w().int().positive() }).strict(),
    Vy.extend({ seq: w().int().positive() }).strict(),
  ]),
  Wy = O({
    workspacePath: X,
    workspaceIdentity: X.optional(),
    workspaceKey: X,
    taskId: X,
    runId: X,
    traceId: X,
    ownerClientId: X.optional(),
    ownerDeviceLabel: X.optional(),
  }).strict(),
  Gy = Wy.superRefine((e, t) => {
    (Py(t, e), Fy(t, e));
  }),
  Ky = jy
    .extend({
      type: N(`task_stream_mirror_batch`),
      taskId: X,
      runId: X,
      ownerClientId: X.optional(),
      ownerDeviceLabel: X.optional(),
      batchSeq: w().int().positive(),
      fromSeq: w().int().positive(),
      toSeq: w().int().positive(),
      ops: D(Uy),
      terminal: T(),
    })
    .strict(),
  qy = Gy,
  Jy = Wy.extend({ leaseRequestId: X })
    .strict()
    .superRefine((e, t) => {
      (Py(t, e), Fy(t, e));
    }),
  Yy = A(`acquired`, [
    O({ leaseRequestId: X, acquired: N(!0), ownerHostId: X }).strict(),
    O({
      leaseRequestId: X,
      acquired: N(!1),
      ownerHostId: X,
      reason: N(`owned_by_other_host`),
    }).strict(),
  ]),
  Xy = O({
    commandRequestId: X,
    workspacePath: X,
    workspaceIdentity: X.optional(),
    workspaceKey: X,
    taskId: X,
    runId: X,
  }).strict(),
  Zy = Xy.extend({ type: N(`stop_generation`) }).strict(),
  Qy = Xy.extend({
    type: N(`respond_permission`),
    permissionRequestId: X,
    optionId: X,
    response: pd,
  }).strict(),
  $y = Xy.extend({
    type: N(`respond_elicitation`),
    elicitationRequestId: X,
    action: M([`accept`, `decline`, `cancel`]),
    content: j(S(), E()).optional(),
  }).strict(),
  eb = Xy.extend({
    type: N(`respond_workspace_hook_review`),
    remoteSessionId: X.optional(),
    sessionId: X,
    bundleDigest: S().regex(/^[a-f0-9]{64}$/u),
    reviewFlowId: X,
    generation: w().int().positive(),
    interactionId: X,
    decision: tp,
  })
    .strict()
    .superRefine((e, t) => {
      e.remoteSessionId &&
        !e.workspaceIdentity &&
        t.addIssue({
          code: P.custom,
          path: [`workspaceIdentity`],
          message: `remote workspace Hook review response requires workspaceIdentity`,
        });
    }),
  tb = A(`type`, [
    O({
      commandId: X,
      taskId: X,
      traceId: X,
      workspacePath: X,
      workspaceIdentity: X.optional(),
      workspaceKey: X,
      status: M([`accepted`, `running`, `failed`]),
      createdAt: w().int().nonnegative(),
      updatedAt: w().int().nonnegative(),
      clientId: X.optional(),
      clientLabel: X.optional(),
      error: S().optional(),
    })
      .strict()
      .extend({
        type: N(`send_prompt`),
        content: S(),
        attachments: D(Ry).optional(),
        automationId: X.optional(),
      })
      .strict(),
  ]),
  nb = Xy.extend({ type: N(`enqueue_task_command`), taskCommand: tb }).strict(),
  rb = Xy.extend({
    type: N(`promote_task_command`),
    commandId: X,
    clientMode: N(`web-remote-replayable`),
  }).strict(),
  ib = Xy.extend({
    type: N(`cancel_task_command`),
    commandId: X,
    clientMode: N(`web-remote-replayable`),
  }).strict(),
  ab = A(`type`, [Zy, Qy, $y, eb, nb, rb, ib]).superRefine((e, t) => {
    Py(t, e);
  }),
  ob = A(`type`, [
    Zy.extend({ requesterHostId: X }).strict(),
    Qy.extend({ requesterHostId: X }).strict(),
    $y.extend({ requesterHostId: X }).strict(),
    eb.extend({ requesterHostId: X }).strict(),
    nb.extend({ requesterHostId: X }).strict(),
    rb.extend({ requesterHostId: X }).strict(),
    ib.extend({ requesterHostId: X }).strict(),
  ]).superRefine((e, t) => {
    Py(t, e);
  }),
  sb = M([`NO_ACTIVE_TASK_OWNER`, `STALE_TASK_OWNER_COMMAND`, `OWNER_COMMAND_FAILED`]),
  cb = A(`success`, [
    O({ commandRequestId: X, success: N(!0), taskCommand: tb.optional() }).strict(),
    O({ commandRequestId: X, success: N(!1), error: S(), code: sb.optional() }).strict(),
  ]),
  lb = A(`type`, [Iy, Ly, Ky]).superRefine((e, t) => {
    (Py(t, e), e.type === `task_stream_mirror_batch` && Fy(t, e));
  }),
  ub = A(`type`, [
    Iy.extend({ originHostId: X, deliveryPurpose: ky.optional() }).strict(),
    Ly.extend({ originHostId: X, deliveryPurpose: ky.optional() }).strict(),
    Ky.extend({ originHostId: X, deliveryPurpose: ky.optional() }).strict(),
  ]).superRefine((e, t) => {
    (Py(t, e), e.type === `task_stream_mirror_batch` && Fy(t, e));
  }),
  Z = S().trim().min(1),
  db = Z.max(Ju.transportEnvelopeIdMaxChars).regex(/^[A-Za-z0-9._~-]+$/u),
  fb = D(
    O({
      workspacePath: Z,
      workspaceIdentity: Z.optional(),
      remoteSessionId: Z.optional(),
      label: Z,
      workspacePurpose: M([`project`, `conversation`]).optional(),
      kind: M([`local`, `remote`]),
      connectionState: M([`connected`, `disconnected`, `reconnecting`]).optional(),
      lastConnectionError: S().optional(),
    }),
  );
(O({ requestId: Z, workspaceKey: Z }),
  k([
    O({ requestId: Z, workspaceKey: Z, success: N(!0) }),
    O({ requestId: Z, workspaceKey: Z, success: N(!1), error: S() }),
  ]));
var pb = D(
    O({
      taskId: Z,
      title: S(),
      workspacePath: Z,
      workspaceIdentity: Z.optional(),
      remoteSessionId: Z.optional(),
      workspaceLabel: Z,
      workspaceKind: M([`local`, `remote`]),
      createdAt: w().finite(),
      updatedAt: w().finite(),
      provider: Eu.optional(),
      unreadAt: w().finite().optional(),
      displayStatus: M([`idle`, `running`, `completed`, `error`]).optional(),
      hasBackgroundWork: T().optional(),
      workflowActivity: Hv.optional(),
      pinned: T().optional(),
      archived: T().optional(),
    }),
  ),
  mb = M([
    `session-not-found`,
    `session-expired`,
    `session-conflict`,
    `workspace-closed`,
    `desktop-disconnected`,
    `invalid-mobile-connection`,
    `desktop-bootstrap-timeout`,
    `connection-recovery-timeout`,
    `relay-unavailable`,
    `unsupported-action`,
    `unexpected-error`,
  ]),
  hb = A(`kind`, [
    O({
      bridgeSessionId: db,
      bridgeGeneration: w().int().nonnegative().optional(),
      recoveryId: db.optional(),
      kind: N(`local`),
      workspaceKey: Z,
      workspacePath: Z,
      initialTaskId: Z.optional(),
    }),
    O({
      bridgeSessionId: db,
      bridgeGeneration: w().int().nonnegative().optional(),
      recoveryId: db.optional(),
      kind: N(`remote`),
      workspaceKey: Z,
      workspacePath: Z,
      workspaceIdentity: Z,
      remoteSessionId: Z,
      initialTaskId: Z.optional(),
    }),
  ]),
  gb = O({ activeWorkspaceKey: Z.optional(), activeTaskId: Z.optional(), updatedAt: w().finite() }),
  _b = O({
    platform: Z,
    version: Z,
    name: Z,
    userAgent: S().optional(),
    language: S().optional(),
    languages: D(S()).optional(),
    browserPlatform: S().optional(),
    viewport: O({
      width: w().finite(),
      height: w().finite(),
      devicePixelRatio: w().finite(),
    }).optional(),
    screen: O({ width: w().finite(), height: w().finite() }).optional(),
    timezone: S().optional(),
    online: T().optional(),
    updatedAt: w().finite(),
  }),
  vb = O({
    windowControlSessionId: Z,
    desktopAppVersion: Z.optional(),
    workspaces: fb,
    tasks: pb,
    initialViewState: gb.optional(),
    mobileViewState: gb.optional(),
  }),
  yb = O({
    workspaces: fb,
    tasks: pb.optional(),
    activeWorkspaceKey: Z.optional(),
    activeTaskId: Z.optional(),
  }),
  bb = M([
    `isDockerAvailable`,
    `listWSLDistros`,
    `listDockerContainers`,
    `listSSHConfigAliases`,
    `loadMcpFromUserDirectory`,
    `saveMcpToUserDirectory`,
    `migrateLegacyCommonMcp`,
  ]),
  xb = k([
    O({ zcode_type: N(`telemetry-report`), event: wl }).strict(),
    O({ zcode_type: N(`bootstrap-request`), requestId: Z }),
    O({ zcode_type: N(`bootstrap-response`), requestId: Z, success: N(!0), result: vb }),
    O({ zcode_type: N(`workspace-list-request`), requestId: Z }),
    O({ zcode_type: N(`workspace-list-response`), requestId: Z, success: N(!0), result: yb }),
    O({ zcode_type: N(`workspace-list-updated`), result: yb }),
    O({
      zcode_type: N(`workspace-bridge-open`),
      requestId: Z,
      bridgeSessionId: db,
      bridgeGeneration: w().int().nonnegative().optional(),
      recoveryId: db.optional(),
      workspaceKey: Z,
      taskId: Z.optional(),
    }),
    O({
      zcode_type: N(`workspace-bridge-ready`),
      requestId: Z,
      bridgeSessionId: db,
      bridgeGeneration: w().int().nonnegative().optional(),
      recoveryId: db.optional(),
      bridge: hb,
    }),
    O({
      zcode_type: N(`workspace-bridge-error`),
      requestId: Z,
      bridgeSessionId: db.optional(),
      bridgeGeneration: w().int().nonnegative().optional(),
      recoveryId: db.optional(),
      reason: mb,
      error: S(),
    }),
    O({ zcode_type: N(`workspace-reconnect-request`), requestId: Z, workspaceKey: Z }),
    O({
      zcode_type: N(`workspace-reconnect-response`),
      requestId: Z,
      workspaceKey: Z,
      success: N(!0),
    }),
    O({
      zcode_type: N(`workspace-reconnect-response`),
      requestId: Z,
      workspaceKey: Z,
      success: N(!1),
      error: S(),
    }),
    O({ zcode_type: N(`mobile-view-state-update`), viewState: gb, deviceInfo: _b.optional() }),
    O({ zcode_type: N(`platform-request`), requestId: Z, method: bb, args: E().optional() }),
    O({
      zcode_type: N(`platform-response`),
      requestId: Z,
      method: bb,
      success: N(!0),
      result: E(),
    }),
    O({ zcode_type: N(`platform-response`), requestId: Z, method: bb, success: N(!1), error: S() }),
    ny,
    ry,
    O({
      zcode_type: N(`bridge-degraded`),
      bridgeSessionId: db,
      bridgeGeneration: w().int().nonnegative().optional(),
      recoveryId: db.optional(),
      reason: M([`rpc-transport-fault`, `rpc-frame-gap`, `buffer-overflow`, `buffer-timeout`]),
      seq: w().int().nonnegative().optional(),
      expectedSeq: w().int().nonnegative().optional(),
      droppedCount: w().int().nonnegative().optional(),
    }),
    O({
      zcode_type: N(`app-error`),
      requestId: Z.optional(),
      bridgeSessionId: db.optional(),
      reason: mb,
      error: S(),
    }),
    O({
      zcode_type: N(`mobile-diagnostic`),
      event: M([
        `state-transition`,
        `socket-close`,
        `socket-error`,
        `recover-start`,
        `recover-scheduled`,
        `pair-status`,
        `failure`,
      ]),
      timestamp: w().int().nonnegative(),
      state: S().optional(),
      previousState: S().optional(),
      pairStatus: M([`waiting`, `matched`]).optional(),
      closeCode: w().int().optional(),
      closeReason: S().optional(),
      wasClean: T().optional(),
      wasPaired: T().optional(),
      failureReason: mb.optional(),
      failureMessage: S().optional(),
      visibilityState: S().optional(),
      online: T().optional(),
      hiddenDurationMs: w().int().nonnegative().optional(),
    }),
  ]);
function Sb(e) {
  let t = xb.safeParse(e);
  return t.success ? t.data : null;
}
j(S(), S());
var Cb = A(`kind`, [
  O({
    kind: N(`ssh`),
    host: Z,
    port: w().int().positive().max(65535).optional(),
    username: Z,
    sshConfigAlias: Z.optional(),
    password: S().optional(),
    privateKeyPath: S().optional(),
    privateKeyPassphrase: S().optional(),
    assetInstallMode: M(hu).optional(),
    resourcePackages: O({ selectedPackageIds: D(S().refine(Tu)).optional() }).optional(),
  }),
  O({ kind: N(`wsl`), distro: S().optional(), user: gh.optional() }),
  O({ kind: N(`docker`), container: Z }),
  O({
    kind: N(`server`),
    url: S().url(),
    name: Z.optional(),
    token: S().optional(),
    workspacePath: S().optional(),
    serverId: Z.optional(),
  }),
]);
(O({ type: N(`zcode-hello`), version: S(), platform: S(), arch: S(), pid: w().int() }),
  O({ type: N(`zcode-hello-ack`), version: S(), clientId: Z }),
  O({ level: M([`info`, `warn`, `error`]), args: D(E()) }),
  O({
    taskId: Z,
    status: M([
      `completed`,
      `failed`,
      `permission_request`,
      `elicitation_request`,
      `feedback_update`,
    ]),
    requestId: Z.optional(),
    title: S(),
    body: S(),
  }),
  O({
    context: O({ clientTimezone: Z, clientLanguage: Z, screenResolution: Z }),
    elementName: Z,
    eventRegion: Z,
    eventType: Z,
    eventText: S().optional(),
    eventExtraDetail: j(S(), S()),
    userId: S().optional(),
    talkId: S().optional(),
    messageId: S().optional(),
  }),
  O({
    name: Z,
    group: Z,
    value: w().finite().optional(),
    properties: j(S(), k([S(), w().finite(), T(), Ls()])).optional(),
  }));
var wb = O({ channel: Z, payload: E(), sourceWindowId: w().int().optional() }),
  Tb = O({
    mockCdnDir: S().optional(),
    remoteCdnBaseUrl: S().optional(),
    remoteCdnBaseUrls: D(S()).optional(),
    remoteCacheDir: S().optional(),
  }),
  Eb = O({ workspacePath: Z, workspaceIdentity: Z.optional() }),
  Db = O({
    type: N(`init-local`),
    databaseStartupId: S().min(1).max(128).optional(),
    hostId: Z.optional(),
    deliveryKind: Ay.optional(),
    deviceMid: S().optional(),
    feedbackApiBase: S().url().optional(),
    workspacePath: Z.optional(),
    workspaceIdentity: Z.optional(),
    agentWarmupTargets: D(Eb).max(3).optional(),
    agentSpawnFallbackCwd: Z.optional(),
    zcodeBuiltinProviderConfigFilePath: Z,
    runtimeProcessEnvPatch: j(S().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), S()).optional(),
  }),
  Ob = O({
    remoteSessionId: Z,
    target: Cb,
    workspacePath: Z.optional(),
    workspaceIdentity: Z.optional(),
    generation: w().int().positive(),
  }).strict(),
  kb = A(`kind`, [
    O({ kind: N(`local`) }).strict(),
    O({ kind: N(`remote`), remoteSessionId: Z, workspacePath: Z, workspaceIdentity: Z }).strict(),
  ]),
  Ab = O({
    type: N(`connect-remote-workspace`),
    requestId: Z,
    target: Cb,
    remoteAssets: Tb,
    workspacePath: Z.optional(),
    workspaceIdentity: Z.optional(),
  }).strict(),
  jb = O({ type: N(`cancel-remote-workspace-connect`), requestId: Z }).strict(),
  Mb = O({
    type: N(`bind-remote-workspace-context`),
    requestId: Z,
    remoteSessionId: Z,
    workspacePath: Z,
    workspaceIdentity: Z,
  }).strict(),
  Nb = O({
    type: N(`dispose-remote-workspace-session`),
    requestId: Z,
    remoteSessionId: Z,
  }).strict(),
  Pb = O({
    type: N(`attach-service-port`),
    requestId: Z,
    attachmentId: Z,
    clientMode: M([`desktop-continuous`, `web-remote-replayable`]),
    scope: kb,
  }).strict(),
  Fb = O({ type: N(`detach-service-port`), attachmentId: Z }),
  Ib = O({ type: N(`dispose`) }),
  Lb = O({ type: N(`broadcast`), message: wb }),
  Rb = A(`status`, [
    O({ type: N(`broadcast-claim-result`), requestId: Z, status: N(`acquired`), claimToken: Z }),
    O({
      type: N(`broadcast-claim-result`),
      requestId: Z,
      status: N(`busy`),
      retryAfterMs: w().int().nonnegative(),
    }),
    O({ type: N(`broadcast-claim-result`), requestId: Z, status: N(`committed`) }),
  ]),
  zb = O({ type: N(`task-realtime-deliver`), event: ub }),
  Bb = O({ type: N(`task-run-lease-result`), result: Yy }),
  Vb = O({ type: N(`task-owner-command-deliver`), command: ob }),
  Hb = O({ type: N(`task-owner-command-result`), result: cb }),
  Ub = O({
    type: N(`bot-remote-workspace-reconnect-result`),
    requestId: Z,
    ok: T(),
    sessionId: Z.optional(),
    error: S().optional(),
  }),
  Wb = O({
    type: N(`bot-remote-workspace-connection-status-result`),
    requestId: Z,
    ok: T(),
    connected: T().optional(),
    error: S().optional(),
  }),
  Gb = O({
    type: N(`bot-remote-workspace-runtime-port`),
    requestId: Z,
    ok: T(),
    error: S().optional(),
  }),
  Kb = O({
    content: Z,
    createdAt: Z,
    fromSessionId: Z,
    messageId: Z,
    requestId: Z,
    toSessionId: Z,
  }),
  qb = O({
    error: S().optional(),
    messageId: Z,
    requestId: Z,
    sessionId: Z,
    status: M([`success`, `failed`]),
  }),
  Jb = O({ sessionId: Z }),
  Yb = O({ type: N(`session-message-deliver`), request: Kb }),
  Xb = O({ type: N(`session-message-delivery-result`), result: qb }),
  Zb = O({
    type: N(`feedback-log-archive-result`),
    requestId: Z,
    ok: T(),
    path: S().optional(),
    size: w().int().nonnegative().optional(),
    error: S().optional(),
  }),
  Qb = O({
    type: N(`cron-run`),
    automationId: Z,
    runId: Z,
    workspacePath: Z,
    workspaceIdentity: S().optional(),
    prompt: Z,
    targetTaskId: Z.optional(),
    modelSelection: I.optional(),
    mode: S().optional(),
  }),
  $b = O({
    type: N(`off-peak-run`),
    offPeakTaskId: Z,
    workspacePath: Z,
    workspaceIdentity: S().optional(),
    prompt: Z,
    permissionMode: Z,
    modelSelection: I,
    conversationId: S().optional(),
    sessionId: S().optional(),
    serverTicketId: S().optional(),
  }),
  ex = O({ type: N(`browser-execute-result`), requestId: Z, result: mu }),
  tx = O({
    type: N(`local-media-preview-path-authorize-result`),
    requestId: Z,
    ok: T(),
    path: Z.optional(),
    error: S().optional(),
  }).strict(),
  nx = O({
    type: N(`cua-pip-focus-changed`),
    event: O({
      kind: N(`focus-changed`),
      revision: w().int().nonnegative().safe(),
      sourceWindowId: Z.max(255),
      sessionId: Z.max(255).nullable(),
    }).strict(),
  }).strict(),
  rx = O({
    type: N(`provider-provisioning-execute`),
    requestId: Z,
    environmentKey: Z,
    remoteSessionId: Z,
    trigger: Nu,
  }).strict(),
  ix = O({ type: N(`resource-usage-snapshot-request`), requestId: Z }).strict();
A(`type`, [
  O({ type: N(`database-startup-control`), control: Cl }).strict(),
  ix,
  O({ type: N(`resource-usage-snapshot-cancel`), requestId: Z }).strict(),
  Db,
  Ab,
  jb,
  Mb,
  Nb,
  Pb,
  Fb,
  Ib,
  Lb,
  Rb,
  zb,
  Bb,
  Vb,
  Hb,
  Ub,
  Wb,
  Gb,
  Yb,
  Xb,
  Zb,
  Qb,
  $b,
  ex,
  tx,
  nx,
  rx,
]);
var ax = O({ type: N(`remote-workspace-connected`), requestId: Z, descriptor: Ob }).strict(),
  ox = O({
    type: N(`remote-workspace-connection-log`),
    requestId: Z,
    level: M([`info`, `warn`, `error`]),
    message: Z,
  }).strict(),
  sx = O({ type: N(`remote-workspace-connect-failed`), requestId: Z, error: Z }).strict(),
  cx = O({
    type: N(`remote-workspace-closed`),
    remoteSessionId: Z,
    reason: M([`connection-closed`, `disposed`, `connect-cancelled`]),
    exitCode: w().int().nullable().optional(),
    signal: S().nullable().optional(),
    error: S().optional(),
  }).strict(),
  lx = O({ type: N(`log`), level: M([`info`, `warn`, `error`]), source: S(), message: S() }),
  ux = M([`claudeCode`]),
  dx = O({
    type: N(`agent-process-spawned`),
    lane: Z.optional(),
    pid: w().int().positive(),
    provider: Eu,
    workspacePath: Z,
    command: S(),
    args: D(S()),
    startedAt: w().int().nonnegative(),
    runtimeGeneration: w().int().positive().optional(),
    runtimeInstanceId: Z.optional(),
  }),
  fx = O({
    type: N(`agent-process-ready`),
    lane: Z.optional(),
    pid: w().int().positive(),
    provider: Eu,
    workspacePath: Z,
    readyAt: w().int().nonnegative(),
    startupDurationMs: w().int().nonnegative(),
    runtimeGeneration: w().int().positive(),
    runtimeInstanceId: Z,
  }),
  px = O({
    type: N(`agent-process-exited`),
    lane: Z.optional(),
    pid: w().int().positive(),
    provider: Eu,
    workspacePath: Z,
    exitCode: w().int().nullable(),
    signal: S().nullable(),
    endedAt: w().int().nonnegative(),
    terminationKind: M([`expected`, `unexpected`, `watchdog_recycle`]),
    terminationReason: S().optional(),
    runtimeReady: T().optional(),
    runtimeGeneration: w().int().positive(),
    runtimeInstanceId: Z.optional(),
    uptimeMs: w().int().nonnegative(),
    stderrLineCount: w().int().nonnegative(),
    stderrTail: D(S().max(1100)).max(20).optional(),
  }),
  mx = O({
    type: N(`agent-process-error`),
    lane: Z.optional(),
    pid: w().int().positive().nullable(),
    provider: Eu,
    workspacePath: Z,
    command: S(),
    args: D(S()),
    errorName: Z,
    errorCode: S().optional(),
    errorMessage: S(),
    errorStack: S().optional(),
    runtimeGeneration: w().int().positive(),
    runtimeInstanceId: Z.optional(),
    occurredAt: w().int().nonnegative(),
  }),
  hx = O({
    type: N(`agent-process-exception`),
    lane: Z.optional(),
    pid: w().int().positive(),
    provider: Eu,
    workspacePath: Z,
    runtimeGeneration: w().int().positive(),
    runtimeInstanceId: Z,
    diagnostic: kl,
  }).strict(),
  gx = M(_u),
  _x = Kg.extend({ lane: gx.optional() }).strict(),
  vx = S().regex(/^[a-f0-9]{64}$/),
  yx = O({
    type: N(`agent-resource-sample`),
    runtimeSurface: M([`local`, `remote`]),
    environmentKey: vx.optional(),
    sample: _x,
  }).strict(),
  bx = O({
    cpuPercent: w().finite().nonnegative().max(1e5),
    rssKb: w()
      .finite()
      .nonnegative()
      .max(2 ** 53 - 1),
    heapUsedKb: w()
      .finite()
      .nonnegative()
      .max(2 ** 53 - 1),
  }).strict();
O({
  heapUsedKb: w()
    .finite()
    .nonnegative()
    .max(2 ** 53 - 1),
}).strict();
var xx = O({ type: N(`host-resource-sample`), sample: bx }).strict(),
  Sx = O({
    type: N(`mcp-resource-samples`),
    runtimeSurface: M([`local`, `remote`]),
    environmentKey: vx.optional(),
    samples: Wg,
  }).strict(),
  Cx = O({
    type: N(`tool-exec-resource`),
    runtimeSurface: M([`local`, `remote`]),
    sample: Gg,
  }).strict(),
  wx = O({ type: N(`mcp-telemetry`), runtimeSurface: M([`local`, `remote`]), event: Ug }).strict(),
  Tx = O({ type: N(`session-create-telemetry`), event: Tl }).strict(),
  Ex = O({
    type: N(`agent-running-task-count-changed`),
    runningTaskCount: w().int().nonnegative(),
  }),
  Dx = O({
    type: N(`workspace-running-task-count-changed`),
    workspacePath: Z,
    workspaceIdentity: Z.optional(),
    runningTaskCount: w().int().nonnegative(),
  }),
  Ox = O({
    type: N(`cua-operation-state`),
    active: T(),
    sessionId: Z,
    turnId: Z,
    workspacePath: Z,
    workspaceIdentity: Z.optional(),
  }).strict(),
  kx = O({ type: N(`broadcast-claim-request`), requestId: Z, key: Z.max(1024) }),
  Ax = O({ type: N(`broadcast-claim-commit`), key: Z.max(1024), claimToken: Z }),
  jx = O({ type: N(`broadcast-claim-release`), key: Z.max(1024), claimToken: Z }),
  Mx = O({ type: N(`task-realtime-publish`), event: lb }),
  Nx = O({ type: N(`task-stream-op-publish`), target: Gy, op: Hy }),
  Px = O({ type: N(`task-run-lease-acquire`), request: Jy }),
  Fx = O({ type: N(`task-run-lease-release`), target: qy }),
  Ix = O({ type: N(`task-owner-command-request`), command: ab }),
  Lx = O({ type: N(`task-owner-command-result`), result: cb }),
  Rx = O({
    type: N(`bot-remote-workspace-reconnect-request`),
    requestId: Z,
    workspacePath: Z,
    workspaceIdentity: Z,
    target: Cb,
  }),
  zx = O({
    type: N(`bot-remote-workspace-connection-status-request`),
    requestId: Z,
    workspacePath: Z,
    workspaceIdentity: Z,
    target: Cb,
  }),
  Bx = O({
    type: N(`bot-remote-workspace-runtime-port-request`),
    requestId: Z,
    workspacePath: Z,
    workspaceIdentity: Z,
    target: Cb,
  }),
  Vx = O({ type: N(`session-message-send-requested`), request: Kb }),
  Hx = O({ type: N(`session-route-announce`), route: Jb }),
  Ux = O({ type: N(`session-message-deliver-result`), result: qb }),
  Wx = O({ type: N(`feedback-log-archive-request`), requestId: Z, sourceDir: Z }),
  Gx = O({
    type: N(`cron-run-result`),
    runId: Z,
    ok: T(),
    taskId: S().optional(),
    sessionId: S().optional(),
    error: S().optional(),
    failureKind: M([`transient`, `permanent`]).optional(),
  }),
  Kx = O({
    type: N(`off-peak-run-result`),
    offPeakTaskId: Z,
    ok: T(),
    conversationId: S().optional(),
    sessionId: S().optional(),
    error: S().optional(),
    failureKind: M([`transient`, `permanent`]).optional(),
  }),
  qx = O({ type: N(`cron-scheduler-wake-request`), automationId: Z }),
  Jx = O({ type: N(`off-peak-scheduler-wake-request`), offPeakTaskId: S().optional() }),
  Yx = O({
    type: N(`browser-execute-request`),
    requestId: Z,
    browserId: Z.optional(),
    browserGeneration: w().int().nonnegative().optional(),
    sessionId: Z,
    turnId: Z.optional(),
    workspaceKey: Z.optional(),
    workspacePath: Z.optional(),
    workspaceIdentity: Z.optional(),
    remoteSessionId: Z.optional(),
    clientMode: M([`desktop-continuous`, `web-remote-replayable`]).optional(),
    sessionContext: M([`live`, `cached`]).optional(),
    command: $l,
  }),
  Xx = O({ type: N(`local-media-preview-path-authorize-request`), requestId: Z, path: Z }).strict(),
  Zx = O({
    transport: M([`http`, `websocket`, `rpc`]),
    interface: S(),
    durationMs: w(),
    ok: T(),
    statusCode: w().optional(),
    errorKind: S().optional(),
    attempt: w().int().positive().optional(),
    dnsMs: w().optional(),
    tcpMs: w().optional(),
    tlsMs: w().optional(),
    ttfbMs: w().optional(),
    downloadMs: w().optional(),
  }),
  Qx = O({ type: N(`network-telemetry-batch`), observations: D(Zx).max(500) }),
  $x = O({
    type: N(`provider-provisioning-source-changed`),
    trigger: Nu.exclude([`environment-online`]),
  }).strict(),
  eS = O({
    type: N(`provider-provisioning-execution-result`),
    requestId: Z,
    environmentKey: Z,
    status: M([`applied`, `already-applied`, `unsupported`, `failed`, `rollback_failed`]),
    error: S().optional(),
  }).strict(),
  tS = O({
    pid: w().int().positive(),
    name: Z,
    category: M([`base`, `builtin-plugin`, `community-plugin`]),
    groupKey: Z,
    groupLabel: Z,
    cpuPercent: w().finite().nonnegative(),
    memoryBytes: w().finite().nonnegative(),
  }).strict(),
  nS = O({
    type: N(`resource-usage-snapshot-result`),
    requestId: Z,
    sampledAt: w().int().nonnegative(),
    processes: D(tS).max(1e4),
  }).strict();
A(`type`, [
  O({ type: N(`database-startup-state`), state: Sl }).strict(),
  nS,
  ox,
  ax,
  sx,
  cx,
  lx,
  dx,
  fx,
  px,
  mx,
  hx,
  yx,
  xx,
  wx,
  Sx,
  Cx,
  Tx,
  Ex,
  Dx,
  Ox,
  Lb,
  kx,
  Ax,
  jx,
  Mx,
  Nx,
  Px,
  Fx,
  Ix,
  Lx,
  Rx,
  zx,
  Bx,
  Vx,
  Hx,
  Ux,
  Wx,
  Yx,
  Xx,
  Qx,
  $x,
  eS,
  Gx,
  Kx,
  qx,
  Jx,
]);
var rS = M([`running`, `completed`, `error`]),
  iS = A(`kind`, [
    O({
      kind: N(`image`),
      filename: S(),
      mimeType: S(),
      sizeBytes: w().int().nonnegative().optional(),
      dataBase64: S().optional(),
      localPath: S().optional(),
    }),
    O({
      kind: N(`video`),
      filename: S(),
      mimeType: S(),
      sizeBytes: w().int().nonnegative().optional(),
      dataBase64: S().optional(),
      localPath: S().optional(),
    }),
    O({
      kind: N(`pdf`),
      filename: S(),
      mimeType: S(),
      sizeBytes: w().int().nonnegative().optional(),
      dataBase64: S().optional(),
      localPath: S().optional(),
    }),
    O({
      kind: N(`file`),
      filename: S(),
      mimeType: S(),
      sizeBytes: w().int().nonnegative(),
      dataBase64: S().optional(),
      textContent: S().optional(),
      localPath: S().optional(),
    }),
  ]),
  aS = O({
    toolName: S().optional(),
    title: S().optional(),
    kind: S().optional(),
    status: M([`completed`, `failed`, `denied`, `stopped`]).optional(),
    input: E(),
    output: E().optional(),
    error: S().optional(),
    raw: E().optional(),
    snapshotRefs: D(
      O({
        field: M([`input`, `output`, `raw`]),
        refId: S(),
        hash: S(),
        fullBytes: w().int().nonnegative(),
        previewBytes: w().int().nonnegative(),
      }),
    ).optional(),
  }),
  oS = A(`type`, [
    O({ type: N(`content`), content: S() }),
    O({ type: N(`thought`), content: S() }),
    O({ type: N(`tool-call`), toolIndex: w().int().nonnegative() }),
  ]),
  sS = O({
    id: S().optional(),
    role: M([`user`, `assistant`]),
    content: S(),
    timestamp: w().int().nonnegative(),
    model: S().optional(),
    characterCount: w().int().nonnegative().optional(),
    durationMs: w().int().nonnegative().optional(),
    interrupted: T().optional(),
    feedback: M([`like`, `dislike`]).optional(),
    attachments: D(iS).optional(),
    tools: D(aS).optional(),
    thought: S().optional(),
    parts: D(oS).optional(),
    checkpointState: M([`partial`]).optional(),
    checkpointReason: M([`tool_completed`, `part_boundary`, `periodic`]).optional(),
    checkpointUpdatedAt: w().int().nonnegative().optional(),
    turnIndex: w().int().nonnegative().optional(),
    bodyRefs: D(
      O({
        field: M([`content`, `thought`]),
        refId: S(),
        hash: S(),
        fullBytes: w().int().nonnegative(),
        previewBytes: w().int().nonnegative(),
      }),
    ).optional(),
    toolSlice: O({
      persistedMessageIndex: w().int().nonnegative(),
      totalTools: w().int().nonnegative(),
      startToolIndex: w().int().nonnegative(),
      endToolIndexExclusive: w().int().nonnegative(),
    }).optional(),
  }),
  cS = M([`active`, `paused`, `budget_limited`, `complete`]),
  lS = M([
    `set`,
    `status_updated`,
    `cleared`,
    `usage_accounted`,
    `run_started`,
    `run_finished`,
    `summary_updated`,
  ]),
  uS = M([`command`, `tool`, `runtime`]),
  dS = O({
    sessionID: Z,
    targetID: Z,
    objective: Z,
    summaryTitle: S().min(1).nullable().default(null),
    status: cS,
    tokenBudget: w().int().positive().nullable(),
    tokensUsed: w().int().nonnegative(),
    timeUsedSeconds: w().int().nonnegative(),
    activeInputId: Z.nullable().optional(),
    activeRunStartedAtMs: w().int().nonnegative().nullable().optional(),
    activeRunLastSeenAtMs: w().int().nonnegative().nullable().optional(),
    time: O({ created: w().int().nonnegative(), updated: w().int().nonnegative() }),
  });
O({ action: lS, source: uS, target: dS.nullable(), previousTarget: dS.nullable().optional() });
var fS = O({
    taskId: Z,
    traceId: Z,
    title: S(),
    titleOverridden: T().optional(),
    workspacePath: Z,
    workspaceIdentity: Z.optional(),
    workspacePurpose: M([`project`, `conversation`]).optional(),
    createdAt: w().int().nonnegative(),
    updatedAt: w().int().nonnegative(),
    mode: dg,
    model: S().optional(),
    thoughtLevel: Z.optional(),
    runtimeEpoch: w().int().nonnegative().optional(),
    provider: Eu.optional(),
    migrationSource: ux.optional(),
    forkedFromTaskId: Z.optional(),
    cronAutomationId: Z.optional(),
    offPeakTaskId: Z.optional(),
    unreadAt: w().int().nonnegative().optional(),
    status: rS.optional(),
    lastError: O({
      code: S().optional(),
      detail: S().optional(),
      message: S().min(1),
      traceId: Z.optional(),
      taskId: Z.optional(),
      attribution: fp.optional(),
    }).optional(),
    repairState: O({
      claudeNativeSnapshotAssistantContentVersion: w().int().nonnegative().optional(),
      codexNativeSnapshotSubagentToolsVersion: w().int().nonnegative().optional(),
    }).optional(),
    changeSummary: O({
      fileCount: w().int().nonnegative(),
      added: w().int().nonnegative(),
      removed: w().int().nonnegative(),
      files: D(
        O({
          path: S(),
          added: w().int().nonnegative(),
          removed: w().int().nonnegative(),
          writeCount: w().int().positive(),
          lastTurnIndex: w().int().nonnegative(),
        }),
      ),
    }).optional(),
    target: dS.nullable().optional(),
  }),
  pS = M([`idle`, `syncing`, `ready`, `stale`, `failed`]);
O({ provider: Eu, sessionId: Z, lastSyncedTurnIndex: w().int(), state: pS });
var mS = O({ workspaceHash: Z, taskId: Z });
O({ version: N(`1`), tasks: D(mS) });
var hS = O({
    path: S(),
    beforeContent: S().nullable(),
    afterContent: S(),
    writeCount: w().int().positive(),
    contentRefs: D(
      O({
        field: M([`beforeContent`, `afterContent`]),
        refId: S(),
        hash: S(),
        fullBytes: w().int().nonnegative(),
        previewBytes: w().int().nonnegative(),
      }),
    ).optional(),
  }),
  gS = O({
    turnIndex: w().int().nonnegative(),
    snapshots: D(hS),
    fileState: M([`applied`, `reverted`]).optional(),
  }),
  _S = O({
    turnIndex: w().int().nonnegative(),
    baseFileCheckpointId: Z,
    resultFileCheckpointId: Z.optional(),
  });
O({ meta: fS, messages: D(sS), fileChanges: D(gS).optional(), turnCheckpoints: D(_S).optional() });
var vS = `remote:`,
  yS = { ssh: 3, wsl: 1, docker: 1, server: 1 };
function bS(e) {
  return e === `ssh` || e === `wsl` || e === `docker` || e === `server`;
}
function xS(e) {
  return `/${e
    .replace(/\\/g, `/`)
    .replace(/\/+/g, `/`)
    .replace(/^\/+|\/+$/g, ``)}`;
}
function SS(e) {
  let t = e
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, `-`)
    .replace(/^-+|-+$/g, ``);
  if (!t) throw Error(`serverId must contain at least one identity-safe character`);
  return t;
}
function CS(e) {
  return `${vS}server:${SS(e.serverId)}:${xS(e.workspacePath)}`;
}
function wS(e) {
  if (!e.startsWith(vS)) return null;
  let t = e.slice(7),
    n = t.indexOf(`:`);
  if (n <= 0) return null;
  let r = t.slice(0, n);
  if (!bS(r)) return null;
  let i = n + 1;
  for (let e = 0; e < yS[r]; e++) {
    let e = t.indexOf(`:`, i);
    if (e <= i) return null;
    i = e + 1;
  }
  if (r === `wsl` && t[i] !== `/`) {
    let e = t.indexOf(`:`, i);
    if (e <= i) return null;
    i = e + 1;
  }
  let a = t.slice(i);
  return a.startsWith(`/`) ? { kind: r, workspacePath: a } : null;
}
function TS(e) {
  return wS(e) !== null;
}
var ES = `model-only`,
  DS = `fork`,
  OS = `<system-reminder source="goal-continuation">`,
  kS = `Continue working toward the active session goal.`,
  AS = `Current session goal state`,
  jS = `<task-notification>`,
  MS = `<subagent-notification>`,
  NS = [`Conversation rewind applied.`, `Workspace rewind applied.`],
  PS = new Set([
    `agent_control_message`,
    `background_task`,
    `goal-continuation`,
    `goal_completion_verification`,
    `goal_state_change`,
    `plugin_reference`,
    `queued_system_notification`,
    `resume_goal_state`,
    `resume_referenced_session_context`,
    `rewind`,
    `selection_side_chat`,
    `subagent`,
    `subagent_message`,
    `target_continuation`,
    `task_notification`,
    `task_status`,
    `todo_reminder`,
  ]);
function FS(e) {
  let t = e.info,
    n = e.parts ?? [],
    r = t.semantics;
  if (r?.kind === `compact_summary` || t.summary !== void 0) return `providerContextOnly`;
  if (r) {
    if (r.kind === `timeline_event`) return `timelineOnly`;
    if (r.origin === `real_user` && t.synthetic !== !0 && t.visibility !== ES)
      return `realUserInput`;
    if (
      t.role === `assistant` &&
      r.kind === `assistant_response` &&
      r.uiVisibility === `visible` &&
      r.transcriptVisibility === `visible`
    )
      return `visibleAssistant`;
    if (r.providerVisibility === `visible`) return `providerContextOnly`;
    if (r.kind === `fork_notice`) return `timelineOnly`;
    if (
      r.origin === `agent_runtime` ||
      r.uiVisibility === `hidden` ||
      r.transcriptVisibility === `hidden`
    )
      return `hiddenSynthetic`;
  }
  if (t.visibility === ES || LS(n)) return `providerContextOnly`;
  if (IS(t, n)) return `timelineOnly`;
  let i = RS(t, n);
  return i === DS
    ? `timelineOnly`
    : (i && PS.has(i)) ||
        zS(n) ||
        ((t.synthetic === !0 || n.some((e) => e.synthetic === !0)) && BS(n))
      ? `providerContextOnly`
      : t.synthetic === !0 || n.some((e) => e.synthetic === !0)
        ? `hiddenSynthetic`
        : t.role === `assistant`
          ? `visibleAssistant`
          : `realUserInput`;
}
function IS(e, t) {
  if (e.semantics?.kind === `timeline_event`) return !0;
  let n = US(e.metadata);
  return e.source === DS || WS(n?.source) === DS
    ? !0
    : t.some((e) => {
        let t = US(e.metadata);
        return (
          e.type === `timeline` ||
          HS(t) ||
          (e.type === `compaction` &&
            (typeof t?.timelineStatus == `string` || typeof e.summaryMessageId == `string`))
        );
      });
}
function LS(e) {
  return e.some((e) => {
    let t = US(e.metadata);
    return t?.visibility === ES || WS(t?.source) === `goal-continuation`;
  });
}
function RS(e, t) {
  let n = US(e.metadata);
  return (
    e.source ??
    WS(n?.source) ??
    e.semantics?.source ??
    t.map((e) => WS(US(e.metadata)?.source)).find((e) => !!e)
  );
}
function zS(e) {
  let t = VS(e).trimStart();
  return (
    t.startsWith(OS) ||
    (t.startsWith(`<system-reminder>`) && (t.includes(kS) || t.includes(AS))) ||
    NS.some((e) => t.includes(e))
  );
}
function BS(e) {
  let t = VS(e).trimStart();
  return t.startsWith(jS) || t.startsWith(MS);
}
function VS(e) {
  return e
    .filter((e) => e.type === `text` && e.ignored !== !0)
    .map((e) => e.text ?? ``)
    .join(``);
}
function HS(e) {
  let t = US(e)?.forkContext;
  return typeof t == `object` && !!t && !Array.isArray(t) && t.kind === `session_fork`;
}
function US(e) {
  return e && typeof e == `object` && !Array.isArray(e) ? e : void 0;
}
function WS(e) {
  return typeof e == `string` && e.length > 0 ? e : void 0;
}
var GS = `<system-reminder source="goal-continuation">`,
  KS = `Continue working toward the active session goal.`,
  qS = `Current session goal state`,
  JS = `subagent_message`;
function YS(e) {
  let t = e.trimStart();
  return t.startsWith(GS) ? !0 : t.startsWith(`<system-reminder>`) && t.includes(KS);
}
function XS(e) {
  return (
    e.info.role === `user` &&
    (e.info.source === `goal-continuation` ||
      String(e.info.metadata?.source ?? ``) === `goal-continuation` ||
      YS(Rd(e.parts)))
  );
}
function ZS(e) {
  let t = e.trimStart();
  return t.startsWith(`<system-reminder>`) && t.includes(qS);
}
function QS(e) {
  return e.info.role === `user` && (XS(e) || ZS(Rd(e.parts)));
}
function $S(e) {
  if (
    e.info.role === `user` &&
    (String(e.info.source ?? ``) === JS ||
      String(e.info.metadata?.source ?? ``) === JS ||
      e.parts.some((e) => e.type === `text` && String(e.metadata?.source ?? ``) === JS))
  )
    return !0;
  let t = FS(e);
  return t === `providerContextOnly` || t === `hiddenSynthetic`;
}
function eC(e) {
  return (
    e.info.role === `user` &&
    e.parts.some((e) =>
      e.type === `compaction` ? typeof e.metadata?.timelineStatus != `string` : !1,
    )
  );
}
function tC(e, t = {}) {
  let n = [];
  for (let t of e) $S(t) || eC(t) || n.push(t);
  return n;
}
function nC(e) {
  let t = e.title?.trim() ?? ``;
  if (t && !YS(t) && !ZS(t)) return t;
  let n = Rd(
    e.messages.find((e) => e.info.role === `user` && FS(e) === `realUserInput` && !QS(e))?.parts ??
      [],
  ).trim();
  if (n) return n.slice(0, 80);
  let r = e.target?.objective.trim() ?? ``;
  return r ? r.slice(0, 80) : (e.fallback ?? `New session`);
}
var rC = { "zh-CN": `/cn`, "en-US": `` },
  iC = /^\/(cn\/)?share\/([^/]+)\/?$/u;
function aC(e) {
  let t = iC.exec(e);
  return t ? { rawCode: t[2], locale: t[1] ? `zh-CN` : `en-US` } : null;
}
function oC(e, t) {
  let n;
  try {
    n = new URL(e);
  } catch {
    return e;
  }
  let r = aC(n.pathname);
  return r ? ((n.pathname = `${rC[t]}/share/${r.rawCode}`), n.toString()) : e;
}
var sC = M([`private`, `public_readonly`, `public_importable`]),
  cC = w().int().positive();
function lC(e) {
  return e <= 1;
}
function uC(e) {
  let t = [],
    n = [],
    r = 0;
  for (let i of e) {
    let e = Xf.safeParse(i);
    if (e.success) {
      t.push(e.data);
      continue;
    }
    r += 1;
    let a = i?.kind,
      o = typeof a == `string` && a.trim() ? a.trim() : `unknown`;
    n.includes(o) || n.push(o);
  }
  return { rows: t, unsupportedCount: r, unsupportedKinds: n };
}
var dC = S().regex(/^[0-9a-f]{64}$/u),
  fC = {
    artifact_id: S().trim().min(1),
    logical_artifact_key: S().trim().min(1),
    producer_product_turn_id: S().trim().min(1),
    artifact_version: w().int().positive(),
    state: N(`current`),
    ref: S().regex(/^zcode-artifact:\/\/share\/[A-Za-z0-9._~-]+$/u),
    artifact_type: Uf,
    display_name: S().trim().min(1),
    original_path: S().min(1).optional(),
    extension: S().trim().min(1),
    mime_type: S().trim().min(1),
    size_bytes: w().int().nonnegative(),
    sha256: dC,
  };
O(fC).strict();
var pC = O(fC),
  mC = O({
    type: S().trim().min(1),
    extensions: D(S().trim().min(1)),
    mime_types: D(S().trim().min(1)),
  }),
  hC = {
    ttl_ms: w().int().positive(),
    max_rows: w().int().positive(),
    max_payload_bytes: w().int().positive(),
    max_artifact_count: w().int().nonnegative(),
    max_artifact_bytes: w().int().positive(),
    max_total_artifact_bytes: w().int().positive(),
  };
(O({ ...hC, schema_version: cC, access_modes: D(S().trim().min(1)), allowed_artifacts: D(mC) }),
  O({
    ...hC,
    schema_version: cC,
    access_modes: D(sC),
    allowed_artifacts: D(
      O({ type: Uf, extensions: D(S().trim().min(1)), mime_types: D(S().trim().min(1)) }).strict(),
    ),
  }).strict());
var gC = O({
  share_code: S().trim().min(1),
  share_url: S().url(),
  access_mode: sC,
  expires_at: w().int().nonnegative(),
});
O({
  client_request_id: S().trim().min(1),
  title: S().trim().min(1),
  schema_version: N(1),
  access_mode: sC,
  payload_sha256: dC,
  artifact_count: w().int().nonnegative(),
}).strict();
var _C = {
  preparation_id: S().trim().min(1),
  access_mode: sC,
  expires_at: w().int().nonnegative(),
};
(A(`status`, [
  O({ ..._C, status: N(`preparing`) }),
  O({ ..._C, status: N(`confirmed`), share: gC }),
]),
  O({
    artifact_id: S().trim().min(1),
    size_bytes: w().int().nonnegative(),
    sha256: dC,
    status: N(`uploaded`),
    safety_status: S().trim().min(1),
  }));
var vC = { projection_sha256: dC, artifact_set_sha256: dC },
  yC = O(vC),
  bC = O(vC).strict();
O({
  selected_product_turn_ids: D(S().trim().min(1)).min(1),
  projection: O({ rows: D(Xf).min(1) }).strict(),
  integrity: bC,
  disclosure_confirmation: O({
    version: N(1),
    accepted_at: w().int().nonnegative(),
    acknowledged_no_secret_detection: N(!0),
  }).strict(),
}).strict();
var xC = O({
    title: S(),
    access_mode: sC,
    created_at: w().int().nonnegative(),
    expires_at: w().int().nonnegative(),
  }),
  SC = pC.extend({ url: S().url(), url_expires_at: w().int().nonnegative() }),
  CC = O({ schema_version: cC, share: xC, rows: D(E()), artifacts: D(SC), integrity: yC });
O({ schema_version: N(1), client_request_id: S().trim().min(1) }).strict();
var wC = pC.extend({ download_url: S().url(), download_url_expires_at: w().int().nonnegative() });
O({
  schema_version: cC,
  import_grant_id: S().trim().min(1),
  import_grant_expires_at: w().int().nonnegative(),
  share: xC.extend({ share_id: S().trim().min(1) }),
  rows: D(E()),
  artifacts: D(wC),
  integrity: yC,
});
var TC = k([
    N(3001),
    N(3002),
    N(3200),
    N(3201),
    N(3203),
    N(3204),
    N(3205),
    N(3206),
    N(3207),
    N(3208),
    N(3209),
    N(3210),
    N(3211),
    N(3212),
    N(3213),
    N(3214),
    N(3215),
  ]),
  EC = O({ code: w().int(), msg: S() });
function DC(e) {
  return O({ code: N(0), msg: S(), data: e });
}
var OC = [
  { extension: `.mp4`, kind: `video`, mediaType: `video/mp4` },
  { extension: `.mov`, kind: `video`, mediaType: `video/quicktime` },
  { extension: `.webm`, kind: `video`, mediaType: `video/webm` },
  { extension: `.m4v`, kind: `video`, mediaType: `video/x-m4v` },
  { extension: `.mp3`, kind: `audio`, mediaType: `audio/mpeg` },
  { extension: `.wav`, kind: `audio`, mediaType: `audio/wav` },
  { extension: `.m4a`, kind: `audio`, mediaType: `audio/mp4` },
  { extension: `.ogg`, kind: `audio`, mediaType: `audio/ogg` },
  { extension: `.opus`, kind: `audio`, mediaType: `audio/opus` },
  { extension: `.flac`, kind: `audio`, mediaType: `audio/flac` },
  { extension: `.weba`, kind: `audio`, mediaType: `audio/webm` },
];
function kC(e) {
  let t = e.replace(/\\/g, `/`).toLowerCase();
  return OC.find(({ extension: e }) => t.endsWith(e)) ?? null;
}
var AC = [
    { extensions: [`.md`], kind: `markdown`, mimeType: `text/markdown`, artifactType: `md` },
    { extensions: [`.html`, `.htm`], kind: `html`, mimeType: `text/html`, artifactType: `html` },
    {
      extensions: [`.docx`],
      kind: `docx`,
      mimeType: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
      artifactType: `docx`,
    },
    {
      extensions: [`.xlsx`],
      kind: `xlsx`,
      mimeType: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
      artifactType: `xlsx`,
    },
    {
      extensions: [`.pptx`],
      kind: `pptx`,
      mimeType: `application/vnd.openxmlformats-officedocument.presentationml.presentation`,
      artifactType: `pptx`,
    },
    { extensions: [`.pdf`], kind: `pdf`, mimeType: `application/pdf`, artifactType: `pdf` },
    ...OC.map(({ extension: e, kind: t, mediaType: n }) => ({
      extensions: [e],
      kind: t,
      mimeType: n,
      artifactType: t,
    })),
  ],
  jC = /\bfile:\/\/[^\s<>()\]`"'*，。！？；：、]+/giu,
  MC = /:{1,2}zcode-file-citation\{([^}]*)\}/giu,
  NC = /\[([^\]\n]*)\]\(([^)\n]+)\)/g,
  PC =
    /([`"'])([^`"'\r\n]+?\.(?:md|html?|docx|xlsx|pptx|pdf|mp4|mov|webm|m4v|mp3|wav|m4a|ogg|opus|flac|weba)(?::\d+(?::\d+)?)?)\1/giu,
  FC =
    /(?:^|[\s("'`,.;:!?，。！？；：、])((?:(?:\.{1,2}[\\/]|[a-zA-Z]:[\\/]|\/|[\p{L}\p{N}\p{M}\p{S}_.@()-]+[\\/])[\p{L}\p{N}\p{M}\p{S}_.@() -]+?(?:[\\/][\p{L}\p{N}\p{M}\p{S}_.@() -]+?)*|[\p{L}\p{N}\p{M}\p{S}_.@()-]+)\.(?:md|html?|docx|xlsx|pptx|pdf|mp4|mov|webm|m4v|mp3|wav|m4a|ogg|opus|flac|weba)(?::\d+(?::\d+)?)?)(?=$|[\s)"'`,.;:!?，。！？；：、])/giu;
function IC(e) {
  return e.replace(/\\/gu, `/`);
}
function LC(e) {
  return e
    .trim()
    .replace(/[.,;!?，。！？；：、]+$/gu, ``)
    .replace(/:\d+(?::\d+)?$/u, ``);
}
function RC(e) {
  try {
    return decodeURI(e);
  } catch {
    return e;
  }
}
function zC(e) {
  try {
    let t = new URL(e);
    if (t.protocol !== `file:`) return null;
    let n = RC(t.pathname);
    return /^\/[a-zA-Z]:\//u.test(n)
      ? n.slice(1)
      : t.hostname && t.hostname !== `localhost`
        ? `//${t.hostname}${n}`
        : n;
  } catch {
    return null;
  }
}
function BC(e) {
  return e.startsWith(`/`) || /^[a-zA-Z]:[\\/]/u.test(e) || e.startsWith(`\\\\`);
}
function VC(e) {
  let t = [];
  for (let n of IC(e).split(`/`))
    if (!(!n || n === `.`)) {
      if (n === `..`) {
        if (t.length === 0) return null;
        t.pop();
        continue;
      }
      t.push(n);
    }
  return t.join(`/`);
}
function HC(e) {
  let t = IC(e).replace(/\/{2,}/gu, `/`),
    n = t.startsWith(`/`) ? `/` : ``,
    r = [];
  for (let e of t.split(`/`))
    if (!(!e || e === `.`)) {
      if (e === `..`) {
        r.pop();
        continue;
      }
      r.push(e);
    }
  return `${n}${r.join(`/`)}`;
}
function UC(e, t) {
  let n = LC(t);
  if (!n || /^~[\\/]/u.test(n)) return null;
  let r = /^file:\/\//iu.test(n) ? zC(n) : n;
  if (!r) return null;
  if (BC(r)) return HC(r);
  let i = VC(r);
  return i === null ? null : `${HC(e).replace(/\/$/u, ``)}/${i}`;
}
function WC(e) {
  let t = LC(e).toLowerCase();
  return AC.find((e) => e.extensions.some((e) => t.endsWith(e))) ?? null;
}
function GC(e) {
  return IC(e).replace(/\/+$/u, ``).split(`/`).filter(Boolean).at(-1) ?? e;
}
function KC(e, t) {
  let n = HC(e).replace(/\/$/u, ``),
    r = HC(t).replace(/\/$/u, ``);
  return n === r || n.startsWith(`${r}/`);
}
function qC(e, t, n) {
  return n.some(([n, r]) => e < r && t > n);
}
function JC(e, t) {
  return RegExp(`${t}\\s*=\\s*["']([^"']+)["']`, `iu`).exec(e)?.[1]?.trim() || void 0;
}
function YC(e, t) {
  if (!e.trim()) return [];
  let n = [],
    r = [],
    i = (e, r, i) => {
      let a = UC(t, e),
        o = a ? WC(a) : null;
      !a || !o || n.push({ start: r, end: i, kind: o.kind, path: a, raw: e });
    };
  for (let i of e.matchAll(MC)) {
    let e = i[0] ?? ``,
      a = i.index ?? 0,
      o = a + e.length;
    r.push([a, o]);
    let s = JC(i[1] ?? ``, `path`);
    if (!s) continue;
    let c = JC(i[1] ?? ``, `artifact_kind`)?.toLowerCase(),
      l = UC(t, s),
      u = l ? WC(l) : null,
      d =
        u?.kind === `docx` ||
        u?.kind === `xlsx` ||
        u?.kind === `pptx` ||
        u?.kind === `pdf` ||
        u?.kind === `video` ||
        u?.kind === `audio`
          ? u.kind
          : null,
      f =
        c === `document`
          ? `docx`
          : c === `presentation`
            ? `pptx`
            : c === `workbook`
              ? `xlsx`
              : void 0;
    l && d && (f === void 0 || f === d) && n.push({ start: a, end: o, kind: d, path: l, raw: s });
  }
  for (let t of e.matchAll(NC)) {
    let e = (t[2] ?? ``).trim().replace(/^<|>$/gu, ``),
      n = t.index ?? 0,
      a = n + (t[0]?.length ?? 0);
    qC(n, a, r) || (r.push([n, a]), i(e, n, a));
  }
  for (let t of e.matchAll(jC)) {
    let e = LC(t[0] ?? ``),
      n = t.index ?? 0,
      a = n + (t[0]?.length ?? 0);
    qC(n, a, r) || (r.push([n, a]), i(e, n, a));
  }
  for (let t of e.matchAll(PC)) {
    let e = (t[2] ?? ``).trim(),
      n = t.index ?? 0,
      a = n + (t[0]?.length ?? e.length);
    !e ||
      qC(n, a, r) ||
      (r.push([n, a]), i(e, n + (t[0]?.indexOf(e) ?? 0), n + (t[0]?.indexOf(e) ?? 0) + e.length));
  }
  for (let t of e.matchAll(FC)) {
    let e = t[1] ?? ``,
      n = t[0] ?? e,
      a = (t.index ?? 0) + n.lastIndexOf(e),
      o = a + e.length;
    !e || qC(a, o, r) || i(e, a, o);
  }
  let a = new Set();
  return n
    .sort((e, t) => t.start - e.start || t.end - e.end)
    .filter((e) => {
      let t = HC(e.path);
      return a.has(t) ? !1 : (a.add(t), !0);
    })
    .reverse();
}
function XC(e) {
  let t = e.fileChanges ?? [],
    n = new Set(
      t.filter((e) => e.state !== `reverted`).map((t) => HC(UC(e.workspacePath, t.path) ?? t.path)),
    ),
    r = new Set(
      t.filter((e) => e.state === `reverted`).map((t) => HC(UC(e.workspacePath, t.path) ?? t.path)),
    ),
    i = new Set();
  return [...e.references]
    .sort((e, t) => t.start - e.start || t.end - e.end)
    .map((t) => {
      let a = WC(t.path);
      if (!a) return null;
      let o = HC(t.path);
      if (e.enforceWorkspaceBoundary !== !1 && !KC(o, e.workspacePath)) return null;
      let s = t.kind === `markdown` || t.kind === `html`;
      return (s && (!n.has(o) || r.has(o))) || i.has(o)
        ? null
        : (i.add(o),
          {
            artifactType: a.artifactType,
            displayName: GC(t.path),
            mimeType: a.mimeType,
            previewKind: a.kind,
            productTurnId: e.productTurnId,
            sourceKind: `assistant_preview_card`,
            sourceRef: t.path,
            requiresFileChanges: s,
          });
    })
    .filter((e) => e !== null)
    .slice(0, 15);
}
function ZC(e) {
  if (e === `running` || e === `waiting` || e === `paused`) return `running`;
  if (e === `error`) return `error`;
  if (e === `completed`) return `completed`;
}
function QC(e) {
  return e.runtime.activeTurnId ||
    e.runtime.activeTurnKind ||
    (e.projection.pendingPermissions ?? []).length > 0
    ? !0
    : (e.projection.activeToolCalls ?? []).some(
        (e) => e.status === `pending` || e.status === `running`,
      );
}
function $C(e) {
  return QC(e);
}
function ew(e) {
  return e?.trim().toLowerCase().replace(/_/g, `-`) === `tool-calls`;
}
function tw(e) {
  let t = tC(e.messages, { target: e.projection.target }).at(-1);
  return t?.info.role !== `assistant` || ew(t.info.finish)
    ? !1
    : typeof t.info.time.completed == `number`;
}
function nw(e) {
  if (e.projection.lastError) return `error`;
  let t = ZC(e.session.status);
  return t === `error` || t === `completed`
    ? t
    : tw(e) && !QC(e)
      ? `completed`
      : $C(e)
        ? (t ?? `running`)
        : t;
}
var rw = { aws: `AWS`, mcp: `MCP`, zcode: `ZCode` };
function iw(e, t, n) {
  if (n) {
    let t = n[e];
    if (t) return t;
    let r = e.split(`-`)[0];
    if (r) {
      let e = Object.entries(n).find(([e]) => e.split(`-`)[0] === r);
      if (e?.[1]) return e[1];
    }
  }
  return t;
}
function aw(e, t) {
  return e
    .trim()
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((e) => rw[e.toLowerCase()] ?? `${e.charAt(0).toLocaleUpperCase(t)}${e.slice(1)}`)
    .join(` `);
}
function ow(e, t) {
  return iw(t, e.listing?.displayName, e.listing?.displayNameI18n) ?? aw(e.name, t);
}
var sw = `/__zcode_artifact_image__/`,
  cw = /^( {0,3})(`{3,}|~{3,})(.*)$/u,
  lw =
    /!\[[^\]\n]*\]\(\s*(?:<)?(zcode-artifact:\/\/[^\s)>]+)(?:>)?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gu;
function uw(e, t) {
  let n = null,
    r = 0;
  return e
    .split(`
`)
    .map((e) => {
      let i = e.match(cw);
      if (i?.[2]) {
        let t = i[2],
          a = t[0],
          o = i[3] ?? ``;
        return (
          n === a && t.length >= r && o.trim() === ``
            ? ((n = null), (r = 0))
            : !n && (a === `~` || !o.includes("`")) && ((n = a), (r = t.length)),
          e
        );
      }
      return n ? e : t(e);
    }).join(`
`);
}
function dw(e) {
  return uw(e, (e) => e.replace(lw, (e, t) => e.replace(t, `${sw}${encodeURIComponent(t)}`)));
}
function fw(e) {
  if (!e.startsWith(sw)) return null;
  try {
    let t = decodeURIComponent(e.slice(26));
    return t.startsWith(`zcode-artifact://`) ? t : null;
  } catch {
    return null;
  }
}
var pw = O({
  path: S().trim().min(1),
  label: S().trim().min(1).optional(),
  workspaceIdentity: S().trim().min(1).optional(),
});
(O({
  serverId: S().trim().min(1),
  name: S().trim().min(1).optional(),
  version: S(),
  protocolVersion: N(1),
  authRequired: T(),
  workspaces: D(pw),
  capabilities: O({
    desktopContinuous: N(!0),
    websocketRpc: N(!0),
    processResourceTelemetry: T().optional(),
  }),
}),
  O({ capability: S().trim().min(1), expiresAt: w().int().positive() }).strict());
var mw = `login-trigger`,
  hw = `login-menu-item`,
  gw = `login-use-api-key-button`,
  _w = `login-api-key-provider-trigger`,
  vw = `login-api-key-provider-item`,
  yw = `login-api-key-input`,
  bw = `login-api-key-continue-button`,
  xw = `login-api-key-cancel-button`,
  Sw = `login-api-key-skip-button`,
  Cw = `login-api-key-error`,
  ww = `oauth-login-button`,
  Tw = `oauth-cancel`,
  Ew = `oauth-error`,
  Dw = `app-header`,
  Ow = `logout-button`,
  kw = `terminal-toggle`,
  Aw = `side-pane-toggle`,
  jw = `terminal-close-button`,
  Mw = `git-pane`,
  Nw = `browser-address-input`,
  Pw = `browser-back-button`,
  Fw = `browser-forward-button`,
  Iw = `browser-refresh-button`,
  Lw = `browser-responsive-button`,
  Rw = `browser-responsive-viewport`,
  zw = `browser-responsive-toolbar`,
  Bw = `browser-responsive-width-input`,
  Vw = `browser-responsive-height-input`,
  Hw = `browser-responsive-zoom-select`,
  Uw = `browser-responsive-zoom-option`,
  Ww = `browser-responsive-scaled-frame`,
  Gw = `browser-responsive-resize-left`,
  Kw = `browser-responsive-resize-width`,
  qw = `browser-responsive-resize-top`,
  Jw = `browser-responsive-resize-height`,
  Yw = `browser-responsive-resize-corner-top-left`,
  Xw = `browser-responsive-resize-corner-top-right`,
  Zw = `browser-responsive-resize-corner-bottom-left`,
  Qw = `browser-responsive-resize-corner`,
  $w = `browser-element-picker-button`,
  eT = `browser-more-button`,
  tT = `browser-open-external-item`,
  nT = `browser-devtools-button`,
  rT = `browser-webview`,
  iT = `browser-load-error`,
  aT = `browser-load-error-cert-hint`,
  oT = `preview-pane`,
  sT = `tool-summary-trigger`,
  cT = `terminal`,
  lT = `ssh-connect-trigger`,
  uT = `ssh-dialog`,
  dT = `remote-kind-ssh`,
  fT = `remote-kind-server`,
  pT = `remote-kind-wsl`,
  mT = `remote-kind-docker`,
  hT = `ssh-host-input`,
  gT = `ssh-port-input`,
  _T = `ssh-username-input`,
  vT = `ssh-config-alias-select`,
  yT = `ssh-password-input`,
  bT = `ssh-private-key-input`,
  xT = `ssh-auth-password`,
  ST = `ssh-auth-private-key`,
  CT = `wsl-distro-select`,
  wT = `wsl-user-input`,
  TT = `docker-container-select`,
  ET = `docker-container-input`,
  DT = `server-url-input`,
  OT = `server-name-input`,
  kT = `server-token-input`,
  AT = `server-workspace-path-input`,
  jT = `sidebar`,
  MT = `workspace-list`,
  NT = `workspace-item`,
  PT = `workspace-close`,
  FT = `conversation-section`,
  IT = `project-section`,
  LT = `conversation-new-task`,
  RT = `project-add`,
  zT = `composer-workspace-trigger`,
  BT = `composer-remote-connection`,
  VT = `composer-project-detach`,
  HT = `composer-work-outside-project`,
  UT = `chat-error-banner`,
  WT = `chat-error-details-button`,
  GT = `chat-error-hook-icon`,
  KT = `chat-empty`,
  qT = `chat-attachment-button`,
  JT = `chat-attachment-menu-item`,
  YT = `chat-send-button`,
  XT = `chat-loading`,
  ZT = `chat-summary-panel`,
  QT = `chat-assistant-history-trigger`,
  $T = `chat-assistant-history-content`,
  eE = `chat-background-result-title`,
  tE = `chat-tool-call-block`,
  nE = `prompt-suggestion-panel`,
  rE = `prompt-suggestion-section`,
  iE = `prompt-suggestion-option`,
  aE = `prompt-suggestion-status`,
  oE = `task-list`,
  sE = `task-new-button`,
  cE = `task-item`,
  lE = `task-empty`,
  uE = `task-archive`,
  dE = `task-settings-button`,
  fE = `settings-page`,
  pE = `settings-back-button`,
  mE = `settings-section-nav`,
  hE = `settings-native-search-switch`,
  gE = `settings-data-base-dir-input`,
  _E = `settings-data-base-dir-browse`,
  vE = `settings-data-base-dir-save`,
  yE = `settings-data-base-dir-status`,
  bE = `settings-memory-switch`,
  xE = `settings-memory-refresh`,
  SE = `settings-memory-scope-trigger`,
  CE = `settings-memory-scope-icon`,
  wE = `settings-memory-count`,
  TE = `settings-memory-search-input`,
  EE = `settings-memory-search-clear`,
  DE = `settings-memory-workspace`,
  OE = `settings-memory-file`,
  kE = `settings-memory-file-icon`,
  AE = `settings-memory-file-name`,
  jE = `settings-memory-file-updated-at`,
  ME = `settings-memory-file-editor-actions`,
  NE = `settings-ask-user-question-auto-resolution-switch`,
  PE = `settings-locale-select-trigger`,
  FE = `settings-locale-select-item`,
  IE = `mcp-server-row`,
  LE = `plugin-mcp-server-row`,
  RE = `mcp-open-authorization-button`,
  zE = `subagent-row`,
  BE = `subagent-built-in-model-trigger`,
  VE = `settings-usage-tab`,
  HE = `sidebar-coding-plan-usage-button`,
  UE = `model-provider-add-provider-button`,
  WE = `model-provider-template-picker`,
  GE = `model-provider-template-item`,
  KE = `model-provider-template-back-button`,
  qE = `model-provider-nav-item`,
  JE = `model-provider-connection-mode-trigger`,
  YE = `model-provider-connection-mode-item`,
  XE = `model-provider-api-key-input`,
  ZE = `model-provider-name-edit-button`,
  QE = `model-provider-name-input`,
  $E = `model-provider-base-url-input`,
  eD = `model-provider-api-format-trigger`,
  tD = `model-provider-api-format-item`,
  nD = `model-provider-model-input`,
  rD = `model-provider-model-delete-button`,
  iD = `model-provider-add-model-button`,
  aD = `chat-model-select-trigger`,
  oD = `chat-model-select-group`,
  sD = `chat-model-select-item`,
  cD = `chat-thought-level-select-trigger`,
  lD = `chat-thought-level-select-item`,
  uD = `chat-mode-select-trigger`,
  dD = `chat-mode-select-item`,
  fD = `chat-context-usage-trigger`,
  pD = `chat-reasoning-trigger`,
  mD = `chat-reasoning-content`,
  hD = `workspace-header`,
  gD = `workspace-title`,
  _D = `workspace-path`,
  vD = `workspace-more-button`,
  yD = `workspace-help-menu-trigger`,
  bD = `workspace-help-menu-resource-manager`,
  xD = `workspace-file-tree-button`,
  SD = `workspace-file-tree-panel`,
  CD = `workspace-file-tree-refresh-button`,
  wD = `workspace-file-tree-row`,
  TD = `ssh-error`,
  ED = `ssh-success`,
  DD = `v4-session-pane`,
  OD = `v4-timeline`,
  kD = `v4-row`,
  AD = `v4-workspace-hook-pending-banner`,
  jD = `v4-workspace-hook-pending-review`,
  MD = `v4-workspace-hook-pending-dismiss`,
  ND = `v4-composer`,
  PD = `v4-composer-input`,
  FD = `v4-composer-background-work-trigger`,
  ID = `v4-composer-cua-entry`,
  LD = `v4-composer-send`,
  RD = `v4-composer-clear-queue-send`,
  zD = `v4-composer-keep-queue-send`,
  BD = `v4-paused-queue-send-dialog`,
  VD = `v4-attachment`,
  HD = `v4-attachment-upload-progress`,
  UD = `v4-attachment-upload-retry`,
  WD = `v4-stop`,
  GD = `v4-fork`,
  KD = `v4-feedback-like`,
  qD = `v4-feedback-dislike`,
  JD = `v4-hook-details-trigger`,
  YD = `v4-hook-details-content`,
  XD = `v4-edit`,
  ZD = `v4-edit-input`,
  QD = `v4-edit-submit`,
  $D = `v4-edit-cancel`,
  eO = `v4-edit-attachment-remove`,
  tO = `v4-edit-rewind-workspace`,
  nO = `v4-edit-workspace-conflict-dialog`,
  rO = `v4-edit-workspace-conflict-conversation-only`,
  iO = `v4-queue`,
  aO = `v4-queue-paused-banner`,
  oO = `v4-queue-resume`,
  sO = `v4-queue-item`,
  cO = `v4-queue-item-delete`,
  lO = `v4-queue-item-edit`,
  uO = `v4-queue-item-send-now`,
  dO = `v4-session-title`,
  fO = `v4-background-work-item`,
  pO = `v4-background-work-cancel`,
  mO = `v4-model-config`,
  hO = `v4-retry-subscribe`,
  gO = `v4-user-input-dialog`,
  _O = `v4-user-input-option`,
  vO = `v4-user-input-text`,
  yO = `v4-timeline-bottom`,
  bO = `v4-pane-shell`,
  xO = `v4-split-close`,
  SO = `v4-split-divider`,
  CO = `v4-pane-workspace-badge`,
  wO = `v4-task-open-in-split`,
  TO = `v4-turn-navigator`,
  EO = `v4-turn-navigator-item`,
  DO = `v4-turn-navigator-tooltip`,
  OO = `v4-subagent-open-side-pane`,
  kO = `v4-row-attachments`,
  AO = `plugin-store-browse`,
  jO = `automations-open`,
  MO = `automations-list`,
  NO = `automations-status-filter`,
  PO = `automation-create-menu`,
  FO = `automation-create-manually`,
  IO = `automation-card`,
  LO = `offpeak-create-button`,
  RO = `offpeak-card`,
  zO = `offpeak-card-session`,
  BO = `offpeak-card-menu`,
  VO = `offpeak-edit-view`,
  HO = `offpeak-edit-submit`,
  UO = `offpeak-form-title`,
  WO = `offpeak-form-instructions`,
  GO = `offpeak-action-pause`,
  KO = `offpeak-action-continue`,
  qO = `offpeak-action-delete`,
  JO = `offpeak-tab`,
  YO = `automation-card-menu`,
  XO = `automation-action-toggle`,
  ZO = `automation-action-delete`,
  QO = `automation-form-title`,
  $O = `automation-form-prompt`,
  ek = `automation-form-submit`,
  tk = `automation-run-now`,
  nk = `automation-frequency-select`,
  rk = `automation-frequency-option`,
  ik = `automation-custom-unit-select`,
  ak = `automation-custom-unit-option`,
  ok = `automation-custom-interval-select`,
  sk = `automation-custom-interval-increment`,
  ck = `automation-custom-interval-decrement`,
  lk = `automation-custom-repeat-edit`,
  uk = `automation-custom-confirm`,
  dk = `automation-year-monthday`,
  fk = `automation-year-month-option`,
  pk = `automation-year-day-option`,
  mk = `automation-schedule-preview`,
  hk = `automation-schedule-add`,
  gk = `automation-schedule-delete`,
  _k = `cron-create-card`,
  vk = `cron-create-open`,
  yk = `offpeak-create-card`,
  bk = `offpeak-create-open`,
  xk = `confirm-dialog-confirm`;
function Sk(e, t) {
  return `${e}-${t}`;
}
var Ck = `start-plan-recommendation-dialog`,
  wk = `feedback-logs-opt-in`,
  Tk = `automations-page-tab`,
  Ek = `workflows-list`,
  Dk = `workflows-empty`,
  Ok = `workflows-refresh`,
  kk = `workflows-create-via-chat`,
  Ak = `workflow-project-group`,
  jk = `workflow-global-group`,
  Mk = `workflow-card`,
  Nk = `workflow-card-run`,
  Pk = `workflow-card-menu`,
  Fk = `workflow-action-delete`,
  Ik = `workflow-launch-dialog`,
  Lk = `workflow-launch-arg`,
  Rk = `workflow-launch-target`,
  zk = `workflow-launch-submit`,
  Bk = `workflow-launch-error`,
  Vk = `workflow-run-digest`,
  Hk = `workflow-action-move`,
  Uk = `workflow-move-dialog`,
  Wk = `workflow-move-dialog-target`,
  Gk = `workflow-move-dialog-submit`,
  Kk = `workflow-detail`,
  qk = `workflow-detail-run`,
  Jk = `workflow-detail-menu`,
  Yk = `workflow-detail-tab`,
  Xk = `workflow-detail-description`,
  Zk = `workflow-detail-when-to-use`,
  Qk = `workflow-detail-script`,
  $k = `workflow-meta-save`,
  eA = `workflow-meta-discard`,
  tA = `workflow-run-row`,
  nA = `workflow-run-artifacts`,
  rA = `workflow-run-artifacts-toggle`,
  iA = `workflow-run-artifact-card`,
  aA = `workflow-artifact-pane`,
  oA = `workflow-run-artifact-chip`,
  sA = `workflow-notification-artifact-chip`,
  cA = {
    File: `file`,
    MediaPreview: `media-preview`,
    System: `system`,
    Terminal: `terminal`,
    Git: `git`,
    GitCheckpoint: `git-checkpoint`,
    Setting: `setting`,
    Credential: `credential`,
    CuaPermission: `cua-permission`,
    CuaPipSession: `cua-pip-session`,
    Broadcast: `broadcast`,
    ZCodeTask: `zcode-task`,
    WindowController: `window-controller`,
    ZCodeAgent: `zcode-agent`,
    ZCodeSession: `zcode-session`,
    ConversationShare: `conversation-share`,
    FileWatcher: `file-watcher`,
    OAuth: `oauth`,
    ProviderSettings: `provider-settings`,
    ModelSelection: `model-selection`,
    ProviderProvisioningTarget: `provider-provisioning-target`,
    UsageStats: `usage-stats`,
    CodingPlanSubscription: `coding-plan-subscription`,
    ClientConfig: `client-config`,
    ClientScenes: `client-scenes`,
    CloudContent: `cloud-content`,
    MarketingTouch: `marketing-touch`,
    Skills: `skills`,
    SkillSync: `skill-sync`,
    McpSync: `mcp-sync`,
    PluginSync: `plugin-sync`,
    Plugins: `plugins`,
    PluginManagement: `plugin-management`,
    Subagents: `subagents`,
    Commands: `commands`,
    Hooks: `hooks`,
    Memory: `memory`,
    OutputStyle: `output-style`,
    SettingsSync: `settings-sync`,
    Bots: `bots`,
    Feedback: `feedback`,
    PromptAttachmentTransfer: `prompt-attachment-transfer`,
    OffPeakTask: `off-peak-task`,
    OnboardingRecord: `onboarding-record`,
  },
  lA = { WheelBoundary: `zcode:embedded-browser-wheel-boundary` },
  uA = { PurchaseComplete: `zcode:coding-plan-purchase-complete` },
  dA = `bigmodel`,
  fA = `ZCODE_CREDENTIAL_DECRYPT_FAILED`;
function pA(e) {
  let t = mA(e);
  return t ? t === fA : !!hA(e).startsWith(`凭据解密失败：`);
}
function mA(e) {
  return typeof e == `object` && e && `code` in e ? String(e.code ?? ``) : ``;
}
function hA(e) {
  return e instanceof Error
    ? e.message
    : typeof e == `object` && e && `message` in e
      ? String(e.message ?? ``)
      : ``;
}
var gA = `auth:zcode-jwt-invalid`;
function _A(e, t = Date.now(), n = 3e4) {
  try {
    let r = e.split(`.`)[1];
    if (!r) return { kind: `unknown` };
    let i = r.replace(/-/g, `+`).replace(/_/g, `/`),
      a = i.padEnd(Math.ceil(i.length / 4) * 4, `=`),
      o = globalThis.atob(a),
      s = Uint8Array.from(o, (e) => e.charCodeAt(0)),
      c = JSON.parse(new TextDecoder().decode(s));
    if (typeof c.exp != `number` || !Number.isFinite(c.exp) || c.exp <= 0)
      return { kind: `unknown` };
    let l = c.exp * 1e3;
    return t + Math.max(0, n) >= l
      ? { kind: `expired`, expiresAt: l }
      : { kind: `valid`, expiresAt: l };
  } catch {
    return { kind: `unknown` };
  }
}
var vA = `zcode-agent`;
function yA(e) {
  return typeof e == `object` && !!e;
}
function bA(e) {
  return typeof e == `string` && e.trim() !== `` ? e : void 0;
}
function xA(e) {
  if (yA(e)) return bA(e.feedback_url);
}
function SA(e) {
  if (!yA(e)) return {};
  let t = e.community_urls;
  return yA(t) ? { "zh-CN": bA(t[`zh-CN`]), "en-US": bA(t[`en-US`]) } : {};
}
function CA(e, t, n) {
  let r = SA(e),
    i = SA(t);
  return r[n] ?? i[n];
}
var wA = O({
    community_urls: O({
      "zh-CN": S()
        .optional()
        .catch(void 0),
      "en-US": S()
        .optional()
        .catch(void 0),
    })
      .optional()
      .catch(void 0),
    feedback_url: S()
      .optional()
      .catch(void 0),
    feedback_use_external_form: T()
      .optional()
      .catch(void 0),
  }),
  TA = O({ code: N(0), data: O({ configs: O({ feedbackUrl: wA }) }) });
function EA(e, t, n) {
  let r = new URL(`/api/v1/client/configs`, Lh(e).origin);
  return (
    r.searchParams.set(`app_version`, t), n && r.searchParams.set(`platform`, n), r.toString()
  );
}
function DA(e, t) {
  let n = wA.safeParse(e).data,
    r = wA.safeParse(t).data;
  return {
    community_urls: { "zh-CN": CA(n, r, `zh-CN`), "en-US": CA(n, r, `en-US`) },
    feedback_url: xA(n) ?? xA(r),
    feedback_use_external_form:
      n?.feedback_use_external_form ?? r?.feedback_use_external_form ?? !1,
  };
}
function OA(e) {
  let t = new Map(),
    n = e.now ?? Date.now;
  return async (r, i) => {
    for (let [e, r] of t) !r.pending && r.expiresAt <= n() && t.delete(e);
    let a = t.get(r);
    if (a?.pending) return a.pending;
    if (a?.value && a.expiresAt > n()) return a.value;
    let o = { expiresAt: 0 };
    (t.set(r, o),
      (o.pending = (async () => {
        let t = await e.fetchImpl(r, {
          method: `GET`,
          cache: `no-store`,
          credentials: `omit`,
          headers: i,
          signal: AbortSignal.timeout(1e4),
        });
        if (!t.ok) throw Error(`Help config HTTP ${t.status}`);
        let a = TA.parse(await t.json()).data.configs.feedbackUrl;
        return ((o.value = a), (o.expiresAt = n() + 3600 * 1e3), a);
      })()));
    try {
      return await o.pending;
    } catch (e) {
      throw (t.delete(r), e);
    } finally {
      o.pending = void 0;
    }
  };
}
var kA = S().min(1).nullable(),
  AA = M([`coding`, `office`]).nullable(),
  jA = O({
    userId: S().min(1).nullable(),
    occupation: kA,
    interfaceMode: AA,
    memoryEnabled: T().nullable(),
    proactiveSuggestionsEnabled: T().nullable(),
    completedAt: S().min(1),
    uploadState: N(`pending`),
  }),
  MA = O({
    userId: S().min(1).nullable(),
    status: M([`dismissed`, `existing_local_user`]),
    reason: M([`user_closed`, `existing_local_task`]),
    decidedAt: S().min(1),
  });
k([
  O({ version: N(1), deviceMid: S().min(1), entries: D(jA) }),
  O({ version: N(2), deviceMid: S().min(1), entries: D(jA), decisions: D(MA) }),
]).transform((e) => (e.version === 1 ? { ...e, version: 2, decisions: [] } : e));
function NA(e) {
  let t = PA(e.now, `unknown`, ``);
  if (!e.providerFamilyDomain) return t;
  let n = FA({
    snapshot: e.codingPlanEntitlement,
    now: e.now,
    entitlementCacheTtlMs: e.entitlementCacheTtlMs,
  });
  if (n.kind === `active`) return PA(n.generatedAt, `coding_plan`, n.planProductId);
  if (n.kind !== `none`) return t;
  let r = FA({
    snapshot: e.startPlanEntitlement,
    now: e.now,
    entitlementCacheTtlMs: e.entitlementCacheTtlMs,
  });
  return r.kind === `active`
    ? PA(r.generatedAt, `start_plan`, r.planProductId)
    : r.kind === `none`
      ? PA(e.now, `no_plan`, ``)
      : t;
}
function PA(e, t, n) {
  return { generatedAt: e, planStatus: t, planProductId: n };
}
function FA(e) {
  let t = e.snapshot;
  return !t ||
    e.now - t.generatedAt > e.entitlementCacheTtlMs ||
    !t.authenticated ||
    t.unavailableReason === `unavailable` ||
    t.unavailableReason === `not_authenticated` ||
    t.unavailableReason === `not_configured`
    ? { kind: `unknown` }
    : t.unavailableReason === `no_plan`
      ? { kind: `none` }
      : t.quota || t.subscription || t.remaining
        ? {
            kind: `active`,
            generatedAt: t.generatedAt,
            planProductId: t.subscription?.details[0]?.productId ?? ``,
          }
        : { kind: `unknown` };
}
var IA = `zcode-browser-restore://pending`,
  LA = 3e3;
function RA(e) {
  switch (e.kind) {
    case `ssh`:
      return {
        kind: `ssh`,
        host: e.host,
        port: e.port,
        username: e.username,
        ...(e.sshConfigAlias?.trim() ? { sshConfigAlias: e.sshConfigAlias.trim() } : {}),
      };
    case `wsl`: {
      let t = e.user?.trim();
      return { kind: `wsl`, distro: e.distro, ...(t ? { user: t } : {}) };
    }
    case `docker`:
      return { kind: `docker`, container: e.container };
    case `server`:
      return;
  }
}
var zA = {
  NewTask: `newTask`,
  OpenWorkspace: `openWorkspace`,
  CloseActiveContext: `closeActiveContext`,
  CloseWindow: `closeWindow`,
  MinimizeWindow: `minimizeWindow`,
  ToggleMaximizeWindow: `toggleMaximizeWindow`,
  ToggleFullScreen: `toggleFullScreen`,
  ResetWindowSize: `resetWindowSize`,
  ResetZoom: `resetZoom`,
  ZoomIn: `zoomIn`,
  ZoomOut: `zoomOut`,
  ShowAbout: `showAbout`,
  OpenChangelog: `openChangelog`,
  CheckForUpdates: `checkForUpdates`,
  RelaunchApp: `relaunchApp`,
  OpenFeedback: `openFeedback`,
  OpenCommunity: `openCommunity`,
  ExportLogs: `exportLogs`,
  ToggleDevTools: `toggleDevTools`,
  OpenResourceManager: `openResourceManager`,
  ToggleZCodeStdioTapDevProxy: `toggleZCodeStdioTapDevProxy`,
  SetZCodeEndpointProduction: `setZCodeEndpointProduction`,
  SetZCodeEndpointTest: `setZCodeEndpointTest`,
  SetZCodeEndpointCustom: `setZCodeEndpointCustom`,
  ResetZCodeEndpoint: `resetZCodeEndpoint`,
  ClearAllData: `clearAllData`,
  ClearCodingPlanWebviewStorage: `clearCodingPlanWebviewStorage`,
  GetCuaOsSupport: `getCuaOsSupport`,
};
function BA(e) {
  let t = e?.trim();
  if (!t) return ``;
  try {
    let e = new URL(t);
    return e.protocol !== `https:` && e.protocol !== `http:` ? `` : e.hostname.toLowerCase();
  } catch {
    return ``;
  }
}
function VA(e) {
  return e ? `[redacted]` : ``;
}
function HA(e) {
  let t = BA(e);
  if (t) return t;
  let n = e.trim().toLowerCase();
  return n && BA(`https://${n}`) === n ? n : ``;
}
function UA(e, t) {
  return Object.fromEntries(
    Object.entries(t).map(([t, n]) => [
      t,
      t === `error_msg` ? VA(n) : e === `app_login_ck` && t === `login_url` ? HA(n) : n,
    ]),
  );
}
function WA(e) {
  let t = typeof Intl < `u` ? Intl.DateTimeFormat().resolvedOptions() : void 0,
    n = e?.timeZone ?? t?.timeZone ?? `UTC`,
    r = e?.intlLocale ?? t?.locale ?? `en-US`,
    i = globalThis.screen,
    a = e?.screen ?? i ?? { width: 0, height: 0 };
  return { clientTimezone: n, clientLanguage: r, screenResolution: `${a.width}x${a.height}` };
}
var GA = `custom:`;
function KA(e) {
  try {
    return decodeURIComponent(e);
  } catch {
    return e;
  }
}
function qA(e, t) {
  let n = encodeURIComponent(e);
  return t ? `${GA}${n}:${encodeURIComponent(t)}` : `${GA}${n}`;
}
function JA(e) {
  if (!e.startsWith(`custom:`)) return null;
  let t = e.slice(7),
    n = t.indexOf(`:`);
  if (n < 0) return { providerId: KA(t) };
  let r = t.split(`:`);
  if (r.length >= 3 && r[0] === `builtin`)
    return { providerId: `${r[0]}:${r[1]}`, modelName: KA(r.slice(2).join(`:`)) };
  let i = t.slice(0, n),
    a = t.slice(n + 1);
  return { providerId: KA(i), modelName: KA(a) };
}
var YA = { zai: `zai-api`, bigmodel: `bigmodel-api` },
  Q = {
    zaiIndividualCodingPlan: `account:zai-individual-coding-plan`,
    zaiTeamCodingPlan: `account:zai-team-coding-plan`,
    zaiStartPlan: `account:zai-start-plan`,
    bigmodelIndividualCodingPlan: `account:bigmodel-individual-coding-plan`,
    bigmodelTeamCodingPlan: `account:bigmodel-team-coding-plan`,
    bigmodelStartPlan: `account:bigmodel-start-plan`,
  };
function XA(e) {
  return (
    e === Q.zaiIndividualCodingPlan ||
    e === Q.zaiTeamCodingPlan ||
    e === Q.zaiStartPlan ||
    e === Q.bigmodelIndividualCodingPlan ||
    e === Q.bigmodelTeamCodingPlan ||
    e === Q.bigmodelStartPlan
  );
}
function ZA(e) {
  return e === Q.zaiIndividualCodingPlan || e === Q.zaiTeamCodingPlan || e === Q.zaiStartPlan;
}
function QA(e) {
  return e === Q.zaiStartPlan || e === Q.bigmodelStartPlan;
}
function $A(e) {
  return e === Q.zaiIndividualCodingPlan || e === Q.bigmodelIndividualCodingPlan;
}
function ej(e) {
  return (
    ZA(e) ||
    e === Q.bigmodelIndividualCodingPlan ||
    e === Q.bigmodelTeamCodingPlan ||
    e === Q.bigmodelStartPlan
  );
}
var tj = [
  `GLM-5.3`,
  `GLM-5.3-Flash`,
  `GLM-5V-Turbo`,
  `GLM-5.2`,
  `GLM-5.1`,
  `GLM-5.1-Highspeed`,
  `GLM-5`,
  `GLM-5-Turbo`,
  `GLM-4.7`,
  `GLM-4.7-FlashX`,
  `GLM-4.7-Flash`,
  `GLM-4.6`,
  `GLM-4.5-Air`,
  `GLM-4.5`,
  `GLM-4.6V`,
  `GLM-4.6V-Flash`,
  `GLM-4.6V-FlashX`,
  `GLM-4.1V-Thinking-FlashX`,
  `GLM-4.1V-Thinking-Flash`,
  `GLM-4-FlashX-250414`,
  `GLM-4-Flash-250414`,
  `GLM-4V-Flash`,
];
new Map(tj.map((e) => [e.toLowerCase(), e]));
var nj = tj;
function rj(e) {
  switch (e) {
    case `builtin:bigmodel`:
      return YA.bigmodel;
    case `builtin:zai`:
      return YA.zai;
    case `builtin:bigmodel-start-plan`:
      return Q.bigmodelStartPlan;
    case `builtin:zai-start-plan`:
      return Q.zaiStartPlan;
    case `builtin:bigmodel-coding-plan`:
      return Q.bigmodelIndividualCodingPlan;
    case `builtin:zai-coding-plan`:
      return Q.zaiIndividualCodingPlan;
    default:
      return e.startsWith(`builtin:`) ? void 0 : e;
  }
}
var ij = 4096,
  aj = 128;
function oj(e, t = {}) {
  if (typeof e != `string` || !e) return ``;
  let n = t.maxLength ?? 2048;
  return e
    .slice(0, ij)
    .replace(/\bhttps?:\/\/[^\s"'<>]+/giu, (e) => sj(e))
    .replace(
      /(\bauthorization\b["']?\s*[:=])\s*(?:(?:Bearer|Basic)\s+)?[^\s,"'};]+/giu,
      `$1 {redacted}`,
    )
    .replace(
      /([?&](?:api[_-]?key|token|access[_-]?token|authorization|password|passwd|secret|cookie|session)=)[^&\s]+/giu,
      `$1{redacted}`,
    )
    .replace(
      /(["']?(?:api[_-]?key|token|access[_-]?token|password|passwd|secret|client[_-]?secret|cookie|set-cookie|session)["']?\s*[:=]\s*["']?)(?!\{redacted\})[^\s,"'};]+/giu,
      `$1{redacted}`,
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, `$1 {redacted}`)
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/giu, `{secret}`)
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu, `{secret}`)
    .replace(/\bAKIA[A-Z0-9]{16}\b/gu, `{secret}`)
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/gu, `{secret}`)
    .replace(/\b[^/@\s]+@[^/@\s]+\.[^/@\s]+\b/gu, `{email}`)
    .replace(/\/(?:private\/)?(?:var\/folders|tmp)\/[^\s:;,)\]}]+/gu, `{path}`)
    .replace(
      /\/(?:Users|home|root|workspace|workspaces|Volumes)\/[^/\s]+(?:\/[^\s:;,)\]}]+)*/gu,
      `{path}`,
    )
    .replace(/\b[A-Za-z]:\\[^\\\s]+(?:\\[^\s:;,)\]}]+)*/gu, `{path}`)
    .replace(/\p{Cc}+/gu, ` `)
    .replace(/\s+/gu, ` `)
    .trim()
    .slice(0, n);
}
function sj(e) {
  let t = typeof e == `string` ? e.trim() : ``;
  if (!t) return `unknown`;
  if (/^blob:/iu.test(t)) return `blob`;
  if (/^data:/iu.test(t)) return `data`;
  if (/^file:/iu.test(t) || /^[a-zA-Z]:[\\/]/u.test(t) || t.startsWith(`/`)) return `local_file`;
  try {
    let e = t.includes(`://`)
      ? t
      : /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?(?:[/?#]|$)/iu.test(t)
        ? `https://${t}`
        : ``;
    if (!e) return `unknown`;
    let n = new URL(e);
    if (n.protocol === `file:` || !n.host) return `local_file`;
    let r = n.pathname
      .split(`/`)
      .map((e) => cj(e))
      .join(`/`);
    return `${n.protocol}//${n.host}${r}`;
  } catch {
    return `unknown`;
  }
}
function cj(e) {
  return (
    e &&
    (/@/u.test(e) ||
    /^\d{7,}$/u.test(e) ||
    /^[0-9a-f]{16,}$/iu.test(e) ||
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(e)
      ? `{segment}`
      : e.slice(0, aj))
  );
}
var lj = [`charglm-4`, `codegeex-4`, `emohaa`],
  uj = new Set([...nj.map((e) => e.toLowerCase()), ...lj]);
function dj(e) {
  let t = rj(e);
  return t !== void 0 && t !== e;
}
function fj(e) {
  let t = e?.trim();
  return t
    ? XA(t) || dj(t)
      ? { providerId: t, providerScope: `builtin` }
      : { providerId: `custom`, providerScope: `custom` }
    : { providerId: ``, providerScope: `unknown` };
}
function pj(e) {
  let t = JA(e);
  if (t) return t.modelName ?? ``;
  let n = e.indexOf(`/`);
  return n > 0 ? e.slice(n + 1) : e;
}
function mj(e, t) {
  let n = t?.trim();
  if (!n || e === `unknown`) return ``;
  if (e === `custom`) return `custom`;
  let r = pj(n).toLowerCase();
  return uj.has(r) ? r : `custom`;
}
function hj(e) {
  let t = e?.trim();
  if (!t) return ``;
  let n = JA(t);
  if (n) return mj(fj(n.providerId).providerScope, n.modelName);
  let r = t.indexOf(`/`);
  if (r > 0) {
    let { providerScope: e } = fj(t.slice(0, r));
    return mj(e, t.slice(r + 1));
  }
  return mj(`builtin`, t);
}
function gj(e) {
  let t = e.workspaceIdentity?.trim();
  return {
    workspace_kind: t || e.remoteSessionId?.trim() ? `remote` : `local`,
    remote_kind: t ? (wS(t)?.kind ?? ``) : ``,
  };
}
function _j(e, t, n) {
  return { elementName: e, eventRegion: `web_remote_control`, eventType: t, eventExtraDetail: n };
}
function vj(e) {
  return _j(`web_remote_control_entry_view`, `view`, {
    workspace_kind: e.workspaceKind,
    remote_kind: e.remoteKind ?? ``,
  });
}
function yj(e) {
  return e.toString(16).padStart(2, `0`);
}
function bj(e = Date.now()) {
  let t = new Uint8Array(16);
  crypto.getRandomValues(t);
  let n = BigInt(e);
  ((t[0] = Number((n >> 40n) & 255n)),
    (t[1] = Number((n >> 32n) & 255n)),
    (t[2] = Number((n >> 24n) & 255n)),
    (t[3] = Number((n >> 16n) & 255n)),
    (t[4] = Number((n >> 8n) & 255n)),
    (t[5] = Number(n & 255n)),
    (t[6] = 112 | (t[6] & 15)),
    (t[8] = 128 | (t[8] & 63)));
  let r = Array.from(t, yj).join(``);
  return `${r.slice(0, 8)}-${r.slice(8, 12)}-${r.slice(12, 16)}-${r.slice(16, 20)}-${r.slice(20)}`;
}
function xj(e) {
  let t = new Uint8Array(e);
  return (
    (t[6] = (t[6] & 15) | 64),
    (t[8] = (t[8] & 63) | 128),
    [t.slice(0, 4), t.slice(4, 6), t.slice(6, 8), t.slice(8, 10), t.slice(10, 16)]
      .map((e) => Array.from(e, yj).join(``))
      .join(`-`)
  );
}
function Sj() {
  let e = globalThis.crypto;
  if (e?.randomUUID) return e.randomUUID();
  if (e?.getRandomValues) {
    let t = new Uint8Array(16);
    return (e.getRandomValues(t), xj(t));
  }
  let t = new Uint8Array(16);
  for (let e = 0; e < t.length; e += 1) t[e] = Math.floor(Math.random() * 256);
  return xj(t);
}
function Cj(e) {
  return Sj();
}
function wj() {
  return Sj();
}
var Tj = `zcode-default-group-cron`,
  Ej = `zcode-default-group-off-peak`;
function Dj(e) {
  return !!(e.cronAutomationId || e.automationId);
}
function Oj(e) {
  return !!e.offPeakTaskId;
}
var kj = `AUTOMATION_CREATE_LIMIT_REACHED`;
function Aj(e) {
  return (typeof e == `string` ? e : e instanceof Error ? e.message : ``).includes(kj);
}
var jj = [`completed`, `failed`, `cancelled`];
function Mj(e) {
  return jj.includes(e);
}
var Nj = `off-peak-ticket-expired`;
function Pj(e) {
  return !!e?.includes(Nj);
}
var Fj = [
  { id: `build`, name: `Ask before changes`, description: `Ask before each file changes.` },
  {
    id: `edit`,
    name: `Edit automatically`,
    description: `Edit selected files or relevant workspace files automatically.`,
  },
  {
    id: `plan`,
    name: `Plan mode`,
    description: `Inspect the code and present a plan before editing.`,
  },
  {
    id: `yolo`,
    name: `Full access`,
    description: `Edit and run commands with fewer confirmations.`,
  },
];
new Set(Fj.map((e) => e.id));
function Ij() {
  return Fj.map((e) => ({ value: e.id, name: e.name, description: e.description }));
}
function Lj() {
  return Fj.map((e) => ({ ...e }));
}
function Rj(e = new Date()) {
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, `0`)}-${String(e.getDate()).padStart(2, `0`)} ${String(e.getHours()).padStart(2, `0`)}:${String(e.getMinutes()).padStart(2, `0`)}:${String(e.getSeconds()).padStart(2, `0`)}.${String(e.getMilliseconds()).padStart(3, `0`)}`;
}
function zj(e, t) {
  return `[${Rj()}]${t == null ? `` : ` [pid:${t}]`} [${e}]`;
}
var Bj = [
    {
      id: `zai`,
      label: `Z.ai`,
      rootDomain: `z.ai`,
      oauthProviderId: `zai`,
      startPlanProviderId: Q.zaiStartPlan,
      individualCodingPlanProviderId: Q.zaiIndividualCodingPlan,
      teamCodingPlanProviderId: Q.zaiTeamCodingPlan,
      teamCodingPlanManageUrl: `https://z.ai/manage-apikey/subscription`,
    },
    {
      id: `bigmodel`,
      label: `BigModel`,
      rootDomain: `bigmodel.cn`,
      oauthProviderId: dA,
      startPlanProviderId: Q.bigmodelStartPlan,
      individualCodingPlanProviderId: Q.bigmodelIndividualCodingPlan,
      teamCodingPlanProviderId: Q.bigmodelTeamCodingPlan,
      teamCodingPlanManageUrl: Ih({ ZCODE_ENV: Xc }),
    },
  ],
  Vj = new Map(Bj.map((e) => [e.id, e])),
  Hj = new Map(
    Bj.flatMap((e) =>
      [e.startPlanProviderId, e.individualCodingPlanProviderId, e.teamCodingPlanProviderId].map(
        (t) => [t, e.id],
      ),
    ),
  );
function Uj(e) {
  return Vj.get(e);
}
function Wj(e) {
  return Hj.get(e) ?? null;
}
function Gj(e) {
  let t = Wj(e);
  return t ? Uj(t) : null;
}
function Kj(e) {
  return e === `zai` || e === `bigmodel` ? e : null;
}
function qj(e) {
  return e === `zai` ? `zai` : e === `bigmodel` ? `bigmodel` : null;
}
var Jj = `ZCODE_AGENT_PROVIDER_NOT_READY`,
  Yj = `native:`,
  Xj = `custom:`,
  Zj = `ghost:`;
function Qj(e) {
  return `${Yj}${e}`;
}
function $j(e) {
  return `${Xj}${e.trim()}`;
}
function eM(e, t) {
  let n = JA(String(t ?? ``));
  return n?.providerId ? $j(n.providerId) : Qj(e);
}
var tM = `SKILL_SYNC_SIZE_LIMIT_EXCEEDED`;
function nM(e) {
  let t = il(e);
  return (
    t.code === `DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR` ||
    t.message.includes(`DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR`)
  );
}
var rM = `settings:app-runtime-preferences`,
  iM = O({
    askUserQuestionAutoResolutionEnabled: T(),
    modelIoFullRetentionEnabled: T().default(!1),
  }).strict();
function aM(e) {
  return e.source === `user`;
}
function oM(e) {
  return e.source === `plugin`;
}
var sM = `zcode-plugins-official`,
  cM = `claude-plugins-official`,
  lM = [sM];
function uM(e) {
  return lM.includes(e);
}
var dM = 4e5;
function fM(e) {
  if (!e) return [];
  let t = e.split(`
`);
  return (t[t.length - 1] === `` && t.pop(), t);
}
function pM(e, t) {
  let n = fM(e),
    r = fM(t),
    i = 0;
  for (; i < n.length && i < r.length && n[i] === r[i]; ) i += 1;
  let a = n.length - 1,
    o = r.length - 1;
  for (; a >= i && o >= i && n[a] === r[o]; ) (--a, --o);
  let s = n.slice(i, a + 1),
    c = r.slice(i, o + 1);
  if (s.length === 0) return { added: c.length, removed: 0 };
  if (c.length === 0) return { added: 0, removed: s.length };
  if (s.length * c.length > dM) return { added: c.length, removed: s.length };
  let l = Array.from({ length: c.length + 1 }, () => 0);
  for (let e = 1; e <= s.length; e += 1) {
    let t = 0;
    for (let n = 1; n <= c.length; n += 1) {
      let r = l[n];
      (s[e - 1] === c[n - 1] ? (l[n] = t + 1) : (l[n] = Math.max(l[n], l[n - 1])), (t = r));
    }
  }
  let u = l[c.length] ?? 0;
  return { added: c.length - u, removed: s.length - u };
}
var mM = `computer-use@zcode-plugins-official`;
function hM(e) {
  return e.headers ?? e.http_headers;
}
function gM(e, t) {
  let n = t.type;
  if ((n || (t.command ? (n = `stdio`) : t.url && (n = `http`)), n === `stdio` && t.command)) {
    let n = t.command,
      r = t.args || [];
    if (
      (typeof process < `u` && process.platform === `win32`) ||
      (typeof navigator < `u` && /win/i.test(navigator.platform))
    ) {
      let e = n.toLowerCase(),
        t = r[1];
      (e === `cmd` || e === `cmd.exe`) && r[0] === `/c` && t && ((n = t), (r = r.slice(2)));
    }
    return {
      name: e,
      command: n,
      args: r,
      env: t.env ? Object.entries(t.env).map(([e, t]) => ({ name: e, value: t })) : [],
      ...(_M(t.timeoutMs) ? { timeoutMs: t.timeoutMs } : {}),
      ...(vM(t.isolation) ? { isolation: t.isolation } : {}),
      ...(yM(t.protocolVersion) ? { protocolVersion: t.protocolVersion } : {}),
    };
  } else if (t.url && n) {
    let r = n === `sse` ? `sse` : `http`,
      i = hM(t);
    return {
      name: e,
      type: r,
      url: t.url,
      headers: i ? Object.entries(i).map(([e, t]) => ({ name: e, value: t })) : [],
      ...(bM(t.oauth) ? { oauth: t.oauth } : {}),
      ...(_M(t.timeoutMs) ? { timeoutMs: t.timeoutMs } : {}),
      ...(vM(t.isolation) ? { isolation: t.isolation } : {}),
      ...(yM(t.protocolVersion) ? { protocolVersion: t.protocolVersion } : {}),
    };
  }
  return null;
}
function _M(e) {
  return typeof e == `number` && Number.isInteger(e) && e > 0;
}
function vM(e) {
  return e === `session` || e === `workspace`;
}
function yM(e) {
  return e === `legacy` || e === `auto` || e === `2026-07-28`;
}
function bM(e) {
  return xM(e)
    ? e.type === `client_credentials` &&
      typeof e.clientId == `string` &&
      e.clientId.trim().length > 0 &&
      typeof e.clientSecret == `string` &&
      e.clientSecret.trim().length > 0
      ? (e.clientName === void 0 || typeof e.clientName == `string`) &&
        (e.scope === void 0 || typeof e.scope == `string`)
      : e.type === `authorization_code`
        ? (e.clientId === void 0 || typeof e.clientId == `string`) &&
          (e.clientSecret === void 0 || typeof e.clientSecret == `string`) &&
          (e.clientName === void 0 || typeof e.clientName == `string`) &&
          (e.redirectPath === void 0 || typeof e.redirectPath == `string`) &&
          (e.scope === void 0 || typeof e.scope == `string`)
        : !1
    : !1;
}
function xM(e) {
  return typeof e == `object` && !!e && !Array.isArray(e);
}
function SM(e, t) {
  return t === `win32` ? `${e}.exe` : e;
}
var CM = {
  bfs: {
    binaryEnvVar: `ZCODE_BFS_BINARY`,
    bundledResourceDir: `bfs`,
    resolveEntrySegments: (e) => [SM(`bfs`, e)],
  },
  ripgrep: {
    binaryEnvVar: `ZCODE_RG_BINARY`,
    bundledResourceDir: `ripgrep`,
    resolveEntrySegments: (e) => [SM(`rg`, e)],
  },
  ugrep: {
    binaryEnvVar: `ZCODE_UGREP_BINARY`,
    bundledResourceDir: `ugrep`,
    resolveEntrySegments: (e) => [SM(`ugrep`, e)],
  },
};
(({ ...CM.bfs }), { ...CM.ripgrep }, { ...CM.ugrep });
var wM = new Set([`input-streaming`, `input-available`]),
  TM = {
    "input-streaming": `chat.toolCall.status.pending`,
    "input-available": `chat.toolCall.status.running`,
    "output-available": `chat.toolCall.status.completed`,
    "output-error": `chat.toolCall.status.failed`,
    "output-denied": `chat.toolCall.status.denied`,
  };
function EM(e) {
  return wM.has(e);
}
function DM(e, t) {
  return t === `stopped`
    ? `chat.toolCall.status.stopped`
    : (TM[e] ?? `chat.toolCall.status.pending`);
}
var OM =
    `Read.Write.Edit.ApplyPatch.Bash.Glob.Grep.WebFetch.WebSearch.web_search.TodoRead.TodoWrite.GoalRead.ReadSessionContext.AskUserQuestion.SendMessage.RespondToCoordinator.TaskOutput.TaskStop.js.js_reset.js_add_node_module_dir.mcp__node_repl__js.mcp__node_repl__js_reset.mcp__node_repl__js_add_node_module_dir.Agent.Task.Skill.CreateWorkflow.AmendWorkflow.submit_result`.split(
      `.`,
    ),
  kM = {
    Read: `file-read`,
    Write: `file-write`,
    Edit: `file-write`,
    ApplyPatch: `file-write`,
    Bash: `shell`,
    Glob: `search`,
    Grep: `search`,
    WebFetch: `search`,
    WebSearch: `search`,
    web_search: `search`,
    TodoRead: `todo`,
    TodoWrite: `todo`,
    GoalRead: `goal`,
    ReadSessionContext: `session-context`,
    AskUserQuestion: `ask-user-question`,
    SendMessage: `message`,
    RespondToCoordinator: `message`,
    TaskOutput: `task-control`,
    TaskStop: `task-control`,
    js: `node-repl`,
    js_reset: `node-repl`,
    js_add_node_module_dir: `node-repl`,
    mcp__node_repl__js: `node-repl`,
    mcp__node_repl__js_reset: `node-repl`,
    mcp__node_repl__js_add_node_module_dir: `node-repl`,
    Agent: `agent`,
    Task: `agent`,
    Skill: `skill`,
    CreateWorkflow: `workflow`,
    AmendWorkflow: `workflow`,
    submit_result: `workflow`,
  },
  AM = new Map(OM.map((e) => [e.toLowerCase(), e]));
function jM(e) {
  let t = e?.trim();
  return t ? (AM.get(t.toLowerCase()) ?? null) : null;
}
function MM(e) {
  let t = jM(e);
  return t ? kM[t] : null;
}
function NM(e) {
  return jM(e) === `Write`;
}
var PM = [
  `file_path`,
  `filePath`,
  `path`,
  `target_path`,
  `targetPath`,
  `filename`,
  `file`,
  `content`,
  `new_string`,
  `newString`,
  `new_text`,
  `newText`,
  `old_string`,
  `oldString`,
  `old_text`,
  `oldText`,
  `command`,
  `description`,
  `title`,
  `pattern`,
  `replacement`,
  `plan`,
  `name`,
  `script`,
];
function FM(e, t) {
  if (t !== void 0) return { complete: !0, input: t, rawInput: e };
  let n = IM(e);
  return n.ok
    ? { complete: !0, input: n.value, rawInput: e }
    : { complete: !1, input: LM(e) ?? {}, rawInput: e };
}
function IM(e) {
  try {
    return { ok: !0, value: JSON.parse(e) };
  } catch {
    return { ok: !1 };
  }
}
function LM(e) {
  let t = {};
  for (let n of PM) {
    let r = RM(e, n);
    r !== void 0 && (t[n] = r);
  }
  return Object.keys(t).length > 0 ? t : null;
}
function RM(e, t) {
  let n = RegExp(`"${HM(t)}"\\s*:\\s*"`).exec(e);
  if (!n) return;
  let r = ``,
    i = !1,
    a = !1;
  for (let t = n.index + n[0].length; t < e.length; t += 1) {
    let n = e[t] ?? ``;
    if (i) {
      ((r += `\\${n}`), (i = !1));
      continue;
    }
    if (n === `\\`) {
      i = !0;
      continue;
    }
    if (n === `"`) {
      a = !0;
      break;
    }
    r += n;
  }
  return (i && (r += `\\`), zM(r, a));
}
function zM(e, t) {
  let n = t ? e : BM(e);
  try {
    return JSON.parse(`"${n}"`);
  } catch {
    return VM(n);
  }
}
function BM(e) {
  return e.replace(/\\u[0-9a-fA-F]{0,3}$/, ``).replace(/\\$/, ``);
}
function VM(e) {
  return e
    .replace(
      /\\n/g,
      `
`,
    )
    .replace(/\\r/g, `\r`)
    .replace(/\\t/g, `	`)
    .replace(/\\"/g, `"`)
    .replace(/\\\\/g, `\\`);
}
function HM(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`);
}
var UM = /(?:^|[_\s-])(?:todo[_\s-]*(?:read|write)|update[_\s-]*plan)(?:$|[_\s-])/i,
  WM = [`todos`, `plan`, `steps`, `items`];
function GM(e) {
  return typeof e == `object` && !!e && !Array.isArray(e);
}
function KM(e) {
  return typeof e == `string` && e.trim().length > 0 ? e.trim() : void 0;
}
function qM(e) {
  let t = KM(e)?.replace(/-/g, `_`).toLowerCase();
  return t === `pending` || t === `in_progress` || t === `completed` ? t : null;
}
function JM(e, t) {
  if (typeof e == `string`) {
    let n = e.trim();
    return n ? { id: n, title: n, status: t === 0 ? `in_progress` : `pending` } : null;
  }
  if (!GM(e)) return null;
  let n = KM(e.content) ?? KM(e.step) ?? KM(e.title) ?? KM(e.text) ?? KM(e.activeForm),
    r = qM(e.status);
  return !n || !r ? null : { id: KM(e.id) ?? n, title: n, status: r };
}
function YM(e) {
  try {
    return JSON.parse(e);
  } catch {
    return;
  }
}
function XM(e) {
  let t = typeof e == `string` ? YM(e) : e;
  if (!GM(t)) return null;
  for (let e of WM) {
    let n = t[e];
    if (Array.isArray(n)) return n;
  }
  return null;
}
function ZM(e) {
  let t = XM(e);
  if (!t || t.length === 0) return null;
  let n = t.map((e, t) => JM(e, t)).filter((e) => e !== null);
  return n.length === t.length ? n : null;
}
function QM(e) {
  let t = [e],
    n = typeof e == `string` ? YM(e) : void 0;
  if ((n !== void 0 && t.push(n), GM(e)))
    for (let n of [`content`, `output`, `result`]) {
      let r = e[n];
      if ((t.push(r), typeof r == `string`)) {
        let e = YM(r);
        e !== void 0 && t.push(e);
      }
    }
  return t;
}
function $M(e) {
  return typeof e == `string` && UM.test(e.trim());
}
function eN(e) {
  return $M([e.title, e.kind].filter(Boolean).join(` `)) ? ZM(e.input) : null;
}
function tN(e) {
  if (!$M([e.title, e.kind].filter(Boolean).join(` `))) return null;
  for (let t of QM(e.output)) {
    let e = ZM(t);
    if (e) return e;
  }
  return null;
}
var nN = new Set([`command`, `cmd`, `script`, `shellcommand`]),
  rN = new Set([`args`, `argv`, `arguments`]),
  iN = new Set([
    `path`,
    `paths`,
    `file`,
    `file_path`,
    `filepath`,
    `files`,
    `filename`,
    `filenames`,
    `target`,
    `targets`,
    `location`,
    `locations`,
  ]),
  aN = new Set([`cwd`, `directory`, `workingdirectory`]),
  oN = 6;
function sN(e) {
  return typeof e == `object` && !!e && !Array.isArray(e);
}
function cN(e) {
  return e.trim().replace(/\s+/g, ` `);
}
function lN(e) {
  return e.trim().replace(
    /\r\n/g,
    `
`,
  );
}
function uN(e) {
  return Array.isArray(e)
    ? e
        .map((e) =>
          typeof e == `string`
            ? e.trim()
            : typeof e == `number` || typeof e == `boolean` || typeof e == `bigint`
              ? String(e)
              : ``,
        )
        .filter((e) => e.length > 0)
    : [];
}
function dN(e) {
  return sN(e)
    ? `rawInput` in e && e.rawInput !== void 0
      ? e.rawInput
      : `input` in e
        ? e.input
        : e
    : e;
}
function fN(e) {
  for (let [t, n] of Object.entries(e)) {
    if (!nN.has(t.toLowerCase()) || typeof n != `string`) continue;
    let r = lN(n);
    if (r.length !== 0) {
      for (let [t, n] of Object.entries(e)) {
        if (!rN.has(t.toLowerCase())) continue;
        let e = uN(n);
        if (e.length > 0) return `${r} ${e.join(` `)}`;
      }
      return r;
    }
  }
  return null;
}
function pN(e, t = new Set(), n = !1) {
  if (typeof e == `string`) {
    if (!n) return null;
    let t = lN(e);
    return t.length > 0 ? t : null;
  }
  if (Array.isArray(e)) {
    if (t.has(e)) return null;
    t.add(e);
    for (let n of e) {
      let e = pN(n, t);
      if (e) return e;
    }
    return null;
  }
  if (!sN(e) || t.has(e)) return null;
  t.add(e);
  let r = fN(e);
  if (r) return r;
  for (let n of [`rawInput`, `input`, `params`, `toolCall`]) {
    if (!(n in e)) continue;
    let r = pN(e[n], t, n === `rawInput` || n === `input` || n === `params`);
    if (r) return r;
  }
  for (let n of Object.values(e)) {
    if (!Array.isArray(n) && !sN(n)) continue;
    let e = pN(n, t);
    if (e) return e;
  }
  return null;
}
function mN(e, t) {
  let n = cN(t);
  !n || e.includes(n) || e.push(n);
}
function hN(e, t, n) {
  if (!(t.length >= oN)) {
    if (typeof e == `string`) {
      mN(t, e);
      return;
    }
    if (Array.isArray(e)) {
      if (n.has(e)) return;
      n.add(e);
      for (let r of e) if ((hN(r, t, n), t.length >= oN)) return;
      return;
    }
    if (
      !(!sN(e) || n.has(e)) &&
      (n.add(e), !(typeof e.path == `string` && (mN(t, e.path), t.length >= oN)))
    ) {
      for (let r of Object.values(e)) if ((hN(r, t, n), t.length >= oN)) return;
    }
  }
}
function gN(e, t, n = new Set()) {
  if (!(t.length >= oN)) {
    if (Array.isArray(e)) {
      if (n.has(e)) return;
      n.add(e);
      for (let r of e) if ((gN(r, t, n), t.length >= oN)) return;
      return;
    }
    if (!(!sN(e) || n.has(e))) {
      n.add(e);
      for (let [r, i] of Object.entries(e)) {
        let e = r.toLowerCase();
        if (!aN.has(e)) {
          if (iN.has(e)) {
            if ((hN(i, t, n), t.length >= oN)) return;
            continue;
          }
          if (!(!Array.isArray(i) && !sN(i)) && (gN(i, t, n), t.length >= oN)) return;
        }
      }
    }
  }
}
function _N(e, t, n = new Set()) {
  if (Array.isArray(e)) {
    if (n.has(e)) return;
    n.add(e);
    for (let r of e) _N(r, t, n);
    return;
  }
  if (!(!sN(e) || n.has(e))) {
    if ((n.add(e), sN(e.changes)))
      for (let [n, r] of Object.entries(e.changes))
        sN(r) &&
          ((r.type !== `add` && r.type !== `update`) ||
            t.some((e) => e.path === n && e.type === r.type) ||
            t.push({ path: n, type: r.type }));
    for (let r of Object.values(e)) (!Array.isArray(r) && !sN(r)) || _N(r, t, n);
  }
}
function vN(e) {
  let t = e.raw,
    n = [];
  gN(t, n);
  let r = cN(e.title ?? e.description ?? e.kind) || `permission`,
    i = pN(dN(t), new Set(), !0),
    a = [];
  _N(t, a);
  let o = a.length === 1 ? a[0] : null;
  return {
    title: r,
    command: i,
    filePaths: n,
    scope: i ? `command` : n.length > 0 ? `file` : `generic`,
    fileChange: o,
    fileChanges: a,
  };
}
var yN = 12e4;
function bN(e, t) {
  return e.get(t)?.trim() || void 0;
}
function xN(e) {
  return e === `light` || e === `dark` || e === `zai-light` || e === `zai-dark` || e === `system`;
}
function SN(e) {
  let t = e.trim() || `/`,
    n = `/`;
  try {
    n = new URL(t, `https://zcode.invalid`).pathname;
  } catch {
    n = t.startsWith(`/`) ? t : `/${t}`;
  }
  let r = n.replace(/\/+$/, ``) || `/`;
  return r === `/` ? `/remote` : r;
}
function CN(e, t) {
  let n = (e) => e.replace(/\/+$/, ``) || `/`;
  return n(e) === n(t);
}
function wN(e) {
  let t = bN(e, `sid`),
    n = bN(e, `hash`),
    r = bN(e, `t`),
    i = r ? Number(r) : NaN,
    a = bN(e, `theme`);
  return !t || !n || !Number.isFinite(i)
    ? null
    : {
        deviceSid: t,
        passHash: n,
        timestamp: i,
        ...(bN(e, `mid`) ? { deviceMid: bN(e, `mid`) } : {}),
        ...(bN(e, `name`) ? { deviceName: bN(e, `name`) } : {}),
        ...(bN(e, `app_version`) ? { appVersion: bN(e, `app_version`) } : {}),
        ...(xN(a) ? { theme: a } : {}),
      };
}
var TN = {
  SessionNotFound: 4004,
  SessionConflict: 4009,
  DesktopDisconnected: 4010,
  SessionExpired: 4011,
  WorkspaceClosed: 4012,
  InvalidMobileConnection: 4013,
};
function EN(e) {
  switch (e) {
    case TN.SessionNotFound:
      return `session-not-found`;
    case TN.SessionConflict:
      return `session-conflict`;
    case TN.DesktopDisconnected:
      return `desktop-disconnected`;
    case TN.SessionExpired:
      return `session-expired`;
    case TN.WorkspaceClosed:
      return `workspace-closed`;
    case TN.InvalidMobileConnection:
      return `invalid-mobile-connection`;
    default:
      return null;
  }
}
function DN(e) {
  return e.workspaceIdentity?.trim() || e.workspacePath;
}
function ON(e) {
  return e.kind !== `remote` || !!(e.workspaceIdentity && e.remoteSessionId);
}
function kN({ workspaces: e, mobileViewState: t, initialViewState: n }) {
  let r = e.filter(ON),
    i = new Set(r.map((e) => DN(e))),
    a = new Set(e.map((e) => DN(e))),
    o = t ?? n,
    s = o?.activeWorkspaceKey;
  if (s && i.has(s))
    return {
      workspaceKey: s,
      ...(o.activeTaskId ? { taskId: o.activeTaskId } : {}),
      canBridge: !0,
    };
  let c = r[0];
  if (!c) {
    if (s && a.has(s))
      return {
        workspaceKey: s,
        ...(o?.activeTaskId ? { taskId: o.activeTaskId } : {}),
        canBridge: !1,
      };
    let t = e[0];
    return t ? { workspaceKey: DN(t), canBridge: !1 } : null;
  }
  return { workspaceKey: DN(c), canBridge: !0 };
}
var AN = 1e4,
  jN = 2e3,
  MN = 3e4,
  NN = 2e3;
function PN(e) {
  let t = e();
  return Number.isFinite(t) ? Math.min(0.999999999, Math.max(0, t)) : 0;
}
function FN(e = AN, t) {
  let n = Number.isFinite(e) && e > 0 ? Math.floor(e) : AN,
    r = Math.min(jN, Math.floor(n * 0.2)),
    i = t ?? r;
  return !Number.isFinite(i) || i <= 0 ? 0 : Math.min(Math.floor(i), Math.max(0, n - 1));
}
function IN(e = AN, t, n = Math.random) {
  let r = Number.isFinite(e) && e > 0 ? Math.floor(e) : AN,
    i = FN(r, t),
    a = Math.max(1, r - i),
    o = r + i;
  return a + Math.floor(PN(n) * (o - a + 1));
}
function LN(e = NN, t = Math.random) {
  if (!Number.isFinite(e) || e <= 0) return 0;
  let n = Math.floor(e);
  return Math.floor(PN(t) * (n + 1));
}
var RN = `coding_plan_system_busy`;
function zN() {
  return globalThis.process?.env ?? {};
}
function BN(e = zN()) {
  return e.INTRANET_MACHINE_HOST?.trim() || `studio.zcode-ai.com`;
}
var VN = BN();
(`${VN}`, `${VN}`);
function HN(e, t, n) {
  for (let r = t; r < n; r += 1) if (e[r]?.kind === `local`) return r;
  return null;
}
function UN(e, t) {
  if (e.length === 0) return null;
  let n = Math.min(Math.max(t ?? 0, 0), e.length - 1);
  return HN(e, n, e.length) ?? HN(e, 0, n);
}
var WN = O({
  id: S().uuid(),
  runtimeScope: M([`main`, `subagent`]),
  token: S().min(32),
  sessionId: S().trim().min(1),
  turnId: S().trim().min(1).optional(),
  trace: O({
    traceId: S().trim().min(1),
    spanId: S().trim().min(1).optional(),
    parentSpanId: S().trim().min(1).optional(),
  })
    .strict()
    .optional(),
});
(A(`op`, [
  WN.extend({ op: N(`list`) }).strict(),
  WN.extend({
    op: N(`execute`),
    browserId: S().trim().min(1),
    browserGeneration: w().int().nonnegative(),
    command: $l,
  }).strict(),
]),
  A(`ok`, [
    O({ id: S().uuid(), ok: N(!0), browsers: D(nu).optional(), result: mu.optional() }).strict(),
    O({ id: S().uuid(), ok: N(!1), error: S().min(1) }).strict(),
  ]));
var GN = 6e4,
  KN = [`rssKb`, `heapUsedKb`, `heapTotalKb`, `externalKb`, `arrayBuffersKb`];
function qN(e, t) {
  let n = new Set([...Object.keys(e), ...Object.keys(t)]);
  for (let r of n) if (e[r] !== t[r]) return !0;
  return !1;
}
function JN(e, t, n) {
  return e !== void 0 && t !== void 0 && Math.abs(e - t) > Math.max(t, 1) * n;
}
function YN(e = {}) {
  let t = e.heapDeltaRatio ?? 0.05,
    n = e.nativeDeltaRatio ?? 0.1,
    r = e.heartbeatMs ?? 3e5,
    i,
    a = 0;
  return {
    evaluate(e, o) {
      let s = null;
      return (
        i
          ? JN(e.heapUsedKb, i.heapUsedKb, t) ||
            JN(e.rssKb, i.rssKb, n) ||
            JN(e.externalKb, i.externalKb, n) ||
            qN(e.counters, i.counters)
            ? (s = `changed`)
            : o - a >= r && (s = `heartbeat`)
          : (s = `first`),
        s && ((i = { ...e, counters: { ...e.counters } }), (a = o)),
        s
      );
    },
  };
}
function XN(e, t) {
  let n = [`[memory]`, `role=${e.role}`, `reason=${t}`];
  for (let t of KN) {
    let r = e[t];
    typeof r == `number` && Number.isFinite(r) && n.push(`${t}=${Math.round(r)}`);
  }
  for (let t of Object.keys(e.counters).sort()) {
    let r = e.counters[t];
    typeof r == `number` && Number.isFinite(r) && n.push(`${t}=${Math.round(r)}`);
  }
  return n.join(` `);
}
function ZN() {
  let e = new Map();
  return {
    register(t, n) {
      return (
        e.set(t, n),
        {
          dispose() {
            e.get(t) === n && e.delete(t);
          },
        }
      );
    },
    collect() {
      let t = {};
      for (let [n, r] of e)
        try {
          for (let [e, i] of Object.entries(r()))
            typeof i == `number` && Number.isFinite(i) && (t[`${n}.${e}`] = i);
        } catch {}
      return t;
    },
  };
}
var QN = M([`build`, `edit`, `yolo`, `auto`]);
O({ mode: QN, planEnabled: T() });
function $N(e, t = { mode: `build`, planEnabled: !1 }) {
  let n = QN.safeParse(e.mode);
  return {
    mode: n.success ? n.data : t.mode,
    planEnabled: e.planEnabled ?? (e.mode === `plan` ? !0 : n.success ? !1 : t.planEnabled),
  };
}
var eP = D(S().trim().min(1)).transform((e) => [...new Set(e)]),
  tP = O({ categoryOrder: eP.optional(), pluginOrder: j(S(), eP).optional() });
(O({ code: tP.optional().catch(void 0), work: tP.optional().catch(void 0) }),
  O({ forceRefresh: T().optional() }),
  O({
    code: N(0),
    data: O({ configs: O({ pluginStoreOrder: E().optional() }).nullish() }).nullish(),
  }));
var nP = `other`,
  rP = [`productivity`, `developer-tools`, `utilities`, `finance`, `legal`, `template`],
  iP = new Map(
    [`pdf`, `presentations`, `spreadsheets`, `documents`].map((e, t) => [`${e}@${sM}`, t]),
  );
function aP(e, t) {
  return lP(iP, e, t);
}
function oP(e) {
  let t = e?.trim();
  return t === `guides` ? `utilities` : t || void 0;
}
function sP(e, t, n, r) {
  let i = cP(r?.categoryOrder),
    a = new Map(Object.entries(r?.pluginOrder ?? {}).map(([e, t]) => [e, cP(t)]));
  return e
    .map((e, n) => {
      let r = t(e);
      return { item: e, index: n, ...r, category: oP(r.category) ?? `other` };
    })
    .sort(
      (e, t) =>
        lP(i, e.category, t.category) ||
        uP(e.category, t.category) ||
        lP(a.get(e.category), e.id, t.id) ||
        aP(e.id, t.id) ||
        e.displayName.localeCompare(t.displayName, n) ||
        e.index - t.index,
    )
    .map(({ item: e }) => e);
}
function cP(e = []) {
  let t = new Map();
  for (let n of e) t.has(n) || t.set(n, t.size);
  return t;
}
function lP(e, t, n) {
  return e ? (e.get(t) ?? e.size) - (e.get(n) ?? e.size) : 0;
}
function uP(e, t) {
  if (e === t) return 0;
  if (e === `other`) return 1;
  if (t === `other`) return -1;
  let n = rP.indexOf(e),
    r = rP.indexOf(t);
  return n !== -1 && r !== -1 ? n - r : n === -1 ? (r === -1 && e < t ? -1 : 1) : -1;
}
var dP = S().trim().min(1).max(128),
  fP = S()
    .max(4096)
    .url()
    .refine((e) => {
      if (!URL.canParse(e)) return !1;
      let t = new URL(e);
      return [`http:`, `https:`].includes(t.protocol) && !t.username && !t.password;
    }),
  pP = O({ src: fP, sha256: S().regex(/^[a-f0-9]{64}$/u) }),
  mP = O({ format: M([`plaintext`, `html`, `markdown`]), content: S().max(2e4) }),
  hP = A(`page`, [
    O({ page: N(`upgrade`) }).strict(),
    O({ page: N(`rewards`) }).strict(),
    O({
      page: N(`settings`),
      section: M([
        `general`,
        `appearance`,
        `models`,
        `browser`,
        `computer_use`,
        `memory`,
        `subagents`,
        `plugins`,
        `mcp`,
        `skills`,
        `commands`,
        `hooks`,
        `usage`,
      ]).optional(),
      provider_id: dP.optional(),
    })
      .strict()
      .refine((e) => e.provider_id === void 0 || e.section === `models`),
    O({
      page: N(`plugin_marketplace`),
      plugin_id: dP.regex(/^[^@\s]+@[^@\s]+$/u).optional(),
    }).strict(),
  ]),
  gP = O({
    text: mP,
    action: A(`type`, [
      O({ type: N(`close`) }),
      O({ type: N(`open_url`), args: O({ url: fP }) }),
      O({ type: N(`claim_zcode_plan`), args: O({ plan_id: dP }) }),
      O({ type: N(`navigate`), args: hP }),
      O({
        type: N(`copy_text`),
        args: O({
          text: S()
            .max(2e4)
            .refine((e) => e.trim().length > 0),
        }).strict(),
      }),
    ]),
    theme: Ec.nullish(),
  }),
  _P = gP.omit({ theme: !0 }).extend({
    text: mP.extend({
      format: M([``, `plaintext`, `html`, `markdown`]).transform((e) => e || `plaintext`),
    }),
  }),
  vP = M([``, `v1`]).optional(),
  yP = j(S(), E())
    .refine((e) => JSON.stringify(e).length <= 64e3)
    .optional(),
  bP = A(`type`, [
    O({ type: N(`image`), image: O({ default: pP, dark: pP.nullish() }), args: yP }),
    O({ type: N(`video`), video: O({ src: pP, fallback: pP }), args: yP }),
    O({
      type: N(`bundle`),
      bundle: O({
        bundle: pP,
        entry: S()
          .min(1)
          .max(240)
          .refine(
            (e) => !e.includes(`\\`) && e.split(`/`).every((e) => e && e !== `.` && e !== `..`),
          ),
        fallback: pP.nullish(),
      }),
      args: yP,
    }),
  ]),
  xP = O({ layout: vP, title: mP, description: mP, hero: bP.nullish(), buttons: D(gP).max(4) }),
  SP = O({ layout: vP, background: bP, buttons: D(_P).max(2), success_popup: xP.nullish() }).refine(
    (e) =>
      e.buttons.filter((e) => e.action.type === `close`).length <= 1 &&
      e.buttons.filter((e) => e.action.type !== `close`).length <= 1,
  ),
  CP = { campaign_id: dP, priority: w().int().min(0).max(100) };
(A(`resource_position`, [
  O({ ...CP, resource_position: N(`banner`), banner: SP }),
  O({ ...CP, resource_position: N(`popup`), popup: xP }),
]),
  O({
    code: N(0),
    data: O({
      server_time: w().finite(),
      language: M([`zh-CN`, `en-US`]),
      deliveries: D(E()).max(32),
    }),
  }));
var wP = `persist:zcode-rewards`,
  TP = O({
    theme: M([`zai-light`, `zai-dark`]),
    locale: M([`zh-CN`, `en-US`]),
    auth: O({
      status: M([`ready`, `anonymous`]),
      provider: M([`zai`, `bigmodel`]).nullable(),
      revision: w().int().nonnegative(),
    }),
  });
function EP(e, t = {}) {
  try {
    let n = new URL(e);
    return n.username || n.password
      ? !1
      : ([`https://zcode.z.ai`, `https://zcode.chatglm.site`].includes(n.origin) ||
          (t.dev === !0 && n.origin === `http://localhost:3000`) ||
          (t.e2e === !0 &&
            n.protocol === `http:` &&
            [`127.0.0.1`, `localhost`].includes(n.hostname))) &&
          /^\/(cn|en)\/rewards\/?$/.test(n.pathname) &&
          n.searchParams.get(`embedded`) === `app`;
  } catch {
    return !1;
  }
}
function DP(e) {
  try {
    if (e.override && EP(OP(e.override, `en-US`, `zai-dark`), e)) return new URL(e.override).origin;
  } catch {}
  return e.env === `test` ? `https://zcode.chatglm.site` : `https://zcode.z.ai`;
}
function OP(e, t, n) {
  let r = new URL(`/${t === `zh-CN` ? `cn` : `en`}/rewards`, e);
  return (r.searchParams.set(`embedded`, `app`), r.searchParams.set(`theme`, n), r.toString());
}
function kP(e, t, n) {
  let r = TP.parse(e),
    i =
      r.auth.status === `ready`
        ? {
            [`oauth:${r.auth.provider}:access_token`]: t.oauth?.trim() || null,
            zcodejwttoken: t.jwt?.trim() || null,
          }
        : {};
  return `(() => {
    ${n ? `if (window.location.href !== ${JSON.stringify(n)}) return;` : ``}
    for (const key of ["oauth:zai:access_token", "oauth:bigmodel:access_token", "zcodejwttoken"]) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(${JSON.stringify(i)})) if (value) localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent("zcode-rewards-context", { detail: ${JSON.stringify(r)} }));
  })()`;
}
var AP = { rounds: 200, network: 100, dedupe: 2e3 };
O({ sessionId: S().min(1) }).strict();
var $ = w().finite().nonnegative(),
  jP = O({
    inputTokens: $.optional(),
    outputTokens: $.optional(),
    totalTokens: $.optional(),
    reasoningTokens: $.optional(),
    cachedInputTokens: $.optional(),
    cachedWriteInputTokens: $.optional(),
  }).strict(),
  MP = O({
    eventKey: S(),
    requestId: S(),
    requestIndex: $,
    recordedAt: $,
    usage: jP,
    hitRate: $.nullable(),
    generationDurationMs: $.nullable(),
    tokensPerSecond: $.nullable(),
  }).strict(),
  NP = O({
    eventKey: S(),
    traceId: S(),
    recordedAt: $,
    statusType: M([
      `model_request_started`,
      `model_request_completed`,
      `model_request_failed`,
      `model_retry_scheduled`,
      `model_stream_stalled`,
    ]),
    requestId: S().optional(),
    providerId: S().optional(),
    modelId: S().optional(),
    providerKind: S().optional(),
    transport: S().optional(),
    baseURL: S().optional(),
    querySource: S().optional(),
    queryId: S().optional(),
    timestamp: S().optional(),
    attempt: $.optional(),
    maxAttempts: $.optional(),
    nextAttempt: $.optional(),
    retryable: T().optional(),
    statusCode: $.optional(),
    durationMs: $.optional(),
    delayMs: $.optional(),
    idleMs: $.optional(),
    timeoutMs: $.optional(),
    reason: S().optional(),
    message: S().optional(),
    requestHeaders: j(S(), S()),
    responseHeaders: j(S(), S()),
    requestHeaderCount: $,
    responseHeaderCount: $,
  }).strict();
O({
  sessionId: S(),
  rounds: D(MP).max(AP.rounds),
  networkEntries: D(NP).max(AP.network),
  cache: O({
    hitRateRequestCount: $,
    totalInputTokens: $,
    totalCacheReadTokens: $,
    hitRate: $.nullable(),
  })
    .strict()
    .nullable(),
}).strict();
var PP = `[REDACTED]`,
  FP =
    /(?:password|passwd|passphrase|secret|token|apikey|accesskey|privatekey|authorization|cookie|credential)/i,
  IP =
    /^(?:content|messages?|prompt|systemprompt|request|response|body|payload|input|output|toolinput|tooloutput|arguments|args|env|environment|headers|text|completion|result|stdout|stderr|data|params)$/i;
function LP(e) {
  return e.replace(/[^a-z0-9]/gi, ``);
}
function RP(e, t) {
  let n = LP(e);
  return FP.test(n) || (t && IP.test(n));
}
function zP(e) {
  let t = [];
  for (let n of e.matchAll(/(?:"((?:\\.|[^"\\])*)"|'([^']*)'|([\w.-]+))\s*[:=]\s*/g)) {
    let e = n[1] ?? n[2] ?? n[3] ?? ``;
    if (n[1] !== void 0)
      try {
        e = JSON.parse(`"${e}"`);
      } catch {}
    t.push({ key: e, quoted: n[3] === void 0, end: n.index + n[0].length });
  }
  return t;
}
function BP(e, t) {
  if (
    t ||
    e.username ||
    e.password ||
    e.hostname === `hooks.slack.com` ||
    [...e.searchParams.keys()].some((e) => RP(e, !1) || /^(?:.*signature|sig|code)$/i.test(LP(e)))
  )
    return !0;
  try {
    return decodeURIComponent(e.pathname)
      .split(`/`)
      .some((e) => {
        let t = LP(e);
        return (
          FP.test(t) ||
          /^(?:webhook\w*|(?:password)?reset(?:password)?|invites?|invitations?|callback|downloads?|signed|verify|verification|activate|magiclink)$/.test(
            t.toLowerCase(),
          )
        );
      });
  } catch {
    return !0;
  }
}
function VP(e, t) {
  let n = e
    .replace(/\b((?:Proxy-)?Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, `$1: ${PP}`)
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
      PP,
    )
    .replace(/\bBearer\s+[^\s"'\\,;]+/gi, `Bearer ${PP}`)
    .replace(/([\w.-]+)(\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,;"'<>]+)/g, (e, t, n) =>
      RP(t, !1) ? `${t}${n}${PP}` : e,
    )
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>\\]+/gi, (e) => {
      try {
        let n = new URL(e);
        return (
          BP(n, t) && n.pathname && n.pathname !== `/` && (n.pathname = `/${PP}`),
          (n.username = ``),
          (n.password = ``),
          (n.search = ``),
          (n.hash = ``),
          n.toString()
        );
      } catch {
        return PP;
      }
    })
    .replace(/(?:\/(?:Users|home)\/|[a-z]:\\Users\\)[^\s"'<>]+/gi, `[USER_PATH]`);
  return (t && (n = n.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, `[EMAIL]`)), n);
}
function HP(e, t, n = 0) {
  return n > 32
    ? PP
    : typeof e == `string`
      ? GP(e, t, n + 1)
      : Array.isArray(e)
        ? e.map((e) => HP(e, t, n + 1))
        : e && typeof e == `object`
          ? Object.fromEntries(
              Object.entries(e).map(([e, r]) => [e, RP(e, t) ? PP : HP(r, t, n + 1)]),
            )
          : e;
}
function UP(e, t) {
  return VP(e, t)
    .split(/\r?\n/)
    .map((e) =>
      zP(e).some(
        ({ key: n, quoted: r, end: i }) => RP(n, t) && (r || t || !e.slice(i).startsWith(PP)),
      )
        ? PP
        : e,
    ).join(`
`);
}
function WP(e, t) {
  let n = 0,
    r = !1,
    i = !1;
  for (let a = t; a < e.length; a += 1) {
    let t = e[a];
    if (r) i ? (i = !1) : t === `\\` ? (i = !0) : t === `"` && (r = !1);
    else if (t === `"`) r = !0;
    else if (t === `{` || t === `[`) n += 1;
    else if ((t === `}` || t === `]`) && --n === 0) return a + 1;
  }
  return e.length;
}
function GP(e, t, n) {
  if (n > 32) return PP;
  try {
    let r = JSON.parse(e);
    if (r && typeof r == `object`) return JSON.stringify(HP(r, t, n + 1));
  } catch {}
  let r = VP(e, t),
    i = [],
    a = 0;
  for (let e = 0; e < r.length; e += 1) {
    if (r.startsWith(PP, e)) {
      e += 9;
      continue;
    }
    if (r[e] !== `{` && r[e] !== `[`) continue;
    let o = r.slice(a, e),
      s = WP(r, e),
      c = zP(
        o.slice(
          o.lastIndexOf(`
`) + 1,
        ),
      ).some(({ key: e }) => RP(e, t));
    if (c) {
      let e = r.indexOf(
        `
`,
        s,
      );
      s = e < 0 ? r.length : e;
    }
    let l = r.slice(e, s);
    i.push(UP(o, t));
    try {
      i.push(c ? PP : JSON.stringify(HP(JSON.parse(l), t, n + 1)));
    } catch {
      i.push(c || zP(l).some(({ key: e }) => RP(e, t)) ? PP : UP(l, t));
    }
    ((a = s), (e = s - 1));
  }
  return (i.push(UP(r.slice(a), t)), i.join(``));
}
function KP(e, t = {}) {
  return GP(e, t.diagnostic === !0, 0);
}
export {
  tM as $,
  xE as $a,
  Nh as $c,
  ZE as $i,
  pf as $l,
  YO as $n,
  ZD as $o,
  fD as $r,
  gD as $s,
  OA as $t,
  N as $u,
  SN as A,
  aE as Aa,
  gy as Ac,
  xw as Ai,
  xp as Al,
  Qk as An,
  cE as Ao,
  Iw as Ar,
  OD as As,
  oj as At,
  Al as Au,
  DM as B,
  pE as Ba,
  l_ as Bc,
  Ow as Bi,
  ip as Bl,
  $k as Bn,
  UD as Bo,
  Kw as Br,
  jD as Bs,
  ZA as Bt,
  Vc as Bu,
  LN as C,
  AO as Ca,
  wS as Cc,
  FT as Ci,
  Vp as Cl,
  Mk as Cn,
  ED as Co,
  nT as Cr,
  DD as Cs,
  Cj as Ct,
  Bu as Cu,
  wN as D,
  iE as Da,
  Yv as Dc,
  TT as Di,
  kp as Dl,
  Xk as Dn,
  zE as Do,
  aT as Dr,
  WD as Ds,
  bj as Dt,
  Ou as Du,
  CN as E,
  IT as Ea,
  Dy as Ec,
  ET as Ei,
  vp as El,
  Kk as En,
  BE as Eo,
  iT as Er,
  SO as Es,
  Sj as Et,
  I as Eu,
  $M as F,
  OT as Fa,
  Wv as Fc,
  _w as Fi,
  bp as Fl,
  Ik as Fn,
  jw as Fo,
  Yw as Fr,
  gO as Fs,
  YA as Ft,
  al as Fu,
  cM as G,
  FE as Ga,
  Eg as Gc,
  tD as Gi,
  Hf as Gl,
  tA as Gn,
  RD as Go,
  Uw as Gr,
  wD as Gs,
  VA as Gt,
  Pc as Gu,
  mM as H,
  gE as Ha,
  bg as Hc,
  IE as Hi,
  tp as Hl,
  Gk as Hn,
  fO as Ho,
  zw as Hr,
  xD as Hs,
  qA as Ht,
  Jc as Hu,
  FM as I,
  kT as Ia,
  Uv as Ic,
  Sw as Ii,
  Pp as Il,
  Bk as In,
  kw as Io,
  Xw as Ir,
  _O as Is,
  XA as It,
  il as Iu,
  oM as J,
  OE as Ja,
  Fh as Jc,
  $E as Ji,
  wf as Jl,
  jO as Jn,
  zD as Jo,
  $T as Jr,
  yD as Js,
  IA as Jt,
  Ws as Ju,
  sM as K,
  PE as Ka,
  _h as Kc,
  eD as Ki,
  mf as Kl,
  Dw as Kn,
  ID as Ko,
  Hw as Kr,
  hD as Ks,
  UA as Kt,
  Nc as Ku,
  MM as L,
  DT as La,
  Hv as Lc,
  hw as Li,
  Bp as Ll,
  zk as Ln,
  sT as Lo,
  Jw as Lr,
  vO as Ls,
  ej as Lt,
  Xc as Lu,
  vN as M,
  fT as Ma,
  ly as Mc,
  Cw as Mi,
  hp as Ml,
  Zk as Mn,
  sE as Mo,
  Vw as Mr,
  TO as Ms,
  fj as Mt,
  jl as Mu,
  eN as N,
  dT as Na,
  Gv as Nc,
  yw as Ni,
  yp as Nl,
  jk as Nn,
  dE as No,
  Qw as Nr,
  EO as Ns,
  hj as Nt,
  Ll as Nu,
  EN as O,
  nE as Oa,
  xy as Oc,
  wk as Oi,
  Ap as Ol,
  Jk as On,
  uE as Oo,
  eT as Or,
  OO as Os,
  vj as Ot,
  wu as Ou,
  tN as P,
  pT as Pa,
  Jv as Pc,
  vw as Pi,
  lp as Pl,
  Lk as Pn,
  cT as Po,
  Zw as Pr,
  DO as Ps,
  Q as Pt,
  wl as Pu,
  nM as Q,
  jE as Qa,
  Th as Qc,
  nD as Qi,
  Df as Ql,
  IO as Qn,
  $D as Qo,
  eE as Qr,
  _D as Qs,
  EA as Qt,
  A as Qu,
  NM as R,
  AT as Ra,
  $_ as Rc,
  mw as Ri,
  sp as Rl,
  Rk as Rn,
  VD as Ro,
  Gw as Rr,
  AD as Rs,
  $A as Rt,
  Qc as Ru,
  FN as S,
  LE as Sa,
  TS as Sc,
  LT as Si,
  jp as Sl,
  aA as Sn,
  bT as So,
  Pw as Sr,
  kO as Ss,
  wj as St,
  Vu as Su,
  xN as T,
  RT as Ta,
  fS as Tc,
  vk as Ti,
  Lp as Tl,
  Nk as Tn,
  Ck as To,
  Fw as Tr,
  xO as Ts,
  Oj as Tt,
  Du as Tu,
  gM as U,
  vE as Ua,
  yg as Uc,
  iD as Ui,
  rp as Ul,
  Wk as Un,
  ND as Uo,
  Rw as Ur,
  SD as Us,
  WA as Ut,
  zc as Uu,
  EM as V,
  _E as Va,
  xg as Vc,
  RE as Vi,
  np as Vl,
  Uk as Vn,
  pO as Vo,
  Ww as Vr,
  PT as Vs,
  JA as Vt,
  qc as Vu,
  pM as W,
  yE as Wa,
  Cg as Wc,
  UE as Wi,
  Xf as Wl,
  Ak as Wn,
  FD as Wo,
  Bw as Wr,
  CD as Ws,
  BA as Wt,
  Fc as Wu,
  rM as X,
  kE as Xa,
  Lh as Xc,
  JE as Xi,
  Tf as Xl,
  ZO as Xn,
  XD as Xo,
  qT as Xr,
  MT as Xs,
  RA as Xt,
  D as Xu,
  aM as Y,
  ME as Ya,
  jh as Yc,
  YE as Yi,
  Of as Yl,
  NO as Yn,
  LD as Yo,
  QT as Yr,
  NT as Ys,
  zA as Yt,
  M as Yu,
  iM as Z,
  AE as Za,
  Dh as Zc,
  rD as Zi,
  kf as Zl,
  XO as Zn,
  eO as Zo,
  JT as Zr,
  vD as Zs,
  NA as Zt,
  T as Zu,
  RN as _,
  HO as _a,
  lC as _c,
  VT as _i,
  Pm as _l,
  Hk as _n,
  uT as _o,
  mk as _r,
  uO as _s,
  Pj as _t,
  L as _u,
  EP as a,
  Tw as aa,
  iw as ac,
  k as ad,
  oD as ai,
  dh as al,
  _A as an,
  DE as ao,
  ok as ar,
  KD as as,
  eM as at,
  V as au,
  NN as b,
  UO as ba,
  nC as bc,
  HT as bi,
  Cp as bl,
  iA as bn,
  yT as bo,
  fk as br,
  hO as bs,
  Tj as bt,
  Wu as bu,
  aP as c,
  KO as ca,
  XC as cc,
  dD as ci,
  ph as cl,
  cA as cn,
  mE as co,
  ik as cr,
  JD as cs,
  Uj as ct,
  ud as cu,
  $N as d,
  RO as da,
  kC as dc,
  pD as di,
  Xm as dl,
  Vk as dn,
  HE as do,
  QO as dr,
  CO as ds,
  Gj as dt,
  Zu as du,
  QE as ea,
  CT as ec,
  w as ed,
  KT as ei,
  Mh as el,
  DA as en,
  CE as eo,
  FO as er,
  tO as es,
  Xj as et,
  H as eu,
  GN as f,
  BO as fa,
  EC as fc,
  YT as fi,
  Ym as fl,
  kk as fn,
  Aw as fo,
  rk as fr,
  BD as fs,
  qj as ft,
  Xu as fu,
  UN as g,
  bk as ga,
  uC as gc,
  tE as gi,
  Nm as gl,
  Fk as gn,
  lT as go,
  gk as gr,
  lO as gs,
  Mj as gt,
  qu as gu,
  XN as h,
  yk as ha,
  DC as hc,
  cD as hi,
  xm as hl,
  Ok as hn,
  vT as ho,
  hk as hr,
  cO as hs,
  Ij as ht,
  Ku as hu,
  OP as i,
  WE as ia,
  dw as ic,
  S as id,
  XT as ii,
  rh as il,
  pA as in,
  bE as io,
  sk as ir,
  qD as is,
  Qj as it,
  af as iu,
  DN as j,
  mT as ja,
  sy as jc,
  bw as ji,
  _p as jl,
  Yk as jn,
  oE as jo,
  Lw as jr,
  yO as js,
  mj as jt,
  Pl as ju,
  kN as k,
  rE as ka,
  uy as kc,
  Mw as ki,
  Rp as kl,
  qk as kn,
  lE as ko,
  tT as kr,
  wO as ks,
  gj as kt,
  gu as ku,
  oP as l,
  qO as la,
  YC as lc,
  uD as li,
  Qm as ll,
  Tk as ln,
  VE as lo,
  $O as lr,
  mO as ls,
  Kj as lt,
  od as lu,
  YN as m,
  LO as ma,
  CC as mc,
  lD as mi,
  Im as ml,
  Ek as mn,
  ST as mo,
  tk as mr,
  sO as ms,
  Lj as mt,
  Ju as mu,
  kP as n,
  KE as na,
  Sk as nc,
  j as nd,
  WT as ni,
  th as nl,
  dA as nn,
  EE as no,
  uk as nr,
  rO as ns,
  Yj as nt,
  $d as nu,
  DP as o,
  Ew as oa,
  ow as oc,
  E as od,
  sD as oi,
  fh as ol,
  uA as on,
  hE as oo,
  lk as or,
  GD as os,
  Jj as ot,
  Hd as ou,
  ZN as p,
  zO as pa,
  TC as pc,
  ZT as pi,
  Lm as pl,
  Dk as pn,
  xT as po,
  nk as pr,
  iO as ps,
  zj as pt,
  Yu as pu,
  uM as q,
  wE as qa,
  Ph as qc,
  XE as qi,
  Ef as ql,
  MO as qn,
  PD as qo,
  rT as qr,
  bD as qs,
  LA as qt,
  P as qu,
  wP as r,
  GE as ra,
  fw as rc,
  Gs as rd,
  GT as ri,
  nh as rl,
  gA as rn,
  TE as ro,
  ck as rr,
  nO as rs,
  $j as rt,
  rf as ru,
  nP as s,
  ww as sa,
  nw as sc,
  aD as si,
  $m as sl,
  lA as sn,
  fE as so,
  ak as sr,
  YD as ss,
  Bj as st,
  ld as su,
  KP as t,
  qE as ta,
  wT as tc,
  O as td,
  UT as ti,
  mh as tl,
  vA as tn,
  SE as to,
  PO as tr,
  QD as ts,
  Zj as tt,
  Zd as tu,
  sP as u,
  GO as ua,
  OC as uc,
  mD as ui,
  qm as ul,
  sA as un,
  jT as uo,
  ek as ur,
  bO as us,
  Wj as ut,
  B as uu,
  MN as v,
  VO as va,
  oC as vc,
  BT as vi,
  ym as vl,
  nA as vn,
  TD as vo,
  pk as vr,
  aO as vs,
  kj as vt,
  Gu as vu,
  yN as w,
  oT as wa,
  Sb as wc,
  _k as wi,
  fp as wl,
  Pk as wn,
  _T as wo,
  $w as wr,
  dO as ws,
  Dj as wt,
  Ru as wu,
  IN as x,
  JO as xa,
  CS as xc,
  xk as xi,
  Mp as xl,
  oA as xn,
  gT as xo,
  Nw as xr,
  kD as xs,
  Ej as xt,
  Hu as xu,
  AN as y,
  WO as ya,
  aC as yc,
  zT as yi,
  Sp as yl,
  rA as yn,
  hT as yo,
  dk as yr,
  oO as ys,
  Aj as yt,
  Uu as yu,
  jM as z,
  NE as za,
  Qg as zc,
  gw as zi,
  cp as zl,
  eA as zn,
  HD as zo,
  qw as zr,
  MD as zs,
  QA as zt,
  Bc as zu,
};
