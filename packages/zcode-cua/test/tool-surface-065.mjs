// R4.3（方案 specs/cua-gap-remediation-2026-11-09.md）回归锁定：包根 mcp 引擎按
// 0.6.5 切段刷新后的工具面契约——TOOL_NAMES 对齐官方十四工具（含 paste、剔除
// 17 个非官方项）、SERVER_VERSION 版本字面量 0.6.5、session 具备 element_scroll
// 派发路径。证据源：upstream/zcode-cua-0.6.5.index.js :40407-40428（TOOL_NAMES）、
// :44204-44206（SERVER_VERSION）、:42935-42967（element_scroll 分支）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const { TOOL_NAMES } = await import("../mcp/tools.js");

// 官方 0.6.5 十四工具面（切段 :40407-40428 逐字，含分节顺序）。
const OFFICIAL_TOOL_NAMES_065 = [
  "list_apps",
  "list_windows",
  "get_app_state",
  "left_click",
  "scroll",
  "left_click_drag",
  "type",
  "set_value",
  "select_text",
  "key",
  "perform_action",
  "paste",
  "request_access",
  "stop_computer_control",
];

assert.deepEqual(
  TOOL_NAMES,
  OFFICIAL_TOOL_NAMES_065,
  "TOOL_NAMES 必须与官方 0.6.5 十四工具面逐字一致（含顺序）",
);

// SERVER_VERSION 硬编码字面量（src/mcp/server.ts，切段 :44204-44206 同构）。
const serverSource = readFileSync(join(packageRoot, "src/mcp/server.ts"), "utf8");
assert.match(
  serverSource,
  /if \("0\.6\.5"\.trim\(\)\.length > 0\) \{\s*\n\s*return "0\.6\.5";/,
  'src/mcp/server.ts SERVER_VERSION 字面量必须为 "0.6.5"',
);

// session 的 element_scroll 派发路径（切段 :42935-42967：element target 先走
// broker 方法 element_scroll，能力缺失且 strategy 允许时回退 raw scroll）。
const sessionSource = readFileSync(join(packageRoot, "src/mcp/session.ts"), "utf8");
assert.ok(
  sessionSource.includes('"element_scroll"'),
  "src/mcp/session.ts 必须包含 element_scroll broker 方法派发",
);
assert.ok(
  sessionSource.includes("var pasteSchema") && sessionSource.includes('name: "paste"'),
  "src/mcp/session.ts 必须包含 pasteSchema 与 pasteTool（0.6.5 新增工具）",
);

console.log("tool-surface-065: TOOL_NAMES(14, 含 paste) / SERVER_VERSION 0.6.5 / element_scroll ✓");
