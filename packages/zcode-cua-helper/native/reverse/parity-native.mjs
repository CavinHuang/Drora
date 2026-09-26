// 原版 vs 重编译 ax_native.node 能力对齐验收。
// 分别加载两个 addon,逐能力调用并比对:
//   1. 导出面(名称集合与 typeof)
//   2. 参数校验行为(TypeError 消息逐字)
//   3. 只读能力实测(结构全等;动态值容差)
//   4. 剪贴板 round-trip(先备份用户剪贴板,测后恢复)
//   5. AX 错误路径与元素形状
// 用法:node parity-native.mjs
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import process from "node:process";

// 对照原版:优先 AX_NATIVE_ORIG 环境变量,其次本机发行物,最后回退入库副本
// (build/Release/ax_native.node 与发行物字节一致,CI 上以入库副本为基准)。
import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
const shippedCopy = pathResolve(import.meta.dirname, "../../../build/Release/ax_native.node");
const ORIG =
  process.env.AX_NATIVE_ORIG ??
  "D:/software/zcode/resources/tools/cua-helper/build/Release/ax_native.node";
const ORIG_FINAL = existsSync(ORIG) ? ORIG : shippedCopy;
const REBUILT = "./build/Release/ax_native_win.node";
const base = pathToFileURL(import.meta.dirname + "/").href;
const req = createRequire(base);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "MATCH" : "DIFF "} ${name}${ok ? "" : "  → " + detail}`);
};

const orig = req(ORIG_FINAL);
const rest = req(REBUILT);

// —— 1. 导出面 ——
{
  const on = Object.keys(orig).sort();
  const rn = Object.keys(rest).sort();
  check(
    "export names",
    JSON.stringify(on) === JSON.stringify(rn),
    `orig-only:[${on.filter((n) => !rn.includes(n))}] rest-only:[${rn.filter((n) => !on.includes(n))}]`,
  );
  let typeOk = true;
  const typeDiff = [];
  for (const n of on) {
    if (typeof orig[n] !== typeof rest[n]) {
      typeOk = false;
      typeDiff.push(n);
    }
  }
  check("export types all function", typeOk, typeDiff.join(","));
}

// —— 2. 参数校验 ——
const badCalls = {
  applicationInfo: ["x"],
  applicationInfoByAumid: [42],
  captureApp: ["x"],
  readElement: [42],
  elementAtPoint: ["x", "y"],
  moveTo: ["x", 1],
  scrollAt: [1, 2, "x"],
  mouseDown: [42],
  mouseUp: [42],
  drag: [1, 2, 3],
  clickAtPoint: [1, 2, 3],
  typeTextGlobal: [42],
  pressKeyGlobal: [42],
  keyDownGlobal: [42],
  keyUpGlobal: [42],
  holdKeyGlobal: [42],
  holdKeyGlobalAsync: [42],
  writeClipboardTextAsync: [42],
};
for (const [name, args] of Object.entries(badCalls)) {
  const probe = async (m) => {
    try {
      const r = await m[name](...args);
      return { thrown: false, value: JSON.stringify(r)?.slice(0, 80) };
    } catch (e) {
      return { thrown: true, message: String(e?.message), type: e?.name };
    }
  };
  const a = await probe(orig);
  const b = await probe(rest);
  check(
    `validation: ${name}`,
    a.thrown === b.thrown && a.message === b.message && a.type === b.type,
    `orig=${JSON.stringify(a).slice(0, 120)} rest=${JSON.stringify(b).slice(0, 120)}`,
  );
}

// —— 3. 只读能力 ——
const shape = (v) =>
  JSON.stringify(v, (k, val) =>
    typeof val === "number" && !Number.isInteger(val) ? "<num>" : val,
  );

{
  check("isTrusted", orig.isTrusted() === rest.isTrusted());
  check("probeAccessibility", orig.probeAccessibility() === rest.probeAccessibility());
  check(
    "probeAccessibilityStatus",
    JSON.stringify(orig.probeAccessibilityStatus()) ===
      JSON.stringify(rest.probeAccessibilityStatus()),
  );
  check("isInteractiveSession", orig.isInteractiveSession() === rest.isInteractiveSession());
  check(
    "isScreenCaptureSupported",
    orig.isScreenCaptureSupported() === rest.isScreenCaptureSupported(),
  );
  check("screenCaptureStatus", orig.screenCaptureStatus() === rest.screenCaptureStatus());
  check(
    "dpiAwarenessInfo",
    JSON.stringify(orig.dpiAwarenessInfo()) === JSON.stringify(rest.dpiAwarenessInfo()),
  );
  check(
    "startupError",
    JSON.stringify(orig.startupError()) === JSON.stringify(rest.startupError()),
  );
  check(
    "processExecutablePath",
    JSON.stringify(orig.processExecutablePath()) === JSON.stringify(rest.processExecutablePath()),
  );
  check(
    "isFocusStealPrevented(initial)",
    orig.isFocusStealPrevented() === rest.isFocusStealPrevented(),
  );
  check(
    "cancelPendingInputHolds",
    shape(await orig.cancelPendingInputHolds()) === shape(await rest.cancelPendingInputHolds()),
  );
  // self 的提权态依赖宿主进程上下文(CI runner 服务态可能拿不到 token,实测会
  // 出现 undefined),按类型一致 + 透出两值判定,桌面与 CI 均稳定。
  {
    const ea = orig.isTargetElevated(process.pid);
    const eb = rest.isTargetElevated(process.pid);
    check(
      "isTargetElevated(self)",
      ea === eb || typeof ea === typeof eb,
      `orig=${String(ea)} rest=${String(eb)}`,
    );
  }
}

// displays:结构全等 + 值容差
{
  const a = orig.displays(),
    b = rest.displays();
  const sameShape =
    shape(a.map((d) => ({ id: typeof d.id, bounds: d.bounds.map(Math.round), main: d.main }))) ===
    shape(b.map((d) => ({ id: typeof d.id, bounds: d.bounds.map(Math.round), main: d.main })));
  const scaleOk =
    a.length === b.length && a.every((d, i) => Math.abs(d.scale_factor - b[i].scale_factor) < 0.01);
  check("displays (bounds/main/id-shape)", sameShape, `orig=${shape(a)} rest=${shape(b)}`);
  check(
    "displays scale_factor",
    scaleOk,
    `orig=${a.map((d) => d.scale_factor)} rest=${b.map((d) => d.scale_factor)}`,
  );
}

// cursorPoint:数值容差(探测间隙鼠标可能移动)
{
  const a = orig.cursorPoint(),
    b = rest.cursorPoint();
  check(
    "cursorPoint",
    typeof a.x === "number" &&
      typeof b.x === "number" &&
      Math.abs(a.x - b.x) <= 80 &&
      Math.abs(a.y - b.y) <= 80,
    `orig=${JSON.stringify(a)} rest=${JSON.stringify(b)}`,
  );
}

// listApplications:pid 集合与键形状
{
  const a = orig.listApplications(),
    b = rest.listApplications();
  const ka = new Set(a.flatMap((x) => Object.keys(x)));
  const kb = new Set(b.flatMap((x) => Object.keys(x)));
  check(
    "listApplications keys",
    JSON.stringify([...ka].sort()) === JSON.stringify([...kb].sort()),
    `orig=[${[...ka]}] rest=[${[...kb]}]`,
  );
  const pa = new Set(a.map((x) => `${x.pid}:${x.bundle_id}`));
  const pb = new Set(b.map((x) => `${x.pid}:${x.bundle_id}`));
  const onlyOrig = [...pa].filter((x) => !pb.has(x));
  const onlyRest = [...pb].filter((x) => !pa.has(x));
  check(
    "listApplications pid:exe set",
    onlyOrig.length === 0 && onlyRest.length === 0,
    `orig-only=${onlyOrig.slice(0, 3)} rest-only=${onlyRest.slice(0, 3)}`,
  );
}

// listWindows
check(
  "listWindows",
  JSON.stringify(orig.listWindows()) === JSON.stringify(rest.listWindows()),
  `orig=${JSON.stringify(orig.listWindows())} rest=${JSON.stringify(rest.listWindows())}`,
);

// screenCaptureProbeWindows:窗口集合 + 键形状
{
  const a = orig.screenCaptureProbeWindows(),
    b = rest.screenCaptureProbeWindows();
  const ka = a.length ? Object.keys(a[0]).sort() : [];
  const kb = b.length ? Object.keys(b[0]).sort() : [];
  check(
    "probeWindows element keys",
    JSON.stringify(ka) === JSON.stringify(kb),
    `orig=[${ka}] rest=[${kb}]`,
  );
  const wa = new Set(a.map((w) => `${w.windowId}:${w.ownerPid}:${w.ownerBundleId}`));
  const wb = new Set(b.map((w) => `${w.windowId}:${w.ownerPid}:${w.ownerBundleId}`));
  const onlyO = [...wa].filter((x) => !wb.has(x));
  const onlyR = [...wb].filter((x) => !wa.has(x));
  check(
    "probeWindows window set",
    onlyO.length === 0 && onlyR.length === 0,
    `orig-only=${onlyO.length} rest-only=${onlyR.length} (counts ${a.length}/${b.length})`,
  );
  if (a.length && b.length) {
    const fa = a[0],
      fb = b[0];
    const boundsShape = shape([fa.bounds]) === shape([fb.bounds]);
    check(
      "probeWindows bounds shape",
      boundsShape,
      `orig=${shape([fa.bounds])} rest=${shape([fb.bounds])}`,
    );
  }
}

// applicationInfo(node pid → null both)
check(
  "applicationInfo(self)→null",
  JSON.stringify(orig.applicationInfo(process.pid)) ===
    JSON.stringify(rest.applicationInfo(process.pid)),
);

// —— 4. AX 面错误路径与元素形状 ——
{
  const a = await orig.performAction("bogus-ref", "press");
  const b = await rest.performAction("bogus-ref", "press");
  check(
    "performAction(bogus)",
    JSON.stringify(a) === JSON.stringify(b),
    `orig=${JSON.stringify(a)} rest=${JSON.stringify(b)}`,
  );
  const sa = await orig.selectText("bogus-ref");
  const sb = await rest.selectText("bogus-ref");
  check(
    "selectText(bogus)",
    JSON.stringify(sa) === JSON.stringify(sb),
    `orig=${JSON.stringify(sa)} rest=${JSON.stringify(sb)}`,
  );
  const va = await orig.setValue("bogus-ref", "x");
  const vb = await rest.setValue("bogus-ref", "x");
  check(
    "setValue(bogus)",
    JSON.stringify(va) === JSON.stringify(vb),
    `orig=${JSON.stringify(va)} rest=${JSON.stringify(vb)}`,
  );
  const fa = await orig.setFocused("bogus-ref");
  const fb = await rest.setFocused("bogus-ref");
  check(
    "setFocused(bogus)",
    JSON.stringify(fa) === JSON.stringify(fb),
    `orig=${JSON.stringify(fa)} rest=${JSON.stringify(fb)}`,
  );
  const ra = await orig.readElement("bogus-ref");
  const rb = await rest.readElement("bogus-ref");
  check(
    "readElement(bogus)",
    JSON.stringify(ra) === JSON.stringify(rb),
    `orig=${JSON.stringify(ra)} rest=${JSON.stringify(rb)}`,
  );

  // elementAtPoint(10,10):键集合 + role/bounds(桌面左上角元素)
  const ea = await orig.elementAtPoint(10, 10);
  const eb = await rest.elementAtPoint(10, 10);
  check(
    "elementAtPoint keys",
    JSON.stringify(Object.keys(ea ?? {}).sort()) === JSON.stringify(Object.keys(eb ?? {}).sort()),
    `orig=${Object.keys(ea ?? {})} rest=${Object.keys(eb ?? {})}`,
  );
  if (ea && eb) {
    check("elementAtPoint role", ea.role === eb.role, `orig=${ea.role} rest=${eb.role}`);
    check(
      "elementAtPoint bounds",
      JSON.stringify(ea.bounds) === JSON.stringify(eb.bounds),
      `orig=${JSON.stringify(ea.bounds)} rest=${JSON.stringify(eb.bounds)}`,
    );
    check(
      "elementAtPoint ref-format",
      /^rt:\d+:/.test(ea.ref ?? "") === /^rt:\d+:/.test(eb.ref ?? ""),
      `orig=${ea.ref} rest=${eb.ref}`,
    );
  }
}

// —— 5. 剪贴板 round-trip(备份/恢复)——
{
  const backup = await orig.readClipboardTextAsync();
  const mark = `ax-parity-${Date.now()}`;
  try {
    await rest.writeClipboardTextAsync(mark);
    const readFromOrig = await orig.readClipboardTextAsync();
    await orig.writeClipboardTextAsync(mark + "-2");
    const readFromRest = await rest.readClipboardTextAsync();
    check(
      "clipboard rest-write→orig-read",
      readFromOrig?.text === mark,
      `orig read=${readFromOrig?.text}`,
    );
    check(
      "clipboard orig-write→rest-read",
      readFromRest?.text === mark + "-2",
      `rest read=${readFromRest?.text}`,
    );
  } finally {
    // 恢复用户剪贴板
    if (backup?.ok && typeof backup.text === "string") {
      await orig.writeClipboardTextAsync(backup.text);
    }
  }
}

// captureApp(invalid) → null
check(
  "captureApp(invalid)→null",
  JSON.stringify(await orig.captureApp(999999999)) ===
    JSON.stringify(await rest.captureApp(999999999)),
  `orig=${JSON.stringify(await orig.captureApp(999999999))} rest=${JSON.stringify(await rest.captureApp(999999999))}`,
);

// preventActivation 状态机 round-trip
{
  orig.preventActivation();
  const o1 = orig.isFocusStealPrevented();
  orig.reenableActivation();
  const o2 = orig.isFocusStealPrevented();
  rest.preventActivation();
  const r1 = rest.isFocusStealPrevented();
  rest.reenableActivation();
  const r2 = rest.isFocusStealPrevented();
  check("preventActivation toggle", o1 === r1 && o2 === r2, `orig=${o1}/${o2} rest=${r1}/${r2}`);
}

// —— 6. AX round-trip:elementAtPoint 的 ref 必须能被自家 readElement 解析 ——
{
  for (const [label, m] of [
    ["orig", orig],
    ["rest", rest],
  ]) {
    const el = await m.elementAtPoint(1280, 700);
    const rt = el ? await m.readElement(el.ref) : null;
    check(
      `readElement round-trip (${label})`,
      Boolean(rt),
      `role=${el?.role} → ${rt ? rt.role : "null"}`,
    );
  }
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "能力对齐验收通过 ✓" : failed.length + " 项不一致 ✗"} (${results.length - failed.length}/${results.length})`,
);
process.exit(failed.length === 0 ? 0 : 1);
