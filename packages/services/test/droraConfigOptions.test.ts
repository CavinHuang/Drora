import { describe, expect, it } from "vitest";
import type { DroraSessionSettingsState } from "@drora/shared";
import {
  getDroraAgentAvailableModes,
  normalizeAvailableDroraMode,
  settingsToConfigOptions,
} from "../src/drora-agent/droraConfigOptions.js";

function settingsWithMode(
  mode: DroraSessionSettingsState["mode"]["current"],
): DroraSessionSettingsState {
  return {
    model: {
      current: { providerId: "glm", modelId: "glm-5" },
      available: [],
    },
    thoughtLevel: {
      enabled: false,
      available: [],
    },
    mode: { current: mode },
  };
}

describe("droraConfigOptions", () => {
  it("keeps persisted edit while the shared menu replaces it with guarded", () => {
    const options = settingsToConfigOptions(settingsWithMode("edit"));
    const modeOption = options.find((option) => option.category === "mode");

    expect(modeOption?.currentValue).toBe("edit");
    expect(modeOption?.options?.map((option) => option.value)).toEqual([
      "build",
      "guarded",
      "plan",
      "yolo",
    ]);
    expect(getDroraAgentAvailableModes().map((mode) => mode.id)).toEqual([
      "build",
      "guarded",
      "plan",
      "yolo",
    ]);
    expect(normalizeAvailableDroraMode("edit")).toBe("edit");
  });
});
