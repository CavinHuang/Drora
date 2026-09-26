import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DRORA_PLUGIN_HOST_COMMAND } from "@drora/contracts/plugins";
import {
  getCapturedDroraCuaBrokerCredentials,
  DRORA_CUA_BROKER_SOCKET_ENV_KEY,
  DRORA_CUA_NODE_REPL_HOST_ENV_KEY,
} from "@drora/shared/runtime-env";
import { DRORA_CUA_OFFICIAL_PLUGIN_ID, DRORA_PLUGIN_ID_ENV_KEY } from "@drora/shared/mcp";
import type { RunContext } from "@drora/shared-types";

const HOST_USAGE = `${DRORA_PLUGIN_HOST_COMMAND} <server-path> [-- <server-arg>...]`;

type HostedPluginModule = {
  main?: unknown;
};

export function isPluginHostInvocation(argv: readonly string[]): boolean {
  return argv[0] === DRORA_PLUGIN_HOST_COMMAND;
}

// __drora-plugin-host 在 agent 子进程里运行 official plugin 的 MCP server（server.js）。
// CLI 入口 main.ts 的 applyCliRuntimeEnvSanitization 会先把 broker token 从 process.env 剔除进
// 进程内 capture；因此这里是恢复 bearer token 的最后一道宿主边界。capture 本身只证明某个
// Agent 进程曾收到过 Helper 凭据，不能证明当前传入的 server 就是官方 drora-cua：
// 只凭存在 capture 就把 token 恢复给任意 server path，第三方/被替换的插件可借此取得 CUA
// broker 的 TCC 能力。必须同时验证 resolver 权威写入的 plugin id、完整的捕获凭据组，
// 以及 canonical broker socket；任一字段不匹配都在 import 之前拒绝，避免加载不受信模块后再暴露 token。
export async function runPluginHostCommand(ctx: RunContext, argv: string[]): Promise<number> {
  if (argv.length < 1) {
    ctx.stderr.write(`Usage: ${HOST_USAGE}\n`);
    return 1;
  }

  const [rawServerPath, ...serverArgs] = argv;

  try {
    if (rawServerPath === undefined) {
      throw new Error("Plugin server path is required.");
    }

    const serverPath = resolve(rawServerPath);
    if (!existsSync(serverPath)) {
      throw new Error("Plugin server file does not exist.");
    }
    const capturedBrokerCredentials = getCapturedDroraCuaBrokerCredentials();
    assertCapturedBrokerLaunchIsAuthorized(capturedBrokerCredentials);
    const module = (await import(pathToFileURL(serverPath).href)) as HostedPluginModule;
    if (typeof module.main !== "function") {
      throw new Error("Plugin server does not export main().");
    }

    const originalArgv = process.argv;
    const originalBrokerSocket = process.env[DRORA_CUA_BROKER_SOCKET_ENV_KEY];
    let brokerTokenRestored = false;
    // shared node_repl 把同一凭据组恢复到环境，由 broker bridge 读取；旧的独立 CUA
    // MCP 不再拥有执行入口。
    process.argv = [process.execPath, serverPath, ...serverArgs];
    if (capturedBrokerCredentials.socket && process.env[DRORA_CUA_NODE_REPL_HOST_ENV_KEY] === "1") {
      process.env[DRORA_CUA_BROKER_SOCKET_ENV_KEY] = capturedBrokerCredentials.socket;
      // token 模式（原版 mac 发射链回归）：node_repl host 运行时 authenticate 需要同一
      // token；Windows 身份模式 host.token 恒 null，凭据组无 token 时省键。
      if (capturedBrokerCredentials.token) {
        process.env.DRORA_CUA_PERMISSION_BROKER_TOKEN = capturedBrokerCredentials.token;
        brokerTokenRestored = true;
      }
    }
    try {
      await module.main();
    } finally {
      process.argv = originalArgv;
      if (originalBrokerSocket === undefined) {
        delete process.env[DRORA_CUA_BROKER_SOCKET_ENV_KEY];
      } else {
        process.env[DRORA_CUA_BROKER_SOCKET_ENV_KEY] = originalBrokerSocket;
      }
      // token 与 socket 同批恢复，也要同批对称清理——该进程 main() 返回后即退出，
      // 但恢复语义必须对称，避免凭据材料残留到同进程的后续路径。
      if (brokerTokenRestored) {
        delete process.env.DRORA_CUA_PERMISSION_BROKER_TOKEN;
      }
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`Plugin host failed: ${message}\n`);
    return 1;
  }
}

type CapturedBrokerCredentials = ReturnType<typeof getCapturedDroraCuaBrokerCredentials>;

function assertCapturedBrokerLaunchIsAuthorized(credentials: CapturedBrokerCredentials): void {
  const hasCapturedCredentials = Boolean(credentials.socket || credentials.pluginAuthority);
  if (!hasCapturedCredentials) return;

  const pluginId = process.env[DRORA_PLUGIN_ID_ENV_KEY]?.trim().toLowerCase();
  // 凭据组 = socket + pluginAuthority (+ refreshMarker，+ 可选 token——第 15 轮 mac
  // 发射链回归后 token 重新进组，Windows 身份模式 host.token 恒 null 所以通常缺省)。
  // socket + pluginAuthority 必须成对（authority 是 bootstrap 写入 node_repl 配置的
  // provenance 随机数，core 据此认官方 server）；捕获侧本就只在成对时落快照，半组会清空
  // 并 fail-closed。校验不能要求 token 齐全——身份模式凭据没有 token，强校验会让
  // node_repl 宿主启动即退出（"connection closed during the server/discover probe"），
  // 工具面为空。
  if (
    credentials.socket === undefined ||
    credentials.pluginAuthority === undefined ||
    pluginId !== DRORA_CUA_OFFICIAL_PLUGIN_ID ||
    process.env[DRORA_CUA_NODE_REPL_HOST_ENV_KEY] !== "1"
  ) {
    throw new Error(
      "Captured Drora CUA broker credentials may only launch the trusted shared node_repl host",
    );
  }
}
