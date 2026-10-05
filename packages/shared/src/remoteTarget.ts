import type { RemoteAssetInstallMode } from "./remoteAssetInstallMode.js";
import type { RemoteResourcePackageSelection } from "./remoteResourcePackages.js";

export interface SSHConnectOptions {
  kind: "ssh";
  host: string;
  port?: number;
  username: string;
  sshConfigAlias?: string;
  password?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
  assetInstallMode?: RemoteAssetInstallMode;
  resourcePackages?: RemoteResourcePackageSelection;
}

export interface WSLConnectOptions {
  kind: "wsl";
  distro?: string;
  user?: string;
}

export interface DockerConnectOptions {
  kind: "docker";
  container: string;
}

export interface ServerConnectOptions {
  kind: "server";
  /** Server 基地址；支持 http(s) 与 ws(s)。 */
  url: string;
  /** Server 访问令牌；只存在于连接流程内，持久化时仅保留 credentialService 键名。 */
  token?: string;
  /** 连接显示名称；仅连接流程与窗口标签展示使用，不进入恢复快照。 */
  name?: string;
  /** 默认目录；留空时连接成功后再选择 server 上的目录（对齐官方表单语义）。 */
  workspacePath?: string;
}

export type RemoteTarget =
  | SSHConnectOptions
  | WSLConnectOptions
  | DockerConnectOptions
  | ServerConnectOptions;

/** 删除只应存在于当前连接流程中的 secret，供长期内存状态和跨进程回包使用。 */
export function stripRemoteTargetSecrets(target: RemoteTarget): RemoteTarget {
  if (target.kind === "ssh") {
    const {
      password: _password,
      privateKeyPassphrase: _privateKeyPassphrase,
      ...sanitized
    } = target;
    return sanitized;
  }

  if (target.kind === "server") {
    const { token: _token, ...sanitized } = target;
    return sanitized;
  }

  return target;
}
