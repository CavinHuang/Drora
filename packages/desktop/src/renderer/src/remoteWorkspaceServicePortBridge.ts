import {
  InternalChannels,
  scopedServicePortPayloadSchema,
  serverRemoteInfoSchema,
  type ScopedServicePortPayload,
  type ServerRemoteInfo,
} from "@drora/shared";

export type RemoteWorkspaceServicePortRegistration = ScopedServicePortPayload & {
  port: MessagePort;
  /** 第四十九轮：server 形态连接的 server-info 自描述（其余远程形态为 undefined）。 */
  serverInfo?: ServerRemoteInfo;
};

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
  // 上游用 strict schema 校验整个 payload；Drora 的 serverInfo 透传字段不在 schema 内，
  // 先剥离再校验，保持两侧契约独立演进。
  const { type: _type, serverInfo: rawServerInfo, ...payload } = event.data;
  const parsed = scopedServicePortPayloadSchema.safeParse(payload);
  if (!port || !parsed.success) return null;
  // serverInfo 在 host→main 边界已过 zod 校验；这里再做一次安全解析，
  // 坏值只丢字段不丢整条 port 注册，避免 server 元数据异常拖垮远端 services 接入。
  const parsedServerInfo = serverRemoteInfoSchema.safeParse(rawServerInfo);
  return {
    ...parsed.data,
    port,
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
