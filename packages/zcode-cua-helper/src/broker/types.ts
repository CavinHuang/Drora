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
  // 官方 0.6.5 / 3.17.2 双平台同表（43 面）逐字还原（2026-11-10 R10 归一）：
  // mac SEA @ 84310036 表提取与官方 win32 entry 表提取完全一致（含 pip 六方法）。
  // 旧 65 表为 3.11.2 血统（63 表 + v3.1 偏差）——官方 v3.1 协议瘦身（49→43，见
  // 官方 win entry :19750 墓碑注释）删除了 screen_size/cursor_position/screenshot/
  // list_displays/get_skyshot/set_display/move_to/mouse_*/type_text_into_current_focus/
  // key_down/key_up/read_clipboard/write_clipboard/open_application/
  // click_element_at_point 与六个 pip_live_probe_* 探针（攻击面瘦身，产品零消费）。
  // paste 为官方 43 表正式成员（原注释「v3.1 超集」系对 3.17.2 的误判）。
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
  // 观测
  "list_applications",
  "application_info",
  "list_windows",
  "capture_app",
  "element_at_point",
  "read_element",
  // 动作
  "click",
  "scroll",
  "drag",
  "type_text",
  "type_text_to_app",
  "press_key",
  "press_key_to_app",
  "hold_key",
  "hold_key_to_app",
  "cancel_input_holds",
  "element_press",
  "element_show_menu",
  "element_focus",
  "element_set_value",
  "element_perform_action",
  "element_select_text",
  // 官方 3.17.2 增量（host 侧表见 zcode-cua-0.6.5.index.js；SEA offset 85184509）。
  "element_scroll",
  // 原生粘贴：Helper 内部完成「保存剪贴板 → 写入 → 发粘贴键 → 还原」（官方 43 表成员）。
  "paste",
  "prevent_activation",
  "reenable_activation",
  "is_focus_steal_prevented",
  // PiP 与 presentation 通道（presentation 角色由 authenticate 的
  // peerPresentationEligible 门守卫——R10 认证模型换代后的官方形态）。
  "pip_start",
  "pip_stop",
  "pip_is_running",
  "pip_clear_dismissed",
  "pip_session_handshake",
  "pip_session_event",
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
// 清退（2026-11-10 R10 后续）：删除 3.11.2 血统残留的死表项 screen_size/
// cursor_position/screenshot/list_displays/get_skyshot/read_clipboard/
// pip_live_probe_window_bounds/pip_live_probe_initial_hit_surface——它们所属
// 方法已不在 43 表（isBrokerMethod 先行拒绝，本表永不命中）。官方 0.6.5 win
// entry :19760-19791 的 READ_ONLY 集不含这八项；mac SEA 同表（43 表同源）。
export var isReadOnlyBrokerMethod = (method) => READ_ONLY_BROKER_METHODS.has(method);
var PIP_SESSION_BROKER_METHODS = /* @__PURE__ */ new Set([
  "pip_session_handshake",
  "pip_session_event",
]);
export var isPipSessionBrokerMethod = (method) => PIP_SESSION_BROKER_METHODS.has(method);
