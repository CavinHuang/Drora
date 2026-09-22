import { isBrokerPresentedResult } from "./presentation.js";
import { BrokerError, isBrokerMethod } from "./types.js";

function validRequestId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function parseRequestLine(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return { ok: false, id: 0, code: "invalid_request", message: "request is not valid JSON" };
  }
  if (typeof value !== "object" || value === null) {
    return { ok: false, id: 0, code: "invalid_request", message: "request must be a JSON object" };
  }
  const record2 = value;
  const rawId = record2.id;
  const id = validRequestId(rawId) ? rawId : 0;
  if (!validRequestId(rawId)) {
    return {
      ok: false,
      id,
      code: "invalid_request",
      message: "request.id must be a non-negative safe integer",
    };
  }
  if (typeof record2.method !== "string" || record2.method.length === 0) {
    return {
      ok: false,
      id,
      code: "invalid_request",
      message: "request.method must be a non-empty string",
    };
  }
  const params = record2.params;
  if (
    params !== void 0 &&
    (typeof params !== "object" || params === null || Array.isArray(params))
  ) {
    return { ok: false, id, code: "invalid_request", message: "request.params must be an object" };
  }
  return {
    ok: true,
    request: {
      id,
      method: record2.method,
      params: params ?? {},
    },
  };
}
export function okResponse(id, result, presentation?) {
  return {
    id,
    ok: true,
    result: result ?? null,
    ...(presentation === void 0 ? {} : { presentation }),
  };
}
export function errorResponse(id, code, message, details?) {
  const error51: any = { code, message };
  if (details !== void 0 && Object.keys(details).length > 0) {
    error51.details = { ...details };
  }
  return { id, ok: false, error: error51 };
}
export function errorResponseFromException(id, error51) {
  if (error51 instanceof BrokerError) {
    return errorResponse(id, error51.code, error51.message, error51.details);
  }
  const message = error51 instanceof Error ? error51.message : String(error51);
  return errorResponse(id, "internal", message);
}
export function serializeResponse(response) {
  return `${JSON.stringify(response)}
`;
}
export async function dispatchRequest(backend, request) {
  if (!isBrokerMethod(request.method)) {
    return errorResponse(
      request.id,
      "method_not_found",
      `unknown broker method: ${request.method}`,
    );
  }
  const handler = backend[request.method];
  if (typeof handler !== "function") {
    return errorResponse(
      request.id,
      "method_not_found",
      `broker backend does not implement: ${request.method}`,
    );
  }
  try {
    const result = await handler(request.params);
    return isBrokerPresentedResult(result)
      ? okResponse(request.id, result.result, result.presentation)
      : okResponse(request.id, result);
  } catch (error51) {
    return errorResponseFromException(request.id, error51);
  }
}
