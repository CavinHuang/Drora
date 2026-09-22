export declare const BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
export declare const BROKER_UNAVAILABLE_ENV = "ZCODE_CUA_PERMISSION_BROKER_UNAVAILABLE";
export declare class BrokerError extends Error {
    code: string;
    details?: unknown;
    constructor(message?: string, options?: {
        code?: string;
        details?: unknown;
    });
}
export declare class CuaHelperError extends Error {
    code: string;
    constructor(code: string, message?: string, options?: {
        cause?: unknown;
    });
}
export declare class BrokerAuthRejectedError extends Error {
}
export declare function isCuaHelperError(value: unknown): value is CuaHelperError;
export declare const notAuthorized: (message?: string, details?: unknown) => BrokerError;
export declare const notSelectable: (message?: string, details?: unknown) => BrokerError;
export declare const notSettable: (message?: string, details?: unknown) => BrokerError;
export declare const elementUnavailable: (message?: string, details?: unknown) => BrokerError;
export declare const actionUnavailable: (message?: string, details?: unknown) => BrokerError;
export declare const foregroundRequired: (message?: string, details?: unknown) => BrokerError;
export declare function delay(ms: number): Promise<void>;
export interface BrokerExchangeArgs {
    socketPath: string;
    method: string;
    params?: unknown;
    timeoutMs?: number;
    /** authenticate 携带的附加参数（如 launcher 铸造的 token） */
    authenticateParams?: Record<string, unknown>;
}
export declare function brokerExchange({ socketPath, method, params, timeoutMs, authenticateParams, }: BrokerExchangeArgs): Promise<unknown>;
