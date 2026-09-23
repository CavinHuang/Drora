import type { Event, IDisposable } from "@drora/rpc";
import type { DroraProtocolMessage } from "@drora/shared";

export type DroraProtocolTransportKind = "stdio" | "websocket" | "memory";

export interface DroraProtocolTransportClosedEvent {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  reason?: string;
}

export interface DroraProtocolTransport extends IDisposable {
  readonly kind: DroraProtocolTransportKind;
  readonly onMessage: Event<DroraProtocolMessage>;
  readonly onClose: Event<DroraProtocolTransportClosedEvent>;
  send(message: DroraProtocolMessage): Promise<void>;
  disposeAndWait?(): Promise<void>;
}
