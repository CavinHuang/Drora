interface RuntimeContextLike {
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
export type { ComputerUseRuntime, ComputerUseRuntimeContext } from "./runtime.js";
export declare function createComputerUseRuntime(options?: RuntimeOptionsLike): {
  execute(input: {
    toolName: string;
    arguments?: unknown;
    context?: RuntimeContextLike;
    signal?: AbortSignal;
  }): Promise<unknown>;
  closeSession(_context?: RuntimeContextLike): Promise<void>;
  dispose(): Promise<void>;
};
export {
  main,
  parseServerArgs,
  parsedArgsToOptions,
  readBrokerEnv,
  startStreamableHttpServer,
} from "./mcp/server.js";
