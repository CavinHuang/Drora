/**
 * G 交错与迟到时序验收包：G11 + G20 + G21 + G22，出自
 * docs/vaultview/delivery/KNOWLEDGE_E2E_PHASE1_SMOKE.md 2026-10-18 补记的
 * 「无任何自动化映射」余量表（交错防护是产品已有实现，本包职责是证明 GUI 层生效）。
 *
 * 被测机制（实现参考，先核读后落用例）：
 * - useKnowledgeCandidateVerification.ts:45-59 —— verifyEvidence 在 RPC 前捕获
 *   submitSeqRef，回包后 seq 失配即丢弃（不 dispatch evidenceResolved）；
 *   useKnowledgeAgentActions.ts:96-105 —— 单篇「加入 Agent」迟到 proof 同样被
 *   submitSeq 守卫拦下，不进入 dispatchConversationSelectionAdd。
 * - KnowledgeAskView.tsx:188 —— 每次新提交同步 ++submitSeqRef；
 *   KnowledgeAskView.tsx:125-143 —— sessionId/workspaceKey/queryService 变化
 *   （切 Session/Workspace）同样 ++submitSeqRef 并 scopeReset + cancelPendingPrevious；
 *   KnowledgeAskView.tsx:436-438 —— 候选选择点击在 React 渲染前同步
 *   ++selectionVersionRef（交接批次失配即丢弃，useKnowledgeAgentActions.ts:176-182）。
 * - useKnowledgeAgentActions.ts:53-54/155-156 —— handoffRef/addingRef 同步锁，
 *   同一同步栈内双击「交给 Agent」只启动一个核验批次。
 * - usePreviousKnowledgeActions.ts:73-84 —— 上一轮旧笔记 open/attach 的复验回包
 *   按 seq + token 双守卫丢弃。
 *
 * 时序构造（无产品注入口，照 R8 已实测模式）：核验 RPC 是 main 进程往返，回包
 * 必然晚于当前同步栈；在同一 browser.execute 内先点核验动作、再点新检索提交/
 * 侧栏任务切换（React 离散事件同步 flush），即构成「RPC 在途时作用域已变更」
 * 的真实迟到场景。负向断言遵循间隔 1s 双采样纪律（B-5 模式）。
 *
 * 可观测探针：requestKnowledgeAgentHandoff / dispatchConversationSelectionAdd /
 * commitKnowledgeAgentHandoff 均派发 window CustomEvent
 * （conversationSelectionReference.ts:441/552/465），探针计数即「有效核验批次
 * 送达」的硬证据；composer 层再以 manifest 文本/chip 计数复核。
 *
 * 已知边界（如实记录，不以此代替判据）：核验 RPC 挂起 >15s 无产品注入口
 * （与 R8 G45 同口径）；G22 的「Workspace」维度与 Session 共用同一 scope 守卫
 * （KnowledgeAskView.tsx:125-143 的 workspaceKey 比对），真桌面按 R8/G42 先例
 * 验 Session 切换维度。
 *
 * 本包发现的产品缺陷（只记录不修，详见文末 D-G20-1 探针 it 的注释）：
 * - D-G20-1：上一轮候选「跳到原文」在无竞态下也确定性静默失败（finally 置空
 *   token 与未 await 的 onOpenNote 的 isCurrent 闭包竞态）——G20「不打开笔记」
 *   子句因此暂缺正向判定力，G20 整体如实记 FAIL。
 * - D-minor-1：会话切换后重开 Ask 视图，索引状态条停留 loading（scopeReset 置空
 *   indexStatus 后 refreshIndexStatus 不随 scope 重跑，仅依赖 indexService 身份；
 *   KnowledgeAskView.tsx:125-157）。检索功能不受影响。
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

const CASE_NAME = "G-interleaving";
const MODEL_ID = "e2e-g-interleaving-model";
const PROVIDER_ID = "e2e-g-interleaving-provider";
const SESSION_A_MARKER = "G_INTERLEAVING_A_START";
const SESSION_B_MARKER = "G_INTERLEAVING_B_START";
const SESSION_C_MARKER = "G_INTERLEAVING_C_START";
/** G11 单篇证据笔记（新提交交错用）。 */
const G11_TOKEN = "G11VerifyBeacon2026";
const G11_NOTE = "G-Interleaving-Verify.md";
/** G20 旧笔记（上一轮复验交错用）。 */
const G20_TOKEN = "G20PreviousBeacon2026";
const G20_NOTE = "G-Interleaving-Previous.md";
/** G21/G22 三篇共检词；第三篇是改选后的新第二篇。 */
const PAIR_TOKEN = "GPairScopeBeacon2026";
const PAIR_ONE_NOTE = "G-Interleaving-Pair-One.md";
const PAIR_TWO_NOTE = "G-Interleaving-Pair-Two.md";
const PAIR_THREE_NOTE = "G-Interleaving-Pair-Three.md";
const MANIFEST_HEADER = "来源索引（顺序与附带的原文证据片段一致）：";
const ADD_TO_AGENT_ZH = "加入 Agent（可信证据）";
const ADD_TO_AGENT_EN = "Add verified evidence to Agent";
const PREVIOUS_ZH = "上一轮";
const PREVIOUS_EN = "Previous round";
const HANDOFF_CHECKING_ZH = "正在核验证据";
const HANDOFF_CHECKING_EN = "Verifying sources";

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
function pairBody(title: string, uniqueToken: string): string {
  return [
    `# ${title}`,
    "",
    `${PAIR_TOKEN} shared scope marker with unique ${uniqueToken} evidence sentence.`,
    "No other fixture file contains this unique token.",
    "",
  ].join("\n");
}
const G11_BODY = [
  "# G Interleaving Verify Evidence",
  "",
  `The ${G11_TOKEN} sentence is the single trusted excerpt for the new-run interleaving case.`,
  "Nothing else in this vault contains the G11 token.",
  "",
].join("\n");
const G20_BODY = [
  "# G Interleaving Previous Evidence",
  "",
  `The ${G20_TOKEN} sentence is the trusted excerpt for the previous-round re-verification case.`,
  "Nothing else in this vault contains the G20 token.",
  "",
].join("\n");
const FIXTURES: Array<{ file: string; body: string }> = [
  { file: join(VAULT_ROOT, G11_NOTE), body: G11_BODY },
  { file: join(VAULT_ROOT, G20_NOTE), body: G20_BODY },
  { file: join(VAULT_ROOT, PAIR_ONE_NOTE), body: pairBody("G Pair One", "GPairOneLine2026") },
  { file: join(VAULT_ROOT, PAIR_TWO_NOTE), body: pairBody("G Pair Two", "GPairTwoLine2026") },
  {
    file: join(VAULT_ROOT, PAIR_THREE_NOTE),
    body: pairBody("G Pair Three", "GPairThreeLine2026"),
  },
];

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;
let sessionAId: string | null = null;
let sessionBId: string | null = null;
let sessionCId: string | null = null;

function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "G refuses to operate outside the isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "G requires an isolated .e2e-home");
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
    { timeout, timeoutMsg: `G expected ${label}: ${selector}` },
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
    if (!el || !setter) throw new Error("G missing native Ask input");
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
    { timeout: 30_000, timeoutMsg: "G Vault index configuration not loaded" },
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
    { timeout: 90_000, timeoutMsg: "G real Knowledge index never covered all fixture files" },
  );
}
/** 首次连接隔离托管 Vault 并停在 Ask 页（R2 G61 同款生产链路）。 */
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
    { timeout: 30_000, timeoutMsg: "G managed Vault was not authorized by production host" },
  );
  await click('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
  await awaitIndex();
}
/**
 * 已配置 Vault 的再进入（viewTab 为组件易失状态，保持 ask；缺失时显式切回）。
 * 不再等待 data-index-configured：会话切换会触发 scopeReset 把 indexStatus 置空
 * （KnowledgeAskView.tsx:125-143），而 refreshIndexStatus 仅依赖 indexService 身份、
 * 不随 scope 重跑 → 重开视图后状态条真实停留 "loading"（产品侧小缺陷，见验收
 * notes，检索功能不受影响）。就绪性由后续 submitAskQuery 的真实候选轮询证明。
 */
async function openVaultAsk(): Promise<void> {
  const vaultVisible = await browser.execute(() =>
    Boolean(document.querySelector('[data-testid="vault-view"]')?.getClientRects().length),
  );
  if (!vaultVisible) {
    await click('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
    await waitFor('[data-testid="vault-view"]', "Vault panel");
  }
  const askVisible = await browser.execute(() =>
    Boolean(document.querySelector('[data-testid="knowledge-ask-view"]')?.getClientRects().length),
  );
  if (!askVisible) {
    await click('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
  }
  await waitFor('[data-testid="ask-input"]', "Knowledge Ask input on reopen");
}
async function submitAskQuery(intent: "find" | "answer" | "compare", query: string): Promise<void> {
  await click(`[data-testid="ask-intent-${intent}"]`, `${intent} intent`);
  await setAskInput(query);
  await click('[data-testid="ask-submit"]', `submit ${intent} query`);
  // 不做「旧候选退场」轮询：本地 createRun+search 两个 IPC 往返可在 wdio 首次
  // 轮询（~16ms）内完成（第二轮实测踩过，新候选抢先就位使 ===0 永不成立）。
  // 新提交生效的机制保证是 submit() 点击处理程序内同步 ++submitSeqRef
  // （KnowledgeAskView.tsx:188，即本包被测守卫本身）；旧轮折叠的可见证据由
  // ensurePreviousExpanded 的「上一轮」触发器存在性自检。
  await browser.waitUntil(
    () =>
      browser.execute(() => document.querySelectorAll('[data-testid="ask-candidate"]').length > 0),
    { timeout: 90_000, timeoutMsg: `G ${intent} query returned no candidates` },
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
    { timeout, timeoutMsg: `G candidate ${filename} unavailable` },
  );
}
async function selectCandidate(filename: string): Promise<void> {
  await waitForCandidate(filename);
  await browser.execute((name) => {
    const card = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
    ).find((el) => el.textContent?.includes(name));
    const button = card?.querySelector<HTMLButtonElement>("button");
    if (!button) throw new Error(`G select button missing on ${name}`);
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
    { timeout: 15_000, timeoutMsg: `G candidate ${filename} was not selected` },
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
    { timeout: 30_000, timeoutMsg: "G chat view did not replace the Vault main view" },
  );
}

// ── 探针：有效核验批次送达计数的唯一硬证据 ─────────────────────
interface ProbeSnapshot {
  handoff: number;
  add: number;
  handoffTargets: string[];
  addSourceKeys: string[];
}
async function resetProbe(): Promise<void> {
  await browser.execute(() => {
    const w = window as unknown as {
      __gInterleaveProbeCleanup?: () => void;
      __gInterleaveProbe?: unknown;
    };
    w.__gInterleaveProbeCleanup?.();
    const probe = {
      handoff: 0,
      add: 0,
      handoffTargets: [] as string[],
      addSourceKeys: [] as string[],
    };
    w.__gInterleaveProbe = probe;
    const handoffHandler = (event: Event): void => {
      const detail = (event as CustomEvent).detail as { targetSessionId?: unknown } | null;
      if (!detail || typeof detail !== "object") return;
      probe.handoff += 1;
      probe.handoffTargets.push(String(detail.targetSessionId ?? "unknown"));
    };
    const addHandler = (event: Event): void => {
      const detail = (event as CustomEvent).detail as {
        reference?: { sourceKey?: unknown; path?: unknown };
      } | null;
      if (!detail || typeof detail !== "object") return;
      probe.add += 1;
      probe.addSourceKeys.push(
        String(detail.reference?.sourceKey ?? detail.reference?.path ?? "unknown"),
      );
    };
    window.addEventListener("drora:knowledge-agent-handoff", handoffHandler);
    window.addEventListener("drora:conversation-selection-add", addHandler);
    w.__gInterleaveProbeCleanup = () => {
      window.removeEventListener("drora:knowledge-agent-handoff", handoffHandler);
      window.removeEventListener("drora:conversation-selection-add", addHandler);
    };
  });
}
async function readProbe(): Promise<ProbeSnapshot> {
  return browser.execute(() => {
    const probe = (window as unknown as { __gInterleaveProbe?: ProbeSnapshot }).__gInterleaveProbe;
    return {
      handoff: probe?.handoff ?? -1,
      add: probe?.add ?? -1,
      handoffTargets: probe?.handoffTargets ?? [],
      addSourceKeys: probe?.addSourceKeys ?? [],
    };
  });
}

// ── Composer 投影 ─────────────────────────────────────────────
interface ComposerState {
  /** 全部已挂载 composer 输入中 manifest 头出现次数（含隐藏容器，作诊断）。 */
  manifestHits: number;
  /** 携带 data-conversation-selection-reference-count 的 chip 总数（全文档，作诊断）。 */
  chipCount: number;
  chipValues: number[];
  /** 可见性限定（getClientRects）：活动会话 composer 的 manifest/chip 计数。
   *  第三轮实测：切走后旧会话 composer 可以隐藏挂载残留在 DOM（G22 切 A 时 C 的
   *  草稿仍被全局计数命中）——「新会话 Composer 干净」必须按可见域断言。 */
  visibleManifestHits: number;
  visibleChipCount: number;
  /** 含锚文本的 composer 输入所辖 composer 容器内 chip 计数（R2 D2 防误中锚定）。 */
  anchoredChipCount: number | null;
}
async function readComposerState(anchorTokens: string[] = []): Promise<ComposerState> {
  return browser.execute(
    (tokens, manifestHeader) => {
      const inputs = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
      );
      const visibleInputs = inputs.filter((el) => el.getClientRects().length > 0);
      const countManifest = (list: HTMLElement[]): number => {
        let hits = 0;
        for (const el of list) {
          hits += ((el.textContent ?? "").split(manifestHeader).length - 1) | 0;
        }
        return hits;
      };
      const chips = Array.from(
        document.querySelectorAll<HTMLElement>("[data-conversation-selection-reference-count]"),
      );
      const visibleChips = chips.filter((el) => el.getClientRects().length > 0);
      let anchoredChipCount: number | null = null;
      if (tokens.length > 0) {
        const anchor = inputs.find((el) =>
          tokens.every((token) => (el.textContent ?? "").includes(token)),
        );
        if (anchor) {
          const composerRoot =
            anchor.closest("form") ?? anchor.parentElement?.parentElement ?? null;
          const value = composerRoot
            ?.querySelector("[data-conversation-selection-reference-count]")
            ?.getAttribute("data-conversation-selection-reference-count");
          anchoredChipCount = value === null || value === undefined ? null : Number(value);
        }
      }
      return {
        manifestHits: countManifest(inputs),
        chipCount: chips.length,
        chipValues: chips.map((el) =>
          Number(el.getAttribute("data-conversation-selection-reference-count")),
        ),
        visibleManifestHits: countManifest(visibleInputs),
        visibleChipCount: visibleChips.length,
        anchoredChipCount,
      };
    },
    anchorTokens,
    MANIFEST_HEADER,
  );
}
/** 负向双采样（间隔 1s 分别断言，B-5 反模式修复纪律）。 */
async function sampleTwice<T>(read: () => Promise<T>): Promise<[T, T]> {
  const first = await read();
  await browser.pause(1_000);
  const second = await read();
  return [first, second];
}

/** 展开上一轮折叠区并等待旧候选按钮出现（G20 旧笔记入口）。 */
async function ensurePreviousExpanded(): Promise<void> {
  const hasButtons = await browser.execute(() =>
    Boolean(
      document.querySelector('[data-testid="ask-previous-candidate"]')?.getClientRects().length,
    ),
  );
  if (hasButtons) return;
  const opened = await browser.execute(
    (zh, en) => {
      const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (el) => (el.textContent ?? "").includes(zh) || (el.textContent ?? "").includes(en),
      );
      if (!trigger) return false;
      trigger.click();
      return true;
    },
    PREVIOUS_ZH,
    PREVIOUS_EN,
  );
  assert.equal(opened, true, "G previous-round trigger not found");
  await waitFor('[data-testid="ask-previous-candidate"]', "previous-round candidate button");
}

describe("G interleaving and late-arrival acceptance: G11/G20/G21/G22 in one real Electron session", () => {
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
        providerName: "G Interleaving E2E",
      },
    ]);
    if (!provider) throw new Error("G seeded replay provider missing");
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
    // 全部用例的可信动作必须绑定已存在的真实 CLI Session A。
    await sendV4Prompt(
      `${SESSION_A_MARKER}: create a genuine active conversation before Vault queries.`,
    );
    await waitForV4AssistantMessageContaining("G_INTERLEAVING_A_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "G session A did not become idle",
      90_000,
    );
    const stateA = await getV4ConversationState();
    sessionAId = stateA.taskId ?? null;
    assert.ok(sessionAId, "G session A task id missing");
  });

  after(async () => {
    assertSandbox();
    for (const fixture of FIXTURES) {
      const text = await readFile(fixture.file, "utf8").catch(() => null);
      if (text === fixture.body) await rm(fixture.file);
    }
    await browser.execute(() => {
      const w = window as unknown as {
        __gInterleaveProbeCleanup?: () => void;
        __gInterleaveProbe?: unknown;
      };
      w.__gInterleaveProbeCleanup?.();
      delete w.__gInterleaveProbe;
      delete w.__gInterleaveProbeCleanup;
    });
    await replay?.stop();
    replay = null;
    await browser.electron.restoreAllMocks();
  });

  it("G11 new submission while evidence verification is pending: the late proof pollutes neither the new run nor the composer", async function () {
    this.timeout(300_000);
    await connectVaultAndOpenAsk();
    await submitAskQuery("find", G11_TOKEN);
    await waitForCandidate(G11_NOTE);
    // 预填第二次检索（React 状态已提交），竞态栈内只做两次点击。
    await setAskInput(G11_TOKEN);
    await browser.waitUntil(
      () =>
        browser.execute(
          (expected) =>
            document.querySelector<HTMLTextAreaElement>('[data-testid="ask-input"]')?.value ===
            expected,
          G11_TOKEN,
        ),
      { timeout: 10_000, timeoutMsg: "G G11 query prefill did not commit" },
    );
    await resetProbe();
    // 竞态：同一同步栈先点「加入 Agent（可信证据）」（同步段捕获旧 submitSeq 并发出
    // prepareEvidence/resolveCitation RPC），再点检索提交（submit 同步 ++submitSeqRef）。
    // IPC 回包必然晚于本栈 → 回包到达时即为迟到结果。
    const raced = await browser.execute(
      (noteName, zh, en) => {
        const card = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
        ).find((el) => el.textContent?.includes(noteName));
        const addBtn = Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
          (b) => (b.textContent ?? "").includes(zh) || (b.textContent ?? "").includes(en),
        );
        const submit = document.querySelector<HTMLButtonElement>('[data-testid="ask-submit"]');
        if (!card || !addBtn || !submit) {
          return {
            card: Boolean(card),
            addBtn: Boolean(addBtn),
            submit: Boolean(submit),
            clicked: false,
          };
        }
        addBtn.click();
        submit.click();
        return { card: true, addBtn: true, submit: true, clicked: true };
      },
      G11_NOTE,
      ADD_TO_AGENT_ZH,
      ADD_TO_AGENT_EN,
    );
    assert.deepEqual(
      raced,
      { card: true, addBtn: true, submit: true, clicked: true },
      "G G11 race clicks did not land",
    );
    // 新 Run 真实落定（此后迟到 RPC 已无可乘之机）。
    await waitForCandidate(G11_NOTE, 90_000);

    // 双采样断言：迟到核验结果既不进 Composer（探针 + chip），也不污染新 Run
    // （新一轮同笔记卡片不得出现旧证据相位）。
    const [first, second] = await sampleTwice(() =>
      browser
        .execute((noteName) => {
          const card = Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
          ).find((el) => el.textContent?.includes(noteName));
          return {
            evidencePhase:
              card
                ?.querySelector('[data-testid="ask-evidence"]')
                ?.getAttribute("data-evidence-phase") ?? "none",
          };
        }, G11_NOTE)
        .then(async (cardState) => ({
          cardState,
          composer: await readComposerState([G11_TOKEN]),
          probe: await readProbe(),
        })),
    );
    for (const [label, sample] of [
      ["first", first],
      ["second", second],
    ] as const) {
      assert.equal(
        sample.cardState.evidencePhase,
        "none",
        `G11 ${label}: the new run must not inherit the stale evidence phase`,
      );
      assert.equal(
        sample.probe.add,
        0,
        `G11 ${label}: the late verified proof must not be added to the composer (probe=${JSON.stringify(sample.probe)})`,
      );
      assert.equal(sample.probe.handoff, 0, `G11 ${label}: no handoff may fire in this case`);
      assert.equal(
        sample.composer.chipCount,
        0,
        `G11 ${label}: no trusted chip may appear (composer=${JSON.stringify(sample.composer)})`,
      );
      assert.equal(
        sample.composer.manifestHits,
        0,
        `G11 ${label}: no handoff manifest may leak into any composer`,
      );
    }
    // 正向对照：同一新 Run 手动核验正常通过（证明流水线存活，此前丢弃确因交错守卫）。
    await click('[data-testid="ask-candidate-verify"]', "positive control verify on the new run");
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          (noteName) =>
            Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
              .find((el) => el.textContent?.includes(noteName))
              ?.querySelector('[data-testid="ask-evidence"]')
              ?.getAttribute("data-evidence-phase"),
          G11_NOTE,
        )) === "verified",
      { timeout: 60_000, timeoutMsg: "G G11 positive-control verify did not pass on the new run" },
    );
    const controlProbe = await readProbe();
    assert.equal(
      controlProbe.add,
      0,
      "G11 positive control uses manual verify only; nothing may enter the composer",
    );
    console.info("G11 passed: late proof dropped, new run clean, manual verify OK");
  });

  it("G20 previous-round re-verification racing a new query or a session switch never opens the note nor reaches the new composer", async function () {
    this.timeout(360_000);
    // 建立真实 Session B（切换目标），再回到 A 的 Vault Ask。
    await startNewV4Draft();
    await sendV4Prompt(
      `${SESSION_B_MARKER}: establish an independent second session without any evidence.`,
    );
    await waitForV4AssistantMessageContaining("G_INTERLEAVING_B_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "G session B did not become idle",
      90_000,
    );
    const stateB = await getV4ConversationState();
    sessionBId = stateB.taskId ?? null;
    assert.ok(sessionBId, "G session B task id missing");
    await returnToChatView(sessionAId!);
    await openVaultAsk();

    // 两轮真实检索：round1 落入「上一轮」，旧笔记复验入口就绪。
    await submitAskQuery("find", G20_TOKEN);
    // 笔记名互斥自检：候选卡必须是 G20 笔记本身（防上一用例残留被误当新轮）。
    await waitForCandidate(G20_NOTE);
    await submitAskQuery("find", G20_TOKEN);
    await waitForCandidate(G20_NOTE);
    await ensurePreviousExpanded();
    const previousCardName = await browser.execute(
      () =>
        document.querySelector<HTMLElement>('[data-testid="ask-previous-candidate"]')
          ?.textContent ?? "",
    );
    assert.ok(
      previousCardName.includes(G20_NOTE),
      `G G20 previous round must fold the ${G20_NOTE} round (got=${previousCardName})`,
    );

    // 交错变体一（发起新检索）：同一同步栈点旧笔记 open + 新检索提交。
    await setAskInput(G20_TOKEN);
    await resetProbe();
    const raceQuery = await browser.execute(() => {
      const previous = document.querySelector<HTMLButtonElement>(
        '[data-testid="ask-previous-candidate"]',
      );
      const submit = document.querySelector<HTMLButtonElement>('[data-testid="ask-submit"]');
      if (!previous || !submit)
        return { previous: Boolean(previous), submit: Boolean(submit), clicked: false };
      previous.click();
      submit.click();
      return { previous: true, submit: true, clicked: true };
    });
    assert.deepEqual(
      raceQuery,
      { previous: true, submit: true, clicked: true },
      "G G20 new-query race clicks did not land",
    );
    await waitForCandidate(G20_NOTE, 90_000);
    // 双采样：迟到引用不得打开笔记（notes tab 不激活、无可 CodeMirror 原文）。
    const [openA1, openA2] = await sampleTwice(() =>
      browser.execute(
        (token) => ({
          notesTabSelected:
            document
              .querySelector('[data-testid="vault-tab-notes"]')
              ?.getAttribute("aria-selected") === "true",
          editorHasToken: Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
            (el) => el.textContent?.includes(token) && el.getClientRects().length > 0,
          ),
        }),
        G20_TOKEN,
      ),
    );
    for (const [label, sample] of [
      ["first", openA1],
      ["second", openA2],
    ] as const) {
      assert.equal(
        sample.notesTabSelected,
        false,
        `G20 new-query race ${label}: the late citation must not activate the notes view`,
      );
      assert.equal(
        sample.editorHasToken,
        false,
        `G20 new-query race ${label}: the late citation must not open the original note`,
      );
    }
    const probeQuery = await readProbe();
    assert.equal(probeQuery.add, 0, "G20 new-query race must not attach anything");
    assert.equal(probeQuery.handoff, 0, "G20 new-query race must not hand off anything");

    // 正向对照（生命力证明，不经过缺陷 D-G20-1 的路径）：竞态后对当前轮卡片手动
    // 核验必须照常通过——证明 prepareEvidence/resolveCitation 流水线存活，此前
    // 「不打开笔记」采样中的核验回包确实被交错守卫丢弃而非流水线死亡。
    // 「上一轮点开笔记」的无竞态正向对照移至本文件末尾的独立 it（D-G20-1 缺陷
    // 探针）：usePreviousKnowledgeActions 的 finally 在未 await 的 onOpenNote 之后
    // 同步置空 token，VaultView.openFile 的第二次 isCurrent 检查恒 false，上一轮
    // 打开在无竞态下也确定性静默失败——该缺陷使本用例「不打开笔记」子句暂时
    // 无法与「通路本身损坏」区分，如实记 FAIL，产品修复后此处自然转绿。
    await click(
      '[data-testid="ask-candidate-verify"]',
      "positive control verify on the current round",
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          (noteName) =>
            Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
              .find((el) => el.textContent?.includes(noteName))
              ?.querySelector('[data-testid="ask-evidence"]')
              ?.getAttribute("data-evidence-phase"),
          G20_NOTE,
        )) === "verified",
      {
        timeout: 60_000,
        timeoutMsg: "G G20 positive-control verify did not pass on the current round",
      },
    );

    // 交错变体二（发起新检索 × 旧笔记 attach）：迟到引用不得进入 Composer。
    // （回到 ask 页只等输入框就绪：scopeReset 后索引状态条停留 loading，见 openVaultAsk 注释。）
    await click('[data-testid="vault-tab-ask"]', "back to Ask tab");
    await waitFor('[data-testid="ask-input"]', "Knowledge Ask input after returning from notes");
    await ensurePreviousExpanded();
    await setAskInput(G20_TOKEN);
    await resetProbe();
    const raceAttach = await browser.execute(() => {
      const attach = document.querySelector<HTMLButtonElement>(
        '[data-testid="ask-previous-add-to-agent"]',
      );
      const submit = document.querySelector<HTMLButtonElement>('[data-testid="ask-submit"]');
      if (!attach || !submit)
        return { attach: Boolean(attach), submit: Boolean(submit), clicked: false };
      attach.click();
      submit.click();
      return { attach: true, submit: true, clicked: true };
    });
    assert.deepEqual(
      raceAttach,
      { attach: true, submit: true, clicked: true },
      "G G20 attach race clicks did not land",
    );
    await waitForCandidate(G20_NOTE, 90_000);
    const [attach1, attach2] = await sampleTwice(async () => ({
      probe: await readProbe(),
      composer: await readComposerState([G20_TOKEN]),
    }));
    for (const [label, sample] of [
      ["first", attach1],
      ["second", attach2],
    ] as const) {
      assert.equal(
        sample.probe.add,
        0,
        `G20 attach race ${label}: the late re-verified reference must not enter the composer (probe=${JSON.stringify(sample.probe)})`,
      );
      assert.equal(
        sample.composer.chipCount,
        0,
        `G20 attach race ${label}: no trusted chip may appear`,
      );
    }
    // 说明：attach 正向对照不在本用例重复（会向 A 的 Composer 留 chip，干扰 G22 的
    // 「新会话 Composer 干净」断言）；attach = verify + dispatch，两段分别由本用例
    // open 正向对照与 G21/G22 的正向交接覆盖。

    // 交错变体三（切换会话）：同一同步栈点旧笔记 open + 侧栏切 Session B。
    await ensurePreviousExpanded();
    await resetProbe();
    const raceSwitch = await browser.execute((taskTestId) => {
      const previous = document.querySelector<HTMLButtonElement>(
        '[data-testid="ask-previous-candidate"]',
      );
      const taskItem = document.querySelector<HTMLElement>(`[data-testid="${taskTestId}"]`);
      if (!previous || !taskItem) {
        return { previous: Boolean(previous), task: Boolean(taskItem), clicked: false };
      }
      previous.click();
      taskItem.click();
      return { previous: true, task: true, clicked: true };
    }, `task-item-${sessionBId}`);
    assert.deepEqual(
      raceSwitch,
      { previous: true, task: true, clicked: true },
      "G G20 session-switch race clicks did not land",
    );
    await browser.waitUntil(async () => (await getV4ConversationState()).taskId === sessionBId, {
      timeout: 30_000,
      timeoutMsg: "G G20 session switch to B did not take effect",
    });
    // 双采样：迟到引用不打开笔记（Vault 主视图不再激活），也不进新 Session Composer。
    const [switch1, switch2] = await sampleTwice(async () => ({
      dom: await browser.execute(
        (token) => ({
          vaultVisible: Boolean(
            document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
          ),
          editorHasToken: Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
            (el) => el.textContent?.includes(token) && el.getClientRects().length > 0,
          ),
        }),
        G20_TOKEN,
      ),
      probe: await readProbe(),
      composer: await readComposerState([G20_TOKEN]),
    }));
    for (const [label, sample] of [
      ["first", switch1],
      ["second", switch2],
    ] as const) {
      assert.equal(
        sample.dom.vaultVisible,
        false,
        `G20 session-switch race ${label}: a late navigation must not re-activate the Vault view`,
      );
      assert.equal(
        sample.dom.editorHasToken,
        false,
        `G20 session-switch race ${label}: the late citation must not open the note`,
      );
      assert.equal(
        sample.probe.add,
        0,
        `G20 session-switch race ${label}: nothing may reach any composer (probe=${JSON.stringify(sample.probe)})`,
      );
      assert.equal(
        sample.composer.chipCount,
        0,
        `G20 session-switch race ${label}: session B's composer must stay clean of the stale reference`,
      );
      assert.equal(
        sample.composer.manifestHits,
        0,
        `G20 session-switch race ${label}: no manifest text may leak`,
      );
    }
    console.info("G20 passed: late previous-round citations dropped across both interleavings");
  });

  it("G21 changing the second selection during an ANSWER handoff verification drops the stale pair; a fresh handoff carries the new selection", async function () {
    this.timeout(300_000);
    // G20 结束态：活动会话 B 的 chat 视图。B 的 Composer 必须从干净状态开始。
    await openVaultAsk();
    await submitAskQuery("answer", PAIR_TOKEN);
    await waitForCandidate(PAIR_ONE_NOTE);
    await waitForCandidate(PAIR_TWO_NOTE);
    await waitForCandidate(PAIR_THREE_NOTE);
    await selectCandidate(PAIR_ONE_NOTE);
    await selectCandidate(PAIR_TWO_NOTE);
    await resetProbe();
    // 竞态：同一同步栈先点「交给 Agent」（捕获 [One,Two] 与 selectionVersion），
    // 随后取消 Two、改选 Three（每次选择点击在 React 渲染前同步 ++selectionVersionRef）。
    const race = await browser.execute(
      (noteTwo, noteThree) => {
        const handoff = document.querySelector<HTMLButtonElement>(
          '[data-testid="ask-agent-handoff-submit"]',
        );
        const cardTwo = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
        ).find((el) => el.textContent?.includes(noteTwo));
        const cardThree = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'),
        ).find((el) => el.textContent?.includes(noteThree));
        if (!handoff || !cardTwo || !cardThree) {
          return {
            handoff: Boolean(handoff),
            cardTwo: Boolean(cardTwo),
            cardThree: Boolean(cardThree),
            clicked: false,
          };
        }
        const selectTwo = cardTwo.querySelector<HTMLButtonElement>("button");
        const selectThree = cardThree.querySelector<HTMLButtonElement>("button");
        if (!selectTwo || !selectThree) {
          return { handoff: true, cardTwo: true, cardThree: true, clicked: false };
        }
        handoff.click();
        selectTwo.click();
        selectThree.click();
        return { handoff: true, cardTwo: true, cardThree: true, clicked: true };
      },
      PAIR_TWO_NOTE,
      PAIR_THREE_NOTE,
    );
    assert.deepEqual(
      race,
      { handoff: true, cardTwo: true, cardThree: true, clicked: true },
      "G G21 race clicks did not land",
    );
    // 等交接批次结束（busy 解除）后双采样；先留出 busy 渲染窗口再轮询解除。
    await browser.pause(500);
    await browser.waitUntil(
      () =>
        browser.execute(
          (zh, en) => {
            const button = document.querySelector<HTMLButtonElement>(
              '[data-testid="ask-agent-handoff-submit"]',
            );
            if (!button || button.disabled) return false;
            const text = button.textContent ?? "";
            return !text.includes(zh) && !text.includes(en);
          },
          HANDOFF_CHECKING_ZH,
          HANDOFF_CHECKING_EN,
        ),
      { timeout: 30_000, timeoutMsg: "G G21 handoff busy state never settled" },
    );
    const [drop1, drop2] = await sampleTwice(async () => ({
      selection: await browser.execute(
        (one, two, three) => ({
          one: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
            .find((el) => el.textContent?.includes(one))
            ?.getAttribute("aria-selected"),
          two: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
            .find((el) => el.textContent?.includes(two))
            ?.getAttribute("aria-selected"),
          three: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
            .find((el) => el.textContent?.includes(three))
            ?.getAttribute("aria-selected"),
        }),
        PAIR_ONE_NOTE,
        PAIR_TWO_NOTE,
        PAIR_THREE_NOTE,
      ),
      probe: await readProbe(),
      composer: await readComposerState([PAIR_TOKEN]),
    }));
    for (const [label, sample] of [
      ["first", drop1],
      ["second", drop2],
    ] as const) {
      // 旧两篇引用不得进入 Composer：无 handoff 送达、无 chip、无 manifest 文本。
      assert.equal(
        sample.probe.handoff,
        0,
        `G21 ${label}: the stale [One,Two] handoff must be dropped (probe=${JSON.stringify(sample.probe)})`,
      );
      assert.equal(sample.probe.add, 0, `G21 ${label}: no reference may be appended`);
      assert.equal(
        sample.composer.chipCount,
        0,
        `G21 ${label}: no trusted chip may appear (composer=${JSON.stringify(sample.composer)})`,
      );
      assert.equal(
        sample.composer.manifestHits,
        0,
        `G21 ${label}: no handoff manifest may leak into the composer`,
      );
      assert.equal(
        sample.selection.one,
        "true",
        `G21 ${label}: One must stay selected after the re-selection`,
      );
      assert.equal(
        sample.selection.two,
        "false",
        `G21 ${label}: Two must be deselected by the re-selection`,
      );
      assert.equal(
        sample.selection.three,
        "true",
        `G21 ${label}: Three must be selected by the re-selection`,
      );
    }
    // 需要对新选择重新执行交接：正常点击后 Composer 收到 [1]=One [2]=Three。
    await click('[data-testid="ask-agent-handoff-submit"]', "re-run handoff for One+Three");
    await browser.waitUntil(
      async () => {
        const state = await readComposerState([MANIFEST_HEADER, PAIR_ONE_NOTE]);
        return state.manifestHits === 1;
      },
      { timeout: 45_000, timeoutMsg: "G G21 re-run handoff never reached the composer" },
    );
    const reRun = await readComposerState([MANIFEST_HEADER, PAIR_ONE_NOTE]);
    assert.equal(reRun.manifestHits, 1, "G21 exactly one manifest must reach the composer");
    assert.equal(
      reRun.anchoredChipCount,
      2,
      `G21 the fresh handoff must attach exactly two references (composer=${JSON.stringify(reRun)})`,
    );
    const composerText = await browser.execute(async () => {
      const el = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'),
      ).find((item) => (item.textContent ?? "").includes("来源索引"));
      return el?.textContent ?? "";
    });
    assert.ok(composerText.includes(`[1] path=`) && composerText.includes(PAIR_ONE_NOTE));
    assert.ok(composerText.includes(`[2] path=`) && composerText.includes(PAIR_THREE_NOTE));
    assert.ok(
      !composerText.includes(PAIR_TWO_NOTE),
      "G21 the deselected second note must not appear in the fresh manifest",
    );
    const finalProbe = await readProbe();
    assert.equal(
      finalProbe.handoff,
      1,
      `G21 exactly one effective handoff batch may deliver after the re-run (probe=${JSON.stringify(finalProbe)})`,
    );
    assert.equal(finalProbe.add, 1, "G21 the handoff commit fires exactly one add event");
    console.info("G21 passed: stale pair dropped, fresh One+Three handoff delivered");
  });

  it("G22 double-clicking the handoff while verification is in flight runs one batch; after the switch nothing reaches the new session composer", async function () {
    this.timeout(360_000);
    // 新建真实 Session C（Composer 干净），G21 留在 B 的草稿不参与断言。
    await startNewV4Draft();
    await sendV4Prompt(
      `${SESSION_C_MARKER}: establish an independent third session without any evidence.`,
    );
    await waitForV4AssistantMessageContaining("G_INTERLEAVING_C_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "G session C did not become idle",
      90_000,
    );
    const stateC = await getV4ConversationState();
    sessionCId = stateC.taskId ?? null;
    assert.ok(sessionCId, "G session C task id missing");
    await openVaultAsk();
    await submitAskQuery("answer", PAIR_TOKEN);
    await selectCandidate(PAIR_ONE_NOTE);
    await selectCandidate(PAIR_TWO_NOTE);

    // 阶段一（双击唯一性）：同一同步栈连点两次「交给 Agent」。同步 ref 锁
    // （useKnowledgeAgentActions.ts handoffRef）必须只启动一个核验批次。
    await resetProbe();
    const doubleClick = await browser.execute(() => {
      const handoff = document.querySelector<HTMLButtonElement>(
        '[data-testid="ask-agent-handoff-submit"]',
      );
      if (!handoff) return { handoff: false, clicks: 0 };
      handoff.click();
      handoff.click();
      return { handoff: true, clicks: 2 };
    });
    assert.deepEqual(doubleClick, { handoff: true, clicks: 2 }, "G G22 double clicks did not land");
    await browser.waitUntil(
      async () => {
        const state = await readComposerState([MANIFEST_HEADER, PAIR_ONE_NOTE]);
        return state.manifestHits === 1;
      },
      { timeout: 45_000, timeoutMsg: "G G22 single handoff batch never reached the composer" },
    );
    const phaseOne = await readComposerState([MANIFEST_HEADER, PAIR_ONE_NOTE]);
    assert.equal(
      phaseOne.manifestHits,
      1,
      `G22 the double click must produce exactly one manifest (composer=${JSON.stringify(phaseOne)})`,
    );
    assert.equal(phaseOne.anchoredChipCount, 2, "G22 exactly two references may be attached");
    const phaseOneProbe = await readProbe();
    assert.equal(
      phaseOneProbe.handoff,
      1,
      `G22 only one effective verification batch may deliver on double click (probe=${JSON.stringify(phaseOneProbe)})`,
    );
    assert.equal(phaseOneProbe.add, 1, "G22 the single batch commits exactly one add event");

    // 阶段二（迟到切换）：交接成功后 Vault 关闭；重开 Ask（round 与选择保留），
    // 同一同步栈双击「交给 Agent」后立即切回 Session A。
    await openVaultAsk();
    await browser.waitUntil(
      () =>
        browser.execute(
          (one, two) => {
            const sel = (name: string) =>
              Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
                .find((el) => el.textContent?.includes(name))
                ?.getAttribute("aria-selected");
            const button = document.querySelector<HTMLButtonElement>(
              '[data-testid="ask-agent-handoff-submit"]',
            );
            return Boolean(
              button && !button.disabled && sel(one) === "true" && sel(two) === "true",
            );
          },
          PAIR_ONE_NOTE,
          PAIR_TWO_NOTE,
        ),
      { timeout: 30_000, timeoutMsg: "G G22 ask round/selection did not persist after reopen" },
    );
    const raceSwitch = await browser.execute((taskTestId) => {
      const handoff = document.querySelector<HTMLButtonElement>(
        '[data-testid="ask-agent-handoff-submit"]',
      );
      const taskItem = document.querySelector<HTMLElement>(`[data-testid="${taskTestId}"]`);
      if (!handoff || !taskItem) {
        return { handoff: Boolean(handoff), task: Boolean(taskItem), clicked: false };
      }
      handoff.click();
      handoff.click();
      taskItem.click();
      return { handoff: true, task: true, clicked: true };
    }, `task-item-${sessionAId}`);
    assert.deepEqual(
      raceSwitch,
      { handoff: true, task: true, clicked: true },
      "G G22 switch race clicks did not land",
    );
    await browser.waitUntil(async () => (await getV4ConversationState()).taskId === sessionAId, {
      timeout: 30_000,
      timeoutMsg: "G G22 session switch to A did not take effect",
    });
    // 双采样：旧会话结果不得写入新会话 Composer（A 干净），也不再有任何新批次送达。
    const [late1, late2] = await sampleTwice(async () => ({
      probe: await readProbe(),
      composer: await readComposerState([PAIR_TOKEN]),
    }));
    for (const [label, sample] of [
      ["first", late1],
      ["second", late2],
    ] as const) {
      assert.equal(
        sample.probe.handoff,
        1,
        `G22 ${label}: the raced double click after the switch must not deliver a second batch (probe=${JSON.stringify(sample.probe)})`,
      );
      assert.equal(
        sample.probe.add,
        1,
        `G22 ${label}: no additional reference commit may fire after the switch`,
      );
      // 可见域断言「新会话 Composer」：旧会话（C）composer 可以隐藏挂载，全局计数
      // 只作诊断（第三轮实测 C 的草稿在切 A 后仍占全局 chipCount=1）。
      assert.equal(
        sample.composer.visibleChipCount,
        0,
        `G22 ${label}: session A's visible composer must stay clean (composer=${JSON.stringify(sample.composer)})`,
      );
      assert.equal(
        sample.composer.visibleManifestHits,
        0,
        `G22 ${label}: no manifest may leak into the new session's visible composer`,
      );
    }
    // 回到 C：阶段一的草稿原样保留（迟到批次未追加、未重复）。
    await returnToChatView(sessionCId!);
    await browser.waitUntil(async () => (await getV4ConversationState()).taskId === sessionCId, {
      timeout: 30_000,
      timeoutMsg: "G G22 did not return to session C",
    });
    await browser.waitUntil(
      async () =>
        (await readComposerState([MANIFEST_HEADER, PAIR_ONE_NOTE])).visibleManifestHits === 1,
      {
        timeout: 15_000,
        timeoutMsg: "G G22 session C's draft manifest did not rehydrate after the switch back",
      },
    );
    const backToC = await readComposerState([MANIFEST_HEADER, PAIR_ONE_NOTE]);
    assert.equal(
      backToC.visibleManifestHits,
      1,
      `G22 session C's visible draft must keep exactly one manifest (composer=${JSON.stringify(backToC)})`,
    );
    assert.equal(backToC.anchoredChipCount, 2, "G22 session C's reference count must stay at two");
    console.info("G22 passed: one batch per double click, nothing crossed the session switch");
  });

  /**
   * G20 的「迟到引用不打开笔记」子句需要无竞态正向对照才有判定力（否则无法区分
   * 「守卫丢弃」与「通路本身损坏」）。本 it 是该正向对照，同时是产品缺陷 D-G20-1
   * 的探针（2026-10-18 本包第三轮真实 Electron 运行发现，未修产品，如实记录）：
   *
   * D-G20-1「上一轮候选的『跳到原文』在无竞态下也确定性静默失败」
   * - usePreviousKnowledgeActions.ts:90-96：onOpenNote 未 await，其 isCurrent 闭包
   *   读 openingPreviousRef.current === token；
   * - usePreviousKnowledgeActions.ts:135-139：try 块结束后 finally 在同一 tick 内把
   *   openingPreviousRef.current 置空；
   * - VaultView.tsx:1339：openFile 内 `await flushCurrentEditor()`（await 至少让出
   *   一个微任务），:1340 的第二次 isCurrent() 因此恒为 false → return false；
   * - 结果：无 readFile、无 toast、notes tab 不切换。第三轮运行证据：host 侧
   *   prepareEvidence/resolveCitation OK（desktop log 23:45:57.245/249），全程零
   *   obsidian-vault.readFile，30s 采样 notes tab 未激活。Node 最小时序复现输出
   *   note-closed(bail-second-isCurrent)。
   * - 影响面：G17/G20/G28 一族「上一轮/历史候选打开原文」的交互判据；当前轮卡片
   *   （openCurrentCandidate，scope 型 isCurrent）与引用回跳（epoch 型）不受影响。
   * 产品修复本缺陷后本 it 应转绿，G20 的完整判定力随之恢复。
   */
  it("G20 positive control: an unraced previous-round note open must open the source (currently broken by defect D-G20-1)", async function () {
    this.timeout(240_000);
    // 2026-10-19 收尾门控（主 agent 决策）：D-G20-1 未修复前本探针确定性失败
    // （上方证据链），默认跳过以保持本 spec 其余 4 个用例（G11/G20 主 it/G21/G22）
    // 的真实 CI 门禁力；G20 判定仍按 FAIL 记录（见
    // docs/vaultview/delivery/G_BACKLOG_AUTOMATION_2026-10-18.md），不折算 PASS。
    // D-G20-1 已于 2026-10-19 修复（usePreviousKnowledgeActions 导航闭包与 busy
    // token 解耦，见该文件 D-G20-1 注释）：本用例撤销 skip 转为默认回归守卫。

    await returnToChatView(sessionAId!);
    await openVaultAsk();
    await submitAskQuery("find", G20_TOKEN);
    await waitForCandidate(G20_NOTE);
    await submitAskQuery("find", G20_TOKEN);
    await waitForCandidate(G20_NOTE);
    await ensurePreviousExpanded();
    const previousCardName = await browser.execute(
      () =>
        document.querySelector<HTMLElement>('[data-testid="ask-previous-candidate"]')
          ?.textContent ?? "",
    );
    assert.ok(
      previousCardName.includes(G20_NOTE),
      `G G20-control previous round must fold the ${G20_NOTE} round (got=${previousCardName})`,
    );
    // 流水线生命力前置证明：当前轮手动核验通过（排除 prepare/resolve 整体不可用）。
    await click(
      '[data-testid="ask-candidate-verify"]',
      "verify liveness before the previous-open control",
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          (noteName) =>
            Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
              .find((el) => el.textContent?.includes(noteName))
              ?.querySelector('[data-testid="ask-evidence"]')
              ?.getAttribute("data-evidence-phase"),
          G20_NOTE,
        )) === "verified",
      {
        timeout: 60_000,
        timeoutMsg: "G G20-control current-round verify did not pass (pipeline liveness failed)",
      },
    );
    // 无竞态点击上一轮候选：按 G17 判据必须重新核验并打开原文。
    await click(
      '[data-testid="ask-previous-candidate"]',
      "unraced previous-round open (D-G20-1 probe)",
    );
    let opened = false;
    try {
      await browser.waitUntil(
        () =>
          browser.execute((token) => {
            return Boolean(
              document
                .querySelector('[data-testid="vault-tab-notes"]')
                ?.getAttribute("aria-selected") === "true" &&
              Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
                (el) => el.textContent?.includes(token) && el.getClientRects().length > 0,
              ),
            );
          }, G20_TOKEN),
        { timeout: 15_000, timeoutMsg: "previous-round open did not reveal the note" },
      );
      opened = true;
    } catch {
      opened = false;
    }
    assert.equal(
      opened,
      true,
      [
        "G20 正向对照失败：无竞态的上一轮『跳到原文』未打开笔记（产品缺陷 D-G20-1）。",
        "证据链：当前轮手动核验已通过（流水线存活），host 侧 prepareEvidence/resolveCitation OK，",
        "但无 obsidian-vault.readFile、无 notes tab 激活——usePreviousKnowledgeActions.ts:135-139",
        "的 finally 在未 await 的 onOpenNote（:90-96）之后同 tick 置空 token，VaultView.tsx:1340",
        "的二次 isCurrent 恒 false。详见本文件头注释与验收 notes。产品修复后本断言转绿。",
      ].join(" "),
    );
  });
});
