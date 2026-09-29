// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
import { t as e } from "./path-Nr114YUd.js";
function t(e) {
  return function () {
    return e;
  };
}
function n(t) {
  let n = 3;
  return (
    (t.digits = function (e) {
      if (!arguments.length) return n;
      if (e == null) n = null;
      else {
        let t = Math.floor(e);
        if (!(t >= 0)) throw RangeError(`invalid digits: ${e}`);
        n = t;
      }
      return t;
    }),
    () => new e(n)
  );
}
export { t as n, n as t };
