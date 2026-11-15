export const DRORA_KNOWN_TOOL_NAMES = [
  "Read",
  "Write",
  "Edit",
  "ApplyPatch",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "web_search",
  "TodoRead",
  "TodoWrite",
  "GoalRead",
  "ReadSessionContext",
  "AskUserQuestion",
  "SendMessage",
  "RespondToCoordinator",
  "TaskOutput",
  "TaskStop",
  "js",
  "js_reset",
  "js_add_node_module_dir",
  "mcp__node_repl__js",
  "mcp__node_repl__js_reset",
  "mcp__node_repl__js_add_node_module_dir",
  "Agent",
  "Task",
  "Skill",
  "CreateWorkflow",
  // 修订入口：登记进 workflow family 让确认窗
  // 按 family 选中运行确认块；工具行侧则按名先分流（resolveRenderer.ts），family 兜底不会吞掉它。
  "AmendWorkflow",
  // 留白补全（docs/dynamic-workflow/launch.md「The `FillWorkflowHole` tool」）：同 AmendWorkflow 登记进
  // workflow family——确认窗按 family 选运行确认块；工具行侧按名先分流到 CreateWorkflow 渲染器换留白词汇。
  "FillWorkflowHole",
  // wire 名就是 snake_case 的 submit_result（仓库里唯一一个），下划线必须字面在场：
  // 未登记时 UI identity 退回 unknown，动态工作流 actor 的提交会落到 raw fallback renderer。
  "submit_result",
  // 文生图内置工具（specs/model-capabilities.md §6）：未登记时 identity 回 unknown、
  // 消息流落 raw fallback 卡，node_repl_images 展示载荷（图片内联）没有任何渲染器
  // 消费——用户只见「Image saved to: <path>」文本，看不到生成的图（§12 修复 F-1）。
  "generate_image",
  // 修复（2026-11-14，v3.18.0 S4 段门复跑归因）：上游 v3.18.0 新增的内置工具族未随
  // 合并登记本表——core 的 builtInTools parity 测试（generate-image-tool-identity）
  // 如实拦截（identity 回 unknown ⇒ raw fallback 卡）。分三组登记：
  // ① 会话控制 12 工具（S2 会话控制域，wire 见 drora-protocol-v4）：其中
  //    ListSessions/ReadSession/SendToSession/WaitSessions 四件 UI 已按名分流到
  //    SessionToolCallBlock（登记前后两种世界都成立，workflowToolNames 同款先例），
  //    其余八件落 session-control family 的通用 FallbackToolCallBlock（不再是 raw JSON）；
  // ② ReadTopicResource：ReadSessionContext 的净迁移后继（S4「ReadSessionContext→
  //    ReadTopicResource 净迁移」），沿用 session-context family 走既有专用卡；
  //    ReadSessionContext 保留供历史投影识别；
  // ③ 插件发现两工具（S4 plugin-discovery 域）：plugin family 通用卡。
  "ListSessions",
  "ReadSession",
  "CreateSession",
  "ForkSession",
  "SendToSession",
  "WaitSessions",
  "InterruptSession",
  "RenameSession",
  "ListProjects",
  "OpenSession",
  "SetSessionArchived",
  "SetSessionPinned",
  "ReadTopicResource",
  "SearchPlugins",
  "SuggestPluginInstall",
] as const;

export type DroraKnownToolName = (typeof DRORA_KNOWN_TOOL_NAMES)[number];

export type DroraToolFamily =
  | "file-read"
  | "file-write"
  | "shell"
  | "search"
  | "web-fetch"
  | "todo"
  | "ask-user-question"
  | "agent"
  | "skill"
  | "goal"
  | "session-context"
  | "session-control"
  | "message"
  | "task-control"
  | "node-repl"
  | "image-generation"
  | "plugin"
  | "workflow";

const TOOL_FAMILY_BY_NAME: Record<DroraKnownToolName, DroraToolFamily> = {
  Read: "file-read",
  Write: "file-write",
  Edit: "file-write",
  ApplyPatch: "file-write",
  Bash: "shell",
  Glob: "search",
  Grep: "search",
  WebFetch: "web-fetch",
  WebSearch: "search",
  web_search: "search",
  TodoRead: "todo",
  TodoWrite: "todo",
  GoalRead: "goal",
  ReadSessionContext: "session-context",
  AskUserQuestion: "ask-user-question",
  SendMessage: "message",
  RespondToCoordinator: "message",
  TaskOutput: "task-control",
  // TaskStop 未登记时 UI identity 会退回 unknown，最终落到 raw fallback renderer。
  TaskStop: "task-control",
  js: "node-repl",
  js_reset: "node-repl",
  js_add_node_module_dir: "node-repl",
  // node_repl 由 MCP 暴露，进入 UI 的工具名因此带 MCP 前缀。
  // 若这里只登记旧 built-in 名称，专用 REPL renderer 会退回 unknown fallback。
  mcp__node_repl__js: "node-repl",
  mcp__node_repl__js_reset: "node-repl",
  mcp__node_repl__js_add_node_module_dir: "node-repl",
  generate_image: "image-generation",
  // v3.18.0 新增工具族归属（登记原因见上方 DRORA_KNOWN_TOOL_NAMES 注释块）：
  // 会话控制 12 工具统一 session-control family（4 件 UI 按名优先分流不受影响，
  // 其余走 resolveRenderer default 的通用 FallbackToolCallBlock）。
  ListSessions: "session-control",
  ReadSession: "session-control",
  CreateSession: "session-control",
  ForkSession: "session-control",
  SendToSession: "session-control",
  WaitSessions: "session-control",
  InterruptSession: "session-control",
  RenameSession: "session-control",
  ListProjects: "session-control",
  OpenSession: "session-control",
  SetSessionArchived: "session-control",
  SetSessionPinned: "session-control",
  // ReadSessionContext 的净迁移后继，沿用专用卡 family；旧名保留供历史投影。
  ReadTopicResource: "session-context",
  SearchPlugins: "plugin",
  SuggestPluginInstall: "plugin",
  Agent: "agent",
  Task: "agent",
  Skill: "skill",
  CreateWorkflow: "workflow",
  AmendWorkflow: "workflow",
  FillWorkflowHole: "workflow",
  submit_result: "workflow",
};

const TOOL_NAME_BY_LOWER = new Map<string, DroraKnownToolName>(
  DRORA_KNOWN_TOOL_NAMES.map((toolName) => [toolName.toLowerCase(), toolName]),
);

export function normalizeDroraToolName(
  value: string | null | undefined,
): DroraKnownToolName | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  return TOOL_NAME_BY_LOWER.get(normalized.toLowerCase()) ?? null;
}

export function getDroraToolFamilyForName(
  value: string | null | undefined,
): DroraToolFamily | null {
  const toolName = normalizeDroraToolName(value);
  return toolName ? TOOL_FAMILY_BY_NAME[toolName] : null;
}

export function isDroraToolFamily(
  value: string | null | undefined,
  family: DroraToolFamily,
): boolean {
  return getDroraToolFamilyForName(value) === family;
}

export function isDroraFileContentWriteToolName(value: string | null | undefined): boolean {
  return normalizeDroraToolName(value) === "Write";
}
