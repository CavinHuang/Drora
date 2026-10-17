import assert from "node:assert/strict";
import test from "node:test";
import { desktopPetCatalogSchema } from "@drora/shared";
import { buildDesktopPetCatalog } from "../src/main/desktopPetCatalog.js";

test("catalog covers every character and passes the shared schema", () => {
  const catalog = buildDesktopPetCatalog();
  const parsed = desktopPetCatalogSchema.safeParse(catalog);
  assert.equal(parsed.success, true, "catalog must satisfy desktopPetCatalogSchema");
  assert.deepEqual(
    catalog.map((entry) => entry.id),
    ["violet", "noir", "snow", "ginger"],
  );
});

test("every entry exposes an embedded atlas preview on an 8-column grid", () => {
  for (const entry of buildDesktopPetCatalog()) {
    assert.match(entry.preview.dataUrl, /^data:image\/webp;base64,/);
    assert.equal(entry.preview.columns, 8);
    assert.ok(entry.preview.rows >= 5, "atlas must declare at least the five task rows");
    assert.ok(entry.preview.frameWidth > 0 && entry.preview.frameHeight > 0);
    assert.ok(entry.preview.column >= 0 && entry.preview.row >= 0);
    assert.ok(
      entry.preview.column < entry.preview.columns && entry.preview.row < entry.preview.rows,
      "still frame must sit inside the atlas grid",
    );
  }
});

test("idle still frames match each character kind", () => {
  const catalog = buildDesktopPetCatalog();
  const [violet, ...catgirls] = catalog;
  // violet：idle 是动画清单首行，静帧列取该行 stillFrame。
  assert.equal(violet.preview.frameWidth, 96);
  assert.equal(violet.preview.frameHeight, 96);
  assert.equal(violet.preview.row, 0);
  assert.equal(violet.preview.column, 0);
  // 猫娘：显示格 96×192，idle 动作在首行，静帧取首帧。
  for (const entry of catgirls) {
    assert.equal(entry.preview.frameWidth, 96);
    assert.equal(entry.preview.frameHeight, 192);
    assert.equal(entry.preview.row, 0);
    assert.equal(entry.preview.column, 0);
  }
});

test("catalog names stay bilingual for the settings gallery", () => {
  for (const entry of buildDesktopPetCatalog()) {
    assert.ok(entry.nameZh.length > 0 && entry.nameEn.length > 0);
    assert.notEqual(entry.nameZh, entry.nameEn);
  }
});
