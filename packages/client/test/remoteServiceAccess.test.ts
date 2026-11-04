import { describe, expect, it, vi } from "vitest";
import { ChannelClient, MessagePortProtocol, type MessagePortLike } from "@drora/rpc";
import { RemoteServiceAccess } from "../src/remoteServiceAccess.js";

/**
 * RemoteServiceAccess 服务代理完整性测试。
 *
 * 回归背景（specs/model-capabilities.md §12 修复 ND-1）：模型能力档案服务在
 * Host 侧注册、accessor 声明、hook 消费三面齐备，唯独 RemoteServiceAccess
 * 构造器漏建 ProxyChannel getter，导致桌面 renderer 恒 service=null、模型
 * 设置页五条目恒「不可用」——组件测试因 mock 掉 hook 而全绿，只有本层
 * 测试能拦截这类「四齐一漏」断链（同 eff2ee71 obsidianVaultService 事故）。
 */

class FakeMessagePort implements MessagePortLike {
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  postMessage = vi.fn();
  start = vi.fn();
  close = vi.fn();
}

function createAccess(options?: {
  sourceServerManagementService?: boolean;
  deviceSyncStateService?: boolean;
  modelCapabilitiesService?: boolean;
  assistantTicketService?: boolean;
  windowProjectDirectory?: boolean;
}) {
  const client = new ChannelClient(new MessagePortProtocol(new FakeMessagePort()));
  return new RemoteServiceAccess(client, options);
}

describe("RemoteServiceAccess 模型能力服务代理", () => {
  it("options.modelCapabilitiesService=true 时创建可调用代理（get/update/onDidChange）", () => {
    const access = createAccess({ modelCapabilitiesService: true });
    const service = access.modelCapabilitiesService;
    // ProxyChannel 惰性代理：方法与事件在访问期才走 channel，构造期不抛错即证明
    // getter 存在且 toService 成功（ND-1 断链时此处为 undefined）。
    expect(service).toBeDefined();
    expect(typeof service?.get).toBe("function");
    expect(typeof service?.update).toBe("function");
    expect(typeof service?.onDidChange).toBe("function");
  });

  it("缺省不开门控时保持 undefined（远端/服务器 Host 不注册该 channel，fail-closed）", () => {
    const access = createAccess();
    expect(access.modelCapabilitiesService).toBeUndefined();
  });

  // PR-1B 三审发现 1：Mate 工单服务与 modelCapabilities 同形的能力门控——漏传能力位
  // 即桌面端大副整体不可达（launcher 无入口、面板恒不可用），在此层锁定代理面。
  it("options.assistantTicketService=true 时创建可调用代理（动作+getSnapshot+onDidChange）", () => {
    const access = createAccess({ assistantTicketService: true });
    const service = access.assistantTicketService;
    expect(service).toBeDefined();
    expect(typeof service?.recordTrigger).toBe("function");
    expect(typeof service?.approveDecision).toBe("function");
    expect(typeof service?.setMode).toBe("function");
    expect(typeof service?.getSnapshot).toBe("function");
    expect(typeof service?.onDidChange).toBe("function");
  });

  it("assistantTicketService 缺省保持 undefined（远程/stdio 场景 fail-closed）", () => {
    expect(createAccess().assistantTicketService).toBeUndefined();
  });

  it("已注册的其他可选服务门控形态不被本改动破坏（sourceServerManagementService 先例）", () => {
    expect(
      createAccess({ sourceServerManagementService: true }).sourceServerManagementService,
    ).toBeDefined();
    expect(createAccess({}).sourceServerManagementService).toBeUndefined();
  });
});
