// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
import {
  _ as e,
  g as t,
  h as n,
  m as r,
  n as i,
  p as a,
  s as o,
  v as s,
} from "./chunk-K5T4RW27-DC1TZ8rA.js";
var c = class extends i {
    static {
      r(this, `WardleyValueConverter`);
    }
    runCustomConverter(e, t, n) {
      switch (e.name.toUpperCase()) {
        case `LINK_LABEL`:
          return t.substring(1).trim();
        default:
          return;
      }
    }
  },
  l = { parser: { ValueConverter: r(() => new c(), `ValueConverter`) } };
function u(r = n) {
  let i = t(s(r), o),
    c = t(e({ shared: i }), a, l);
  return (i.ServiceRegistry.register(c), { shared: i, Wardley: c });
}
r(u, `createWardleyServices`);
export { u as n, l as t };
