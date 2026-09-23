import type { CallToolResult } from "@modelcontextprotocol/server";

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

export function json(value: unknown): CallToolResult {
  return text(JSON.stringify(value, null, 2));
}

export function fail(value: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
    ],
  };
}

/** 统一错误包装：域内抛出的 Error 以消息文本作为工具错误返回。 */
export async function guard(operation: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await operation();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
