/**
 * R3 acceptance pack (PR #23 验收包 R3 — 时间差拒绝):
 * - G05 交接后修改原文再发送 → CLI guard.evidenceStale 拒绝、草稿保留不 dispatch
 * - G06 删除原文 → guard.evidenceMissing
 * - G07 撤销 Vault 授权 → guard.evidenceForbidden、原文不泄漏
 *
 * 断言形态照 G66 修复后（评审 B-4）：必须包含 SEND_FAILED 错误面与真实 CLI
 * guard 码，不得只断言 idle + 草稿保留。Knowledge/CLI/Composer RPC 全部走
 * 真实 Electron Host；仅上游模型经本地回放返回确定性文本，不伪造 Receipt。
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";

const CASE_NAME = "R3-time-based-reject";
const MODEL_ID = "e2e-r3-time-based-reject-model";
const PROVIDER_ID = "e2e-r3-time-based-reject-provider";
const INITIAL_MARKER = "E2E_R3_G05_START";
const QUERY = "OrchidLedgerR3Beacon2026";
const NOTE_NAME = "R3-Time-Based-Reject-Evidence.md";
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
const CONFIG = join(dirname(ROOT), "vault-config.json");
const REVOKED_CONFIG = `${CONFIG}.r3-revoked`;
const SOURCE =
  "# R3 local Obsidian evidence\n\n" +
  `The original ${QUERY} note says: only a production-issued Receipt authorizes opening this text.\n`;

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;
let handoffReady = false;

function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "R3 refuses to operate outside the isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "R3 requires isolated .e2e-home");
  assert.ok(FILE.startsWith(join(HOME, ".drora") + sep));
  assert.ok(CONFIG.startsWith(join(HOME, ".drora") + sep));
  assert.ok(REVOKED_CONFIG.startsWith(join(HOME, ".drora") + sep));
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
    { timeout, timeoutMsg: `R3 expected ${label}: ${selector}` },
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
    if (!el || !setter) throw new Error("R3 missing native Ask input");
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

async function awaitIndex(): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          document
            .querySelector('[data-testid="knowledge-ask-view"]')
            ?.getAttribute("data-index-configured") === "true",
      ),
    { timeout: 30_000, timeoutMsg: "R3 Vault index configuration not loaded" },
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
    { timeout: 90_000, timeoutMsg: "R3 real Knowledge index did not report a file" },
  );
}

/** 断言被拒发送的真实 CLI 错误面与 guard 码（照 G66 修复后的断言形态）。 */
async function assertSendFailedGuardCode(guardCode: string): Promise<string> {
  await browser.waitUntil(
    () =>
      browser.execute(() =>
        Boolean(document.querySelector('[data-error-code="SEND_FAILED"] button[data-testid]')),
      ),
    {
      timeout: 30_000,
      timeoutMsg: `R3 ${guardCode} send must surface the real CLI SEND_FAILED error`,
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
    { timeout: 30_000, timeoutMsg: `R3 CLI did not return ${guardCode}` },
  );
  // 关闭错误详情，避免残留 dialog 干扰后续采样。
  await browser.execute(() => {
    const close = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[data-slot="dialog-close"], [role="dialog"] button[aria-label="Close"]',
    );
    close?.click();
  });
  const dialogText = await browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      .map((el) => el.innerText)
      .join("\n"),
  );
  return dialogText;
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

describe("R3 time-based evidence rejection (G05/G06/G07)", () => {
  before(async function () {
    this.timeout(240_000);
    assertSandbox();
    await mkdir(ROOT, { recursive: true });
    await writeFile(FILE, SOURCE, { encoding: "utf8", flag: "wx" });
    replay = await startConversationModelProviderReplayServer(CASE_NAME);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    const [provider] = await restartWithSeededOpenAIProviders([
      {
        modelId: MODEL_ID,
        providerId: PROVIDER_ID,
        providerName: "R3 Time Based Reject E2E",
      },
    ]);
    if (!provider) throw new Error("R3 seeded replay provider missing");
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
    // G05–G07 的证据必须绑定一个已存在的真实 CLI Session。
    await sendV4Prompt(
      `${INITIAL_MARKER}: create a genuine active conversation before Vault queries.`,
    );
    await waitForV4AssistantMessageContaining(INITIAL_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "R3 initial conversation did not become idle",
      90_000,
    );
  });

  after(async () => {
    assertSandbox();
    const text = await readFile(FILE, "utf8").catch(() => null);
    if (text === SOURCE) await rm(FILE);
    // 兜底：任何中断路径都不允许把 revoked 配置留在隔离 HOME 里。
    const revoked = await readFile(REVOKED_CONFIG, "utf8").catch(() => null);
    if (revoked !== null) await rename(REVOKED_CONFIG, CONFIG);
    await replay?.stop();
    replay = null;
    await browser.electron.restoreAllMocks();
  });

  it("G05 edits the source after handoff: CLI guard.evidenceStale rejects and the draft is never dispatched", async function () {
    this.timeout(240_000);
    // 首次连接隔离 managed Vault 并建立真实索引。
    await click('[data-testid="vault-sidebar-open"]', "Vault main view");
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
      { timeout: 30_000, timeoutMsg: "R3 managed Vault was not configured" },
    );
    await click('[data-testid="vault-tab-ask"]', "Ask tab");
    await waitFor('[data-testid="ask-input"]', "real Knowledge Ask");
    await awaitIndex();

    // ANSWER 检索真实索引并交接，拿到服务端新签发的 Receipt。
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
      { timeout: 60_000, timeoutMsg: "R3 indexed candidate unavailable" },
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
      { timeout: 10_000, timeoutMsg: "R3 ANSWER candidate not selected" },
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
        timeoutMsg: "R3 trusted handoff never returned to the live Agent composer",
      },
    );
    const beforeRows = (await readComposerOutcome()).rowCount;

    // 时间差：交接（签发 Receipt）之后、发送之前修改原文。
    const changed = SOURCE.replace(QUERY, `${QUERY}-edited-before-send`);
    assert.notEqual(changed, SOURCE);
    await writeFile(FILE, changed, "utf8");
    try {
      await click('[data-testid="v4-composer-send"]', "send stale sourced draft");
      await assertSendFailedGuardCode("guard.evidenceStale");
      await waitForV4ConversationState(
        (s) => s.state === "idle" && s.queueCount === 0,
        "G05 stale evidence must not start an Agent turn",
        20_000,
      );
      const rejected = await readComposerOutcome();
      assert.equal(
        rejected.draftPresent,
        true,
        "G05 stale CLI admission must preserve the trusted Composer draft",
      );
      assert.equal(
        rejected.rowCount,
        beforeRows,
        "G05 stale send must not create a canonical conversation row",
      );
      assert.equal(
        await readFile(FILE, "utf8"),
        changed,
        "G05 rejected send must never edit original Markdown",
      );
      handoffReady = true;
    } finally {
      await writeFile(FILE, SOURCE, "utf8");
    }
  });

  it("G06 deletes the source before Send: CLI guard.evidenceMissing rejects without dispatching", async function () {
    this.timeout(180_000);
    if (!handoffReady) this.skip();
    assertSandbox();
    await browser.waitUntil(async () => (await readComposerOutcome()).draftPresent, {
      timeout: 15_000,
      timeoutMsg: "G06 requires the retained trusted Composer draft",
    });
    const beforeRows = (await readComposerOutcome()).rowCount;
    await rm(FILE);

    try {
      await click('[data-testid="v4-composer-send"]', "send with a deleted backing Markdown file");
      await assertSendFailedGuardCode("guard.evidenceMissing");
      await waitForV4ConversationState(
        (s) => s.state === "idle" && s.queueCount === 0,
        "G06 missing evidence must never dispatch a model turn",
        20_000,
      );
      const outcome = await readComposerOutcome();
      assert.equal(
        outcome.draftPresent,
        true,
        "G06 missing source must retain the user Composer draft",
      );
      assert.equal(
        outcome.rowCount,
        beforeRows,
        "G06 missing source must not create a canonical user row",
      );
      await assert.rejects(readFile(FILE, "utf8"), { code: "ENOENT" });
    } finally {
      // 不得把已删除的夹具留给后续场景。
      await writeFile(FILE, SOURCE, { encoding: "utf8", flag: "wx" });
    }
  });

  it("G07 revokes the Vault before Send: CLI guard.evidenceForbidden rejects and leaks no original text", async function () {
    this.timeout(180_000);
    if (!handoffReady) this.skip();
    assertSandbox();
    const originalConfig = await readFile(CONFIG, "utf8");
    assert.ok(originalConfig.includes("configuredAt"), "G07 requires a real configured Vault");
    await browser.waitUntil(async () => (await readComposerOutcome()).draftPresent, {
      timeout: 15_000,
      timeoutMsg: "G07 needs a retained genuine evidence draft",
    });
    const beforeRows = (await readComposerOutcome()).rowCount;

    // 撤销授权：仅临时移走隔离测试 Vault 的真实配置文件。
    await rename(CONFIG, REVOKED_CONFIG);
    try {
      await assert.rejects(readFile(CONFIG, "utf8"), { code: "ENOENT" });
      await click(
        '[data-testid="v4-composer-send"]',
        "send after real Vault authorization removal",
      );
      const dialogText = await assertSendFailedGuardCode("guard.evidenceForbidden");
      // 原文不泄漏：拒绝错误面不得携带 Vault 原文正文（独有 token / 原句片段）。
      assert.equal(
        dialogText.includes(QUERY),
        false,
        `G07 error surface must not leak the original note text (${QUERY})`,
      );
      assert.equal(
        dialogText.includes("only a production-issued Receipt authorizes"),
        false,
        "G07 error surface must not leak the original note sentence",
      );
      await waitForV4ConversationState(
        (s) => s.state === "idle" && s.queueCount === 0,
        "G07 revoked evidence must never dispatch a model turn",
        20_000,
      );
      const outcome = await readComposerOutcome();
      assert.equal(outcome.draftPresent, true, "G07 revoked source must retain the user's draft");
      assert.equal(
        outcome.rowCount,
        beforeRows,
        "G07 revoked evidence must not create a canonical user row",
      );
    } finally {
      await rename(REVOKED_CONFIG, CONFIG);
      assert.equal(
        await readFile(CONFIG, "utf8"),
        originalConfig,
        "G07 must fully restore the isolated test authorization",
      );
      assert.equal(await readFile(FILE, "utf8"), SOURCE, "G07 must not modify source Markdown");
    }
  });
});
