import { describe, expect, it, vi } from "vitest";
import type { IChannel } from "@drora/rpc";
import type { IDroraAgentService } from "../src/drora-agent/droraAgent.js";
import { createDroraAgentConnectionScope } from "../src/drora-agent/droraAgentConnectionScope.js";
import { createTopicResourcePeers } from "../src/drora-agent/topicResourcePeers.js";

const request = {
  requestId: "r",
  taskId: "t",
  inputId: "i",
  authorizationId: "a",
  messageId: "m",
  resourceIndex: 0,
  workspacePath: "/work",
  workspaceIdentity: "server://host/work",
  remoteSessionId: "remote",
};
describe("shared Server topic resource peers", () => {
  it("binds only trusted V4 calls and rejects another live peer claiming the same route", async () => {
    const peers = createTopicResourcePeers();
    const channelA = { call: vi.fn() } as unknown as IChannel;
    const a = peers.attach(channelA);
    const b = peers.attach({ call: vi.fn() } as unknown as IChannel);
    const base = {
      queryConversationCommandsV4: vi.fn(async () => ({ results: [] })),
    } as unknown as IDroraAgentService;
    const untrusted = a.wrapAgent(base);
    await untrusted.queryConversationCommandsV4({ ...request, commands: [] });
    expect(() => peers.getChannel(request)).toThrow();
    const scopeA = createDroraAgentConnectionScope(untrusted, {
      connectionId: "a",
      clientMode: "desktop-continuous",
      role: "trusted-host-relay",
    });
    const scopeB = createDroraAgentConnectionScope(b.wrapAgent(base), {
      connectionId: "b",
      clientMode: "desktop-continuous",
      role: "trusted-host-relay",
    });
    await scopeA.service.queryConversationCommandsV4({ ...request, commands: [] });
    expect(peers.getChannel(request)).toBe(channelA);
    await expect(
      scopeB.service.queryConversationCommandsV4({ ...request, commands: [] }),
    ).rejects.toThrow("another");
    a.dispose();
    expect(() => peers.getChannel(request)).toThrow();
    await scopeB.service.queryConversationCommandsV4({ ...request, commands: [] });
    expect(peers.getChannel(request)).not.toBe(channelA);
    await scopeA.dispose();
    await scopeB.dispose();
    b.dispose();
  });
});
