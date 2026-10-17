/**
 * R2 验收包（Agent 交接）：G03 + G04 + G13，出自
 * docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md 验收矩阵。
 *
 * - G03 已存在 Agent 会话下点「加入 Agent（可信证据）」：当前文件重新核验
 *   （修改后加入被 fail-closed 拒绝、恢复后重新签发新 Receipt），Composer 出现
 *   可信引用 chip；Receipt ID 不进入模型 prompt（由 G04 的模型请求体断言闭环）。
 * - G04 点发送后真实 CLI admission 收到正确 evidenceRefs（canonical user row 的
 *   receiptCount 投影），Agent 收到 <conversation_quote> 原文片段且请求体无 evr_。
 * - G13 ANSWER/COMPARE 各选两篇：逐篇单独签发与复验（chip=2、receiptCount=2、
 *   来源索引 [1]/[2] manifest），模型输入只含通过验证的两篇原文——第三篇干扰笔记
 *   的 token 由 replay fixture 的 bodyExcludes 在请求匹配层强制排除。
 *
 * 边界：真实 Electron main/host/CLI RPC + 真实托管 Vault 文件（隔离 E2E HOME）；
 * 仅上游模型经本仓 R2-agent-handoff.json 回放确定性回复。回放回复的语义质量
 * （「回答能区分不同来源」的生成侧真实性）不在自动化可证范围，G13 按 PARTIAL 记录。
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../helpers/desktop-app.js";
import { restartWithSeededOpenAIProviders } from "../helpers/custom-openai-provider.js";
import { startConversationModelProviderReplayServer } from "../helpers/model-provider-replay.js";
import {
  selectUpstreamProviderModelById,
  waitForUpstreamModelSelected,
} from "../helpers/upstream-provider.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  setV4ComposerText,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";

const CASE_NAME = "R2-agent-handoff";
const MODEL_ID = "e2e-r2-agent-handoff-model";
const PROVIDER_ID = "e2e-r2-agent-handoff-provider";
const SESSION_START_MARKER = "R2_AGENT_HANDOFF_SESSION_START";
const G04_QUESTION = "R2_AGENT_G04_QUESTION: what does the verified single note say?";
const G04_ANSWER_MARKER = "R2_AGENT_G04_ANSWER";
const G13_ANSWER_MARKER = "R2_G13_ANSWER_REPLY";
const G13_COMPARE_MARKER = "R2_G13_COMPARE_REPLY";
/** G03/G04 单篇证据笔记。 */
const SINGLE_TOKEN = "R2SingleBeaconToken2026";
const SINGLE_NOTE_NAME = "R2-Agent-Handoff-Single.md";
/** G13 三篇共同检索词；C 篇是命中但不选的干扰项。 */
const PAIR_TOKEN = "R2PairScope2026";
const PAIR_A_NOTE = "R2-Agent-Handoff-Pair-A.md";
const PAIR_B_NOTE = "R2-Agent-Handoff-Pair-B.md";
const PAIR_C_NOTE = "R2-Agent-Handoff-Pair-C.md";
const PAIR_A_TOKEN = "R2PairAlphaLine2026";
const PAIR_B_TOKEN = "R2PairBetaLine2026";
const PAIR_C_TOKEN = "R2PairGammaLine2026";
const MANIFEST_HEADER = "来源索引（顺序与附带的原文证据片段一致）：";
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
const SINGLE_FILE = join(VAULT_ROOT, SINGLE_NOTE_NAME);
const PAIR_A_FILE = join(VAULT_ROOT, PAIR_A_NOTE);
const PAIR_B_FILE = join(VAULT_ROOT, PAIR_B_NOTE);
const PAIR_C_FILE = join(VAULT_ROOT, PAIR_C_NOTE);

function pairBody(title: string, uniqueToken: string): string {
  return [
    `# ${title}`,
    "",
    `${PAIR_TOKEN} shared scope marker with unique ${uniqueToken} evidence sentence.`,
    "No other fixture file contains this unique token.",
    "",
  ].join("\n");
}
const SINGLE_BODY = [
  "# R2 Agent Handoff Single Evidence",
  "",
  `The ${SINGLE_TOKEN} sentence is the single trusted excerpt for the existing-session handoff.`,
  "Nothing else in this vault contains the single token.",
  "",
].join("\n");
const FIXTURES: Array<{ file: string; body: string }> = [
  { file: SINGLE_FILE, body: SINGLE_BODY },
  { file: PAIR_A_FILE, body: pairBody("R2 Pair Note A", PAIR_A_TOKEN) },
  { file: PAIR_B_FILE, body: pairBody("R2 Pair Note B", PAIR_B_TOKEN) },
  { file: PAIR_C_FILE, body: pairBody("R2 Pair Note C", PAIR_C_TOKEN) },
];

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;

function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "R2 refuses to operate outside the isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "R2 requires an isolated .e2e-home");
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
    { timeout, timeoutMsg: `R2 expected ${label}: ${selector}` },
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
    if (!el || !setter) throw new Error("R2 missing native Ask input");
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
    { timeout: 30_000, timeoutMsg: "R2 Vault index configuration not loaded" },
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
      browser.execute(
        // browser.execute 回调在浏览器端执行，Node 常量必须以参数传入。
        (expectedFiles) => {
          const el = document.querySelector('[data-testid="knowledge-ask-view"]');
          return (
            Number(el?.getAttribute("data-indexed-files") ?? "-1") >= expectedFiles &&
            el?.getAttribute("data-index-job-status") !== "running"
          );
        },
        FIXTURES.length,
      ),
    { timeout: 90_000, timeoutMsg: "R2 real Knowledge index never covered all fixture files" },
  );
}
/** 首次连接隔离托管 Vault 并停在 Ask 页（G61 同款生产链路）。 */
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
    { timeout: 30_000, timeoutMsg: "R2 managed Vault was not authorized by production host" },
  );
  await click('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
  await awaitIndex();
}
async function submitAskQuery(intent: "answer" | "compare", query: string): Promise<void> {
  await click(`[data-testid="ask-intent-${intent}"]`, `${intent} intent`);
  await setAskInput(query);
  await click('[data-testid="ask-submit"]', `submit ${intent} query`);
  await browser.waitUntil(
    () =>
      browser.execute(() => document.querySelectorAll('[data-testid="ask-candidate"]').length > 0),
    { timeout: 90_000, timeoutMsg: `R2 ${intent} query returned no candidates` },
  );
}
async function waitForCandidate(filename: string, timeout = 90_000): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (name) =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]')).some(
            (el) => el.textContent?.includes(name),
          ),
        filename,
      ),
    { timeout, timeoutMsg: `R2 candidate ${filename} unavailable` },
  );
}
interface EvidenceInspection {
  phase: string;
  receiptText: string | null;
  excerpt: string | null;
}
async function readEvidence(filename: string): Promise<EvidenceInspection | null> {
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
  }, filename);
}
/** 点击候选卡上的「加入 Agent（可信证据）」（无专属 testid，按双语文本定位）。 */
async function clickAddToAgent(filename: string): Promise<void> {
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
        filename,
        ADD_TO_AGENT_ZH,
        ADD_TO_AGENT_EN,
      ),
    { timeout: 30_000, timeoutMsg: `R2 add-to-agent button not ready for ${filename}` },
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
    filename,
    ADD_TO_AGENT_ZH,
    ADD_TO_AGENT_EN,
  );
  assert.equal(clicked, true, `R2 failed clicking add-to-agent on ${filename}`);
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
  assert.ok(replay, "R2 replay server is not running");
  const deadline = Date.now() + 30_000;
  for (;;) {
    const records = await readFile(replay.artifactPath, "utf-8")
      .then((text) => (JSON.parse(text).records ?? []) as ReplayRecord[])
      .catch(() => [] as ReplayRecord[]);
    const hit = records.find((record) => record.replay?.fixtureId === fixtureId);
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(
        `R2 replay artifact never recorded fixture ${fixtureId} at ${replay.artifactPath}`,
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
    assert.ok(body.includes(token), `R2 model request must include ${token}`);
  }
  for (const token of mustExclude) {
    assert.ok(!body.includes(token), `R2 model request must NOT include ${token}`);
  }
}
async function assertFixtureFilesUntouched(): Promise<void> {
  for (const fixture of FIXTURES) {
    assert.equal(
      await readFile(fixture.file, "utf8"),
      fixture.body,
      `R2 fixture ${fixture.file} must stay untouched on disk`,
    );
  }
}
async function selectCandidate(filename: string): Promise<void> {
  await waitForCandidate(filename);
  await browser.execute((name) => {
    const card = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
    ).find((el) => el.textContent?.includes(name));
    const button = card?.querySelector<HTMLButtonElement>("button");
    if (!button) throw new Error(`R2 select button missing on ${name}`);
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
    { timeout: 15_000, timeoutMsg: `R2 candidate ${filename} was not selected` },
  );
}
/** 从任意视图回到 Knowledge Ask（G04 结束态在聊天视图，需先重新打开 Vault）。 */
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
/** 交接完成后回 Composer：vault 关闭、composer 文本含全部期望片段。 */
async function waitForHandoffComposer(expectedText: string[], chipCount: number): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (tokens, expectedCount) => {
          const vaultClosed = !document
            .querySelector('[data-testid="vault-view"]')
            ?.getClientRects().length;
          const composer = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
          ).find((el) => tokens.every((token) => (el.textContent ?? "").includes(token)));
          // 选择器歧义修正（D2 调查定谳 2026-10-17）：页面可同时存在非 composer 的
          // 同名计数元素（如回合区/侧聊），首匹配会误中——以命中期望文本的那个
          // composer 输入框为锚，取其 composer 容器（form 或共同父级）内的计数 chip。
          const composerRoot = composer?.closest("form") ?? composer?.parentElement?.parentElement ?? null;
          const chip =
            composerRoot
              ?.querySelector("[data-conversation-selection-reference-count]")
              ?.getAttribute("data-conversation-selection-reference-count") ?? null;
          return Boolean(vaultClosed && composer && chip === String(expectedCount));
        },
        expectedText,
        chipCount,
      ),
    {
      timeout: 45_000,
      timeoutMsg: `R2 handoff composer not prepared for ${expectedText.join(",")}`,
    },
  );
}


describe("R2 agent handoff acceptance: G03/G04/G13 in one real Electron session", () => {
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
        providerName: "R2 Agent Handoff E2E",
      },
    ]);
    if (!provider) throw new Error("R2 seeded replay provider missing");
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
    // G03 前置：真实 CLI 会话已存在并回到 idle（Vault 交接必须绑定已有 Session）。
    await sendV4Prompt(
      `${SESSION_START_MARKER}: create a genuine active conversation before Vault handoff.`,
    );
    await waitForV4AssistantMessageContaining(SESSION_START_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "R2 initial conversation did not become idle",
      90_000,
    );
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

  it("G03 add verified evidence in an existing session re-verifies the current file and attaches a trusted composer chip", async function () {
    this.timeout(240_000);
    await connectVaultAndOpenAsk();
    await setAskInput(SINGLE_TOKEN);
    await click('[data-testid="ask-submit"]', "submit single-note query");
    await waitForCandidate(SINGLE_NOTE_NAME);

    // 先手动核验一次，取得旧 Receipt 作为「重新签发」的对照基线。
    await click('[data-testid="ask-candidate-verify"]', "manual verify baseline receipt");
    await browser.waitUntil(
      async () => (await readEvidence(SINGLE_NOTE_NAME))?.phase === "verified",
      { timeout: 60_000, timeoutMsg: "R2 baseline verify did not pass" },
    );
    const baseline = await readEvidence(SINGLE_NOTE_NAME);
    assert.ok(baseline?.receiptText?.includes("evr_"), "R2 baseline receipt id missing");
    assert.ok(baseline?.excerpt?.includes(SINGLE_TOKEN), "R2 baseline excerpt missing token");

    // 修改原文后点击「加入 Agent（可信证据）」：重新核验必须 fail-closed，
    // 不允许把基于旧版本签发的 Receipt 挂进 Composer。
    const mutated = SINGLE_BODY.replace(SINGLE_TOKEN, `${SINGLE_TOKEN}-R2REFRESH`);
    assert.notEqual(mutated, SINGLE_BODY);
    await writeFile(SINGLE_FILE, mutated, "utf8");
    try {
      await clickAddToAgent(SINGLE_NOTE_NAME);
      await browser.waitUntil(
        async () => (await readEvidence(SINGLE_NOTE_NAME))?.phase === "unavailable",
        { timeout: 60_000, timeoutMsg: "R2 mutated source was not rejected on add-to-agent" },
      );
      assert.equal(
        await readComposerChipCount(),
        0,
        "R2 stale add-to-agent must not attach a composer chip",
      );
    } finally {
      await writeFile(SINGLE_FILE, SINGLE_BODY, "utf8");
    }

    // 恢复原文后再次点击：重新核验通过并签发新 Receipt（与基线不同），chip 出现。
    await clickAddToAgent(SINGLE_NOTE_NAME);
    await browser.waitUntil(
      async () => (await readEvidence(SINGLE_NOTE_NAME))?.phase === "verified",
      { timeout: 60_000, timeoutMsg: "R2 restored source did not re-verify on add-to-agent" },
    );
    const reverified = await readEvidence(SINGLE_NOTE_NAME);
    assert.ok(reverified?.receiptText?.includes("evr_"), "R2 re-verified receipt id missing");
    assert.notEqual(
      reverified?.receiptText,
      baseline?.receiptText,
      "R2 add-to-agent must issue a fresh receipt instead of reusing the verified badge",
    );
    await browser.waitUntil(async () => (await readComposerChipCount()) === 1, {
      timeout: 30_000,
      timeoutMsg: "R2 composer chip did not appear after verified add-to-agent",
    });
    assert.equal(await readFile(SINGLE_FILE, "utf8"), SINGLE_BODY, "R2 source must be restored");
  });

  it("G04 send hands correct evidenceRefs to the real CLI admission and quoted excerpts to the model only", async function () {
    this.timeout(180_000);
    // G03 结束态：composer 已挂当前有效 chip；直接补问题文本并发送。
    assert.equal(await readComposerChipCount(), 1, "G04 expects the G03 trusted chip in composer");
    await setV4ComposerText(G04_QUESTION);
    await click('[data-testid="v4-composer-send"]', "send trusted chip draft to real CLI");
    await waitForV4AssistantMessageContaining(G04_ANSWER_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "R2 G04 evidence turn did not settle",
      90_000,
    );

    // CLI admission 的权威投影：canonical user row 携带 evidenceRefs（receiptCount=1）。
    let diagnostics: TurnDiagnostics | null = null;
    await browser.waitUntil(
      async () => {
        diagnostics = await readTurnDiagnostics(G04_QUESTION);
        return diagnostics !== null;
      },
      { timeout: 30_000, timeoutMsg: "R2 G04 turn diagnostics unavailable" },
    );
    assert.equal(
      diagnostics!.receiptCount,
      1,
      "G04 CLI admission must receive exactly one evidenceRef",
    );
    assert.equal(diagnostics!.quoteCount, 1, "G04 CLI must receive the quoted original excerpt");
    // 说明：chip（「加入 Agent」）模式没有 handoff 来源编号清单，完成态回答的可信
    // [n] 按钮体系按设计不适用（knowledgeTurnCitations.ts 要求 user row 恰含一次
    // 「来源索引」manifest；G36/G43 禁止模型 [1] 凭文字获得原文权限）。G04 判据
    // （evidenceRefs/门禁接受/原文片段入模）不包含 citation 按钮，不在此断言。

    // 模型请求体：Agent 收到 <conversation_quote> 原文片段；Receipt ID 与失效版本不入 prompt。
    const record = await waitForReplayRecord("r2-agent-handoff-g04-single");
    assertModelRequest(
      record,
      ["<conversation_quote>", SINGLE_TOKEN, SINGLE_NOTE_NAME, G04_QUESTION],
      ["evr_", "R2REFRESH", PAIR_TOKEN],
    );
    console.info(
      `R2 G04 admitted receipts=${diagnostics!.receiptCount} quotes=${diagnostics!.quoteCount} citations=${diagnostics!.turnCitationCount}`,
    );
    await assertFixtureFilesUntouched();
  });

  it("G13 ANSWER with two selected notes issues per-source receipts and only verified excerpts reach the model", async function () {
    this.timeout(240_000);
    await returnToAsk();
    await submitAskQuery("answer", PAIR_TOKEN);
    await waitForCandidate(PAIR_A_NOTE);
    await waitForCandidate(PAIR_B_NOTE);
    await selectCandidate(PAIR_A_NOTE);
    await selectCandidate(PAIR_B_NOTE);
    // 未选中的第三篇干扰笔记必须保持未选中。
    const cSelected = await browser.execute(
      (name) =>
        Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
          .find((el) => el.textContent?.includes(name))
          ?.getAttribute("aria-selected") === "true",
      PAIR_C_NOTE,
    );
    assert.equal(cSelected, false, "R2 distractor note must stay unselected");

    await click('[data-testid="ask-agent-handoff-submit"]', "prepare two-source ANSWER handoff");
    await waitForHandoffComposer(
      [
        "请仅依据附带的 Obsidian 可信证据回答",
        MANIFEST_HEADER,
        `[1] path=`,
        PAIR_A_NOTE,
        `[2] path=`,
        PAIR_B_NOTE,
      ],
      2,
    );

    await click('[data-testid="v4-composer-send"]', "send two-source ANSWER draft");
    await waitForV4AssistantMessageContaining(G13_ANSWER_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "R2 G13 ANSWER turn did not settle",
      90_000,
    );
    let diagnostics: TurnDiagnostics | null = null;
    await browser.waitUntil(
      async () => {
        diagnostics = await readTurnDiagnostics(MANIFEST_HEADER);
        return diagnostics !== null;
      },
      { timeout: 30_000, timeoutMsg: "R2 G13 ANSWER turn diagnostics unavailable" },
    );
    assert.equal(diagnostics!.receiptCount, 2, "G13 ANSWER must admit two per-source receipts");
    assert.equal(diagnostics!.quoteCount, 2, "G13 ANSWER must carry two quoted excerpts");
    assert.equal(
      diagnostics!.hasManifest,
      true,
      "G13 ANSWER user row must keep the source manifest",
    );
    assert.equal(
      diagnostics!.turnCitationCount,
      2,
      "G13 ANSWER completed turn must render [1] and [2]",
    );

    // fixture 的 bodyExcludes 已在匹配层拒绝携带干扰篇原文的请求；此处再显式断言请求体。
    const record = await waitForReplayRecord("r2-agent-handoff-g13-answer-pair");
    assertModelRequest(
      record,
      [
        "<conversation_quote>",
        PAIR_TOKEN,
        PAIR_A_TOKEN,
        PAIR_B_TOKEN,
        MANIFEST_HEADER,
        PAIR_A_NOTE,
        PAIR_B_NOTE,
      ],
      ["evr_", PAIR_C_TOKEN],
    );
    await assertFixtureFilesUntouched();
  });

  it("G13 COMPARE requires two selected notes and both verified excerpts reach the model", async function () {
    this.timeout(240_000);
    await returnToAsk();
    await submitAskQuery("compare", PAIR_TOKEN);
    await waitForCandidate(PAIR_A_NOTE);
    await waitForCandidate(PAIR_B_NOTE);
    await selectCandidate(PAIR_A_NOTE);
    // COMPARE 交接最少两篇：只选一篇时交接按钮必须保持禁用。
    const disabledWithOne = await browser.execute(() =>
      Boolean(
        document.querySelector<HTMLButtonElement>('[data-testid="ask-agent-handoff-submit"]')
          ?.disabled,
      ),
    );
    assert.equal(disabledWithOne, true, "COMPARE handoff must stay disabled with a single source");
    await selectCandidate(PAIR_B_NOTE);
    await click('[data-testid="ask-agent-handoff-submit"]', "prepare two-source COMPARE handoff");
    await waitForHandoffComposer(
      [
        "请根据附带的 Obsidian 可信证据比较相关笔记",
        MANIFEST_HEADER,
        `[1] path=`,
        PAIR_A_NOTE,
        `[2] path=`,
        PAIR_B_NOTE,
      ],
      2,
    );

    await click('[data-testid="v4-composer-send"]', "send two-source COMPARE draft");
    await waitForV4AssistantMessageContaining(G13_COMPARE_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "R2 G13 COMPARE turn did not settle",
      90_000,
    );
    let diagnostics: TurnDiagnostics | null = null;
    await browser.waitUntil(
      async () => {
        diagnostics = await readTurnDiagnostics("请根据附带的 Obsidian 可信证据比较相关笔记");
        return diagnostics !== null;
      },
      { timeout: 30_000, timeoutMsg: "R2 G13 COMPARE turn diagnostics unavailable" },
    );
    assert.equal(diagnostics!.receiptCount, 2, "G13 COMPARE must admit two per-source receipts");
    assert.equal(diagnostics!.turnCitationCount, 2, "G13 COMPARE turn must render [1] and [2]");

    const record = await waitForReplayRecord("r2-agent-handoff-g13-compare-pair");
    assertModelRequest(
      record,
      [
        "<conversation_quote>",
        PAIR_A_TOKEN,
        PAIR_B_TOKEN,
        MANIFEST_HEADER,
        PAIR_A_NOTE,
        PAIR_B_NOTE,
      ],
      ["evr_", PAIR_C_TOKEN],
    );
    await assertFixtureFilesUntouched();
  });
});
