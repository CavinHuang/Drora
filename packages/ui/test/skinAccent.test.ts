import assert from "node:assert/strict";
import test from "node:test";
import { resolveCustomBrandColor } from "../src/skin/skinAccent.js";

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

function contrast(first: string, second: string): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

test("custom accent stays recognizable while meeting text contrast in both themes", () => {
  assert.equal(resolveCustomBrandColor("#176d97", "light"), "#176d97");
  for (const color of ["#ffffff", "#000000", "#808080", "#ff0000", "#00ff00"]) {
    assert.ok(contrast(resolveCustomBrandColor(color, "light"), "#f8f8f8") >= 4.5);
    assert.ok(contrast(resolveCustomBrandColor(color, "dark"), "#161616") >= 4.5);
  }
});
