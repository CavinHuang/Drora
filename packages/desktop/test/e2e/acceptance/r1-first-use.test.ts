/**
 * R1 验收包（首次使用）：G01 + G02，出自 docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md。
 *
 * - G01 使用全新测试环境启动 Electron，连接临时 Obsidian Vault，建立索引：
 *   `configured=true`；索引任务真实完成且覆盖文件数符合夹具（本 spec 预置 3 个
 *     Markdown 文件，断言 data-indexed-files === 3，任务终态 completed）。
 * - G02 在 VaultView 智能问库用中文/英文检索唯一句子：候选相对路径、引用片段
 *     来自真实原文、verify 后 quote 行区间覆盖唯一句子的真实行号（第 3 行）。
 *
 * 与 G58（obsidian-knowledge-positive.test.ts）的差异：G58 只断言 count>=1 且
 * job!=="running"；本 spec 对 G01 加严为「任务 completed + 计数精确等于夹具数」，
 * 对 G02 增加中文查询与行号位置核对。夹具全部位于隔离 E2E HOME 的 managed-vault，
 * 不发起模型请求，不触碰生产 Vault。
 *
 * 说明：G02「中文检索唯一标题/句子」判据中的相关性质量（真人判断命中结果与查询
 * 意图的贴合度）无法由本 subagent 代替人工判断——本 spec 只验证命中真实性、路径/
 * 片段/位置的机械准确性，G02 按 PARTIAL 记录（依据 PR #23 验收执行单附加要求）。
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../helpers/desktop-app.js";

const E2E_HOME = resolve(dirname(DEFAULT_WORKSPACE));
const DATA_BASE = resolve(process.env.DRORA_DATA_BASE_DIR?.trim() || E2E_HOME);
const VAULT_ROOT = join(
  DATA_BASE,
  ".drora",
  "cli",
  "data",
  "obsidian@drora-plugins-official",
  "managed-vault",
);
// G02 中文笔记放在子目录：同时覆盖相对路径（notes/...）与文件名两种路径形态。
const CN_NOTE_DIR = join(VAULT_ROOT, "notes");
const CN_NOTE_NAME = "R1-Chinese-Unique-Note.md";
const CN_NOTE_REL = `notes/${CN_NOTE_NAME}`;
const EN_NOTE_NAME = "R1-English-Unique-Note.md";
const FILLER_NOTE_NAME = "R1-Filler-Note.md";
const CN_FILE = join(CN_NOTE_DIR, CN_NOTE_NAME);
const EN_FILE = join(VAULT_ROOT, EN_NOTE_NAME);
const FILLER_FILE = join(VAULT_ROOT, FILLER_NOTE_NAME);
/** 夹具文件总数：G01 覆盖文件数必须精确等于该值。 */
const FIXTURE_FILE_COUNT = 3;
/** 唯一中文检索句（11 个汉字，bigram 全库唯一，不含 tokenizer 虚词表中的字）。 */
const CN_QUERY = "琥珀庭院琉璃灯影第七夜熄灭";
/** 唯一英文检索词。 */
const EN_QUERY = "CedarSignalBeacon2026";
/** 唯一句子/词元所在的真实行号（1-based，两个笔记同构：第 1 行标题、第 3 行句子）。 */
const UNIQUE_LINE = 3;
const CN_BODY = [
  "# 琉璃灯影信标笔记",
  "",
  `${CN_QUERY}，此句全库唯一。`,
  "后续段落不含检索词元，仅用于占据行位。",
  "",
].join("\n");
const EN_BODY = [
  "# R1 English Beacon Note",
  "",
  `${EN_QUERY} is the unique English token for R1 first-use acceptance.`,
  "No other fixture file contains this token.",
  "",
].join("\n");
const FILLER_BODY = ["# R1 filler note", "", "占位内容，不含任何检索 token。", ""].join("\n");

const FIXTURES: Array<{ file: string; body: string }> = [
  { file: CN_FILE, body: CN_BODY },
  { file: EN_FILE, body: EN_BODY },
  { file: FILLER_FILE, body: FILLER_BODY },
];

function assertIsolatedVault(): void {
  // 与 G58/G61 同款护栏：HOME 与服务数据基必须一致，绝不落到用户真实 ~/.drora。
  assert.equal(DATA_BASE, E2E_HOME, "R1 refuses a different DRORA_DATA_BASE_DIR");
  assert.match(E2E_HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "R1 requires isolated .e2e-home");
  for (const fixture of FIXTURES) {
    assert.ok(fixture.file.startsWith(join(E2E_HOME, ".drora") + sep));
  }
}

async function waitForVisible(selector: string, label: string, timeout = 30_000): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute((target) => {
        const element = document.querySelector<HTMLElement>(target);
        return Boolean(
          element &&
          element.getClientRects().length > 0 &&
          !(element instanceof HTMLButtonElement && element.disabled),
        );
      }, selector),
    { timeout, timeoutMsg: `R1 ${label} not visible/enabled: ${selector}` },
  );
}

async function clickControl(selector: string, label: string): Promise<void> {
  await waitForVisible(selector, label);
  const clicked = await browser.execute((target) => {
    const element = document.querySelector<HTMLElement>(target);
    if (!element) return false;
    element.click();
    return true;
  }, selector);
  assert.equal(clicked, true, `R1 failed clicking ${label}`);
}

/** React 受控 textarea：native setter + input 事件（与 G58 同款驱动方式）。 */
async function setAskInput(text: string): Promise<void> {
  await browser.execute((value) => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid="ask-input"]');
    if (!input) throw new Error("R1 Ask textarea missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error("R1 textarea setter missing");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

interface AskIndexState {
  configured: string;
  indexedFiles: number;
  job: string;
}

async function readAskIndexState(): Promise<AskIndexState> {
  return browser.execute(() => {
    const view = document.querySelector('[data-testid="knowledge-ask-view"]');
    return {
      configured: view?.getAttribute("data-index-configured") ?? "missing",
      indexedFiles: Number(view?.getAttribute("data-indexed-files") ?? "-1"),
      job: view?.getAttribute("data-index-job-status") ?? "none",
    };
  });
}

interface CandidateInspection {
  relativePath: string | null;
  cardContainsQuery: boolean;
  lineText: string | null;
  excerpt: string | null;
  receiptText: string | null;
}

/**
 * 从包含目标文件名的候选卡提取：相对路径（按钮内第 2 个 span，见
 * KnowledgeCandidateCard.tsx 的 button>span 结构）、verify 后 ask-evidence 的
 * 行号文本与摘录原文。行号行按「含 d–d 数字对」识别，兼容 zh「第 X–Y 行」与
 * en「Lines X–Y」两种 i18n 形态。
 */
async function inspectVerifiedCandidate(filename: string): Promise<CandidateInspection | null> {
  return browser.execute((name) => {
    const card = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
    ).find((el) => el.textContent?.includes(name));
    if (!card) return null;
    const relativePath = card.querySelector("button")?.children[1]?.textContent?.trim() ?? null;
    const evidence = card.querySelector<HTMLElement>('[data-testid="ask-evidence"]');
    const paragraphs = evidence
      ? Array.from(evidence.querySelectorAll<HTMLParagraphElement>("p"))
      : [];
    const lineText =
      paragraphs.find((p) => /\d+\s*[–—-]\s*\d+/.test(p.textContent ?? ""))?.textContent ?? null;
    // verified 分支（KnowledgeCandidateCard.tsx）固定顺序：[0] 文案、[1] 行号、
    // [2] 摘录、[3] Receipt。摘录行额外校验不含 Receipt 前缀，防错位。
    const excerpt =
      (paragraphs[2]?.textContent && !paragraphs[2].textContent.includes("evr_")
        ? paragraphs[2].textContent
        : null) ?? null;
    const receiptText = paragraphs[3]?.textContent ?? null;
    return {
      relativePath,
      cardContainsQuery: Boolean(card.textContent),
      lineText,
      excerpt,
      receiptText,
    };
  }, filename);
}

/** 解析「第 X–Y 行 / Lines X–Y」→ { startLine, endLine }。 */
function parseQuoteLines(lineText: string | null): { startLine: number; endLine: number } {
  assert.ok(lineText, `R1 verified candidate did not expose quote line text`);
  const match = lineText.match(/(\d+)\s*[–—-]\s*(\d+)/);
  assert.ok(match, `R1 cannot parse quote lines from: ${lineText}`);
  const startLine = Number(match[1]);
  const endLine = Number(match[2]);
  assert.ok(startLine >= 1 && endLine >= startLine, `R1 invalid quote range: ${lineText}`);
  return { startLine, endLine };
}

function normalizeWhitespace(text: string): string {
  // 摘录/原文比对容忍换行与空白差异，但保持字符顺序（不折叠字符本身）。
  return text.replace(/\s+/g, "");
}

/**
 * G02 机械准确性核对（路径/片段/位置）：
 * 1. excerpt 是磁盘原文的子串（引用片段真实来自该文件，非模型生成）；
 * 2. excerpt 包含唯一检索句（片段与查询相关）；
 * 3. UI 报告的 quote 行区间覆盖唯一句子的真实行号 UNIQUE_LINE；
 * 4. 区间内的原文行拼接后包含 excerpt（行号与片段互洽，位置准确）。
 */
function assertCandidateAccuracy(params: {
  inspection: CandidateInspection;
  diskBody: string;
  expectedRelativePath: string;
  query: string;
  label: string;
}): void {
  const { inspection, diskBody, expectedRelativePath, query, label } = params;
  assert.ok(inspection, `R1 ${label}: candidate card not found`);
  const pathText = inspection.relativePath ?? "";
  assert.ok(
    pathText.endsWith(expectedRelativePath.split("/").pop() ?? ""),
    `R1 ${label}: candidate path mismatch: ${pathText}`,
  );
  assert.ok(
    pathText.replace(/\\/g, "/").includes(expectedRelativePath.split("/")[0] ?? "") ||
      pathText.replace(/\\/g, "/") === expectedRelativePath,
    `R1 ${label}: candidate relative path should be ${expectedRelativePath}, got ${pathText}`,
  );
  assert.ok(inspection.excerpt, `R1 ${label}: verified excerpt missing`);
  const excerpt = inspection.excerpt as string;
  assert.ok(
    normalizeWhitespace(diskBody).includes(normalizeWhitespace(excerpt)),
    `R1 ${label}: excerpt is not a substring of the real on-disk Markdown: ${excerpt}`,
  );
  assert.ok(
    excerpt.includes(query),
    `R1 ${label}: excerpt does not contain the unique query sentence: ${excerpt}`,
  );
  const { startLine, endLine } = parseQuoteLines(inspection.lineText);
  assert.ok(
    startLine <= UNIQUE_LINE && UNIQUE_LINE <= endLine,
    `R1 ${label}: quote lines [${startLine}, ${endLine}] do not cover the real line ${UNIQUE_LINE} of the unique sentence (${inspection.lineText})`,
  );
  const lines = diskBody.split("\n");
  const windowText = normalizeWhitespace(lines.slice(startLine - 1, endLine).join("\n"));
  assert.ok(
    windowText.includes(normalizeWhitespace(excerpt)),
    `R1 ${label}: excerpt not contained in the reported line window [${startLine}, ${endLine}]`,
  );
  assert.ok(
    (inspection.receiptText ?? "").includes("evr_"),
    `R1 ${label}: verified evidence did not expose a server receipt id (${inspection.receiptText})`,
  );
  console.info(
    `R1 ${label}: relativePath=${pathText} quoteLines=${inspection.lineText} excerpt=${excerpt.slice(0, 60)}…`,
  );
}

describe("R1 first-use acceptance: fresh HOME managed Vault index and bilingual FIND", () => {
  let vaultConnected = false;
  let g01IndexCompleted = false;

  before(async function () {
    this.timeout(120_000);
    assertIsolatedVault();
    // 真实 Electron main/host；仅 Vault 夹具是合成的（与 G58 同款边界）。
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await mkdir(CN_NOTE_DIR, { recursive: true });
    for (const fixture of FIXTURES) {
      await writeFile(fixture.file, fixture.body, { encoding: "utf8", flag: "wx" });
    }
  });

  after(async () => {
    // 只清理本 spec 在隔离 E2E HOME 内创建的夹具文件。
    assertIsolatedVault();
    for (const fixture of FIXTURES) {
      const content = await readFile(fixture.file, "utf8").catch(() => null);
      if (content === fixture.body) await rm(fixture.file);
    }
    await rm(CN_NOTE_DIR, { recursive: true, force: true }).catch(() => undefined);
    await browser.electron.restoreAllMocks();
  });

  it("G01 fresh environment: authorize temporary managed Vault and complete a real index covering all fixture files", async function () {
    this.timeout(240_000);
    await clickControl('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
    await waitForVisible('[data-testid="vault-view"]', "Vault main view");
    await clickControl('[data-testid="vault-switcher-trigger"]', "Vault switcher");
    await clickControl('[data-testid="vault-create-managed"]', "authorize isolated managed Vault");

    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Boolean(
            document
              .querySelector('[data-testid="vault-switcher-trigger"]')
              ?.textContent?.includes("Drora Vault"),
          ),
        ),
      {
        timeout: 30_000,
        timeoutMsg: "Temporary managed Vault was not authorized by production host",
      },
    );
    vaultConnected = true;

    await clickControl('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
    await waitForVisible('[data-testid="ask-input"]', "Knowledge Ask input");

    // G01 判据 1：configured=true（来自真实 host getStatus，而非加载帧的缺省态）。
    await browser.waitUntil(async () => (await readAskIndexState()).configured === "true", {
      timeout: 30_000,
      timeoutMsg: "Production Knowledge service did not report configured=true",
    });

    // G01 判据 2：索引任务真实完成。冷启动（0 文件且无任务在跑）时显式点击
    // 「建立索引」触发真实 startReconcile；随后等待任务终态 completed 且覆盖
    // 数精确等于夹具文件数。期间出现的任何 failed/cancelled/superseded 直接失败。
    const initialState = await readAskIndexState();
    console.info(`R1 G01 initial index state: ${JSON.stringify(initialState)}`);
    if (initialState.indexedFiles === 0 && initialState.job !== "running") {
      await clickControl('[data-testid="ask-index-start"]', "start real Vault reconcile");
    }
    let sawCompletedJob = false;
    let sawRunningJob = false;
    await browser.waitUntil(
      async () => {
        const state = await readAskIndexState();
        if (state.job === "running") sawRunningJob = true;
        if (state.job === "completed") sawCompletedJob = true;
        assert.ok(
          !["failed", "cancelled", "superseded"].includes(state.job),
          `R1 G01 index job ended in ${state.job}`,
        );
        return state.indexedFiles === FIXTURE_FILE_COUNT && state.job === "completed";
      },
      {
        timeout: 120_000,
        interval: 500,
        timeoutMsg: `Real index never reported completed with exactly ${FIXTURE_FILE_COUNT} files`,
      },
    );
    const finalState = await readAskIndexState();
    assert.equal(finalState.configured, "true");
    assert.equal(finalState.indexedFiles, FIXTURE_FILE_COUNT);
    assert.equal(finalState.job, "completed");
    // 观察到 running→completed 的迁移是最强证据；未观察到 running（任务极快或
    // auto-reconcile 先完成）时 completed 终态本身仍是服务端事实。
    console.info(
      `R1 G01 final index state: ${JSON.stringify(finalState)} (sawRunning=${sawRunningJob}, sawCompleted=${sawCompletedJob})`,
    );
    g01IndexCompleted = true;
  });

  it("G02 Chinese FIND hits the real Markdown with accurate path, excerpt and quote lines", async function () {
    this.timeout(180_000);
    assert.ok(vaultConnected && g01IndexCompleted, "R1 G02 depends on G01 connection and index");
    await setAskInput(CN_QUERY);
    await clickControl('[data-testid="ask-submit"]', "submit Chinese FIND query");
    await browser.waitUntil(
      () =>
        browser.execute(
          (name) =>
            Array.from(
              document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
            ).some((card) => card.textContent?.includes(name)),
          CN_NOTE_NAME,
        ),
      { timeout: 90_000, timeoutMsg: "Chinese FIND did not return the real indexed candidate" },
    );
    await clickControl('[data-testid="ask-candidate-verify"]', "verify Chinese source");
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Boolean(
            document.querySelector('[data-testid="ask-evidence"][data-evidence-phase="verified"]'),
          ),
        ),
      {
        timeout: 60_000,
        timeoutMsg: "Real prepareEvidence/resolveCitation did not verify (Chinese)",
      },
    );
    const inspection = await inspectVerifiedCandidate(CN_NOTE_NAME);
    assert.ok(inspection, "R1 Chinese candidate card disappeared before inspection");
    const diskBody = await readFile(CN_FILE, "utf8");
    assert.equal(diskBody, CN_BODY, "Chinese fixture must stay untouched on disk");
    assertCandidateAccuracy({
      inspection,
      diskBody,
      expectedRelativePath: CN_NOTE_REL,
      query: CN_QUERY,
      label: "G02-Chinese",
    });
  });

  it("G02 English FIND hits the real Markdown with accurate path, excerpt and quote lines", async function () {
    this.timeout(180_000);
    assert.ok(vaultConnected && g01IndexCompleted, "R1 G02 depends on G01 connection and index");
    await setAskInput(EN_QUERY);
    await clickControl('[data-testid="ask-submit"]', "submit English FIND query");
    await browser.waitUntil(
      () =>
        browser.execute(
          (name) =>
            Array.from(
              document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
            ).some((card) => card.textContent?.includes(name)),
          EN_NOTE_NAME,
        ),
      { timeout: 90_000, timeoutMsg: "English FIND did not return the real indexed candidate" },
    );
    await clickControl('[data-testid="ask-candidate-verify"]', "verify English source");
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Boolean(
            document.querySelector('[data-testid="ask-evidence"][data-evidence-phase="verified"]'),
          ),
        ),
      {
        timeout: 60_000,
        timeoutMsg: "Real prepareEvidence/resolveCitation did not verify (English)",
      },
    );
    const inspection = await inspectVerifiedCandidate(EN_NOTE_NAME);
    assert.ok(inspection, "R1 English candidate card disappeared before inspection");
    const diskBody = await readFile(EN_FILE, "utf8");
    assert.equal(diskBody, EN_BODY, "English fixture must stay untouched on disk");
    assertCandidateAccuracy({
      inspection,
      diskBody,
      expectedRelativePath: EN_NOTE_NAME,
      query: EN_QUERY,
      label: "G02-English",
    });
    // 夹具只在本验收内读取，从未被索引链路写回（G01 判据的只读边界复核）。
    assert.equal(
      await readFile(FILLER_FILE, "utf8"),
      FILLER_BODY,
      "Filler fixture must stay untouched",
    );
  });
});
