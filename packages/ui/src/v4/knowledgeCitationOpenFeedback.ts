import type { KnowledgeCitationOpenResult } from "@/lib/conversationSelectionReference.js";

export interface KnowledgeCitationOpenInput {
  targetSessionId: string;
  workspaceKey: string;
  receiptId: string;
}

/**
 * UI-only single-flight gate. The transport also deduplicates RPCs, but without
 * this gate every click attaches another warning toast to the shared promise.
 * A scope epoch suppresses warnings from expired/unmounted turns, even if users
 * navigate away and back to the same session before the RPC completes.
 */
export function createKnowledgeCitationOpenFeedbackController(
  dispatch: (input: KnowledgeCitationOpenInput) => Promise<KnowledgeCitationOpenResult>,
) {
  let activeScope: string | null = null;
  let generation = 0;
  const pending = new Set<string>();

  return {
    setScope(nextScope: string | null): void {
      if (nextScope !== activeScope) {
        activeScope = nextScope;
        generation += 1;
      }
    },
    open(
      input: KnowledgeCitationOpenInput,
      scope: string,
      showFailure: (reason: string) => void,
    ): boolean {
      if (!scope || scope !== activeScope || !input.receiptId.trim() ||
        !input.targetSessionId.trim() || !input.workspaceKey.trim()) return false;
      const epoch = generation;
      const key = [epoch, scope, input.receiptId].join("\0");
      if (pending.has(key)) return false;
      pending.add(key);
      const isCurrent = (): boolean => activeScope === scope && generation === epoch;
      try {
        void dispatch(input).then((result) => {
          if (!result.ok && isCurrent()) showFailure(result.reason);
        }).catch(() => {
          if (isCurrent()) showFailure("failed");
        }).finally(() => {
          pending.delete(key);
        });
      } catch {
        pending.delete(key);
        if (isCurrent()) showFailure("failed");
      }
      return true;
    },
  };
}
