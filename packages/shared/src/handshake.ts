export interface HelloMessage {
  type: "drora-hello";
  version: string;
  platform: string;
  arch: string;
  pid: number;
}

export interface HelloAckMessage {
  type: "drora-hello-ack";
  version: string;
  clientId: string;
}
