import assert from "node:assert/strict";
import test from "node:test";
import { draggedPetPosition, visiblePetPosition } from "../src/main/desktopPetLayout.js";
import { trayBoundsForPet } from "../src/main/desktopPetInteractionLayout.js";

const left = { x: -1920, y: 0, width: 1920, height: 1080 };
const right = { x: 0, y: 0, width: 1920, height: 1080 };

test("pet drag follows screen-DIP cursor across displays and clamps only on release", () => {
  const origin = { x: -80, y: 800 };
  const dragged = draggedPetPosition(origin, { x: -40, y: 810 }, { x: 150, y: 920 });
  assert.deepEqual(dragged, { x: 110, y: 910 });
  assert.deepEqual(
    visiblePetPosition(dragged, [left, right], right, { width: 112, height: 128 }),
    dragged,
  );
  assert.deepEqual(
    visiblePetPosition({ x: 3000, y: 2000 }, [left, right], right, { width: 112, height: 128 }),
    {
      x: 1808,
      y: 952,
    },
  );
});

test("tray flips below a top-edge pet and clamps to the selected display", () => {
  assert.deepEqual(trayBoundsForPet({ x: 1700, y: 900, width: 112, height: 128 }, right), {
    x: 1590,
    y: 492,
    width: 330,
    height: 400,
  });
  assert.deepEqual(trayBoundsForPet({ x: 12, y: 12, width: 112, height: 128 }, right), {
    x: 0,
    y: 148,
    width: 330,
    height: 400,
  });
  assert.deepEqual(trayBoundsForPet({ x: -100, y: 600, width: 112, height: 128 }, left), {
    x: -330,
    y: 192,
    width: 330,
    height: 400,
  });
});

test("straddling release selects the greatest overlap independently of monitor order", () => {
  const size = { width: 112, height: 128 };
  for (const displays of [
    [left, right],
    [right, left],
  ]) {
    assert.deepEqual(visiblePetPosition({ x: -30, y: 500 }, displays, left, size), {
      x: 0,
      y: 500,
    });
    assert.deepEqual(visiblePetPosition({ x: -82, y: 500 }, displays, right, size), {
      x: -112,
      y: 500,
    });
    assert.deepEqual(visiblePetPosition({ x: -56, y: 500 }, displays, right, size), {
      x: 0,
      y: 500,
    });
  }
});

test("screen-DIP offsets survive a mixed-scale layout and unplug clamps to the surviving display", () => {
  // 模拟 4K/200% 主屏及 1440p/150% 上方屏；Electron 已把物理尺寸换算为这些 DIP 工作区。
  const upper = { x: -853, y: -960, width: 1706, height: 960 };
  const size = { width: 224, height: 244 };
  const moved = draggedPetPosition(
    { x: -500, y: -800 },
    { x: -480, y: -780 },
    { x: -350, y: -600 },
  );
  assert.deepEqual(moved, { x: -370, y: -620 });
  assert.deepEqual(visiblePetPosition(moved, [right, upper], right, size), moved);
  assert.deepEqual(visiblePetPosition(moved, [right], right, size), { x: 0, y: 0 });
  const tray = trayBoundsForPet({ ...moved, ...size }, upper);
  assert.ok(tray.x >= upper.x && tray.x + tray.width <= upper.x + upper.width);
  assert.ok(tray.y >= upper.y && tray.y + tray.height <= upper.y + upper.height);
});
