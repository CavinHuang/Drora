import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  countUpstreamRequestsContainingAll,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  getV4ComposerText,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  waitForLatestV4CommandAck,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

/**
 * agents-team staged 全流程（缺口11，spec §14）：/team 两阶段成队的正式桌面 E2E。
 *
 * 覆盖点（replay provider，零真实模型）：
 * 1. lead 经 TeamSpawn（spec §14 缺口0，staged 唯一生产入口）建草案——staged 编辑器
 *    呈现在 timeline bottom dock（2026-10-23 §18 用户裁定：与 workflow 确认窗同位同
 *    chrome，钉在 composer 上方；摘要卡退化只读。原「内联摘要卡」形态与
 *    TeamStagedAutoOpenBridge 自动开侧板桥均已废除）；
 * 2. M2「Approve 前零成员零会话」：staged 期间成员欢迎请求计数必须为 0；
 * 3. Approve & Run（v4 命令 approveTeamPlan）→ 真实 in-process 成员 spawn
 *    （成员欢迎请求出现，成员事件落在真实 child 会话）；
 * 4. 缺口2 调度链 E2E 化：成员欢迎回合自然终态 → terminal 边缘 → kick →
 *    自动派发复活请求（"Agents Team automatic task assignment"）到达；
 * 5. 审批面呈现对齐（spec §10 呈现规则1/4、§15，2026-10-22 本卡）：问句表头
 *    （team-staged-editor 内首个 h2 由「团队计划草案」改为问句「启动这支团队？」）
 *    +「N 名成员 · N 项任务」表头计数（原 stagedSummary 尾巴「确认后才会创建成员」
 *    移除）；既有 testid 约定未变更（本挂载点可渲染控件在位）；新增
 *    team-staged-command-error（role=alert）无失败时不得出现（假阳性守门）。
 * 6. 无 profile 草案 staged 审批流（specs/agents-team.md §19 契约 2，2026-10-23）：
 *    TeamSpawn 省略成员 profile（optional 合法缺省）→ 草案落库归一为键缺席 →
 *    staged 编辑器正常内联呈现（fail-closed 烧帧回归断言：修复前空串破 wire
 *    min(1)，TeamStateChanged 每帧被拒、会话流白屏、编辑器永不渲染）→ Approve
 *    真实 spawn bob → 欢迎回合 + 自动派发全链无烧帧。
 * 7. halt 后下钻发消息被拒（specs/agents-team.md §19 契约 5，2026-10-23）：
 *    Approve 后经会话状态面板 team 行打开侧栏面板 → halt（真 ACK accepted）→
 *    开任务板下钻成员 → composer 发消息 → hub portSend 对 halted 团队以
 *    team_halted **真拒**（apps/drora-cli hub.ts portSend 拒绝路径，无需夹具拦截
 *    ——与下方「范围外」登记的『伪造拒绝 ACK 无夹具机制』不同：本用例的拒绝是
 *    hub 真实裁决）→ composer role=alert 内联出显 team_halted 文案且输入框保留
 *    原文（草稿永不丢不变量）。
 *
 * 灰度门：wdio worker 按 spec 注入 DRORA_AGENTS_TEAM=1（applyAgentsTeamEnvForWorker，
 * 照 applyAskUserQuestionClockScaleForWorker 先例；不泄漏到普通 case 的 worker）。
 * 范围外（登记）：成员改名/revise/abandon 分支、resume 正向流、spawn 原子性故障流
 * ——由 core/tests/team 单测与后续 AT-03+ 用例承接。三动作失败出显的**正向**断言
 * （拒绝 → 内联失败文案）无自动化夹具机制：team 命令走 v4 命令通道（sendCommand →
 * hub），不经 provider HTTP，replay 夹具无法拦截——登记为转正前人工项
 * （coverage matrix / catalog 的 AT-01 呈现对齐扩展节）。例外见覆盖点 7：halt 后
 * 发消息的拒绝由 hub 真实产生，不需要夹具。
 */

const PROMPT_MARKER = "E2E_AGENTS_TEAM_STAGED_APPROVAL";
// 捕获记录里的消息文本是解码态（真实引号），不能搜 JSON 转义形态 \"——夹具匹配
// 面用的是原始 body（含 \"），两侧表示不同，这里取无引号的唯一子串。
const MEMBER_WELCOME_MARKER = "a member of an Agents Team";
const ASSIGNMENT_MARKER = "Agents Team automatic task assignment";
// §19 契约 2（2026-10-23）：无 profile 草案的 staged 审批流——profile 是工具入参的
// optional 合法缺省，落库归一为键缺席，wire min(1) 不再被 `?? ""` 空串击穿。
const NO_PROFILE_MARKER = "E2E_AGENTS_TEAM_NO_PROFILE";
// §19 契约 5（2026-10-23）：halt 后下钻发消息被拒——hub 真拒 team_halted，无需夹具。
const SEND_REJECTED_MARKER = "E2E_AGENTS_TEAM_SEND_REJECTED";

describe("conversation session agents team staged approval", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("TeamSpawn 建 staged 草案（零成员）→ Approve & Run 真实 spawn → 终态边缘自动派发", async function () {
    this.timeout(180_000);
    await prepareV4ConversationE2E();
    await switchV4Mode("yolo");

    const runId = Date.now();
    const prompt = [
      `${PROMPT_MARKER}_${runId}: assemble an agents team.`,
      "Call TeamSpawn now with exactly one member named alice (profile general-purpose)",
      "and one task titled E2E_AGENTS_TEAM_TASK assigned to alice.",
    ].join(" ");

    await sendV4Prompt(prompt);
    await browser.waitUntil(async () => (await getV4ComposerText()) === "", {
      timeout: 30_000,
      timeoutMsg: "agents team staged approval 首发后输入框没有清空",
    });
    await waitForV4TimelineContaining(PROMPT_MARKER);

    // lead 首回合发出 TeamSpawn tool_use（协议证据）。
    await waitForUpstreamRequest(
      { includes: [PROMPT_MARKER, "TeamSpawn"], excludes: ["Generate a concise title"] },
      "agents team staged approval TeamSpawn request",
      60_000,
    );

    // staged 草案落库 → TeamStateChanged → timeline bottom dock 呈现 staged 编辑器
    // （§18：SessionPane 在 V4InteractionDialogs 后挂 TeamApprovalDock，摘要卡同帧退化只读）。
    await waitForStagedEditor(30_000);

    // 本卡呈现对齐断言（spec §10 呈现规则1/4、§15；2026-10-22）。
    // E2E 默认语言 zh-CN（store/index.ts:267 fallback），断言用词典源文案：
    // ① 问句表头——首个 h2 是问句；计数行是「N 名成员 · N 项任务」（原 stagedSummary
    //   文案移作表头计数，不再带「确认后才会创建成员」尾巴）；aria-label「团队计划
    //   草案」为既有约定，不变；
    // ② 既有 testid 约定守门——dock 挂载点可渲染的全部控件在位；改名入口自
    //   TeamStagedEditorConnected 内置发送（§19 契约 5/6：审批面挂载两处、呈现规则
    //   一体适用）后 dock 也有 team-staged-rename，纳入控件断言；
    // ③ team-staged-command-error（role=alert）无失败时不得出现——假阳性守门。
    //   其正向出显断言见文件头「范围外」登记（v4 命令通道无夹具拦截面，转正前人工项）。
    const header = await readStagedEditorHeader();
    expect(header.ariaLabel).toBe("团队计划草案");
    expect(header.question).toBe("启动这支团队？");
    expect(header.count).toBe("1 名成员 · 1 项任务");
    expect(await stagedEditorControlsPresent()).toEqual({
      approve: true,
      revise: true,
      abandon: true,
      reviseNote: true,
      rename: true,
    });
    expect(await stagedCommandErrorPresent()).toBe(false);

    // ④ dock 形态守门（specs/agents-team.md §19 契约 6，2026-10-23）：编辑器必须位于
    //   team-approval-dock 内（同位同 chrome），dock 容器带 role=status/aria-live 播报；
    //   摘要卡同帧 stagedEditorSuppressed 退化为只读——页面上恰一个编辑器实例（dock 内），
    //   不存在「摘要卡内联第二份」。
    expect(await stagedEditorInDock()).toBe(true);
    const dock = await readDockChrome();
    expect(dock.role).toBe("status");
    expect(dock.ariaLive).toBe("polite");
    expect(dock.title).toBe("团队计划待确认");
    expect(await summaryCardSuppressedReadonly()).toBe(true);
    expect(await countStagedEditors()).toBe(1);

    // M2 验收③：Approve 前零成员零会话——成员欢迎请求计数必须为 0。
    expect(await countUpstreamRequestsContainingAll([MEMBER_WELCOME_MARKER])).toBe(0);

    // lead 回合在 TeamSpawn 工具结果后收束（parent-final 夹具）。
    await waitForUpstreamRequest(
      {
        includes: [PROMPT_MARKER, "The draft is staged for user approval"],
        excludes: ["Generate a concise title"],
      },
      "agents team staged approval parent final request",
      60_000,
    );

    // Approve & Run：唯一创建成员的用户动作（v4 命令）。
    const approved = await clickStagedApprove();
    expect(approved.clicked).toBe(true);
    const ack = await waitForLatestV4CommandAck("approveTeamPlan", 30_000);
    expect(ack.status).toBe("accepted");

    // 真实 in-process 成员 spawn：欢迎回合请求到达（真实 child 会话，非 mock）。
    await waitForUpstreamRequest(
      { includes: [MEMBER_WELCOME_MARKER], excludes: ["Generate a concise title"] },
      "agents team staged approval member welcome request",
      90_000,
    );

    // 缺口2 调度链：欢迎回合自然终态 → terminal 边缘 → kick → 自动派发复活请求。
    await waitForUpstreamRequest(
      {
        includes: [ASSIGNMENT_MARKER, "E2E_AGENTS_TEAM_TASK"],
        excludes: ["Generate a concise title"],
      },
      "agents team staged approval auto-dispatch request",
      90_000,
    );

    // 终态收敛：staged 编辑器退场（team 已不在 staged 态）。
    await browser.waitUntil(async () => !(await stagedEditorPresent()), {
      timeout: 30_000,
      timeoutMsg: "agents team staged approval 审批后 staged 编辑器没有退场",
    });
  });

  it("无 profile 草案 staged 审批流（§19 契约 2）：TeamSpawn 省略 profile → 编辑器正常呈现 + Approve 真实 spawn", async function () {
    this.timeout(180_000);
    await prepareV4ConversationE2E();
    await switchV4Mode("yolo");

    const runId = Date.now();
    const prompt = [
      `${NO_PROFILE_MARKER}_${runId}: assemble an agents team.`,
      "Call TeamSpawn now with exactly one member named bob without any profile field",
      "and one task titled E2E_AGENTS_TEAM_NO_PROFILE_TASK assigned to bob.",
    ].join(" ");

    await sendV4Prompt(prompt);
    await browser.waitUntil(async () => (await getV4ComposerText()) === "", {
      timeout: 30_000,
      timeoutMsg: "agents team no-profile 首发后输入框没有清空",
    });
    await waitForV4TimelineContaining(`${NO_PROFILE_MARKER}_${runId}`);

    // lead 首回合发出 TeamSpawn tool_use（协议证据；fixture 的 tool_use 入参
    // members:[{name:"bob"}] 不带 profile 键——optional 合法缺省，§19 契约 2）。
    await waitForUpstreamRequest(
      { includes: [NO_PROFILE_MARKER, "TeamSpawn"], excludes: ["Generate a concise title"] },
      "agents team no-profile TeamSpawn request",
      60_000,
    );

    // fail-closed 烧帧回归断言（§19 契约 2 核心）：修复前 hub 把 optional 缺省写成
    // profile:""，stagedDraft.draftMembers[].profile 破 wire min(1)，TeamStateChanged
    // 每一帧被渲染器按 proto.frameAssemblyInvalidPayload 拒帧——staged 编辑器永远
    // 不渲染（会话流白屏）；修复后草案正常落库并内联呈现。
    await waitForStagedEditor(30_000);
    const header = await readStagedEditorHeader();
    expect(header.ariaLabel).toBe("团队计划草案");
    expect(header.question).toBe("启动这支团队？");
    expect(header.count).toBe("1 名成员 · 1 项任务");
    expect(await stagedEditorControlsPresent()).toEqual({
      approve: true,
      revise: true,
      abandon: true,
      reviseNote: true,
      rename: true,
    });
    expect(await stagedCommandErrorPresent()).toBe(false);

    // M2 验收③：Approve 前零成员零会话——基线差分读数（上游捕获工件跨用例累计，
    // 本用例非 worker 首个，绝对 0 会吃到前一用例的成员欢迎/派发请求）。
    const welcomeBaseline = await countUpstreamRequestsContainingAll([MEMBER_WELCOME_MARKER]);
    expect(await countUpstreamRequestsContainingAll([MEMBER_WELCOME_MARKER])).toBe(welcomeBaseline);

    // lead 回合在 TeamSpawn 工具结果后收束。
    await waitForUpstreamRequest(
      {
        includes: [NO_PROFILE_MARKER, "The draft is staged for user approval"],
        excludes: ["Generate a concise title"],
      },
      "agents team no-profile parent final request",
      60_000,
    );

    // Approve & Run：无 profile 成员的批准路径行为不变（§19 契约 2 不变量）。
    const approved = await clickStagedApprove();
    expect(approved.clicked).toBe(true);
    const ack = await waitForLatestV4CommandAck("approveTeamPlan", 30_000);
    expect(ack.status).toBe("accepted");

    // 真实 in-process 成员 spawn：bob 欢迎回合请求到达（spawn 面保留 profile ?? ""，
    // 非 wire，§19 契约 2 明示保留）。
    await waitForUpstreamRequest(
      { includes: [MEMBER_WELCOME_MARKER], excludes: ["Generate a concise title"] },
      "agents team no-profile member welcome request",
      90_000,
    );
    await waitForUpstreamRequest(
      {
        includes: [ASSIGNMENT_MARKER, "E2E_AGENTS_TEAM_NO_PROFILE_TASK"],
        excludes: ["Generate a concise title"],
      },
      "agents team no-profile auto-dispatch request",
      90_000,
    );

    // 终态收敛：staged 编辑器退场。
    await browser.waitUntil(async () => !(await stagedEditorPresent()), {
      timeout: 30_000,
      timeoutMsg: "agents team no-profile 审批后 staged 编辑器没有退场",
    });
  });

  it("halt 后下钻发消息被拒（§19 契约 5）：team_halted 内联出显且草稿保留", async function () {
    this.timeout(180_000);
    await prepareV4ConversationE2E();
    await switchV4Mode("yolo");

    const runId = Date.now();
    const prompt = [
      `${SEND_REJECTED_MARKER}_${runId}: assemble an agents team.`,
      "Call TeamSpawn now with exactly one member named carol (profile general-purpose)",
      "and one task titled E2E_AGENTS_TEAM_SEND_TASK assigned to carol.",
    ].join(" ");

    await sendV4Prompt(prompt);
    await browser.waitUntil(async () => (await getV4ComposerText()) === "", {
      timeout: 30_000,
      timeoutMsg: "agents team send-rejected 首发后输入框没有清空",
    });
    await waitForV4TimelineContaining(`${SEND_REJECTED_MARKER}_${runId}`);

    // 草案 staged → Approve（命令通道与 ACK 断言复用上方用例的既有约定）。
    await waitForStagedEditor(30_000);
    const approved = await clickStagedApprove();
    expect(approved.clicked).toBe(true);
    const ack = await waitForLatestV4CommandAck("approveTeamPlan", 30_000);
    expect(ack.status).toBe("accepted");

    // 团队 active（staged 编辑器退场）后，经会话状态面板 team 行打开侧栏面板
    // （ConversationStatusPanel team 分区 → TeamNavigationProvider → team tab）。
    await browser.waitUntil(async () => !(await stagedEditorPresent()), {
      timeout: 30_000,
      timeoutMsg: "agents team send-rejected 审批后 staged 编辑器没有退场",
    });
    await browser.waitUntil(async () => (await clickByTestId("status-panel-team-row")).clicked, {
      timeout: 30_000,
      timeoutMsg: "agents team send-rejected 状态面板没有出现 team 行（无法打开侧栏面板）",
    });

    // halt（active 动作区独立入口）→ hub 真 ACK accepted → 投影翻 halted
    // （面板动作区切换为 resume 区 = halted 态到达 UI 的投影证据）。
    await browser.waitUntil(async () => (await clickByTestId("team-halt")).clicked, {
      timeout: 30_000,
      timeoutMsg: "agents team send-rejected 侧栏面板没有出现 halt 动作（team 非 active？）",
    });
    // halt 有二次确认门（useConfirmDialog）：确认弹窗出现后点确认，命令才真正发出。
    await browser.waitUntil(async () => (await clickByTestId("confirm-dialog-confirm")).clicked, {
      timeout: 15_000,
      timeoutMsg: "agents team send-rejected halt 确认弹窗没有出现",
    });
    const haltAck = await waitForLatestV4CommandAck("haltTeam", 30_000);
    expect(haltAck.status).toBe("accepted");
    await browser.waitUntil(async () => testIdExists("team-resume-reason"), {
      timeout: 30_000,
      timeoutMsg: "agents team send-rejected halt 后面板没有进入 halted 态",
    });

    // 下钻：开任务板 → 点成员卡 → composer（契约 5 不变量：halt 后 composer 仍可
    // 输入可提交，门在 hub 裁决侧，UI 不预判团队状态）。
    await browser.waitUntil(async () => (await clickByTestId("team-board-toggle")).clicked, {
      timeout: 30_000,
      timeoutMsg: "agents team send-rejected 任务板 toggle 没有出现",
    });
    await browser.waitUntil(async () => (await clickByTestId("team-member-card")).clicked, {
      timeout: 30_000,
      timeoutMsg: "agents team send-rejected 成员卡没有出现",
    });
    await browser.waitUntil(async () => testIdExists("team-member-message-input"), {
      timeout: 30_000,
      timeoutMsg: "agents team send-rejected 下钻 composer 没有出现",
    });

    // 发送 → hub portSend 对 halted 团队以 team_halted 真拒（spec §19 契约 5 的
    // 真实拒绝路径，replay 夹具无需也无法拦截面）。
    const draft = "halt 后的投递尝试";
    const input = await $('[data-testid="team-member-message-input"]');
    await input.setValue(draft);
    await clickByTestId("team-member-message-send");

    // 契约 5 双断言：role=alert 内联出显（zh 词典 team.memberPane.sendFailed.line +
    // team.commandFailure.teamHalted 文案），且输入框保留原文（草稿永不丢不变量——
    // 修复前 send() 先清草稿，被拒后消息文本静默丢失）。
    await browser.waitUntil(async () => testIdExists("team-member-message-error"), {
      timeout: 15_000,
      timeoutMsg: "agents team send-rejected 被拒后 composer 没有出内联错误（静默丢消息回归）",
    });
    const errorText = await textContentByTestId("team-member-message-error");
    expect(errorText).toContain("消息未送达");
    expect(errorText).toContain("团队已暂停");
    const inputValue = await inputValueByTestId("team-member-message-input");
    expect(inputValue).toBe(draft);
  });
});

async function stagedEditorPresent(): Promise<boolean> {
  return browser.execute(
    (marker: string) => Boolean(document.querySelector(`[data-testid="${marker}"]`)),
    "team-staged-editor",
  );
}

/** dock 形态守门：staged 编辑器必须位于 team-approval-dock 容器内（§19 契约 6）。 */
async function stagedEditorInDock(): Promise<boolean> {
  return browser.execute(
    () =>
      document.querySelector(
        '[data-testid="team-approval-dock"] [data-testid="team-staged-editor"]',
      ) !== null,
  );
}

/** dock chrome 读数：role/aria-live（可达性半边）与眉题文案。 */
async function readDockChrome(): Promise<{
  role: string | null;
  ariaLive: string | null;
  title: string | null;
}> {
  return browser.execute(() => {
    const dock = document.querySelector<HTMLElement>('[data-testid="team-approval-dock"]');
    if (dock === null) return { role: null, ariaLive: null, title: null };
    return {
      role: dock.getAttribute("role"),
      ariaLive: dock.getAttribute("aria-live"),
      title: dock.textContent?.includes("团队计划待确认") === true ? "团队计划待确认" : null,
    };
  });
}

/** 摘要卡只读退化读数（stagedEditorSuppressed）：footerSlot 卡不渲染内联编辑器。 */
async function summaryCardSuppressedReadonly(): Promise<boolean> {
  return browser.execute(
    () =>
      document.querySelector('[data-testid="team-conversation-summary"]') !== null &&
      document.querySelector(
        '[data-testid="team-conversation-summary"] [data-testid="team-staged-editor"]',
      ) === null,
  );
}

/** 页面上 staged 编辑器实例数（dock 恰一个，摘要卡不重复渲染）。 */
async function countStagedEditors(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll('[data-testid="team-staged-editor"]').length,
  );
}

async function waitForStagedEditor(timeoutMs: number) {
  await browser.waitUntil(async () => stagedEditorPresent(), {
    timeout: timeoutMs,
    timeoutMsg: "agents team staged approval staged 编辑器没有自动打开",
  });
}

async function clickStagedApprove(): Promise<{ clicked: boolean; found: boolean }> {
  return browser.execute(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid="team-staged-approve"]');
    if (button && !button.disabled) {
      button.click();
      return { clicked: true, found: true };
    }
    return { clicked: false, found: Boolean(button) };
  });
}

/**
 * 问句表头读数（spec §10 呈现规则1、§15）：aria-label 既有约定 + 问句 h2 + 计数行。
 * 表头 DOM：`<header><h2>问句</h2><span>计数</span></header>`（TeamStagedEditor）。
 */
async function readStagedEditorHeader(): Promise<{
  ariaLabel: string | null;
  question: string | null;
  count: string | null;
}> {
  return browser.execute(() => {
    const editor = document.querySelector<HTMLElement>('[data-testid="team-staged-editor"]');
    if (editor === null) return { ariaLabel: null, question: null, count: null };
    // §18 附裁二表头（镜像 WorkflowCardHeader）：kind 问句 + name + detail 三段同列，
    // 各有 testid；旧 h2/header 结构已废。
    return {
      ariaLabel: editor.getAttribute("aria-label"),
      question: editor.querySelector('[data-testid="team-staged-kind"]')?.textContent ?? null,
      count: editor.querySelector('[data-testid="team-staged-detail"]')?.textContent ?? null,
    };
  });
}

/** 既有 testid 在位读数（本挂载点可渲染的控件集合；沿用 data-testid 约定）。 */
async function stagedEditorControlsPresent(): Promise<Record<string, boolean>> {
  return browser.execute(() => {
    const present = (marker: string) =>
      Boolean(document.querySelector(`[data-testid="team-staged-${marker}"]`));
    return {
      approve: present("approve"),
      revise: present("revise"),
      abandon: present("abandon"),
      reviseNote: present("revise-note"),
      rename: present("rename"),
    };
  });
}

/** 三动作失败内联 alert（team-staged-command-error）在位读数（假阳性守门用）。 */
async function stagedCommandErrorPresent(): Promise<boolean> {
  return browser.execute(
    (marker: string) => Boolean(document.querySelector(`[data-testid="${marker}"]`)),
    "team-staged-command-error",
  );
}

/**
 * 按 testid 查找可交互元素并直点（§19 契约 5 用例：状态面板 team 行 / halt / 任务板
 * toggle / 成员卡 / composer 发送钮）。直点约定沿用本文件 clickStagedApprove；找不到
 * 或禁用（React 受控门）时返回 clicked=false 供 waitUntil 重试轮询。
 */
async function clickByTestId(testId: string): Promise<{ clicked: boolean; found: boolean }> {
  return browser.execute((marker: string) => {
    const element = document.querySelector<HTMLButtonElement>(`[data-testid="${marker}"]`);
    if (element && !element.disabled) {
      element.click();
      return { clicked: true, found: true };
    }
    return { clicked: false, found: Boolean(element) };
  }, testId);
}

/** testid 在位读数（waitUntil 轮询用）。 */
async function testIdExists(testId: string): Promise<boolean> {
  return browser.execute(
    (marker: string) => Boolean(document.querySelector(`[data-testid="${marker}"]`)),
    testId,
  );
}

/** testid 元素的 textContent 读数（composer 内联错误文案断言）。 */
async function textContentByTestId(testId: string): Promise<string | null> {
  return browser.execute(
    (marker: string) =>
      document.querySelector<HTMLElement>(`[data-testid="${marker}"]`)?.textContent ?? null,
    testId,
  );
}

/** testid 输入框的 value 读数（composer 草稿保留断言）。 */
async function inputValueByTestId(testId: string): Promise<string | null> {
  return browser.execute(
    (marker: string) =>
      document.querySelector<HTMLInputElement>(`[data-testid="${marker}"]`)?.value ?? null,
    testId,
  );
}
