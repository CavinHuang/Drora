/**
 * R6 验收包（多源与草稿保护）：G16 + G26 + G27，出自
 * docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md 验收矩阵。
 *
 * - G16 多篇 ANSWER 中修改其中一篇后点击准备交接：整批交接 fail-closed
 *   （prepareKnowledgeAgentHandoff 逐篇 prepareEvidence+resolveCitation，任一
 *   非 current 即 evidence_unavailable），另一篇可信材料不得单独送进 Agent。
 * - G26 交接后删除/篡改来源清单（表头、来源行、行号、chip 删第二篇）：
 *   validateKnowledgeSourceManifest 判 mismatch → 发送按钮禁用 + 显示来源清单
 *   不一致提示；Enter 与按钮共用 submit 边界二次校验，命令不出站、草稿保留；
 *   重回问库重新准备可恢复。
 * - G27 换序/篡改来源行必定拒绝；只修改自然语言提问（清单与凭据不动）可发送，
 *   并由真实 CLI admission 再次复验两个 Receipt。
 *
 * 边界：真实 Electron main/host/CLI RPC + 真实托管 Vault 文件（隔离 E2E HOME）；
 * 仅上游模型经本仓 R6-source-manifest-guard.json 回放确定性回复。
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../helpers/desktop-app.js";
import { restartWithSeededOpenAIProviders } from "../helpers/custom-openai-provider.js";
import { startConversationModelProviderReplayServer } from "../helpers/model-provider-replay.js";
import { getToastMessages } from "../helpers/conversation-session-toast.js";
import {
  selectUpstreamProviderModelById,
  waitForUpstreamModelSelected,
} from "../helpers/upstream-provider.js";
import {
  getV4ComposerText,
  prepareV4ConversationE2E,
  sendV4Prompt,
  setV4ComposerText,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";

const CASE_NAME = "R6-source-manifest-guard";
const MODEL_ID = "e2e-r6-manifest-guard-model";
const PROVIDER_ID = "e2e-r6-manifest-guard-provider";
const SESSION_START_MARKER = "R6_SESSION_START";
const G27_ANSWER_MARKER = "R6_G27_ANSWER";
const G27_EDITED_QUESTION = "R6_G27_QUESTION_EDITED";
/** 两篇共用的检索词；各篇携带唯一证据 token。 */
const PAIR_TOKEN = "R6PairSource2026";
const NOTE_A_NAME = "R6-Manifest-Guard-A.md";
const NOTE_B_NAME = "R6-Manifest-Guard-B.md";
const ALPHA_TOKEN = "R6SourceAlpha2026";
const BETA_TOKEN = "R6SourceBeta2026";
const INVALID_SUFFIX = "-R6INVALIDATED";
const MANIFEST_HEADER = "来源索引（顺序与附带的原文证据片段一致）：";
/** handoff fail-closed 的 toast 文案（en/zh 各取稳定子串）。 */
const HANDOFF_UNAVAILABLE_EN = "No sources were attached";
const HANDOFF_UNAVAILABLE_ZH = "没有加入任何证据";
/** 引用 chip 逐条删除 / removeAll 按钮的 aria-label（双语）。 */
const REMOVE_SELECTION_ZH = "移除对话引用";
const REMOVE_SELECTION_EN = "Remove conversation selection";

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
function noteBody(title: string, uniqueToken: string): string {
  return [
    `# ${title}`,
    "",
    `${PAIR_TOKEN} shared retrieval token with ${uniqueToken} unique evidence sentence.`,
    "No other fixture file contains this unique token.",
    "",
  ].join("\n");
}
const NOTE_A_BODY = noteBody("R6 Manifest Guard A", ALPHA_TOKEN);
const NOTE_B_BODY = noteBody("R6 Manifest Guard B", BETA_TOKEN);
const FIXTURES: Array<{ file: string; body: string }> = [
  { file: join(VAULT_ROOT, NOTE_A_NAME), body: NOTE_A_BODY },
  { file: join(VAULT_ROOT, NOTE_B_NAME), body: NOTE_B_BODY },
];

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;

function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "R6 refuses to operate outside the isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "R6 requires an isolated .e2e-home");
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
    { timeout, timeoutMsg: `R6 expected ${label}: ${selector}` },
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
    if (!el || !setter) throw new Error("R6 missing native Ask input");
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
    { timeout: 30_000, timeoutMsg: "R6 Vault index configuration not loaded" },
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
      browser.execute((expectedFiles) => {
        const el = document.querySelector('[data-testid="knowledge-ask-view"]');
        return (
          Number(el?.getAttribute("data-indexed-files") ?? "-1") >= expectedFiles &&
          el?.getAttribute("data-index-job-status") !== "running"
        );
      }, FIXTURES.length),
    { timeout: 90_000, timeoutMsg: "R6 real Knowledge index never covered all fixture files" },
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
    { timeout: 30_000, timeoutMsg: "R6 managed Vault was not authorized by production host" },
  );
  await click('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
  await awaitIndex();
}
async function submitAskQuery(query: string): Promise<void> {
  await click('[data-testid="ask-intent-answer"]', "ANSWER intent");
  await setAskInput(query);
  await click('[data-testid="ask-submit"]', "submit ANSWER query");
  await browser.waitUntil(
    () =>
      browser.execute(() => document.querySelectorAll('[data-testid="ask-candidate"]').length > 0),
    { timeout: 90_000, timeoutMsg: "R6 ANSWER query returned no candidates" },
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
    { timeout, timeoutMsg: `R6 candidate ${filename} unavailable` },
  );
}
async function selectCandidate(filename: string): Promise<void> {
  await waitForCandidate(filename);
  await browser.execute((name) => {
    const card = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
    ).find((el) => el.textContent?.includes(name));
    const button = card?.querySelector<HTMLButtonElement>("button");
    if (!button) throw new Error(`R6 select button missing on ${name}`);
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
    { timeout: 15_000, timeoutMsg: `R6 candidate ${filename} was not selected` },
  );
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
async function readRowCount(): Promise<number> {
  return browser.execute(() => document.querySelectorAll("[data-row-id]").length);
}
/** validateKnowledgeSourceManifest mismatch 的可观察 UI 面：alert + 发送禁用。 */
async function readManifestGuard(): Promise<{ mismatchVisible: boolean; sendDisabled: boolean }> {
  return browser.execute(() => ({
    mismatchVisible: Boolean(
      document.querySelector('[data-testid="knowledge-source-manifest-mismatch"]')?.getClientRects()
        .length,
    ),
    sendDisabled: Boolean(
      document.querySelector<HTMLButtonElement>('[data-testid="v4-composer-send"]')?.disabled,
    ),
  }));
}
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
          const chip =
            document
              .querySelector<HTMLElement>("[data-conversation-selection-reference-count]")
              ?.getAttribute("data-conversation-selection-reference-count") ?? null;
          return Boolean(vaultClosed && composer && chip === String(expectedCount));
        },
        expectedText,
        chipCount,
      ),
    {
      timeout: 45_000,
      timeoutMsg: `R6 handoff composer not prepared for ${expectedText.join(",")}`,
    },
  );
}
/** 从任意视图回到 Knowledge Ask 并重新检索选中两篇（G26 恢复路径）。 */
async function researchAndSelectPair(): Promise<void> {
  const vaultVisible = await browser.execute(() =>
    Boolean(document.querySelector('[data-testid="vault-view"]')?.getClientRects().length),
  );
  if (!vaultVisible) {
    await click('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
    await waitFor('[data-testid="vault-view"]', "Vault panel");
  }
  await click('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
  await awaitIndex();
  await submitAskQuery(PAIR_TOKEN);
  await waitForCandidate(NOTE_A_NAME);
  await waitForCandidate(NOTE_B_NAME);
  await selectCandidate(NOTE_A_NAME);
  await selectCandidate(NOTE_B_NAME);
}
async function readTurnDiagnostics(userMarker: string): Promise<{
  receiptCount: number;
  quoteCount: number;
  hasManifest: boolean;
} | null> {
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
async function waitForReplayRecord(fixtureId: string): Promise<ReplayRecord> {
  assert.ok(replay, "R6 replay server is not running");
  const deadline = Date.now() + 30_000;
  for (;;) {
    const records = await readFile(replay.artifactPath, "utf-8")
      .then((text) => (JSON.parse(text).records ?? []) as ReplayRecord[])
      .catch(() => [] as ReplayRecord[]);
    const hit = records.find((record) => record.replay?.fixtureId === fixtureId);
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(
        `R6 replay artifact never recorded fixture ${fixtureId} at ${replay.artifactPath}`,
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
    assert.ok(body.includes(token), `R6 model request must include ${token}`);
  }
  for (const token of mustExclude) {
    assert.ok(!body.includes(token), `R6 model request must NOT include ${token}`);
  }
}
async function assertFixtureFilesUntouched(): Promise<void> {
  for (const fixture of FIXTURES) {
    assert.equal(
      await readFile(fixture.file, "utf8"),
      fixture.body,
      `R6 fixture ${fixture.file} must stay untouched on disk`,
    );
  }
}
/** handoff fail-closed 的 warning toast（waitForToastContaining 硬编码 5s，此处放宽）。 */
async function waitForHandoffFailureToast(timeout = 30_000): Promise<void> {
  await browser.waitUntil(
    async () => {
      const messages = await getToastMessages();
      return messages.some(
        (message) =>
          message.includes(HANDOFF_UNAVAILABLE_EN) || message.includes(HANDOFF_UNAVAILABLE_ZH),
      );
    },
    { timeout, timeoutMsg: "R6 stale batch handoff never surfaced the evidence_unavailable toast" },
  );
}
/** composer 草稿的原始 manifest 文本；it2/it3 的所有篡改都基于该 pristine 基线。 */
async function readPristineDraft(): Promise<string> {
  let latest: string | null = null;
  await browser.waitUntil(
    async () => {
      latest = await getV4ComposerText();
      return latest !== null && latest.includes(MANIFEST_HEADER);
    },
    { timeout: 30_000, timeoutMsg: "R6 composer draft never contained the source manifest" },
  );
  assert.ok(latest, "R6 pristine draft must be readable after wait");
  return latest;
}
/** 引用 chip 的 hover 浮层里逐条删除第二篇（真实 UI 删除路径）。 */
async function removeSecondReferenceViaChip(): Promise<void> {
  // radix HoverCard trigger：React 合成 onPointerEnter 由 pointerover 冒泡派生，
  // 同时补发 pointerenter 覆盖原生监听；openDelay=0，浮层立即渲染到 portal。
  const opened = await browser.execute(() => {
    const pill = document.querySelector<HTMLElement>(
      "[data-conversation-selection-reference-count]",
    );
    if (!pill) return false;
    pill.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    pill.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
    return true;
  });
  assert.equal(opened, true, "R6 selection chip pill missing before hover");
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          // 浮层内容里每条可信引用都渲染 composer-evidence-pending-revalidation 标记。
          document.querySelectorAll('[data-testid="composer-evidence-pending-revalidation"]')
            .length >= 2,
      ),
    { timeout: 15_000, timeoutMsg: "R6 selection hover card did not open with both references" },
  );
  const removed = await browser.execute(
    (zh, en) => {
      const entries = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="composer-evidence-pending-revalidation"]',
        ),
      );
      const second = entries[1];
      if (!second) return false;
      // Tailwind 的 group/reference class 含 "/"，不是合法 CSS 选择器；
      // closest(".group/reference") 会抛 SyntaxError，改按 classList 逐级找容器。
      let container: HTMLElement | null = second;
      while (container && !container.classList.contains("group/reference")) {
        container = container.parentElement;
      }
      if (!container) return false;
      const trash = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) =>
          button.getAttribute("aria-label") === zh || button.getAttribute("aria-label") === en,
      );
      if (!trash) return false;
      trash.click();
      return true;
    },
    REMOVE_SELECTION_ZH,
    REMOVE_SELECTION_EN,
  );
  assert.equal(removed, true, "R6 failed removing the second reference from the hover card");
}
/** 引用 chip 的 removeAll（pill 右侧 X）：G26 恢复路径先清空旧引用。 */
async function removeAllReferencesViaChip(): Promise<void> {
  const removed = await browser.execute(
    (zh, en) => {
      const pill = document.querySelector<HTMLElement>(
        "[data-conversation-selection-reference-count]",
      );
      if (!pill) return false;
      const clear = Array.from(pill.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) =>
          button.getAttribute("aria-label") === zh || button.getAttribute("aria-label") === en,
      );
      if (!clear) return false;
      clear.click();
      return true;
    },
    REMOVE_SELECTION_ZH,
    REMOVE_SELECTION_EN,
  );
  assert.equal(removed, true, "R6 failed clearing selection references");
}

describe("R6 multi-source and draft protection: G16/G26/G27 in one real Electron session", () => {
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
        providerName: "R6 Source Manifest Guard E2E",
      },
    ]);
    if (!provider) throw new Error("R6 seeded replay provider missing");
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
    // 前置：真实 CLI 会话已存在并回到 idle（Vault 交接必须绑定已有 Session）。
    await sendV4Prompt(
      `${SESSION_START_MARKER}: create a genuine active conversation before multi-source handoff.`,
    );
    await waitForV4AssistantMessageContaining(SESSION_START_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "R6 initial conversation did not become idle",
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

  it("G16 invalidating one of two selected sources fails the whole handoff batch closed", async function () {
    this.timeout(240_000);
    await connectVaultAndOpenAsk();
    await submitAskQuery(PAIR_TOKEN);
    await waitForCandidate(NOTE_A_NAME);
    await waitForCandidate(NOTE_B_NAME);
    await selectCandidate(NOTE_A_NAME);
    await selectCandidate(NOTE_B_NAME);

    const rowCountBefore = await readRowCount();
    const chipBefore = await readComposerChipCount();
    assert.equal(chipBefore, 0, "G16 expects an empty composer before handoff");

    // 交接前让第二篇失效：sha256 与检索候选不再一致。
    const mutatedB = NOTE_B_BODY.replace(BETA_TOKEN, `${BETA_TOKEN}${INVALID_SUFFIX}`);
    assert.notEqual(mutatedB, NOTE_B_BODY);
    await writeFile(FIXTURES[1]!.file, mutatedB, "utf8");
    try {
      await click(
        '[data-testid="ask-agent-handoff-submit"]',
        "attempt batch handoff with one stale source",
      );
      // 整批 fail-closed：evidence_unavailable toast，而非只送另一篇。
      await waitForHandoffFailureToast();
      // browser.execute 回调在浏览器端执行，Node 常量必须以参数传入。
      const state = await browser.execute(
        (header, alpha) => ({
          vaultOpen: Boolean(
            document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
          ),
          composerHasManifest: Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
          ).some((el) => (el.textContent ?? "").includes(header)),
          composerHasAlpha: Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
          ).some((el) => (el.textContent ?? "").includes(alpha)),
        }),
        MANIFEST_HEADER,
        ALPHA_TOKEN,
      );
      assert.equal(state.vaultOpen, true, "G16 failed handoff must stay in the Vault view");
      assert.equal(
        state.composerHasManifest,
        false,
        "G16 must not hand any source manifest to the Agent composer",
      );
      assert.equal(
        state.composerHasAlpha,
        false,
        "G16 must not forward the still-valid first source alone",
      );
      assert.equal(await readComposerChipCount(), 0, "G16 must attach no trusted chips");
      assert.equal(
        await readRowCount(),
        rowCountBefore,
        "G16 failed handoff must not create conversation rows",
      );
    } finally {
      await writeFile(FIXTURES[1]!.file, NOTE_B_BODY, "utf8");
    }

    // 对照：恢复第二篇后同一批次交接成功，证明此前拒绝确由失效来源触发。
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            !document
              .querySelector('[data-testid="ask-agent-handoff-submit"]')
              ?.matches(":disabled"),
        ),
      { timeout: 15_000, timeoutMsg: "R6 handoff button never re-enabled after restore" },
    );
    await click(
      '[data-testid="ask-agent-handoff-submit"]',
      "retry batch handoff with both sources current",
    );
    await waitForHandoffComposer([MANIFEST_HEADER, NOTE_A_NAME, NOTE_B_NAME], 2);
  });

  it("G26 deleting or tampering with the source manifest blocks send and keeps the draft", async function () {
    this.timeout(240_000);
    const pristine = await readPristineDraft();
    const lines = pristine.split("\n");
    const headerIndex = lines.findIndex((line) => line === MANIFEST_HEADER);
    assert.notEqual(headerIndex, -1, "R6 pristine draft lost the manifest header");
    const sourceA = lines.find((line) => line.startsWith("[1] path="));
    const sourceB = lines.find((line) => line.startsWith("[2] path="));
    assert.ok(sourceA && sourceB, "R6 pristine draft must carry both numbered source lines");

    // 基线 valid：无 mismatch 提示且发送可用。
    await browser.waitUntil(
      async () => {
        const guard = await readManifestGuard();
        return !guard.mismatchVisible && !guard.sendDisabled;
      },
      {
        timeout: 15_000,
        timeoutMsg: "R6 pristine handoff draft unexpectedly mismatched or unsent",
      },
    );
    const rowCountBefore = await readRowCount();

    // ① 删除第二篇来源行（用户直接编辑草稿）。
    await setV4ComposerText(lines.filter((line) => line !== sourceB).join("\n"));
    await browser.waitUntil(async () => (await readManifestGuard()).mismatchVisible, {
      timeout: 15_000,
      timeoutMsg: "R6 removing source line 2 did not raise the manifest mismatch alert",
    });
    assert.equal(
      (await readManifestGuard()).sendDisabled,
      true,
      "G26 send button must be disabled after removing a source line",
    );

    // Enter 与按钮共用 submit 边界：真实键入 Enter 也不得出站。
    await browser.execute(() => {
      document.querySelector<HTMLElement>('[data-testid^="v4-composer-input"]')?.click();
    });
    await browser.keys("Enter");
    // EC-5（e2e-a-5，2026-10-18 终审）修复：原实现是固定 pause(1_000) 后单次读取
    // ——B-5/G53 已废除的同款反模式：慢环境下 Enter 后草稿防抖重解析/横幅重渲染
    // 可能尚未稳定，单次采样要么假红（横幅瞬时消失）要么漏检迟到出站。改为
    // waitUntil 轮询「未出站」稳定态：行数不变+草稿保留+mismatch 横幅仍在，
    // 三条件同时成立才算 settle（若真出站，行数永久增加、草稿离场，轮询必然超时）。
    const settledNegative = await browser.waitUntil(
      async () => {
        const settled = await browser.execute(
          (token) => ({
            rowCount: document.querySelectorAll("[data-row-id]").length,
            draftKept: Array.from(
              document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
            ).some((el) => (el.textContent ?? "").includes(token)),
            mismatchStillVisible: Boolean(
              document
                .querySelector('[data-testid="knowledge-source-manifest-mismatch"]')
                ?.getClientRects().length,
            ),
          }),
          NOTE_A_NAME,
        );
        return (
          settled.rowCount === rowCountBefore && settled.draftKept && settled.mismatchStillVisible
        );
      },
      {
        timeout: 15_000,
        timeoutMsg:
          "G26 Enter must not send the mismatched draft and must keep it with the alert visible",
      },
    );
    assert.equal(settledNegative, true, "G26 Enter must not send the mismatched draft");
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "G26 mismatched Enter must never start an Agent turn",
      20_000,
    );

    // ② 删除/篡改来源清单表头（表头是 marker，缺失或重复都判 mismatch）。
    await setV4ComposerText(lines.filter((line) => line !== MANIFEST_HEADER).join("\n"));
    await browser.waitUntil(async () => (await readManifestGuard()).mismatchVisible, {
      timeout: 15_000,
      timeoutMsg: "R6 removing the manifest header did not raise mismatch",
    });
    assert.equal(
      (await readManifestGuard()).sendDisabled,
      true,
      "G26 header removal must disable send",
    );

    // ③ 篡改第二篇来源行号（行内容与凭据附带的 evidenceSource 不一致）。
    const tamperedB = sourceB!.replace(/lines=\d+-\d+/, "lines=90-99");
    assert.notEqual(tamperedB, sourceB);
    await setV4ComposerText(lines.map((line) => (line === sourceB ? tamperedB : line)).join("\n"));
    await browser.waitUntil(async () => (await readManifestGuard()).mismatchVisible, {
      timeout: 15_000,
      timeoutMsg: "R6 tampering source line numbers did not raise mismatch",
    });
    assert.equal(
      (await readManifestGuard()).sendDisabled,
      true,
      "G26 line tampering must disable send",
    );

    // ④ chip 内删除第二篇引用（真实 UI 删除路径）：prompt 仍列两行 → mismatch。
    await setV4ComposerText(pristine);
    await browser.waitUntil(async () => !(await readManifestGuard()).mismatchVisible, {
      timeout: 15_000,
      timeoutMsg: "R6 restored pristine draft still mismatched before chip removal",
    });
    await removeSecondReferenceViaChip();
    await browser.waitUntil(
      async () => {
        const guard = await readManifestGuard();
        return (await readComposerChipCount()) === 1 && guard.mismatchVisible && guard.sendDisabled;
      },
      {
        timeout: 15_000,
        timeoutMsg: "R6 chip-level second-source removal did not produce mismatch+disabled",
      },
    );

    // 恢复：清空草稿与引用后重回问库重新准备，guard 解除且全程无出站。
    await setV4ComposerText("");
    await removeAllReferencesViaChip();
    await browser.waitUntil(async () => (await readComposerChipCount()) === 0, {
      timeout: 15_000,
      timeoutMsg: "R6 selection references were not cleared for recovery",
    });
    await researchAndSelectPair();
    await click('[data-testid="ask-agent-handoff-submit"]', "re-prepare handoff after recovery");
    await waitForHandoffComposer([MANIFEST_HEADER, NOTE_A_NAME, NOTE_B_NAME], 2);
    await browser.waitUntil(
      async () => {
        const guard = await readManifestGuard();
        return !guard.mismatchVisible && !guard.sendDisabled;
      },
      {
        timeout: 15_000,
        timeoutMsg: "R6 re-prepared draft did not recover to a valid sendable state",
      },
    );
    assert.equal(
      await readRowCount(),
      rowCountBefore,
      "G26 whole scenario must never dispatch a conversation row",
    );
  });

  it("G27 reordered manifest is rejected while a question-only edit sends after CLI reverification", async function () {
    this.timeout(240_000);
    const pristine = await readPristineDraft();
    const lines = pristine.split("\n");
    const idxA = lines.findIndex((line) => line.startsWith("[1] path="));
    const idxB = lines.findIndex((line) => line.startsWith("[2] path="));
    assert.ok(idxA >= 0 && idxB >= 0, "R6 G27 pristine draft must carry both source lines");

    // ① 换序：编号行与凭据 index 不再对应 → 必定拒绝。
    const swapped = [...lines];
    [swapped[idxA], swapped[idxB]] = [swapped[idxB]!, swapped[idxA]!];
    await setV4ComposerText(swapped.join("\n"));
    await browser.waitUntil(
      async () => {
        const guard = await readManifestGuard();
        return guard.mismatchVisible && guard.sendDisabled;
      },
      { timeout: 15_000, timeoutMsg: "R6 swapping source order was not rejected" },
    );

    // ② 只修改自然语言问题（清单与凭据原样保留）→ 恢复可发送。
    const questionEdited = pristine.replace(
      /^问题：.*$/m,
      `问题：${G27_EDITED_QUESTION}（仅修改自然语言提问，来源清单不动）`,
    );
    assert.notEqual(questionEdited, pristine, "R6 G27 question line was not actually edited");
    await setV4ComposerText(questionEdited);
    await browser.waitUntil(
      async () => {
        const guard = await readManifestGuard();
        return !guard.mismatchVisible && !guard.sendDisabled;
      },
      { timeout: 15_000, timeoutMsg: "R6 question-only edit stayed blocked" },
    );

    await click('[data-testid="v4-composer-send"]', "send question-only edited two-source draft");
    await waitForV4AssistantMessageContaining(G27_ANSWER_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "R6 G27 evidence turn did not settle",
      90_000,
    );
    // CLI admission 权威投影：两个 Receipt 均再次复验通过，manifest 保留在 user row。
    let diagnostics: Awaited<ReturnType<typeof readTurnDiagnostics>> = null;
    await browser.waitUntil(
      async () => {
        diagnostics = await readTurnDiagnostics(MANIFEST_HEADER);
        return diagnostics !== null;
      },
      { timeout: 30_000, timeoutMsg: "R6 G27 turn diagnostics unavailable" },
    );
    assert.equal(diagnostics!.receiptCount, 2, "G27 CLI must reverify and admit both receipts");
    assert.equal(diagnostics!.quoteCount, 2, "G27 model input must keep both quoted excerpts");
    assert.equal(diagnostics!.hasManifest, true, "G27 user row must retain the source manifest");

    // 模型请求体：两篇核验原文均入模；失效版本的 BETA 文本不入 prompt。
    // 注（EC-6/e2e-a-6，2026-10-18 终审修正陈旧表述）：D1 修复（2026-10-17）后
    // <conversation_quote> 按模型可见字段白名单序列化，evidenceReceiptId（evr_）
    // 不再进入 prompt，与 G03「Receipt ID 不拼入模型 prompt」判据已一致；该维度
    // 属 R2/G03 验收范围，本包（G16/G26/G27）判据不含该项，故不在此断言。
    const record = await waitForReplayRecord("r6-manifest-g27-admit");
    assertModelRequest(
      record,
      ["<conversation_quote>", ALPHA_TOKEN, BETA_TOKEN, MANIFEST_HEADER, G27_EDITED_QUESTION],
      [INVALID_SUFFIX],
    );
    await assertFixtureFilesUntouched();
  });
});
