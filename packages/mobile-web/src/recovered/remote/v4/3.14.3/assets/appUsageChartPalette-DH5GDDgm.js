// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
var e = [
  `var(--color-usage-chart-1)`,
  `var(--color-usage-chart-2)`,
  `var(--color-usage-chart-3)`,
  `var(--color-usage-chart-4)`,
  `var(--color-usage-chart-5)`,
  `var(--color-usage-chart-6)`,
];
function t(t) {
  return e[t % e.length] ?? e[0];
}
export { t as n, e as t };
