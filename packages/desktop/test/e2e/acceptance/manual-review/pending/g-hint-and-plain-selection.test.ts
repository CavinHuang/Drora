/**
 * v3.16.1 合并移入 pending（2026-10-20）：上游 project-sidebar 重构替换了本用例的
 * 入口交互（hover 工作区项→TID_WORKSPACE_FILE_TREE_BUTTON 已不存在；文件树改为
 * 右侧 FileManager 标签页，经 handleOpenFileManager 打开）。需对照新 FileManager
 * tab 流程重写 openWorkspaceFileTreePanel 后真机复跑再基线（e2e-case-lifecycle）。
 * 类型修复：移除已删除的 TID_WORKSPACE_ITEM/TID_WORKSPACE_FILE_TREE_BUTTON import。
 */
/**
 * G25/G30 验收包（权限隔离与提示），出自
 * docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md 矩阵行 G25/G30 与
 * 2026-10-18 补记表（本批差量：提示语义面 + 普通选区 chip 动作缺席的 GUI 断言）。
 *
 * - G25 已签发凭据后修改原文并尝试发送：
 *   1) 差量断言 A（提示存在且语义正确）：Composer 可信 chip 的 hover card 渲染
 *      「已签发可信引用 · 发送时复验」提示（ConversationSelectionReferenceChip.tsx
 *      的 composer-evidence-pending-revalidation；文案键
 *      chat.selections.evidenceRecheckOnSend，zh-CN.ts:1181 /
 *      en-US.ts:1280）。语义断言：提示必须声明凭据在发送时复验，且不得出现
 *      「永久 / 无需复验 / permanent」等永久有效误导词。
 *   2) 差量断言 B（门禁仍拒）：修改原文后发送 → 真实 CLI admission 返回
 *      guard.evidenceStale 的 SEND_FAILED 错误面（断言形态照 r3/G66 评审 B-4：
 *      必须断言结构化错误码，不得只断言 idle+行数）；idle、被拒草稿保留、无新
 *      权威对话行、源文件不被回写。门禁拒绝本体由 G05/G66 覆盖，此处为同链路
 *      复验 + 提示面差量。
 *   3) 修改后（发送前）与拒绝后各再采样一次提示：均显示且语义不变——提示不因
 *      原文失效而消失，也不因门禁拒绝而翻转成「凭据仍有效可发送」类误导。
 * - G30 在 Composer 附加普通 Markdown 选区而非可信 Receipt：
 *   工作区 Markdown 预览选区 → add-to-task（MarkdownSelectionTooltip.tsx 构造
 *   无 evidenceReceiptId 的 markdown 引用）→ 普通 chip 的 hover card 展示本地
 *   path 文本，但（间隔 1s 双采样）无 composer-evidence-pending-revalidation
 *   可信标记、无 composer-open-trusted-citation「核验后打开原文」动作；发送后
 *   CLI 权威投影 receiptCount=0、hasManifest=false、turnCitationCount=0
 *   （ConversationTurnGroup.tsx 的 data-e2e-knowledge-diagnostics），turn 内无
 *   knowledge-answer-* 可信来源渲染（KnowledgeAnswerSources.tsx），全 DOM 无
 *   chip 级可信入口（双采样）；模型请求体含 <conversation_quote> 本地 path 文本
 *   （artifact 实证的普通选区发送合同）但不含 evr_——本地 path 文本流入消息
 *   却换不来任何可信来源权限。
 *
 * 顺序与边界（如实记录）：
 * - G25 必须先于 G30：G30 的普通选区 turn 完成后，本环境观察到桌面 app 在数秒
 *   内被外部整体重启（main 日志 [app-quit] + 新 pid，desktop-e2e-20261018-172326
 *   等三轮复现），其后的 it 只能见到 root-startup-loading。把 G30 放在最后一个
 *   it，使该重启（无论来源）落在断言完成之后，不再影响本 spec 判定；该现象在
 *   notes 单独记录，不属于两用例的产品判据。
 * - G30 依赖 draft 态侧栏 workspace 行 hover 打开文件树（草稿提升为任务后
 *   workspace-item 从 DOM 卸载），因此文件树面板在 before 建立会话之前预打开；
 *   task 态下文件树面板保持挂载，直接点击行即可（conversation-session-
 *   markdown-selection 同款路径）。Windows workspacePath 含反斜杠，路径后缀
 *   testid 一律按 desktop-app readExactTestIdAttribute 先例用 dataset 精确
 *   匹配，不能拼 CSS selector。
 * - 真实 Electron main/host/CLI RPC + 真实托管 Vault 与工作区文件（隔离
 *   .e2e-home）；仅上游模型经本仓 G-hint-and-plain-selection.json 回放确定性
 *   回复，回放不提供任何 Receipt。G25 的发送被 CLI 拒绝，不产生模型请求。
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  TID_WORKSPACE_FILE_TREE_ROW,
  testId,
} from "@drora/shared";
import {
  clickTestIdByDom,
  DEFAULT_WORKSPACE,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import { restartWithSeededOpenAIProviders } from "../../../helpers/custom-openai-provider.js";
import { startConversationModelProviderReplayServer } from "../../../helpers/model-provider-replay.js";
import { resolveE2ERuntimePath } from "../../../helpers/e2e-runtime-paths.js";
import {
  selectUpstreamProviderModelById,
  waitForUpstreamModelSelected,
} from "../../../helpers/upstream-provider.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  setV4ComposerText,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";

const CASE_NAME = "G-hint-and-plain-selection";
const MODEL_ID = "e2e-g-hint-plain-model";
const PROVIDER_ID = "e2e-g-hint-plain-provider";
const SESSION_START_MARKER = "G_HINT_SESSION_START";
/** G25：Vault 证据笔记唯一检索 token（同 r3 G05 的时间差链路）。 */
const QUERY = "GHintStaleBeacon2026";
const NOTE_NAME = "G-Hint-Stale-Reverify.md";
/** G30：工作区普通 Markdown 选区 marker 与问题/回复 marker。 */
const PLAIN_MARKER = "G_HINT_PLAIN_SELECTION_MARKER";
const PLAIN_NOTE_NAME = "g30-plain-selection.md";
const G30_QUESTION =
  "G_HINT_G30_PLAIN_QUESTION: answer strictly from the attached plain selection.";
const G30_REPLY = "G_HINT_G30_PLAIN_REPLY";

const HOME = resolve(dirname(DEFAULT_WORKSPACE));
const DATA_BASE = resolve(process.env.DRORA_DATA_BASE_DIR?.trim() || HOME);
const ROOT = join(
  DATA_BASE,
  ".drora",
  "cli",
  "data",
  "obsidian@drora-plugins-official",
  "managed-vault",
);
const FILE = join(ROOT, NOTE_NAME);
const G30_FILE = resolveE2ERuntimePath("g-hint-plain-selection", PLAIN_NOTE_NAME);
const SOURCE =
  "# G25 stale-reverify local evidence\n\n" +
  `The original ${QUERY} note says: the pending-revalidation hint must never imply a permanent receipt.\n`;
const G30_BODY = [
  "# G30 plain markdown selection fixture",
  "",
  `The ${PLAIN_MARKER} paragraph is attached to the composer as a plain local-path`,
  "markdown selection, never as a trusted Receipt.",
  "",
  "Nothing in this file grants citation authority.",
  "",
].join("\n");

/** 提示语义锚：必须声明发送时复验；不得出现永久有效的误导词。 */
const RECHECK_HINT_RE = /发送时复验|rechecked on send/i;
const PERMANENT_MISLEAD_RE = /永久|无需复验|不再复验|permanent|no recheck/i;

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;
let g25Ready = false;

function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "G-hint refuses to operate outside the isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "G-hint requires isolated .e2e-home");
  assert.ok(FILE.startsWith(join(HOME, ".drora") + sep));
  assert.ok(G30_FILE.startsWith(join(HOME, "DroraProject") + sep));
}

async function waitFor(selector: string, label: string, timeout = 30_000): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute((sel) => {
        const el = document.querySelector<HTMLElement>(sel);
        return Boolean(
          el && el.getClientRects().length && !(el instanceof HTMLButtonElement && el.disabled),
        );
      }, selector),
    { timeout, timeoutMsg: `G-hint expected ${label}: ${selector}` },
  );
}

async function click(selector: string, label: string): Promise<void> {
  await waitFor(selector, label);
  const ok = await browser.execute((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  assert.equal(ok, true, label);
}

async function setAskInput(text: string): Promise<void> {
  await browser.execute((value) => {
    const el = document.querySelector<HTMLTextAreaElement>('[data-testid="ask-input"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!el || !setter) throw new Error("G-hint missing native Ask input");
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

async function awaitIndex(): Promise<void> {
  await waitFor('[data-testid="ask-input"]', "Knowledge Ask input");
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          document
            .querySelector('[data-testid="knowledge-ask-view"]')
            ?.getAttribute("data-index-configured") === "true",
      ),
    { timeout: 30_000, timeoutMsg: "G-hint Vault index configuration not loaded" },
  );
  const state = await browser.execute(() => {
    const el = document.querySelector('[data-testid="knowledge-ask-view"]');
    return {
      files: Number(el?.getAttribute("data-indexed-files") ?? "-1"),
      job: el?.getAttribute("data-index-job-status"),
    };
  });
  if (state.files === 0 && state.job !== "running") {
    await click('[data-testid="ask-index-start"]', "real index build");
  }
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const el = document.querySelector('[data-testid="knowledge-ask-view"]');
        return (
          Number(el?.getAttribute("data-indexed-files") ?? "-1") >= 1 &&
          el?.getAttribute("data-index-job-status") !== "running"
        );
      }),
    { timeout: 90_000, timeoutMsg: "G-hint real Knowledge index did not report a file" },
  );
}

/** 断言被拒发送的真实 CLI 错误面与 guard 码（r3/G66 评审 B-4 断言形态）。 */
async function assertSendFailedGuardCode(guardCode: string): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(() =>
        Boolean(document.querySelector('[data-error-code="SEND_FAILED"] button[data-testid]')),
      ),
    {
      timeout: 30_000,
      timeoutMsg: `G-hint ${guardCode} send must surface the real CLI SEND_FAILED error`,
    },
  );
  await click(
    '[data-error-code="SEND_FAILED"] button[data-testid]',
    `inspect CLI rejection reason for ${guardCode}`,
  );
  await browser.waitUntil(
    () =>
      browser.execute(
        (code) =>
          Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] pre')).some((el) =>
            el.textContent?.includes(code),
          ),
        guardCode,
      ),
    { timeout: 30_000, timeoutMsg: `G-hint CLI did not return ${guardCode}` },
  );
  await browser.execute(() => {
    const close = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[data-slot="dialog-close"], [role="dialog"] button[aria-label="Close"]',
    );
    close?.click();
  });
}

async function readComposerOutcome(): Promise<{ draftPresent: boolean; rowCount: number }> {
  return browser.execute(
    (token) => ({
      draftPresent: Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
      ).some((el) => el.textContent?.includes(token)),
      rowCount: Array.from(document.querySelectorAll("[data-row-id]")).length,
    }),
    QUERY,
  );
}

/** 读取可见主 Composer（form）内的引用 chip 计数（g28 选择器歧义修正版）。 */
async function readComposerChipCount(): Promise<number> {
  const value = await browser.execute(() => {
    const inputs = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
    );
    for (const input of inputs) {
      if (!input.getClientRects().length) continue;
      const pill = input
        .closest("form")
        ?.querySelector<HTMLElement>("[data-conversation-selection-reference-count]");
      if (pill) return pill.getAttribute("data-conversation-selection-reference-count");
    }
    return null;
  });
  return value === null ? 0 : Number(value);
}

interface ChipHoverState {
  open: boolean;
  text: string;
  hintText: string | null;
  hasOpenVerifiedButton: boolean;
}

/**
 * 读取当前打开的 chip hover card（radix Portal 内 [data-slot="hover-card-content"]）。
 * 以唯一 token（可信 chip 的 quote / 普通 chip 的选区文本）锚定，避免误中其他
 * hover card；未打开或未含 token 时 open=false。
 */
async function readChipHoverCard(token: string): Promise<ChipHoverState> {
  return browser.execute((anchor) => {
    const card = Array.from(
      document.querySelectorAll<HTMLElement>('[data-slot="hover-card-content"]'),
    ).find((el) => el.getClientRects().length > 0 && (el.textContent ?? "").includes(anchor));
    if (!card) {
      return { open: false, text: "", hintText: null, hasOpenVerifiedButton: false };
    }
    const hint = card.querySelector<HTMLElement>(
      '[data-testid="composer-evidence-pending-revalidation"]',
    );
    return {
      open: true,
      text: card.textContent ?? "",
      hintText: hint?.textContent ?? null,
      hasOpenVerifiedButton: Boolean(
        card.querySelector('[data-testid="composer-open-trusted-citation"]'),
      ),
    };
  }, token);
}

/** 悬停 Composer 的引用 chip（真实指针移到 pill 中心，hover card 保持打开）。 */
async function hoverComposerChip(label: string): Promise<void> {
  const rect = await browser.execute(() => {
    const inputs = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
    );
    for (const input of inputs) {
      if (!input.getClientRects().length) continue;
      const pill = input
        .closest("form")
        ?.querySelector<HTMLElement>("[data-conversation-selection-reference-count]");
      if (pill?.getClientRects().length) {
        const box = pill.getBoundingClientRect();
        return {
          x: Math.round(box.x + box.width / 2),
          y: Math.round(box.y + box.height / 2),
        };
      }
    }
    return null;
  });
  assert.ok(rect, `G-hint ${label}: no visible composer chip pill to hover`);
  await browser.action("pointer").move({ x: rect.x, y: rect.y, origin: "viewport" }).perform();
}

async function waitForChipHoverOpen(token: string, label: string): Promise<void> {
  await browser.waitUntil(async () => (await readChipHoverCard(token)).open, {
    timeout: 15_000,
    interval: 200,
    timeoutMsg: `G-hint ${label}: chip hover card did not open (token=${token})`,
  });
}

/**
 * 读取文件树行状态。树面板关闭时容器以 translate 移出屏幕但元素仍有
 * rects，因此「可见」必须同时要求树覆盖层 aria-hidden="false"
 * （WorkspaceSidebar.tsx 的 isFileTreeOpen 投影）。
 */
function readTreeRowState(expected: string): Promise<{
  present: boolean;
  treeOpen: boolean;
  rowVisible: boolean;
}> {
  return browser.execute((rowTestId) => {
    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
      (item) => item.dataset.testid === rowTestId,
    );
    if (!el) return { present: false, treeOpen: false, rowVisible: false };
    const layer = el.closest<HTMLElement>("[aria-hidden]");
    const treeOpen = layer?.getAttribute("aria-hidden") === "false";
    return {
      present: true,
      treeOpen,
      rowVisible: Boolean(el.getClientRects().length > 0 && treeOpen),
    };
  }, expected);
}

async function waitForTreeRowOpen(
  rowTestId: string,
  label: string,
  timeout = 15_000,
): Promise<void> {
  let latest: Awaited<ReturnType<typeof readTreeRowState>> | null = null;
  await browser.waitUntil(
    async () => {
      latest = await readTreeRowState(rowTestId);
      return latest.rowVisible;
    },
    { timeout, timeoutMsg: `${label}: file tree row not interactive (${JSON.stringify(latest)})` },
  );
}

/** Markdown 预览 SidePane 是否可见。 */
async function markdownPreviewVisible(): Promise<boolean> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-markdown-preview]")).some(
      (el) => el.getClientRects().length > 0,
    ),
  );
}

async function waitForMarkdownPreviewVisible(label: string, timeout = 15_000): Promise<void> {
  await browser.waitUntil(async () => markdownPreviewVisible(), {
    timeout,
    timeoutMsg: `G-hint ${label}: markdown preview pane is not visible`,
  });
}

/** G25 提示语义断言：存在 + 声明「发送时复验」+ 无永久有效误导词。 */
function assertHintSemantics(hintText: string | null, label: string): void {
  assert.ok(hintText, `${label}: composer chip must render the pending-revalidation hint`);
  assert.match(
    hintText,
    RECHECK_HINT_RE,
    `${label}: hint must state the receipt is rechecked on send (got: ${hintText})`,
  );
  assert.doesNotMatch(
    hintText,
    PERMANENT_MISLEAD_RE,
    `${label}: hint must not imply the receipt is permanently valid (got: ${hintText})`,
  );
}

/**
 * draft 态侧栏 workspace 行 hover 打开文件树面板（草稿提升为任务后
 * workspace-item 从 DOM 卸载，此步骤必须在建立会话之前完成）。Windows
 * workspacePath 含反斜杠，路径后缀 testid 按 dataset 精确匹配（不能拼 CSS
 * selector）；hover 用真实指针（侧栏 action 按真实 hover 挂载）。
 */
async function openWorkspaceFileTreePanel(): Promise<void> {
  // TODO(v3.16.1 再基线)：旧 id 已随 project-sidebar 重构移除；暂以历史字面量保持
  // 用例形态可编译，重写时应改走 FileManager 标签页入口。
  const workspaceItemTestId = testId("workspace-item", DEFAULT_WORKSPACE);
  const fileTreeButtonTestId = testId("workspace-file-tree-button", DEFAULT_WORKSPACE);
  await browser.waitUntil(
    async () => {
      const rect = await browser.execute((expected) => {
        const el = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
          (item) => item.dataset.testid === expected,
        );
        if (!el || !el.getClientRects().length) return null;
        const box = el.getBoundingClientRect();
        return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      }, workspaceItemTestId);
      if (!rect) return false;
      await browser.action("pointer").move({ x: rect.x, y: rect.y, origin: "viewport" }).perform();
      return browser.execute((expected) => {
        const el = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
          (item) => item.dataset.testid === expected,
        );
        return Boolean(el && el.getClientRects().length > 0);
      }, fileTreeButtonTestId);
    },
    { timeout: 15_000, timeoutMsg: "G-hint workspace file tree action did not mount after hover" },
  );
  await clickTestIdByDom(fileTreeButtonTestId);
  // 树面板真正打开：目标目录行可见且树覆盖层 aria-hidden=false。
  await waitForTreeRowOpen(
    testId(TID_WORKSPACE_FILE_TREE_ROW, dirname(G30_FILE)),
    "G-hint workspace file tree panel",
  );
}

interface TurnDiagnostics {
  receiptCount: number;
  quoteCount: number;
  hasManifest: boolean;
  turnCitationCount: number;
}

/** 读取含 marker 用户行的 turn 的 E2E 诊断投影（receiptCount 来自 CLI 权威 evidenceRefs）。 */
async function readTurnDiagnostics(userMarker: string): Promise<TurnDiagnostics | null> {
  return browser.execute((marker) => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("[data-e2e-knowledge-diagnostics]"),
    );
    for (const section of sections) {
      const rows = Array.from(section.querySelectorAll<HTMLElement>("[data-row-id]"));
      if (!rows.some((row) => (row.textContent ?? "").includes(marker))) continue;
      try {
        const parsed = JSON.parse(section.getAttribute("data-e2e-knowledge-diagnostics") ?? "{}");
        const users: Array<{ receiptCount?: number; quoteCount?: number; hasManifest?: boolean }> =
          Array.isArray(parsed.users) ? parsed.users : [];
        const user = users.find((entry) => typeof entry.receiptCount === "number");
        if (!user) return null;
        return {
          receiptCount: user.receiptCount ?? 0,
          quoteCount: user.quoteCount ?? 0,
          hasManifest: Boolean(user.hasManifest),
          turnCitationCount: Number(parsed.turnCitationCount ?? 0),
        };
      } catch {
        return null;
      }
    }
    return null;
  }, userMarker);
}

interface ReplayRecord {
  replay?: { fixtureId?: string };
  requestJson?: unknown;
}

/** replay server 把每个上游请求原子写入 artifact；按 fixtureId 取回被测请求体。 */
async function waitForReplayRecord(fixtureId: string): Promise<ReplayRecord> {
  assert.ok(replay, "G-hint replay server is not running");
  const deadline = Date.now() + 30_000;
  for (;;) {
    const records = await readFile(replay.artifactPath, "utf-8")
      .then((text) => (JSON.parse(text).records ?? []) as ReplayRecord[])
      .catch(() => [] as ReplayRecord[]);
    const hit = records.find((record) => record.replay?.fixtureId === fixtureId);
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(
        `G-hint replay artifact never recorded fixture ${fixtureId} at ${replay.artifactPath}`,
      );
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
}

describe("G25/G30 pending-revalidation hint and plain selection isolation", () => {
  before(async function () {
    this.timeout(300_000);
    assertSandbox();
    await mkdir(ROOT, { recursive: true });
    await writeFile(FILE, SOURCE, { encoding: "utf8", flag: "wx" });
    await mkdir(dirname(G30_FILE), { recursive: true });
    await writeFile(G30_FILE, G30_BODY, { encoding: "utf8", flag: "wx" });
    replay = await startConversationModelProviderReplayServer(CASE_NAME);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    const [provider] = await restartWithSeededOpenAIProviders([
      {
        modelId: MODEL_ID,
        providerId: PROVIDER_ID,
        providerName: "G Hint And Plain Selection E2E",
      },
    ]);
    if (!provider) throw new Error("G-hint seeded replay provider missing");
    await prepareV4ConversationE2E({ skipProvider: true });
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await selectUpstreamProviderModelById(MODEL_ID, {
      includePlainModelFallback: false,
      providerId: provider.id,
      providerName: provider.name,
    });
    await waitForUpstreamModelSelected(MODEL_ID, {
      includePlainModelFallback: false,
      providerId: provider.id,
    });
    // G30 前置：draft 态侧栏 workspace 行可见，此时打开文件树面板并展开 G30
    // 文件预览（task 化后 workspace-item 从 DOM 卸载；预览面板是独立 SidePane，
    // G25 的 VaultView 主视图切换不卸载它）。
    await openWorkspaceFileTreePanel();
    for (const path of [dirname(G30_FILE), G30_FILE]) {
      const rowTestId = testId(TID_WORKSPACE_FILE_TREE_ROW, path);
      await waitForTreeRowOpen(rowTestId, `G-hint before (${path})`);
      await clickTestIdByDom(rowTestId);
    }
    await waitForMarkdownPreviewVisible("before");
    // 可信 chip 必须绑定已存在的真实 CLI 会话（G03/G25 前置同款）。
    await sendV4Prompt(
      `${SESSION_START_MARKER}: create a genuine active conversation before Vault handoff.`,
    );
    await waitForV4AssistantMessageContaining(SESSION_START_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "G-hint initial conversation did not become idle",
      90_000,
    );
  });

  after(async () => {
    assertSandbox();
    const content = await readFile(FILE, "utf8").catch(() => null);
    if (content === SOURCE) await rm(FILE);
    await rm(dirname(G30_FILE), { recursive: true, force: true });
    await replay?.stop();
    replay = null;
    await browser.electron.restoreAllMocks();
  });

  it("G25 stale receipt still shows the recheck-on-send hint and the send gate still rejects", async function () {
    this.timeout(300_000);
    // 首次连接隔离 managed Vault 并建立真实索引（r3 prerequisite 范式）。
    await click('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
    await waitFor('[data-testid="vault-view"]', "Vault panel");
    await click('[data-testid="vault-switcher-trigger"]', "Vault selector");
    await click('[data-testid="vault-create-managed"]', "managed isolated Vault");
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document
              .querySelector('[data-testid="vault-switcher-trigger"]')
              ?.textContent?.includes("Drora Vault") ?? false,
        ),
      { timeout: 30_000, timeoutMsg: "G25 managed Vault was not configured" },
    );
    await click('[data-testid="vault-tab-ask"]', "Ask tab");
    await awaitIndex();

    // ANSWER 检索真实索引并交接，拿到服务端新签发的 Receipt（r3 G05 同链路）。
    await click('[data-testid="ask-intent-answer"]', "ANSWER intent");
    await setAskInput(QUERY);
    await click('[data-testid="ask-submit"]', "submit real Vault search");
    await browser.waitUntil(
      () =>
        browser.execute(
          (filename) =>
            Array.from(
              document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
            ).some((el) => el.textContent?.includes(filename)),
          NOTE_NAME,
        ),
      { timeout: 60_000, timeoutMsg: "G25 indexed candidate unavailable" },
    );
    await click('[data-testid="ask-candidate"] button', "select actual file candidate");
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document
              .querySelector('[data-testid="ask-candidate"]')
              ?.getAttribute("aria-selected") === "true",
        ),
      { timeout: 10_000, timeoutMsg: "G25 ANSWER candidate not selected" },
    );
    await click('[data-testid="ask-agent-handoff-submit"]', "prepare evidence and Agent draft");
    await browser.waitUntil(
      () =>
        browser.execute(
          (token) =>
            !document.querySelector('[data-testid="vault-view"]')?.getClientRects().length &&
            Array.from(
              document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
            ).some((el) => el.textContent?.includes(token)),
          QUERY,
        ),
      {
        timeout: 45_000,
        timeoutMsg: "G25 trusted handoff never returned to the live Agent composer",
      },
    );
    await browser.waitUntil(async () => (await readComposerChipCount()) === 1, {
      timeout: 30_000,
      timeoutMsg: "G25 trusted composer chip did not appear after handoff",
    });
    const beforeRows = (await readComposerOutcome()).rowCount;

    // 差量断言 A：交接后提示存在且语义正确（声明发送时复验，非永久有效）。
    await hoverComposerChip("G25 hover before edit");
    await waitForChipHoverOpen(QUERY, "G25 hover before edit");
    const hoverA = await readChipHoverCard(QUERY);
    assert.equal(
      hoverA.hasOpenVerifiedButton,
      true,
      "G25 trusted chip must expose the verify-and-open-source action (G28 covered chain)",
    );
    assertHintSemantics(hoverA.hintText, "G25 before edit");
    console.info(`G25 hint text before edit: ${hoverA.hintText}`);

    // 时间差：交接（签发 Receipt）之后、发送之前修改原文。
    const changed = SOURCE.replace(QUERY, `${QUERY}-edited-before-send`);
    assert.notEqual(changed, SOURCE);
    await writeFile(FILE, changed, "utf8");
    try {
      // 提示仍显示（判据前件「虽显示凭据待复验提示」）；pointer 仍在 pill 上。
      const hoverB = await readChipHoverCard(QUERY);
      assert.equal(
        hoverB.open,
        true,
        "G25 after edit: chip hover card must stay open with the pending-revalidation hint",
      );
      assertHintSemantics(hoverB.hintText, "G25 after edit");

      // 差量断言 B：发送门禁仍必须拒绝失效来源（SEND_FAILED + guard.evidenceStale）。
      await click('[data-testid="v4-composer-send"]', "send stale sourced draft");
      await assertSendFailedGuardCode("guard.evidenceStale");
      await waitForV4ConversationState(
        (s) => s.state === "idle" && s.queueCount === 0,
        "G25 stale evidence must not start an Agent turn",
        20_000,
      );
      const rejected = await readComposerOutcome();
      assert.equal(
        rejected.draftPresent,
        true,
        "G25 stale CLI admission must preserve the trusted Composer draft",
      );
      assert.equal(
        rejected.rowCount,
        beforeRows,
        "G25 stale send must not create a canonical conversation row",
      );
      assert.equal(
        await readFile(FILE, "utf8"),
        changed,
        "G25 rejected send must never edit original Markdown",
      );

      // 拒绝后提示仍在且语义不变：不因拒绝翻转为「凭据仍有效可发送」类误导。
      await hoverComposerChip("G25 hover after rejection");
      await waitForChipHoverOpen(QUERY, "G25 hover after rejection");
      const hoverC = await readChipHoverCard(QUERY);
      assertHintSemantics(hoverC.hintText, "G25 after rejection");
      assert.equal(
        hoverC.hintText,
        hoverA.hintText,
        "G25 hint text must not flip after the gate rejection",
      );
      console.info(`G25 hint text after rejection: ${hoverC.hintText}`);
      g25Ready = true;
    } finally {
      await writeFile(FILE, SOURCE, "utf8");
    }
  });

  it("G30 plain markdown selection chip exposes no verify action and grants no trusted citation", async function () {
    this.timeout(300_000);
    if (!g25Ready) this.skip();
    // G25 结束态：被拒草稿 + 可信 chip 仍挂在 Composer。普通选区必须从干净
    // Composer 开始：先移除遗留 chip（pill remove-all），再清空草稿（Lexical
    // bridge），轮询至两者都干净。
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => {
          const inputs = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
          );
          for (const input of inputs) {
            if (!input.getClientRects().length) continue;
            const pill = input
              .closest("form")
              ?.querySelector<HTMLElement>("[data-conversation-selection-reference-count]");
            if (pill) {
              pill.querySelector<HTMLButtonElement>("button[aria-label]")?.click();
              return "chip-present";
            }
            const bridge = (
              input as HTMLElement & {
                __droraLexicalInputE2E?: { getText: () => string; setText: (t: string) => void };
              }
            ).__droraLexicalInputE2E;
            if (!bridge) continue;
            if (bridge.getText() !== "") {
              bridge.setText("");
              return "draft-not-empty";
            }
            return "clean";
          }
          return null;
        })) === "clean",
      { timeout: 15_000, timeoutMsg: "G30 composer did not return to a clean state" },
    );

    // 工作区 Markdown 预览：before 已在 draft 态打开（独立 SidePane）；G25 的
    // VaultView 主视图切换会收起预览面板，此时经文件树行重开——目录在 before
    // 已展开（再点目录行会 toggle 收起），只需直接点击文件行。
    let previewReady = false;
    try {
      await browser.waitUntil(async () => markdownPreviewVisible(), { timeout: 3_000 });
      previewReady = true;
    } catch {
      previewReady = false;
    }
    if (!previewReady) {
      const fileRowTestId = testId(TID_WORKSPACE_FILE_TREE_ROW, G30_FILE);
      await waitForTreeRowOpen(fileRowTestId, "G30 fallback file row");
      await clickTestIdByDom(fileRowTestId);
      await waitForMarkdownPreviewVisible("G30 fallback via file tree");
    }
    console.info(`G30 markdown preview ready without file-tree fallback: ${previewReady}`);

    // 真实文本选区 → tooltip「加入当前对话」（普通 markdown 引用，无 Receipt）。
    await browser.execute((text) => {
      const root = document.querySelector("[data-markdown-preview]")!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent?.includes(text)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        node.parentElement!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return;
      }
      throw new Error("G30 preview text missing");
    }, PLAIN_MARKER);
    await click(
      '[data-conversation-selection-action="add-to-task"]',
      "add the plain selection to the composer",
    );
    await browser.waitUntil(async () => (await readComposerChipCount()) === 1, {
      timeout: 15_000,
      timeoutMsg: "G30 plain selection chip did not attach to the composer",
    });

    // 差量 GUI 断言：普通选区 chip 的 hover card 展示本地 path 文本与选区内容，
    // 但无「发送时复验」可信标记、无「核验后打开原文」动作（间隔 1s 双采样）。
    await hoverComposerChip("G30 plain chip hover");
    await waitForChipHoverOpen(PLAIN_MARKER, "G30 plain chip hover");
    const hoverSample1 = await readChipHoverCard(PLAIN_MARKER);
    await browser.pause(1_000);
    const hoverSample2 = await readChipHoverCard(PLAIN_MARKER);
    const hoverSamples = [hoverSample1, hoverSample2];
    for (const [index, sample] of hoverSamples.entries()) {
      assert.equal(
        sample.open,
        true,
        `G30 sample ${index + 1}: plain chip hover card must stay open`,
      );
      assert.ok(
        sample.text.includes(PLAIN_MARKER),
        `G30 sample ${index + 1}: plain chip hover must render the selected text`,
      );
      assert.ok(
        sample.text.includes(PLAIN_NOTE_NAME),
        `G30 sample ${index + 1}: plain chip hover must render the local path text (${PLAIN_NOTE_NAME})`,
      );
      assert.equal(
        sample.hintText,
        null,
        `G30 sample ${index + 1}: plain selection chip must NOT render the trusted recheck-on-send hint`,
      );
      assert.equal(
        sample.hasOpenVerifiedButton,
        false,
        `G30 sample ${index + 1}: plain selection chip must NOT expose the verify-and-open-source action`,
      );
    }
    console.info(
      `G30 plain chip hover samples (hint=null expected): ${JSON.stringify(
        hoverSamples.map((sample) => ({
          open: sample.open,
          hintText: sample.hintText,
          hasOpenVerifiedButton: sample.hasOpenVerifiedButton,
        })),
      )}`,
    );

    // 发送普通选区草稿（本地 path 文本随 <conversation_quote> 入消息）并等待
    // 真实完成态 turn。
    await setV4ComposerText(G30_QUESTION);
    await click('[data-testid="v4-composer-send"]', "send the plain selection draft");
    await waitForV4AssistantMessageContaining(G30_REPLY, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "G30 plain selection turn did not settle",
      90_000,
    );

    // CLI 权威投影：普通选区不携带任何 evidenceRefs，无 manifest，完成态无可信引用。
    let diagnostics: TurnDiagnostics | null = null;
    await browser.waitUntil(
      async () => {
        diagnostics = await readTurnDiagnostics(G30_QUESTION);
        return diagnostics !== null;
      },
      { timeout: 30_000, timeoutMsg: "G30 turn diagnostics unavailable" },
    );
    assert.equal(
      diagnostics!.receiptCount,
      0,
      "G30 plain markdown selection must carry no evidenceRefs",
    );
    assert.equal(
      diagnostics!.hasManifest,
      false,
      "G30 plain selection turn must not carry the trusted source manifest",
    );
    assert.equal(
      diagnostics!.turnCitationCount,
      0,
      "G30 completed turn must render no trusted citation",
    );
    console.info(
      `G30 diagnostics: receipts=${diagnostics!.receiptCount} manifest=${diagnostics!.hasManifest} citations=${diagnostics!.turnCitationCount}`,
    );

    // GUI 负向（间隔 1s 双采样）：turn 内无 knowledge-answer-* 可信来源渲染；
    // 全 DOM（含历史行恢复的普通 chip）无 chip 级可信标记与核验动作。
    const readTrustedRender = () =>
      browser.execute((marker) => {
        const sections = Array.from(
          document.querySelectorAll<HTMLElement>("[data-e2e-knowledge-diagnostics]"),
        );
        const section = sections.find((item) =>
          Array.from(item.querySelectorAll<HTMLElement>("[data-row-id]")).some((row) =>
            (row.textContent ?? "").includes(marker),
          ),
        );
        return {
          found: Boolean(section),
          sourcesContainer: Boolean(
            section?.querySelector('[data-testid="knowledge-answer-turn-sources"]'),
          ),
          visibleSourceButtons: Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid^="knowledge-answer-source-"]'),
          ).filter((el) => el.getClientRects().length > 0).length,
          chipHintCount: document.querySelectorAll(
            '[data-testid="composer-evidence-pending-revalidation"]',
          ).length,
          chipOpenActionCount: document.querySelectorAll(
            '[data-testid="composer-open-trusted-citation"]',
          ).length,
        };
      }, G30_QUESTION);
    const renderSample1 = await readTrustedRender();
    await browser.pause(1_000);
    const renderSample2 = await readTrustedRender();
    const renderSamples = [renderSample1, renderSample2];
    for (const [index, sample] of renderSamples.entries()) {
      assert.equal(sample.found, true, `G30 render sample ${index + 1}: turn section missing`);
      assert.equal(
        sample.sourcesContainer,
        false,
        `G30 render sample ${index + 1}: plain turn must not render trusted turn sources`,
      );
      assert.equal(
        sample.visibleSourceButtons,
        0,
        `G30 render sample ${index + 1}: no knowledge-answer-source button may appear`,
      );
      assert.equal(
        sample.chipHintCount,
        0,
        `G30 render sample ${index + 1}: no chip may render the trusted recheck hint`,
      );
      assert.equal(
        sample.chipOpenActionCount,
        0,
        `G30 render sample ${index + 1}: no verify-and-open-source action may exist`,
      );
    }
    console.info(`G30 trusted-render samples: ${JSON.stringify(renderSamples)}`);

    // 模型请求体（artifact 实证的发送合同）：普通 markdown 选区以
    // <conversation_quote> JSON 块进入模型消息，本地 path 文本随块流入——
    // 但请求体不含任何 Receipt（evr_）：path 文本不产生可信来源权限。
    const record = await waitForReplayRecord("g-hint-g30-plain-send");
    const body = JSON.stringify(record.requestJson ?? {});
    assert.ok(
      body.includes("<conversation_quote>"),
      "G30 model request must carry the plain selection quote block",
    );
    assert.ok(body.includes(PLAIN_MARKER), "G30 model request must carry the selected text");
    assert.ok(
      body.includes(PLAIN_NOTE_NAME),
      "G30 model request must carry the local path text (proof the path text exists in-band)",
    );
    assert.ok(body.includes(G30_QUESTION), "G30 model request must carry the question marker");
    assert.ok(!body.includes("evr_"), "G30 model request must not contain any receipt id");
    assert.equal(
      await readFile(G30_FILE, "utf8"),
      G30_BODY,
      "G30 fixture file must stay untouched",
    );
    assert.equal(await readFile(FILE, "utf8"), SOURCE, "G25 vault fixture must stay restored");
  });
});
