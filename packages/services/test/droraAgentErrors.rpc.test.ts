import { ChannelClient, ChannelServer, createQueuePair, ProxyChannel } from "@drora/rpc";
import { describe, expect, it } from "vitest";
import { IDroraAgentService } from "#src/drora-agent/droraAgent.js";
import {
  DRORA_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE,
  DroraAgentMcpStatusModeUnsupportedError,
} from "#src/drora-agent/droraAgentErrors.js";

describe("Drora Agent RPC errors", () => {
  it("preserves the MCP status-only unsupported code across ChannelClient RPC", async () => {
    const [serverProtocol, clientProtocol] = createQueuePair();
    const server = new ChannelServer(serverProtocol, "test");
    const client = new ChannelClient(clientProtocol);
    server.registerChannel(
      IDroraAgentService.channelName,
      ProxyChannel.fromService({
        async listMcpServerStatuses() {
          throw new DroraAgentMcpStatusModeUnsupportedError();
        },
      }),
    );
    const service = ProxyChannel.toService<IDroraAgentService>(
      client.getChannel(IDroraAgentService.channelName),
    );

    try {
      await expect(
        service.listMcpServerStatuses({
          mcpServers: [],
          mode: "status",
          workspacePath: "/tmp/workspace",
        }),
      ).rejects.toMatchObject({
        code: DRORA_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE,
        name: "DroraAgentMcpStatusModeUnsupportedError",
      });
    } finally {
      client.dispose();
      server.dispose();
    }
  });
});
