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

export function image(value: unknown, data: string, mimeType = "image/png"): CallToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(value, null, 2) },
      { type: "image", data, mimeType },
    ],
  };
}
