import type { RemoteTarget } from "./remoteTarget.js";
import { buildSshRemoteHostKey } from "./remoteSshHostKey.js";

/**
 * Provider Provisioning 等 Environment 级状态的稳定身份；不得混用 workspace/session 身份。
 * serverId 仅用于 server 形态（对齐官方 l0(target, serverId)）：同一 Server 的稳定身份
 * 优先取 server-info 的 serverId；连接建立前拿不到 server-info 时退回 URL。
 */
export function buildRemoteEnvironmentKey(target: RemoteTarget, serverId?: string): string {
  switch (target.kind) {
    case "ssh":
      return `ssh:${buildSshRemoteHostKey(target)}`;
    case "wsl":
      return `wsl:${target.distro?.trim() || "<default>"}\0${target.user?.trim() || "<default>"}`;
    case "docker":
      return `docker:${target.container.trim()}`;
    case "server":
      // server 远端的运行环境就是目标 Server 本身；serverId 与 URL 都只做 trim，
      // 不做端点归一，避免非法输入让遥测键构造抛错。
      return `server:${serverId?.trim() || target.url.trim()}`;
  }
}
