export declare function isBrokerMethod(method: string): boolean;
export declare function isReadOnlyBrokerMethod(method: string): boolean;
export interface BrokerRequest {
    id?: string | null;
    method: string;
    params?: unknown;
}
export interface BrokerResponse {
    ok: boolean;
    [key: string]: unknown;
}
/** 解析一行 socket 请求；非法输入返回 undefined（宿主侧静默丢弃）。 */
export declare function parseRequestLine(line: string): BrokerRequest | undefined;
export declare function okResponse(result: unknown): BrokerResponse;
export declare function errorResponse(message: string, options?: {
    code?: string;
}): BrokerResponse;
export declare function errorResponseFromException(error: unknown): BrokerResponse;
export declare function serializeResponse(response: BrokerResponse): string;
export type NativeAutomationBackend = Record<string, unknown>;
export type BrokerHandler = (params: unknown, context?: unknown) => Promise<unknown>;
/** 按 backend 的方法表分发请求；缺方法 / handler 抛错都折成 error envelope。 */
export declare function dispatchRequest(backend: NativeAutomationBackend, request: BrokerRequest): Promise<BrokerResponse>;
export declare function handleRequestLine(backend: NativeAutomationBackend, line: string): Promise<BrokerResponse | undefined>;
