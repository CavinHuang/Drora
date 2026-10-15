/**
 * G58: Real Electron + real host Knowledge RPC + real filesystem read-only smoke.
 *
 * The managed Vault lives strictly inside this WDIO worker's isolated E2E HOME.
 * No production Vault, model provider, network request, or mocked service is used.
 * G58 covers managed-vault connection, indexing, FIND and verified Inspector
 * -> original Markdown read. It does NOT prove Agent receipt admission or the
 * completed-turn inline citation journey (those remain separate GUI gates).
 */
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "./helpers/desktop-app.js";

const E2E_HOME = resolve(dirname(DEFAULT_WORKSPACE));
const DATA_BASE = resolve(process.env.DRORA_DATA_BASE_DIR?.trim() || E2E_HOME);
const VAULT_ROOT = join(DATA_BASE, ".drora", "cli", "data", "obsidian@drora-plugins-official", "managed-vault");
const NOTE_NAME = "G58-Obsidian-Positive-E2E.md";
const NOTE_FILE = join(VAULT_ROOT, NOTE_NAME);
const SEARCH_TOKEN = "OrchidLedgerBeacon2026";
const NOTE_BODY = [
  "# G58 synthetic evidence",
  "",
  "## First-party original Markdown",
  "",
  `${SEARCH_TOKEN} is a synthetic read-only Electron test source.`,
  "The verified quote must open this exact file, not a model-authored path.",
  "",
].join("\n");

function assertIsolatedVault(): void {
  // WDIO's HOME and service data base must agree; never write into the user's
  // normal ~/.drora even if environment propagation breaks.
  assert.equal(DATA_BASE, E2E_HOME, "G58 refuses a different DRORA_DATA_BASE_DIR");
  assert.match(E2E_HOME, /(?:^|[/\\])\.e2e-home(?:[/\\]|$)/, "G58 requires isolated .e2e-home");
  assert.ok(NOTE_FILE.startsWith(join(E2E_HOME, ".drora") + sep));
}

async function waitForVisible(selector: string, label: string, timeout = 30_000): Promise<void> {
  await browser.waitUntil(() => browser.execute((target) => {
    const element = document.querySelector<HTMLElement>(target);
    return Boolean(element && element.getClientRects().length > 0
      && !(element instanceof HTMLButtonElement && element.disabled));
  }, selector), { timeout, timeoutMsg: `G58 ${label} not visible/enabled: ${selector}` });
}

async function clickControl(selector: string, label: string): Promise<void> {
  await waitForVisible(selector, label);
  const clicked = await browser.execute((target) => {
    const element = document.querySelector<HTMLElement>(target);
    if (!element) return false;
    element.click();
    return true;
  }, selector);
  assert.equal(clicked, true, `G58 failed clicking ${label}`);
}

describe("G58 real Electron managed Obsidian Vault: read-only positive flow", () => {
  let candidateVerifiedBySearch = false;
  before(async function () {
    this.timeout(120_000);
    assertIsolatedVault();
    // The main/host Electron process is real; only the Vault fixture is synthetic.
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await mkdir(VAULT_ROOT, { recursive: true });
    await writeFile(NOTE_FILE, NOTE_BODY, { encoding: "utf8", flag: "wx" });
  });

  after(async () => {
    // Only remove the exact file this isolated E2E worker created.
    assertIsolatedVault();
    const content = await readFile(NOTE_FILE, "utf8").catch(() => null);
    if (content === NOTE_BODY) await rm(NOTE_FILE);
    await browser.electron.restoreAllMocks();
  });

  it("connects a managed Vault, indexes a real Markdown file and retrieves it in FIND", async function () {
    this.timeout(180_000);
    await clickControl('[data-testid="vault-sidebar-open"]', "workspace Vault entry");
    await waitForVisible('[data-testid="vault-view"]', "Vault main view");
    await clickControl('[data-testid="vault-switcher-trigger"]', "Vault switcher");
    await clickControl('[data-testid="vault-create-managed"]', "create isolated managed Vault");

    await browser.waitUntil(() => browser.execute(() =>
      Boolean(document.querySelector('[data-testid="vault-switcher-trigger"]')?.textContent?.includes("Drora Vault")),
    ), { timeout: 30_000, timeoutMsg: "Managed Vault was not connected by production host" });

    await clickControl('[data-testid="vault-tab-ask"]', "Knowledge Ask tab");
    await waitForVisible('[data-testid="ask-input"]', "Knowledge Ask input");

    // First await the actual host getStatus reply. The absence of the cold-start
    // button during the initial loading frame is NOT evidence of a ready index.
    await browser.waitUntil(() => browser.execute(() =>
      document.querySelector('[data-testid="knowledge-ask-view"]')
        ?.getAttribute("data-index-configured") === "true",
    ), { timeout: 30_000, timeoutMsg: "Production Knowledge service did not report configured Vault" });

    const initialIndex = await browser.execute(() => {
      const view = document.querySelector('[data-testid="knowledge-ask-view"]');
      return {
        indexedFiles: Number(view?.getAttribute("data-indexed-files") ?? "-1"),
        job: view?.getAttribute("data-index-job-status") ?? "none",
      };
    });
    if (initialIndex.indexedFiles === 0 && initialIndex.job !== "running") {
      await clickControl('[data-testid="ask-index-start"]', "start actual Vault reconcile");
    }

    // A true, positive host-derived count is the barrier. Auto-reconcile may
    // also start while we are navigating; a missing spinner alone is not enough.
    await browser.waitUntil(() => browser.execute(() => {
      const view = document.querySelector('[data-testid="knowledge-ask-view"]');
      const count = Number(view?.getAttribute("data-indexed-files") ?? "-1");
      return count >= 1 && view?.getAttribute("data-index-job-status") !== "running";
    }), { timeout: 90_000, timeoutMsg: "Production Vault index never reported a completed file" });

    await browser.execute((query) => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-testid="ask-input"]');
      if (!input) throw new Error("G58 Ask textarea missing");
      // React-controlled input: native setter + input event, not DOM-only value change.
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setter) throw new Error("G58 textarea setter missing");
      setter.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, SEARCH_TOKEN);
    await clickControl('[data-testid="ask-submit"]', "submit FIND query");

    await browser.waitUntil(() => browser.execute((filename) =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
        .some((card) => card.textContent?.includes(filename)),
    NOTE_NAME), { timeout: 90_000, timeoutMsg: "Real indexed Markdown was not returned as a candidate" });

    const candidate = await browser.execute((filename) => {
      const card = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
        .find((el) => el.textContent?.includes(filename));
      return card && {
        file: card.textContent?.includes(filename) ?? false,
        excerpt: card.textContent?.includes("OrchidLedgerBeacon2026") ?? false,
      };
    }, NOTE_NAME);
    assert.equal(candidate?.file, true);
    assert.equal(candidate?.excerpt, true, "Index excerpt must come from the real file");
    candidateVerifiedBySearch = true;
  });

  it("reissues a real Evidence Receipt and opens the verified original without editing it", async function () {
    this.timeout(120_000);
    if (!candidateVerifiedBySearch) this.skip(); // G59 depends on successful G58 retrieval.
    await clickControl('[data-testid="ask-candidate-verify"]', "verify actual source");
    await browser.waitUntil(() => browser.execute(() =>
      Boolean(document.querySelector('[data-testid="ask-evidence"][data-evidence-phase="verified"]')),
    ), { timeout: 60_000, timeoutMsg: "Real prepareEvidence/resolveCitation did not verify" });

    await clickControl('[data-testid="ask-candidate-open-note"]', "open verified source");
    await waitForVisible('[data-testid="vault-tab-notes"]', "Vault notes view");
    await browser.waitUntil(() => browser.execute((token) =>
      Array.from(document.querySelectorAll<HTMLElement>(".cm-content"))
        .some((editor) => editor.textContent?.includes(token)),
    SEARCH_TOKEN), { timeout: 30_000, timeoutMsg: "CodeMirror did not show verified original Markdown" });

    const diskContent = await readFile(NOTE_FILE, "utf8");
    assert.equal(diskContent, NOTE_BODY, "Read-only Evidence smoke must never mutate the Vault");
  });
});
