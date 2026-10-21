import { clearAppData } from "../../../helpers/desktop-app.js";
import { countUpstreamRequestsContainingAll, waitForUpstreamRequest } from "../../../helpers/conversation-session-network.js";
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
 *    自动打开（TeamStagedAutoOpenBridge）；
 * 2. M2「Approve 前零成员零会话」：staged 期间成员欢迎请求计数必须为 0；
 * 3. Approve & Run（v4 命令 approveTeamPlan）→ 真实 in-process 成员 spawn
 *    （成员欢迎请求出现，成员事件落在真实 child 会话）；
 * 4. 缺口2 调度链 E2E 化：成员欢迎回合自然终态 → terminal 边缘 → kick →
 *    自动派发复活请求（"Agents Team automatic task assignment"）到达。
 *
 * 灰度门：wdio worker 按 spec 注入 DRORA_AGENTS_TEAM=1（applyAgentsTeamEnvForWorker，
 * 照 applyAskUserQuestionClockScaleForWorker 先例；不泄漏到普通 case 的 worker）。
 * 范围外（登记）：成员改名/revise/abandon 分支、halt/resume、spawn 原子性故障流
 * ——由 core/tests/team 单测与后续 AT-03+ 用例承接。
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

    // staged 草案落库 → TeamStateChanged → TeamStagedAutoOpenBridge 自动开侧板。
    await waitForStagedEditor(30_000);

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
      { includes: [ASSIGNMENT_MARKER, "E2E_AGENTS_TEAM_TASK"], excludes: ["Generate a concise title"] },
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
    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="team-staged-approve"]',
    );
    if (button && !button.disabled) {
      button.click();
      return { clicked: true, found: true };
    }
    return { clicked: false, found: Boolean(button) };
  });
}
