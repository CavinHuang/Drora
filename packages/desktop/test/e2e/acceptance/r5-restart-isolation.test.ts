/**
 * R5 验收包（重启与跨轮隔离）：G12 + G35 + G42，出自
 * docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md 验收矩阵。
 *
 * - G35 同一真实会话连续两轮 [1] 来自不同笔记：每轮 CLI UserInputRow 各自
 *   receiptCount=1（权威 evidenceRefs 投影），模型请求体只含当轮笔记原文
 *   （fixture bodyExcludes 强制互斥），完成后点击两轮 [1] 各自打开自己的笔记
 *   （CodeMirror token 互斥断言），相同编号不得跨 turn 借用上一轮凭据。
 * - G42 新建第二个真实会话 S2（无证据轮不得出现 citation 按钮）；切回 S1 后
 *   点击旧轮引用仍绑定自身 Receipt 打开各自笔记；把 Beta 笔记改旧后点击第二轮
 *   [1] 必须 fail-closed 不导航，恢复原文后同一引用可重新核验打开。
 * - G12 真实退出 Electron 进程树并用同一 userData Profile 重启（复用
 *   obsidian-authenticated-restart.helper.ts 的 reloadElectronSessionPreservingBrowserProfile
 *   模式）：转录恢复、sessionId 不变；修改 Alpha 后点击第一轮 [1] 被拒
 *   （旧 Receipt 不误判 current）；恢复后旧 Receipt 经重新核验打开原文；
 *   重启后的原会话还能继续正常发送新消息并得到回复。
 *
 * 边界：真实 Electron main/host/CLI RPC + 真实托管 Vault 文件（隔离 E2E HOME）；
 * 仅上游模型经本仓 R5-restart-isolation.json 回放确定性回复。G42 判据中的
 * "切换 Workspace" 维度在单 workspace E2E 环境不可构造（第二 workspace 需要另建
 * 工作区装配），该维度由 packages/ui/test/knowledgeCitationNavigation.test.ts
 * 的 scope epoch 单测覆盖，本 spec 不虚报。
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../helpers/desktop-app.js";
import { restartWithSeededOpenAIProviders } from "../helpers/custom-openai-provider.js";
import { reloadElectronSessionPreservingBrowserProfile } from "../helpers/e2e-electron-reload.js";
import { startConversationModelProviderReplayServer } from "../helpers/model-provider-replay.js";
import {
  selectUpstreamProviderModelById,
  waitForUpstreamModelSelected,
} from "../helpers/upstream-provider.js";
import {
  getV4ConversationState,
  prepareV4ConversationE2E,
  scrollV4TimelineToTop,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";

const CASE_NAME = "R5-restart-isolation";
const MODEL_ID = "e2e-r5-restart-isolation-model";
const PROVIDER_ID = "e2e-r5-restart-isolation-provider";
const SESSION_START_MARKER = "R5_SESSION_START_MARKER";
const ROUND_A_REPLY_MARKER = "R5_ROUND_A_REPLY";
const ROUND_B_REPLY_MARKER = "R5_ROUND_B_REPLY";
const S2_QUESTION_MARKER = "R5_S2_QUESTION";
const S2_REPLY_MARKER = "R5_S2_REPLY";
const RESUME_QUESTION_MARKER = "R5_RESUME_QUESTION";
const RESUME_REPLY_MARKER = "R5_RESUME_REPLY";
const STALE_SUFFIX = "-edited-after-R5";
const MANIFEST_HEADER = "来源索引（顺序与附带的原文证据片段一致）：";
const HANDOFF_ANSWER_PREFIX = "请仅依据附带的 Obsidian 可信证据回答";

/** 第一轮 [1] 的笔记（Alpha）。 */
const A_NOTE_NAME = "R5-Restart-Alpha-Note.md";
const A_TOKEN = "R5TurnAlphaQuote2026";
/** 第二轮 [1] 的笔记（Beta）。 */
const B_NOTE_NAME = "R5-Restart-Beta-Note.md";
const B_TOKEN = "R5TurnBetaQuote2026";

const HOME = resolve(dirname(DEFAULT_WORKSPACE));
const DATA_BASE = resolve(process.env.DRORA_DATA_BASE_DIR?.trim() || HOME);
const VAULT_ROOT = join(
  DATA_BASE,
  ".drora",
  "cli",
  "data",
  "obsidian@drora-plugins-official",
  "managed-vault",
);
const A_FILE = join(VAULT_ROOT, A_NOTE_NAME);
const B_FILE = join(VAULT_ROOT, B_NOTE_NAME);
const A_BODY = [
  "# R5 Restart Isolation Alpha Evidence",
  "",
  `The ${A_TOKEN} sentence is the first-round trusted excerpt.`,
  "Only this file contains the alpha token.",
  "",
].join("\n");
const B_BODY = [
  "# R5 Restart Isolation Beta Evidence",
  "",
  `The ${B_TOKEN} sentence is the second-round trusted excerpt.`,
  "Only this file contains the beta token.",
  "",
].join("\n");
const FIXTURES: Array<{ file: string; body: string }> = [
  { file: A_FILE, body: A_BODY },
  { file: B_FILE, body: B_BODY },
];

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;
/** 级联前置：前序 it 失败时后续直接 skip，不制造误导性失败。 */
let firstSession: { taskId: string | null; sessionId: string | null } | null = null;
let roundAComplete = false;
let roundBComplete = false;
let secondSessionId: string | null = null;

function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "R5 refuses to operate outside the isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "R5 requires an isolated .e2e-home");
  for (const fixture of FIXTURES) {
    assert.ok(fixture.file.startsWith(join(HOME, ".drora") + sep));
  }
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
    { timeout, timeoutMsg: `R5 expected ${label}: ${selector}` },
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
    if (!el || !setter) throw new Error("R5 missing native Ask input");
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}
async function awaitIndex(expectedFiles: number): Promise<void> {
  await waitFor('[data-testid="ask-input"]', "Knowledge Ask input");
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          document
            .querySelector('[data-testid="knowledge-ask-view"]')
            ?.getAttribute("data-index-configured") === "true",
      ),
    { timeout: 30_000, timeoutMsg: "R5 Vault index configuration not loaded" },
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
      browser.execute((expected) => {
        const el = document.querySelector('[data-testid="knowledge-ask-view"]');
        return (
          Number(el?.getAttribute("data-indexed-files") ?? "-1") >= expected &&
          el?.getAttribute("data-index-job-status") !== "running"
        );
      }, expectedFiles),
    { timeout: 90_000, timeoutMsg: "R5 real Knowledge index never covered all fixture files" },
  );
}
/** 首次连接隔离托管 Vault 并停在 Ask 页（G61/R2 同款生产链路）。 */
async function connectVaultAndOpenAsk(): Promise<void> {
  await click('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
  await waitFor('[data-testid="vault-view"]', "Vault panel");
  await click('[data-testid="vault-switcher-trigger"]', "Vault switcher");
  await click('[data-testid="vault-create-managed"]', "managed isolated Vault");
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          document
            .querySelector('[data-testid="vault-switcher-trigger"]')
            ?.textContent?.includes("Drora Vault") ?? false,
      ),
    { timeout: 30_000, timeoutMsg: "R5 managed Vault was not authorized by production host" },
  );
  await click('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
  await awaitIndex(FIXTURES.length);
}
/** 从任意视图回到 Knowledge Ask（vault 未开则先打开）。 */
async function returnToAsk(): Promise<void> {
  const vaultVisible = await browser.execute(() =>
    Boolean(document.querySelector('[data-testid="vault-view"]')?.getClientRects().length),
  );
  if (!vaultVisible) {
    await click('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
    await waitFor('[data-testid="vault-view"]', "Vault panel");
  }
  await click('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
  await awaitIndex(FIXTURES.length);
}
/**
 * 回到 chat 主视图：workspaceMainView 是互斥状态（WorkspaceShellLayout.tsx 的
 * handleOpenVault 恒切换到 "vault"，vault-sidebar-open 不是 toggle），点击侧栏任务
 * 才会切回 chat 并重新挂载 conversation timeline。
 */
async function returnToChatView(taskId: string): Promise<void> {
  await selectV4TaskById(taskId, 45_000);
  await browser.waitUntil(
    () =>
      browser.execute(
        () => !document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
      ),
    { timeout: 15_000, timeoutMsg: "R5 chat view did not replace the Vault main view" },
  );
}
async function selectCandidate(filename: string): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (name) =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]')).some(
            (el) => el.textContent?.includes(name),
          ),
        filename,
      ),
    { timeout: 90_000, timeoutMsg: `R5 candidate ${filename} unavailable` },
  );
  await browser.execute((name) => {
    const card = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
    ).find((el) => el.textContent?.includes(name));
    const button = card?.querySelector<HTMLButtonElement>("button");
    if (!button) throw new Error(`R5 select button missing on ${name}`);
    button.click();
    return true;
  }, filename);
  await browser.waitUntil(
    () =>
      browser.execute(
        (name) =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
            .find((el) => el.textContent?.includes(name))
            ?.getAttribute("aria-selected") === "true",
        filename,
      ),
    { timeout: 15_000, timeoutMsg: `R5 candidate ${filename} was not selected` },
  );
}
/** ANSWER 检索单篇并交接进 Composer；composer 出现该篇 manifest 后返回。 */
async function handoffSingleNote(token: string, noteName: string): Promise<void> {
  await click('[data-testid="ask-intent-answer"]', "ANSWER intent");
  await setAskInput(token);
  await click('[data-testid="ask-submit"]', `submit ANSWER query for ${noteName}`);
  await selectCandidate(noteName);
  await click(
    '[data-testid="ask-agent-handoff-submit"]',
    `prepare evidence handoff for ${noteName}`,
  );
  await browser.waitUntil(
    () =>
      browser.execute(
        (prefix, header, name) => {
          const vaultClosed = !document
            .querySelector('[data-testid="vault-view"]')
            ?.getClientRects().length;
          const composer = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
          ).find((el) => (el.textContent ?? "").includes(prefix));
          return Boolean(
            vaultClosed &&
            composer &&
            (composer.textContent ?? "").includes(header) &&
            (composer.textContent ?? "").includes(`[1] path=`) &&
            (composer.textContent ?? "").includes(name),
          );
        },
        HANDOFF_ANSWER_PREFIX,
        MANIFEST_HEADER,
        noteName,
      ),
    { timeout: 45_000, timeoutMsg: `R5 trusted handoff composer not prepared for ${noteName}` },
  );
}
/**
 * 点击「包含 marker 的 assistant 行」内的可信引用按钮（两轮 [1] 的 testid 相同，按行区分）。
 * 打开 Vault 后聊天面板变窄，较早轮次的行会被虚拟滚动移出挂载窗口；等待期间对目标行
 * scrollIntoView，行不在 DOM 时把 timeline 滚到顶部重新挂载最早窗口。
 */
async function clickCitationInAssistantRow(marker: string, label: string): Promise<void> {
  let scrolledToTop = false;
  await browser.waitUntil(
    async () => {
      const state = await browser.execute((replyMarker) => {
        const row = Array.from(document.querySelectorAll<HTMLElement>("[data-row-id]"))
          .filter((el) => el.classList.contains("group/assistant-row"))
          .find((el) => (el.innerText || "").includes(replyMarker));
        if (!row) return "no-row";
        row.scrollIntoView({ block: "center" });
        const button = row.querySelector<HTMLElement>(
          '[data-testid^="knowledge-inline-citation-"]',
        );
        return button && button.getClientRects().length ? "ready" : "no-button";
      }, marker);
      if (state === "ready") return true;
      if (!scrolledToTop && state === "no-row") {
        scrolledToTop = true;
        await scrollV4TimelineToTop();
      }
      return false;
    },
    { timeout: 45_000, timeoutMsg: `R5 ${label} citation button missing in ${marker} row` },
  );
  const clicked = await browser.execute((replyMarker) => {
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-row-id]"))
      .filter((el) => el.classList.contains("group/assistant-row"))
      .find((el) => (el.innerText || "").includes(replyMarker));
    const button = row?.querySelector<HTMLElement>('[data-testid^="knowledge-inline-citation-"]');
    if (!button) return false;
    button.click();
    return true;
  }, marker);
  assert.equal(clicked, true, `R5 failed clicking ${label}`);
}
/**
 * 断言 CodeMirror 打开了期望笔记：含 expectedToken 且（当给出 otherToken 时）
 * 不含另一轮 token——「互不借用 Receipt/来源」的直接证据。
 */
async function waitForNoteOpened(
  expectedToken: string,
  otherToken: string | null,
  label: string,
): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (expected, other) => {
          const notesSelected =
            document
              .querySelector('[data-testid="vault-tab-notes"]')
              ?.getAttribute("aria-selected") === "true";
          const visibleEditors = Array.from(
            document.querySelectorAll<HTMLElement>(".cm-content"),
          ).filter((el) => Boolean(el.getClientRects().length));
          const opened = visibleEditors.some((el) => (el.textContent ?? "").includes(expected));
          const wrong =
            other === null
              ? false
              : visibleEditors.some((el) => (el.textContent ?? "").includes(other));
          return Boolean(notesSelected && opened && !wrong);
        },
        expectedToken,
        otherToken,
      ),
    { timeout: 30_000, timeoutMsg: `R5 ${label} did not open the expected note` },
  );
}
/** B-5 稳定采样：间隔 1s 两次采样都保持「未导航」，把拒绝 settle 期纳入被测窗口。 */
async function assertNoNavigationSettled(label: string): Promise<void> {
  const readNavigation = () =>
    browser.execute(() => ({
      vaultActive: Boolean(
        document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
      ),
      codeMirrorVisible: Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
        (el) => Boolean(el.getClientRects().length),
      ),
    }));
  const first = await readNavigation();
  await browser.pause(1_000);
  const second = await readNavigation();
  // EC-4（e2e-a-3，2026-10-18 终审）修复：原实现把两次采样 spread 合并成
  // `{ ...first, ...second }` 再断言——第二次采样会覆盖第一次的瞬时导航（首采样
  // vaultActive=true 可被 second 的 false 遮蔽，拒绝期闪现导航被判绿）。两次采样
  // 必须分别断言全 false，任一次出现导航即失败。
  assert.equal(first.vaultActive, false, `R5 ${label} must not navigate to Vault (first sample)`);
  assert.equal(
    first.codeMirrorVisible,
    false,
    `R5 ${label} must not open CodeMirror (first sample)`,
  );
  assert.equal(second.vaultActive, false, `R5 ${label} must not navigate to Vault (second sample)`);
  assert.equal(
    second.codeMirrorVisible,
    false,
    `R5 ${label} must not open CodeMirror (second sample)`,
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
/** replay server 把每个上游请求（含模型输入）原子写入 artifact；按 fixtureId 取回被测请求体。 */
async function waitForReplayRecord(fixtureId: string): Promise<ReplayRecord> {
  assert.ok(replay, "R5 replay server is not running");
  const deadline = Date.now() + 30_000;
  for (;;) {
    const records = await readFile(replay.artifactPath, "utf-8")
      .then((text) => (JSON.parse(text).records ?? []) as ReplayRecord[])
      .catch(() => [] as ReplayRecord[]);
    const hit = records.find((record) => record.replay?.fixtureId === fixtureId);
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(
        `R5 replay artifact never recorded fixture ${fixtureId} at ${replay.artifactPath}`,
      );
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
}
function assertModelRequest(
  record: ReplayRecord,
  mustInclude: string[],
  mustExclude: string[],
): void {
  const body = JSON.stringify(record.requestJson ?? {});
  for (const token of mustInclude) {
    assert.ok(body.includes(token), `R5 model request must include ${token}`);
  }
  for (const token of mustExclude) {
    assert.ok(!body.includes(token), `R5 model request must NOT include ${token}`);
  }
}
async function assertFixtureFilesUntouched(): Promise<void> {
  for (const fixture of FIXTURES) {
    assert.equal(
      await readFile(fixture.file, "utf8"),
      fixture.body,
      `R5 fixture ${fixture.file} must stay untouched on disk`,
    );
  }
}

describe("R5 restart & cross-turn isolation acceptance: G35/G42/G12 in one real Electron app", () => {
  before(async function () {
    this.timeout(300_000);
    assertSandbox();
    await mkdir(VAULT_ROOT, { recursive: true });
    for (const fixture of FIXTURES) {
      await writeFile(fixture.file, fixture.body, { encoding: "utf8", flag: "wx" });
    }
    replay = await startConversationModelProviderReplayServer(CASE_NAME);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    const [provider] = await restartWithSeededOpenAIProviders([
      {
        modelId: MODEL_ID,
        providerId: PROVIDER_ID,
        providerName: "R5 Restart Isolation E2E",
      },
    ]);
    if (!provider) throw new Error("R5 seeded replay provider missing");
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
    // S1 前置：真实 CLI 会话已存在并回到 idle（Vault 交接必须绑定已有 Session）。
    await sendV4Prompt(
      `${SESSION_START_MARKER}: create the first genuine conversation before two isolated evidence turns.`,
    );
    await waitForV4AssistantMessageContaining(SESSION_START_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "R5 first conversation did not become idle",
      90_000,
    );
    firstSession = await getV4ConversationState();
  });

  after(async () => {
    assertSandbox();
    for (const fixture of FIXTURES) {
      const content = await readFile(fixture.file, "utf8").catch(() => null);
      if (content === fixture.body) await rm(fixture.file);
    }
    await replay?.stop();
    replay = null;
    await browser.electron.restoreAllMocks();
  });

  it("G35 round 1: alpha-note evidence turn persists its own receipt and renders an authenticated [1]", async function () {
    this.timeout(300_000);
    if (!firstSession?.taskId) this.skip();
    await connectVaultAndOpenAsk();
    await handoffSingleNote(A_TOKEN, A_NOTE_NAME);
    await click('[data-testid="v4-composer-send"]', "send round-1 trusted draft to real CLI");
    await waitForV4AssistantMessageContaining(ROUND_A_REPLY_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "R5 round-1 evidence turn did not settle",
      90_000,
    );
    // 第一轮 UserInputRow 的权威投影：恰好一个 evidenceRef + 一个摘录 + 一个 manifest。
    let diagnostics: TurnDiagnostics | null = null;
    await browser.waitUntil(
      async () => {
        diagnostics = await readTurnDiagnostics(A_NOTE_NAME);
        return diagnostics !== null;
      },
      { timeout: 30_000, timeoutMsg: "R5 round-1 turn diagnostics unavailable" },
    );
    assert.equal(diagnostics!.receiptCount, 1, "G35 round 1 must admit exactly one evidenceRef");
    assert.equal(diagnostics!.quoteCount, 1, "G35 round 1 must quote the alpha excerpt");
    assert.equal(diagnostics!.hasManifest, true, "G35 round 1 user row must keep the manifest");
    assert.equal(diagnostics!.turnCitationCount, 1, "G35 round 1 completed turn must render [1]");
    // 模型请求体只含 Alpha 原文（Beta 的任何痕迹不得出现）。说明（EC-6/e2e-a-6，
    // 2026-10-18 终审修正陈旧表述）：D1 修复（2026-10-17）后 conversation_quote
    // 按模型可见字段白名单序列化，evidenceReceiptId（evr_ 前缀）不再进入模型
    // prompt；该维度归 G03/R2 验收，本包 G35 判据不含此项，不做排除断言。
    const record = await waitForReplayRecord("r5-restart-isolation-round-a");
    assertModelRequest(
      record,
      ["<conversation_quote>", A_TOKEN, A_NOTE_NAME, HANDOFF_ANSWER_PREFIX],
      [B_TOKEN, B_NOTE_NAME],
    );
    // 行内按钮确实渲染在第一轮 assistant 行内（不点击，留给 G35 互斥点击断言）。
    await browser.waitUntil(
      () =>
        browser.execute((replyMarker) => {
          const row = Array.from(document.querySelectorAll<HTMLElement>("[data-row-id]"))
            .filter((el) => el.classList.contains("group/assistant-row"))
            .find((el) => (el.innerText || "").includes(replyMarker));
          return Boolean(
            row?.querySelector('[data-testid^="knowledge-inline-citation-"]') &&
            row.querySelector('[data-testid^="knowledge-inline-citation-"]')?.getClientRects()
              .length,
          );
        }, ROUND_A_REPLY_MARKER),
      { timeout: 30_000, timeoutMsg: "R5 round-1 authenticated [1] never rendered" },
    );
    console.info(
      `R5 round-1 admitted receipts=${diagnostics!.receiptCount} citations=${diagnostics!.turnCitationCount}`,
    );
    roundAComplete = true;
    await assertFixtureFilesUntouched();
  });

  it("G35 round 2: beta-note turn keeps its own receipt and both [1] clicks open their own note only", async function () {
    this.timeout(300_000);
    // firstSession 在 it1 内赋值：TS 无法跨 it 推断，这里显式收窄（修复 TS18047）。
    if (!roundAComplete || !firstSession?.taskId) this.skip();
    await returnToAsk();
    await handoffSingleNote(B_TOKEN, B_NOTE_NAME);
    await click('[data-testid="v4-composer-send"]', "send round-2 trusted draft to real CLI");
    await waitForV4AssistantMessageContaining(ROUND_B_REPLY_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "R5 round-2 evidence turn did not settle",
      90_000,
    );
    // 第二轮 UserInputRow：同样恰好一个 evidenceRef——相同编号 [1] 没有跨 turn 借用。
    let diagnostics: TurnDiagnostics | null = null;
    await browser.waitUntil(
      async () => {
        diagnostics = await readTurnDiagnostics(B_NOTE_NAME);
        return diagnostics !== null;
      },
      { timeout: 30_000, timeoutMsg: "R5 round-2 turn diagnostics unavailable" },
    );
    assert.equal(diagnostics!.receiptCount, 1, "G35 round 2 must admit exactly one evidenceRef");
    assert.equal(diagnostics!.turnCitationCount, 1, "G35 round 2 completed turn must render [1]");
    // 第二轮请求体必须携带 Beta 原文。说明：历史消息必然包含第一轮 user row 的
    // manifest（Alpha 文件名），无法对全文做 Alpha 排除——「相同编号不跨 turn 借用
    // 凭据」的权威证据是两轮各自的 receiptCount=1 投影与后续互斥点击。
    const record = await waitForReplayRecord("r5-restart-isolation-round-b");
    assertModelRequest(
      record,
      ["<conversation_quote>", B_TOKEN, B_NOTE_NAME, HANDOFF_ANSWER_PREFIX],
      [],
    );
    console.info(
      `R5 round-2 admitted receipts=${diagnostics!.receiptCount} citations=${diagnostics!.turnCitationCount}`,
    );

    // 点击第二轮 [1]：必须打开 Beta 笔记，且编辑器不出现 Alpha 原文（互不借用来源）。
    await clickCitationInAssistantRow(ROUND_B_REPLY_MARKER, "round-2 [1]");
    await waitForNoteOpened(B_TOKEN, A_TOKEN, "round-2 [1] must open the beta note only");
    // Vault 是互斥主视图：先回 chat，再点击第一轮 [1]——必须打开 Alpha 笔记，
    // 且编辑器不出现 Beta 原文（旧轮凭据未被新轮覆盖）。
    await returnToChatView(firstSession.taskId!);
    await clickCitationInAssistantRow(ROUND_A_REPLY_MARKER, "round-1 [1]");
    await waitForNoteOpened(A_TOKEN, B_TOKEN, "round-1 [1] must open the alpha note only");
    roundBComplete = true;
    await assertFixtureFilesUntouched();
  });

  it("G42 after switching sessions: old-turn citations stay bound to their own receipts and stale sources fail closed", async function () {
    this.timeout(300_000);
    if (!roundBComplete || !firstSession?.taskId) this.skip();
    // it2 结束时 Vault 主视图打开着 Alpha；点新任务会切回 chat 草稿并建立 S2。
    await startNewV4Draft();
    await sendV4Prompt(
      `${S2_QUESTION_MARKER}: establish an independent second session without any evidence.`,
    );
    await waitForV4AssistantMessageContaining(S2_REPLY_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "R5 second session did not become idle",
      90_000,
    );
    const s2State = await getV4ConversationState();
    secondSessionId = s2State.taskId;
    assert.ok(secondSessionId, "R5 second session task id missing");
    assert.notEqual(secondSessionId, firstSession.taskId, "R5 requires two distinct sessions");
    // S2 没有任何可信证据轮：整个会话视图不得出现旧轮 citation 按钮复活。
    const s2CitationButtons = await browser.execute(
      () => document.querySelectorAll('[data-testid^="knowledge-inline-citation-"]').length,
    );
    assert.equal(s2CitationButtons, 0, "G42 evidence-free second session must render no citations");

    // 切回 S1（同时从 Vault 主视图回到 chat）：旧轮引用仍绑定各自 Receipt。
    // 闭包内 let 变量失去顶层收窄：先落到 const 再进回调（修复 TS18047）。
    const firstTaskId = firstSession.taskId!;
    await returnToChatView(firstTaskId);
    await waitForV4ConversationState(
      (s) => s.taskId === firstTaskId && s.state === "idle" && s.queueCount === 0,
      "R5 did not return to the first session",
      45_000,
    );
    await clickCitationInAssistantRow(
      ROUND_A_REPLY_MARKER,
      "old-turn round-1 [1] after session switch",
    );
    await waitForNoteOpened(
      A_TOKEN,
      B_TOKEN,
      "round-1 [1] after session switch must open the alpha note only",
    );
    // 回 chat 再测 fail-closed：Vault 关闭后点击改旧的第二轮 [1]，不得导航、
    // 不得打开 CodeMirror，也不得改写源文件。
    await returnToChatView(firstSession.taskId!);
    const mutatedB = B_BODY.replace(B_TOKEN, `${B_TOKEN}${STALE_SUFFIX}`);
    assert.notEqual(mutatedB, B_BODY);
    await writeFile(B_FILE, mutatedB, "utf8");
    try {
      await clickCitationInAssistantRow(ROUND_B_REPLY_MARKER, "stale round-2 [1] after mutation");
      await assertNoNavigationSettled("stale round-2 citation after session switch");
      assert.equal(
        await readFile(B_FILE, "utf8"),
        mutatedB,
        "R5 citation rejection must never modify the source",
      );
    } finally {
      await writeFile(B_FILE, B_BODY, "utf8");
    }
    // 恢复原文后同一引用可重新核验打开（fail-closed 不是按钮失效）。
    await clickCitationInAssistantRow(ROUND_B_REPLY_MARKER, "restored round-2 [1]");
    await waitForNoteOpened(B_TOKEN, A_TOKEN, "restored round-2 [1] must open the beta note only");
    await assertFixtureFilesUntouched();
  });

  it("G12 full Electron restart with the same profile: stale receipts are not current, recovered session still sends", async function () {
    this.timeout(360_000);
    if (!roundBComplete || !firstSession?.taskId || !firstSession.sessionId) this.skip();
    assertSandbox();
    await assertFixtureFilesUntouched();
    const before = await waitForV4ConversationState(
      (s) => Boolean(s.taskId) && Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "G12 requires the real original idle CLI session before restart",
      30_000,
    );
    assert.equal(before.taskId, firstSession.taskId, "G12 must restart the original first session");
    const userDataBefore = await browser.electron.execute((electron) =>
      electron.app.getPath("userData"),
    );
    // 真实退出旧 Electron 进程树并复用同一 browser profile 重建服务桥（G12 helper 模式）。
    const userDataAfter = await reloadElectronSessionPreservingBrowserProfile(browser);
    assert.equal(userDataAfter, userDataBefore, "G12 must reuse the same persisted profile");
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60_000);
    await selectV4TaskById(before.taskId!, 45_000);
    await waitForV4ConversationState(
      (s) =>
        s.taskId === before.taskId &&
        s.sessionId === before.sessionId &&
        s.state === "idle" &&
        s.queueCount === 0,
      "G12 restarted Electron did not recover the original Agent session",
      60_000,
    );
    // 转录恢复：两轮证据回复都在重启后的会话里。
    await waitForV4AssistantMessageContaining(ROUND_A_REPLY_MARKER, 60_000);
    await waitForV4AssistantMessageContaining(ROUND_B_REPLY_MARKER, 60_000);
    const coldStartVaultMounted = await browser.execute(() =>
      Boolean(
        document.querySelector('[data-testid="vault-view"]') &&
        document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
      ),
    );
    assert.equal(coldStartVaultMounted, false, "G12 restart must start without the Vault mounted");

    // 旧 Receipt 不误判 current：修改 Alpha 后点击第一轮 [1] 必须被拒。
    const mutatedA = A_BODY.replace(A_TOKEN, `${A_TOKEN}${STALE_SUFFIX}`);
    assert.notEqual(mutatedA, A_BODY);
    await writeFile(A_FILE, mutatedA, "utf8");
    try {
      await clickCitationInAssistantRow(ROUND_A_REPLY_MARKER, "stale round-1 [1] after restart");
      await assertNoNavigationSettled("stale round-1 citation after Electron restart");
      assert.equal(
        await readFile(A_FILE, "utf8"),
        mutatedA,
        "G12 post-restart rejection must not overwrite user source content",
      );
    } finally {
      await writeFile(A_FILE, A_BODY, "utf8");
    }

    // 原始版本恢复 current：同一持久化 Receipt 经重新核验打开被改过的 Alpha 原文
    // （与被改文件对称，直接复证 stale 拒绝不是按钮失效，G64 同款语义）。
    await clickCitationInAssistantRow(ROUND_A_REPLY_MARKER, "recovered round-1 [1]");
    await waitForNoteOpened(A_TOKEN, B_TOKEN, "recovered round-1 [1] must open the alpha note");
    assert.equal(await readFile(A_FILE, "utf8"), A_BODY, "G12 navigation must not mutate source");

    // 真实会话可继续正常发送：回 chat 后在原会话发送新的普通消息并得到回复。
    await returnToChatView(before.taskId!);
    await sendV4Prompt(
      `${RESUME_QUESTION_MARKER}: prove the restarted original session still accepts plain sends.`,
    );
    await waitForV4AssistantMessageContaining(RESUME_REPLY_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0 && s.sessionId === before.sessionId,
      "G12 resumed session did not settle on the same session id",
      90_000,
    );
    const resumeRecord = await waitForReplayRecord("r5-restart-isolation-restart-resume");
    // 历史消息必然包含前两轮 manifest 与摘录，只断言新问题真实到达模型。
    assertModelRequest(resumeRecord, [RESUME_QUESTION_MARKER], []);
    await assertFixtureFilesUntouched();
  });
});
