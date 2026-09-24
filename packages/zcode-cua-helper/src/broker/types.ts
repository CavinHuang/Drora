export var BrokerError = class extends Error {
  code;
  details;
  constructor(code, message, details = {}) {
    super(message);
    this.name = "BrokerError";
    this.code = code;
    this.details = { ...details };
  }
};
export var permissionDenied = (message, details?) =>
  new BrokerError("permission_denied", message, details);
export var notAuthorized = (message, details?) =>
  new BrokerError("not_authorized", message, details);
export var elementUnavailable = (message, details?) =>
  new BrokerError("element_unavailable", message, details);
export var notSettable = (message, details) => new BrokerError("not_settable", message, details);
export var notSelectable = (message, details) =>
  new BrokerError("not_selectable", message, details);
export var actionUnavailable = (message, details) =>
  new BrokerError("action_unavailable", message, details);
export var foregroundRequired = (message, details) =>
  new BrokerError("foreground_required", message, details);
export var launchFailed = (message, details?) => new BrokerError("launch_failed", message, details);
// 原版 63 表 open_application 的参数/身份冲突错误构造器（第十一轮补齐）
export var invalidRequest = (message, details?) =>
  new BrokerError("invalid_request", message, details);
export var controllerBusy = (message, details?) =>
  new BrokerError("controller_busy", message, details);
export var BROKER_METHODS = [
  // 诊断
  "broker_info",
  "controller_status",
  "controller_takeover",
  "controller_stop",
  "request_access",
  "permission_status",
  "input_permission_status",
  "screen_capture_status",
  "screen_capture_probe",
  "supports_accessibility",
  // 观测（对齐原版 mac 3.11.2 的 63 方法表：screen_size/cursor_position/screenshot/
  // list_displays/get_skyshot 为第十轮重放补齐，底稿为官方 SEA payload 未混淆 bundle）
  "screen_size",
  "cursor_position",
  "screenshot",
  "list_displays",
  "list_applications",
  "application_info",
  "list_windows",
  "capture_app",
  "get_skyshot",
  "element_at_point",
  "read_element",
  // 动作（set_display/move_to/mouse_down/mouse_up/type_text_into_current_focus/
  // key_down/key_up/read_clipboard/write_clipboard/open_application/
  // click_element_at_point 为第十轮重放补齐）
  "set_display",
  "move_to",
  "click",
  "scroll",
  "drag",
  "mouse_down",
  "mouse_up",
  "type_text",
  "type_text_into_current_focus",
  "type_text_to_app",
  "press_key",
  "press_key_to_app",
  "hold_key",
  "hold_key_to_app",
  "cancel_input_holds",
  "key_down",
  "key_up",
  "read_clipboard",
  "write_clipboard",
  "open_application",
  "element_press",
  "element_show_menu",
  "element_focus",
  "element_set_value",
  "element_perform_action",
  "element_select_text",
  // v3.1 超集（原版 63 表无此项；宿主 cua-spec 消费，保留为唯一有文档的表偏差，
  // 见 specs/mac-cua-helper-app-alignment.md §六）：
  // Helper 内部一次完成「保存剪贴板 → 写入 → 发粘贴键 → 还原」，取代 host 侧
  // read_clipboard/write_clipboard 拼装的四步，顺带消除还原竞态。
  "paste",
  // Phase 0 不抢焦点:AX hit-test 坐标点击 + preventActivation 门。
  "click_element_at_point",
  "prevent_activation",
  "reenable_activation",
  "is_focus_steal_prevented",
  // Phase 2 实时画中画（policy-on：exact SCWindow + SCScreenshotManager → NSImageView）。
  "pip_start",
  "pip_stop",
  "pip_is_running",
  "pip_clear_dismissed",
  // Producer-owned PiP presentation channel. The broker server applies a
  // dedicated presentation-token gate before dispatching either method.
  "pip_session_handshake",
  "pip_session_event",
  // PiP 真机验收探针（原版 63 表成员；产品代码不调用，仅 scripts/pip_live_* 与
  // test/pip-live-* 消费，由 --pip-live-probe 能力门在 handler 层守卫）。
  // 第十轮按原版表恢复注册；v3.1 曾以协议瘦身删除（49 → 43）。
  "pip_live_probe_start_test_panel",
  "pip_live_probe_window_bounds",
  "pip_live_probe_drag_panel",
  "pip_live_probe_move_test_panel",
  "pip_live_probe_sample_ownership",
  "pip_live_probe_initial_hit_surface",
];
var BROKER_METHOD_SET = new Set(BROKER_METHODS);
export var isBrokerMethod = (method) => BROKER_METHOD_SET.has(method);
var READ_ONLY_BROKER_METHODS = /* @__PURE__ */ new Set([
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
  "screen_size",
  "cursor_position",
  "screenshot",
  "list_displays",
  "list_applications",
  "application_info",
  "list_windows",
  // capture_app is observable by every Helper. Auto-PiP is separately gated by
  // the local controller lease before it reaches native UI, so observers retain
  // read-only coexistence without gaining a visual side effect.
  "capture_app",
  "get_skyshot",
  "element_at_point",
  "read_element",
  "read_clipboard",
  "is_focus_steal_prevented",
  "pip_is_running",
  // 只清一个内部抑制标志，不启动/停止任何面板，用户桌面上没有任何可见变化。
  // 归入只读的实际作用是别让它走 controller 仲裁：它在 MCP 会话启动期发出，
  // 那时别的对话可能正持有 lease，被 controller_busy 挡住会让新对话继续沿用
  // 上一个对话的 dismissed 状态——正是本方法要修的问题。
  "pip_clear_dismissed",
  "pip_session_handshake",
  "pip_live_probe_window_bounds",
  "pip_live_probe_initial_hit_surface",
]);
export var isReadOnlyBrokerMethod = (method) => READ_ONLY_BROKER_METHODS.has(method);
var PIP_SESSION_BROKER_METHODS = /* @__PURE__ */ new Set([
  "pip_session_handshake",
  "pip_session_event",
]);
export var isPipSessionBrokerMethod = (method) => PIP_SESSION_BROKER_METHODS.has(method);
