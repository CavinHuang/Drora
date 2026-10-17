import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
  // 时长公式 = frameCount / fps * 1000，可产生小数毫秒（如 8 帧 / 6fps → 1333.33…ms），
  // 故毫秒段用 [\d.]+ 而非 \d+（desktopPetCatgirlMotionCss 的既有契约）。
  assert.match(html, /animation:pet-completed [\d.]+ms steps\(1,end\) 1 forwards/);
  // 窗口尺寸随角色变化（猫娘 112×224）。
  assert.ok(resolveDesktopPetCharacter("noir").window.height > 200);
  assert.deepEqual([...DESKTOP_PET_CHARACTER_IDS], ["violet", "noir", "snow", "ginger"]);
});

test("unknown character id falls back to violet document", () => {
  const fallback = desktopPetContent("en-US", "not-a-character");
  // violet spec art = 96×96、图集 8 列 × 5 行（desktopPetCharacter.ts VIOLET）→ 768×480。
  assert.match(fallback, /background-size:768px 480px/);
});

test("generated atlas cells are faithful per-frame resamples of the source grid", async () => {
  // 回归防护：生成器曾把整张 4×2 源图集压扁后按 8 个偏移重复 composite，产物每格是
  // 重叠拼贴（设置图库半人/双影人；尺寸断言测不出内容腐烂）。这里按 manifest 网格
  // 从源资产逐帧重采样，与生成图集对应格做像素级均值差对比，布局错位会爆表。
  const assetsDir = fileURLToPath(new URL("../assets/desktop-pet-catgirls/", import.meta.url));
  const manifest = JSON.parse(await readFile(join(assetsDir, "manifest.json"), "utf8"));
  const sampleAt = async (characterIndex, actionId, frame) => {
    const manifestCharacter = manifest.characters[characterIndex];
    const moduleCharacter = desktopPetCatgirlCharacters[characterIndex];
    const actionIndex = manifestCharacter.actions.findIndex((entry) => entry.id === actionId);
    assert.ok(actionIndex >= 0, `${manifestCharacter.id}/${actionId}`);
    // 生成模块的动作行号=manifest 中的序号（合成器的落行依据）。
    assert.equal(moduleCharacter.actions[actionIndex].row, actionIndex);
    const source = await readFile(join(assetsDir, manifestCharacter.actions[actionIndex].atlas));
    const expected = await sharp(source)
      .extract({
        left: (frame % manifest.columns) * manifest.frameWidth,
        top: Math.floor(frame / manifest.columns) * manifest.frameHeight,
        width: manifest.frameWidth,
        height: manifest.frameHeight,
      })
      .resize(moduleCharacter.cellWidth, moduleCharacter.cellHeight, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();
    const actual = await sharp(Buffer.from(moduleCharacter.dataUrl.split(",")[1], "base64"))
      .extract({
        left: (frame % moduleCharacter.columns) * moduleCharacter.cellWidth,
        top: (actionIndex + Math.floor(frame / moduleCharacter.columns)) * moduleCharacter.cellHeight,
        width: moduleCharacter.cellWidth,
        height: moduleCharacter.cellHeight,
      })
      .removeAlpha()
      .raw()
      .toBuffer();
    assert.equal(actual.length, expected.length);
    let total = 0;
    for (let index = 0; index < actual.length; index += 1) {
      total += Math.abs(actual[index] - expected[index]);
    }
    const meanDiff = total / actual.length;
    // webp q85/alphaQ90 有损重编码的常态均值差在 10 上下（noir idle#0 实测 10.26）；
    // 拼贴/错位类腐烂会到几十以上，16 仍留足判别间距。
    assert.ok(
      meanDiff < 16,
      `${manifestCharacter.id}/${actionId}#${frame} meanDiff=${meanDiff.toFixed(2)}`,
    );
  };
  await sampleAt(0, "idle", 0);
  await sampleAt(0, "idle", 7);
  await sampleAt(2, "happy", 0);
});
