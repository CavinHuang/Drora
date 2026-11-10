// 还原自发行 bundle（官方 0.6.5 win32 entry :21568-21595，
// src/broker/server/windowsValueReadback.ts）：写后读回裁决。
// classifyInsertionReadback：插入语义（type_text 的 element_native 后台插入）——
// before/after 不可读 → unreadable；after 含 requested 且与 before 不同 →
// changed_contains；否则 unchanged（全部 unverifiable，插入语义无法确证）。
// classifyReplacementReadback：替换语义（element_set_value 的 setValueReadbackAsync）——
// after===requested → confirmed（before 相同则 idempotent）；after===before →
// pending/suspected_noop；其余 pending/unverifiable。
// applyAxEchoSurfaceTrust：Chromium 直接宿主的 AX 值是渲染回声，confirmed 降级为
// unverifiable（axEchoDemoted 标记）。
export function classifyInsertionReadback(before: string | null, after: string | null, requested: string) {
  if (before === null || after === null) {
    return { verify: "unreadable", effect: "unverifiable" };
  }
  if (before !== after && after.includes(requested)) {
    return { verify: "changed_contains", effect: "unverifiable" };
  }
  return { verify: "unchanged", effect: "unverifiable" };
}

export function classifyReplacementReadback(before: string | null, after: string | null, requested: string) {
  if (after === null) {
    return { verify: "unreadable", effect: "unverifiable" };
  }
  if (after === requested) {
    return before === requested
      ? { verify: "confirmed", effect: "confirmed", idempotent: true }
      : { verify: "confirmed", effect: "confirmed" };
  }
  if (before !== null && after === before) {
    return { verify: "pending", effect: "suspected_noop" };
  }
  return { verify: "pending", effect: "unverifiable" };
}

export function applyAxEchoSurfaceTrust(verdict, chromiumHost) {
  if (!chromiumHost || verdict.effect !== "confirmed") {
    return verdict;
  }
  return { ...verdict, effect: "unverifiable", axEchoDemoted: true };
}
