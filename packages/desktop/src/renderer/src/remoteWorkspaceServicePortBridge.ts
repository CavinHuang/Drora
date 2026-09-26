import {
  InternalChannels,
  serverRemoteInfoSchema,
  type RemoteTarget,
  type ServerRemoteInfo,
} from "@drora/shared";

export interface RemoteWorkspaceServicePortRegistration {
  attachmentId: string;
  port: MessagePort;
  sessionId: string;
  target: RemoteTarget;
  /**
   * 第四十九轮：server 形态连接的 server-info 自描述。
   * main 随 ScopedServicePort 元数据透出，目录步骤据此展示快捷 workspace 列表。
   */
  serverInfo?: ServerRemoteInfo;
}

export function parseRemoteWorkspaceServicePortMessage(
  event: MessageEvent,
): RemoteWorkspaceServicePortRegistration | null {
  if (
    typeof event.data !== "object" ||
    event.data === null ||
    !("type" in event.data) ||
    event.data.type !== InternalChannels.ScopedServicePort
  ) {
    return null;
  }
  const port = event.ports[0];
  const attachmentId = typeof event.data.attachmentId === "string" ? event.data.attachmentId : null;
  const sessionId = typeof event.data.sessionId === "string" ? event.data.sessionId : null;
  const target = "target" in event.data ? (event.data.target as RemoteTarget | null) : null;
  if (!port || !attachmentId || !sessionId || !target) return null;
  // serverInfo 在 host→main 边界已过 zod 校验；这里再做一次安全解析，
  // 坏值只丢字段不丢整条 port 注册，避免 server 元数据异常拖垮远端 services 接入。
  const rawServerInfo = "serverInfo" in event.data ? event.data.serverInfo : undefined;
  const parsedServerInfo = serverRemoteInfoSchema.safeParse(rawServerInfo);
  return {
    attachmentId,
    port,
    sessionId,
    target,
    ...(parsedServerInfo.success ? { serverInfo: parsedServerInfo.data } : {}),
  };
}

export function notifyRemoteWorkspaceServicePortReady(
  payload: Pick<RemoteWorkspaceServicePortRegistration, "attachmentId" | "sessionId">,
  postMessage: (message: unknown, targetOrigin: string) => void = window.postMessage.bind(window),
): void {
  postMessage(
    {
      type: InternalChannels.ScopedServicePortReady,
      attachmentId: payload.attachmentId,
      sessionId: payload.sessionId,
    },
    "*",
  );
}
