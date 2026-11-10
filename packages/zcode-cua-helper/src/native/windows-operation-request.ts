/* oxlint-disable eslint(max-lines) -- 还原自官方发行 bundle 的单模块源码，保持 producer 仓库的原始文件边界，不拆分。 */
// 还原自发行 bundle（官方 0.6.5 win32 entry :20003-20006/:20139-20409，
// src/native/windows-operation-request.ts）：win32 操作请求域（AsyncLocalStorage）。
// - runWindowsOperationRequest：broker 每个请求包进请求 scope；params 带
//   windows_operation_context（session_id + root_window_id）时记录 context/call_id/
//   method/target；right-click / apps|shift+f10 预期 context_menu。收尾把 scope 内
//   采集的 evidence（windows_operation_evidence）与 maintained（关联链推进结果，
//   windows_operation_associations）附到结果上。无 context 时原样执行。
// - instrumentWindowsOperationNative：win32 专用 native Proxy（nodeAutomationAdapter
//   :31280 只在 win32 装配）。mutations 集内的方法被包裹：
//   ①independent_root 的物理输入必须有 operation association 覆盖（否则
//     independent_surface_requires_association 拒绝）；
//   ②operation_surface_ids 内的 surface 派发前重验关联链（surface_replaced 拒绝）；
//   ③expected/pending 时读 before/after 场景产出 evidence，关联链经
//     advanceWindowsMenuAssociation 推进为 maintained；
//   ④菜单宿主 clickAtPoint(Async) 前置前台校验（menu_host_not_foreground）并改写
//     args[7] 带宿主身份；
//   ⑤frameWindowContext 对关联链内的菜单窗附加 operation_foreground_host_window_id。
// scene 读回（windowsOperationScene/enumerateSurfacesForFrame/captureApp/frameWindowContext）
// 任一 ABI 缺失时对应机械按官方同款降级（readWindowsOperationScene 返回 null →
// 不采集 evidence；instrument 的 mutation 守卫仅对 context 存在时生效）。mac 编译
// 形态下无 windows_operation_context 请求参数，整条链休眠，与官方对齐。
import { AsyncLocalStorage } from "node:async_hooks";
import { elementUnavailable } from "../broker/types.js";
import {
  advanceWindowsMenuAssociation,
  revalidateWindowsMenuAssociation,
  revalidateWindowsMenuFacts,
} from "../lib/windows-operation-association.js";

var requests = new AsyncLocalStorage<any>();

export function currentWindowsOperationContext() {
  return requests.getStore()?.context;
}

export function expectWindowsMenu(expected) {
  const request = requests.getStore();
  if (request) request.expected = expected;
}

export async function runWindowsOperationRequest(callId, method, params, work) {
  // 与官方一致直接访问 params.windows_operation_context（broker 侧恒传对象），
  // 不加 ?. 防御：官方此处对 undefined params 即抛 TypeError。
  const context = params.windows_operation_context;
  if (!context?.session_id || !Number.isSafeInteger(context.root_window_id) || context.root_window_id <= 0)
    return work();
  // any：scope 上动态挂 evidence/maintained/currentProofs（instrument 采集字段）。
  const scope: any = {
    context,
    call_id: callId,
    method,
    expected: null,
    target: {
      ...(typeof params.native === "string" ? { native: params.native } : {}),
      ...params.point ? { point: params.point } : {},
      ...(typeof params.key === "string" ? { key: params.key, window_id: context.root_window_id } : {}),
    },
  };
  if (method === "click" && params.button === "right") scope.expected = "context_menu";
  if (/press_key/.test(method) && /^(apps|shift\+f10)$/i.test(String(params.key)))
    scope.expected = "context_menu";
  return requests.run(scope, async () => {
    const result = await work();
    return (scope.evidence || scope.maintained) && result && typeof result === "object"
      ? {
          ...result,
          ...(scope.evidence ? { windows_operation_evidence: scope.evidence } : {}),
          ...(scope.maintained ? { windows_operation_associations: scope.maintained } : {}),
        }
      : result;
  });
}

var physical = new Set([
  "clickAtPoint",
  "clickAtPointAsync",
  "moveTo",
  "scrollAt",
  "drag",
  "mouseDown",
  "mouseUp",
  "typeTextGlobal",
  "typeTextGlobalAsync",
  "pressKeyGlobal",
  "keyDownGlobal",
  "keyUpGlobal",
  "holdKeyGlobal",
  "holdKeyGlobalAsync",
]);

var mutations = new Set([
  ...physical,
  "elementPatternCallAsync",
  "hitTestInvokeAtPointAsync",
  "postMessageClickAsync",
  "postMessageCharAsync",
  "postMessageKeyAsync",
  "postMessageScrollAsync",
  "postMessageDragAsync",
  "invokeAcceleratorAsync",
  "setValueReadbackAsync",
  "performAction",
  "setValue",
  "setFocused",
  "selectText",
  "scrollElement",
]);

var referenceMutations = new Set(["performAction", "setValue", "setFocused", "selectText", "scrollElement"]);

var wrappers = new WeakMap();

export function readWindowsOperationScene(native, root, host, element?, point?) {
  const initial = native.windowsOperationScene?.(root, host, element, point?.x, point?.y);
  if (!initial) return null;
  const report = native.enumerateSurfacesForFrame?.(initial.root.pid, root);
  const scene = native.enumerateSurfacesForFrame
    ? native.windowsOperationScene?.(root, initial.host.window_id)
    : initial;
  if (!scene) return null;
  for (const window of scene.windows) {
    if (
      report?.filtered?.some(
        (item) =>
          item.window_id === window.window_id && /^(decorative:|system_class$)/.test(item.reason),
      )
    )
      window.decorative = true;
  }
  return scene;
}

export function readWindowsMenuContent(native, pid, id) {
  const tree = native.captureApp(pid, id);
  if (tree?.window.window_id !== id) return null;
  if (
    native.frameWindowContext?.(id)?.is_menu !== true &&
    !tree.elements.some((item) => /^Menu(Popup|Bar)?$/.test(item.role))
  )
    return null;
  return {
    window_id: id,
    role: "Menu",
    items: tree.elements.map((item) => ({
      role: item.role,
      title: item.title ?? "",
      actions: item.actions ?? [],
    })),
  };
}

export function verifyWindowsOperationChain(native, proofs, sessionId) {
  const verified = [];
  for (const proof of proofs) {
    const current = readWindowsOperationScene(native, proof.root.window_id, proof.host.window_id);
    if (!current || !revalidateWindowsMenuFacts(proof, current, sessionId)) return null;
    const content = readWindowsMenuContent(native, proof.candidate.pid, proof.candidate.window_id);
    const afterRead = readWindowsOperationScene(native, proof.root.window_id, proof.host.window_id);
    if (!afterRead || !content || !revalidateWindowsMenuAssociation(proof, afterRead, content, sessionId))
      return null;
    verified.push({ association: proof, content });
  }
  return verified;
}

export function instrumentWindowsOperationNative(native) {
  const existing = wrappers.get(native);
  if (existing) return existing;
  const wrapped = new Proxy(native, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === "frameWindowContext" && typeof value === "function")
        return (id) => {
          const facts: any = Reflect.apply(value, target, [id]);
          const request = requests.getStore();
          const proofs = request?.currentProofs ?? request?.context.associations ?? [];
          if (!facts || !request || !proofs.some((proof) => proof.candidate.window_id === id))
            return facts;
          const verified = verifyWindowsOperationChain(target, proofs, request.context.session_id);
          const foreground = target.getForegroundRootWindowId?.();
          if (
            verified?.some(({ association: proof }) =>
              [proof.root.window_id, proof.host.root_window_id, ...proof.chain_window_ids].includes(
                foreground ?? 0,
              ),
            )
          )
            return { ...facts, operation_foreground_host_window_id: foreground };
          return facts;
        };
      if (typeof property !== "string" || typeof value !== "function" || !mutations.has(property))
        return value;
      return (...args) => {
        const request = requests.getStore();
        const rootId = request?.context.root_window_id ?? 0;
        const surface =
          property === "elementPatternCallAsync" || property === "setValueReadbackAsync"
            ? args[1]
            : property.startsWith("postMessage") || property === "hitTestInvokeAtPointAsync"
              ? args[0]
              : property === "clickAtPointAsync" || property === "clickAtPoint"
                ? args[6]
                : referenceMutations.has(property) && typeof args[0] === "string"
                  ? target.getWindowId?.(args[0])
                  : void 0;
        if (request?.context.independent_root && physical.has(property)) {
          const proofs = request.currentProofs ?? request.context.associations ?? [];
          const covered = proofs.some(
            (proof) => Number(surface) === proof.candidate.window_id || Number(surface) === proof.root.window_id,
          );
          if (!covered || !verifyWindowsOperationChain(target, proofs, request.context.session_id))
            throw elementUnavailable(
              "The selected independent Windows surface has no operation association; physical input is forbidden. action_sent=false.",
              { action_sent: false, reason: "independent_surface_requires_association" },
            );
        }
        let previous = [];
        if (request && !request.context.independent_root && request.context.operation_surface_ids?.includes(Number(surface))) {
          const root = target.frameWindowContext?.(rootId);
          const staticRelation =
            root && target.enumerateSurfacesForFrame?.(root.pid, rootId)?.surfaces.some((item) => item.window_id === surface);
          if (!staticRelation) {
            const verified = verifyWindowsOperationChain(
              target,
              request.currentProofs ?? request.context.associations ?? [],
              request.context.session_id,
            );
            if (!verified)
              throw elementUnavailable(
                "Windows menu operation association changed before dispatch. action_sent=false.",
                { action_sent: false, reason: "surface_replaced", auto_reresolve: false },
              );
            previous = verified;
            if (!previous.some((item) => item.association.candidate.window_id === surface))
              throw elementUnavailable(
                "Windows menu operation association is no longer available. action_sent=false.",
                { action_sent: false, reason: "surface_replaced", auto_reresolve: false },
              );
          }
        }
        const capture = request && (request.expected || previous.length > 0) && target.windowsOperationScene;
        const before = capture
          ? readWindowsOperationScene(
              target,
              rootId,
              previous[0]?.association.host.window_id ?? rootId,
              previous.length === 0 && property === "elementPatternCallAsync" ? args[0] : void 0,
              previous.length === 0 ? request?.target.point : void 0,
            )
          : null;
        const finish = (result2) => {
          if (request && before) {
            const after = readWindowsOperationScene(target, rootId, before.host.window_id);
            const outcome = result2;
            const uncertain =
              result2 === false ||
              outcome?.result === "possibly_sent" ||
              outcome?.result === "timeout" ||
              outcome?.error?.startsWith("possibly");
            const status = uncertain
              ? "possibly_sent"
              : outcome?.result === "invoked" || outcome?.ok === true || result2 === true
                ? "sent"
                : "not_sent";
            if (after)
              request.evidence = {
                session_id: request.context.session_id,
                session_generation: request.context.session_generation,
                call_id: request.call_id,
                method: request.method,
                expected_menu: request.expected,
                target: {
                  ...request.target,
                  ...(typeof surface === "number" && surface > 0 ? { window_id: surface } : {}),
                },
                dispatch_path: property.startsWith("postMessage")
                  ? "post_message"
                  : physical.has(property)
                    ? "foreground_send_input"
                    : "ax",
                ...(previous.length ? { previous_chain: previous } : {}),
                dispatch_status: status,
                before,
                after,
              };
            if (after && previous.length)
              request.maintained =
                status !== "sent" && !outcome?.pattern_absent
                  ? []
                  : previous
                      .map(({ association }) => {
                        const content = readWindowsMenuContent(
                          target,
                          association.candidate.pid,
                          association.candidate.window_id,
                        );
                        return content && advanceWindowsMenuAssociation(
                          association,
                          before,
                          after,
                          content,
                          request.call_id,
                        );
                      })
                      .filter((proof) => !!proof);
            if (request.maintained) request.currentProofs = request.maintained;
          }
          return result2;
        };
        if (before && previous.length && (property === "clickAtPoint" || property === "clickAtPointAsync")) {
          const foreground = target.getForegroundRootWindowId?.();
          if (
            !previous.some(({ association: proof }) =>
              [proof.root.window_id, proof.host.root_window_id, ...proof.chain_window_ids].includes(
                foreground ?? 0,
              ),
            )
          )
            throw elementUnavailable(
              "The associated menu's host is no longer foreground. action_sent=false.",
              { action_sent: false, reason: "menu_host_not_foreground" },
            );
          const host = foreground ? target.frameWindowContext?.(foreground) : null;
          const menu = before.windows.find((window) => window.window_id === surface);
          if (!host?.tid || !host.process_start_time || !menu?.process_start_time)
            throw elementUnavailable(
              "The associated menu's foreground identity is unavailable. action_sent=false.",
              { action_sent: false },
            );
          args[7] = {
            host_window_id: foreground,
            host_pid: host.pid,
            host_tid: host.tid,
            host_start: host.process_start_time,
            menu_start: menu.process_start_time,
            producer_id: before.producer_id,
            mutation_sequence: before.mutation_sequence,
            external_input_sequence: before.external_input_sequence,
          };
        }
        const result = Reflect.apply(value, target, args);
        return result instanceof Promise ? result.then(finish) : finish(result);
      };
    },
  });
  wrappers.set(native, wrapped);
  wrappers.set(wrapped, wrapped);
  return wrapped;
}
