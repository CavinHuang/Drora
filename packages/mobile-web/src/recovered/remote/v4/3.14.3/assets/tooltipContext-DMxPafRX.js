// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
import { An as e, Q as t, X as n, Z as r } from "./chart-g3jDpNEO.js";
var i = (e) => null;
i.displayName = `Cell`;
var a = (n, r, i) => {
    var a = e();
    return (e, o) => (s) => {
      (n?.(e, o, s),
        a(
          t({
            activeIndex: String(o),
            activeDataKey: r,
            activeCoordinate: e.tooltipPosition,
            activeGraphicalItemId: i,
          }),
        ));
    };
  },
  o = (t) => {
    var r = e();
    return (e, i) => (a) => {
      (t?.(e, i, a), r(n()));
    };
  },
  s = (t, n, i) => {
    var a = e();
    return (e, o) => (s) => {
      (t?.(e, o, s),
        a(
          r({
            activeIndex: String(o),
            activeDataKey: n,
            activeCoordinate: e.tooltipPosition,
            activeGraphicalItemId: i,
          }),
        ));
    };
  };
export { i, a as n, o as r, s as t };
