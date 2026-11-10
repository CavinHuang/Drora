import { createConnection } from "node:net";
export const BROKER_SOCKET_ENV = "ZCODE_CUA_PERMISSION_BROKER_SOCKET";
export const BROKER_UNAVAILABLE_ENV = "ZCODE_CUA_PERMISSION_BROKER_UNAVAILABLE";
export class BrokerError extends Error {
    code;
    details;
    constructor(message, options = {}) {
        super(message ?? "Computer Use broker is unavailable.");
        this.name = "BrokerError";
        this.code = options.code ?? "unavailable";
        if (options.details !== undefined)
            this.details = options.details;
    }
}
export class CuaHelperError extends Error {
    code;
    constructor(code, message, options) {
        super(message ?? "Computer Use Helper is unavailable.");
        this.name = "CuaHelperError";
        this.code = code;
        if (options?.cause !== undefined)
            this.cause = options.cause;
    }
}
export class BrokerAuthRejectedError extends Error {
}
export function isCuaHelperError(value) {
    return value instanceof CuaHelperError;
}
const brokerErrorFactory = (code) => (message, details) => new BrokerError(message ?? code, { code, details });
export const notAuthorized = brokerErrorFactory("not_authorized");
export const notSelectable = brokerErrorFactory("not_selectable");
export const notSettable = brokerErrorFactory("not_settable");
export const elementUnavailable = brokerErrorFactory("element_unavailable");
export const actionUnavailable = brokerErrorFactory("action_unavailable");
export const foregroundRequired = brokerErrorFactory("foreground_required");
export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function brokerExchange({ socketPath, method, params, timeoutMs, authenticateParams, }) {
    const sanitize = (text) => text.split(socketPath).join("<socket>");
    return new Promise((resolve, reject) => {
        const socket = createConnection(socketPath);
        let buffered = "";
        let authenticated = false;
        let settled = false;
        const finish = (run) => {
            if (settled)
                return;
            settled = true;
            socket.destroy();
            run();
        };
        socket.on("close", () => finish(() => reject(new Error(sanitize("broker connection closed before reply")))));
        socket.on("error", (error) => finish(() => reject(new Error(sanitize(error.message)))));
        socket.setTimeout(timeoutMs ?? 0); // 0 = 不设超时（由上层 deadline 控制）
        socket.setEncoding("utf8");
        socket.on("connect", () => {
            socket.write(`${JSON.stringify({ id: 0, method: "authenticate", params: authenticateParams ?? {} })}\n`);
        });
        socket.on("data", (chunk) => {
            buffered += chunk;
            let newlineAt = buffered.indexOf("\n");
            for (; newlineAt >= 0;) {
                const line = buffered.slice(0, newlineAt);
                buffered = buffered.slice(newlineAt + 1);
                if (line.trim()) {
                    let parsed;
                    try {
                        parsed = JSON.parse(line);
                    }
                    catch {
                        newlineAt = buffered.indexOf("\n");
                        continue;
                    }
                    if (authenticated) {
                        finish(() => resolve(parsed));
                        return;
                    }
                    authenticated = true;
                    if (parsed.ok !== true) {
                        finish(() => reject(new BrokerAuthRejectedError("broker auth rejected")));
                        return;
                    }
                    socket.write(`${JSON.stringify({ id: 1, method, params })}\n`);
                }
                newlineAt = buffered.indexOf("\n");
            }
        });
        socket.on("timeout", () => finish(() => reject(new Error(sanitize("broker exchange timed out")))));
    });
}
