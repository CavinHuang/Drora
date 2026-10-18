/**
 * G12: Real Electron process restart followed by trusted Obsidian citation
 * rehydration and on-click TOCTOU verification. Called only with an isolated
 * synthetic Vault fixture by the authenticated-handoff spec.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../../helpers/desktop-app.js";
import { reloadElectronSessionPreservingBrowserProfile } from "../../helpers/e2e-electron-reload.js";
import {
  getV4ConversationState,
  selectV4TaskById,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../../helpers/v4-conversation.js";

interface AuthenticatedRestartOptions {
  filePath: string;
  source: string;
  query: string;
  answerMarker: string;
  click: (selector: string, label: string) => Promise<void>;
  waitFor: (selector: string, label: string, timeout?: number) => Promise<void>;
}

export async function verifyAuthenticatedObsidianRestart({
  filePath,
  source,
  query,
  answerMarker,
  click,
  waitFor,
}: AuthenticatedRestartOptions): Promise<void> {
  // G61/G62 produced a real CLI UserInputRow and a trusted [1] response.
  // G66/G06/G07 were rejected before sending, so that completed turn is
  // still the only authority for its existing inline citation.
  const before = await waitForV4ConversationState(
    (state) =>
      Boolean(state.taskId) &&
      Boolean(state.sessionId) &&
      state.state === "idle" &&
      state.queueCount === 0,
    "G12 requires the real original idle CLI session before restart",
    30_000,
  );
  assert.ok(before.taskId && before.sessionId);
  assert.equal(
    await readFile(filePath, "utf8"),
    source,
    "Restart fixture must be restored after G07",
  );
  const userDataBefore = await browser.electron.execute((electron) =>
    electron.app.getPath("userData"),
  );

  // This helper flushes Chromium storage, actually exits the old Electron
  // process tree, reuses its browser profile and rebuilds the service bridge.
  // A renderer refresh alone is NOT a lifecycle test.
  const userDataAfter = await reloadElectronSessionPreservingBrowserProfile(browser);
  assert.equal(userDataAfter, userDataBefore, "G12 must reuse the same persisted profile");
  await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60_000);
  await selectV4TaskById(before.taskId, 45_000);
  await waitForV4ConversationState(
    (state) =>
      state.taskId === before.taskId &&
      state.sessionId === before.sessionId &&
      state.state === "idle" &&
      state.queueCount === 0,
    "G12 restarted Electron did not recover the original Agent session",
    60_000,
  );
  await waitForV4AssistantMessageContaining(answerMarker, 60_000);
  const coldStartVaultMounted = await browser.execute(() =>
    Boolean(document.querySelector('[data-testid="vault-view"]')),
  );
  assert.equal(
    coldStartVaultMounted,
    false,
    "G12 must prove the first recovered citation can lazily mount VaultView",
  );
  try {
    await waitFor(
      '[data-testid^="knowledge-inline-citation-"]',
      "restarted actual CLI-backed source citation",
      20_000,
    );
  } catch (error) {
    // Identify which canonical provenance field was lost during cold
    // hydration. These are safe booleans/counts, never raw Receipt IDs.
    const diagnostic = await browser.execute(() => ({
      turnDiagnostics: Array.from(
        document.querySelectorAll<HTMLElement>("[data-e2e-knowledge-diagnostics]"),
      ).map((el) => el.getAttribute("data-e2e-knowledge-diagnostics")),
      visibleInlineCount: document.querySelectorAll('[data-testid^="knowledge-inline-citation-"]')
        .length,
      sessionPaneIds: Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid^="v4-session-pane"]'),
      ).map((el) => el.getAttribute("data-session-id")),
    }));
    throw new Error(
      `G12 cold-recovered authoritative citation missing: ${JSON.stringify(diagnostic)}`,
      {
        cause: error,
      },
    );
  }

  // Post-restart TOCTOU: a source change must reject an old persisted
  // Receipt even if the original model response has a visible [1].
  const changed = source.replace(query, `${query}-edited-after-electron-restart`);
  assert.notEqual(changed, source);
  await writeFile(filePath, changed, "utf8");
  try {
    await click(
      '[data-testid^="knowledge-inline-citation-"]',
      "revalidate a persisted source after full Electron restart",
    );
    // EC-3（e2e-b-1，2026-10-18 终审）修复：原实现是固定 pause(1800) 后单次负向
    // 采样——与同 PR G64/B-5 已废除并注明反模式的写法同款（慢 runner 下迟到导航
    // 在采样后才发生，绿≠测到；快 runner 下又白等固定时长）。改为间隔 1s 的双采样
    // 稳定性检查：两次采样都必须保持「未导航」，把拒绝 settle 期纳入被测窗口。
    const readStaleNavigation = () =>
      browser.execute(() => ({
        vaultActive: Boolean(
          document.querySelector('[data-testid="vault-view"]')?.getClientRects().length,
        ),
        codeMirrorVisible: Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
          (element) => Boolean(element.getClientRects().length),
        ),
      }));
    const firstStale = await readStaleNavigation();
    await browser.pause(1_000);
    const secondStale = await readStaleNavigation();
    // 双采样禁止 spread 合并后统一断言（第二次会覆盖第一次的瞬时导航）——逐次断言。
    assert.equal(
      firstStale.vaultActive,
      false,
      "A changed source must not navigate just because its Receipt survived restart (first sample)",
    );
    assert.equal(
      firstStale.codeMirrorVisible,
      false,
      "A changed source must not open CodeMirror after Electron restart (first sample)",
    );
    assert.equal(
      secondStale.vaultActive,
      false,
      "A changed source must not navigate just because its Receipt survived restart (second sample)",
    );
    assert.equal(
      secondStale.codeMirrorVisible,
      false,
      "A changed source must not open CodeMirror after Electron restart (second sample)",
    );
    assert.equal(
      await readFile(filePath, "utf8"),
      changed,
      "Post-restart rejection must not overwrite user source content",
    );
  } finally {
    await writeFile(filePath, source, "utf8");
  }

  // The originally signed version is current again: recovered citations
  // should navigate via fresh host verification rather than be lost or
  // receive authority from model prose.
  await click(
    '[data-testid^="knowledge-inline-citation-"]',
    "open the restored original source from recovered Agent turn",
  );
  await browser.waitUntil(
    () =>
      browser.execute(
        (token) =>
          document
            .querySelector('[data-testid="vault-tab-notes"]')
            ?.getAttribute("aria-selected") === "true" &&
          Array.from(document.querySelectorAll<HTMLElement>(".cm-content")).some(
            (editor) => editor.textContent?.includes(token) && editor.getClientRects().length,
          ),
        query,
      ),
    { timeout: 30_000, timeoutMsg: "G12 recovered Receipt did not open the original Vault note" },
  );
  assert.equal(
    await readFile(filePath, "utf8"),
    source,
    "Recovered navigation must not mutate source",
  );
  assert.equal(
    (await getV4ConversationState()).sessionId,
    before.sessionId,
    "G12 must not silently switch the authenticated Agent session",
  );
}
