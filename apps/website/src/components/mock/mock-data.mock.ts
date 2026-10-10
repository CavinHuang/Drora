/**
 * 官网 hero mock 的逐字假数据（参考站同款：Ryan Bot / zcode-* 组名 / gomoku 五子棋叙事，
 * 见 specs/website.md「demo data mirrors the reference site verbatim」条款）。
 * 唯一分歧：侧栏底部用户头像用 Drora D 标（在 WebsiteMock.mock.tsx 的 win-side-user 里落字）。
 *
 * 本文件是装饰性数据（渲染在 aria-hidden 区域），不进 i18n 字典、不走 wire 层 zod 校验；
 * ConversationRow 的形状对齐 @drora/shared/drora-protocol-v4 的 rows schema，仅取渲染所需字段。
 */
import type { DroraTaskMeta } from "@drora/ui/website-hero";
import type { ConversationRow } from "@drora/shared/drora-protocol-v4";

/** 相对时间基准：静态导出时烘焙构建时刻，页面上显示为「N 分 / N 小时前」（营销 mock 可接受）。 */
const NOW = Date.now();

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface HeroWorkspaceMock {
  /** DroraTaskMeta.workspacePath / WorkspaceTabState.workspacePath */
  workspacePath: string;
  /** 侧栏组名（参考站逐字：gomoku-ai / zcode-website / zcode-desktop / release-bot） */
  label: string;
  tasks: DroraTaskMeta[];
  /** 参考站里这组是否带失败红点任务 */
  hasErrorTask: boolean;
}

const mkTask = (
  workspacePath: string,
  id: string,
  title: string,
  minutesAgo: number,
  extra?: Partial<DroraTaskMeta>,
): DroraTaskMeta =>
  ({
    // DroraTaskMeta 必填：taskId/traceId/title/workspacePath/createdAt/updatedAt/mode
    taskId: id,
    traceId: "hero-mock-trace",
    title,
    workspacePath,
    createdAt: NOW - 3 * DAY,
    updatedAt: NOW - minutesAgo * MIN,
    mode: "auto",
    ...extra,
  }) as DroraTaskMeta;

/** 侧栏四个 workspace 组，任务标题与相对时间逐字对齐参考站 hero。 */
export const heroWorkspaces: HeroWorkspaceMock[] = [
  {
    workspacePath: "D:\\workspace\\projects\\gomoku-ai",
    label: "gomoku-ai",
    hasErrorTask: false,
    tasks: [
      mkTask("D:\\workspace\\projects\\gomoku-ai", "hero-task-g1", "创建一个智能五子棋游戏，让玩家与能够进行策略性落子并准确判断胜负的算法对战。", 2),
      mkTask("D:\\workspace\\projects\\gomoku-ai", "hero-task-g2", "整理开始提示、回合状态和胜利文案", 9),
      mkTask("D:\\workspace\\projects\\gomoku-ai", "hero-task-g3", "接入启发式 AI 落子和玩家先手流程", 14),
      mkTask("D:\\workspace\\projects\\gomoku-ai", "hero-task-g4", "适配移动端棋盘缩放和横竖屏布局", 27),
      mkTask("D:\\workspace\\projects\\gomoku-ai", "hero-task-g5", "补一版规则说明、重开入口和空状态引导", 51),
    ],
  },
  {
    workspacePath: "D:\\workspace\\projects\\zcode-website",
    label: "zcode-website",
    hasErrorTask: false,
    tasks: [
      mkTask("D:\\workspace\\projects\\zcode-website", "hero-task-w1", "修复对话区在 resize 时的底部吸附逻辑", 8),
      mkTask("D:\\workspace\\projects\\zcode-website", "hero-task-w2", "重写 hero visual 的 workspace 和 task 假数据", 3),
      mkTask("D:\\workspace\\projects\\zcode-website", "hero-task-w3", "整理官网首页英文文案，统一产品定位和 CTA", 42),
      mkTask("D:\\workspace\\projects\\zcode-website", "hero-task-w4", "调整首页 hero 在 13 寸和移动端下的布局断点", 1 * 60),
      mkTask("D:\\workspace\\projects\\zcode-website", "hero-task-w5", "补一版定价页 FAQ 和企业版能力说明", 2 * 60),
      mkTask("D:\\workspace\\projects\\zcode-website", "hero-task-w6", "优化 docs 搜索结果高亮和空状态反馈", 5 * 60),
    ],
  },
  {
    workspacePath: "D:\\workspace\\projects\\zcode-desktop",
    label: "zcode-desktop",
    hasErrorTask: true,
    tasks: [
      // status:"error" → 任务行失败红点（lib/taskListItemPresentation.ts）
      mkTask("D:\\workspace\\projects\\zcode-desktop", "hero-task-d1", "排查会话恢复后右侧面板状态不同步的问题", 1 * 60, { status: "error" }),
      mkTask("D:\\workspace\\projects\\zcode-desktop", "hero-task-d2", "优化 terminal 面板拖拽 resize 后的重绘性能", 2 * 60),
      mkTask("D:\\workspace\\projects\\zcode-desktop", "hero-task-d3", "修复重启后 sidebar 折叠状态没有恢复的问题", 3 * 60),
      mkTask("D:\\workspace\\projects\\zcode-desktop", "hero-task-d4", "梳理设置页分组信息架构，减少高级选项混杂", 6 * 60),
      mkTask("D:\\workspace\\projects\\zcode-desktop", "hero-task-d5", "给 command palette 增加最近使用和键盘提示", 9 * 60),
      mkTask("D:\\workspace\\projects\\zcode-desktop", "hero-task-d6", "补首启动 onboarding 的远程开发说明和权限提示", 1 * DAY),
    ],
  },
  {
    workspacePath: "D:\\workspace\\projects\\release-bot",
    label: "release-bot",
    hasErrorTask: true,
    tasks: [
      mkTask("D:\\workspace\\projects\\release-bot", "hero-task-r1", "接入 changelog 生成和 GitHub Release 草稿流程", 4 * 60),
      mkTask("D:\\workspace\\projects\\release-bot", "hero-task-r2", "补一版失败 CI 汇总消息模板和重试建议", 1 * DAY),
      mkTask("D:\\workspace\\projects\\release-bot", "hero-task-r3", "串上 tag 校验、版本号同步和 release note 预览", 1 * DAY),
      mkTask("D:\\workspace\\projects\\release-bot", "hero-task-r4", "生成版本发布公告模板，区分 patch 和 feature release", 2 * DAY),
      mkTask("D:\\workspace\\projects\\release-bot", "hero-task-r5", "给失败发布任务增加幂等重试和告警收敛策略", 3 * DAY, { status: "error" }),
    ],
  },
];

/** 参考站激活组：gomoku-ai 的第一条任务带品牌色高亮（经 TaskList 的 activeTaskId prop 驱动，
 * 不走 droraSessionStore——zustand 在 SSR 渲染语义下读初始快照，播种进不了静态 HTML）。 */
export const activeHeroWorkspace = heroWorkspaces[0]!;
export const activeHeroTaskId = activeHeroWorkspace.tasks[0]!.taskId;

// —— 聊天流 rows：参考站 gomoku 叙事逐字落成 ConversationRow ——
// 行序关键（实测 buildConversationTurnRenderUnits 语义）：轮内最后一行不能是 assistantText，
// 否则此前的工作行全部折叠进默认收起的「思考过程」history，静态 HTML 不渲染；
// 以工具行收尾时 history 默认展开，全部行可见（与配方冒烟 #3 同构）。
const turnBase = { turnId: "hero-turn-1", createdAt: NOW };

// 直接按 wire 类型逐字面量校验（不再 as-cast，让 tsc 抓字段拼写/枚举错误）。
const rowInputs: ConversationRow[] = [
  {
    ...turnBase,
    rowId: 1,
    createdAtSeq: 1,
    kind: "userInput",
    text: "创建一个智能五子棋游戏，让玩家与能够进行策略性落子并准确判断胜负的算法对战。",
    origin: "realUser",
  },
  {
    ...turnBase,
    rowId: 2,
    createdAtSeq: 2,
    kind: "assistantText",
    text: "我会先检查当前五子棋项目的结构，确认现有的棋盘状态、渲染和游戏流程已经做到什么程度，再接入 AI 和胜负判断。",
    state: "complete",
  },
  {
    ...turnBase,
    rowId: 3,
    createdAtSeq: 3,
    kind: "toolCall",
    toolCallId: "hero-tc-explore",
    toolName: "Grep",
    status: "error",
    inputText: "",
    input: { pattern: "gomoku" },
    error: { code: "no_matches", message: "仓库为空，没有可检索的代码" },
  },
  {
    ...turnBase,
    rowId: 4,
    createdAtSeq: 4,
    kind: "assistantText",
    text: "这个仓库看起来是空的，或者几乎没有现成代码。我现在继续确认目录内容，判断是基于已有应用扩展，还是需要从零开始实现。",
    state: "complete",
  },
  {
    ...turnBase,
    rowId: 5,
    createdAtSeq: 5,
    kind: "toolCall",
    toolCallId: "hero-tc-git",
    toolName: "Bash",
    status: "error",
    inputText: "git status --short",
    // 终端卡在无 output 时只渲染状态标签；把参考站叙事的命令与报错落成卡片输出，静态可见。
    output: { text: "**git status --short**\n\nfatal: not a git repository" },
    error: { code: "not_a_repository", message: "fatal: not a git repository" },
  },
  {
    ...turnBase,
    rowId: 6,
    createdAtSeq: 6,
    kind: "assistantText",
    text: "这里没有现成应用，所以我会从零开始做一个自包含实现。我先确认是否有本地项目约定需要遵守，然后补上浏览器端五子棋、启发式 AI、回合处理，以及明确的五子连线胜负判断。",
    state: "complete",
  },
  {
    ...turnBase,
    rowId: 7,
    createdAtSeq: 7,
    kind: "toolCall",
    toolCallId: "hero-tc-write-1",
    toolName: "Write",
    status: "success",
    inputText: "index.html · app.js · styles.css",
    output: {
      text: "完整 UI 和核心逻辑一次写入：\n\n- `index.html` — 15x15 棋盘与入口\n- `app.js` — 落子 / 胜负 / AI 逻辑（+471）\n- `styles.css` — 棋盘与移动端布局（+201）\n\n合计 **+733**。",
    },
  },
  {
    ...turnBase,
    rowId: 8,
    createdAtSeq: 8,
    kind: "assistantText",
    text: "完整 UI 和核心逻辑已经就位。我正在验证 JavaScript 是否可以正常解析，并复查落子评分逻辑，覆盖首步响应、平局处理和长连线胜利等边界情况。",
    state: "complete",
  },
  {
    ...turnBase,
    rowId: 9,
    createdAtSeq: 9,
    kind: "assistantText",
    text: "我发现了一个可以避免的依赖：页面原来拉取了在线字体。我正在去掉它，这样整个游戏可以完全本地运行，直接打开 `index.html` 就不需要网络。",
    state: "complete",
  },
  {
    ...turnBase,
    rowId: 10,
    createdAtSeq: 10,
    kind: "toolCall",
    toolCallId: "hero-tc-edit-1",
    toolName: "Edit",
    status: "success",
    inputText: "styles.css · index.html",
    output: { text: "移除在线字体依赖：**+1 / −7**。" },
  },
  {
    ...turnBase,
    rowId: 11,
    createdAtSeq: 11,
    kind: "assistantText",
    text: "已在 `index.html`、`styles.css` 和 `app.js` 中完成一个独立运行的浏览器五子棋游戏。它会渲染一个 15x15 棋盘，允许玩家放置黑棋，支持四个方向的胜负判断，高亮连成五子的路径，跟踪当前回合和步数，并支持重新开始对局。",
    state: "complete",
  },
  {
    ...turnBase,
    rowId: 12,
    createdAtSeq: 12,
    kind: "assistantText",
    text: "AI 不是随机落子，而是启发式评分。它会搜索附近候选点，为自身的进攻棋型评分，也为阻挡玩家的防守点评分，再叠加中心区域偏好，最后选择分数最高的一步。同时还提供可选的「AI 关注区域」覆盖层，用来展示它重点考虑过的候选位置。",
    state: "complete",
  },
  {
    ...turnBase,
    rowId: 13,
    createdAtSeq: 13,
    kind: "assistantText",
    text: "验证：`node --check app.js` 已通过。我这里没有运行交互式浏览器会话，剩下的一步是在浏览器里打开 index.html 并实际体验一局。",
    state: "complete",
  },
  {
    ...turnBase,
    rowId: 14,
    createdAtSeq: 14,
    kind: "toolCall",
    toolCallId: "hero-tc-check",
    toolName: "Bash",
    status: "success",
    inputText: "node --check app.js",
    output: { text: "**node --check app.js**\n\n通过，无语法错误。" },
  },
];

export const heroChatRows = rowInputs;

/** composer 文案（参考站同款） */
export const heroComposer = {
  placeholder: "继续输入后续修改需求",
  submitLabel: "发送",
} as const;

/** hero 顶栏（win-topbar）逐字文案 */
export const heroTopbar = {
  goalTitle: "创建一个智能五子棋游戏，让玩家与能够进行策略性落子并准确判断…",
  workspaceChip: "gomoku-ai",
  branchChip: "⎇ upgrade/v3.0",
} as const;

/** 右栏卡片（终端 / Git tools / Goal / Progress）逐字文案 */
export const heroRightPanel = {
  terminal: { title: "终端", badge: "zsh", prompt: "ryan@mac zcode-website % ▋" },
  git: {
    title: "Git tools",
    changesLabel: "Changes",
    added: "+734",
    removed: "−7",
    branch: "feat/gomoku-ai",
    commitLabel: "Commit",
  },
  goal: {
    title: "Goal",
    badge: "Complete",
    desc: "五子棋人机对战 — 使用启发式 AI 算法实现电脑落子",
    meta: ["5/5", "2m", "89K tokens"],
  },
  progress: {
    title: "Progress",
    items: [
      "初始化棋盘、棋子渲染和 15×15 网格布局",
      "实现玩家落子交互和胜负判定逻辑",
      "接入启发式 AI 算法实现电脑自动落子",
      "适配移动端棋盘缩放和横竖屏布局",
      "补一版规则说明、重开入口和空状态引导",
    ],
  },
} as const;

/** 侧栏顶部动作区与底部用户区（参考站同款；用户头像用 Drora D 标=唯一分歧） */
export const heroSidebarChrome: {
  actions: ReadonlyArray<{ icon: string; label: string; kbd?: string }>;
  user: { name: string; avatar: string };
} = {
  actions: [
    { icon: "⊕", label: "新建任务", kbd: "⌘N" },
    { icon: "▤", label: "打开工作区" },
    { icon: "⚡", label: "技能" },
  ],
  user: { name: "Ryan Bot", avatar: "D" },
};
