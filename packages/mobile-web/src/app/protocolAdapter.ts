// R3 P2a 协议适配：relay-client 的 rpc-frame 通道 ↔ @drora/rpc IMessagePassingProtocol。
// 桥内载荷 = ChannelClient 序列化字节（裸 Uint8Array，MessagePortProtocol 同构，
// spec §12 D8）；适配器把完整 rpc 消息字节直通 VSBuffer 流。
import { Emitter, VSBuffer, type IMessagePassingProtocol } from "@drora/rpc";
import type { RpcFrameChannel } from "@drora/relay-client";

export function createRelayMessageProtocol(bridge: RpcFrameChannel): IMessagePassingProtocol {
  const onMessage = new Emitter<VSBuffer>();
  bridge.onMessage = (message) => {
    onMessage.fire(VSBuffer.wrap(message));
  };
  const protocol: IMessagePassingProtocol = {
    send(buffer: VSBuffer): void {
      bridge.send(buffer.buffer);
    },
    onMessage: onMessage.event,
  };
  return protocol;
}
