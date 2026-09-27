import assert from "node:assert/strict";
import test from "node:test";
import {
  bubblePositionForPet,
  draggedPetPosition,
  visiblePetPosition,
} from "../src/main/desktopPetLayout.js";

const left = { x: -1920, y: 0, width: 1920, height: 1080 };
const right = { x: 0, y: 0, width: 1920, height: 1080 };

test("pet drag follows screen-DIP cursor across displays and clamps only on release", () => {
  const origin = { x: -80, y: 800 };
  const dragged = draggedPetPosition(origin, { x: -40, y: 810 }, { x: 150, y: 920 });
  assert.deepEqual(dragged, { x: 110, y: 910 });
  assert.deepEqual(visiblePetPosition(dragged, [left, right], right), dragged);
  assert.deepEqual(visiblePetPosition({ x: 3000, y: 2000 }, [left, right], right), {
    x: 1808,
    y: 952,
  });
});

test("bubble sits above the pet, centered on it, and remains within its display work area", () => {
  // 宠物在屏幕右下：气泡居中悬于头顶（pet 中心 1756 - 130 = 1626），底边距头顶 6px。
  assert.deepEqual(bubblePositionForPet({ x: 1700, y: 1010 }, right), {
    x: 1626,
    y: 864,
  });
  // 宠物贴近屏幕左上：气泡整体钳回工作区，不允许推出屏幕外。
  assert.deepEqual(bubblePositionForPet({ x: 12, y: 12 }, right), { x: 0, y: 0 });
  // 宠物在左侧屏右缘：气泡右缘优先收进该屏，而不是翻到旁边显示器。
  assert.deepEqual(bubblePositionForPet({ x: 1880, y: 600 }, left), { x: -260, y: 454 });
});
