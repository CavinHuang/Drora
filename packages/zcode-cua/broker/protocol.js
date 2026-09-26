// oxlint-disable-file
// 还原自发行 bundle 的 broker 协议侧公共实现。
// 协议方法表 / 只读表与 helper 运行时（packages/zcode-cua-helper
// src/broker/types.ts）保持镜像；任何一侧调整协议面必须同步另一侧。
import { oHe } from "./server/cua-spec.js";
export function isBrokerMethod(method) {
    return oHe.has(method);
}
export function isReadOnlyBrokerMethod(method) {
    return READ_ONLY_BROKER_METHODS.has(method);
}
const READ_ONLY_BROKER_METHODS = new Set([
    "broker_info",
    "controller_status",
    // Public MCP contract: request_access is a status snapshot only. It must use
    // prompt=false and must not warm capture or Automation permissions; the
    // trusted Host UI owns all permission-request gestures.
    "request_access",
    "input_permission_status",
    "screen_capture_status",
    // screen_capture_probe 抓一小张真实截图确认 WindowServer 已放行像素——纯观测、无用户可见副作用，
    // 因此允许软超时（探针挂住即判未就绪，不该拖住整个 readiness 组装）。
    "screen_capture_probe",
    "supports_accessibility",
    "permission_status",
    "list_applications",
    "application_info",
    "list_windows",
    // capture_app is observable by every Helper. Auto-PiP is separately gated by
    // the local controller lease before it reaches native UI, so observers retain
    // read-only coexistence without gaining a visual side effect.
    "capture_app",
    "element_at_point",
    "read_element",
    "is_focus_steal_prevented",
    "pip_is_running",
    // 只清一个内部抑制标志，不启动/停止任何面板，用户桌面上没有任何可见变化。
    // 归入只读的实际作用是别让它走 controller 仲裁：它在 MCP 会话启动期发出，
    // 那时别的对话可能正持有 lease，被 controller_busy 挡住会让新对话继续沿用
    // 上一个对话的 dismissed 状态——正是本方法要修的问题。
    "pip_clear_dismissed",
    "pip_session_handshake",
]);
// 注：这是 Drora 内部配对协议的还原稿，不是官方 helper broker 协议的镜像——
// 官方契约（windows-helper.js @14847-14927）要求 id 为非负安全整数、响应必带 id 回显、
// 非法请求回 {id:0, ok:false, error:{code:"invalid_request"}} 并对未认证连接
// closeAfterWrite；此处保持既有宽松形态，消费方仅限本仓内部配对链路。
/** 解析一行 socket 请求；非法输入返回 undefined（宿主侧静默丢弃）。 */
export function parseRequestLine(line) {
    if (typeof line !== "string" || line.trim().length === 0)
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(line);
    }
    catch {
        return undefined;
    }
    if (typeof parsed !== "object" || parsed === null)
        return undefined;
    const record = parsed;
    if (typeof record.method !== "string" || record.method.length === 0)
        return undefined;
    return {
        ...(record.id === undefined ? {} : { id: record.id }),
        method: record.method,
        ...(record.params === undefined ? {} : { params: record.params }),
    };
}
export function okResponse(result, id) {
    return { ok: true, result: result ?? null };
}
export function errorResponse(message, options) {
    return {
        ok: false,
        ...(options?.id !== undefined ? { id: options.id } : {}),
        error: { code: options?.code ?? "internal", message },
    };
}
export function errorResponseFromException(error) {
    const code = typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
        ? error.code
        : "internal";
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message, { code });
}
export function serializeResponse(response) {
    return `${JSON.stringify(response)}\n`;
}
/** 按 backend 的方法表分发请求；缺方法 / handler 抛错都折成 error envelope。 */
export async function dispatchRequest(backend, request) {
    if (!isBrokerMethod(request.method)) {
        return errorResponse(`unknown broker method: ${request.method}`, { code: "method_not_found" });
    }
    const handler = backend[request.method];
    if (typeof handler !== "function") {
        return errorResponse(`broker backend does not implement: ${request.method}`, {
            code: "method_not_found",
        });
    }
    try {
        return okResponse(await handler(request.params));
    }
    catch (error) {
        return errorResponseFromException(error);
    }
}
export async function handleRequestLine(backend, line) {
    const request = parseRequestLine(line);
    if (!request)
        return undefined;
    return dispatchRequest(backend, request);
}
