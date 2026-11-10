#!/usr/bin/env node
// R8 输入守卫还原回归（specs/cua-gap-remediation-2026-11-09.md 第五节 R8，G1-G6）。
// 官方证据锚（SEA 字节偏移，官方 3.17.2
// packages/desktop/resources/cua-helper/ZCode Computer Use.app，JS payload @85180513）：
//   G1 element_focus_unavailable@85452514 / text_truncated@85453452 /
//      text_injection_failed@85453721 / 排水 max(120,字数×20)ms@85454109 区
//   G2 window_source_unavailable@85356277 / window_identity_unverified@85356605 /
//      window_gone@85356992 / activation_failed@85357494（gate 定义 @85355323）
//   G3 key-hold 防误路由 @85407196/85407343 + click/scroll/drag 变体
//      @85472831/85484612/85490603
//   G4 clickAtPointAsync 缺 ABI 拒绝 @85471771
//   G5 app-scoped 激活拒绝诊断 @85389303/85389381
//   G6 hit-test 并发指引 @85360793（uia_ 前缀 reason 族）
// 运行：node test/r8-input-guards.mjs（需先 tsc -p tsconfig.json 产出 dist）。
import { strict as assert } from "node:assert";
import { createElectronInputHandlers, windowsForegroundWindowGate } from "../dist/broker/server/electronInputHandlers.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = { pid: 4242, bundle_id: "com.example.app", name: "Example", active: true };

// 最小 axSource：身份解析 + frontmost 断言 + 按需 listWindows/elementFocus。
function makeAxSource({ windows = null, focusOutcome = true } = {}) {
  const source = {
    applicationInfo: async () => ({ ...APP }),
    listApplications: async () => [{ ...APP }],
  };
  if (windows !== null) source.listWindows = async () => windows;
  if (focusOutcome !== null) source.elementFocus = async () => focusOutcome;
  return source;
}

// 最小 adapter：默认缺 typeTextToApp（触发 win32 前台链），同步原语可用。
function makeAdapter(overrides = {}) {
  return {
    typeTextGlobal: () => true,
    pressKeyGlobal: () => true,
    holdKeyGlobal: async () => true,
    clickAtPoint: () => true,
    moveTo: () => true,
    scrollAt: () => true,
    drag: async () => true,
    isFocusStealPrevented: () => false,
    ...overrides,
  };
}

function makeHandlers({ adapter, axSource, options = {} } = {}) {
  return createElectronInputHandlers({
    adapter,
    axSource,
    platform: "win32",
    allowAxHitTestClick: true,
    ...options,
  });
}

async function rejectsVerbatim(promise, code, message, details = {}) {
  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `expected rejection with: ${message}`);
  assert.equal(caught.code, code, `code mismatch for: ${message}`);
  assert.equal(caught.message, message);
  for (const [key, value] of Object.entries(details)) {
    assert.deepEqual(caught.details[key], value, `details.${key} for: ${message}`);
  }
  return caught;
}

// ===================================================================================
// G1 —— type_text_to_app（win32 前台文本注入）
// ===================================================================================
const TTA_PARAMS = {
  text: "hello world", // 11 字符 → 排水 max(120, 220)=220ms
  app_ref: { pid: APP.pid, bundle_id: APP.bundle_id },
};

{
  // G1a：typeTextGlobalAsync 成功 → 异步原语被用、同步原语不触发、正常返回。
  let asyncUsed = false;
  let syncUsed = false;
  const handlers = makeHandlers({
    adapter: makeAdapter({
      typeTextGlobalAsync: async () => ({ ok: true, sent: 11, total: 11 }),
      typeTextGlobal: () => {
        syncUsed = true;
        return true;
      },
    }),
    axSource: makeAxSource(),
  });
  const started = Date.now();
  const result = await handlers.type_text_to_app(TTA_PARAMS);
  asyncUsed = true;
  // W3 后置还原（官方 0.6.5 win32 entry :26273 + :27461-27470）：win32 前台文本
  // 注入不再返回 null，而是 foreground_event + delivery 封套，且经六方法后置
  // 包装补 resolved_app_ref/dispatch_surface。此前的 null 断言对应 W3 之前的
  // 偏离形态（原实现注释「偏离说明」档），随本批接线对齐官方。
  assert.equal(result.method, "foreground_event");
  assert.deepEqual(result.delivery, {
    path: "foreground_send_input",
    effect: "unverifiable",
    attempts: [{ path: "foreground_send_input", dispatch_status: "sent" }],
    escalated: false,
  });
  assert.deepEqual(result.resolved_app_ref, { pid: APP.pid, bundle_id: APP.bundle_id });
  assert.deepEqual(result.dispatch_surface, {
    owner_pid: APP.pid,
    owner_bundle_id: APP.bundle_id,
  });
  assert.ok(!syncUsed, "async path must not call sync typeTextGlobal");
  // 排水：11 字符 × 20 = 220ms（markInjected 后收尾排水再恢复），至少 200ms。
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 200, `drain max(120, chars*20) expected >=200ms, got ${elapsed}ms`);
  assert.ok(asyncUsed);
  console.log("G1a type_text_to_app async 注入成功 + 排水时序 OK");
}

{
  // G1b：截断双语义——部分落地（text_truncated，勿重放，action_sent=true）。
  const handlers = makeHandlers({
    adapter: makeAdapter({ typeTextGlobalAsync: async () => ({ ok: false, sent: 4, total: 11 }) }),
    axSource: makeAxSource(),
  });
  const started = Date.now();
  await rejectsVerbatim(
    handlers.type_text_to_app(TTA_PARAMS),
    "element_unavailable",
    "type_text_to_app: text injection truncated after 4/11 characters; the prefix possibly landed. Do not replay; re-observe before retrying.",
    { action_sent: true, reason: "text_truncated" },
  );
  // 截断已 markInjected → 仍排水（>=200ms）。
  assert.ok(Date.now() - started >= 200, "truncated injection must still drain");
  console.log("G1b text_truncated 逐字文案 + action_sent=true + 排水 OK");
}

{
  // G1c：零落地（text_injection_failed，可重试，action_sent=false，不排水）。
  const handlers = makeHandlers({
    adapter: makeAdapter({ typeTextGlobalAsync: async () => ({ ok: false, sent: 0, total: 11 }) }),
    axSource: makeAxSource(),
  });
  const started = Date.now();
  await rejectsVerbatim(
    handlers.type_text_to_app(TTA_PARAMS),
    "element_unavailable",
    "type_text_to_app: text injection failed before any character was sent.",
    { action_sent: false, reason: "text_injection_failed" },
  );
  assert.ok(Date.now() - started < 120, "failed-before-send must not drain");
  console.log("G1c text_injection_failed 逐字文案 + 不排水 OK");
}

{
  // G1d：异步 ABI 缺失 → 回退同步 typeTextGlobal（mac 136 导出面行为）。
  let syncUsed = false;
  const handlers = makeHandlers({
    adapter: makeAdapter({
      typeTextGlobal: () => {
        syncUsed = true;
        return true;
      },
    }),
    axSource: makeAxSource(),
  });
  await handlers.type_text_to_app({ ...TTA_PARAMS, text: "ab" }); // 2 字符 → 排水 120ms 底
  assert.ok(syncUsed, "sync fallback must run when async ABI absent");
  console.log("G1d 异步 ABI 缺失回退同步原语 OK");
}

{
  // G1e：异步/同步原语均缺失 → notAuthorized 逐字。
  const handlers = makeHandlers({
    adapter: makeAdapter({ typeTextGlobal: undefined }),
    axSource: makeAxSource(),
  });
  await rejectsVerbatim(
    handlers.type_text_to_app({ ...TTA_PARAMS, text: "ab" }),
    "not_authorized",
    "type_text_to_app: the global keystroke primitive is unavailable in this ZCode build.",
  );
  console.log("G1e 双原语缺失拒绝文案 OK");
}

{
  // G1f：焦点预检（element_focus_unavailable@85452514）——element_native + registry
  // 提供 ref 且 elementFocus 失败时，注入前拒绝。
  // W3 后置还原：官方 0.6.5 win32 entry :26188 的预检门是 insertionDelivery 非空
  //（dispatchWindowsElementInsertion 产出了 not_sent 封套）才取 ref；fixture 补
  // postMessageCharAsync + classifyPostMessageDelivery(dropped) 使插入路径产出
  // 全 not_sent 封套（不开后台终态），官方门打开后预检照旧逐字拒绝，且拒绝
  // details 附 finalizeDelivery 封套（官方 :26196-26200）。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageCharAsync: async () => ({ ok: false, error: "failed" }),
      classifyPostMessageDelivery: () => ({ delivery: "dropped", host: "chromium" }),
    }),
    axSource: makeAxSource({ focusOutcome: false, windows: [{ window_id: 77, focused: true }] }),
    options: { windowsElementReadback: { registry: { refFor: () => "native-token-1" } } },
  });
  await rejectsVerbatim(
    handlers.type_text_to_app({
      ...TTA_PARAMS,
      text: "ab",
      element_native: "native-token-1",
      app_ref: { pid: APP.pid, bundle_id: APP.bundle_id, window_id: 77 },
    }),
    "element_unavailable",
    "type_text_to_app: refused to send text because the target element could not take keyboard focus; re-observe before retrying.",
    {
      action_sent: false,
      reason: "element_focus_unavailable",
      delivery: {
        path: "post_message",
        effect: "unverifiable",
        attempts: [{ path: "post_message", dispatch_status: "not_sent", reason: "droppable_chromium" }],
        escalated: false,
      },
    },
  );
  console.log("G1f element_focus_unavailable 预检逐字文案 OK");
}

{
  // G1g：type_text（win32）异步双语义（@85493942 区，type_text 前缀文案）。
  const truncated = makeHandlers({
    adapter: makeAdapter({ typeTextGlobalAsync: async () => ({ ok: false, sent: 2, total: 5 }) }),
    axSource: makeAxSource(),
  });
  await rejectsVerbatim(
    truncated.type_text({ text: "abcde" }),
    "element_unavailable",
    "type_text: text injection truncated after 2/5 characters; the prefix possibly landed. Do not replay; re-observe before retrying.",
    { action_sent: true, reason: "text_truncated" },
  );
  const failed = makeHandlers({
    adapter: makeAdapter({ typeTextGlobalAsync: async () => ({ ok: false, sent: 0, total: 5 }) }),
    axSource: makeAxSource(),
  });
  await rejectsVerbatim(
    failed.type_text({ text: "abcde" }),
    "element_unavailable",
    "type_text: text injection failed before any character was sent.",
    { action_sent: false, reason: "text_injection_failed" },
  );
  // 双原语均缺且非 win32-async → 不可用拒绝（type_text 可用性门是同步 throw，
  // 包 async 使其落为 rejected promise 断言）。
  const unavailable = makeHandlers({
    adapter: makeAdapter({ typeTextGlobal: undefined }),
    axSource: makeAxSource(),
  });
  await rejectsVerbatim(
    (async () => unavailable.type_text({ text: "abcde" }))(),
    "not_authorized",
    "type_text is unavailable in this ZCode build.",
  );
  console.log("G1g type_text 截断双语义逐字文案 OK");
}

{
  // G1h：win32 物理输入 lane 串行——两次注入不并发（官方 createWindowsPhysicalLane）。
  let inFlight = 0;
  let overlapped = false;
  const adapter = makeAdapter({
    typeTextGlobalAsync: async () => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await delay(60);
      inFlight -= 1;
      return { ok: true, sent: 2, total: 2 };
    },
  });
  const handlers = makeHandlers({ adapter, axSource: makeAxSource() });
  await Promise.all([
    handlers.type_text({ text: "ab" }),
    handlers.type_text({ text: "cd" }),
  ]);
  assert.ok(!overlapped, "physical lane must serialize win32 dispatches");
  console.log("G1h win32 物理输入 lane 串行 OK");
}

// ===================================================================================
// G2 —— 活窗四段门禁（windowsForegroundWindowGate）
// ===================================================================================
const GATE_TARGET = { pid: APP.pid, bundleId: APP.bundle_id, windowId: 77 };

{
  // G2a：window_source_unavailable@85356277（无 listWindows 源）。
  await rejectsVerbatim(
    windowsForegroundWindowGate({
      axSource: makeAxSource(),
      activateWindow: () => true,
      target: GATE_TARGET,
      method: "type_text_to_app",
    }),
    "element_unavailable",
    "type_text_to_app: window-scoped foreground input requires a live window source; action_sent=false. Re-observe the application and retry.",
    { action_sent: false, reason: "window_source_unavailable" },
  );
  console.log("G2a window_source_unavailable 逐字文案 OK");
}

{
  // G2b：window_identity_unverified@85356605（listWindows 返回非数组）。
  await rejectsVerbatim(
    windowsForegroundWindowGate({
      axSource: { listWindows: async () => undefined },
      activateWindow: () => true,
      target: GATE_TARGET,
      method: "type_text_to_app",
    }),
    "element_unavailable",
    "type_text_to_app: live window identity for pid 4242 could not be read; action_sent=false. Re-observe the application and retry.",
    { action_sent: false, reason: "window_identity_unverified" },
  );
  console.log("G2b window_identity_unverified 逐字文案 OK");
}

{
  // G2c：window_gone@85356992（目标窗口不在活窗列表）。
  await rejectsVerbatim(
    windowsForegroundWindowGate({
      axSource: makeAxSource({ windows: [{ window_id: 55, focused: true }] }),
      activateWindow: () => true,
      target: GATE_TARGET,
      method: "type_text_to_app",
    }),
    "element_unavailable",
    "type_text_to_app: window 77 of pid 4242 is no longer in the live window list. action_sent=false. Re-observe from a fresh get_app_state.",
    { action_sent: false, reason: "window_gone" },
  );
  console.log("G2c window_gone 逐字文案 OK");
}

{
  // G2d：activation_failed@85357494（未聚焦 + 激活失败）。
  await rejectsVerbatim(
    windowsForegroundWindowGate({
      axSource: makeAxSource({ windows: [{ window_id: 77, focused: false }] }),
      activateWindow: () => false,
      target: GATE_TARGET,
      method: "type_text_to_app",
    }),
    "permission_denied",
    "type_text_to_app: target window 77 could not be brought to the foreground, so nothing was sent. action_sent=false.",
    { action_sent: false, reason: "activation_failed" },
  );
  console.log("G2d activation_failed 逐字文案 OK");
}

{
  // G2e：菜单宿主段 menu_host_not_foreground（frameWindowContext 报菜单但宿主未证）。
  await rejectsVerbatim(
    windowsForegroundWindowGate({
      axSource: makeAxSource(),
      windowContext: () => ({
        is_menu: true,
        window_id: 77,
        pid: APP.pid,
        bundle_id: APP.bundle_id,
        visible: true,
        enabled: true,
        menu_foreground_host_window_id: null,
        operation_foreground_host_window_id: null,
      }),
      activateWindow: () => true,
      target: GATE_TARGET,
      method: "type_text_to_app",
    }),
    "element_unavailable",
    "type_text_to_app: the menu's proven host is not foreground; re-observe before sending.",
    { action_sent: false, reason: "menu_host_not_foreground" },
  );
  console.log("G2e menu_host_not_foreground 逐字文案 OK");
}

{
  // G2f：经 dispatchWindowsForegroundKeyed 的 window_gone（目标带 window_id 且源可用）。
  const handlers = makeHandlers({
    adapter: makeAdapter({ typeTextGlobalAsync: async () => ({ ok: true, sent: 2, total: 2 }) }),
    axSource: makeAxSource({ windows: [{ window_id: 55, focused: true }] }),
  });
  await rejectsVerbatim(
    handlers.type_text_to_app({
      text: "ab",
      app_ref: { pid: APP.pid, bundle_id: APP.bundle_id, window_id: 77 },
    }),
    "element_unavailable",
    "type_text_to_app: window 77 of pid 4242 is no longer in the live window list. action_sent=false. Re-observe from a fresh get_app_state.",
    { action_sent: false, reason: "window_gone" },
  );
  console.log("G2f 派发链内 window_gone 接线 OK");
}

// ===================================================================================
// G3 —— key-hold 防误路由（hold 未释放拒绝切前台）
// ===================================================================================
const HOLD = () => true;

{
  // G3a：窗口级变体（@85407196 区）——目标带 window_id、未聚焦、hold 活跃。
  const handlers = makeHandlers({
    adapter: makeAdapter({ hasActiveInputHolds: HOLD }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: false }] }),
  });
  await rejectsVerbatim(
    handlers.type_text_to_app({
      text: "ab",
      app_ref: { pid: APP.pid, bundle_id: APP.bundle_id, window_id: 77 },
    }),
    "permission_denied",
    "type_text_to_app: refused to bring window 77 of pid 4242 to the foreground because another key hold is still active \u2014 switching foreground now would misroute the held keys. action_sent=false. Wait for the hold to finish and retry.",
    { action_sent: false, reason: "input_hold_active", expected_pid: APP.pid },
  );
  console.log("G3a key-hold 窗口级拒绝逐字文案 OK");
}

{
  // G3b：pid 级变体（@85407343 区）——无 window_id、目标非前台、hold 活跃。
  const axSource = makeAxSource();
  axSource.listApplications = async () => [{ ...APP, active: false }];
  const handlers = makeHandlers({
    adapter: makeAdapter({ hasActiveInputHolds: HOLD }),
    axSource,
  });
  await rejectsVerbatim(
    handlers.type_text_to_app(TTA_PARAMS),
    "permission_denied",
    "type_text_to_app: refused to bring pid 4242 to the foreground because another key hold is still active \u2014 switching foreground now would misroute the held keys. action_sent=false. Wait for the hold to finish and retry.",
    { action_sent: false, reason: "input_hold_active", expected_pid: APP.pid },
  );
  console.log("G3b key-hold pid 级拒绝逐字文案 OK");
}

const CLICK_PRECISE = {
  point: { x: 10, y: 20 },
  expected_pid: APP.pid,
  expected_bundle_id: APP.bundle_id,
  expected_window_id: 77,
};

{
  // G3c：click 变体（@85472831）——精确目标 + hold 活跃，前台升级前拒绝。
  const handlers = makeHandlers({ adapter: makeAdapter({ hasActiveInputHolds: HOLD }), axSource: makeAxSource() });
  await rejectsVerbatim(
    handlers.click(CLICK_PRECISE),
    "permission_denied",
    "refused to bring pid in front for a click because another key hold is still active. action_sent=false.",
    { action_sent: false, reason: "input_hold_active" },
  );
  console.log("G3c key-hold click 变体拒绝逐字文案 OK");
}

{
  // G3d：scroll 变体（@85484612）。
  const handlers = makeHandlers({ adapter: makeAdapter({ hasActiveInputHolds: HOLD }), axSource: makeAxSource() });
  await rejectsVerbatim(
    handlers.scroll({
      point: { x: 10, y: 20 },
      direction: "down",
      amount: 3,
      app_ref: { pid: APP.pid, bundle_id: APP.bundle_id },
    }),
    "permission_denied",
    "scroll: refused to bring the target to the foreground because another key hold is still active. action_sent=false.",
    { action_sent: false, reason: "input_hold_active" },
  );
  console.log("G3d key-hold scroll 变体拒绝逐字文案 OK");
}

{
  // G3e：drag 变体（@85490603）。
  const handlers = makeHandlers({ adapter: makeAdapter({ hasActiveInputHolds: HOLD }), axSource: makeAxSource() });
  await rejectsVerbatim(
    handlers.drag({
      start: { x: 1, y: 2 },
      end: { x: 3, y: 4 },
      app_ref: { pid: APP.pid, bundle_id: APP.bundle_id },
    }),
    "permission_denied",
    "drag: refused to bring pid in front because another key hold is still active. action_sent=false.",
    { action_sent: false, reason: "input_hold_active" },
  );
  console.log("G3e key-hold drag 变体拒绝逐字文案 OK");
}

// ===================================================================================
// G4 —— clickAtPointAsync 异步通道 + 缺 ABI 拒绝（@85471771）
// ===================================================================================
{
  // G4a：非精确目标（仅 pid）+ 缺 clickAtPointAsync → notAuthorized 逐字。
  const handlers = makeHandlers({ adapter: makeAdapter(), axSource: makeAxSource() });
  await rejectsVerbatim(
    handlers.click({ point: { x: 10, y: 20 }, expected_pid: APP.pid, expected_bundle_id: APP.bundle_id }),
    "not_authorized",
    "click: this ZCode build lacks the async foreground click primitive; input refused. action_sent=false.",
    { action_sent: false },
  );
  console.log("G4a click 缺 clickAtPointAsync 拒绝逐字文案 OK");
}

{
  // G4b：无目标坐标点击 + 缺 clickAtPointAsync → 同拒绝（win32 全域走异步通道）。
  const handlers = makeHandlers({ adapter: makeAdapter(), axSource: makeAxSource() });
  await rejectsVerbatim(
    handlers.click({ point: { x: 10, y: 20 } }),
    "not_authorized",
    "click: this ZCode build lacks the async foreground click primitive; input refused. action_sent=false.",
    { action_sent: false },
  );
  console.log("G4b click 无目标态缺异步原语拒绝 OK");
}

{
  // G4c：clickAtPointAsync 可用 → 异步通道被调用（带 pid/window 裁剪参数）。
  const calls = [];
  const handlers = makeHandlers({
    adapter: makeAdapter({
      clickAtPointAsync: async (...args) => {
        calls.push(args);
        return true;
      },
    }),
    axSource: makeAxSource(),
  });
  const result = await handlers.click({
    point: { x: 10, y: 20 },
    expected_pid: APP.pid,
    expected_bundle_id: APP.bundle_id,
  });
  assert.equal(calls.length, 1, "async click channel must be used");
  assert.deepEqual(calls[0], [10, 20, "left", 1, null, APP.pid, undefined]);
  assert.equal(result.method, "click");
  console.log("G4c clickAtPointAsync 异步通道 + 参数形态 OK");
}

// ===================================================================================
// G5 —— app-scoped 激活拒绝诊断（@85389303/85389381）
// ===================================================================================
{
  // G5a：缺 activateApplication ABI → notAuthorized 逐字。
  const axSource = makeAxSource();
  axSource.listApplications = async () => [{ ...APP, active: false }];
  const handlers = makeHandlers({ adapter: makeAdapter(), axSource });
  await rejectsVerbatim(
    handlers.type_text_to_app(TTA_PARAMS),
    "not_authorized",
    "type_text_to_app: app-scoped input needs to bring pid 4242 to the foreground, but native activation support is unavailable in this ZCode build. action_sent=false.",
    { action_sent: false },
  );
  console.log("G5a app-scoped 缺激活 ABI 拒绝逐字文案 OK");
}

{
  // G5b：激活失败 → permissionDenied 逐字 + activation_failed + expected_pid。
  const axSource = makeAxSource();
  axSource.listApplications = async () => [{ ...APP, active: false }];
  const handlers = makeHandlers({
    adapter: makeAdapter({ activateApplication: () => false }),
    axSource,
  });
  await rejectsVerbatim(
    handlers.type_text_to_app(TTA_PARAMS),
    "permission_denied",
    "type_text_to_app: target app (pid 4242) could not be brought to the foreground, so nothing was sent. action_sent=false. Target an element instead so the action goes through accessibility on a background app, or re-observe the app and retry.",
    { action_sent: false, expected_pid: APP.pid, reason: "activation_failed" },
  );
  console.log("G5b app-scoped 激活失败诊断逐字文案 OK");
}

// ===================================================================================
// G6 —— hit-test 并发指引（@85360793，uia_ reason 族）
// ===================================================================================
async function clickWithHitResult(hitResult) {
  const handlers = makeHandlers({
    adapter: makeAdapter({
      hitTestInvokeAtPointAsync: async () => ({ ok: false, result: hitResult }),
    }),
    axSource: makeAxSource(),
  });
  return handlers.click(CLICK_PRECISE);
}

{
  // G6a：hit-test timeout → uia_timeout + action_sent=true（possibly）。
  await rejectsVerbatim(
    clickWithHitResult("timeout"),
    "element_unavailable",
    "click: the accessibility hit-test could not complete (timeout); action_sent=possibly. Retry after the current job settles or re-observe the target.",
    { action_sent: true, reason: "uia_timeout" },
  );
  console.log("G6a uia_timeout 并发指引逐字文案 OK");
}

{
  // G6b：hit-test possibly_sent → action_sent=true。
  await rejectsVerbatim(
    clickWithHitResult("possibly_sent"),
    "element_unavailable",
    "click: the accessibility hit-test could not complete (possibly_sent); action_sent=possibly. Retry after the current job settles or re-observe the target.",
    { action_sent: true, reason: "uia_possibly_sent" },
  );
  console.log("G6b uia_possibly_sent 并发指引逐字文案 OK");
}

{
  // G6c：hit-test 其他失败态 → action_sent=false。
  await rejectsVerbatim(
    clickWithHitResult("busy"),
    "element_unavailable",
    "click: the accessibility hit-test could not complete (busy); action_sent=false. Retry after the current job settles or re-observe the target.",
    { action_sent: false, reason: "uia_busy" },
  );
  console.log("G6c uia_busy 并发指引逐字文案 OK");
}

{
  // G6d：hit-test invoked → 命中即返回（不切前台）。
  let foregroundUsed = false;
  const handlers = makeHandlers({
    adapter: makeAdapter({
      hitTestInvokeAtPointAsync: async () => ({ ok: true, result: "invoked" }),
      activateWindow: () => {
        foregroundUsed = true;
        return true;
      },
    }),
    axSource: makeAxSource(),
  });
  const result = await handlers.click(CLICK_PRECISE);
  assert.equal(result.method, "click");
  assert.ok(!foregroundUsed, "invoked hit-test must not escalate to foreground");
  console.log("G6d hit-test invoked 不切前台 OK");
}

// ===================================================================================
// G2 配套 —— assertExpectedPidIsFrontmost active pid 去重（@85381190 区）
// ===================================================================================
{
  // 同一 pid 多行 active（多 surface 上报）→ 去重后视为单一前台，不再误拒。
  const axSource = makeAxSource();
  axSource.listApplications = async () => [
    { ...APP, active: true },
    { ...APP, active: true },
  ];
  const handlers = makeHandlers({
    adapter: makeAdapter({ typeTextGlobalAsync: async () => ({ ok: true, sent: 2, total: 2 }) }),
    axSource,
  });
  await handlers.type_text_to_app({ ...TTA_PARAMS, text: "ab" });
  console.log("G2 配套 frontmost active pid 去重 OK");
}

console.log("ALL R8 input guard checks passed");
