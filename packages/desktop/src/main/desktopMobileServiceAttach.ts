// 移动端远控共用·窗口 Host 服务附着助手。
// LAN 配对服务与官方 relay 远控都要按需向窗口 Host 发 AttachServicePort
// （scope=local，clientMode=web-remote-replayable）并建立 rpc 客户端，
// 抽出为单一实现避免两条传输各自维护端口生命周期。
// 语义对齐原版 workspace-bridge：Host 实例变化（窗口 Host 重启）时旧端口作废，
// 惰性重附着新实例。
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  ChannelClient,
  MessagePortProtocol,
  type IChannel,
  type MessagePortPayload,
} from "@drora/rpc";
import { HostMessageTypes } from "@drora/shared";
import type { MessagePortMain, UtilityProcess } from "electron";

export interface MobileServiceAttachment {
  task: IChannel;
  session: IChannel;
}

export function createMobileServiceAttacher(options: {
  resolveHostChild: () => UtilityProcess | null;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}) {
  let attachedHostChild: UtilityProcess | null = null;
  let clientPort: MessagePortMain | null = null;
  let client: ChannelClient | null = null;

  /** Host 缺失错误统一带 code=workspace-closed（对齐原版 DESKTOP_HOST_MISSING 失败面）。 */
  function assertHostChild(): UtilityProcess {
    const hostChild = options.resolveHostChild();
    if (!hostChild || hostChild.pid === undefined) {
      const error: Error & { code?: string } = new Error(
        "window host process is not ready for pairing attachment",
      );
      error.code = "workspace-closed";
      throw error;
    }
    return hostChild;
  }

  /** 释放当前附着（Host 更换/停服时调用）；幂等。 */
  function dispose(): void {
    attachedHostChild = null;
    client = null;
    if (clientPort) {
      try {
        clientPort.close();
      } catch {
        // 端口已关闭属正常路径
      }
      clientPort = null;
    }
  }

  /** 惰性建立（或按 Host 实例重建）scoped service rpc 客户端。 */
  function ensure(): MobileServiceAttachment {
    const hostChild = assertHostChild();
    if (client && attachedHostChild === hostChild) {
      return { task: client.getChannel("drora-task"), session: client.getChannel("drora-session") };
    }
    dispose();
    attachedHostChild = hostChild;
    // electron API 懒加载：plain node（协议级测试）里 require("electron") 拿不到
    // MessageChannelMain，new 时抛错并走调用方的错误路径；Electron 运行时里是完整 API。
    const requireElectron = createRequire(import.meta.url);
    const { MessageChannelMain: MessageChannelMainCtor } = requireElectron(
      "electron",
    ) as typeof import("electron");
    const { port1, port2 } = new MessageChannelMainCtor();
    hostChild.postMessage(
      {
        type: HostMessageTypes.AttachServicePort,
        requestId: randomUUID(),
        attachmentId: randomUUID(),
        // 手机是可恢复的远程客户端；与桌面 continuous 链路明确区分（AGENTS.md 进程协议边界）。
        clientMode: "web-remote-replayable",
        scope: { kind: "local" },
      },
      [port2],
    );
    clientPort = port1;
    // 与 host/electronPort.ts 同构的适配：main/host 是两个编译段，不能跨段 import。
    const portLike = {
      addEventListener(_type: "message", listener: (e: { data: MessagePortPayload }) => void) {
        port1.on("message", listener);
      },
      removeEventListener(_type: "message", listener: (e: { data: MessagePortPayload }) => void) {
        port1.off("message", listener);
      },
      postMessage(data: MessagePortPayload) {
        port1.postMessage(data);
      },
      start() {
        port1.start();
      },
      close() {
        port1.close();
      },
    };
    const protocol = new MessagePortProtocol(portLike);
    client = new ChannelClient(protocol);
    options.logger.info("[mobile-remote] scoped service 端口已附着");
    return { task: client.getChannel("drora-task"), session: client.getChannel("drora-session") };
  }

  /**
   * 为 relay rpc 桥新建一个独立附着端口（M4b）：每次 workspace-bridge-open 一个新
   * MessageChannelMain（对齐原版 createWorkspaceBridge 每桥一端口），Host 侧按
   * clientMode=web-remote-replayable 注册服务（含 zcode-* 别名通道）。
   * 返回 Main 侧端口；调用方负责 close（close 即触发 Host 侧 attachment 清理）。
   */
  function attachBridgePort(): MessagePortMain {
    const hostChild = assertHostChild();
    const requireElectron = createRequire(import.meta.url);
    const { MessageChannelMain: MessageChannelMainCtor } = requireElectron(
      "electron",
    ) as typeof import("electron");
    const { port1, port2 } = new MessageChannelMainCtor();
    hostChild.postMessage(
      {
        type: HostMessageTypes.AttachServicePort,
        requestId: randomUUID(),
        attachmentId: randomUUID(),
        clientMode: "web-remote-replayable",
        scope: { kind: "local" },
      },
      [port2],
    );
    return port1;
  }

  return { ensure, dispose, attachBridgePort };
}
