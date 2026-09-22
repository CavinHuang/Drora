import { BrokerAuthRejectedError, BrokerError, BROKER_SOCKET_ENV, BROKER_UNAVAILABLE_ENV, CuaHelperError, brokerExchange, delay, isCuaHelperError, notAuthorized, notSelectable, notSettable, elementUnavailable, actionUnavailable, foregroundRequired } from "./client.js";
export { BrokerAuthRejectedError, BrokerError, BROKER_SOCKET_ENV, BROKER_UNAVAILABLE_ENV, CuaHelperError, brokerExchange, delay, isCuaHelperError, notAuthorized, notSelectable, notSettable, elementUnavailable, actionUnavailable, foregroundRequired, };
export interface HelperHealth {
    bundleId: string | null;
    pid: number | null;
}
export interface CallBrokerMethodArgs {
    socketPath: string;
    method: string;
    params?: unknown;
    timeoutMs?: number;
}
export declare function callBrokerMethod<T = unknown>(args: CallBrokerMethodArgs): Promise<T>;
export interface ProbeHelperHealthOptions {
    timeoutMs?: number;
    pollIntervalMs?: number;
    perTryTimeoutMs?: number;
}
export declare function probeHelperHealth(socketPath: string, options?: ProbeHelperHealthOptions): Promise<HelperHealth>;
