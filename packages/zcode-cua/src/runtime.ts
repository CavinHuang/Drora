// oxlint-disable-file -- Computer Use 运行时入口（发行物中此入口一直为 fail-closed，
// 真实工具流走 MCP → helper broker；这里按 node-repl-host 的消费契约做语义还原：
// execute({ toolName, arguments }) → 以每次调用一条连接的方式与 Helper broker 交换，
// 连接/鉴权/协议封装复用 broker/client.ts 的 brokerExchange（per-call 连接语义）。
import { BrokerError, BROKER_SOCKET_ENV, brokerExchange } from "./broker/client.js";

// node-repl-host(src/cua-broker.ts、server.ts)按名导入这两个类型;开源剥离的
// 占位 d.ts 未携带,这里以命名导出补齐消费契约。
export interface ComputerUseRuntimeContext {
  sessionId?: string;
  runtimeScope?: string;
  workspaceKey?: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  turnId?: string;
  clientMode?: string;
  deliveryKind?: string;
}

export interface ComputerUseRuntime {
  execute(input: {
    toolName: string;
    arguments?: unknown;
    context?: ComputerUseRuntimeContext;
    signal?: AbortSignal;
  }): Promise<unknown>;
  closeSession(context?: ComputerUseRuntimeContext): Promise<void>;
  dispose(): Promise<void>;
}

interface RuntimeContextLike extends ComputerUseRuntimeContext {
  sessionId?: string;
  runtimeScope?: string;
  workspaceKey?: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  turnId?: string;
  clientMode?: string;
  deliveryKind?: string;
}

interface RuntimeOptionsLike {
  brokerSocketPath?: string;
  refreshMarkerPath?: string;
  ensureBrokerAvailable?: () => Promise<void>;
  env?: NodeJS.ProcessEnv;
}

// R10（2026-11-10，manifest 七十七轮）：token env 死读清理——官方 0.6.5 全线零 token
// （切段 upstream/zcode-cua-0.6.5.index.js:44889-44896 createComputerUseRuntime 无
// token 读；:37522/:37551-37556 authenticate 载荷仅 clientApiVersion+身份字段），
// ZCODE_CUA_PERMISSION_BROKER_TOKEN / DRORA_CUA_PERMISSION_BROKER_TOKEN 两键的
// 读取与常量随之退役；BROKER_SOCKET_ENV（ZCODE_ 面，R1 级键迁移产物）保留。

function readTrimmed(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== "string") return undefined;
  return raw.trim().length > 0 ? raw : undefined;
}

export function createComputerUseRuntime(options: RuntimeOptionsLike = {}): {
  execute(input: {
    toolName: string;
    arguments?: unknown;
    context?: RuntimeContextLike;
    signal?: AbortSignal;
  }): Promise<unknown>;
  closeSession(_context?: RuntimeContextLike): Promise<void>;
  dispose(): Promise<void>;
} {
  const env = options.env ?? process.env;
  const socketPath = options.brokerSocketPath ?? readTrimmed(env, BROKER_SOCKET_ENV);

  return {
    async execute(input: {
      toolName: string;
      arguments?: unknown;
      context?: RuntimeContextLike;
      signal?: AbortSignal;
    }): Promise<unknown> {
      if (options.ensureBrokerAvailable) await options.ensureBrokerAvailable();
      if (!socketPath) {
        throw new BrokerError("Computer Use broker socket is not configured for this session.", {
          code: "unavailable",
        });
      }
      if (input.signal?.aborted) {
        throw new BrokerError("Computer Use request was aborted.", { code: "cancelled" });
      }
      // R10：brokerExchange 的 authenticate 不再携带 token（官方 0.6.5 authenticate
      // 载荷仅 clientApiVersion+身份字段，切段 :37551-37556）；空参数 authenticate
      // 由 Helper 侧 peer 身份模型置位为 tool 角色。
      const result = (await brokerExchange({
        socketPath,
        method: input.toolName,
        params: (input.arguments ?? {}) as Record<string, unknown>,
      })) as {
        ok?: boolean;
        result?: unknown;
        error?: { code?: string; message?: string };
      };
      if (result && result.ok === false) {
        // 透传 Helper 的错误码与消息（method_not_found / not_authorized / ...）
        const code = result.error?.code ?? "broker_error";
        const message = result.error?.message ?? "Computer Use broker call failed.";
        throw new BrokerError(message, { code });
      }
      return (result as { result?: unknown })?.result ?? null;
    },
    async closeSession(_context?: RuntimeContextLike): Promise<void> {
      // 会话资源由 Helper 侧按连接生命周期回收；宿主每调用一连接，无驻留状态。
    },
    async dispose(): Promise<void> {},
  };
}
