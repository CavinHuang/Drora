import assert from "node:assert/strict";
import test from "node:test";
import { desktopPetOverlayContent } from "../src/main/desktopPetOverlayContent.js";

test("pet and activity documents are isolated and contain no task data or executable scripts", () => {
  for (const locale of ["en-US", "zh-CN"] as const)
    for (const tray of [false, true]) {
      const html = desktopPetOverlayContent(locale, tray);
      assert.match(html, /default-src 'none'/);
      assert.doesNotMatch(html, /<script/);
      assert.match(html, new RegExp(`<html lang="${locale.startsWith("zh") ? "zh" : "en"}">`));
      assert.match(html, /prefers-color-scheme:dark/);
      assert.match(html, /font-size:var\(--text-ui-base\)/);
      assert.match(html, tray ? /id="activities"/ : /id="pet-art"/);
    }
});
