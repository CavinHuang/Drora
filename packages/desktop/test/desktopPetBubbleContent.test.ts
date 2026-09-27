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

test("bubble visual is content-shrunk, capped at max width, top-anchored above the pet", () => {
  const html = desktopPetBubbleContent("zh-CN");
  // 视觉气泡随内容收缩、以窗口最大宽度为上限（避免横跨大半屏）。
  assert.match(html, /width:fit-content/);
  assert.match(html, /max-width:100%/);
  // 底边贴住宠物头顶（body 底对齐），配合布局层把窗口放在宠物顶部。
  assert.match(html, /align-items:flex-end/);
  // 小字号 + 受控换行：状态单行省略，预览最多 4 行、任意点可断行。
  assert.match(html, /#status\{font-size:11px/);
  assert.match(html, /#preview\{margin:4px 0 0;font-size:11px/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /-webkit-line-clamp:4/);
});
