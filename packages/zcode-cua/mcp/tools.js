import {
  attachAppAssociationsMeta,
  runWithPipToolRequestContext,
  runWithTargetAppDisplayContext
} from "./client.js";
import {
  brokerCancelSignalFromAbortSignal,
  isBrokerUnavailableException,
  notReadyResultForException,
  runWithBrokerCancelSignal
} from "./errors.js";
import {
  cursorPositionSchema,
  displayActionTools,
  doubleClickSchema,
  getAppStateSchema,
  holdKeySchema,
  keySchema,
  keyboardRuntimeTools,
  leftClickDragSchema,
  leftClickSchema,
  leftMouseDownSchema,
  leftMouseUpSchema,
  listAppsSchema,
  listDisplaysSchema,
  listWindowsSchema,
  middleClickSchema,
  mouseMoveSchema,
  observationTools,
  openApplicationSchema,
  performActionSchema,
  pointerTools,
  readClipboardSchema,
  requestAccessSchema,
  rightClickSchema,
  runWithSession,
  screenshotSchema,
  scrollSchema,
  selectTextSchema,
  setValueSchema,
  stopComputerControlSchema,
  switchDisplaySchema,
  toolAnnotationsFor,
  toolKillSwitch,
  tripleClickSchema,
  typeSchema,
  waitSchema,
  writeClipboardSchema,
  zoomSchema
} from "./session.js";
var TOOL_NAMES = [
  // OBSERVATION (9)
  "list_apps",
  "open_application",
  "list_windows",
  "get_app_state",
  "screenshot",
  "zoom",
  "list_displays",
  "switch_display",
  "cursor_position",
  // POINTER (10)
  "left_click",
  "double_click",
  "triple_click",
  "right_click",
  "middle_click",
  "scroll",
  "left_click_drag",
  "mouse_move",
  "left_mouse_down",
  "left_mouse_up",
  // KEYBOARD (5)
  "type",
  "set_value",
  "select_text",
  "key",
  "hold_key",
  // SEMANTIC (1)
  "perform_action",
  // RUNTIME (5)
  "request_access",
  "stop_computer_control",
  "wait",
  "read_clipboard",
  "write_clipboard"
];
var APP_ASSOCIATION_MODE_BY_TOOL = {
  list_apps: "items",
  open_application: "primary",
  list_windows: "primary",
  get_app_state: "primary",
  screenshot: "none",
  zoom: "primary",
  list_displays: "none",
  switch_display: "none",
  cursor_position: "none",
  left_click: "primary",
  double_click: "primary",
  triple_click: "primary",
  right_click: "primary",
  middle_click: "primary",
  scroll: "primary",
  left_click_drag: "primary",
  mouse_move: "primary",
  left_mouse_down: "primary",
  left_mouse_up: "primary",
  type: "primary",
  set_value: "primary",
  select_text: "primary",
  key: "primary",
  hold_key: "primary",
  perform_action: "primary",
  request_access: "none",
  stop_computer_control: "none",
  wait: "none",
  read_clipboard: "none",
  write_clipboard: "none"
};
var SCHEMA_BY_NAME = {
  // observation
  list_apps: listAppsSchema,
  open_application: openApplicationSchema,
  list_windows: listWindowsSchema,
  get_app_state: getAppStateSchema,
  screenshot: screenshotSchema,
  zoom: zoomSchema,
  list_displays: listDisplaysSchema,
  switch_display: switchDisplaySchema,
  cursor_position: cursorPositionSchema,
  // pointer
  left_click: leftClickSchema,
  double_click: doubleClickSchema,
  triple_click: tripleClickSchema,
  right_click: rightClickSchema,
  middle_click: middleClickSchema,
  scroll: scrollSchema,
  left_click_drag: leftClickDragSchema,
  mouse_move: mouseMoveSchema,
  left_mouse_down: leftMouseDownSchema,
  left_mouse_up: leftMouseUpSchema,
  // keyboard
  type: typeSchema,
  set_value: setValueSchema,
  select_text: selectTextSchema,
  key: keySchema,
  hold_key: holdKeySchema,
  // semantic
  perform_action: performActionSchema,
  // runtime
  request_access: requestAccessSchema,
  stop_computer_control: stopComputerControlSchema,
  wait: waitSchema,
  read_clipboard: readClipboardSchema,
  write_clipboard: writeClipboardSchema
};
var TOOL_REGISTRY = TOOL_NAMES.map((name) => ({
  name,
  schema: SCHEMA_BY_NAME[name],
  annotations: toolAnnotationsFor(name)
}));
var TOOL_REGISTRY_MAP = new Map(TOOL_REGISTRY.map((t) => [t.name, t]));
var TOOL_DEF_BY_NAME = new Map([
  ...observationTools.map((t) => [t.name, t]),
  ...displayActionTools.map((t) => [t.name, t]),
  ...pointerTools.map((t) => [t.name, t]),
  ...keyboardRuntimeTools.map((t) => [t.name, t])
]);
var KILL_SWITCH_EXEMPT = /* @__PURE__ */ new Set(["request_access", "stop_computer_control"]);
var REQUEST_CONTEXT_META_KEY = "com.zcode/request-context";
var SUBAGENT_RUNTIME_SCOPE = "subagent";
var SUBAGENT_COMPUTER_USE_UNAVAILABLE_CODE = "SUBAGENT_COMPUTER_USE_UNAVAILABLE";
var SUBAGENT_COMPUTER_USE_UNAVAILABLE_MESSAGE = "Computer Use is not available in subagent";
function withKillSwitchPreflight(name, handler, deps) {
  return (input, extra) => runWithTargetAppDisplayContext(async () => {
    const requestContext = extra?._meta?.[REQUEST_CONTEXT_META_KEY];
    if (typeof requestContext === "object" && requestContext !== null && !Array.isArray(requestContext) && requestContext.runtime_scope === SUBAGENT_RUNTIME_SCOPE) {
      return {
        isError: true,
        content: [{ type: "text", text: SUBAGENT_COMPUTER_USE_UNAVAILABLE_MESSAGE }],
        structuredContent: { code: SUBAGENT_COMPUTER_USE_UNAVAILABLE_CODE }
      };
    }
    const invoke = async () => {
      if (!KILL_SWITCH_EXEMPT.has(name)) {
        try {
          toolKillSwitch(deps).ensureRunning();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return { isError: true, content: [{ type: "text", text: message }] };
        }
      }
      try {
        return await handler(input);
      } catch (e) {
        if (isBrokerUnavailableException(e)) {
          const payload = notReadyResultForException(name, e);
          return { content: [{ type: "text", text: JSON.stringify(payload) }] };
        }
        throw e;
      }
    };
    const runInSession = () => runWithPipToolRequestContext(
      requestContext,
      () => deps.session ? runWithSession(deps.session, invoke) : invoke()
    );
    const lifecycleSignal = deps.requestLifecycle?.signal;
    const signal = extra?.signal && lifecycleSignal ? AbortSignal.any([extra.signal, lifecycleSignal]) : extra?.signal ?? lifecycleSignal;
    const operation = signal ? runWithBrokerCancelSignal(brokerCancelSignalFromAbortSignal(signal), runInSession) : runInSession();
    const tracked = deps.requestLifecycle?.track(operation) ?? operation;
    return attachAppAssociationsMeta(await tracked, APP_ASSOCIATION_MODE_BY_TOOL[name]);
  });
}
export {
  APP_ASSOCIATION_MODE_BY_TOOL,
  KILL_SWITCH_EXEMPT,
  REQUEST_CONTEXT_META_KEY,
  SCHEMA_BY_NAME,
  SUBAGENT_COMPUTER_USE_UNAVAILABLE_CODE,
  SUBAGENT_COMPUTER_USE_UNAVAILABLE_MESSAGE,
  SUBAGENT_RUNTIME_SCOPE,
  TOOL_DEF_BY_NAME,
  TOOL_NAMES,
  TOOL_REGISTRY,
  TOOL_REGISTRY_MAP,
  withKillSwitchPreflight
};
