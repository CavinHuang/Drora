// pip-session 宿主侧客户端（契约见 ./pip-session-node.d.ts）。
// 真实实现是 windows-helper-host 模块里的会话客户端工厂（原 S$）：
// socket 连接 + pip_session_handshake 握手 + 断线重连 + 事件转发。
import { S$ as createPipSessionClientFactory } from "./broker/server/windows-helper-host.js";
import { resolveBrokerSocketPath } from "./broker/socket-path.js";

export function createPipSessionClient(options = {}) {
  const { socketPath, env, ...rest } = options;
  return createPipSessionClientFactory({
    socketPath: socketPath ?? resolveBrokerSocketPath({ env: env ?? process.env }),
    ...rest,
  });
}
