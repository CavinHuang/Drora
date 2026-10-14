import { describe, expect, it } from "vitest";
import {
  consumeDroraJwtInvalidRestartMarker,
  markDroraJwtInvalidRestart,
} from "../src/root/droraJwtInvalidRestartMarker.js";

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("drora JWT invalid restart marker", () => {
  it("is consumed exactly once after relaunch", () => {
    const storage = createStorage();
    markDroraJwtInvalidRestart(storage);

    expect(consumeDroraJwtInvalidRestartMarker(storage)).toBe(true);
    expect(consumeDroraJwtInvalidRestartMarker(storage)).toBe(false);
  });
});
