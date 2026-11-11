#!/usr/bin/env node
// probe-one-win.cjs —— win32 addon 单面探针（win32 CUA 0.6.5 对齐 W1 探针基座）。
//
// 纪律出处：specs/win32-cua-0.6.5-implementation-design.md §四 L0.4——
//   - fresh-process 单例：每 (addon × face) 各起一个全新 ELECTRON_RUN_AS_NODE
//     electron 宿主进程，addon 在该进程内只加载一次（无跨面状态渗透）；
//   - timeout 包裹：每面独立超时（默认 60s，listInstalledApplicationsAsync 可到
//     ~秒级；超时杀进程按 TIMEOUT 记，不无限等）；
//   - 官方 vs 自建同机同场对照：同一台机同一时刻对官方参照 addon 与自建
//     addon 跑同一探针，逐字段 diff；
//   - 原始 dump 不做深度归一（mac probe-raw 教训：normalizer depth>6 摧毁
//     树形）——子模式只做必要的「形状归纳」（键集/计数），记录原样保留。
//
// 用法（在 packages/zcode-cua-helper/ 下运行）：
//   子模式（通常由父模式 spawn，也可手动单跑）：
//     node tools/probe-one-win.cjs --child <addonPath> <face> [--live]
//   对照模式（官方 vs 自建）：
//     node tools/probe-one-win.cjs [--official <path>] [--rebuilt <path>]
//          [--faces f1,f2,...] [--live] [--timeout-ms N] [--json]
//   face ∈ introspect | activateWindow | launchApplicationAsync |
//          listInstalledApplicationsAsync（W1 面；W2/W3 批逐面追加）
//   --live：包含有副作用的行为锚探针（真窗口激活/真进程拉起，自清理）；
//           缺省只跑无副作用契约面（坏参形态/枚举 dump）。
//
// electron 宿主：ELECTRON_RUN_AS_NODE=1 <repo>/node_modules/electron/dist/electron.exe
// （可用 PROBE_ELECTRON 覆盖）。官方 addon ABI=electron 44.7.0，node 宿主加载必败。

"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const TOOL_DIR = __dirname;
const PKG_DIR = path.resolve(TOOL_DIR, "..");
const DEFAULT_OFFICIAL = path.join(
  PKG_DIR, "native", "reverse", "reference", "win32-0.6.5", "build", "Release", "ax_native.node");
const DEFAULT_REBUILT = path.join(
  PKG_DIR, "native", "reverse", "build", "Release", "ax_native_win.node");
const DEFAULT_ELECTRON = path.resolve(
  PKG_DIR, "..", "..", "node_modules", "electron", "dist", "electron.exe");

const W1_FACES = ["introspect", "activateWindow", "launchApplicationAsync",
  "listInstalledApplicationsAsync"];
// W2 批面（mac 血统 22：ghost 16 / pasteboard 4 / getWindowId / hasActiveInputHolds）。
const W2_FACES = ["ghost", "pasteboard", "getWindowId", "hasActiveInputHolds"];
// W3 批面（win 专属 22：postMessage 5 / UIA 梯 4 / surface 6 / 杂项 7）。
const W3_FACES = ["w3"];

// ---------------------------------------------------------------------------
// 子模式：fresh process 内加载 addon 一次，跑单面，stdout 末行输出 JSON。
// ---------------------------------------------------------------------------

function serializeCall(fn, args) {
  // 单次调用的原始记录：抛错记 {thrown, message}，返回值原样（JSON 可序列化面）。
  try {
    const value = fn(...args);
    return { ok: true, value: jsonSafe(value) };
  } catch (err) {
    return { ok: false, thrown: String(err && err.constructor && err.constructor.name),
             message: String(err && err.message) };
  }
}

function jsonSafe(v) {
  // 原始 dump 原则：能 JSON 序列化的原样保留（Buffer→{base64,len}），不做深层归一。
  const t = typeof v;
  if (t === "number" || t === "boolean" || t === "string" || v === null || v === undefined) return v;
  if (t === "bigint") return { bigint: String(v) };
  if (Buffer.isBuffer(v)) return { bufferBase64Len: v.length };
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (t === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = jsonSafe(v[k]);
    return out;
  }
  return String(v);
}

function shapeOf(records) {
  // 形状归纳（非归一）：每条记录的键集签名为准，聚合出键集分布 + 计数。
  const sigCount = new Map();
  for (const r of records) {
    const sig = Object.keys(r).sort().join(",");
    sigCount.set(sig, (sigCount.get(sig) || 0) + 1);
  }
  return { count: records.length, keySets: Object.fromEntries([...sigCount.entries()].sort()) };
}

function runChildFace(addon, face, live) {
  const out = { face, addonExports: null };
  switch (face) {
    case "introspect": {
      const keys = Object.keys(addon).sort();
      out.exports = keys;
      out.exportCount = keys.length;
      out.nonFunction = keys.filter((k) => typeof addon[k] !== "function");
      break;
    }
    case "activateWindow": {
      // 契约面（无副作用）：坏参形态 → 记录抛错/返回原样。
      out.calls = {
        "no-args": serializeCall(addon.activateWindow, []),
        "wrong-types": serializeCall(addon.activateWindow, ["a", "b", "c"]),
        "zeros": serializeCall(addon.activateWindow, [0, "", 0]),
        "nullish": serializeCall(addon.activateWindow, [1, null, 1]),
      };
      if (live) {
        // 行为锚：取一个真实顶层窗（screenCaptureProbeWindows 的 windowId=HWND），
        // activateWindow(pid, bundleId, windowId) 后以 ownerActive 复核前台已切。
        // 选窗策略：排宿主/输入/托盘类进程与状态栏类标题；优先 explorer.exe 的
        // 资源管理器大窗（稳定在场、打扰最小、官方/自建两次运行可命中同一目标），
        // 兜底取可见面积最大的候选。官方对不可激活窗返回 false 也是有效证据，
        // 但对照面需要一条 true 路径。
        const wins = addon.screenCaptureProbeWindows().filter((w) => w.windowId > 0 && w.ownerPid > 0 && w.ownerPid !== process.pid
          && !/ApplicationFrameHost|WindowsInput|SearchHost|ShellExperienceHost|TextInputHost|Taskbar|Tray|sunlogin/i.test(w.ownerBundleId || "")
          && !/StatusBar|Tooltip|ToolTips|MSCTFIME|Default IME|工具|Program Manager/i.test(w.title || ""));
        const area = (w) => ((w.bounds && w.bounds.width * w.bounds.height) || 0);
        const explorerWins = wins.filter((w) => /explorer\.exe$/i.test(w.ownerBundleId || "") && area(w) >= 800 * 600);
        explorerWins.sort((a, b) => area(b) - area(a));
        const target = explorerWins[0] || wins.sort((a, b) => area(b) - area(a))[0];
        if (!target) { out.live = { skipped: "no candidate window" }; break; }
        const before = addon.screenCaptureProbeWindows().some((w) => w.windowId === target.windowId && w.ownerActive);
        const call = serializeCall(addon.activateWindow, [target.ownerPid, target.ownerBundleId, target.windowId]);
        const after = addon.screenCaptureProbeWindows().some((w) => w.windowId === target.windowId && w.ownerActive);
        out.live = { target: { pid: target.ownerPid, windowId: target.windowId, title: target.title }, before, call, after };
      }
      break;
    }
    case "launchApplicationAsync": {
      // 契约面：全空/伪 AUMID/不存在路径 —— async 函数同步序列化只拿到 Promise，
      // 逐个 await 原始 resolve 值/reject 文案（官方语义证据）。
      const probe = async () => {
        const results = {};
        for (const [name, args] of Object.entries({
          "all-null": [null, null, null],
          "bogus-aumid": ["Drora.Probe.Bogus!App", null, null],
          "nonexistent-path": [null, "C:\\nonexistent\\zcode-probe-app.exe", null],
          "empty-strings": ["", "", ""],
        })) {
          const t0 = Date.now();
          try {
            const v = await addon.launchApplicationAsync(...args);
            results[name] = { resolved: jsonSafe(v), ms: Date.now() - t0 };
          } catch (err) {
            results[name] = { rejected: String(err && err.message), ms: Date.now() - t0 };
          }
        }
        if (live) {
          // 行为锚：真拉起 notepad（target_path 路线），随后按 PID 清理。判定面归一：
          // pid 只比「正数性」（两次运行各自新进程，PID 值本质不同）；alive 时序
          // （Win11 packaged notepad 垫片交接竞速）不参与 diff，仅留 dump。
          const t0 = Date.now();
          try {
            const pid = await addon.launchApplicationAsync(null, "C:\\Windows\\System32\\notepad.exe", null);
            let alive = null;
            if (typeof pid === "number" && pid > 0) {
              await new Promise((r) => setTimeout(r, 1200));
              const q = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
                { encoding: "utf8", timeout: 15000 });
              alive = /"[^"]*notepad[^"]*"/i.test(q.stdout || "") || String(q.stdout || "").includes(String(pid));
              spawnSync("taskkill", ["/PID", String(pid), "/F", "/T"], { encoding: "utf8", timeout: 15000 });
              spawnSync("taskkill", ["/IM", "notepad.exe", "/F"], { encoding: "utf8", timeout: 15000 });
            }
            results["live-notepad"] = {
              resolvedPositive: typeof pid === "number" && pid > 0,
              resolvedRaw: jsonSafe(pid),
              aliveAfter1200ms: alive,
              ms: Date.now() - t0,
            };
          } catch (err) {
            results["live-notepad"] = { rejected: String(err && err.message), ms: Date.now() - t0 };
          }
        }
        return results;
      };
      return probe().then((results) => { out.awaited = results; return out; });
    }
    case "ghost": {
      // —— ghost 状态机全转移 dump（W2 行为锚；同族 mac 语义见 generate-mac-rebuilt.py 5g 段，
      //    此处逐转移记录 win 官方形态：返回值 + ghostState 快照关键面）——
      const dump = (label) => {
        const st = addon.ghostState();
        // 全量留 dump；groups 形态逐组记关键键（含 fillHex——palette 映射锚）
        const groups = {};
        for (const k of Object.keys(st.groups || {})) {
          const g = st.groups[k];
          groups[k] = {
            multi: g.multi, shown: g.shown, idleAlpha: g.idleAlpha,
            occlusionAlpha: g.occlusionAlpha, feedbackAlpha: g.feedbackAlpha,
            pendingRipple: g.pendingRipple, placed: g.placed, animating: g.animating,
            screenIdx: g.screenIdx, badgeText: g.badgeText, fillHex: g.fillHex,
          };
        }
        out[label] = {
          state: {
            enabled: st.enabled, shown: st.shown, multiCursorEnabled: st.multiCursorEnabled,
            displayGeneration: st.displayGeneration, sessionCount: st.sessionCount,
            idleAlpha: st.idleAlpha, occlusionAlpha: st.occlusionAlpha,
            feedbackAlpha: st.feedbackAlpha, controllerActive: st.controllerActive,
            cue: st.cue, x: st.x, y: st.y, ready: st.ready, tracking: st.tracking,
            ripples: st.ripples, ignoresMouseEvents: st.ignoresMouseEvents,
            occlusionUncertainMisses: st.occlusionUncertainMisses,
            pendingRipple: st.pendingRipple, keyPulseActive: st.keyPulseActive,
            windowOrderedIn: st.windowOrderedIn,
            stateKeys: Object.keys(st).sort(),
          },
          groups,
        };
      };
      const call = (name, ...args) => {
        try { out[name] = { ret: jsonSafe(addon[name](...args)) }; }
        catch (err) { out[name] = { thrown: String(err && err.message) }; }
      };
      dump("t0-initial");
      call("ghostInit");
      call("ghostShow");
      call("ghostHide");
      call("ghostSetEnabled", true); dump("t1-setEnabled-true");
      call("ghostSetMultiCursorEnabled", false); dump("t2-setMulti-false");
      call("ghostSetCapture", true);
      call("ghostMove", 100, 200); dump("t3-move");
      call("ghostClickRipple", 150, 250); dump("t4-ripple");
      call("ghostBeginAction");
      call("ghostEndAction");
      call("ghostBeginActionWithTitle", 0, "s1", "Title One"); dump("t5-beginActionWithTitle-s1");
      call("ghostBeginActionWithTitle", 0, "agent-3", "Agent Three"); dump("t6-beginActionWithTitle-agent3");
      call("ghostBeginActionWithTitle", 0, "7", "Seven"); dump("t7-beginActionWithTitle-7");
      call("ghostSessionTurnEnd", "s1"); dump("t8-turnEnd-s1");
      call("ghostSetRequestSession", "s1"); dump("t9-setRequestSession");
      call("ghostRemoveSession", "s1"); dump("t10-removeSession-s1");
      call("ghostRemoveSession", "default"); dump("t11-removeSession-default");
      // 坏参面
      out.badArgs = {
        "move-strings": serializeCall(addon.ghostMove, ["a", "b"]).ok ? "no-throw" : "throws",
        "setEnabled-string": serializeCall(addon.ghostSetEnabled, ["x"]).ok ? "no-throw" : "throws",
        "beginActionWithTitle-bad": serializeCall(addon.ghostBeginActionWithTitle, [0, 1, 2]),
        "removeSession-nonstring": serializeCall(addon.ghostRemoveSession, [42]),
      };
      try { out.ghostMove_strings_ret = jsonSafe(addon.ghostMove("a", "b")); } catch (e) { out.ghostMove_strings_ret = "THREW"; }
      try { out.ghostSetEnabled_string_ret = jsonSafe(addon.ghostSetEnabled("x")); } catch (e) { out.ghostSetEnabled_string_ret = "THREW"; }
      try { out.ghostPaletteSelftest = jsonSafe(addon.ghostPaletteSelftest()); } catch (e) { out.ghostPaletteSelftest = "THREW:" + e.message; }
      dump("t12-final");
      break;
    }
    case "pasteboard": {
      // —— pasteboard 4 面（provided-paste 会话；JS 消费面 :31362-31383/:31761-31768）——
      const run = async () => {
        const call = (name, fn, ...args) => {
          try { const v = fn(...args); out[name] = v && typeof v.then === "function" ? "PROMISE-UNAWAITED" : { ret: jsonSafe(v) }; }
          catch (err) { out[name] = { thrown: String(err && err.message) }; }
        };
        const callAsync = async (name, fn, ...args) => {
          try { out[name] = { ret: jsonSafe(await fn(...args)) }; }
          catch (err) { out[name] = { thrown: String(err && err.message) }; }
        };
        call("isInteractiveSession", () => addon.isInteractiveSession());
        call("begin-bad-args", () => addon.pasteboardBeginProvidedPaste());
        call("begin-unsupported-plain", () => addon.pasteboardBeginProvidedPaste("probe-text", "text/plain", 4242));
        call("begin-unsupported-html", () => addon.pasteboardBeginProvidedPaste("<b>x</b>", "text/html", 4242));
        // 活跃 token 生命周期（format="text" 官方支持面）：数值 token 驱动 mark/await/finish
        let token = null;
        try {
          const begun = addon.pasteboardBeginProvidedPaste("probe-text", "text", 4242);
          token = begun && begun.ok ? begun.token : null;
        } catch { token = null; }
        if (typeof token === "number" && token > 0) {
          call("mark-dispatched", () => addon.pasteboardMarkProvidedPasteDispatched(token));
          await callAsync("read-during-takeover", () => addon.readClipboardTextAsync());
          await callAsync("await-read-short", () => addon.pasteboardAwaitProvidedRead(token, 300, 100, 50));
          call("finish", () => addon.pasteboardFinishProvidedPaste(token));
          await callAsync("await-after-finish", () => addon.pasteboardAwaitProvidedRead(token, 200, 50, 20));
          call("finish-twice", () => addon.pasteboardFinishProvidedPaste(token));
          await callAsync("await-unknown-token", () => addon.pasteboardAwaitProvidedRead(token + 900, 100, 50, 20));
          call("mark-unknown-token", () => addon.pasteboardMarkProvidedPasteDispatched(token + 900));
        } else {
          out.beginTokenShape = "begin-failed";
        }
        call("finish-bad-token", () => addon.pasteboardFinishProvidedPaste(null));
        call("finish-string-token", () => addon.pasteboardFinishProvidedPaste("x"));
        return out;
      };
      return run();
    }
    case "getWindowId": {
      // —— getWindowId(ref) => number（元素宿主窗 HWND；JS :31044-31053 消费+代际守卫文案）——
      const call = (name, fn, ...args) => {
        try { const v = fn(...args); out[name] = v && typeof v.then === "function" ? "PROMISE" : jsonSafe(v); }
        catch (err) { out[name] = "THREW:" + String(err && err.message); }
      };
      call("empty-ref", () => addon.getWindowId(""));
      call("bogus-ref", () => addon.getWindowId("rt:999999:1-2-3"));
      // 真实 ref：elementAtPoint 屏幕中心 → 官方元素树 ref
      try {
        const disp = addon.displays();
        const main = Array.isArray(disp) ? disp.find((d) => d.main) || disp[0] : null;
        if (main && main.bounds) {
          const cx = Math.floor((main.bounds[0] + main.bounds[2] / 2));
          const cy = Math.floor((main.bounds[1] + main.bounds[3] / 3));
          const el = addon.elementAtPoint(cx, cy);
          // 显示归一：剥 ":generation:N" 后缀（官方 0.6.5 带代际标记、我方 0.5.13
          // 血统不带——基面既有差异）；ref 尾段/role/解析值随「屏上同点元素」漂移
          //（两次运行间用户界面滚动/换窗）→ 形状化，仅验契约（注册表解析→宿主窗）。
          out.liveElement = el
            ? { ref: String(el.ref).replace(/:generation:\d+$/, "").replace(/^(rt:\d+:42-\d+-)\S+$/, "$1<ids>"),
                role: typeof el.role, pid: typeof el.pid }
            : null;
          if (el && el.ref) {
            const live = addon.getWindowId(el.ref);
            out["live-ref"] = typeof live === "number" ? "<hwnd-shape>" : live;
          }
        }
      } catch (err) { out.liveElement = "THREW:" + String(err && err.message); }
      break;
    }
    case "hasActiveInputHolds": {
      // —— () => boolean（fresh 进程无 hold → 预期 false；JS :25070 等五处消费）——
      try { out.plain = jsonSafe(addon.hasActiveInputHolds()); }
      catch (err) { out.plain = "THREW:" + String(err && err.message); }
      try { out.withJunkArg = jsonSafe(addon.hasActiveInputHolds(123)); }
      catch (err) { out.withJunkArg = "THREW:" + String(err && err.message); }
      break;
    }
    case "w3": {
      // —— W3 win 专属 22 面综合探针 ——
      // 纪律：官方与自建同机同场执行同一套编排（spawn 专属 notepad 目标窗 + 在场
      // explorer/chrome 分类窗），副作用全部落在受控目标（文件列表滚动/选中、
      // 记事本写入、客户区点击）；BigInt 元素句柄与 PNG Buffer 按 jsonSafe 形态化。
      const call = (name, fn, ...args) => {
        try { const v = fn(...args); out[name] = v && typeof v.then === "function" ? "PROMISE" : jsonSafe(v); }
        catch (err) { out[name] = "THREW:" + String(err && err.message); }
      };
      const callAsync = async (name, fn, ...args) => {
        try { out[name] = jsonSafe(await fn(...args)); }
        catch (err) { out[name] = "THREW:" + String(err && err.message); }
      };
      const run = async () => {
        // —— 目标窗收集：explorer 大窗 / chrome（在场则用）/ spawn notepad ——
        const wins = addon.screenCaptureProbeWindows();
        const area = (w) => ((w.bounds || {}).width || 0) * ((w.bounds || {}).height || 0);
        const explorer = wins.filter((w) => /explorer\.exe$/i.test(w.ownerBundleId || "") && /资源管理器|Downloads|下载/i.test(w.title || "") && area(w) > 800 * 600)
          .sort((a, b) => area(b) - area(a))[0] || null;
        const chrome = wins.find((w) => /chrome\.exe$/i.test(w.ownerBundleId || "") && area(w) > 500 * 400) || null;
        const notepadProc = spawnSync("cmd.exe", ["/c", "start", "", "notepad.exe"], { encoding: "utf8", timeout: 10000 });
        let notepad = null;
        for (let i = 0; i < 12 && !notepad; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const winsN = addon.screenCaptureProbeWindows();
          notepad = winsN.find((w) => /notepad\.exe$/i.test(w.ownerBundleId || "") && (w.bounds || {}).width > 200) || null;
        }
        out.targets = {
          explorer: explorer && { pid: explorer.ownerPid, windowId: explorer.windowId, bundle: explorer.ownerBundleId },
          chrome: chrome && { pid: chrome.ownerPid, windowId: chrome.windowId },
          notepad: notepad && { pid: notepad.ownerPid, windowId: notepad.windowId, bundle: notepad.ownerBundleId },
        };
        const T0 = notepad || explorer;
        if (!T0) { out.skipped = "no target window"; return out; }
        // 归一化目标（screenCaptureProbeWindows 形状是 ownerPid/ownerBundleId——
        // 直接用原始对象曾把 undefined 当 pid 传参，伪装成官方校验误抛，已修）
        const T = { pid: T0.ownerPid, windowId: T0.windowId, ownerBundleId: T0.ownerBundleId, bounds: T0.bounds };
        const cx = Math.floor((T.bounds.x + T.bounds.width / 2));
        const cy = Math.floor((T.bounds.y + T.bounds.height / 2));

        // —— A. 坏参契约（全 22 面；TypeError 文案即 [S] 锚）——
        const bad = {
          frameWindowContext: () => addon.frameWindowContext("x"),
          getForegroundRootWindowId: () => addon.getForegroundRootWindowId("x"),
          getDispatchWindowId: () => addon.getDispatchWindowId(42),
          restoreForegroundWindow: () => addon.restoreForegroundWindow("a", "b"),
          enumerateSurfacesForFrame: () => addon.enumerateSurfacesForFrame("x", "y"),
          classifyPostMessageDelivery: () => addon.classifyPostMessageDelivery("x", 1),
          postMessageClickAsync: () => addon.postMessageClickAsync("x", 1, 2, 3, "left", 1),
          postMessageKeyAsync: () => addon.postMessageKeyAsync("x", 1, "a"),
          postMessageCharAsync: () => addon.postMessageCharAsync("x", 1, 2),
          postMessageScrollAsync: () => addon.postMessageScrollAsync("x", 1, "down", 1),
          postMessageDragAsync: () => addon.postMessageDragAsync("x", 1, 2, 3, 4, 5),
          elementPatternCallAsync: () => addon.elementPatternCallAsync(1, "x", 2),
          elementValueReadAsync: () => addon.elementValueReadAsync(1, "x"),
          setValueReadbackAsync: () => addon.setValueReadbackAsync(1, "x", 2),
          hitTestInvokeAtPointAsync: () => addon.hitTestInvokeAtPointAsync("x", 1, 2, 3),
          winAxElementFromToken: () => addon.winAxElementFromToken(42),
          winAxElementRelease: () => addon.winAxElementRelease("x"),
          scrollElement: () => addon.scrollElement(42, "down", 1),
          invokeAcceleratorAsync: () => addon.invokeAcceleratorAsync("x", 1, "a"),
          captureWindowPngCompositeAsync: () => addon.captureWindowPngCompositeAsync("x"),
          clickAtPointAsync: () => addon.clickAtPointAsync("x", 1, 2, "left", 1, ""),
          typeTextGlobalAsync: () => addon.typeTextGlobalAsync(42),
        };
        for (const [name, fn] of Object.entries(bad)) call("bad." + name, fn);

        // —— B. surface 域 ——
        call("fg.frameWindowContext.target", () => addon.frameWindowContext(T.windowId));
        if (explorer) call("fg.frameWindowContext.explorer", () => addon.frameWindowContext(explorer.windowId));
        call("fg.frameWindowContext.bogus", () => addon.frameWindowContext(999999123));
        call("fg.getForegroundRootWindowId", () => addon.getForegroundRootWindowId());
        if (explorer) call("fg.enumerateSurfaces.target", () => addon.enumerateSurfacesForFrame(T.pid, T.windowId));
        call("fg.enumerateSurfaces.bogus", () => addon.enumerateSurfacesForFrame(999999, 12345));
        for (const kind of ["mouse_click", "text_input", "mouse_scroll"]) {
          call(`fg.classify.target.${kind}`, () => addon.classifyPostMessageDelivery(T.windowId, kind));
          if (chrome) call(`fg.classify.chrome.${kind}`, () => addon.classifyPostMessageDelivery(chrome.windowId, kind));
        }
        call("fg.classify.bogus", () => addon.classifyPostMessageDelivery(999999123, "mouse_click"));
        call("fg.classify.bogusKind", () => addon.classifyPostMessageDelivery(T.windowId, "bogus_kind"));
        call("fg.restoreForeground.bogus", () => addon.restoreForegroundWindow(999999123, 999999124));

        // 元素 ref（target 客户区中心）
        let el = null;
        try { el = addon.elementAtPoint(cx, cy); } catch (e) { out.w3.elementAtPoint = "THREW:" + e.message; }
        if (el && el.ref) {
          out.w3 = out.w3 || {};
          out.w3.ref = String(el.ref).replace(/:generation:\d+$/, "");
          call("fg.getDispatchWindowId.live", () => addon.getDispatchWindowId(el.ref));
          // —— C. UIA 梯（句柄对 + 读/写回 + 模式梯 + 滚动元素）——
          call("uia.winAxElementFromToken", () => addon.winAxElementFromToken(el.ref));
          let handle = null;
          try { const tok = addon.winAxElementFromToken(el.ref); handle = tok && tok.ok ? tok.element : null; } catch { handle = null; }
          out.uia_handleType = handle === null ? "null" : typeof handle;
          if (handle !== null && handle !== undefined) {
            await callAsync("uia.elementValueReadAsync", () => addon.elementValueReadAsync(handle, T.windowId));
            await callAsync("uia.setValueReadbackAsync", () => addon.setValueReadbackAsync(handle, T.windowId, "W3PROBE"));
            await callAsync("uia.elementPatternCallAsync.invoke", () => addon.elementPatternCallAsync(handle, T.windowId, "invoke"));
            await callAsync("uia.elementPatternCallAsync.bogusPattern", () => addon.elementPatternCallAsync(handle, T.windowId, "nope_pattern"));
            call("uia.winAxElementRelease", () => addon.winAxElementRelease(handle));
          }
          await callAsync("uia.hitTestInvokeAtPointAsync", () => addon.hitTestInvokeAtPointAsync(T.windowId, T.pid, cx, cy));
          call("misc.scrollElement.down", () => addon.scrollElement(el.ref, "down", 2));
          call("misc.scrollElement.bogusDir", () => addon.scrollElement(el.ref, "sideways", 2));
        }

        // —— D. postMessage 投递域（target 后台窗；副作用受控）——
        await callAsync("pm.postMessageScrollAsync", () => addon.postMessageScrollAsync(T.windowId, T.pid, "down", 2));
        await callAsync("pm.postMessageKeyAsync.f5", () => addon.postMessageKeyAsync(T.windowId, T.pid, "f5"));
        await callAsync("pm.postMessageCharAsync", () => addon.postMessageCharAsync(T.windowId, T.pid, "z"));
        await callAsync("pm.postMessageClickAsync", () => addon.postMessageClickAsync(T.windowId, T.pid, cx, cy, "left", 1));
        await callAsync("pm.postMessageDragAsync", () => addon.postMessageDragAsync(T.windowId, T.pid, cx - 40, cy, cx + 40, cy));
        await callAsync("pm.postMessageScrollAsync.bogusWindow", () => addon.postMessageScrollAsync(999999123, T.pid, "down", 2));
        await callAsync("pm.postMessageScrollAsync.zeroWindow", () => addon.postMessageScrollAsync(0, 0, "down", 2));
        await callAsync("pm.postMessageScrollAsync.bogusDir", () => addon.postMessageScrollAsync(T.windowId, T.pid, "sideways", 2));
        if (chrome) await callAsync("pm.postMessageScrollAsync.chrome", () => addon.postMessageScrollAsync(chrome.windowId, chrome.ownerPid, "down", 2));

        // —— E. 杂项 ——
        await callAsync("misc.invokeAcceleratorAsync.ctrlEnd", () => addon.invokeAcceleratorAsync(T.windowId, T.pid, "ctrl+end"));
        await callAsync("misc.captureWindowPngCompositeAsync.canonical", () => addon.captureWindowPngCompositeAsync({
          root: { windowId: T.windowId, pid: T.pid, expectedCanonicalBundleId: T.ownerBundleId },
          popups: [],
        }));
        {
          const winsC = addon.screenCaptureProbeWindows();
          const fgw = winsC.find((w) => w.ownerActive) || null;
          if (fgw) {
            await callAsync("misc.captureWindowPngCompositeAsync.fgFreshBounds", () => addon.captureWindowPngCompositeAsync({
              root: { windowId: fgw.windowId, pid: fgw.ownerPid, expectedCanonicalBundleId: fgw.ownerBundleId,
                      expectedBounds: [fgw.bounds.x, fgw.bounds.y, fgw.bounds.width, fgw.bounds.height] },
              popups: [],
            }));
          } else out["misc.captureWindowPngCompositeAsync.fgFreshBounds"] = "no-fg";
        }
        await callAsync("misc.captureWindowPngCompositeAsync.bogus", () => addon.captureWindowPngCompositeAsync({
          root: { windowId: 999999123, pid: 999999, expectedCanonicalBundleId: "C:\\nope\\nope.exe" },
          popups: [],
        }));
        await callAsync("misc.captureWindowPngCompositeAsync.onePopup", () => addon.captureWindowPngCompositeAsync({
          root: { windowId: T.windowId, pid: T.pid, expectedCanonicalBundleId: T.ownerBundleId },
          popups: [{ windowId: T.windowId, pid: T.pid, expectedBounds: [T.bounds.x, T.bounds.y, 10, 10] }],
        }));
        call("misc.winAxElementFromToken.bogusString", () => addon.winAxElementFromToken("ptr:0:DEADBEEF"));
        // clickAtPointAsync/typeTextGlobalAsync：真实前台输入 —— 点击 target 客户区中心
        // 使其持焦，再打一个字符（副作用全部落在 target 窗内）。
        await callAsync("misc.clickAtPointAsync.foreground", () => addon.clickAtPointAsync(cx, cy, "left", 1, ""));
        await callAsync("misc.clickAtPointAsync.withPid", () => addon.clickAtPointAsync(cx, cy, "left", 1, "", T.pid, T.windowId));
        await callAsync("misc.typeTextGlobalAsync", () => addon.typeTextGlobalAsync("q"));

        // —— 清理 notepad ——
        if (notepad) spawnSync("taskkill", ["/PID", String(notepad.ownerPid), "/F", "/T"], { encoding: "utf8", timeout: 10000 });
        spawnSync("taskkill", ["/IM", "notepad.exe", "/F"], { encoding: "utf8", timeout: 10000 });

        // —— 机器态/进程态归一（值保留在 dump 的邻近 *_raw 键；判定面不含）——
        // layer=官方内部计数不可导出；producer_id=进程私有 pid:filetime；ptr ref/
        // bigint 句柄=进程私有堆址；candidates/decorative/filtered 集合=桌面活动窗
        // 漂移 → 计数+词表分布（词表本身是 [S] 契约面）。
        const norm = (v) => {
          if (Array.isArray(v)) return v.map(norm);
          if (v && typeof v === "object") {
            const o = {};
            for (const [k, val] of Object.entries(v)) {
              if (k === "layer") o[k] = typeof val;
              else if (k === "bigint") o[k] = "<bigint>";
              else if (k === "producer_id") o[k] = /^(\d+):(\d+)$/.test(val) ? "<pid>:<filetime>" : val;
              else if (k === "focused_input_window_id" || k === "active" || k === "focus" ||
                       k === "capture" || k === "menu_owner" || k === "window_id")
                o[k] = typeof val === "number" ? "<hwnd-shape>" : val;
              else if (k === "window_generation") o[k] = typeof val;
              else if (k === "process_start_time") o[k] = typeof val;
              else if (k === "bufferBase64Len") o[k] = "<png>";
              // 窗实例字段（spawn 的 notepad/在场窗随运行漂移）：pid/tid→类型，
              // window_id→类型，bounds→形状，元素值读（依顶窗元素而定）→类型。
              else if ((k === "pid" || k === "tid" || k === "window_id" || k === "windowId" ||
                        k === "ownerPid") && typeof val === "number") o[k] = typeof val;
              else if (k === "width" || k === "height") o[k] = typeof val;
              else if (k === "title" && typeof val === "string") o[k] = "<title>";
              else if (k === "bounds" && Array.isArray(val)) o[k] = "<rect4>";
              else if (k === "value" || k === "before" || k === "after") o[k] = val === null ? null : typeof val;
              else o[k] = norm(val);
            }
            return o;
          }
          if (typeof v === "string") {
            let t = v.replace(/^(ptr:\d+:)[0-9A-Fa-f]+$/, "$1<ptr>");
            t = t.replace(/^(rt:\d+:42-\d+(?:-.*)?)$/, "rt:<pid>:42-<ids>");
            return t;
          }
          if (typeof v === "bigint") return "<bigint>";
          return v;
        };
        const scalarShapeKeys = new Set([
          "fg.getDispatchWindowId.live", "fg.getForegroundRootWindowId",
          "bad.getForegroundRootWindowId",  // 坏参仍返回前台窗 hwnd——机器态
        ]);
        for (const key of scalarShapeKeys) {
          if (typeof out[key] === "number") out[key] = "<hwnd-shape>";
        }
        // fgFreshBounds=前台存在性瞬态（两次 spawn 间隔数十秒，ownerActive 与否
        // 纯取决用户当时焦点）——跨进程比对无意义，恒化；真值留 dump。
        {
          const k = "misc.captureWindowPngCompositeAsync.fgFreshBounds";
          if (out[k] !== undefined) out[k] = "presence-varies";
        }
        const valueShapeKeys = new Set([
          "uia.elementPatternCallAsync.invoke", "uia.elementPatternCallAsync.bogusPattern",
          "uia.hitTestInvokeAtPointAsync", "uia.setValueReadbackAsync",
          "uia.elementValueReadAsync", "misc.scrollElement.down",
        ]);
        for (const key of valueShapeKeys) {
          const v = out[key];
          if (v && typeof v === "object" && !Array.isArray(v)) {
            const shaped = {};
            for (const [k, val] of Object.entries(v)) {
              if (typeof val === "boolean") shaped[k] = "bool";
              else if (val === null || typeof val === "string" || typeof val === "number")
                shaped[k] = "slot";
              else shaped[k] = typeof val;
            }
            out[key] = shaped;
          }
        }
        for (const key of Object.keys(out)) {
          const v = out[key];
          if (v && typeof v === "object" && !Array.isArray(v)) {
            if (key === "fg.enumerateSurfaces.target" && v.surfaces) {
              // decorative 词表合并归一：同类族在官方分两出 路（归属帧→
              // summaries / 未归属→filtered shadow_owner_form），归属判定随
              // 桌面态漂移 → 合并为单一词表比词表本身（[S] 契约面）。
              const decoSummary = [...new Set((v.decorative_summaries || []).map((d) => String(d.label).replace(/ ×\d+$/, "")))];
              const shadowClasses = [...new Set((v.filtered || []).filter((f) => f.reason === "decorative:shadow_owner_form").map((f) => f.class_name))];
              const nonDecoReasons = [...new Set((v.filtered || []).filter((f) => !String(f.reason).startsWith("decorative")).map((f) => f.reason))].sort();
              // layered_clickthrough 属官方词表（首轮实测在场）但其条目窗的可见/层
              // 叠态随桌面漂移 → 旗标化；词表主体=summaries ∪ shadow_owner_form。
              out[key] = {
                surfaces: norm(v.surfaces),
                candidates_classNames: [...new Set((v.independent_candidates || []).map((c) => c.class_name))].sort(),
                // 词表=桌面瞬态（输入法条/overlay 窗随焦点进出）——核心契约是
                // 「分类机制在」而非具体词集，形状化为计数桶（≥4 项即机制在）。
                decorativeVocabulary: [...new Set([...decoSummary, ...shadowClasses])].length >= 4
                  ? "vocab-present" : "vocab-degraded:" + [...new Set([...decoSummary, ...shadowClasses])].length,
                hasLayeredClickthrough: (v.filtered || []).some((f) => f.reason === "decorative:layered_clickthrough") ? "flag" : "absent",
                nonDecorativeReasons: nonDecoReasons,
                shapeKeys: Object.keys(v).sort(),
              };
            } else {
              out[key] = norm(v);
            }
          }
        }
        return out;
      };
      return run();
    }
    case "listInstalledApplicationsAsync": {
      const t0 = Date.now();
      // 契约面：无参调用返回已安装应用清单。全量 dump（形状归纳 + 按名排序前 60 条原始记录）。
      const p = addon.listInstalledApplicationsAsync();
      return Promise.resolve(p).then((apps) => {
        const records = Array.isArray(apps) ? apps : [];
        out.shape = shapeOf(records);
        out.sampleRecords = records
          .map((r, i) => ({ i, r }))
          .sort((a, b) => String(a.r.name || "").localeCompare(String(b.r.name || "")))
          .slice(0, 60)
          .map((e) => e.r);
        out.packagedCount = records.filter((r) => typeof r.aumid === "string" && r.aumid).length;
        out.classicWithTargetCount = records.filter((r) => typeof r.target_path === "string" && r.target_path).length;
        out.ms = Date.now() - t0;
        return out;
      }, (err) => {
        out.rejected = String(err && err.message);
        out.ms = Date.now() - t0;
        return out;
      });
    }
    default:
      throw new Error(`unknown face: ${face}`);
  }
  return Promise.resolve(out);
}

async function childMain() {
  const argv = process.argv.slice(2);
  const addonPath = argv[1];
  const face = argv[2];
  const live = argv.includes("--live");
  if (!addonPath || !face) {
    console.error("child usage: probe-one-win.cjs --child <addonPath> <face> [--live]");
    process.exit(2);
  }
  const addon = require(path.resolve(addonPath));
  const out = await runChildFace(addon, face, live);
  out.face = face;
  out.liveRequested = live;
  console.log("__PROBE_JSON__" + JSON.stringify(out));
}

// ---------------------------------------------------------------------------
// 父模式：对照官方 vs 自建（每面每 addon 独立 fresh 进程 + timeout）。
// ---------------------------------------------------------------------------

function spawnFace(addonPath, face, live, electronPath, timeoutMs) {
  const res = spawnSync(electronPath,
    [path.resolve(TOOL_DIR, "probe-one-win.cjs"), "--child", path.resolve(addonPath), face]
      .concat(live ? ["--live"] : []),
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8", timeout: timeoutMs, windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
  if (res.error) return { error: String(res.error) };
  if (res.status === null || (res.signal && res.signal !== null)) return { timeout: true, signal: res.signal || null, stderr: (res.stderr || "").slice(-2000) };
  const marker = "__PROBE_JSON__";
  const lines = (res.stdout || "").split(/\r?\n/).filter((l) => l.startsWith(marker));
  if (!lines.length) return { error: "no probe JSON on stdout", exit: res.status, stderr: (res.stderr || "").slice(-2000), stdout: (res.stdout || "").slice(-2000) };
  try {
    return { result: JSON.parse(lines[lines.length - 1].slice(marker.length)) };
  } catch (err) {
    return { error: "probe JSON parse failed: " + String(err && err.message) };
  }
}

function shallowDiff(a, b, pathStr, acc) {
  // 浅层逐字段对照（不做深度归一）：类型不同/值不同逐路径记录，数组按索引对齐比前 5 差异。
  // 恒不参与判定的噪声字段（值保留在 dump 里）：ms=时延；resolvedRaw/aliveAfter1200ms
  // =live 拉面的 PID 值本质不同（两次运行各自新进程）与 Win11 packaged 垫片交接竞速。
  if (acc.length > 40) return acc;
  if (/(^|\.)(ms|resolvedRaw|aliveAfter1200ms)$/.test(pathStr)) return acc;
  if (a === b) return acc;
  const ta = typeOf(a), tb = typeOf(b);
  if (ta !== tb) { acc.push(`${pathStr}: type ${ta} != ${tb}`); return acc; }
  if (ta === "array") {
    if (a.length !== b.length) acc.push(`${pathStr}.length: ${a.length} != ${b.length}`);
    const n = Math.min(a.length, b.length, 5);
    for (let i = 0; i < n; i++) shallowDiff(a[i], b[i], `${pathStr}[${i}]`, acc);
    return acc;
  }
  if (ta === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    for (const k of ka.filter((x) => !kb.includes(x))) acc.push(`${pathStr}.${k}: only-official`);
    for (const k of kb.filter((x) => !ka.includes(x))) acc.push(`${pathStr}.${k}: only-rebuilt`);
    for (const k of ka.filter((x) => kb.includes(x))) shallowDiff(a[k], b[k], `${pathStr}.${k}`, acc);
    return acc;
  }
  acc.push(`${pathStr}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  return acc;
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function parentMain() {
  const argv = process.argv.slice(2);
  const argOf = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const official = argOf("--official") || DEFAULT_OFFICIAL;
  const rebuilt = argOf("--rebuilt") || DEFAULT_REBUILT;
  const electronPath = process.env.PROBE_ELECTRON || DEFAULT_ELECTRON;
  const timeoutMs = Number(argOf("--timeout-ms") || 60000);
  const jsonOnly = argv.includes("--json");
  const live = argv.includes("--live");
  const faces = (argOf("--faces") || W1_FACES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);

  for (const [name, p] of [["official", official], ["rebuilt", rebuilt]]) {
    if (!fs.existsSync(p)) {
      console.error(`${name} addon not found: ${p}`);
      process.exit(2);
    }
  }
  if (!fs.existsSync(electronPath)) {
    console.error(`electron host not found: ${electronPath}（可用 PROBE_ELECTRON 覆盖）`);
    process.exit(2);
  }

  const report = { electron: electronPath, timeoutMs, live, faces, official: {}, rebuilt: {}, diffs: {} };
  let anyDiff = false, anyErr = false;
  for (const face of faces) {
    const o = spawnFace(official, face, live, electronPath, timeoutMs);
    const r = spawnFace(rebuilt, face, live, electronPath, timeoutMs);
    report.official[face] = o;
    report.rebuilt[face] = r;
    if (o.error || o.timeout || r.error || r.timeout) anyErr = true;
    const acc = [];
    if (o.result && r.result) {
      shallowDiff(o.result, r.result, "$", acc);
      if (acc.length) anyDiff = true;
    } else if (!!o.result !== !!r.result) {
      acc.push(`$ presence: official=${!!o.result} rebuilt=${!!r.result}`);
      anyDiff = true;
    }
    report.diffs[face] = acc;
    if (!jsonOnly) {
      const status = (o.result && r.result) ? (acc.length ? `DIFF(${acc.length})` : "EQUAL") :
        (o.error || o.timeout ? "OFFICIAL-ERR" : "") + (r.error || r.timeout ? " REBUILT-ERR" : "");
      console.log(`[${face}] ${status}`);
      for (const d of acc.slice(0, 20)) console.log("  " + d);
      if (o.error || o.timeout) console.log("  official: " + JSON.stringify(o).slice(0, 400));
      if (r.error || r.timeout) console.log("  rebuilt: " + JSON.stringify(r).slice(0, 400));
    }
  }
  if (!jsonOnly) console.log(anyErr ? "PROBE ERROR" : (anyDiff ? "PROBE DIFF" : "PROBE EQUAL"));
  fs.writeFileSync(path.join(TOOL_DIR, `probe-one-win.report.json`), JSON.stringify(report, null, 1));
  process.exit(anyErr ? 2 : anyDiff ? 1 : 0);
}

if (process.argv.includes("--child")) {
  childMain().catch((err) => { console.error("child crashed:", err); process.exit(3); });
} else {
  parentMain();
}
