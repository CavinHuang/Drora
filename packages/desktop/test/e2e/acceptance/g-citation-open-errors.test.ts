/**
 * G28/G29 验收包（引用点击与错误态），出自
 * docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md 矩阵行 G28/G29（2026-10-18
 * 补记表第 144-145 行明确本批余量：chip 点击→打开的端到端链路与错误态 GUI 呈现）。
 *
 * - G28：将可信笔记「加入 Agent（可信证据）」后，点击 Composer 引用 chip 的
 *   「核验后打开原文」（ConversationSelectionReferenceChip.tsx 的
 *   composer-open-trusted-citation 按钮）→ requestKnowledgeCitationOpen 按
 *   targetSessionId/workspaceKey/receiptId 派发（conversationSelectionReference.ts:100），
 *   由挂载的 VaultView 接手（VaultView.tsx:1467）执行服务端 resolveCitation；
 *   current 时仅凭服务端返回的 relativePath + quote 打开（openNoteFromKnowledge，
 *   VaultView.tsx:1400），CodeMirror 双行定位断言复用 r9-second-read-focus 范式。
 *   本用例与 r9 的差量：入口是 Composer chip（attach 模式，未发送），不是完成态
 *   回答的 inline citation 按钮；G28 判据不发送模型请求。
 * - G29 stale：修改原文后点击 chip → 服务端 resolveCitation 复验 fileSha256 失配
 *   （evidenceRegistry.ts:248 fileModified）→ 结构化 toast
 *   「笔记内容已变更，请重新检索并签发引用。」（zh-CN.ts:1194）+ Vault 主视图零激活
 *   （间隔 1s 双采样）+ 磁盘不被回写。
 * - G29 missing：删除原文后点击 chip → readVaultFile 折叠 null
 *   （evidenceRegistry.ts:244-246 fileDeleted）→ toast「笔记已不存在，无法打开旧引用。」
 *   （zh-CN.ts:1195）+ 零导航。
 * - G29 forbidden（切换 Vault + 同名诱饵不串门）：恢复原文后经 mock 的原生目录选择
 *   对话框（browser.electron.mock("dialog","showOpenDialog")，desktopMainIpcPlatform.ts:148
 *   的 SelectDirectory 链路）把 Vault 切到隔离 HOME 内的第二个 Vault（预置同名
 *   NOTE_NAME、内容含诱饵 token）→ 点击 chip → 服务端 vaultId 失配
 *   （evidenceRegistry.ts:227 vaultSwitched）→ toast「引用所属会话或 Vault 已改变，
 *   拒绝打开。」（zh-CN.ts:1196）+ 零导航 + 页面 CodeMirror 不含诱饵 token
 *   （不打开其他 Vault 的同名文件）。
 * - G29 切换 Session 面 + 正向恢复收尾：切回托管 Vault，新建真实会话 B →
 *   B 的 Composer 不携带 A 的可信 chip（引用 scope 按 session 隔离，旧会话引用
 *   无法在 B 中被点击触发）；回到 A 后同一 chip 重新核验 current 并正常定位
 *   （证明错误态未破坏链路）。
 *
 * 边界与如实记录：
 * - unavailable 态（「当前没有可接收引用的 Obsidian 笔记视图」，zh-CN.ts:1192）
 *   在本流程不可构造：chip 的产生路径必经 Vault Ask（vaultHasOpenedRef 已置位，
 *   WorkspaceShellLayout.tsx:1612-1613 冷 handler 不再 defer），且 VaultView 一旦
 *   打开过就以隐藏容器常驻挂载（r9 实测注释），drora:knowledge-citation-open 总被
 *   接受；异会话（B）下 A 的 chip 不在 DOM，无从点击。该态不在本 spec 断言。
 * - 挂起类（resolveCitation RPC 在途时切换）无产品注入口；本 spec 的 forbidden 由
 *   服务端 vaultSwitched 语义直达（比 UI epoch 竞态更强的确定性构造），epoch 竞态
 *   面已由 r9 G54 真实验证。
 * - fixture 笔记沿用 r9 发现的 chunk sha 缺陷规避结构：无标题、引用双行构成文件
 *   最后一个 chunk 且文件不以换行结尾（缺陷记录见 r9-second-read-focus.test.ts 头注）。
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
  getV4ConversationState,
  prepareV4ConversationE2E,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";

const CASE_NAME = "G28-citation-open-errors";
const MODEL_ID = "e2e-g28-citation-open-model";
const PROVIDER_ID = "e2e-g28-citation-open-provider";
const SESSION_A_MARKER = "G28_SESSION_A_START";
const SESSION_B_MARKER = "G28_SESSION_B_START";
const QUERY = "G28QuoteBeaconToken2026";
const NOTE_NAME = "G28-Citation-Open.md";
const VAULT_B_DIR_NAME = "vault-b-decoy";
const VAULT_B_DISPLAY_NAME = "vault-b-decoy";
const VAULT_B_DECOY_TOKEN = "G28VaultBDecoyToken2026";
const ADD_TO_AGENT_ZH = "加入 Agent（可信证据）";
const ADD_TO_AGENT_EN = "Add verified evidence to Agent";
const OPEN_LOCAL_VAULT_ZH = "打开本地仓库";
const QUOTE_LINE_1 = `${QUERY} anchors the verified composer chip citation`;
const QUOTE_LINE_2 = "and this second line completes the double-line quote for the chip reveal.";
const FILLER_PARAGRAPHS = Array.from({ length: 6 }, (_, paragraph) =>
  Array.from(
    { length: 10 },
    (_, line) =>
      `G28 filler ${paragraph}-${line}: alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar.`,
  ).join("\n"),
);
// 结构约束（r9 缺陷规避）：无标题、引用双行必须是文件最后一个 chunk 且文件不以
// 换行结尾，prepareEvidence 的 chunk sha 才与 quote 切片 sha 一致。
const SOURCE = `${FILLER_PARAGRAPHS.join("\n\n")}\n\n${QUOTE_LINE_1}\n${QUOTE_LINE_2}`;
// 修改点落在文件头部第一段 filler，距文件末尾的 quote 摘录 >5000 字符（远超 240
// 字符 excerpt 窗口）：即使改动在摘录窗口之外，完整文件 SHA 复验也必须拒绝。
const STALE_EDIT = SOURCE.replace(
  "G28 filler 0-0:",
  "G28 filler 0-0 modified after the receipt was issued:",
);
assert.notEqual(STALE_EDIT, SOURCE);
// 第二 Vault 的同名诱饵：相同 relativePath（NOTE_NAME）、完全不同内容。
const VAULT_B_DECOY_BODY = [
  `# ${VAULT_B_DECOY_TOKEN}`,
  "",
  "This decoy note shares the same relative path but must never be opened by the stale composer chip.",
  "",
].join("\n");

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
const VAULT_B_ROOT = join(HOME, VAULT_B_DIR_NAME);
const VAULT_B_FILE = join(VAULT_B_ROOT, NOTE_NAME);

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;
let sessionAId: string | null = null;
let sessionBId: string | null = null;
let chipReady = false;

function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "G28 refuses to operate outside the isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "G28 requires isolated .e2e-home");
  assert.ok(FILE.startsWith(join(HOME, ".drora") + sep));
  assert.ok(VAULT_B_ROOT.startsWith(HOME + sep));
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
    { timeout, timeoutMsg: `G28 expected ${label}: ${selector}` },
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
    if (!el || !setter) throw new Error("G28 missing native Ask input");
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
    { timeout: 30_000, timeoutMsg: "G28 Vault index configuration not loaded" },
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
      timeoutMsg: "G28 real Knowledge index did not report a file",
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
      timeoutMsg: "G28 chat view did not replace the Vault main view",
    },
  );
}

async function waitForToast(pattern: RegExp, label: string): Promise<void> {
  const toastText = () => browser.execute((): string => document.body.innerText);
  await browser.waitUntil(async () => pattern.test((await toastText()) ?? ""), {
    timeout: 8_000,
    interval: 200,
    timeoutMsg: `G28 expected toast ${label}`,
  });
}

/** 读取可见主 Composer 容器（form）内的可信引用 chip 计数；无 chip 返回 0。 */
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

/**
 * 悬停 Composer 的可信引用 chip 并点击 hover card 里的「核验后打开原文」按钮。
 * radix HoverCard 有 ~700ms openDelay，先以真实指针移到 pill（viewport 坐标），
 * 轮询 Portal 内的 composer-open-trusted-citation 按钮出现后再 DOM click；
 * 指针停留在 trigger 上使 hover card 保持打开。
 */
async function clickChipOpenVerifiedSource(label: string): Promise<void> {
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
  assert.ok(rect, `G28 ${label}: no visible composer chip pill to hover`);
  await browser.action("pointer").move({ x: rect.x, y: rect.y, origin: "viewport" }).perform();
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const btn = document.querySelector<HTMLButtonElement>(
          '[data-testid="composer-open-trusted-citation"]',
        );
        return Boolean(btn && btn.getClientRects().length && !btn.disabled);
      }),
    {
      timeout: 15_000,
      timeoutMsg: `G28 ${label}: chip hover card did not reveal the open-verified-source button`,
    },
  );
  const ok = await browser.execute(() => {
    const btn = document.querySelector<HTMLButtonElement>(
      '[data-testid="composer-open-trusted-citation"]',
    );
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  });
  assert.equal(ok, true, `G28 ${label}: failed clicking composer-open-trusted-citation`);
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
    { timeout: 30_000, timeoutMsg: `G28 add-to-agent button not ready for ${filename}` },
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
  assert.equal(clicked, true, `G28 failed clicking add-to-agent on ${filename}`);
}

/** 读取候选卡核验区的 phase（ask-evidence 的 data-evidence-phase）。 */
async function readEvidencePhase(filename: string): Promise<string | null> {
  return browser.execute((name) => {
    const card = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
    ).find((el) => el.textContent?.includes(name));
    return (
      card
        ?.querySelector<HTMLElement>('[data-testid="ask-evidence"]')
        ?.getAttribute("data-evidence-phase") ?? null
    );
  }, filename);
}

interface CitationSelectionSnapshot {
  lineCount: number;
  firstLine: string | null;
  lastLine: string | null;
  firstLineTop: number | null;
  editorFocused: boolean;
  viewportHeight: number;
}
/** 读取 CodeMirror 的引用选区（r9 范式：原生 Selection 优先，选区图层兜底）。 */
async function readCitationSelection(): Promise<CitationSelectionSnapshot> {
  return browser.execute(() => {
    const content = document.querySelector<HTMLElement>(".cm-content");
    const editor = document.querySelector<HTMLElement>(".cm-editor");
    const lines = content ? Array.from(content.querySelectorAll<HTMLElement>(".cm-line")) : [];
    const selection = window.getSelection();
    let hitLines: HTMLElement[] = [];
    if (
      content &&
      selection &&
      selection.rangeCount > 0 &&
      content.contains(selection.anchorNode) &&
      !selection.isCollapsed
    ) {
      const range = selection.getRangeAt(0);
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

/** 等待 chip 引用回跳完成：notes 视图 + CodeMirror 原文 + 已应用的双行选区 + 聚焦。 */
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
      timeoutMsg: "G28 chip citation open did not reveal the verified quote",
    },
  );
  return readCitationSelection();
}

/**
 * 连续两次采样断言 Vault 主视图未被激活（r9 防迟到漏检模式）。Vault 打开后
 * WorkspaceShellLayout 以隐藏容器常驻挂载 VaultView，「未激活」判据是主视图
 * 可见性而非编辑器是否在 DOM。
 */
async function sampleVaultNeverActivated(label: string): Promise<void> {
  const read = () =>
    browser.execute(() => ({
      vaultVisible: Boolean(
        document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
      ),
    }));
  const first = await read();
  await browser.pause(1_000);
  const second = await read();
  assert.equal(
    first.vaultVisible || second.vaultVisible,
    false,
    `G28 ${label}: chip citation must not activate the Vault main view (samples=${JSON.stringify([first, second])})`,
  );
}

async function assertSourceIntact(label: string): Promise<void> {
  assert.equal(
    await readFile(FILE, "utf8"),
    SOURCE,
    `G28 ${label}: the isolated Vault file must equal the original fixture`,
  );
}

/**
 * Vault switcher 的 popover 内容经 radix Portal 渲染（ui/popover.tsx
 * PopoverPrimitive.Portal），不保证仍在 [data-testid="vault-view"] 容器内；
 * 统一以全局 [data-slot="popover-content"] 锚定 popover 内按钮。
 */

/** 从 Vault switcher 的候选列表连接指定显示名的 Vault（managed/发现的本地仓库）。 */
async function switchVaultByDisplayName(displayName: string, label: string): Promise<void> {
  await click('[data-testid="vault-switcher-trigger"]', `Vault selector (${label})`);
  // 先确认 popover 真实打开（vault-create-managed 是其固定区按钮）。
  await waitFor('[data-testid="vault-create-managed"]', `${label} vault popover open`);
  // 候选按钮文本以显示名开头（managed 候选可能带「托管」角标后缀）；
  // startsWith 同时排除「创建 Drora Vault」动作按钮的歧义。
  await browser.waitUntil(
    () =>
      browser.execute((name) => {
        const popover = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
        if (!popover || !popover.getClientRects().length) return false;
        return Array.from(popover.querySelectorAll<HTMLButtonElement>("button")).some(
          (el) =>
            (el.textContent ?? "").trim().startsWith(name) &&
            el.getClientRects().length &&
            !el.disabled,
        );
      }, displayName),
    { timeout: 15_000, timeoutMsg: `G28 ${label}: vault candidate ${displayName} not listed` },
  );
  const clicked = await browser.execute((name) => {
    const popover = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    if (!popover) return false;
    const button = Array.from(popover.querySelectorAll<HTMLButtonElement>("button")).find((el) =>
      (el.textContent ?? "").trim().startsWith(name),
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, displayName);
  assert.equal(clicked, true, `G28 ${label}: failed clicking vault candidate ${displayName}`);
  await browser.waitUntil(
    () =>
      browser.execute(
        (name) =>
          document
            .querySelector('[data-testid="vault-switcher-trigger"]')
            ?.textContent?.includes(name) ?? false,
        displayName,
      ),
    {
      timeout: 30_000,
      timeoutMsg: `G28 ${label}: vault switch to ${displayName} did not take effect`,
    },
  );
}

describe("G28/G29 composer chip citation open and structured error states", () => {
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
        providerName: "G28 Citation Open E2E",
      },
    ]);
    if (!provider) throw new Error("G28 seeded replay provider missing");
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
    // 可信 chip 必须绑定已存在的真实 CLI 会话（G03/G28 前置同款）。
    await sendV4Prompt(
      `${SESSION_A_MARKER}: create a genuine active conversation before attaching the chip.`,
    );
    await waitForV4AssistantMessageContaining("G28_SESSION_A_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "G28 session A did not become idle",
      90_000,
    );
    const stateA = await getV4ConversationState();
    sessionAId = stateA.taskId ?? null;
    assert.ok(sessionAId, "G28 session A task id missing");
  });

  after(async () => {
    assertSandbox();
    const content = await readFile(FILE, "utf8").catch(() => null);
    if (content === SOURCE || content === STALE_EDIT) await rm(FILE, { force: true });
    const decoy = await readFile(VAULT_B_FILE, "utf8").catch(() => null);
    if (decoy === VAULT_B_DECOY_BODY) {
      await rm(VAULT_B_FILE, { force: true });
      await rm(VAULT_B_ROOT, { force: true, recursive: true }).catch(() => undefined);
    }
    await replay?.stop();
    replay = null;
    await browser.electron.restoreAllMocks();
  });

  it("G28 verified chip open: server-resolved path opens in VaultView with the quoted lines revealed", async function () {
    this.timeout(240_000);
    // 连接隔离托管 Vault 并建立真实索引（r9 prerequisite 范式）。
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
      { timeout: 30_000, timeoutMsg: "G28 managed Vault was not configured" },
    );
    await click('[data-testid="vault-tab-ask"]', "Ask tab");
    await awaitIndex();
    // ANSWER 检索唯一 token，等待真实索引候选。
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
      { timeout: 60_000, timeoutMsg: "G28 indexed candidate unavailable" },
    );
    // 「加入 Agent（可信证据）」：现场重新核验签发新 Receipt，成功后自动回 chat。
    await clickAddToAgent(NOTE_NAME);
    await browser.waitUntil(async () => (await readEvidencePhase(NOTE_NAME)) === "verified", {
      timeout: 60_000,
      timeoutMsg: "G28 add-to-agent did not re-verify the current file",
    });
    await browser.waitUntil(
      () =>
        browser.execute(
          () => !document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
        ),
      {
        timeout: 30_000,
        timeoutMsg: "G28 add-to-agent did not return to the chat main view",
      },
    );
    await browser.waitUntil(async () => (await readComposerChipCount()) === 1, {
      timeout: 30_000,
      timeoutMsg: "G28 trusted composer chip did not appear after add-to-agent",
    });
    chipReady = true;

    // 差量入口：点击 chip 的「核验后打开原文」（hover card 内按钮）。
    await clickChipOpenVerifiedSource("G28 first open");
    const snapshot = await waitForRevealedQuote();
    assert.equal(
      snapshot.lineCount,
      2,
      `G28 selection lines (snapshot=${JSON.stringify(snapshot)})`,
    );
    assert.equal(snapshot.firstLine, QUOTE_LINE_1);
    assert.equal(snapshot.lastLine, QUOTE_LINE_2);
    assert.equal(snapshot.editorFocused, true, "G28 reveal must focus CodeMirror");
    assert.ok(
      snapshot.firstLineTop !== null &&
        snapshot.firstLineTop >= 0 &&
        snapshot.firstLineTop < snapshot.viewportHeight,
      `G28 quoted lines must be scrolled into the viewport (top=${snapshot.firstLineTop}, vh=${snapshot.viewportHeight})`,
    );
    // 打开的是服务端返回的相对路径：文件树存在该条目（token 只在 fixture 文件中）。
    await waitFor(
      `[data-testid="vault-view"] button[title="${NOTE_NAME}"]`,
      "file tree entry for the server-resolved relative path",
    );
    await assertSourceIntact("G28 open");
  });

  it("G29 stale: editing the source after attach fails closed with structured stale feedback", async function () {
    this.timeout(180_000);
    if (!chipReady) this.skip();
    await writeFile(FILE, STALE_EDIT, "utf8");
    try {
      await returnToChatView(sessionAId!);
      await browser.waitUntil(async () => (await readComposerChipCount()) === 1, {
        timeout: 15_000,
        timeoutMsg: "G29 stale: composer chip missing before the stale attempt",
      });
      await clickChipOpenVerifiedSource("G29 stale attempt");
      await waitForToast(
        /笔记内容已变更，请重新检索并签发引用。|The note has changed\. Search again for a fresh citation\./,
        "structured stale feedback",
      );
      await sampleVaultNeverActivated("stale rejection");
      assert.equal(
        await readFile(FILE, "utf8"),
        STALE_EDIT,
        "G29 stale: the modified file must stay exactly as written (no write-back)",
      );
    } finally {
      await writeFile(FILE, SOURCE, "utf8");
    }
  });

  it("G29 missing: deleting the source fails closed with structured missing feedback", async function () {
    this.timeout(180_000);
    if (!chipReady) this.skip();
    await rm(FILE, { force: true });
    try {
      await clickChipOpenVerifiedSource("G29 missing attempt");
      await waitForToast(
        /笔记已不存在，无法打开旧引用。|The source note no longer exists\./,
        "structured missing feedback",
      );
      await sampleVaultNeverActivated("missing rejection");
      assert.equal(
        await readFile(FILE, "utf8").catch(() => null),
        null,
        "G29 missing: the deleted file must not be recreated by the rejected open",
      );
    } finally {
      await writeFile(FILE, SOURCE, "utf8");
    }
  });

  it("G29 forbidden via vault switch: the same-name decoy in another vault never opens", async function () {
    this.timeout(240_000);
    if (!chipReady) this.skip();
    // 第二 Vault：隔离 HOME 内的目录，预置同名 NOTE_NAME 诱饵（内容不同）。
    await mkdir(VAULT_B_ROOT, { recursive: true });
    await writeFile(VAULT_B_FILE, VAULT_B_DECOY_BODY, { encoding: "utf8", flag: "wx" });
    // mock 原生目录选择对话框（desktopMainIpcPlatform.ts SelectDirectory 链路），
    // 「打开本地仓库」会把 mock 返回的目录配置为当前 Vault。
    const showOpenDialogMock = await browser.electron.mock("dialog", "showOpenDialog");
    await showOpenDialogMock.mockResolvedValueOnce({
      canceled: false,
      filePaths: [VAULT_B_ROOT],
    });
    try {
      await click('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
      await waitFor('[data-testid="vault-view"]', "Vault panel before the vault switch");
      await click('[data-testid="vault-switcher-trigger"]', "Vault selector before the switch");
      // 先确认 popover 真实打开（固定区按钮），再定位「打开本地仓库」动作。
      await waitFor('[data-testid="vault-create-managed"]', "vault popover open before the switch");
      const opened = await browser.execute((zh) => {
        const popover = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
        if (!popover || !popover.getClientRects().length) return false;
        const button = Array.from(popover.querySelectorAll<HTMLButtonElement>("button")).find(
          (el) => (el.textContent ?? "").includes(zh),
        );
        if (!button || button.disabled) return false;
        button.click();
        return true;
      }, OPEN_LOCAL_VAULT_ZH);
      assert.equal(opened, true, "G29 forbidden: failed clicking open-local-vault");
      await browser.waitUntil(
        () =>
          browser.execute(
            (name) =>
              document
                .querySelector('[data-testid="vault-switcher-trigger"]')
                ?.textContent?.includes(name) ?? false,
            VAULT_B_DISPLAY_NAME,
          ),
        {
          timeout: 30_000,
          timeoutMsg: "G29 forbidden: the decoy vault was not configured as the active Vault",
        },
      );
      // 回到 session A 的 chat 视图，点击仍挂着的 A 会话 chip。
      await returnToChatView(sessionAId!);
      await browser.waitUntil(async () => (await readComposerChipCount()) === 1, {
        timeout: 15_000,
        timeoutMsg: "G29 forbidden: composer chip missing before the cross-vault attempt",
      });
      await clickChipOpenVerifiedSource("G29 forbidden attempt");
      await waitForToast(
        /引用所属会话或 Vault 已改变，拒绝打开。|The session or Vault has changed\. Opening this citation was denied\./,
        "structured forbidden feedback",
      );
      await sampleVaultNeverActivated("forbidden rejection");
      // 不串门：任何 CodeMirror（含隐藏常驻挂载的）都不显示诱饵 Vault 的同名文件内容。
      const decoyVisible = await browser.execute(
        (token) =>
          Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some((el) =>
            el.textContent?.includes(token),
          ),
        VAULT_B_DECOY_TOKEN,
      );
      assert.equal(
        decoyVisible,
        false,
        "G29 forbidden: the same-name decoy file from the other vault must never render",
      );
      assert.equal(
        await readFile(VAULT_B_FILE, "utf8"),
        VAULT_B_DECOY_BODY,
        "G29 forbidden: the decoy vault file must stay untouched",
      );
      await assertSourceIntact("G29 forbidden");
    } finally {
      await browser.electron.restoreAllMocks();
    }
  });

  it("G29 session switch scope and post-switch fail-closed: session B carries no chip; session A's chip stays rejected", async function () {
    this.timeout(240_000);
    if (!chipReady) this.skip();
    // 切回托管 Vault。注意：configureVaultAt 每次执行都刷新 configuredAt（config.ts:174），
    // sourceFingerprint 随之变化——切回同一 managed Vault 也使既有 receipt 全部失效
    // （evidenceRegistry.ts:234 sourceReauthorized → stale），这是产品 fail-closed 语义，
    // 不是缺陷：任何 Vault 重配置后旧引用必须重新核验（重新走 加入 Agent 签发新 Receipt）。
    await click('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
    await waitFor('[data-testid="vault-view"]', "Vault panel before switching back");
    await switchVaultByDisplayName("Drora Vault", "restore managed vault");
    await returnToChatView(sessionAId!);
    // 新建独立会话 B（真实 CLI）。
    await startNewV4Draft();
    await sendV4Prompt(
      `${SESSION_B_MARKER}: establish an independent second session without any evidence.`,
    );
    await waitForV4AssistantMessageContaining("G28_SESSION_B_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "G28 session B did not become idle",
      90_000,
    );
    const stateB = await getV4ConversationState();
    sessionBId = stateB.taskId ?? null;
    assert.ok(sessionBId, "G28 session B task id missing");
    assert.notEqual(sessionBId, sessionAId, "G28 requires two distinct sessions");
    // 切换 Session 的可达面：B 的 Composer 不携带 A 的可信 chip，旧引用无从点击。
    await browser.waitUntil(async () => (await readComposerChipCount()) === 0, {
      timeout: 15_000,
      timeoutMsg: "G29 session switch: session B composer must not carry session A's trusted chip",
    });
    // 回到 A：Vault 重配置（切走再切回）后点击同一 chip，必须 fail-closed——
    // 结构化 stale 反馈 + 零导航，绝不按缓存路径复活旧引用。
    await returnToChatView(sessionAId!);
    await browser.waitUntil(async () => (await readComposerChipCount()) === 1, {
      timeout: 15_000,
      timeoutMsg: "G29 post-switch: session A composer chip missing before the final attempt",
    });
    await clickChipOpenVerifiedSource("G29 post-switch attempt");
    await waitForToast(
      /笔记内容已变更，请重新检索并签发引用。|The note has changed\. Search again for a fresh citation\./,
      "structured stale feedback after the vault round-trip",
    );
    await sampleVaultNeverActivated("post-switch rejection");
    await assertSourceIntact("G29 post-switch");
  });
});
