import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@mbears/opentui-react/test-utils";
import { getDroraCopy } from "@drora/i18n";
import { TuiApp } from "../src/app.js";
import { LoginRequiredPanel } from "../src/app-components.js";
import { DRORA_LOGO_LINES } from "../src/app-empty-transcript.js";
import { InputPane } from "../src/app-input-pane.js";
import { InputActiveStatus } from "../src/app-input-status.js";
import { QueuedInputPanel } from "../src/app-queued-inputs.js";
import { SelectionPanel } from "../src/app-selection-panel.js";
import { ComposerInputArea } from "../src/app-view.js";
import type { TuiOptions } from "../src/types.js";

test("starts without a runtime readiness system message", async () => {
  let view: Awaited<ReturnType<typeof testRender>> | undefined;

  const options: TuiOptions = {
    noColor: true,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    submitPrompt: async () => ({ response: "done" }),
  };

  await act(async () => {
    view = await testRender(
      React.createElement(TuiApp, {
        copySelection: async () => ({ kind: "empty" }),
        hasCopyableSelection: () => false,
        onExit: () => undefined,
        options,
      }),
      {
        height: 24,
        kittyKeyboard: true,
        otherModifiersMode: true,
        width: 100,
      },
    );
    await view.renderOnce();
  });

  try {
    assert.ok(view);
    const frame = view.captureCharFrame();
    const rows = frame.split("\n");
    const firstLogoRow = rows.findIndex((row) => row.includes(DRORA_LOGO_LINES[0]));
    const lastLogoRow = rows.findIndex((row) => row.includes(DRORA_LOGO_LINES.at(-1) ?? ""));
    const composerTopRow = rows.findIndex((row) => row.includes("╭─ Build"));
    const logoCenterRow = Math.floor((firstLogoRow + lastLogoRow) / 2);
    const transcriptCenterRow = Math.floor((composerTopRow - 1) / 2);

    assert.equal(frame.includes("OpenTUI Node runtime loaded."), false);
    assert.notEqual(firstLogoRow, -1);
    assert.notEqual(lastLogoRow, -1);
    assert.notEqual(composerTopRow, -1);
    assert.ok(Math.abs(logoCenterRow - transcriptCenterRow) <= 1);
  } finally {
    await act(async () => {
      view?.renderer.destroy();
    });
  }
});
