import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchVoiceCommand,
  registerVoiceCommandHandler,
  resetVoiceCommandHandlersForTest,
} from "./voiceCommandBus.js";
const target = { workspacePath: "/ws", sessionId: "A" };
const routing = (sessionId: string, owner = false, workspaceIdentity?: string) => ({
  getTarget: () => ({ workspacePath: "/ws", sessionId, workspaceIdentity }),
  isAnnouncementOwner: () => owner,
});
describe("voiceCommandBus directed routing (§9.8)", () => {
  beforeEach(resetVoiceCommandHandlersForTest);
  it("delivers cancel only once to the bound session, including duplicate panes", () => {
    const a = vi.fn(),
      duplicate = vi.fn(),
      b = vi.fn();
    registerVoiceCommandHandler(a, routing("A"));
    registerVoiceCommandHandler(duplicate, routing("A"));
    registerVoiceCommandHandler(b, routing("B"));
    dispatchVoiceCommand("cancelTask", target);
    expect(a).toHaveBeenCalledOnce();
    expect(duplicate).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
  it("keeps remote workspace identities isolated despite equal paths", () => {
    const a = vi.fn(),
      b = vi.fn();
    registerVoiceCommandHandler(a, routing("A", false, "remote-a"));
    registerVoiceCommandHandler(b, routing("A", false, "remote-b"));
    dispatchVoiceCommand("cancelTask", { ...target, workspaceIdentity: " remote-b " });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });
  it("sends spoken and physical stop only to the playback owner", () => {
    const a = vi.fn(),
      b = vi.fn();
    registerVoiceCommandHandler(a, routing("A"));
    registerVoiceCommandHandler(b, routing("B", true));
    dispatchVoiceCommand("stopAnnouncement");
    dispatchVoiceCommand("stopAnnouncementPressed");
    expect(a).not.toHaveBeenCalled();
    expect(b.mock.calls).toEqual([["stopAnnouncement"], ["stopAnnouncementPressed"]]);
  });
  it("fails closed for missing/draft/deleted targets, unregister is idempotent", () => {
    const a = vi.fn();
    const unregister = registerVoiceCommandHandler(a, routing("A"));
    dispatchVoiceCommand("cancelTask");
    dispatchVoiceCommand("cancelTask", { ...target, sessionId: null });
    unregister();
    unregister();
    dispatchVoiceCommand("cancelTask", target);
    expect(a).not.toHaveBeenCalled();
  });
});

it("same-session cancellation prefers the playback owner so task stop also silences speech (§9.8)", () => {
  resetVoiceCommandHandlersForTest();
  const inactive = vi.fn(),
    owner = vi.fn();
  registerVoiceCommandHandler(inactive, routing("A"));
  registerVoiceCommandHandler(owner, routing("A", true));
  dispatchVoiceCommand("cancelTask", target);
  expect(owner).toHaveBeenCalledOnce();
  expect(inactive).not.toHaveBeenCalled();
});
