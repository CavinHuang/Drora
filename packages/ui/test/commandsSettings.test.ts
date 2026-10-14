import { describe, expect, it } from "vitest";
import {
  COMMAND_AGENT_SOURCES,
  COMMAND_AGENT_SOURCE_META,
} from "../src/settings/commandsSettingsShared.js";

describe("commands settings source filter", () => {
  it("keeps built-in command sources in stable display order", () => {
    expect(COMMAND_AGENT_SOURCES).toEqual(["droraAgent"]);
  });

  it("maps command sources to user-facing metadata", () => {
    expect(COMMAND_AGENT_SOURCE_META.droraAgent).toMatchObject({
      labelId: "settings.commands.source.droraAgent",
      pathHint: "~/.drora/commands",
      provider: "glm",
    });
  });
});
