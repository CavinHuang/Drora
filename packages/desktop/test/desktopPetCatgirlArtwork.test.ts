import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { desktopPetContent } from "../src/main/desktopPetContent.js";
import {
  DESKTOP_PET_CHARACTER_IDS,
  resolveDesktopPetCharacter,
} from "../src/main/desktopPetCharacter.js";
import { desktopPetCatgirlCharacters } from "../src/main/desktopPetCatgirlArtwork.js";

test("catgirl characters expose 11 actions × 8 frames on an 8-column atlas", () => {
  assert.deepEqual([...desktopPetCatgirlCharacters].map((c) => c.id), ["noir", "snow", "ginger"]);
  for (const character of desktopPetCatgirlCharacters) {
    assert.equal(character.actions.length, 11);
    assert.equal(character.columns, 8);
    assert.equal(character.cellWidth, 96);
    assert.equal(character.cellHeight, 192);
    for (const action of character.actions) {
      assert.ok(action.frameCount >= 2 && action.frameCount <= 8, action.id);
      assert.ok(action.fps > 0);
    }
    // 任务态动作齐备：completed 映射到 happy（TASK-STATES.md）。
    for (const required of ["idle", "working", "attention", "happy", "error"]) {
      assert.ok(character.actions.some((action) => action.id === required), required);
    }
  }
});

test("catgirl pet document embeds the character atlas and maps modes to actions", async () => {
  const html = desktopPetContent("zh-CN", "noir");
  const match = html.match(/background-image:url\("data:image\/webp;base64,([A-Za-z0-9+/=]+)"\)/);
  assert.ok(match, "catgirl sprite sheet should be embedded");
  const metadata = await sharp(Buffer.from(match[1], "base64")).metadata();
  assert.equal(metadata.width, 96 * 8);
  assert.equal(metadata.height, 192 * 11);
  for (const mode of ["idle", "working", "attention", "error"]) {
    assert.match(html, new RegExp(`#pet\\[data-mode=${mode}\\] #pet-art\\{[^}]*animation:pet-${mode}`));
  }
  // completed 播一遍 happy 后停在末帧（once → 1 forwards）。
  assert.match(html, /animation:pet-completed \d+ms steps\(1,end\) 1 forwards/);
  // 窗口尺寸随角色变化（猫娘 112×224）。
  assert.ok(resolveDesktopPetCharacter("noir").window.height > 200);
  assert.deepEqual([...DESKTOP_PET_CHARACTER_IDS], ["violet", "noir", "snow", "ginger"]);
});

test("unknown character id falls back to violet document", () => {
  const fallback = desktopPetContent("en-US", "not-a-character");
  assert.match(fallback, /background-size:768px 960px/);
});
