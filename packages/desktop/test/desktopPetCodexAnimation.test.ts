import assert from "node:assert/strict";
import test from "node:test";
import { codexPetTracks, petLookFrame } from "../src/shared/desktopPetAnimation.js";
import {
  advancePetGesture,
  finishPetGesture,
  beginPetGesture,
} from "../src/shared/desktopPetGesture.js";
import { snapPetPosition } from "../src/main/desktopPetInteractionLayout.js";

test("Codex row contract preserves every frame, hold and three-cycle idle tail", () => {
  const tracks = codexPetTracks();
  const rows = [
    ["idle", 0, 6, 280 * 6, 320 * 6],
    ["running-right", 1, 8, 120, 220],
    ["running-left", 2, 8, 120, 220],
    ["waving", 3, 4, 140, 280],
    ["jumping", 4, 5, 140, 280],
    ["failed", 5, 8, 140, 240],
    ["waiting", 6, 6, 150, 260],
    ["running", 7, 6, 120, 220],
    ["review", 8, 6, 150, 280],
  ] as const;
  for (const [state, row, count, first, last] of rows) {
    const track = tracks.find((value) => value.state === state)!;
    assert.equal(track.frames[0].row, row);
    assert.equal(track.frames[0].durationMs, first);
    assert.equal(track.frames[count - 1].durationMs, last);
    assert.equal(track.frames[count - 1].column, count - 1);
    assert.equal(track.loopStart, state === "idle" ? 0 : count * 3);
    assert.equal(track.frames.length, state === "idle" ? count : count * 3 + 6);
    assert.equal(track.frames.at(-1)?.durationMs, 1920);
  }
});

test("v2 pointer poses cover all sixteen clockwise directions, v1 and dead zone are excluded", () => {
  for (let direction = 0; direction < 16; direction++) {
    const angle = (direction * Math.PI) / 8;
    const pointer = { x: 100 + Math.sin(angle) * 100, y: 100 - Math.cos(angle) * 100 };
    assert.deepEqual(petLookFrame({ x: 50, y: 50, width: 100, height: 100 }, pointer, 2), {
      row: 9 + Math.floor(direction / 8),
      column: direction % 8,
      durationMs: 0,
    });
    assert.equal(petLookFrame({ x: 50, y: 50, width: 100, height: 100 }, pointer, 1), null);
  }
  assert.equal(
    petLookFrame({ x: 50, y: 50, width: 100, height: 100 }, { x: 101, y: 100 }, 2),
    null,
  );
});

test("pointer admission, axis threshold, final release and cancellation do not produce accidental clicks", () => {
  assert.equal(beginPetGesture({ pointerId: 1, x: 0, y: 0, button: 2, ctrlKey: false }), null);
  assert.equal(beginPetGesture({ pointerId: 1, x: 0, y: 0, button: 0, ctrlKey: true }), null);
  const start = () => beginPetGesture({ pointerId: 1, x: 0, y: 0, button: 0, ctrlKey: false })!;
  assert.equal(advancePetGesture(start(), { pointerId: 1, x: 3, y: 3 }).moved, false);
  assert.equal(advancePetGesture(start(), { pointerId: 2, x: 30, y: 0 }).moved, false);
  assert.equal(advancePetGesture(start(), { pointerId: 1, x: -4, y: 0 }).direction, "running-left");
  assert.equal(finishPetGesture(start(), { pointerId: 1, x: 0, y: 4 }, false).activate, false);
  assert.equal(finishPetGesture(start(), { pointerId: 1, x: 0, y: 4 }, false).moved, true);
  assert.equal(finishPetGesture(start(), { pointerId: 1, x: 0, y: 0 }, true).activate, false);
  assert.equal(finishPetGesture(start(), { pointerId: 1, x: 3, y: 3 }, false).activate, true);
});

test("Alt release snaps to six work-area anchors and supports negative monitor coordinates", () => {
  const area = { x: -1920, y: -100, width: 1920, height: 1080 };
  const size = { width: 112, height: 122 };
  for (const [x, expected] of [
    [-1800, -1904],
    [-960, -1016],
    [-100, -128],
  ]) {
    assert.deepEqual(snapPetPosition({ x, y: -90 }, area, size), { x: expected, y: -84 });
    assert.deepEqual(snapPetPosition({ x, y: 970 }, area, size), { x: expected, y: 842 });
  }
});
