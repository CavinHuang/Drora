// oxlint-disable-file
// 还原自发行 bundle 的 refresh-marker 模块（名称按原始语义恢复中，
// 混淆名别名保留供其他 server 模块渐进迁移）。
import { chmod as mre, rename as gre, rm as JU, writeFile as hre } from "node:fs/promises";
import { randomBytes as fre } from "node:crypto";

// 还原草稿（块级切分，待手工修正导入与类型）

export var Fu = "ZCODE_CUA_PERMISSION_BROKER_REFRESH_MARKER";

export function Bu(e) {
  let t = e.trim();
  if (!t) throw new Error("CUA broker refresh marker requires a non-empty socket path");
  return `${t}.permission-refresh.json`;
}

export var pre = "ZCODE_CUA_DEV_MODE";

export function yh(e = process.env) {
  let t = e[pre]?.trim().toLowerCase();
  return t === "1" || t === "true" || t === "on";
}

export var WC = "pipeline-291084-a1328db1";

export var yre = 3e4,
  YU = 12e4,
  ws = new Map();

export function wre(e) {
  return Bu(e);
}

export async function XU(e, t: { now?: () => number; deadlineMs?: number } = {}) {
  let n: () => number = t.now ?? Date.now,
    r = t.deadlineMs ?? yre;
  if (!Number.isFinite(r) || r <= 0 || r > YU)
    throw new Error(`CUA broker refresh marker deadline must be within 1-${YU}ms, got ${r}`);
  let o = wre(e);
  if (ws.has(o))
    throw new Error("CUA broker permission refresh is already active for this transport");
  let s = Symbol("cua-broker-refresh-marker");
  ws.set(o, {
    id: s,
  });
  let a = n(),
    c = a + r;
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(c) || c <= a)
    throw (ws.delete(o), new Error("CUA broker refresh marker clock produced an invalid deadline"));
  let d: any = `${JSON.stringify({ schema: 1, kind: "permission_refresh", deadlineEpochMs: c })}

`,
    l = `${o}.tmp-${process.pid}-${fre(8).toString("hex")}`;
  try {
    (await hre(l, d, {
      encoding: "utf8",
      flag: "wx",
      mode: 384,
    }),
      await mre(l, 384),
      await gre(l, o));
  } catch (u) {
    throw (
      await JU(l, {
        force: !0,
      }).catch(() => {}),
      ws.get(o)?.id === s && ws.delete(o),
      u
    );
  }
  return {
    path: o,
    deadlineEpochMs: c,
    complete: async () => {
      if (ws.get(o)?.id !== s) return;
      let f;
      for (let v = 0; v < 3; v += 1)
        try {
          (await JU(o, {
            force: !0,
          }),
            (f = void 0));
          break;
        } catch (S) {
          ((f = S), v < 2 && (await new Promise((k) => setTimeout(k, 10))));
        }
      if (f) throw f;
      ws.get(o)?.id === s && ws.delete(o);
    },
  };
}
