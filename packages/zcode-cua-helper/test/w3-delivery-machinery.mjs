#!/usr/bin/env node
// W3 投递机械还原回归（官方 0.6.5 win32 entry，native/reverse/reference/
// win32-0.6.5/dist/windows-helper.js）。官方证据锚（行号）：
//   封套与读回裁决      :21534-21595（windowsDeliveryReceipt / windowsValueReadback）
//   dispatchWindowsClick :23828-23978 / postMessageLevel :23979-24045
//   后台投递族          :25127-25576（insertion / keyed / scroll / drag）
//   appendResolvedAppRef :24373-24412（dispatch_surface 回执）
//   click 调用点        :26738-26883（lane 内重验 / imprecise_target 族 / 物理门禁）
//   type_text 调用点    :26158-26273 / press_key 调用点 :26410-26447
//   scroll 调用点       :27071-27140 / drag 调用点 :27252-27335
//   win32 六方法后置包装 :27461-27485
// 运行：node test/w3-delivery-machinery.mjs（需先 tsc -p tsconfig.json 产出 dist）。
// fake native 双态：态A = 缺 win additive ABI（旧 addon，能力缺失降级）；态B = ABI
// 齐备（后台 postMessage/XAML 加速器/读回链全通）。只断言 JS 层语义，不伪造原生
// 行为结论。
import { strict as assert } from "node:assert";
import { appendAttempt, finalizeDelivery } from "../dist/broker/server/windowsDeliveryReceipt.js";
import {
  classifyInsertionReadback,
  classifyReplacementReadback,
  applyAxEchoSurfaceTrust,
} from "../dist/broker/server/windowsValueReadback.js";
import {
  instrumentWindowsOperationNative,
  runWindowsOperationRequest,
  currentWindowsOperationContext,
} from "../dist/native/windows-operation-request.js";
import { createElectronInputHandlers } from "../dist/broker/server/electronInputHandlers.js";

const APP = { pid: 4242, bundle_id: "com.example.app", name: "Example", active: true };

function makeAxSource({ windows = null, focusOutcome = null } = {}) {
  const source = {
    applicationInfo: async () => ({ ...APP }),
    listApplications: async () => [{ ...APP }],
  };
  if (windows !== null) source.listWindows = async () => windows;
  if (focusOutcome !== null) source.elementFocus = async () => focusOutcome;
  return source;
}

function makeAdapter(overrides = {}) {
  return {
    pressKeyGlobal: () => true,
    typeTextGlobal: () => true,
    clickAtPoint: () => true,
    clickAtPointAsync: async () => true,
    moveTo: () => true,
    scrollAt: () => true,
    drag: async () => true,
    activateWindow: () => true,
    getCursorScreenPoint: () => ({ x: 10, y: 20 }),
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
// W3-U —— 封套单元（:21534-21595）
// ===================================================================================
{
  // U1：appendAttempt 白手起家 → {path, effect: unverifiable, attempts, escalated:false}。
  const receipt = appendAttempt(null, { path: "post_message", dispatch_status: "not_sent", reason: "entry" });
  assert.deepEqual(receipt, {
    path: "post_message",
    effect: "unverifiable",
    attempts: [{ path: "post_message", dispatch_status: "not_sent", reason: "entry" }],
    escalated: false,
  });
  // U2：finalizeDelivery 取最后一个 sent/possibly_sent 的 path；前台升级 =
  // 前台 sent 且此前后台尝试全 not_sent。
  let d = appendAttempt(null, { path: "post_message", dispatch_status: "not_sent", reason: "capability_unavailable" });
  d = appendAttempt(d, { path: "foreground_send_input", dispatch_status: "sent" });
  const escalated = finalizeDelivery(d);
  assert.equal(escalated.path, "foreground_send_input");
  assert.equal(escalated.escalated, true);
  // U3：后台已 sent 后再前台 → escalated=false（并存，非升级）。
  let mixed = appendAttempt(null, { path: "post_message", dispatch_status: "sent" });
  mixed = appendAttempt(mixed, { path: "foreground_send_input", dispatch_status: "sent" });
  const coexisting = finalizeDelivery(mixed);
  assert.equal(coexisting.path, "foreground_send_input");
  assert.equal(coexisting.escalated, false);
  // U4：全 not_sent → path 不变、escalated=false；null → null。
  const allNotSent = finalizeDelivery(
    appendAttempt(null, { path: "post_message", dispatch_status: "not_sent", reason: "droppable_wpf" }),
  );
  assert.equal(allNotSent.path, "post_message");
  assert.equal(allNotSent.escalated, false);
  assert.equal(finalizeDelivery(null), null);
  // U5：possibly_sent 参与收敛（最后的 possibly_sent 决定 path）。
  let uncertain = appendAttempt(null, { path: "ax", dispatch_status: "not_sent", reason: "xaml_accelerator_entry" });
  uncertain = appendAttempt(uncertain, { path: "post_message", dispatch_status: "possibly_sent", reason: "threw" });
  const uncertainFinal = finalizeDelivery(uncertain);
  assert.equal(uncertainFinal.path, "post_message");
  assert.equal(uncertainFinal.escalated, false);
  console.log("W3-U 封套形状/三值流收敛/升级判定 OK");
}

// ===================================================================================
// W3-R —— 读回裁决单元（:21568-21595）
// ===================================================================================
{
  // R1：插入语义——changed_contains / unchanged / unreadable（全 unverifiable）。
  assert.deepEqual(classifyInsertionReadback(null, "x", "x"), { verify: "unreadable", effect: "unverifiable" });
  assert.deepEqual(classifyInsertionReadback("a", null, "x"), { verify: "unreadable", effect: "unverifiable" });
  assert.deepEqual(classifyInsertionReadback("", "abhello", "ab"), { verify: "changed_contains", effect: "unverifiable" });
  assert.deepEqual(classifyInsertionReadback("same", "same", "ab"), { verify: "unchanged", effect: "unverifiable" });
  // R2：替换语义——confirmed（幂等）/ pending suspected_noop / pending unverifiable / unreadable。
  assert.deepEqual(classifyReplacementReadback("a", null, "a"), { verify: "unreadable", effect: "unverifiable" });
  assert.deepEqual(classifyReplacementReadback("v", "v", "v"), { verify: "confirmed", effect: "confirmed", idempotent: true });
  assert.deepEqual(classifyReplacementReadback("old", "new", "new"), { verify: "confirmed", effect: "confirmed" });
  assert.deepEqual(classifyReplacementReadback("old", "old", "new"), { verify: "pending", effect: "suspected_noop" });
  assert.deepEqual(classifyReplacementReadback("old", "other", "new"), { verify: "pending", effect: "unverifiable" });
  // R3：Chromium 直接宿主 AX-echo 降级——confirmed 才降，其余原样。
  const confirmed = { verify: "confirmed", effect: "confirmed" };
  assert.deepEqual(applyAxEchoSurfaceTrust(confirmed, true), { ...confirmed, effect: "unverifiable", axEchoDemoted: true });
  assert.equal(applyAxEchoSurfaceTrust(confirmed, false), confirmed);
  const pending = { verify: "pending", effect: "unverifiable" };
  assert.equal(applyAxEchoSurfaceTrust(pending, true), pending);
  console.log("W3-R 插入/替换读回 + AX-echo 降级 OK");
}

// ===================================================================================
// W3-C —— click 投递（态A：缺 postMessage ABI → 官方降级链）
// ===================================================================================
const CLICK_PRECISE = {
  point: { x: 10, y: 20 },
  expected_pid: APP.pid,
  expected_bundle_id: APP.bundle_id,
  expected_window_id: 77,
};

{
  // C1（态A）：无 postMessageClickAsync → postMessageLevel 记 capability_unavailable
  // not_sent 后回退前台（dispatchForeground）→ 封套 [pm ns cap_unavail, fg sent]，
  // escalated=true（:23985-23989 + :23883-23887）。
  const handlers = makeHandlers({ adapter: makeAdapter(), axSource: makeAxSource() });
  const result = await handlers.click(CLICK_PRECISE);
  assert.equal(result.method, "click");
  assert.deepEqual(result.delivery, {
    path: "foreground_send_input",
    effect: "unverifiable",
    attempts: [
      { path: "post_message", dispatch_status: "not_sent", reason: "entry" },
      { path: "post_message", dispatch_status: "not_sent", reason: "capability_unavailable" },
      { path: "foreground_send_input", dispatch_status: "sent" },
    ],
    escalated: true,
  });
  console.log("W3-C1 postMessage 能力缺失降级前台 + 封套 OK");
}

{
  // C2（态B）：postMessageClickAsync ok → sent 终态（不切前台），attempts 全 post_message。
  let foregroundActivated = false;
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageClickAsync: async () => ({ ok: true }),
      activateWindow: () => {
        foregroundActivated = true;
        return true;
      },
    }),
    axSource: makeAxSource(),
  });
  const result = await handlers.click(CLICK_PRECISE);
  assert.equal(result.method, "click");
  assert.deepEqual(result.delivery, {
    path: "post_message",
    effect: "unverifiable",
    attempts: [
      { path: "post_message", dispatch_status: "not_sent", reason: "entry" },
      { path: "post_message", dispatch_status: "sent" },
    ],
    escalated: false,
  });
  assert.ok(!foregroundActivated, "background sent must not activate foreground");
  console.log("W3-C2 postMessage sent 终态不切前台 OK");
}

{
  // C3（态B）：possibly_* → possibly_sent + 逐字拒绝（:24021-24032）。
  const handlers = makeHandlers({
    adapter: makeAdapter({ postMessageClickAsync: async () => ({ ok: false, error: "possibly_window_closed" }) }),
    axSource: makeAxSource(),
  });
  await rejectsVerbatim(
    handlers.click(CLICK_PRECISE),
    "element_unavailable",
    "left click possibly landed (possibly_window_closed); do not replay. Re-observe before retrying.",
    {
      action_sent: true,
      reason: "possibly_window_closed",
      // 官方 :23969-23977：catch 内 BrokerError 重附完整运行中 delivery（含 entry）。
      delivery: {
        path: "post_message",
        effect: "unverifiable",
        attempts: [
          { path: "post_message", dispatch_status: "not_sent", reason: "entry" },
          { path: "post_message", dispatch_status: "possibly_sent", reason: "possibly_window_closed" },
        ],
        escalated: false,
      },
    },
  );
  console.log("W3-C3 possibly_* 逐字拒绝 + 封套 OK");
}

{
  // C4（态B）：worker_failed → unknown 模糊态 possibly_sent；refused 类 → not_sent
  // 逐字拒绝 + action_sent=false（:23998-24015）。
  const workerFailed = makeHandlers({
    adapter: makeAdapter({ postMessageClickAsync: async () => ({ ok: false, error: "worker_failed" }) }),
    axSource: makeAxSource(),
  });
  await rejectsVerbatim(
    workerFailed.click(CLICK_PRECISE),
    "element_unavailable",
    "background delivery was refused: worker_failed. action_sent=possibly.",
    {
      action_sent: true,
      reason: "worker_failed",
      // 同 C3：catch 重附运行中 delivery（entry + worker_failed possibly_sent）。
      delivery: {
        path: "post_message",
        effect: "unverifiable",
        attempts: [
          { path: "post_message", dispatch_status: "not_sent", reason: "entry" },
          { path: "post_message", dispatch_status: "possibly_sent", reason: "worker_failed" },
        ],
        escalated: false,
      },
    },
  );
  const refused = makeHandlers({
    adapter: makeAdapter({ postMessageClickAsync: async () => ({ ok: false, error: "not_allowed" }) }),
    axSource: makeAxSource(),
  });
  await rejectsVerbatim(
    refused.click(CLICK_PRECISE),
    "element_unavailable",
    "background delivery was refused: not_allowed. action_sent=false.",
    { action_sent: false, reason: "not_allowed" },
  );
  console.log("W3-C4 worker_failed/明确拒绝双语义 OK");
}

{
  // C5（态B）：hit-test invoked → ax 终态（不切前台不投递 postMessage）。
  let postUsed = false;
  const handlers = makeHandlers({
    adapter: makeAdapter({
      hitTestInvokeAtPointAsync: async () => ({ ok: true, result: "invoked" }),
      postMessageClickAsync: async () => {
        postUsed = true;
        return { ok: true };
      },
    }),
    axSource: makeAxSource(),
  });
  const result = await handlers.click(CLICK_PRECISE);
  assert.deepEqual(result.delivery, {
    path: "ax",
    effect: "unverifiable",
    attempts: [
      { path: "ax", dispatch_status: "not_sent", reason: "hit_test_entry" },
      { path: "ax", dispatch_status: "sent" },
    ],
    escalated: false,
  });
  assert.ok(!postUsed, "invoked hit-test must not fall through to postMessage");
  console.log("W3-C5 hit-test ax 终态 OK");
}

{
  // C6：非精确目标前台点击 → imprecise_target_pid_only / imprecise_target 封套
  //（:26767-26780）。
  const pidOnly = makeHandlers({ adapter: makeAdapter(), axSource: makeAxSource() });
  const pidResult = await pidOnly.click({
    point: { x: 10, y: 20 },
    expected_pid: APP.pid,
    expected_bundle_id: APP.bundle_id,
  });
  assert.equal(pidResult.method, "click");
  assert.deepEqual(pidResult.delivery, {
    path: "foreground_send_input",
    effect: "unverifiable",
    attempts: [{ path: "foreground_send_input", dispatch_status: "sent", reason: "imprecise_target_pid_only" }],
    escalated: false,
  });
  const noTarget = makeHandlers({ adapter: makeAdapter(), axSource: makeAxSource() });
  const noTargetResult = await noTarget.click({ point: { x: 10, y: 20 } });
  assert.deepEqual(noTargetResult.delivery, {
    path: "foreground_send_input",
    effect: "unverifiable",
    attempts: [{ path: "foreground_send_input", dispatch_status: "sent", reason: "imprecise_target" }],
    escalated: false,
  });
  console.log("W3-C6 imprecise_target(_pid_only) 封套 OK");
}

// ===================================================================================
// W3-K —— press_key_to_app 后台键梯（:26410-26447 / :25267-25415）
// ===================================================================================
const KEY_PARAMS = {
  text: "ctrl+s",
  app_ref: { pid: APP.pid, bundle_id: APP.bundle_id, window_id: 77 },
};

{
  // K1（态B）：XAML 宿主 + invokeAcceleratorAsync invoked → ax/accelerator:invoked
  // 终态 window_event。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageKeyAsync: async () => ({ ok: true }),
      invokeAcceleratorAsync: async () => ({ result: "invoked" }),
      classifyPostMessageDelivery: () => ({ delivery: "deliverable", host: "winui3_exempt" }),
    }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
  });
  const result = await handlers.press_key_to_app(KEY_PARAMS);
  assert.equal(result.method, "window_event");
  assert.deepEqual(result.delivery, {
    path: "ax",
    effect: "unverifiable",
    attempts: [
      { path: "ax", dispatch_status: "not_sent", reason: "xaml_accelerator_entry" },
      { path: "ax", dispatch_status: "sent", reason: "accelerator:invoked" },
    ],
    escalated: false,
  });
  console.log("W3-K1 XAML accelerator invoked 终态 OK");
}

{
  // K2（态B）：XAML 宿主 + accelerator miss → accelerator_missed 记 not_sent +
  // droppable_xaml_input not_sent → 全 not_sent 退前台 → foreground_event 并轨封套
  //（escalated=true）。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageKeyAsync: async () => ({ ok: true }),
      invokeAcceleratorAsync: async () => ({ result: "miss" }),
      classifyPostMessageDelivery: () => ({ delivery: "deliverable", host: "winui3_exempt" }),
    }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
  });
  const result = await handlers.press_key_to_app(KEY_PARAMS);
  assert.equal(result.method, "foreground_event");
  assert.deepEqual(result.delivery.attempts, [
    { path: "ax", dispatch_status: "not_sent", reason: "xaml_accelerator_entry" },
    { path: "ax", dispatch_status: "not_sent", reason: "accelerator_missed" },
    { path: "post_message", dispatch_status: "not_sent", reason: "droppable_xaml_input" },
    { path: "foreground_send_input", dispatch_status: "sent" },
  ]);
  assert.equal(result.delivery.path, "foreground_send_input");
  assert.equal(result.delivery.escalated, true);
  console.log("W3-K2 accelerator_missed + droppable_xaml_input 退前台 OK");
}

{
  // K3（态B）：非 XAML 宿主组合键 → chord_key_state_unreachable not_sent 退前台。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageKeyAsync: async () => ({ ok: true }),
      classifyPostMessageDelivery: () => ({ delivery: "deliverable", host: "chromium" }),
    }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
  });
  const result = await handlers.press_key_to_app(KEY_PARAMS);
  assert.equal(result.method, "foreground_event");
  assert.deepEqual(result.delivery.attempts, [
    { path: "post_message", dispatch_status: "not_sent", reason: "chord_key_state_unreachable" },
    { path: "foreground_send_input", dispatch_status: "sent" },
  ]);
  assert.equal(result.delivery.escalated, true);
  console.log("W3-K3 组合键 chord 不可达退前台 OK");
}

{
  // K4（态B）：postKey 抛异常 → delivery_unknown 逐字拒绝（:25372-25383）。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageKeyAsync: async () => {
        throw new Error("native blew up");
      },
      classifyPostMessageDelivery: () => ({ delivery: "deliverable", host: "chromium" }),
    }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
  });
  await rejectsVerbatim(
    handlers.press_key_to_app({ ...KEY_PARAMS, text: "enter" }),
    "element_unavailable",
    "press_key_to_app: background key delivery is unknown; re-observe before retrying.",
    {
      action_sent: true,
      reason: "delivery_unknown",
      delivery: {
        path: "post_message",
        effect: "unverifiable",
        attempts: [
          { path: "post_message", dispatch_status: "not_sent", reason: "entry" },
          { path: "post_message", dispatch_status: "possibly_sent", reason: "threw" },
        ],
        escalated: false,
      },
    },
  );
  console.log("W3-K4 后台键 delivery_unknown 逐字拒绝 OK");
}

{
  // K5（态A）：无 postMessageKeyAsync → 后台 null → 纯前台封套（无后台并轨）。
  const handlers = makeHandlers({
    adapter: makeAdapter(),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
  });
  const result = await handlers.press_key_to_app({ ...KEY_PARAMS, text: "enter" });
  assert.equal(result.method, "foreground_event");
  assert.deepEqual(result.delivery, {
    path: "foreground_send_input",
    effect: "unverifiable",
    attempts: [{ path: "foreground_send_input", dispatch_status: "sent" }],
    escalated: false,
  });
  console.log("W3-K5 后台键能力缺失纯前台封套 OK");
}

// ===================================================================================
// W3-S —— scroll 后台滚动（:27071-27140 / :25416-25495）
// ===================================================================================
const SCROLL_PARAMS = {
  point: { x: 10, y: 20 },
  direction: "down",
  amount: 3,
  app_ref: { pid: APP.pid, bundle_id: APP.bundle_id, window_id: 77 },
};

{
  // S1（态B）：wpf 宿主 → postMessageScrollAsync ok → mouse_scroll sent 终态。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageScrollAsync: async () => ({ ok: true }),
      classifyPostMessageDelivery: () => ({ delivery: "deliverable", host: "wpf" }),
    }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
  });
  const result = await handlers.scroll(SCROLL_PARAMS);
  assert.equal(result.method, "window_event");
  assert.deepEqual(result.delivery, {
    path: "post_message",
    effect: "unverifiable",
    attempts: [
      { path: "post_message", dispatch_status: "not_sent", reason: "entry" },
      { path: "post_message", dispatch_status: "sent" },
    ],
    escalated: false,
  });
  console.log("W3-S1 mouse_scroll 后台 sent 终态 OK");
}

{
  // S2（态B）：非 wpf/winui3 宿主 → scroll_unreachable_<host> not_sent 退前台并轨。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageScrollAsync: async () => ({ ok: true }),
      classifyPostMessageDelivery: () => ({ delivery: "deliverable", host: "chromium" }),
    }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
  });
  const result = await handlers.scroll(SCROLL_PARAMS);
  assert.equal(result.method, "foreground_event");
  assert.deepEqual(result.delivery.attempts, [
    { path: "post_message", dispatch_status: "not_sent", reason: "scroll_unreachable_chromium" },
    { path: "foreground_send_input", dispatch_status: "sent" },
  ]);
  assert.equal(result.delivery.escalated, true);
  console.log("W3-S2 scroll_unreachable 退前台并轨 OK");
}

// ===================================================================================
// W3-D —— drag 后台拖拽（:27252-27335 / :25496-25576）
// ===================================================================================
const DRAG_PARAMS = {
  start: { x: 1, y: 2 },
  end: { x: 3, y: 4 },
  app_ref: { pid: APP.pid, bundle_id: APP.bundle_id, window_id: 77 },
};

{
  // D1（态B）：strategy=event → 跳过后台，前台封套 reason=explicit_event_strategy。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageDragAsync: async () => {
        throw new Error("must not run with strategy=event");
      },
    }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
  });
  const result = await handlers.drag({ ...DRAG_PARAMS, strategy: "event" });
  assert.equal(result.method, "foreground_event");
  assert.deepEqual(result.delivery, {
    path: "foreground_send_input",
    effect: "unverifiable",
    attempts: [{ path: "foreground_send_input", dispatch_status: "sent", reason: "explicit_event_strategy" }],
    escalated: false,
  });
  // 后置包装补发投递面（:27461-27470）。
  assert.deepEqual(result.resolved_app_ref, { pid: APP.pid, bundle_id: APP.bundle_id, window_id: 77 });
  assert.deepEqual(result.dispatch_surface, {
    owner_pid: APP.pid,
    owner_bundle_id: APP.bundle_id,
    actual_window_id: 77,
  });
  console.log("W3-D1 explicit_event_strategy + dispatch_surface 回执 OK");
}

{
  // D2（态B）：dropped 宿主 → droppable_* not_sent 退前台（mouse_move 矩阵）。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageDragAsync: async () => ({ ok: true }),
      classifyPostMessageDelivery: () => ({ delivery: "dropped", host: "vcl" }),
    }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
  });
  const result = await handlers.drag(DRAG_PARAMS);
  assert.equal(result.method, "foreground_event");
  assert.deepEqual(result.delivery.attempts, [
    { path: "post_message", dispatch_status: "not_sent", reason: "droppable_vcl" },
    { path: "foreground_send_input", dispatch_status: "sent" },
  ]);
  assert.equal(result.delivery.escalated, true);
  console.log("W3-D2 mouse_move dropped 退前台并轨 OK");
}

// ===================================================================================
// W3-T —— type_text_to_app 元素级后台插入（:26158-26273 / :25127-26266）
// ===================================================================================
{
  // T1（态B）：全读回链 → changed_contains 裁决入封套（window_event 终态）。
  const released = [];
  const reads = [];
  const axSource = makeAxSource({ windows: [{ window_id: 77, focused: true }] });
  axSource.winAxElementFromToken = (ref) => ({ ok: true, element: 42 });
  axSource.winAxElementRelease = (element) => {
    released.push(element);
  };
  axSource.elementWindowId = async () => 77;
  axSource.elementValueReadAsync = async () => {
    reads.push(1);
    // 第一次 before 读（宿主窗），第二次 after 读（请求窗）——after 含 "ab"。
    return reads.length === 1 ? { ok: true, value: "" } : { ok: true, value: "abtyped" };
  };
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageCharAsync: async () => ({ ok: true }),
      classifyPostMessageDelivery: () => ({ delivery: "deliverable", host: "chromium" }),
    }),
    axSource,
    options: { windowsElementReadback: { registry: { refFor: () => "native-token-1" } } },
  });
  const result = await handlers.type_text_to_app({
    text: "ab",
    element_native: "native-token-1",
    app_ref: { pid: APP.pid, bundle_id: APP.bundle_id, window_id: 77 },
  });
  assert.equal(result.method, "window_event");
  assert.deepEqual(result.delivery, {
    path: "post_message",
    effect: "unverifiable",
    attempts: [
      { path: "post_message", dispatch_status: "not_sent", reason: "entry" },
      { path: "post_message", dispatch_status: "sent" },
      { path: "post_message", dispatch_status: "sent", reason: "readback_changed_contains" },
    ],
    escalated: false,
    readback: { verify: "changed_contains" },
  });
  assert.deepEqual(released, [42], "held strong ref must be released exactly once");
  console.log("W3-T1 元素插入 changed_contains 读回封套 OK");
}

{
  // T2（态B）：插入 threw → delivery_unknown 逐字拒绝（:25179-25191）。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageCharAsync: async () => {
        throw new Error("worker died");
      },
      classifyPostMessageDelivery: () => ({ delivery: "deliverable", host: "chromium" }),
    }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
    options: { windowsElementReadback: { registry: { refFor: () => "native-token-1" } } },
  });
  await rejectsVerbatim(
    handlers.type_text_to_app({
      text: "ab",
      element_native: "native-token-1",
      app_ref: { pid: APP.pid, bundle_id: APP.bundle_id, window_id: 77 },
    }),
    "element_unavailable",
    "type_text_to_app: background insertion delivery is unknown; re-observe before retrying.",
    { action_sent: true, reason: "delivery_unknown" },
  );
  console.log("W3-T2 插入 delivery_unknown 逐字拒绝 OK");
}

{
  // T3（态B）：text_input 矩阵 dropped → droppable_<host> 全 not_sent → 退前台文本
  // 注入（window_event 不终态）→ foreground_event 并轨封套。
  const handlers = makeHandlers({
    adapter: makeAdapter({
      postMessageCharAsync: async () => ({ ok: true }),
      classifyPostMessageDelivery: () => ({ delivery: "dropped", host: "winforms" }),
      typeTextGlobalAsync: async () => ({ ok: true, sent: 2, total: 2 }),
    }),
    axSource: makeAxSource({ windows: [{ window_id: 77, focused: true }] }),
  });
  const result = await handlers.type_text_to_app({
    text: "ab",
    element_native: "native-token-1",
    app_ref: { pid: APP.pid, bundle_id: APP.bundle_id, window_id: 77 },
  });
  assert.equal(result.method, "foreground_event");
  assert.deepEqual(result.delivery.attempts, [
    { path: "post_message", dispatch_status: "not_sent", reason: "droppable_winforms" },
    { path: "foreground_send_input", dispatch_status: "sent" },
  ]);
  assert.equal(result.delivery.escalated, true);
  console.log("W3-T3 text_input dropped 退前台文本注入并轨 OK");
}

// ===================================================================================
// W3-O —— 操作请求域（:20486 dispatchRequest + :20139-20409 instrument）
// ===================================================================================
{
  // O1：无 windows_operation_context → 原样执行、scope 不可见。
  const plain = await runWindowsOperationRequest("1", "click", { point: { x: 1, y: 2 } }, async () => {
    assert.equal(currentWindowsOperationContext(), undefined);
    return { ok: true };
  });
  assert.deepEqual(plain, { ok: true });
  // O2：带 context → scope 可见；right-click 标记 expected=context_menu。
  const withContext = await runWindowsOperationRequest(
    "2",
    "click",
    { button: "right", windows_operation_context: { session_id: "s1", root_window_id: 7 } },
    async () => {
      const context = currentWindowsOperationContext();
      assert.equal(context.session_id, "s1");
      assert.equal(context.root_window_id, 7);
      return { ok: true };
    },
  );
  assert.deepEqual(withContext, { ok: true });
  console.log("W3-O 操作域 scope 休眠/激活 OK");
}

{
  // O3：instrument 守卫——independent_root 的物理输入无 operation association 覆盖
  // → fail-closed 拒绝（:20233-20243）；无 scope 时原样执行。
  const native = { clickAtPoint: () => true };
  const wrapped = instrumentWindowsOperationNative(native);
  assert.equal(wrapped.clickAtPoint(1, 2, "left", 1, null, 4242, 77), true, "no scope → passthrough");
  await rejectsVerbatim(
    runWindowsOperationRequest(
      "3",
      "click",
      {
        point: { x: 1, y: 2 },
        windows_operation_context: { session_id: "s1", root_window_id: 7, independent_root: true },
      },
      async () => wrapped.clickAtPoint(1, 2, "left", 1, null, 4242, 77),
    ),
    "element_unavailable",
    "The selected independent Windows surface has no operation association; physical input is forbidden. action_sent=false.",
    { action_sent: false, reason: "independent_surface_requires_association" },
  );
  console.log("W3-O3 independent_root 物理输入门禁 OK");
}

console.log("W3 delivery machinery: all assertions passed");
