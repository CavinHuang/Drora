/**
 * G61-G63: Real desktop cross-view Obsidian evidence handoff.
 * All Knowledge/CLI/Composer RPCs run in Electron; ONLY the upstream model is
 * replayed, with a deterministic plain [1] reply. No synthetic receipts, no
 * renderer injection of "trusted" source metadata, no user Vault writes.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../../helpers/desktop-app.js";
import { restartWithSeededOpenAIProviders } from "../../helpers/custom-openai-provider.js";
import { startConversationModelProviderReplayServer } from "../../helpers/model-provider-replay.js";
import { selectUpstreamProviderModelById, waitForUpstreamModelSelected } from "../../helpers/upstream-provider.js";
import {
  prepareV4ConversationE2E, sendV4Prompt, waitForV4AssistantMessageContaining, waitForV4ConversationState,
} from "../../helpers/v4-conversation.js";

const CASE_NAME = "conversation-session-obsidian-authenticated-handoff";
const MODEL_ID = "e2e-obsidian-authenticated-handoff-model";
const PROVIDER_ID = "e2e-obsidian-authenticated-handoff-provider";
const INITIAL_MARKER = "E2E_OBSIDIAN_G61_START";
const ANSWER_MARKER = "E2E_OBSIDIAN_G61_VERIFIED_ANSWER";
const QUERY = "OrchidLedgerBeacon2026";
const HOME = resolve(dirname(DEFAULT_WORKSPACE));
const DATA_BASE = resolve(process.env.DRORA_DATA_BASE_DIR?.trim() || HOME);
const ROOT = join(DATA_BASE, ".drora", "cli", "data", "obsidian@drora-plugins-official", "managed-vault");
const FILE = join(ROOT, "G61-Authenticated-Agent-Evidence.md");
const SOURCE = "# G61 local Obsidian evidence\n\n" +
  `The original ${QUERY} note says: only a production-issued Receipt authorizes opening this text.\n`;

let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;
let authenticatedCitationRendered = false;
function assertSandbox(): void {
  assert.equal(DATA_BASE, HOME, "Do not operate outside isolated WDIO HOME");
  assert.match(HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "G61 requires .e2e-home");
  assert.ok(FILE.startsWith(join(HOME, ".drora") + sep));
}
async function waitFor(selector: string, label: string, timeout = 30_000): Promise<void> {
  await browser.waitUntil(() => browser.execute((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    return Boolean(el && el.getClientRects().length && !(el instanceof HTMLButtonElement && el.disabled));
  }, selector), { timeout, timeoutMsg: `G61 expected ${label}: ${selector}` });
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
    if (!el || !setter) throw new Error("Missing native Ask input");
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}
async function awaitIndex(): Promise<void> {
  await browser.waitUntil(() => browser.execute(() =>
    document.querySelector('[data-testid="knowledge-ask-view"]')?.getAttribute("data-index-configured") === "true",
  ), { timeout: 30_000, timeoutMsg: "Vault index configuration not loaded" });
  const state = await browser.execute(() => {
    const el = document.querySelector('[data-testid="knowledge-ask-view"]');
    return { files: Number(el?.getAttribute("data-indexed-files") ?? "-1"),
      job: el?.getAttribute("data-index-job-status") };
  });
  if (state.files === 0 && state.job !== "running") {
    await click('[data-testid="ask-index-start"]', "real index build");
  }
  await browser.waitUntil(() => browser.execute(() => {
    const el = document.querySelector('[data-testid="knowledge-ask-view"]');
    return Number(el?.getAttribute("data-indexed-files") ?? "-1") >= 1
      && el?.getAttribute("data-index-job-status") !== "running";
  }), { timeout: 90_000, timeoutMsg: "Real Knowledge index did not report a file" });
}

describe("G61-G63: real Agent handoff and citation navigation", () => {
  before(async function () {
    this.timeout(240_000);
    assertSandbox();
    await mkdir(ROOT, { recursive: true });
    await writeFile(FILE, SOURCE, { encoding: "utf8", flag: "wx" });
    replay = await startConversationModelProviderReplayServer(CASE_NAME);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    const [provider] = await restartWithSeededOpenAIProviders([{
      modelId: MODEL_ID, providerId: PROVIDER_ID, providerName: "Obsidian Authenticated E2E",
    }]);
    if (!provider) throw new Error("G61 seeded replay provider missing");
    await prepareV4ConversationE2E({ skipProvider: true });
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await selectUpstreamProviderModelById(MODEL_ID, {
      includePlainModelFallback: false, providerId: provider.id, providerName: provider.name,
    });
    await waitForUpstreamModelSelected(MODEL_ID, {
      includePlainModelFallback: false, providerId: provider.id,
    });
    // Establish a real CLI Session; Vault answers must bind to an existing Session.
    await sendV4Prompt(`${INITIAL_MARKER}: create a genuine active conversation before Vault queries.`);
    await waitForV4AssistantMessageContaining(INITIAL_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => Boolean(s.sessionId) && s.state === "idle" && s.queueCount === 0,
      "G61 initial conversation did not become idle", 90_000,
    );
  });
  after(async () => {
    assertSandbox();
    const text = await readFile(FILE, "utf8").catch(() => null);
    if (text === SOURCE) await rm(FILE);
    await replay?.stop();
    replay = null;
    await browser.electron.restoreAllMocks();
  });

  it("G61 real Vault ANSWER prepares source manifest in the mounted Agent composer", async function () {
    this.timeout(180_000);
    await click('[data-testid="vault-sidebar-open"]', "Vault main view");
    await waitFor('[data-testid="vault-view"]', "Vault panel");
    await click('[data-testid="vault-switcher-trigger"]', "Vault selector");
    await click('[data-testid="vault-create-managed"]', "managed isolated Vault");
    await browser.waitUntil(() => browser.execute(() =>
      document.querySelector('[data-testid="vault-switcher-trigger"]')?.textContent?.includes("Drora Vault") ?? false,
    ), { timeout: 30_000, timeoutMsg: "Vault was not configured" });
    await click('[data-testid="vault-tab-ask"]', "Ask tab");
    await waitFor('[data-testid="ask-input"]', "real Knowledge Ask");
    await awaitIndex();
    await click('[data-testid="ask-intent-answer"]', "ANSWER intent");
    await setAskInput(QUERY);
    await click('[data-testid="ask-submit"]', "submit real Vault search");
    await browser.waitUntil(() => browser.execute(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
        .some((el) => el.textContent?.includes("G61-Authenticated-Agent-Evidence.md")),
    ), { timeout: 60_000, timeoutMsg: "Indexed candidate unavailable" });
    await click('[data-testid="ask-candidate"] button', "select actual file candidate");
    await browser.waitUntil(() => browser.execute(() =>
      document.querySelector('[data-testid="ask-candidate"]')?.getAttribute("aria-selected") === "true",
    ), { timeout: 10_000, timeoutMsg: "ANSWER candidate not selected" });
    await click('[data-testid="ask-agent-handoff-submit"]', "prepare evidence and Agent draft");

    await browser.waitUntil(() => browser.execute(() =>
      !document.querySelector('[data-testid="vault-view"]')?.getClientRects().length
        && Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'))
          .some((el) => el.textContent?.includes("OrchidLedgerBeacon2026")),
    ), { timeout: 45_000, timeoutMsg: "Trusted Answer handoff never returned to live Agent composer" });
  });

  it("G62 Agent accepts frozen evidenceRefs and renders model [1] as an authenticated citation", async function () {
    this.timeout(180_000);
    await click('[data-testid="v4-composer-send"]', "send verified draft to actual CLI");
    await waitForV4AssistantMessageContaining(ANSWER_MARKER, 90_000);
    await waitForV4ConversationState(
      (s) => s.state === "idle" && s.queueCount === 0,
      "Agent true evidence turn did not settle", 90_000,
    );
    try {
      await waitFor('[data-testid^="knowledge-inline-citation-"]', "authenticated source button", 15_000);
      authenticatedCitationRendered = true;
    } catch (error) {
      // E2E-only, non-sensitive turn diagnostics: never infer a trusted source
      // from model prose. Identify which canonical boundary lost authority.
      const diagnostic = await browser.execute(() =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-e2e-knowledge-diagnostics]"))
          .map((el) => el.getAttribute("data-e2e-knowledge-diagnostics")),
      );
      throw new Error(`G62 missing authenticated [1]; projected-turn diagnostics=${JSON.stringify(diagnostic)}`, {
        cause: error,
      });
    }
  });

  it("G64 rejects an already-rendered trusted citation after its source changes", async function () {
    this.timeout(90_000);
    if (!authenticatedCitationRendered) this.skip();
    assertSandbox();
    // The real CLI has already admitted this turn. The existing rendered
    // button must not authorize a path after its backing Markdown changed.
    const changed = SOURCE.replace(QUERY, `${QUERY}-edited-after-answer`);
    assert.notEqual(changed, SOURCE);
    await writeFile(FILE, changed, "utf8");
    try {
      await click('[data-testid^="knowledge-inline-citation-"]', "click expired CLI-backed citation");
      // Citation resolution is async. A forbidden/stale receipt must settle
      // without activating Vault or opening CodeMirror on the changed source.
      await browser.pause(1800);
      const navigation = await browser.execute(() => ({
        vaultActive: Boolean(document.querySelector('[data-testid="vault-view"]')?.getClientRects().length),
        codeMirrorVisible: Array.from(document.querySelectorAll<HTMLElement>(".cm-content"))
          .some((el) => Boolean(el.getClientRects().length)),
      }));
      assert.equal(navigation.vaultActive, false, "Stale answer source must not navigate to Vault");
      assert.equal(navigation.codeMirrorVisible, false, "Stale answer source must not open CodeMirror");
      assert.equal(await readFile(FILE, "utf8"), changed, "Citation rejection must never modify the source");
    } finally {
      await writeFile(FILE, SOURCE, "utf8");
    }
  });

  it("G63 clicking the genuine citation opens the exact Vault Markdown in CodeMirror", async function () {
    this.timeout(90_000);
    if (!authenticatedCitationRendered) this.skip();
    await click('[data-testid^="knowledge-inline-citation-"]', "real CLI-backed citation");
    await browser.waitUntil(() => browser.execute((token) =>
      document.querySelector('[data-testid="vault-tab-notes"]')?.getAttribute("aria-selected") === "true"
      && Array.from(document.querySelectorAll<HTMLElement>(".cm-content"))
        .some((editor) => editor.textContent?.includes(token) && editor.getClientRects().length),
    QUERY), { timeout: 30_000, timeoutMsg: "Real citation did not navigate to original CodeMirror note" });
    assert.equal(await readFile(FILE, "utf8"), SOURCE);
  });

  it("G66 stale at Send rejects genuine Composer evidence and retains draft", async function () {
    this.timeout(180_000);
    if (!authenticatedCitationRendered) this.skip();
    assertSandbox();
    // Return from the real CodeMirror note to a fresh ANSWER search. This
    // prepares a new current receipt using real RPC, not the one from G62.
    await click('[data-testid="vault-tab-ask"]', "return to Knowledge Ask");
    await waitFor('[data-testid="ask-input"]', "Knowledge Ask");
    await awaitIndex();
    await click('[data-testid="ask-intent-answer"]', "ANSWER intent");
    await setAskInput(QUERY);
    await click('[data-testid="ask-submit"]', "search unchanged source for handoff");
    await browser.waitUntil(() => browser.execute(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
        .some((el) => el.textContent?.includes("G61-Authenticated-Agent-Evidence.md")),
    ), { timeout: 60_000, timeoutMsg: "G66 actual candidate unavailable" });
    await click('[data-testid="ask-candidate"] button', "select G66 actual source");
    await click('[data-testid="ask-agent-handoff-submit"]', "prepare a newly issued Receipt");

    await browser.waitUntil(() => browser.execute((token) =>
      !document.querySelector('[data-testid="vault-view"]')?.getClientRects().length &&
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'))
        .some((el) => el.textContent?.includes(token)),
    QUERY), { timeout: 45_000, timeoutMsg: "G66 trusted composer was not prepared" });
    const beforeRows = await browser.execute(() =>
      Array.from(document.querySelectorAll("[data-row-id]")).length,
    );

    // Mutate the exact source after handoff but before clicking Send. CLI
    // admission, not the pre-send renderer chip, is the final authority.
    const changed = SOURCE.replace(QUERY, `${QUERY}-edited-before-send`);
    assert.notEqual(changed, SOURCE);
    await writeFile(FILE, changed, "utf8");
    try {
      await click('[data-testid="v4-composer-send"]', "send stale sourced draft");
      // Allow genuine host/CLI admission to return; do not mistake the
      // initial pre-submit draft for a restored, rejected draft.
      await browser.pause(2000);
      await waitForV4ConversationState(
        (s) => s.state === "idle" && s.queueCount === 0,
        "G66 stale evidence must not start an Agent turn", 20_000,
      );
      const rejected = await browser.execute((token) => ({
        draftPresent: Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="v4-composer-input"]'))
          .some((el) => el.textContent?.includes(token)),
        rowCount: Array.from(document.querySelectorAll("[data-row-id]")).length,
      }), QUERY);
      assert.equal(rejected.draftPresent, true, "Stale CLI admission must preserve trusted Composer draft");
      assert.equal(rejected.rowCount, beforeRows, "Stale send must not create a canonical conversation row");
      assert.equal(await readFile(FILE, "utf8"), changed, "Rejected send must never edit original Markdown");
    } finally {
      await writeFile(FILE, SOURCE, "utf8");
    }
  });

});
