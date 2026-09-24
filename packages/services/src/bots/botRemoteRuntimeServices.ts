import {
  ChannelClient,
  MessagePortProtocol,
  ProxyChannel,
  type MessagePortLike,
  type MessagePortPayload,
} from "@drora/rpc";
import {
  IDroraTaskService,
  type IDroraTaskService as IDroraTaskServiceShape,
} from "#src/session/droraTaskService.js";
import {
  IDroraAgentService,
  type IDroraAgentService as IDroraAgentServiceShape,
} from "#src/drora-agent/droraAgent.js";
import {
  IDroraSessionService,
  type IDroraSessionService as IDroraSessionServiceShape,
} from "#src/drora-session/droraSession.js";
import {
  IModelSelectionService,
  type IModelSelectionService as IModelSelectionServiceShape,
} from "#src/model-provider/providerFacadeServices.js";

interface PortLike {
  on?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  off?(event: "message", listener: (event: { data: MessagePortPayload }) => void): void;
  addEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  removeEventListener?(
    event: "message",
    listener: (event: { data: MessagePortPayload }) => void,
  ): void;
  postMessage(message: MessagePortPayload): void;
  start?(): void;
  close?(): void;
}

function toMessagePortLike(port: PortLike): MessagePortLike {
  return {
    addEventListener(type, listener) {
      if (port.addEventListener) {
        port.addEventListener(type, listener);
        return;
      }
      port.on?.(type, listener);
    },
    removeEventListener(type, listener) {
      if (port.removeEventListener) {
        port.removeEventListener(type, listener);
        return;
      }
      port.off?.(type, listener);
    },
    postMessage(data) {
      port.postMessage(data);
    },
    start() {
      port.start?.();
    },
    close() {
      port.close?.();
    },
  };
}

export interface RemoteBotWorkspaceRuntimeServices {
  droraAgentService: IDroraAgentServiceShape;
  droraTaskService: IDroraTaskServiceShape;
  droraSessionService: IDroraSessionServiceShape;
  modelSelectionService: IModelSelectionServiceShape;
}

export function createRemoteRuntimeServicesFromPort(
  port: unknown,
): RemoteBotWorkspaceRuntimeServices {
  const protocol = new MessagePortProtocol(toMessagePortLike(port as PortLike));
  const client = new ChannelClient(protocol);
  return {
    droraAgentService: ProxyChannel.toService<IDroraAgentServiceShape>(
      client.getChannel(IDroraAgentService.channelName),
    ),
    droraTaskService: ProxyChannel.toService<IDroraTaskServiceShape>(
      client.getChannel(IDroraTaskService.channelName),
    ),
    droraSessionService: ProxyChannel.toService<IDroraSessionServiceShape>(
      client.getChannel(IDroraSessionService.channelName),
    ),
    modelSelectionService: ProxyChannel.toService<IModelSelectionServiceShape>(
      client.getChannel(IModelSelectionService.channelName),
    ),
  };
}
