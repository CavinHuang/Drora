// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
var e = !0,
  t = `Invariant failed`;
function n(n, r) {
  if (!n) {
    if (e) throw Error(t);
    var i = typeof r == `function` ? r() : r,
      a = i ? `${t}: ${i}` : t;
    throw Error(a);
  }
}
export { n as t };
