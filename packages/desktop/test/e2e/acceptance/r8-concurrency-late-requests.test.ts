/**
 * R8 验收包（并发与迟到请求）：G45 + G46 + G52，出自
 * docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md 验收矩阵。
 *
 * - G45 快速多次点击同一可信 Receipt：single-flight 必须把并发解析 RPC 合并为
 *   恰好一次（renderer 事件 `drora:knowledge-citation-open` 的每次 dispatch 恰好
 *   触发一次真实 host resolveCitation，见 VaultView.tsx 的 handleCitationOpen），
 *   随后按 current 结果正常打开原文。
 * - G46 点击引用后在真实 resolveCitation RPC 返回前切换 Session：迟到的 current
 *   结果必须按最新 scope 身份 fail-closed，不得打开笔记。
 * - G52 Session A→B→A：旧请求绝不复活（回到 A 后无任何旧导航生效），用户新点击
 *   可正常重新核验并打开。
 *
 * 挂起注入边界（如实记录）：真实 Electron 下产品没有让 host resolveCitation 挂起
 * >15s 的测试注入点（citationFacade/evidenceRegistry 无延迟参数，服务对象不在
 * window 暴露）。因此 G45 的「15s 超时 + 迟到 success 忽略」面与 G52 的「RPC 在
 * 回到 A 之后才返回」面无法在真实 E2E 注入，依赖
 * packages/ui/test/messageCitationOpenIntegration.test.ts（G45 超时/迟到）与
 * knowledgeCitationNavigation/knowledgeCitationTransaction 单测（G46/G52 epoch）
 * 覆盖，本 spec 按 PARTIAL 口径记录。E2E 真实可测面：并发去重（事件计数）与
 * 「RPC 在途时 scope 已切换」的真实迟到场景（同一同步栈内点击引用后立即点击
 * 另一 Session，React commit 先于 IPC 回包，RPC 结果到达时即构成迟到 current）。
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

const CASE_NAME = "R8-concurrency-late-requests";
const MODEL_ID = "e2e-r8-concurrency-model-id";
const PROVIDER_ID = "e2e-r8-concurrency-provider";
const SESSION_A_MARKER = "R8_SESSION_A_START";
const SESSION_B_MARKER = "R8_SESSION_B_START";
const ANSWER_MARKER = "R8_G45_REPLY";
const QUERY = "R8LateBeaconToken2026";
const NOTE_NAME = "R8-Concurrency-Late-Requests.md";
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
const SOURCE =
  "# R8 concurrency evidence\n\n" +
  `The original ${QUERY} note says: only one resolution RPC may run per concurrent burst.\n`;

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;
let sessionAId: string | null = null;
let sessionBId: string | null = null;
let citationTurnReady = false;

function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "R8 refuses to operate outside the isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "R8 requires isolated .e2e-home");
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
    { timeout, timeoutMsg: `R8 expected ${label}: ${selector}` },
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
    if (!el || !setter) throw new Error("R8 missing native Ask input");
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
    { timeout: 30_000, timeoutMsg: "R8 Vault index configuration not loaded" },
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
      timeoutMsg: "R8 real Knowledge index did not report a file",
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
      timeoutMsg: "R8 chat view did not replace the Vault main view",
    },
  );
}

interface ProbeSnapshot {
  dispatches: number;
  accepted: number;
  receiptId: string | null;
}
/**
 * 注册 citation-open 事件探针：按 detail 对象去重（retryAfterMount 会用同一 detail
 * 重新 dispatch，不构成新的解析 RPC）。事件 dispatch 次数即真实
 * knowledgeQueryService.resolveCitation 的调用次数上界（每次被 VaultView 接受的
 * dispatch 恰好触发一次 navigateKnowledgeCitation→resolveCitation）。
 */
async function resetProbe(): Promise<void> {
  await browser.execute(() => {
    const w = window as unknown as {
      __r8ProbeCleanup?: () => void;
      __r8Probe?: { seen: Set<unknown> } & ProbeSnapshotShape;
    };
    w.__r8ProbeCleanup?.();
    const probe = {
      dispatches: 0,
      accepted: 0,
      receiptId: null as string | null,
      seen: new Set<unknown>(),
    };
    w.__r8Probe = probe;
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent).detail;
      if (!detail || typeof detail.receiptId !== "string") return;
      if (!probe.seen.has(detail)) {
        probe.seen.add(detail);
        probe.dispatches += 1;
        probe.receiptId = detail.receiptId;
      }
      if (detail.accepted) probe.accepted = probe.dispatches;
    };
    window.addEventListener("drora:knowledge-citation-open", handler);
    w.__r8ProbeCleanup = () => window.removeEventListener("drora:knowledge-citation-open", handler);
  });
}
type ProbeSnapshotShape = {
  dispatches: number;
  accepted: number;
  receiptId: string | null;
};
async function readProbe(): Promise<ProbeSnapshot> {
  return browser.execute(() => {
    const probe = (window as unknown as { __r8Probe?: ProbeSnapshotShape }).__r8Probe;
    return {
      dispatches: probe?.dispatches ?? -1,
      accepted: probe?.accepted ?? -1,
      receiptId: probe?.receiptId ?? null,
    };
  });
}

/**
 * 采样笔记是否被 citation 导航打开（连续两次稳定，照 B-5 模式防迟到漏检）。
 * editorHasToken 用可见性（getClientRects）判定；同时断言主视图不在 Vault——
 * 成功的迟到导航会经 onCitationOpen 把 workspaceMainView 切到 vault，即使随后
 * 被任务切换隐藏也能在采样窗口被抓到，防止「打开了但被隐藏」的假绿。
 */
async function sampleNoteNotOpened(token: string, label: string): Promise<void> {
  const read = () =>
    browser.execute((probeToken) => {
      const vaultVisible = Boolean(
        document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
      );
      const editorHasToken = Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
        (el) => el.textContent?.includes(probeToken) && el.getClientRects().length > 0,
      );
      return { vaultVisible, editorHasToken };
    }, token);
  const first = await read();
  await browser.pause(1_000);
  const second = await read();
  assert.equal(
    first.editorHasToken || second.editorHasToken,
    false,
    `R8 ${label}: citation must not open the original note (samples=${JSON.stringify([first, second])})`,
  );
  assert.equal(
    first.vaultVisible || second.vaultVisible,
    false,
    `R8 ${label}: a late navigation must not activate the Vault main view (samples=${JSON.stringify([first, second])})`,
  );
}

describe("R8 concurrency and late citation requests: G45/G46/G52", () => {
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
        providerName: "R8 Concurrency E2E",
      },
    ]);
    if (!provider) throw new Error("R8 seeded replay provider missing");
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
    // G45–G52 的可信引用必须绑定一个已存在的真实 CLI Session A。
    await sendV4Prompt(
      `${SESSION_A_MARKER}: create a genuine active conversation before Vault queries.`,
    );
    await waitForV4AssistantMessageContaining("R8_SESSION_A_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "R8 session A did not become idle",
      90_000,
    );
    const stateA = await getV4ConversationState();
    sessionAId = stateA.taskId ?? null;
    assert.ok(sessionAId, "R8 session A task id missing");
  });

  after(async () => {
    assertSandbox();
    const text = await readFile(FILE, "utf8").catch(() => null);
    if (text === SOURCE) await rm(FILE);
    await browser.execute(() => {
      const w = window as unknown as {
        __r8ProbeCleanup?: () => void;
        __r8Probe?: unknown;
      };
      w.__r8ProbeCleanup?.();
      delete w.__r8Probe;
      delete w.__r8ProbeCleanup;
    });
    await replay?.stop();
    replay = null;
    await browser.electron.restoreAllMocks();
  });

  it("G45 prerequisite: one real ANSWER handoff turn renders a single trusted citation", async function () {
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
      { timeout: 30_000, timeoutMsg: "R8 managed Vault was not configured" },
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
      { timeout: 60_000, timeoutMsg: "R8 indexed candidate unavailable" },
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
      { timeout: 15_000, timeoutMsg: "R8 ANSWER candidate not selected" },
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
        timeoutMsg: "R8 trusted handoff never returned to the live composer",
      },
    );
    await click('[data-testid="v4-composer-send"]', "send verified draft to the real CLI");
    await waitForV4AssistantMessageContaining(ANSWER_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "R8 evidence turn did not settle",
      90_000,
    );
    // 完成态 turn 必须渲染 prose 内联可信 [1] 与回答下方来源操作（同一 Receipt 的两个 UI 入口）。
    await waitFor('[data-testid="knowledge-inline-citation-1"]', "inline trusted citation button");
    await waitFor('[data-testid="knowledge-answer-source-1"]', "answer source action button");
    citationTurnReady = true;
  });

  it("G45 rapid duplicate clicks on the same Receipt issue at most one resolution RPC and open once", async function () {
    this.timeout(180_000);
    if (!citationTurnReady) this.skip();
    await resetProbe();
    // 同一同步栈内连点：inline 入口 ×5（feedback controller 单飞）+ 回答下方来源
    // 入口 ×1（直调 transport）。全部命中 pending Map 期间（IPC 回包至少晚一个
    // 宏任务）不允许产生第二次 dispatch。
    const clicks = await browser.execute(() => {
      const inline = document.querySelector<HTMLElement>(
        '[data-testid="knowledge-inline-citation-1"]',
      );
      const source = document.querySelector<HTMLElement>(
        '[data-testid="knowledge-answer-source-1"]',
      );
      if (!inline) return 0;
      for (let i = 0; i < 5; i += 1) inline.click();
      source?.click();
      return 5 + (source ? 1 : 0);
    });
    assert.equal(clicks, 6, "R8 expected both citation entrypoints to be clicked");
    // 真实打开成功（current 复验 → CodeMirror 原文）。
    await browser.waitUntil(
      () =>
        browser.execute(
          (token) =>
            document
              .querySelector('[data-testid="vault-tab-notes"]')
              ?.getAttribute("aria-selected") === "true" &&
            Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
              (el) => el.textContent?.includes(token) && el.getClientRects().length > 0,
            ),
          QUERY,
        ),
      {
        timeout: 30_000,
        timeoutMsg: "R8 single-flight citation did not open the original note",
      },
    );
    const probe = await readProbe();
    assert.equal(
      probe.dispatches,
      1,
      `R8 concurrent clicks must dispatch exactly one resolution RPC (probe=${JSON.stringify(probe)})`,
    );
    assert.equal(
      probe.accepted,
      1,
      "R8 the single dispatch must be accepted by the mounted VaultView",
    );
    assert.ok(probe.receiptId?.startsWith("evr_"), "R8 probe must capture the real receipt id");
    assert.equal(
      await readFile(FILE, "utf8"),
      SOURCE,
      "R8 read-only citation open must never mutate the source",
    );
  });

  it("G46 switching Session before the RPC returns fails closed: the late current result must not open the note", async function () {
    this.timeout(240_000);
    if (!citationTurnReady || !sessionAId) this.skip();
    // 建立真实 Session B（无可信证据），供切换使用。
    await startNewV4Draft();
    await sendV4Prompt(
      `${SESSION_B_MARKER}: establish an independent second session without any evidence.`,
    );
    await waitForV4AssistantMessageContaining("R8_SESSION_B_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "R8 session B did not become idle",
      90_000,
    );
    const stateB = await getV4ConversationState();
    sessionBId = stateB.taskId ?? null;
    assert.ok(sessionBId, "R8 session B task id missing");
    assert.notEqual(sessionBId, sessionAId, "R8 requires two distinct sessions");

    // 回到 A 的 chat 视图，确保竞态点击作用于 A 的可信引用。
    await returnToChatView(sessionAId);
    await waitFor(
      '[data-testid="knowledge-inline-citation-1"]',
      "A inline trusted citation button",
    );
    await resetProbe();
    // 竞态：同一同步栈内先点击引用（dispatch→accept→真实 resolveCitation IPC 在途），
    // 再点击侧栏 Session B。React 对离散事件的同步 commit 使 scope 身份先于 IPC
    // 回包更新——RPC 的 current 结果到达时即构成「迟到」结果。
    const raced = await browser.execute((taskTestId) => {
      const citation = document.querySelector<HTMLElement>(
        '[data-testid="knowledge-inline-citation-1"]',
      );
      const taskItem = document.querySelector<HTMLElement>(`[data-testid="${taskTestId}"]`);
      if (!citation || !taskItem)
        return {
          citation: Boolean(citation),
          task: Boolean(taskItem),
          clicked: false,
        };
      citation.click();
      taskItem.click();
      return { citation: true, task: true, clicked: true };
    }, `task-item-${sessionBId}`);
    assert.deepEqual(
      raced,
      { citation: true, task: true, clicked: true },
      "R8 race clicks did not land",
    );
    // 切换必须真实生效（B 成为当前 pane）。
    await browser.waitUntil(async () => (await getV4ConversationState()).taskId === sessionBId, {
      timeout: 30_000,
      timeoutMsg: "R8 session switch to B did not take effect",
    });
    // 等待迟到 RPC settle 后，连续采样：绝不打开原文（B-5 模式，两次采样均须未打开）。
    await browser.pause(1_000);
    await sampleNoteNotOpened(QUERY, "G46 late current result after session switch");
    const probe = await readProbe();
    assert.equal(
      probe.dispatches,
      1,
      `R8 G46 must issue exactly one resolution RPC (probe=${JSON.stringify(probe)})`,
    );
    assert.equal(
      probe.accepted,
      1,
      "R8 G46 the request was accepted and the real RPC was in flight",
    );
    assert.equal(await readFile(FILE, "utf8"), SOURCE, "R8 G46 must never mutate the source");
  });

  it("G52 A→B→A never revives the revoked request; a fresh user click re-verifies and opens", async function () {
    this.timeout(180_000);
    if (!citationTurnReady || !sessionAId || !sessionBId) this.skip();
    // 当前在 B：旧请求已 settle。回到与初始完全相同的 A 身份。
    await returnToChatView(sessionAId);
    await waitFor('[data-testid="knowledge-inline-citation-1"]', "A citation after A→B→A");
    // 旧请求绝不复活：回到 A 后不得出现旧导航打开原文。
    await browser.pause(1_000);
    await sampleNoteNotOpened(QUERY, "G52 old request must stay revoked after A→B→A");
    // 用户新点击可正常核验：同一 Receipt 的新请求走完整真实链路并打开。
    await resetProbe();
    await click('[data-testid="knowledge-inline-citation-1"]', "fresh click after A→B→A");
    await browser.waitUntil(
      () =>
        browser.execute(
          (token) =>
            document
              .querySelector('[data-testid="vault-tab-notes"]')
              ?.getAttribute("aria-selected") === "true" &&
            Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
              (el) => el.textContent?.includes(token) && el.getClientRects().length > 0,
            ),
          QUERY,
        ),
      {
        timeout: 30_000,
        timeoutMsg: "R8 fresh click after A→B→A did not re-verify and open",
      },
    );
    const probe = await readProbe();
    assert.equal(
      probe.dispatches,
      1,
      `R8 G52 fresh click must dispatch a new resolution RPC (probe=${JSON.stringify(probe)})`,
    );
    assert.equal(await readFile(FILE, "utf8"), SOURCE, "R8 G52 must never mutate the source");
  });
});
