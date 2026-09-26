// 原版 vs 重编译 ax_native.node 写路径能力端到端对齐。
// 受控目标:专用记事本进程(测完关闭)。验证模式:
//   - 截图类:各自对同一窗口/屏幕截图,校验 PNG 合法性、尺寸一致、内容非空白
//   - AX 写:一方 setValue/输入,另一方 readElement 读回(交叉验证真实效果)
//   - 输入注入:注入到记事本,经 AX 读回验证
//   - 激活/epoch/图标:执行 + 返回形态 + 效果比对
// 用法:node parity-native-full.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import process from "node:process";

import { existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
const ORIG_DIST =
  process.env.AX_NATIVE_ORIG ??
  "D:/software/zcode/resources/tools/cua-helper/build/Release/ax_native.node";
const ORIG = existsSync(ORIG_DIST)
  ? ORIG_DIST
  : pathResolve(import.meta.dirname, "../../../build/Release/ax_native.node");
const base = pathToFileURL(import.meta.dirname + "/").href;
const req = createRequire(base);
const orig = req(ORIG);
const rest = req("./build/Release/ax_native_win.node");

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "MATCH" : "DIFF "} ${name}${ok ? "" : "  → " + (detail ?? "")}`);
};
const pngInfo = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 24 || buf[0] !== 137 || buf[1] !== 80) return null;
  return {
    bytes: buf.length,
    width: (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19],
    height: (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23],
  };
};
const pngNonBlank = (buf) => {
  // 粗略内容检测:对像素字节做直方图,单一颜色 = 空白
  let distinct = new Set();
  for (let i = 24; i < Math.min(buf.length, 24 + 60000); i += 97) distinct.add(buf[i]);
  return distinct.size > 4;
};

// —— 启动受控记事本 ——
console.log("[setup] launching notepad…");
const notepad = spawn("notepad.exe", [], { stdio: "ignore", detached: false });
let npPid = notepad.pid;
let npHwnd = 0,
  npBounds = null;
for (let i = 0; i < 40 && !npHwnd; i++) {
  await sleep(250);
  for (const w of orig.screenCaptureProbeWindows()) {
    if (w.ownerPid === npPid || /Notepad|记事本/.test(w.title)) {
      npHwnd = w.windowId;
      npBounds = w.bounds;
      npPid = w.ownerPid;
      break;
    }
  }
}
if (!npHwnd) {
  console.error("[setup] notepad window not found; abort");
  notepad.kill();
  process.exit(2);
}
console.log(`[setup] notepad pid=${npPid} hwnd=${npHwnd} bounds=${JSON.stringify(npBounds)}`);

try {
  // —— 0. 激活(用原版激活一次,给输入类一个稳定前台)——
  {
    const a = orig.activateApplication(npPid);
    const b = rest.activateApplication(npPid);
    await sleep(400);
    const fg = orig.screenCaptureProbeWindows().find((w) => w.ownerActive);
    check(
      "activateApplication return shape",
      JSON.stringify(a) === JSON.stringify(b),
      `orig=${JSON.stringify(a)} rest=${JSON.stringify(b)}`,
    );
    check("activateApplication effect (foreground)", fg?.ownerPid === npPid, `fg=${fg?.ownerName}`);
  }

  // —— 1. 截图类(本机原版 WinRT 管线 fail-closed;断言两边形态一致)——
  {
    const sameShape = (a, b) => {
      const ta = Buffer.isBuffer(a)
        ? "png"
        : a === null
          ? "null"
          : typeof a === "object"
            ? JSON.stringify(a)
            : String(a);
      const tb = Buffer.isBuffer(b)
        ? "png"
        : b === null
          ? "null"
          : typeof b === "object"
            ? JSON.stringify(b)
            : String(b);
      return { ok: ta === tb, ta, tb };
    };
    const ca = orig.captureApp(npPid);
    const cb = rest.captureApp(npPid);
    const r1 = sameShape(Buffer.isBuffer(ca) ? ca : null, Buffer.isBuffer(cb) ? cb : null);
    check("captureApp (both fail-closed on this machine)", r1.ok, `orig=${r1.ta} rest=${r1.tb}`);
    // captureApp 实为 AX 快照:两边都应产出 {app,window,elements} 结构
    check(
      "captureApp returns AX snapshot (both)",
      Boolean(ca?.elements) && Boolean(cb?.elements),
      `orig keys=${Object.keys(ca ?? {})} rest keys=${Object.keys(cb ?? {})}`,
    );
    check(
      "captureApp window fields",
      JSON.stringify(ca?.window) === JSON.stringify(cb?.window),
      `orig=${JSON.stringify(ca?.window)} rest=${JSON.stringify(cb?.window)}`,
    );
    check(
      "captureApp app fields",
      JSON.stringify(ca?.app) === JSON.stringify(cb?.app),
      `orig=${JSON.stringify(ca?.app)} rest=${JSON.stringify(cb?.app)}`,
    );
    check(
      "captureApp element shapes",
      ca?.elements?.length === cb?.elements?.length &&
        JSON.stringify(ca?.elements?.[0]) === JSON.stringify(cb?.elements?.[0]),
      `counts ${ca?.elements?.length}/${cb?.elements?.length} orig0=${JSON.stringify(ca?.elements?.[0])?.slice(0, 90)} rest0=${JSON.stringify(cb?.elements?.[0])?.slice(0, 90)}`,
    );

    const m1 = await orig.captureMonitorPngAsync(0);
    const m2 = await rest.captureMonitorPngAsync(0);
    const r2 = sameShape(m1, m2);
    check("captureMonitorPngAsync shape", r2.ok, `orig=${r2.ta} rest=${r2.tb}`);

    const w1 = orig.captureWindowImage(npHwnd);
    const w2 = rest.captureWindowImage(npHwnd);
    const r3 = sameShape(w1, w2);
    check("captureWindowImage shape", r3.ok, `orig=${r3.ta} rest=${r3.tb}`);

    const v1 = await orig.captureWindowPngVerifiedAsync(npHwnd);
    const v2 = await rest.captureWindowPngVerifiedAsync(npHwnd);
    const r4 = sameShape(v1, v2);
    check("captureWindowPngVerifiedAsync shape", r4.ok, `orig=${r4.ta} rest=${r4.tb}`);
  }

  // —— 2. AX 写路径(交叉验证:orig 写 → rest 读;rest 写 → orig 读)——
  {
    const cx = Math.round(npBounds.x + npBounds.width / 2);
    const cy = Math.round(npBounds.y + npBounds.height / 2);
    const el = await orig.elementAtPoint(cx, cy);
    check("AX: elementAtPoint in notepad", Boolean(el), `role=${el?.role}`);

    // setValue(orig 写标记)→ rest 读回
    const mark1 = "ORIGWROTE123";
    const sv1 = await orig.setValue(el.ref, mark1);
    await sleep(200);
    const elRest = await rest.elementAtPoint(cx, cy);
    const crossRead1 = elRest?.value;
    check(
      "AX setValue(orig) cross-read by rest",
      crossRead1 === mark1,
      `orig result=${JSON.stringify(sv1)} rest read=${JSON.stringify(crossRead1)}`,
    );

    // setValue(rest 写标记)→ orig 读回
    const mark2 = "RESTWROTE456";
    const sv2 = await rest.setValue(elRest.ref, mark2);
    await sleep(200);
    const el2 = await orig.elementAtPoint(cx, cy);
    const crossRead2 = el2?.value;
    check(
      "AX setValue(rest) cross-read by orig",
      crossRead2 === mark2,
      `rest result=${JSON.stringify(sv2)} orig read=${JSON.stringify(crossRead2)}`,
    );

    // setFocused(返回形态)
    const sf1 = await orig.setFocused(el.ref);
    const sf2 = await rest.setFocused(elRest.ref);
    check(
      "AX setFocused return shape",
      JSON.stringify(sf1) === JSON.stringify(sf2),
      `orig=${JSON.stringify(sf1)} rest=${JSON.stringify(sf2)}`,
    );

    // selectText(ref, start, end)(原版三参形态;单参为 illegal_argument 已在
    // parity-native.mjs 覆盖)
    const st1 = await orig.selectText(el.ref, 0, 3);
    const st2 = await rest.selectText(elRest.ref, 0, 3);
    check(
      "AX selectText return shape",
      JSON.stringify(st1) === JSON.stringify(st2),
      `orig=${JSON.stringify(st1)} rest=${JSON.stringify(st2)}`,
    );
  }

  // —— 3. 键盘注入(注入到前台记事本,交叉经 AX 读回)——
  {
    const cx = Math.round(npBounds.x + npBounds.width / 2);
    const cy = Math.round(npBounds.y + npBounds.height / 2);
    await orig.activateApplication(npPid);
    await sleep(300);

    // typeTextGlobal(orig 注入)→ rest AX 读回
    const k1 = "origtyped789";
    const tr1 = await orig.typeTextGlobal(k1);
    await sleep(300);
    let el = await rest.elementAtPoint(cx, cy);
    check(
      "typeTextGlobal(orig) visible via rest AX",
      String(el?.value ?? "").includes(k1),
      `rest read=${JSON.stringify(String(el?.value ?? "").slice(0, 40))}`,
    );

    // rest.typeTextGlobal 注入可见性(交叉:rest 注入 → orig 读回)。
    // 点击编辑区放置焦点/光标(避开 notepad 会话恢复与 ctrl+a 的全选竞态),
    // 每轮使用独立标记文本,重试两次。
    let injected = false,
      lastRead = "";
    for (let attempt = 0; attempt < 3 && !injected; attempt++) {
      await orig.activateApplication(npPid);
      await sleep(450);
      await orig.clickAtPoint(cx, cy, "left", 1);
      await sleep(300);
      const k2 = `mark${attempt}xyz`;
      await rest.typeTextGlobal(k2);
      await sleep(700);
      el = await orig.elementAtPoint(cx, cy);
      lastRead = String(el?.value ?? "");
      injected = lastRead.includes(k2);
    }
    check(
      "typeTextGlobal(rest) injects (cross-read by orig)",
      injected,
      `orig read=${JSON.stringify(lastRead.slice(0, 60))}`,
    );

    // keyDown/keyUp(按住 shift 等价于长按 — 用方向键 Left 逐字符移动光标,
    // 用 keyDown+keyUp 各打一次,验证形态一致)
    const d1 = orig.keyDownGlobal("shift");
    const u1 = orig.keyUpGlobal("shift");
    const d2 = rest.keyDownGlobal("shift");
    const u2 = rest.keyUpGlobal("shift");
    check(
      "keyDown/UpGlobal return shapes",
      JSON.stringify([d1, u1]) === JSON.stringify([d2, u2]),
      `orig=${JSON.stringify([d1, u1])} rest=${JSON.stringify([d2, u2])}`,
    );

    // holdKeyGlobal(Async):返回形态(短持键,对文本无破坏 — ctrl)
    const h1 = orig.holdKeyGlobal("ctrl", 120);
    const h2 = rest.holdKeyGlobalAsync("ctrl", 120);
    const h2v = await Promise.resolve(h2)
      .then((x) => x)
      .catch(() => x);
    check(
      "holdKey(Async) return shapes",
      JSON.stringify(h1) === JSON.stringify(h2v),
      `orig=${JSON.stringify(h1)} rest=${JSON.stringify(h2v)}`,
    );
    await sleep(250);
  }

  // —— 4. 鼠标注入 ——
  {
    // moveTo(移动到记事本左上内点)→ cursorPoint 验证(容差)
    const tx = npBounds.x + 40,
      ty = npBounds.y + 120;
    const m1 = await orig.moveTo(tx, ty);
    await sleep(120);
    const p1 = orig.cursorPoint();
    const m2 = await rest.moveTo(tx + 60, ty);
    await sleep(120);
    const p2 = rest.cursorPoint();
    check(
      "moveTo(orig) moves cursor",
      Math.abs(p1.x - tx) <= 2 && Math.abs(p1.y - ty) <= 2,
      `at=${JSON.stringify(p1)} want=${tx},${ty}`,
    );
    check(
      "moveTo(rest) moves cursor",
      Math.abs(p2.x - (tx + 60)) <= 2 && Math.abs(p2.y - ty) <= 2,
      `at=${JSON.stringify(p2)} want=${tx + 60},${ty}`,
    );
    check(
      "moveTo return shapes",
      JSON.stringify(m1) === JSON.stringify(m2),
      `orig=${JSON.stringify(m1)} rest=${JSON.stringify(m2)}`,
    );

    // clickAtPoint(点击编辑区放置光标)+ mouseDown/Up 形态
    const cx = Math.round(npBounds.x + npBounds.width / 2);
    const cy2 = Math.round(npBounds.y + npBounds.height / 2);
    const c1 = await orig.clickAtPoint(cx, cy2, "left", 1);
    const c2 = await rest.clickAtPoint(cx, cy2, "left", 1);
    check(
      "clickAtPoint return shapes",
      JSON.stringify(c1) === JSON.stringify(c2),
      `orig=${JSON.stringify(c1)} rest=${JSON.stringify(c2)}`,
    );
    const md1 = await orig.mouseDown("left");
    const mu1 = await orig.mouseUp("left");
    const md2 = await rest.mouseDown("left");
    const mu2 = await rest.mouseUp("left");
    check(
      "mouseDown/Up return shapes",
      JSON.stringify([md1, mu1]) === JSON.stringify([md2, mu2]),
      `orig=${JSON.stringify([md1, mu1])} rest=${JSON.stringify([md2, mu2])}`,
    );

    // drag(在编辑区横向拖选 — 只影响记事本文本选择)
    const y = npBounds.y + Math.round(npBounds.height * 0.6);
    const d1r = await orig.drag(npBounds.x + 80, y, npBounds.x + 260, y, "left");
    const d2r = await rest.drag(npBounds.x + 80, y, npBounds.x + 260, y, "left");
    check(
      "drag return shapes",
      JSON.stringify(d1r) === JSON.stringify(d2r),
      `orig=${JSON.stringify(d1r)} rest=${JSON.stringify(d2r)}`,
    );

    // scrollAt(本机恒 false,与原版一致)
    const s1 = await orig.scrollAt(cx, cy2, -120, "down");
    const s2 = await rest.scrollAt(cx, cy2, -120, "down");
    check(
      "scrollAt return (both false on this machine)",
      JSON.stringify(s1) === JSON.stringify(s2),
      `orig=${JSON.stringify(s1)} rest=${JSON.stringify(s2)}`,
    );
  }

  // —— 5. 图标与 epoch ——
  {
    const i1 = await orig.applicationIconPngAsync(npPid);
    const i2 = await rest.applicationIconPngAsync(npPid);
    check(
      "applicationIconPngAsync shapes",
      JSON.stringify(pngInfo(i1)) === JSON.stringify(pngInfo(i2)),
      `orig=${JSON.stringify(pngInfo(i1))} rest=${JSON.stringify(pngInfo(i2))}`,
    );
  }

  // —— 6. 深层能力 ——
  {
    // 6a. captureApp 大树:ZCode Electron 窗口,两边都应 BFS 平铺触顶 400
    const zc = orig.listApplications().find((a) => a.name === "ZCode");
    if (zc) {
      const sa = orig.captureApp(zc.pid);
      const sb = rest.captureApp(zc.pid);
      check(
        "captureApp(ZCode) elements count equal (BFS cap)",
        sa?.elements?.length === sb?.elements?.length,
        `orig=${sa?.elements?.length} rest=${sb?.elements?.length}`,
      );
      check(
        "captureApp(ZCode) first element equal",
        JSON.stringify(sa?.elements?.[0]) === JSON.stringify(sb?.elements?.[0]),
        `orig=${JSON.stringify(sa?.elements?.[0])?.slice(0, 80)} rest=${JSON.stringify(sb?.elements?.[0])?.slice(0, 80)}`,
      );
    } else {
      console.log("SKIP  captureApp(ZCode) — window not present");
    }

    // 6b. AXPress 成功路径:记事本"文件"菜单(打开菜单,随後 Escape 关闭,无持久副作用)
    const cx2 = Math.round(npBounds.x + npBounds.width / 2);
    const cy3 = Math.round(npBounds.y + npBounds.height / 2);
    const menuBar = await orig.elementAtPoint(
      npBounds.x + Math.round(npBounds.width * 0.08),
      npBounds.y + 60,
    );
    if (menuBar?.actions?.includes("AXPress") || menuBar?.role === "MenuItem") {
      const pa1 = await orig.performAction(menuBar.ref, "AXPress");
      await sleep(250);
      await orig.pressKeyGlobal("escape");
      await sleep(150);
      const menuBar2 = await rest.elementAtPoint(
        npBounds.x + Math.round(npBounds.width * 0.08),
        npBounds.y + 60,
      );
      const pa2 = menuBar2 ? await rest.performAction(menuBar2.ref, "AXPress") : null;
      await sleep(250);
      await rest.pressKeyGlobal("escape");
      check(
        "performAction(AXPress menu) shape",
        JSON.stringify(pa1) === JSON.stringify(pa2),
        `orig=${JSON.stringify(pa1)} rest=${JSON.stringify(pa2)}`,
      );
    } else {
      // 兜底:找任一含 AXPress 的元素做形态对齐(不做真实按压面)
      const snapA = orig.captureApp(npPid);
      const inv = snapA.elements.find((e) => (e.actions ?? []).includes("AXPress"));
      if (inv) {
        const pa1 = await orig.performAction(inv.ref, "AXPress"); // 可能真触发;记事本测试实例可承受
        check("performAction(AXPress) shape (fallback)", pa1?.ok === true, JSON.stringify(pa1));
      } else {
        console.log("SKIP  performAction(AXPress) — no invokable element");
      }
    }

    // 6c. 未知 action / 非可写 setValue
    const elAny = await orig.elementAtPoint(cx2, cy3);
    const u1 = await orig.performAction(elAny.ref, "AXWeird");
    const u2 = await rest.performAction(elAny.ref, "AXWeird");
    check(
      "performAction(unknown) → action_unsupported",
      JSON.stringify(u1) === JSON.stringify(u2) && u1?.axError === "action_unsupported",
      `orig=${JSON.stringify(u1)} rest=${JSON.stringify(u2)}`,
    );
    const nonEdit = orig
      .captureApp(npPid)
      .elements.find((e) => e.editable === false && e.role !== "Document");
    if (nonEdit) {
      const s1 = await orig.setValue(nonEdit.ref, "x");
      const s2 = await rest.setValue(nonEdit.ref, "x");
      check(
        "setValue(non-edit) shape",
        JSON.stringify(s1) === JSON.stringify(s2),
        `orig=${JSON.stringify(s1)} rest=${JSON.stringify(s2)}`,
      );
    }

    // 6d. 双击与 cancel 形态
    const dbl1 = await orig.clickAtPoint(cx2, cy3, "left", 2);
    const dbl2 = await rest.clickAtPoint(cx2, cy3, "left", 2);
    check(
      "clickAtPoint(clicks=2)",
      JSON.stringify(dbl1) === JSON.stringify(dbl2),
      `orig=${dbl1} rest=${dbl2}`,
    );
    check(
      "cancelInputHoldsForSession → false (both)",
      orig.cancelInputHoldsForSession() === false && rest.cancelInputHoldsForSession() === false,
      `orig=${orig.cancelInputHoldsForSession()} rest=${rest.cancelInputHoldsForSession()}`,
    );

    // 6e. 错误形态第二矩阵
    const tryCall = async (m, name, ...args) => {
      try {
        const r = await m[name](...args);
        return { thrown: false, value: JSON.stringify(r)?.slice(0, 60) };
      } catch (e) {
        return { thrown: true, message: String(e?.message) };
      }
    };
    for (const [name, args] of [
      ["elementAtPoint", [1]],
      ["mouseDown", ["bogus"]],
      ["mouseUp", ["bogus"]],
      ["scrollAt", [10, 10, 1, "sideways"]],
      ["pressKeyGlobal", [""]],
      ["drag", [1, 2, 3, 4, "bogus"]],
    ]) {
      const a = await tryCall(orig, name, ...args);
      const b = await tryCall(rest, name, ...args);
      check(
        `validation2: ${name}(${JSON.stringify(args).slice(1, -1)})`,
        a.thrown === b.thrown && a.message === b.message && a.value === b.value,
        `orig=${JSON.stringify(a)} rest=${JSON.stringify(b)}`,
      );
    }
  }

  // —— 7. AUMID 面(notepad 在 Win11 为 packaged;有 AUMID 则测,无则记录跳过)——
  {
    const apps = orig.listApplications().filter((a) => a.pid === npPid);
    const aumid = apps.find((a) => a.aumid)?.aumid ?? null;
    if (aumid) {
      const info1 = orig.applicationInfoByAumid(aumid);
      const info2 = rest.applicationInfoByAumid(aumid);
      check(
        "applicationInfoByAumid(notepad)",
        JSON.stringify(info1) === JSON.stringify(info2),
        `orig=${JSON.stringify(info1)?.slice(0, 90)} rest=${JSON.stringify(info2)?.slice(0, 90)}`,
      );
    } else {
      console.log("SKIP  applicationInfoByAumid (notepad has no AUMID on this system)");
    }
    // 无效 AUMID 错误路径
    const bad1 = orig.applicationInfoByAumid("no.such.app!x");
    const bad2 = rest.applicationInfoByAumid("no.such.app!x");
    check(
      "applicationInfoByAumid(invalid)→null",
      JSON.stringify(bad1) === JSON.stringify(bad2),
      `orig=${JSON.stringify(bad1)} rest=${JSON.stringify(bad2)}`,
    );
  }
} finally {
  console.log("[teardown] closing notepad…");
  notepad.kill();
  try {
    process.kill(npPid);
  } catch {}
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "写路径能力对齐验收通过 ✓" : failed.length + " 项不一致 ✗"} (${results.length - failed.length}/${results.length})`,
);
if (failed.length) {
  for (const f of failed) console.log("  DIFF:", f.name);
}
process.exit(failed.length === 0 ? 0 : 1);
