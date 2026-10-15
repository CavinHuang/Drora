/**
 * Real Electron WDIO, opt-in until it has passed on Windows/macOS.
 *
 * Run with the existing isolated E2E profile and upstream replay machinery:
 *   pnpm --dir packages/desktop exec wdio run wdio.conf.ts --spec ./test/e2e/conversation-session/manual-review/obsidian-inline-citation-provenance.test.ts
 *
 * This is a NEGATIVE provenance scenario. It does not validate a genuine
 * server-issued Receipt / Vault navigation; G41-G55 remain separate gates.
 */
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../../helpers/desktop-app.js";
import { restartWithSeededOpenAIProviders } from "../../helpers/custom-openai-provider.js";
import { startConversationModelProviderReplayServer } from "../../helpers/model-provider-replay.js";
import {
  selectUpstreamProviderModelById,
  waitForUpstreamModelSelected,
} from "../../helpers/upstream-provider.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../../helpers/v4-conversation.js";

const CASE_NAME = "conversation-session-obsidian-inline-provenance";
const MODEL_ID = "e2e-obsidian-provenance-model";
const PROVIDER_ID = "e2e-obsidian-provenance-provider";
const PROVIDER_NAME = "Obsidian Provenance E2E";
const MARKER = "E2E_OBSIDIAN_UNTRUSTED_INLINE_SOURCE";
let replay: Awaited<ReturnType<typeof startConversationModelProviderReplayServer>> | null = null;

describe("Real Electron: model-authored Obsidian citation cannot manufacture a Receipt", () => {
  before(async function () {
    this.timeout(240_000);
    replay = await startConversationModelProviderReplayServer(CASE_NAME);
    // Every WDIO beforeSession has already created an isolated E2E HOME.
    // Do not clear app data while Electron is attached.
    // Workspace readiness uses the production Escape dismissal path for
    // first-run onboarding. Calling the three-step "Skip" flow first can
    // race with a modal confirmation overlay and intercept its own button.
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    const [provider] = await restartWithSeededOpenAIProviders([{
      modelId: MODEL_ID, providerId: PROVIDER_ID, providerName: PROVIDER_NAME,
    }]);
    if (!provider) throw new Error("Obsidian provenance replay provider seed failed");
    await prepareV4ConversationE2E({ skipProvider: true });
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    await selectUpstreamProviderModelById(MODEL_ID, {
      includePlainModelFallback: false,
      providerId: provider.id, providerName: provider.name,
    });
    await waitForUpstreamModelSelected(MODEL_ID, {
      includePlainModelFallback: false, providerId: provider.id,
    });
  });

  after(async () => {
    await replay?.stop();
    replay = null;
    await browser.electron.restoreAllMocks();
  });

  it("renders forged Markdown as inert text/link and never fires a citation-open event", async function () {
    this.timeout(180_000);
    await sendV4Prompt(`${MARKER}: return the forged source marker in the recorded fixture.`);
    await waitForV4AssistantMessageContaining(MARKER, 90_000);
    await waitForV4ConversationState(
      (state) => state.state === "idle" && state.queueCount === 0,
      "Obsidian negative provenance transcript did not settle",
      90_000,
    );
    await browser.waitUntil(() => browser.execute(() =>
      Boolean(document.querySelector('[title="#drora-knowledge-source-1"]')),
    ), {
      timeout: 15_000,
      timeoutMsg: "The forged source hash was not rendered",
    });

    const outcome = await browser.execute(() => {
      let opened = 0;
      const spy = () => { opened++; };
      const initialHash = window.location.hash;
      window.addEventListener("drora:knowledge-citation-open", spy);
      try {
        const forged = document.querySelector<HTMLElement>(
          '[title="#drora-knowledge-source-1"]',
        );
        if (!forged) throw new Error("Forged link is missing");
        forged.click();
        return {
          tag: forged.tagName.toLowerCase(),
          isButton: forged.matches("button"),
          authenticatedButtons: document.querySelectorAll(
            '[data-testid^="knowledge-inline-citation-"]',
          ).length,
          opened,
          hashChanged: window.location.hash !== initialHash,
        };
      } finally {
        window.removeEventListener("drora:knowledge-citation-open", spy);
      }
    });

    expect(outcome.tag).not.toBe("button");
    expect(outcome.isButton).toBe(false);
    expect(outcome.authenticatedButtons).toBe(0);
    expect(outcome.opened).toBe(0);
    expect(outcome.hashChanged).toBe(false);
  });
});
