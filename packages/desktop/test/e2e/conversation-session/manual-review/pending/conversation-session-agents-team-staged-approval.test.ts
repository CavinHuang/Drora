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
 *    内联呈现在会话流摘要卡（2026-10-22 审批对齐 workflow 模式：会话流内、用户驱动；
 *    原 TeamStagedAutoOpenBridge 自动开侧板桥已废除）；
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
 *
 * 灰度门：wdio worker 按 spec 注入 DRORA_AGENTS_TEAM=1（applyAgentsTeamEnvForWorker，
 * 照 applyAskUserQuestionClockScaleForWorker 先例；不泄漏到普通 case 的 worker）。
 * 范围外（登记）：成员改名/revise/abandon 分支、halt/resume、spawn 原子性故障流
 * ——由 core/tests/team 单测与后续 AT-03+ 用例承接。三动作失败出显的**正向**断言
 * （拒绝 → 内联失败文案）无自动化夹具机制：team 命令走 v4 命令通道（sendCommand →
 * hub），不经 provider HTTP，replay 夹具无法拦截——登记为转正前人工项
 * （coverage matrix / catalog 的 AT-01 呈现对齐扩展节）。
 */

const PROMPT_MARKER = "E2E_AGENTS_TEAM_STAGED_APPROVAL";
// 捕获记录里的消息文本是解码态（真实引号），不能搜 JSON 转义形态 \"——夹具匹配
// 面用的是原始 body（含 \"），两侧表示不同，这里取无引号的唯一子串。
const MEMBER_WELCOME_MARKER = "a member of an Agents Team";
const ASSIGNMENT_MARKER = "Agents Team automatic task assignment";

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

    // staged 草案落库 → TeamStateChanged → 会话流摘要卡（SessionPane footerSlot）
    // 内联呈现 staged 编辑器（TeamStagedAutoOpenBridge 已废除）。
    await waitForStagedEditor(30_000);

    // 本卡呈现对齐断言（spec §10 呈现规则1/4、§15；2026-10-22）。
    // E2E 默认语言 zh-CN（store/index.ts:267 fallback），断言用词典源文案：
    // ① 问句表头——首个 h2 是问句；计数行是「N 名成员 · N 项任务」（原 stagedSummary
    //   文案移作表头计数，不再带「确认后才会创建成员」尾巴）；aria-label「团队计划
    //   草案」为既有约定，不变；
    // ② 既有 testid 约定守门——本挂载点（会话流摘要卡）可渲染的全部控件在位；改名
    //   五件套（team-staged-rename*）仅在侧栏挂载点渲染（TeamSidePane 传
    //   onRenameMember），不在本挂载点断言；
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
    });
    expect(await stagedCommandErrorPresent()).toBe(false);

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
});

async function stagedEditorPresent(): Promise<boolean> {
  return browser.execute(
    (marker: string) => Boolean(document.querySelector(`[data-testid="${marker}"]`)),
    "team-staged-editor",
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
    return {
      ariaLabel: editor.getAttribute("aria-label"),
      question: editor.querySelector("h2")?.textContent ?? null,
      count: editor.querySelector("header > span")?.textContent ?? null,
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
