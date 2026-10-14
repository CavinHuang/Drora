import { raceWithTimeout } from "./race-with-timeout.js";
import type { ModelToolCall } from "../deps.js";
import type { StreamedToolExecutionResult } from "../types.js";

export async function collectCompletedResults(
  handles: Map<string, Promise<StreamedToolExecutionResult | undefined>>,
  toolCalls: readonly ModelToolCall[],
  timeoutMs: number,
): Promise<StreamedToolExecutionResult[]> {
  const settled = await Promise.all(
    toolCalls.map((toolCall) => {
      const handle = handles.get(toolCall.id);
      if (!handle) return undefined;
      return raceWithTimeout(
        handle.catch(() => undefined),
        timeoutMs,
      );
    }),
  );
  return settled.filter((result): result is StreamedToolExecutionResult => result !== undefined);
}
