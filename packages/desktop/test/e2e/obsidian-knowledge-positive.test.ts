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

/** Explicitly close a leftover Vault confirmation before entering the L2 form.
 * A background alert is modal and blocks ALL real WebDriver input. Never click
 * the destructive Confirm action: only the user-visible Cancel control.
 */
async function dismissBlockingVaultDialog(): Promise<void> {
  const modal = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"][data-state="open"]');
    if (!dialog) return null;
    return {
      title: dialog.querySelector('[data-slot="alert-dialog-title"]')?.textContent?.trim() ?? "",
      cancel: Boolean(dialog.querySelector<HTMLButtonElement>('[data-slot="alert-dialog-cancel"]:not(:disabled)')),
    };
  });
  if (!modal) return;
  assert.equal(modal.cancel, true, `G67 found an un-dismissable modal: ${modal.title}`);
  console.info(`G67 closing unrelated modal by Cancel: ${modal.title}`);
  await browser.execute(() => {
    const cancel = document.querySelector<HTMLButtonElement>(
      '[role="alertdialog"][data-state="open"] [data-slot="alert-dialog-cancel"]',
    );
    cancel?.click();
  });
  await browser.waitUntil(() => browser.execute(() =>
    !document.querySelector('[data-slot="alert-dialog-overlay"][data-state="open"]'),
  ), { timeout: 10_000, timeoutMsg: `G67 modal failed to close: ${modal.title}` });
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

  it("G60 source edited after Inspector verification cannot open a stale note", async function () {
    this.timeout(120_000);
    if (!candidateVerifiedBySearch) this.skip();
    await clickControl('[data-testid="vault-tab-ask"]', "return to Knowledge Ask");
    await waitForVisible('[data-testid="ask-input"]', "Knowledge Ask input");
    await browser.execute((query) => {
      const input = document.querySelector<HTMLTextAreaElement>('[data-testid="ask-input"]');
      if (!input) throw new Error("G60 Ask textarea missing");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setter) throw new Error("G60 native input setter missing");
      setter.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, SEARCH_TOKEN);
    await clickControl('[data-testid="ask-submit"]', "repeat FIND query");
    await browser.waitUntil(() => browser.execute((filename) =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ask-candidate"]'))
        .some((card) => card.textContent?.includes(filename)),
    NOTE_NAME), { timeout: 60_000, timeoutMsg: "G60 original indexed candidate unavailable" });
    await clickControl('[data-testid="ask-candidate-verify"]', "verify current source");
    await browser.waitUntil(() => browser.execute(() =>
      Boolean(document.querySelector('[data-testid="ask-evidence"][data-evidence-phase="verified"]')),
    ), { timeout: 60_000, timeoutMsg: "G60 source did not initially verify" });

    const mutated = NOTE_BODY.replace(SEARCH_TOKEN, `${SEARCH_TOKEN}-edited-after-verification`);
    assert.notEqual(mutated, NOTE_BODY);
    await writeFile(NOTE_FILE, mutated, "utf8");
    try {
      await clickControl('[data-testid="ask-candidate-open-note"]', "attempt stale source open");
      await browser.waitUntil(() => browser.execute(() =>
        Boolean(document.querySelector('[data-testid="ask-evidence"][data-evidence-phase="unavailable"]')),
      ), { timeout: 30_000, timeoutMsg: "G60 stale Receipt was not rejected at click time" });
      const remainedInAsk = await browser.execute(() =>
        document.querySelector('[data-testid="vault-tab-ask"]')?.getAttribute("aria-selected") === "true"
        && Boolean(document.querySelector('[data-testid="knowledge-ask-view"]')));
      assert.equal(remainedInAsk, true, "Stale Inspector cannot silently navigate to a changed note");
    } finally {
      await writeFile(NOTE_FILE, NOTE_BODY, "utf8");
    }
  });


  it("G65 real Electron L2 is available but off until the user grants both write permissions", async function () {
    this.timeout(45_000);
    await clickControl('[data-testid="vault-tab-review"]', "review tab in real Vault");
    await waitForVisible('[data-testid="knowledge-review-view"]', "Knowledge review view");
    // Check production Host capability, not a mocked feature flag. The Vault
    // starts with both settings OFF; neither check should modify disk data.
    await browser.waitUntil(() => browser.execute(() => {
      const toggle = document.querySelector<HTMLButtonElement>(
        '[data-testid="review-write-path-toggle"] [role="switch"]',
      );
      return Boolean(toggle && toggle.getClientRects().length > 0);
    }), { timeout: 30_000, timeoutMsg: "G65 local production L2 switch never became visible" });
    const gate = await browser.execute(() => {
      const toggle = document.querySelector<HTMLButtonElement>(
        '[data-testid="review-write-path-toggle"] [role="switch"]',
      );
      const agent = document.querySelector<HTMLButtonElement>(
        '[data-testid="review-agent-writes-toggle"] [role="switch"]',
      );
      return {
        noGo: Boolean(document.querySelector('[data-testid="review-write-safety-gate-blocked"]')),
        enabled: !toggle?.disabled,
        checked: toggle?.getAttribute("aria-checked"),
        agentChecked: agent?.getAttribute("aria-checked"),
      };
    });
    assert.deepEqual(gate, { noGo: false, enabled: true, checked: "false", agentChecked: "false" });
    await clickControl('[data-testid="review-agent-writes-toggle"] [role="switch"]', "explicitly authorize Vault Agent writes");
    await browser.waitUntil(() => browser.execute(() => {
      const grant = document.querySelector('[data-testid="review-agent-writes-toggle"] [role="switch"]');
      const editor = document.querySelector<HTMLInputElement>('[data-testid="review-proposal-title"]');
      const toggle = document.querySelector<HTMLButtonElement>('[data-testid="review-write-path-toggle"] [role="switch"]');
      // The grant's visible state can update before the async host action has
      // completed. G67 must never start while the review form is still busy.
      return grant?.getAttribute("aria-checked") === "true"
        && Boolean(editor && !editor.disabled && toggle && !toggle.disabled);
    }), { timeout: 30_000, timeoutMsg: "G65 Vault grant did not unlock proposal creation while keeping L2 opt-in off" });
    assert.equal(await readFile(NOTE_FILE, "utf8"), NOTE_BODY, "Changing write permissions must not touch source");
  });

  it("G67 real Electron proposal / preview / approval / opt-in Apply / Undo", async function () {
    this.timeout(120_000);
    assertIsolatedVault();
    await waitForVisible('[data-testid="review-proposal-composer"]', "L2 proposal form");
    await browser.waitUntil(() => browser.execute(() => {
      const editor = document.querySelector<HTMLInputElement>('[data-testid="review-proposal-title"]');
      return Boolean(editor && !editor.disabled && editor.getClientRects().length > 0);
    }), { timeout: 30_000, timeoutMsg: "G67 form is still locked by a previous Review operation" });
    const proposed = NOTE_BODY + "\nG67 explicitly approved local desktop write.\n";
    // Interact like a user rather than mutating DOM values behind React's
    // controlled inputs. The synthetic setter previously left the form in
    // an indeterminate state on all three Electron platforms.
    await dismissBlockingVaultDialog();
    await $('[data-testid="review-proposal-kind"]').selectByAttribute("value", "write");
    await dismissBlockingVaultDialog();
    // ChromeDriver 146's clear-element command is rejected by this real
    // Electron renderer even for an enabled text input. Use real trusted
    // keyboard events throughout; the new fields start empty.
    await $('[data-testid="review-proposal-title"]').click();
    await browser.keys("G67 isolated review");
    await dismissBlockingVaultDialog();
    await $('[data-testid="review-proposal-path"]').click();
    await browser.keys(NOTE_NAME);
    await dismissBlockingVaultDialog();
    await $('[data-testid="review-proposal-reason"]').click();
    await browser.keys("G67 approved local desktop write with explicit opt-in");
    await browser.waitUntil(() => browser.execute((path) => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="review-proposal-path"]');
      const select = document.querySelector<HTMLSelectElement>('[data-testid="review-proposal-kind"]');
      const button = document.querySelector<HTMLButtonElement>('[data-testid="review-proposal-load"]');
      return input?.value === path && select?.value === "write" && button && !button.disabled;
    }, NOTE_NAME), { timeout: 30_000, timeoutMsg: "G67 form did not accept actual WebDriver inputs" });
    await clickControl('[data-testid="review-proposal-load"]', "read real current Vault Markdown");
    await browser.waitUntil(() => browser.execute((body) => {
      const status = document.querySelector<HTMLElement>('[data-testid="review-proposal-load-status"]');
      const editor = document.querySelector<HTMLTextAreaElement>('[data-testid="review-proposal-content"]');
      return status?.getAttribute("data-loaded") === "true"
        && editor !== null && !editor.disabled && editor.value === body;
    }, NOTE_BODY), { timeout: 30_000, timeoutMsg: "G67 original note never finished loading into the editable React form" });
    const contentEditor = await $('[data-testid="review-proposal-content"]');
    await dismissBlockingVaultDialog();
    await contentEditor.click();
    // Select the loaded original with an OS-appropriate keyboard shortcut;
    // do not invoke the ChromeDriver elementClear API.
    await browser.keys([process.platform === "darwin" ? "Meta" : "Control", "a"]);
    await browser.keys(proposed);
    await browser.waitUntil(async () =>
      (await contentEditor.getValue()) === proposed,
    { timeout: 30_000, timeoutMsg: "G67 React editor did not accept the keyboard-entered Markdown" });
    await clickControl('[data-testid="review-proposal-submit"]', "persist real L2 proposal");
    await waitForVisible('[data-testid="review-proposal-created"]', "L2 proposal created");
    await browser.waitUntil(() => browser.execute((name) =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="review-proposal-card"]'))
        .some((card) => card.textContent?.includes(name)),
    NOTE_NAME), { timeout: 30_000, timeoutMsg: "G67 proposal missing from real review list" });
    assert.equal(await readFile(NOTE_FILE, "utf8"), NOTE_BODY, "Creating a proposal must not write a note");
    const prematureApprovalDisabled = await browser.execute(() => {
      const card = document.querySelector('[data-testid="review-proposal-card"]');
      const approve = Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => ["批准", "Approve"].includes(button.textContent?.trim() ?? ""));
      return Boolean(approve?.disabled);
    });
    assert.equal(prematureApprovalDisabled, true,
      "G67 must not approve this revision before fetching and reviewing the change preview");
    await clickControl('[data-testid="review-change-toggle"]', "preview exact proposal content");
    await browser.waitUntil(() => browser.execute(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="review-change-content"]'))
        .some((pre) => pre.textContent?.includes("G67 explicitly approved local desktop write")),
    ), { timeout: 30_000, timeoutMsg: "G67 content not served by the real review RPC" });

    const clicked = await browser.execute(() => {
      const card = document.querySelector('[data-testid="review-proposal-card"]');
      const approve = Array.from(card?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find((button) => ["批准", "Approve"].includes(button.textContent?.trim() ?? ""));
      if (!approve || approve.disabled) return false;
      approve.click();
      return true;
    });
    assert.equal(clicked, true, "G67 requires actual human approval UI");
    await browser.waitUntil(() => browser.execute(() =>
      Boolean(document.querySelector('[data-testid="review-proposal-card"][data-proposal-phase="approvedCurrent"]')),
    ), { timeout: 30_000, timeoutMsg: "G67 approval not returned from real ledger" });
    const state = await browser.execute(() => {
      const gate = document.querySelector<HTMLButtonElement>('[data-testid="review-write-path-toggle"] [role="switch"]');
      const apply = document.querySelector<HTMLButtonElement>('[data-testid="review-proposal-apply"]');
      const undo = document.querySelector<HTMLButtonElement>('[data-testid="review-proposal-undo"]');
      return {
        gateOff: gate?.getAttribute("aria-checked") === "false",
        gateDisabled: Boolean(gate?.disabled),
        applyDisabled: Boolean(apply?.disabled),
        undoDisabled: Boolean(undo?.disabled),
        noGo: Boolean(document.querySelector('[data-testid="review-write-safety-gate-blocked"]')),
      };
    });
    assert.deepEqual(state, {
      gateOff: true,
      gateDisabled: false,
      applyDisabled: true,
      undoDisabled: true,
      noGo: false,
    }, "Approval alone must not enable Apply/Undo without the separate L2 user opt-in");
    assert.equal(await readFile(NOTE_FILE, "utf8"), NOTE_BODY,
      "G67 approval must not write Markdown before L2 opt-in");
    await clickControl('[data-testid="review-write-path-toggle"] [role="switch"]', "explicitly enable local L2 writes");
    await clickControl('[data-testid="review-proposal-apply"]', "apply approved proposal through real production Host");
    await browser.waitUntil(async () => (await readFile(NOTE_FILE, "utf8")) === proposed,
      { timeout: 30_000, timeoutMsg: "G67 real approved write did not reach Vault" });
    await browser.waitUntil(() => browser.execute(() =>
      // 状态行已 i18n 化（增量评审 ui-review-6：不再直出英文枚举），断言需双语且
      // 大小写不敏感（en=Applied/Undone，zh=已应用/已撤销；小写 applied 匹配不到 Applied）。
      document.querySelector('[data-testid="review-operation-state"]')?.textContent?.match(/applied|已应用/i) !== null,
    ), { timeout: 30_000, timeoutMsg: "G67 applied operation did not appear in real persistent ledger" });
    await clickControl('[data-testid="review-proposal-undo"]', "undo through the real persisted operation ledger");
    await browser.waitUntil(async () => (await readFile(NOTE_FILE, "utf8")) === NOTE_BODY,
      { timeout: 30_000, timeoutMsg: "G67 real Undo did not restore the protected snapshot" });
    await browser.waitUntil(() => browser.execute(() =>
      document.querySelector('[data-testid="review-operation-state"]')?.textContent?.match(/undo_applied|undone|已撤销/i) !== null,
    ), { timeout: 30_000, timeoutMsg: "G67 inverse write did not settle in real ledger" });
    await clickControl('[data-testid="review-write-path-toggle"] [role="switch"]', "revoke L2 opt-in after test");
    await clickControl('[data-testid="review-agent-writes-toggle"] [role="switch"]', "revoke Vault Agent writes after test");
    assert.equal(await readFile(NOTE_FILE, "utf8"), NOTE_BODY, "G67 must leave the isolated Vault unchanged after Undo");
  });

});
