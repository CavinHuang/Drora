/**
 * relay-v2-server 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 * 展示装配顺序：env 配置 → 内存/持久组件所有者（spec §4）→ createRelayServer 选项 → start/stop。
 * 示例用空 env 配置与最小内存桩；stub users 仅测试可用（spec §12 M1），生产按 JWT_MODE 装配 auth。
 */
import { loadConfigFromEnv } from "./src/config.js";
import type { CreateRelayServerOptions } from "./src/index.js";
import type { DeviceRecord, PairingStatusView } from "./src/types.js";
import type { RelayV2ServerContract } from "./contract.js";

const waiting: PairingStatusView = { pairStatus: "waiting", terminalSid: "" };

export const exampleRelayServerOptions: CreateRelayServerOptions = {
  config: loadConfigFromEnv({}),
  // 真实约束（src/index.ts 装配期校验）：auth 或 users 之一必填，都缺省启动即抛错。
  // users 是 stub auth 的 JWT→userId 映射，仅测试/冒烟可用（spec §12 M1）；
  // 生产按 JWT_MODE 装配 auth（decode/introspect/jwks，spec §6.2）。
  users: { "jwt-example": "example-user" },
  tokens: {
    issue: () => ({ token: "", expiresIn: 60 }),
    consume: () => undefined,
  },
  devices: {
    register: (_userId: string, deviceMid: string): DeviceRecord => ({
      deviceSid: "d_example",
      deviceMid,
      userId: _userId,
      createdAt: 0,
    }),
    get: () => undefined,
    listByUser: () => [],
    delete: () => {},
    collectExpired: () => 0,
  },
  registry: {
    bind: () => waiting,
    query: () => waiting,
    peerOf: () => undefined,
    release: () => {},
    isDeviceOnline: () => false,
  },
};

export async function exampleRelayV2Server(contract: RelayV2ServerContract): Promise<void> {
  const handle = await contract.start(exampleRelayServerOptions);
  await handle.stop();
}
