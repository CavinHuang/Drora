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

test("bubble flips beside the pet and remains within its display work area", () => {
  assert.deepEqual(bubblePositionForPet({ x: 1700, y: 1010 }, right), {
    x: 1452,
    y: 960,
  });
  assert.deepEqual(bubblePositionForPet({ x: 12, y: 12 }, right), { x: 132, y: 30 });
});
