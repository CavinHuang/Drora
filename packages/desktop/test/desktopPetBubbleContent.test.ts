import assert from "node:assert/strict";
import test from "node:test";
import { desktopPetBubbleContent } from "../src/main/desktopPetBubbleContent.js";

test("pet bubble is isolated, translated, and receives message text only through IPC", () => {
  const chinese = desktopPetBubbleContent("zh-CN");
  const english = desktopPetBubbleContent("en-US");
  assert.match(chinese, /<html lang="zh">/);
  assert.match(english, /<html lang="en">/);
  for (const html of [chinese, english]) {
    assert.match(html, /id="status"/);
    assert.match(html, /id="preview"/);
    assert.match(html, /pointer-events:none/);
    assert.match(html, /default-src 'none'/);
    assert.doesNotMatch(html, /<script/);
  }
});
