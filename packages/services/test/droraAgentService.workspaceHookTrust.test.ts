import { describe, expect, it, vi } from "vitest";
import { droraProtocolMethods } from "@drora/shared";

describe("DroraAgentService workspace Hook Trust", () => {
  it("没有 task/provider 时只启动 read-only Agent 并发送 workspace grant", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === droraProtocolMethods.workspaceHookTrustGrant) {
        return { accepted: true };
      }
      // 上游 v3.17.1 read-only 启动新增 directorySource 能力握手（runtime/capabilities），
      // schema 允许空对象（见 shared persona-contract 测试）；返回空能力即走旧字段路径。
      if (method === droraProtocolMethods.runtimeCapabilities) {
        return {};
      }
      throw new Error(`Unexpected method ${method}`);
    });
    const getClient = vi.fn(async () => ({
      request,
      transportKind: "stdio" as const,
      onNotification: () => ({ dispose() {} }),
      onRequest: () => ({ dispose() {} }),
      onClose: () => ({ dispose() {} }),
    }));
    vi.resetModules();
    vi.doMock("../src/drora-agent/droraAgentProcessManager.js", () => ({
      DroraAgentProcessManager: class {
        getClient = getClient;
        // 上游 v3.17.1 的 getOrStartReadOnlyClient 新增 processManager.isSharedRuntime 判定
        // （read-only 启动路径按 workspace 路由能力协商），mock 补齐该面；本用例走非共享 runtime。
        isSharedRuntime() {
          return false;
        }
        onRuntimeLifecycle() {
          return { dispose() {} };
        }
        onRuntimeRestarted() {
          return { dispose() {} };
        }
        disposeAll() {}
      },
    }));
    const { createDroraAgentService } = await import("../src/drora-agent/droraAgentService.js");
    const service = createDroraAgentService();

    await expect(
      service.grantWorkspaceHookTrust({
        workspacePath: "/repo",
        workspaceIdentity: "remote:ssh:host:/repo",
        remoteSessionId: "remote-session-1",
        bundleDigest: "b".repeat(64),
        hookDeclarationDigest: "a".repeat(64),
      }),
    ).resolves.toEqual({ accepted: true });
    expect(getClient).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      droraProtocolMethods.workspaceHookTrustGrant,
      {
        workspace: {
          workspacePath: "/repo",
          workspaceIdentity: "remote:ssh:host:/repo",
          remoteSessionId: "remote-session-1",
          workspaceKey: "remote:ssh:host:/repo",
        },
        bundleDigest: "b".repeat(64),
        hookDeclarationDigest: "a".repeat(64),
      },
      expect.anything(),
    );
    service.disposeAll();
  });
});
