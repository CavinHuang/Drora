import { describe, expect, it } from "vitest";
import type { DroraConfigOption } from "@drora/shared";
import { readCurrentDroraMode } from "../src/hooks/chatActionHelpers.js";

function createModeOption(currentValue: string | boolean): DroraConfigOption {
  return {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue,
  };
}

describe("chatActionHelpers", () => {
  it("reads yolo from Drora Agent mode config options", () => {
    expect(readCurrentDroraMode([createModeOption("yolo")])).toBe("yolo");
  });

  it("reads edit from Drora Agent mode config options", () => {
    expect(readCurrentDroraMode([createModeOption("edit")])).toBe("edit");
  });

  it("keeps provider-native Drora Agent modes", () => {
    expect(readCurrentDroraMode([createModeOption("bypassPermissions")])).toBe("bypassPermissions");
  });

  it("does not normalize retired provider-native agent mode ids", () => {
    const readMode = readCurrentDroraMode as (
      options: readonly DroraConfigOption[],
      provider?: string,
    ) => unknown;
    expect(readCurrentDroraMode([createModeOption("agent")])).toBeUndefined();
    expect(readMode([createModeOption("agent-full-access")], "gemini")).toBeUndefined();
  });

  it("ignores invalid mode values", () => {
    expect(readCurrentDroraMode([createModeOption("unknown")])).toBeUndefined();
    expect(readCurrentDroraMode([createModeOption(true)])).toBeUndefined();
  });
});
