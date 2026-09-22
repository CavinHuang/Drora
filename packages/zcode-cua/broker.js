// broker 公共出口（契约见 ./broker.d.ts）：
// - 协议错误与工厂、socket 交换、broker 调用与健康探测：src/broker/{client,index}.ts 还原实现
// - 稳定/临时 socket 路径解析：src/broker/socket-path.ts 还原实现
// - 请求/响应协议工具：src/broker/protocol.ts 还原实现
export {
  BROKER_SOCKET_ENV,
  BROKER_UNAVAILABLE_ENV,
  BrokerError,
  BrokerAuthRejectedError,
  CuaHelperError,
  isCuaHelperError,
  notAuthorized,
  notSelectable,
  notSettable,
  elementUnavailable,
  actionUnavailable,
  foregroundRequired,
  delay,
  brokerExchange,
  callBrokerMethod,
  probeHelperHealth,
} from "./broker/index.js";
export {
  mintBrokerSocketPath,
  resolveBrokerSocketPath,
  brokerRuntimeDir,
  pruneStaleBrokerSockets,
  isWindowsNamedPipePath,
} from "./broker/socket-path.js";
export {
  parseRequestLine,
  okResponse,
  errorResponse,
  errorResponseFromException,
  serializeResponse,
  dispatchRequest,
  handleRequestLine,
  isBrokerMethod,
  isReadOnlyBrokerMethod,
} from "./broker/protocol.js";
