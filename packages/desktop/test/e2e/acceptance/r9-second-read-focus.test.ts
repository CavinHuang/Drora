/**
 * R9 验收包（二次读取与焦点）：G47 + G53 + G54 + G55（按 PR #23 验收执行单 B 节
 * 的编号；docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md 矩阵对应行为
 * G54 / G47(前半) / G53 / G55(前半)，详见各用例注释的双向映射）。
 *
 * - G47（执行单编号；smoke 矩阵 G54）：服务端 resolveCitation=current 之后、
 *   VaultView 第二次 readFile 之前修改摘录 240 字符以外内容 → 完整文件 SHA-256
 *   校验必须拒绝，不打开错误内容。真实 E2E 可测面：改动落在 quote 摘录窗口
 *   之外（>240 字符）时点击引用被结构化 stale 拒绝且零导航；完全未变化时
 *   正常定位（正向对照）。精确的「resolve 与第二次读之间的亚毫秒渲染窗口」
 *   无产品注入点（citationFacade/evidenceRegistry 无延迟参数、服务不在 window
 *   暴露），由 packages/ui/test/knowledgeCitationNavigation.test.ts 的
 *   matchesKnowledgeCitationFileReadback 回归单测覆盖（VaultView.tsx 的
 *   validateRead 生产消费同一函数），本用例按 PARTIAL 口径如实记录。
 * - G53（执行单编号；smoke 矩阵 G47 前半「已有未存草稿不丢」）：本地编辑器
 *   存在无法保存的草稿（Windows 只读属性使 saveFile 失败）时点击可信来源 →
 *   flush 失败 fail-closed，不改变笔记选择/不覆盖原编辑器内容，草稿跨视图
 *   卸载保留（vault-document-controller 模块级 Map），恢复入口（丢弃并重载）
 *   可用。subagent 视角：DOM 断言（草稿文本、横幅、磁盘内容），非真人手感。
 * - G54（执行单编号；smoke 矩阵 G53）：同一同步栈内点击引用后立即切 B（React
 *   离散事件同步 flush，resolveCitation IPC 回包不可能先于 B 提交，epoch 单调
 *   前进），再分步切回 A（A→B→A；React 18 批处理会把同栈的 B+A 合并为 A→A，
 *   实测不构成真实切换）→ 旧请求绝不复活：不激活 Vault、不选中旧 quote、不抢
 *   activeElement；普通非引用编辑（composer 键入）聚焦不受影响。
 *   「CodeMirror 尚未 ready 的 pending reveal 窗口」无注入点，由
 *   packages/ui/test/vaultQuoteRevealCodeMirror.test.ts（epoch 失配不选不聚焦）
 *   与 VaultView.tsx isVaultCitationFocusCurrent 消费覆盖。
 * - G55（执行单编号；smoke 矩阵 G55 前半「正常双行 quote 定位正确」）：已验证
 *   引用进入真实 CodeMirror → 选区起止恰好落在双行 quote 的两行、scrollIntoView
 *   把目标带回视口、编辑器聚焦。subagent 视角：DOM 选区/activeElement/rect
 *   断言，非真人手感。单行/越界行锚定由 vaultQuoteRevealCodeMirror 单测覆盖。
 *
 * 已发现产品缺陷（本包实测触发，未改产品代码，如实记录）：非文件末尾 chunk 的
 * chunkSha256 与 quote 切片 sha256 恒不相等（markdownChunker 的 chunk text 不含
 * 行尾换行，而 quoteSliceSha256 的切片含 chunk 末行的换行；仅文件最后一个 chunk
 * 因幻影空行恰好一致）→ 任何多段笔记的非末段命中都无法通过 prepareEvidence
 * （首轮真实运行即在本包 prerequisite 复现：prepareEvidence RPC OK 但返回
 * stale，handoff 提示 evidence_unavailable）。既有单测/E2E 全部使用单 chunk
 * 笔记故未暴露。规避方式：本 fixture 不用标题、引用双行构成文件最后一个 chunk
 * 且文件不以换行结尾。复现脚本见验收记录（真实 chunkMarkdown + sha256 对比）。
 */
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../helpers/desktop-app.js";
import { restartWithSeededOpenAIProviders } from "../helpers/custom-openai-provider.js";
import { startConversationModelProviderReplayServer } from "../helpers/model-provider-replay.js";
import {
  selectUpstreamProviderModelById,
  waitForUpstreamModelSelected,
} from "../helpers/upstream-provider.js";
import {
  getV4ConversationState,
  prepareV4ConversationE2E,
  sendV4Prompt,
  setV4ComposerText,
  startNewV4Draft,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";

const CASE_NAME = "R9-second-read-focus";
const MODEL_ID = "e2e-r9-focus-model-id";
const PROVIDER_ID = "e2e-r9-focus-provider";
const SESSION_A_MARKER = "R9_SESSION_A_START";
const SESSION_B_MARKER = "R9_SESSION_B_START";
const ANSWER_MARKER = "R9_G55_REPLY";
const QUERY = "R9QuoteBeaconToken2026";
const NOTE_NAME = "R9-Second-Read-Focus.md";
const DRAFT_MARKER = "R9UnsavedDraftBeacon2026";
const FOCUS_PROBE = "R9_FOCUS_PROBE_2026";
const QUOTE_LINE_1 = `${QUERY} anchors the final chunk line`;
const QUOTE_LINE_2 = "and this second line completes the verified double-line quote.";
const FILLER_PARAGRAPHS = Array.from({ length: 6 }, (_, paragraph) =>
  Array.from(
    { length: 10 },
    (_, line) =>
      `R9 filler ${paragraph}-${line}: alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar.`,
  ).join("\n"),
);
// 结构约束（缺陷规避，见文件头注释）：无标题、引用双行必须是文件最后一个 chunk
// 且文件不以换行结尾，才能让 chunk sha 与 quote 切片 sha 一致，prepareEvidence 可签发。
const SOURCE = `${FILLER_PARAGRAPHS.join("\n\n")}\n\n${QUOTE_LINE_1}\n${QUOTE_LINE_2}`;
// 修改点落在第一段 filler（文件头部），距 quote 摘录 >5000 字符（远超 240 字符窗口）。
const OUT_OF_EXCERPT_EDIT = SOURCE.replace(
  "R9 filler 0-0:",
  "R9 filler 0-0 modified beyond the quoted excerpt:",
);
assert.notEqual(OUT_OF_EXCERPT_EDIT, SOURCE);
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

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;
let sessionAId: string | null = null;
let sessionBId: string | null = null;
let citationTurnReady = false;

function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "R9 refuses to operate outside the isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "R9 requires isolated .e2e-home");
  assert.ok(FILE.startsWith(join(HOME, ".drora") + sep));
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
    { timeout, timeoutMsg: `R9 expected ${label}: ${selector}` },
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
    if (!el || !setter) throw new Error("R9 missing native Ask input");
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
    { timeout: 30_000, timeoutMsg: "R9 Vault index configuration not loaded" },
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
    {
      timeout: 90_000,
      timeoutMsg: "R9 real Knowledge index did not report a file",
    },
  );
}

/** 点击侧栏任务项回到 chat 主视图（workspaceMainView 互斥，任务点击才回 chat）。 */
async function returnToChatView(taskId: string): Promise<void> {
  await click(`[data-testid="task-item-${taskId}"]`, `sidebar task ${taskId}`);
  await browser.waitUntil(
    () =>
      browser.execute(
        () => !document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
      ),
    {
      timeout: 30_000,
      timeoutMsg: "R9 chat view did not replace the Vault main view",
    },
  );
}

async function waitForToast(pattern: RegExp, label: string): Promise<void> {
  const toastText = () => browser.execute((): string => document.body.innerText);
  await browser.waitUntil(async () => pattern.test((await toastText()) ?? ""), {
    timeout: 6_000,
    interval: 200,
    timeoutMsg: `R9 expected toast ${label}`,
  });
}

interface CitationSelectionSnapshot {
  nativeText: string | null;
  lineCount: number;
  firstLine: string | null;
  lastLine: string | null;
  firstLineTop: number | null;
  editorFocused: boolean;
  viewportHeight: number;
}
/**
 * 读取 CodeMirror 的引用选区。CM6 聚焦时选区同步为原生 DOM Selection；若原生
 * 选区不可读（隐藏装饰等），以 .cm-selectionBackground 图层与行矩形重叠作后备。
 */
async function readCitationSelection(): Promise<CitationSelectionSnapshot> {
  return browser.execute(() => {
    const content = document.querySelector<HTMLElement>(".cm-content");
    const editor = document.querySelector<HTMLElement>(".cm-editor");
    const lines = content ? Array.from(content.querySelectorAll<HTMLElement>(".cm-line")) : [];
    const selection = window.getSelection();
    let nativeText: string | null = null;
    let hitLines: HTMLElement[] = [];
    if (
      content &&
      selection &&
      selection.rangeCount > 0 &&
      content.contains(selection.anchorNode) &&
      !selection.isCollapsed
    ) {
      const range = selection.getRangeAt(0);
      nativeText = range.toString();
      hitLines = lines.filter((line) => range.intersectsNode(line));
    } else {
      const layers = Array.from(
        document.querySelectorAll<HTMLElement>(".cm-selectionBackground"),
      ).filter((layer) => layer.getClientRects().length > 0);
      hitLines = lines.filter((line) => {
        const lineRect = line.getBoundingClientRect();
        return layers.some((layer) => {
          const layerRect = layer.getBoundingClientRect();
          return layerRect.top < lineRect.bottom && layerRect.bottom > lineRect.top;
        });
      });
    }
    return {
      nativeText,
      lineCount: hitLines.length,
      firstLine: hitLines[0]?.textContent?.trim() ?? null,
      lastLine: hitLines[hitLines.length - 1]?.textContent?.trim() ?? null,
      firstLineTop: hitLines[0] ? Math.round(hitLines[0].getBoundingClientRect().top) : null,
      editorFocused: Boolean(
        editor && (document.activeElement === editor || editor.contains(document.activeElement)),
      ),
      viewportHeight: window.innerHeight,
    };
  });
}

/** 等待引用回跳完成：notes 视图 + CodeMirror 原文 + 已应用的双行选区。 */
async function waitForRevealedQuote(): Promise<CitationSelectionSnapshot> {
  await browser.waitUntil(
    async () => {
      const opened = await browser.execute(
        (token) =>
          Boolean(
            document
              .querySelector('[data-testid="vault-tab-notes"]')
              ?.getAttribute("aria-selected") === "true" &&
            Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
              (el) => el.textContent?.includes(token) && el.getClientRects().length > 0,
            ),
          ),
        QUERY,
      );
      if (!opened) return false;
      const snapshot = await readCitationSelection();
      return snapshot.lineCount === 2 && snapshot.editorFocused;
    },
    {
      timeout: 30_000,
      interval: 200,
      timeoutMsg: "R9 citation open did not reveal the verified quote",
    },
  );
  return readCitationSelection();
}

/**
 * 连续两次采样断言 Vault 主视图未被激活（照 B-5 防迟到漏检模式）。注意：Vault
 * 一旦打开过，WorkspaceShellLayout 会以 hidden 容器常驻挂载 VaultView（含其
 * CodeMirror），因此「未激活」判据是主视图可见性，不是编辑器是否存在于 DOM。
 */
async function sampleVaultNeverActivated(label: string): Promise<void> {
  const read = () =>
    browser.execute(() => ({
      vaultVisible: Boolean(
        document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
      ),
      editorMounted: document.querySelectorAll(".cm-content").length > 0,
    }));
  const first = await read();
  await browser.pause(1_000);
  const second = await read();
  assert.equal(
    first.vaultVisible || second.vaultVisible,
    false,
    `R9 ${label}: citation must not activate the Vault main view (samples=${JSON.stringify([first, second])})`,
  );
}

async function assertSourceIntact(label: string): Promise<void> {
  assert.equal(
    await readFile(FILE, "utf8"),
    SOURCE,
    `R9 ${label}: the isolated Vault file must equal the original fixture`,
  );
}

describe("R9 second read and focus: G47/G53/G54/G55", () => {
  before(async function () {
    this.timeout(300_000);
    assertSandbox();
    await mkdir(ROOT, { recursive: true });
    await writeFile(FILE, SOURCE, { encoding: "utf8", flag: "wx" });
    replay = await startConversationModelProviderReplayServer(CASE_NAME);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    const [provider] = await restartWithSeededOpenAIProviders([
      {
        modelId: MODEL_ID,
        providerId: PROVIDER_ID,
        providerName: "R9 Second Read Focus E2E",
      },
    ]);
    if (!provider) throw new Error("R9 seeded replay provider missing");
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
    // G47/G53/G54/G55 的可信引用必须绑定一个已存在的真实 CLI Session A。
    await sendV4Prompt(
      `${SESSION_A_MARKER}: create a genuine active conversation before Vault queries.`,
    );
    await waitForV4AssistantMessageContaining("R9_SESSION_A_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "R9 session A did not become idle",
      90_000,
    );
    const stateA = await getV4ConversationState();
    sessionAId = stateA.taskId ?? null;
    assert.ok(sessionAId, "R9 session A task id missing");
  });

  after(async () => {
    assertSandbox();
    await chmod(FILE, 0o666).catch(() => undefined);
    const text = await readFile(FILE, "utf8").catch(() => null);
    if (text === SOURCE) await rm(FILE);
    await replay?.stop();
    replay = null;
    await browser.electron.restoreAllMocks();
  });

  it("prerequisite: one real ANSWER handoff turn renders a single trusted citation", async function () {
    this.timeout(240_000);
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
      { timeout: 30_000, timeoutMsg: "R9 managed Vault was not configured" },
    );
    await click('[data-testid="vault-tab-ask"]', "Ask tab");
    await awaitIndex();
    await click('[data-testid="ask-intent-answer"]', "ANSWER intent");
    await setAskInput(QUERY);
    await click('[data-testid="ask-submit"]', "submit real Vault search");
    await browser.waitUntil(
      () =>
        browser.execute(
          (name) =>
            Array.from(
              document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
            ).some((el) => el.textContent?.includes(name)),
          NOTE_NAME,
        ),
      { timeout: 60_000, timeoutMsg: "R9 indexed candidate unavailable" },
    );
    await click('[data-testid="ask-candidate"] button', "select the actual file candidate");
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            document
              .querySelector('[data-testid="ask-candidate"]')
              ?.getAttribute("aria-selected") === "true",
        ),
      { timeout: 15_000, timeoutMsg: "R9 ANSWER candidate not selected" },
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
        timeoutMsg: "R9 trusted handoff never returned to the live composer",
      },
    );
    await click('[data-testid="v4-composer-send"]', "send verified draft to the real CLI");
    await waitForV4AssistantMessageContaining(ANSWER_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "R9 evidence turn did not settle",
      90_000,
    );
    await waitFor('[data-testid="knowledge-inline-citation-1"]', "inline trusted citation button");
    await waitFor('[data-testid="knowledge-answer-source-1"]', "answer source action button");
    citationTurnReady = true;
  });

  it("G55 double-line quote: exact two-line selection, scroll-back and editor focus", async function () {
    this.timeout(180_000);
    if (!citationTurnReady) this.skip();
    // 首次正向打开：选区恰好覆盖双行 quote，编辑器聚焦。
    await click(
      '[data-testid="knowledge-inline-citation-1"]',
      "open verified double-line citation",
    );
    const first = await waitForRevealedQuote();
    assert.equal(first.lineCount, 2, `R9 G55 selection lines (snapshot=${JSON.stringify(first)})`);
    assert.equal(first.firstLine, QUOTE_LINE_1);
    assert.equal(first.lastLine, QUOTE_LINE_2);
    // CM6 按块级 .cm-line 渲染，range.toString() 不含行间换行；行级起止已由
    // lineCount/first/last 断言，这里只要求原生选区文本按序覆盖两行内容。
    assert.ok(
      first.nativeText !== null &&
        first.nativeText.includes(QUOTE_LINE_1) &&
        first.nativeText.includes(QUOTE_LINE_2),
      `R9 G55 native selection must cover both quoted lines (nativeText=${JSON.stringify(first.nativeText)})`,
    );
    assert.equal(first.editorFocused, true, "R9 G55 reveal must focus CodeMirror");
    assert.ok(
      first.firstLineTop !== null &&
        first.firstLineTop >= 0 &&
        first.firstLineTop < first.viewportHeight,
      `R9 G55 quoted lines must be scrolled into the viewport (top=${first.firstLineTop}, vh=${first.viewportHeight})`,
    );
    await assertSourceIntact("G55 first open");
    // 滚动语义：reveal 后编辑器应停在文件底部（scrollTop>0）；手动滚回顶部使
    // quote（文件末尾）离开视口，再从 chat 重新打开引用，scrollIntoView(center)
    // 必须把目标行带回视口（否则选中行 top 在视口外）。
    const scrolledState = await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>(".vault-ink-mde .cm-scroller");
      if (!scroller) return null;
      const before = scroller.scrollTop;
      scroller.scrollTop = 0;
      return { before };
    });
    assert.ok(
      scrolledState && scrolledState.before > 0,
      `R9 G55 reveal must leave the note scrolled down (scrollTop=${scrolledState?.before})`,
    );
    await browser.pause(400);
    const awayTop = await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>(".vault-ink-mde .cm-scroller");
      const lines = Array.from(document.querySelectorAll<HTMLElement>(".cm-content .cm-line"));
      const last = lines[lines.length - 1];
      return {
        scrollTop: scroller?.scrollTop ?? -1,
        lastLineTop: last ? Math.round(last.getBoundingClientRect().top) : null,
        viewportHeight: window.innerHeight,
      };
    });
    assert.equal(awayTop.scrollTop, 0, "R9 G55 manual top scroll must take effect");
    await returnToChatView(sessionAId!);
    await click(
      '[data-testid="knowledge-inline-citation-1"]',
      "re-open citation after manual bottom scroll",
    );
    const second = await waitForRevealedQuote();
    assert.equal(second.lineCount, 2);
    assert.equal(second.firstLine, QUOTE_LINE_1);
    assert.equal(second.lastLine, QUOTE_LINE_2);
    assert.ok(
      second.firstLineTop !== null && second.firstLineTop >= 0,
      `R9 G55 re-reveal must scroll the quote back into view (pre-scroll=${JSON.stringify(awayTop)}, after=${second.firstLineTop})`,
    );
    await assertSourceIntact("G55 re-open");
  });

  it("G47 out-of-excerpt edit: full-file SHA guard rejects the open without wrong content", async function () {
    this.timeout(180_000);
    if (!citationTurnReady) this.skip();
    // 修改落在 quote 摘录 240 字符之外（文件头部第一段 filler，距文件末尾的
    // quote 摘录 >5000 字符）。
    await writeFile(FILE, OUT_OF_EXCERPT_EDIT, "utf8");
    await returnToChatView(sessionAId!);
    try {
      await click(
        '[data-testid="knowledge-inline-citation-1"]',
        "attempt citation open after out-of-excerpt edit",
      );
      await waitForToast(/笔记内容已变更|The note has changed/, "structured stale feedback");
      await sampleVaultNeverActivated("G47 out-of-excerpt rejection");
      assert.equal(
        await readFile(FILE, "utf8"),
        OUT_OF_EXCERPT_EDIT,
        "R9 G47 the modified file must stay exactly as written (no write-back)",
      );
    } finally {
      await writeFile(FILE, SOURCE, "utf8");
    }
    // 正向对照：完全未变化（SHA 还原）时同一 Receipt 重新 current 并正常定位。
    await click(
      '[data-testid="knowledge-inline-citation-1"]',
      "re-open citation after restoring the original SHA",
    );
    const restored = await waitForRevealedQuote();
    assert.equal(restored.lineCount, 2);
    assert.equal(restored.firstLine, QUOTE_LINE_1);
    assert.equal(restored.lastLine, QUOTE_LINE_2);
    await assertSourceIntact("G47 positive control");
  });

  it("G54 A→B→A race: the late citation never revives, steals focus or disturbs normal editing", async function () {
    this.timeout(240_000);
    if (!citationTurnReady || !sessionAId) this.skip();
    await startNewV4Draft();
    await sendV4Prompt(
      `${SESSION_B_MARKER}: establish an independent second session without any evidence.`,
    );
    await waitForV4AssistantMessageContaining("R9_SESSION_B_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "R9 session B did not become idle",
      90_000,
    );
    const stateB = await getV4ConversationState();
    sessionBId = stateB.taskId ?? null;
    assert.ok(sessionBId, "R9 session B task id missing");
    assert.notEqual(sessionBId, sessionAId, "R9 requires two distinct sessions");

    await returnToChatView(sessionAId);
    await waitFor(
      '[data-testid="knowledge-inline-citation-1"]',
      "A inline trusted citation button",
    );
    // 竞态构造：React 18 会把同一同步栈内的 B、A 两次任务点击批处理成一次
    // A→A 提交（epoch 从未推进，引用会合法打开——第二轮实测踩过）。因此第一
    // 步只在同一同步栈内点击「引用 + 切 B」（离散事件同步 flush，resolveCitation
    // IPC 回包不可能先于 B 的提交），B 必然真实提交、epoch 单调前进；随后再
    // 分步点击回 A。无论 IPC 回包落在 B 期间还是回到 A 之后，旧请求都已被
    // 失效，必须 fail-closed，绝不打开/复活/抢焦点。
    const raced = await browser.execute((taskB) => {
      const citation = document.querySelector<HTMLElement>(
        '[data-testid="knowledge-inline-citation-1"]',
      );
      const itemB = document.querySelector<HTMLElement>(`[data-testid="${taskB}"]`);
      if (!citation || !itemB) {
        return {
          citation: Boolean(citation),
          itemB: Boolean(itemB),
          clicked: false,
        };
      }
      citation.click();
      itemB.click();
      return { citation: true, itemB: true, clicked: true };
    }, `task-item-${sessionBId}`);
    assert.deepEqual(
      raced,
      { citation: true, itemB: true, clicked: true },
      "R9 G54 race clicks did not land",
    );
    await browser.waitUntil(async () => (await getV4ConversationState()).taskId === sessionBId, {
      timeout: 30_000,
      timeoutMsg: "R9 G54 session switch to B did not take effect",
    });
    // 回到与初始完全相同的 A 身份：A→B→A 完成，旧引用请求不得复活。
    await returnToChatView(sessionAId!);
    await browser.waitUntil(async () => (await getV4ConversationState()).taskId === sessionAId, {
      timeout: 30_000,
      timeoutMsg: "R9 G54 did not return to session A",
    });
    await browser.pause(1_000);
    await sampleVaultNeverActivated("G54 late citation after A→B→A");
    // 普通非引用编辑聚焦不受影响：composer 键入期间 activeElement 不被抢走。
    const composer = await $('[data-testid^="v4-composer-input"]');
    await composer.click();
    await browser.keys(FOCUS_PROBE);
    const probe1 = await browser.execute((probe) => {
      const el = document.querySelector<HTMLElement>('[data-testid^="v4-composer-input"]');
      const active = document.activeElement;
      return {
        typed: el?.textContent?.includes(probe) ?? false,
        focusHeld: Boolean(el && (active === el || el.contains(active))),
        activeIsEditor: Boolean(
          active?.closest?.(".cm-editor") ?? active?.classList?.contains("cm-content"),
        ),
      };
    }, FOCUS_PROBE);
    await browser.pause(1_000);
    const probe2 = await browser.execute(() => {
      const el = document.querySelector<HTMLElement>('[data-testid^="v4-composer-input"]');
      const active = document.activeElement;
      return Boolean(el && (active === el || el.contains(active)));
    });
    assert.equal(probe1.typed, true, "R9 G54 composer keystrokes must land");
    assert.equal(probe1.focusHeld, true, "R9 G54 normal editing focus must be held while typing");
    assert.equal(
      probe1.activeIsEditor,
      false,
      "R9 G54 no CodeMirror element may hold focus after the race",
    );
    assert.equal(probe2, true, "R9 G54 composer focus must persist across the settle window");
    await setV4ComposerText("");
    await assertSourceIntact("G54 race");
  });

  it("G53 unsavable draft: citation open fails closed and the draft survives view switches", async function () {
    this.timeout(240_000);
    if (!citationTurnReady) this.skip();
    // 防御上一用例残留的主视图状态：确保从 A 的 chat 视图开始。
    await returnToChatView(sessionAId!);
    // 正向打开一次，让编辑器持有当前笔记。
    await click(
      '[data-testid="knowledge-inline-citation-1"]',
      "open note before creating the unsavable draft",
    );
    await waitForRevealedQuote();
    // Windows 只读属性 → 真实 saveFile 失败 → 草稿成为「无法保存的草稿」。
    await chmod(FILE, 0o444);
    try {
      const firstLine = await $(".cm-content .cm-line");
      await firstLine.click();
      await browser.keys(DRAFT_MARKER);
      await browser.waitUntil(
        () =>
          browser.execute(
            (marker) =>
              Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some((el) =>
                el.textContent?.includes(marker),
              ),
            DRAFT_MARKER,
          ),
        { timeout: 15_000, timeoutMsg: "R9 G53 draft keystrokes did not land" },
      );
      // 700ms 防抖自动保存真实失败：横幅出现、磁盘保持原文（证明确实存不进去）。
      await browser.pause(2_000);
      const draftVisible = await browser.execute(
        () =>
          /草稿未保存|Draft unsaved/.test(document.body.innerText) ||
          /保存失败|Save failed/.test(document.body.innerText),
      );
      assert.equal(
        draftVisible,
        true,
        "R9 G53 the read-only file must produce a visible unsavable-draft state",
      );
      assert.equal(
        await readFile(FILE, "utf8"),
        SOURCE,
        "R9 G53 disk must stay untouched while the draft cannot be saved",
      );
      // 切走（卸载编辑器，草稿留在 vault-document-controller 模块级 Map）再点击引用：
      // flush 失败必须 fail-closed —— 不激活 Vault、不覆盖编辑器内容。
      await returnToChatView(sessionAId!);
      await click(
        '[data-testid="knowledge-inline-citation-1"]',
        "attempt citation open with an unsavable draft",
      );
      await waitForToast(
        /引用核验失败|Citation verification failed/,
        "structured failed feedback for the blocked citation open",
      );
      await sampleVaultNeverActivated("G53 unsavable draft rejection");
      // 重进 Vault 并从文件树重开同一笔记：草稿仍在、磁盘仍未被覆盖。
      await click('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
      await waitFor('[data-testid="vault-view"]', "Vault panel after re-entry");
      await waitFor(
        `[data-testid="vault-view"] button[title="${NOTE_NAME}"]`,
        "file tree entry for the drafted note",
      );
      await click(
        `[data-testid="vault-view"] button[title="${NOTE_NAME}"]`,
        "reopen the drafted note from the file tree",
      );
      await browser.waitUntil(
        () =>
          browser.execute(
            (marker) =>
              Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
                (el) => el.textContent?.includes(marker) && el.getClientRects().length > 0,
              ),
            DRAFT_MARKER,
          ),
        {
          timeout: 30_000,
          timeoutMsg: "R9 G53 the unsaved draft must survive the view switch",
        },
      );
      assert.equal(
        await readFile(FILE, "utf8"),
        SOURCE,
        "R9 G53 the blocked citation open must never overwrite the note on disk",
      );
      // 恢复入口可用：解除只读后「丢弃并重载」回到原文。
      await chmod(FILE, 0o666);
      const discarded = await browser.execute(() => {
        const button = Array.from(
          document.querySelectorAll<HTMLButtonElement>('[data-testid="vault-view"] button'),
        ).find((el) => /丢弃并重载|Discard & reload/.test(el.textContent ?? ""));
        if (!button) return false;
        button.click();
        return true;
      });
      assert.equal(
        discarded,
        true,
        "R9 G53 the documented discard-and-reload recovery must be reachable",
      );
      await browser.waitUntil(
        () =>
          browser.execute(
            (marker) =>
              !Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some((el) =>
                el.textContent?.includes(marker),
              ),
            DRAFT_MARKER,
          ),
        {
          timeout: 30_000,
          timeoutMsg: "R9 G53 discard-and-reload did not restore the base content",
        },
      );
      await assertSourceIntact("G53 after recovery");
    } finally {
      await chmod(FILE, 0o666).catch(() => undefined);
    }
  });
});
