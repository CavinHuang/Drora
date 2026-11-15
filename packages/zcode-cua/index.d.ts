// 对齐上游 v3.18.2 官方 0.6.5 桩 d.ts 的具名导出面（对照基准：
// git show refs/upstream-trees/v3.18.2:packages/zcode-cua/index.d.ts）。类型实体
// 单一出处在 ./runtime.d.ts（本仓 runtime.js 为独立出口，上游桩为单文件内联），
// 此处仅具名再导出；mcp/server 五导出为本仓还原的 MCP 引擎面，保留。
export type {
  ComputerUseRuntime,
  ComputerUseRuntimeContext,
  ComputerUseRuntimeExecuteInput,
  ComputerUseRuntimeOptions,
} from "./runtime.js";
export { createComputerUseRuntime } from "./runtime.js";
export {
  main,
  parseServerArgs,
  parsedArgsToOptions,
  readBrokerEnv,
  startStreamableHttpServer,
} from "./mcp/server.js";
