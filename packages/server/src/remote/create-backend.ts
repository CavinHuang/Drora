import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { RemoteTarget } from "@drora/shared";
import type { IRemoteBackend } from "./backend.js";

export async function createRemoteBackend(target: RemoteTarget): Promise<IRemoteBackend> {
  switch (target.kind) {
    case "ssh": {
      const { SSHBackend } = await import("./ssh-backend.js");
      let privateKey: string | Buffer | undefined;
      if (target.privateKeyPath) {
        const keyPath = target.privateKeyPath.replace(/^~/, homedir());
        privateKey = await readFile(keyPath);
      }

      return new SSHBackend({
        host: target.host,
        port: target.port,
        username: target.username,
        password: target.password,
        privateKeyPath: target.privateKeyPath,
        privateKeyPassphrase: target.privateKeyPassphrase,
        privateKey,
      });
    }
    case "wsl": {
      const { WSLBackend } = await import("./wsl-backend.js");
      return new WSLBackend(target);
    }
    case "docker": {
      const { DockerBackend } = await import("./docker-backend.js");
      return new DockerBackend(target);
    }
    case "server":
      // 第 47 轮：窗口 Host 的 yAe 分派层已对 server 目标短路（serverRemoteConnection），
      // 不再进入本部署链。这里保留显式守卫，覆盖 web 模式 /api/connect-remote 等仍以
      // createRemoteBackend 为入口的调用方，防止 server 目标静默回退到 SSH/WSL/Docker 部署。
      throw new Error("server 远程目标不支持部署 backend，请使用 server-remote 客户端连接链");
  }
}
