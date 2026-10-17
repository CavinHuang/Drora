/**
 * R4 验收包（Busy 队列）：G08 + G09，出自
 * docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md 验收矩阵。
 *
 * - G08 Busy Session 下加入队列，在队列提升前修改原文：手动「立即发送」
 *   （sendQueuedNow）在 reserve 前复验 evidence（CLI queue.ts 的提升漏斗），
 *   过期证据必须被拒绝且队列项原位保留——不能静默降级为无证据发送。
 *   Busy 形态由回放 fixture 的 80 秒受控慢流 SSE 回答驱动（真实 turn、
 *   真实 running 窗口），哨兵回复条目保证「降级发送」会产生可观测的新 turn。
 * - G09 同一节选两次「加入 Agent（可信证据）」：每次点击都重新核验并签发
 *   新 Receipt（useKnowledgeAgentActions「Always issue a fresh receipt」），
 *   Composer 按 dedupe key 原位替换只保留一项；发送的是第二次签发的 ID——
 *   由 CLI 权威持久化（db.sqlite message 表 canonical user row 的
 *   evidenceRefs）对照两次 Inspector Receipt ID 证明。
 *
 * 边界：真实 Electron main/host/CLI RPC + 真实托管 Vault 文件（隔离 E2E HOME）；
 * 仅上游模型经本仓 R4-busy-queue.json 回放确定性回复。队列提升的拒绝面在
 * Renderer 只有 logger.warn（无 banner/toast），因此 G08 的判据以权威行为断言：
 * 队列项 id 原位保留、无新 canonical 行、慢流 turn 未被抢占、哨兵回复不出现、
 * SQLite message 行集合不扩大。
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve, sep } from "node:path";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../helpers/desktop-app.js";
import { restartWithSeededOpenAIProviders } from "../helpers/custom-openai-provider.js";
import { startConversationModelProviderReplayServer } from "../helpers/model-provider-replay.js";
import {
  selectUpstreamProviderModelById,
  waitForUpstreamModelSelected,
} from "../helpers/upstream-provider.js";
import {
  clickV4QueueItemDelete,
  clickV4QueueItemSendNow,
  getV4ConversationState,
  getV4QueueItems,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const CASE_NAME = "R4-busy-queue";
const MODEL_ID = "e2e-r4-busy-queue-model";
const PROVIDER_ID = "e2e-r4-busy-queue-provider";
const SESSION_START_MARKER = "R4_SESSION_START";
const G09_QUESTION = "R4_G09_QUESTION: what does the currently verified note say?";
const G09_ANSWER_MARKER = "R4_G09_ANSWER_OK";
const G08_SLOW_PROMPT = "R4_G08_SLOW: keep answering slowly until the queued evidence is tested.";
const G08_STREAMING_MARKER = "R4_G08_STREAMING";
const G08_QUEUED_PROMPT = "R4_G08_QUEUED: answer strictly from the attached verified evidence.";
const G08_QUEUED_REPLY_SENTINEL = "R4_G08_QUEUED_REPLY_MUST_NOT_APPEAR";
const TOKEN = "R4BusyQueueToken2026";
const NOTE_NAME = "R4-Busy-Queue-Evidence.md";
const ADD_TO_AGENT_ZH = "加入 Agent（可信证据）";
const ADD_TO_AGENT_EN = "Add verified evidence to Agent";

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
const NOTE_FILE = join(VAULT_ROOT, NOTE_NAME);
const CLI_DB = join(DATA_BASE, ".drora", "cli", "db", "db.sqlite");
const SOURCE = [
  "# R4 Busy Queue Evidence",
  "",
  `The ${TOKEN} sentence is the only trusted excerpt for busy-queue admission.`,
  "No other fixture file contains this token.",
  "",
].join("\n");

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;

function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "R4 refuses to operate outside the isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "R4 requires an isolated .e2e-home");
  assert.ok(NOTE_FILE.startsWith(join(HOME, ".drora") + sep));
  assert.ok(CLI_DB.startsWith(join(HOME, ".drora") + sep));
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
    { timeout, timeoutMsg: `R4 expected ${label}: ${selector}` },
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
    if (!el || !setter) throw new Error("R4 missing native Ask input");
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
    { timeout: 30_000, timeoutMsg: "R4 Vault index configuration not loaded" },
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
    { timeout: 90_000, timeoutMsg: "R4 real Knowledge index never covered the fixture note" },
  );
}
/** 首次连接隔离托管 Vault 并停在 Ask 页（G61/R2 同款生产链路）。 */
async function connectVaultAndOpenAsk(): Promise<void> {
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
    { timeout: 30_000, timeoutMsg: "R4 managed Vault was not authorized by production host" },
  );
  await click('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
  await awaitIndex();
}
/** 从任意视图回到 Knowledge Ask（add-to-agent 成功后主视图自动切回聊天）。 */
async function returnToAsk(): Promise<void> {
  const vaultVisible = await browser.execute(() =>
    Boolean(document.querySelector('[data-testid="vault-view"]')?.getClientRects().length),
  );
  if (!vaultVisible) {
    await click('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
    await waitFor('[data-testid="vault-view"]', "Vault panel");
  }
  await click('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
  await awaitIndex();
}
async function searchForNote(): Promise<void> {
  await setAskInput(TOKEN);
  await click('[data-testid="ask-submit"]', "submit FIND query");
  await browser.waitUntil(
    () =>
      browser.execute(
        (name) =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]')).some(
            (el) => el.textContent?.includes(name),
          ),
        NOTE_NAME,
      ),
    { timeout: 90_000, timeoutMsg: "R4 indexed candidate unavailable" },
  );
}
interface EvidenceInspection {
  phase: string;
  receiptText: string | null;
  excerpt: string | null;
}
async function readEvidence(): Promise<EvidenceInspection | null> {
  return browser.execute((name) => {
    const card = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
    ).find((el) => el.textContent?.includes(name));
    const evidence = card?.querySelector<HTMLElement>('[data-testid="ask-evidence"]');
    if (!evidence) return null;
    const paragraphs = Array.from(evidence.querySelectorAll<HTMLParagraphElement>("p"));
    return {
      phase: evidence.getAttribute("data-evidence-phase") ?? "none",
      // verified 分支固定顺序（KnowledgeCandidateCard.tsx）：[1] 行号 [2] 摘录 [3] Receipt。
      receiptText: paragraphs[3]?.textContent ?? null,
      excerpt: paragraphs[2]?.textContent ?? null,
    };
  }, NOTE_NAME);
}
/** 点击候选卡上的「加入 Agent（可信证据）」（无专属 testid，按双语文本定位）。 */
async function clickAddToAgent(): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (name, zh, en) => {
          const card = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
          ).find((el) => el.textContent?.includes(name));
          const button = Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
            (b) => (b.textContent ?? "").includes(zh) || (b.textContent ?? "").includes(en),
          );
          return Boolean(button && button.getClientRects().length && !button.disabled);
        },
        NOTE_NAME,
        ADD_TO_AGENT_ZH,
        ADD_TO_AGENT_EN,
      ),
    { timeout: 30_000, timeoutMsg: "R4 add-to-agent button not ready" },
  );
  const clicked = await browser.execute(
    (name, zh, en) => {
      const card = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
      ).find((el) => el.textContent?.includes(name));
      const button = Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
        (b) => (b.textContent ?? "").includes(zh) || (b.textContent ?? "").includes(en),
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    NOTE_NAME,
    ADD_TO_AGENT_ZH,
    ADD_TO_AGENT_EN,
  );
  assert.equal(clicked, true, "R4 failed clicking add-to-agent");
}
async function readComposerChipCount(): Promise<number> {
  const value = await browser.execute(
    () =>
      document
        .querySelector<HTMLElement>("[data-conversation-selection-reference-count]")
        ?.getAttribute("data-conversation-selection-reference-count") ?? null,
  );
  return value === null ? 0 : Number(value);
}
interface TurnDiagnostics {
  receiptCount: number;
  quoteCount: number;
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
        const users: Array<{ receiptCount?: number; quoteCount?: number }> = Array.isArray(
          parsed.users,
        )
          ? parsed.users
          : [];
        const user = users.find((entry) => typeof entry.receiptCount === "number");
        if (!user) return null;
        return {
          receiptCount: user.receiptCount ?? 0,
          quoteCount: user.quoteCount ?? 0,
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
  assert.ok(replay, "R4 replay server is not running");
  const deadline = Date.now() + 30_000;
  for (;;) {
    const records = await readFile(replay.artifactPath, "utf-8")
      .then((text) => (JSON.parse(text).records ?? []) as ReplayRecord[])
      .catch(() => [] as ReplayRecord[]);
    const hit = records.find((record) => record.replay?.fixtureId === fixtureId);
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(
        `R4 replay artifact never recorded fixture ${fixtureId} at ${replay.artifactPath}`,
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
    assert.ok(body.includes(token), `R4 model request must include ${token}`);
  }
  for (const token of mustExclude) {
    assert.ok(!body.includes(token), `R4 model request must NOT include ${token}`);
  }
}
/** CLI 权威持久化：message 表 data JSON 里查含 marker 的 canonical 行（只读、可轮询）。 */
function readMessageRowsContaining(marker: string): string[] {
  const database = new DatabaseSync(CLI_DB, { readOnly: true });
  try {
    const rows = database
      .prepare("SELECT data FROM message WHERE CAST(data AS TEXT) LIKE ?")
      .all(`%${marker}%`) as Array<{ data: unknown }>;
    return rows.map((row) => JSON.stringify(row.data ?? ""));
  } finally {
    database.close();
  }
}
async function waitForMessageRows(
  marker: string,
  predicate: (rows: string[]) => boolean,
  timeoutMs = 30_000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let rows: string[] = [];
    try {
      rows = readMessageRowsContaining(marker);
    } catch (error) {
      // CLI db 在迁移/落盘窗口期可能短暂不可开；继续轮询到超时。
      if (Date.now() > deadline) throw error;
    }
    if (predicate(rows)) return rows;
    if (Date.now() > deadline) {
      throw new Error(`R4 SQLite message rows for ${marker} did not satisfy the expectation`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
}
function extractReceiptId(receiptText: string | null | undefined): string {
  const match = receiptText?.match(/evr_[A-Za-z0-9_-]+/);
  assert.ok(match, `R4 receipt text did not expose an evr_ id: ${receiptText}`);
  return match[0];
}

describe("R4 busy queue acceptance: G09 + G08 in one real Electron session", () => {
  before(async function () {
    this.timeout(300_000);
    assertSandbox();
    await mkdir(VAULT_ROOT, { recursive: true });
    await writeFile(NOTE_FILE, SOURCE, { encoding: "utf8", flag: "wx" });
    replay = await startConversationModelProviderReplayServer(CASE_NAME);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    const [provider] = await restartWithSeededOpenAIProviders([
      {
        modelId: MODEL_ID,
        providerId: PROVIDER_ID,
        providerName: "R4 Busy Queue E2E",
      },
    ]);
    if (!provider) throw new Error("R4 seeded replay provider missing");
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
    // G08/G09 前置：真实 CLI 会话已存在并回到 idle（Vault 交互必须绑定已有 Session）。
    await sendV4Prompt(
      `${SESSION_START_MARKER}: create a genuine active conversation before busy-queue checks.`,
    );
    await waitForV4AssistantMessageContaining(SESSION_START_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "R4 initial conversation did not become idle",
      90_000,
    );
  });

  after(async () => {
    assertSandbox();
    const content = await readFile(NOTE_FILE, "utf8").catch(() => null);
    if (content === SOURCE) await rm(NOTE_FILE);
    await replay?.stop();
    replay = null;
    await browser.electron.restoreAllMocks();
  });

  it("G09 double add-to-agent re-issues a fresh receipt, keeps one composer item and sends the second id", async function () {
    this.timeout(300_000);
    await connectVaultAndOpenAsk();
    await searchForNote();

    // 第一次「加入 Agent（可信证据）」：重新核验 + 签发 Receipt A。
    await clickAddToAgent();
    await browser.waitUntil(async () => (await readEvidence())?.phase === "verified", {
      timeout: 60_000,
      timeoutMsg: "R4 first add-to-agent did not verify",
    });
    const first = await readEvidence();
    const receiptA = extractReceiptId(first?.receiptText);
    assert.ok(first?.excerpt?.includes(TOKEN), "R4 first excerpt missing token");
    await browser.waitUntil(async () => (await readComposerChipCount()) === 1, {
      timeout: 30_000,
      timeoutMsg: "R4 composer chip did not appear after the first add-to-agent",
    });

    // 第二次「加入 Agent」同一节选：再次重新核验 + 签发 Receipt B（必须 ≠ A），
    // Composer 按 dedupe key 原位替换，仍只保留一项。
    await returnToAsk();
    await searchForNote();
    await clickAddToAgent();
    await browser.waitUntil(async () => (await readEvidence())?.phase === "verified", {
      timeout: 60_000,
      timeoutMsg: "R4 second add-to-agent did not verify",
    });
    const second = await readEvidence();
    const receiptB = extractReceiptId(second?.receiptText);
    assert.notEqual(receiptB, receiptA, "R4 second add-to-agent must issue a fresh receipt");
    await browser.waitUntil(async () => (await readComposerChipCount()) === 1, {
      timeout: 30_000,
      timeoutMsg: "R4 composer must keep exactly one item after re-adding the same excerpt",
    });

    // 发送：add-to-agent 成功后主视图自动切回聊天，composer 只补问题文本。
    await sendV4Prompt(G09_QUESTION);
    await waitForV4AssistantMessageContaining(G09_ANSWER_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "R4 G09 evidence turn did not settle",
      90_000,
    );
    let diagnostics: TurnDiagnostics | null = null;
    await browser.waitUntil(
      async () => {
        diagnostics = await readTurnDiagnostics(G09_QUESTION);
        return diagnostics !== null;
      },
      { timeout: 30_000, timeoutMsg: "R4 G09 turn diagnostics unavailable" },
    );
    assert.equal(
      diagnostics!.receiptCount,
      1,
      "G09 CLI admission must receive exactly one evidenceRef",
    );
    assert.equal(diagnostics!.quoteCount, 1, "G09 CLI must receive the quoted original excerpt");

    // CLI 权威持久化：canonical user row 的 evidenceRefs 携带第二次签发的 ID，
    // 且不含第一次的 ID（「发送的是第二次签发的 ID」的权威证明）。
    const rows = await waitForMessageRows(G09_QUESTION, (candidates) =>
      candidates.some((row) => row.includes(receiptB)),
    );
    assert.ok(
      rows.some((row) => row.includes(receiptB)),
      "R4 canonical user row must persist the second receipt id",
    );
    assert.ok(
      rows.every((row) => !row.includes(receiptA)),
      "R4 canonical user row must not reference the superseded first receipt id",
    );

    // 模型请求体：Agent 收到 <conversation_quote> 原文与来源清单。
    // 注：Receipt ID 是否入模型 prompt 属 G03 判据维度，不在 G09 判据内——
    // 本轮真实运行发现当前 HEAD 上 conversation_quote 序列化携带
    // evidenceReceiptId（apps/drora-cli/packages/core/src/runtime/helpers/
    // conversation-quotes.ts:11 全量 JSON.stringify，与 ConversationComposer
    // D-2 注释「不进模型可见提示词」矛盾），作为独立产品缺陷上报（G03 维度），
    // 此处仅记录泄漏探针证据，不作 G09 的通过条件。
    const record = await waitForReplayRecord("r4-busy-queue-g09-evidence-reply");
    assertModelRequest(
      record,
      ["<conversation_quote>", TOKEN, NOTE_NAME, G09_QUESTION],
      [G08_SLOW_PROMPT],
    );
    const receiptIdLeaksIntoPrompt = JSON.stringify(record.requestJson ?? {}).includes("evr_");
    console.info(
      `R4 G03-dimension defect probe: evidenceReceiptId in model prompt=${receiptIdLeaksIntoPrompt} (expected false per D-2 comment)`,
    );
    console.info(
      `R4 G09 receiptA=${receiptA.slice(0, 12)}… receiptB=${receiptB.slice(0, 12)}… admitted=second`,
    );
    assert.equal(
      await readFile(NOTE_FILE, "utf8"),
      SOURCE,
      "R4 G09 must not modify source Markdown",
    );
  });

  it("G08 busy-queue promotion re-verifies evidence, rejects the stale receipt and keeps the item in place", async function () {
    this.timeout(420_000);
    // 前置：G09 结束态 idle、无队列。
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "R4 G08 requires an idle conversation with an empty queue",
      30_000,
    );

    // 用回放 fixture 的受控慢流把真实 turn 拉长（busy 形态）。
    await sendV4Prompt(G08_SLOW_PROMPT);
    await waitForV4TimelineContaining(G08_STREAMING_MARKER, 60_000);
    await waitForV4ConversationState(
      (s) => s.state === "streaming" && Boolean(s.sessionId),
      "R4 slow turn did not enter the busy streaming state",
      60_000,
    );

    // busy 中经「加入 Agent（可信证据）」把带 Receipt 的输入放进 Composer，
    // 再点发送 → CLI admission（running）→ 入队（队列项携带 evidenceRefs）。
    await returnToAsk();
    await searchForNote();
    await clickAddToAgent();
    await browser.waitUntil(async () => (await readEvidence())?.phase === "verified", {
      timeout: 60_000,
      timeoutMsg: "R4 busy add-to-agent did not verify",
    });
    await browser.waitUntil(async () => (await readComposerChipCount()) === 1, {
      timeout: 30_000,
      timeoutMsg: "R4 busy composer chip did not appear",
    });
    await sendV4Prompt(G08_QUEUED_PROMPT);
    await waitForV4QueueCount(1, 60_000);
    const queued = await getV4QueueItems();
    const queueItemId = queued[0]!.queueItemId;
    const rowCountBeforePromotion = await browser.execute(
      () => document.querySelectorAll("[data-row-id]").length,
    );
    const messageRowsBeforePromotion = readMessageRowsContaining(G08_QUEUED_PROMPT);

    // 队列提升前修改原文 → 该 Receipt 的证据版本过期。
    const mutated = SOURCE.replace(TOKEN, `${TOKEN}-R4STALE`);
    assert.notEqual(mutated, SOURCE);
    await writeFile(NOTE_FILE, mutated, "utf8");
    try {
      // 手动「立即发送」→ sendQueuedNow 在 reserve 前复验 evidence（CLI 提升漏斗），
      // 过期必须 ACK failed；Renderer 侧无 banner，断言权威行为面。
      const clicked = await clickV4QueueItemSendNow(queueItemId);
      assert.equal(clicked, true, "R4 send-now button must be clickable while busy");

      // B-5 式稳定性采样：拒绝 settle 期队列项必须原位保留、无新 canonical 行。
      const readRejectionSurface = () =>
        browser.execute(() => ({
          queueCount: document.querySelectorAll(
            'li[data-testid^="v4-queue-item-"][data-queue-item-id]',
          ).length,
          rowCount: document.querySelectorAll("[data-row-id]").length,
        }));
      const sampleOne = await readRejectionSurface();
      await browser.pause(1_000);
      const sampleTwo = await readRejectionSurface();
      assert.deepEqual(
        sampleOne,
        { queueCount: 1, rowCount: rowCountBeforePromotion },
        "R4 sendQueuedNow rejection must keep the queue item in place without a new row",
      );
      assert.deepEqual(
        sampleTwo,
        { queueCount: 1, rowCount: rowCountBeforePromotion },
        "R4 queue item retention must stay stable across the rejection settle window",
      );
      // 复验失败发生在 reserve/stop 之前：当前慢流 turn 不得被抢占。
      const duringRejection = await getV4ConversationState();
      assert.equal(
        duringRejection.state,
        "streaming",
        "R4 a rejected promotion must not stop the running turn",
      );

      // 慢流自然结束后 auto-drain 汇合点再次复验 → 同样拒绝 → 队列项保留原位。
      await waitForV4ConversationState(
        (s) => s.state === "idle" && s.queueCount === 1,
        "R4 queue item must survive the auto-drain promotion funnel after the slow turn finished",
        150_000,
      );
      const finalItems = await getV4QueueItems();
      assert.equal(finalItems.length, 1, "R4 exactly one queue item must remain");
      assert.equal(
        finalItems[0]!.queueItemId,
        queueItemId,
        "R4 the retained queue item must be the original one (kept in place, not recreated)",
      );

      // 不能静默降级：无哨兵回复、无新权威行、SQLite message 行集合未扩大。
      const timelineText = await browser.execute(
        () => document.querySelector('[data-testid="v4-timeline"]')?.textContent ?? "",
      );
      assert.ok(
        !timelineText.includes(G08_QUEUED_REPLY_SENTINEL),
        "R4 a degraded plain-text send would have produced the sentinel assistant reply",
      );
      const finalRowCount = await browser.execute(
        () => document.querySelectorAll("[data-row-id]").length,
      );
      assert.equal(
        finalRowCount,
        rowCountBeforePromotion,
        "R4 rejected promotion must not create a canonical conversation row",
      );
      const finalMessageRows = readMessageRowsContaining(G08_QUEUED_PROMPT);
      assert.deepEqual(
        finalMessageRows,
        messageRowsBeforePromotion,
        "R4 rejected promotion must not append any CLI-persisted message row for the queued text",
      );
    } finally {
      // 先删队列项再恢复文件：文件一旦恢复，auto-drain 会对有效证据成功提升。
      // 清理段重试（ubuntu CI 竞速实证 2026-10-17）：busy turn 恰在删除点击前后
      // 结束时，一次 click 可能落在瞬时重渲染上未生效——循环点删直到归零。
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const deleted = await clickV4QueueItemDelete(queueItemId);
        if (!deleted) break;
        try {
          await waitForV4QueueCount(0, 10_000);
          break;
        } catch {
          // 队列项仍在（点击被重渲染吞掉），退避后重试。
          await browser.pause(1_000);
        }
      }
      await writeFile(NOTE_FILE, SOURCE, "utf8");
    }
  });
});
