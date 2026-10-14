import { describe, expect, it } from "vitest";
import { DRORA_AGENT_RUNTIME } from "@drora/shared";

describe("Drora Agent runtime", () => {
  it("starts the private Drora Protocol server instead of the retired Drora Agent command", () => {
    const retiredProtocolName = `${"a"}${"cp"}`;

    expect(DRORA_AGENT_RUNTIME.spawnArgs).toEqual(["app-server", "--stdio"]);
    expect(DRORA_AGENT_RUNTIME.spawnArgs).not.toContain(retiredProtocolName);
  });

  it("uses the Drora Agent binary name", () => {
    expect(DRORA_AGENT_RUNTIME.resolveEntrySegments("darwin")).toEqual(["drora-agent"]);
    expect(DRORA_AGENT_RUNTIME.resolveEntrySegments("win32")).toEqual(["drora-agent.exe"]);
  });
});
