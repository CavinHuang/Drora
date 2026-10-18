import * as React from "react";
import { AlertTriangle, BookOpenText, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { toast as droraToast } from "@/components/ui/toast.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { requestKnowledgeCitationOpen } from "@/lib/conversationSelectionReference.js";
import {
  auditKnowledgeAnswerCitationCoverage,
  type KnowledgeTurnCitation,
} from "./knowledgeTurnCitations.js";

/**
 * Completed Agent answer provenance follows the CLI's admitted UserInputRow
 * within the same product turn. The AI's [n] markers are display-only:
 * they do not confer authority or establish that a claim is semantically true.
 */
export function KnowledgeAnswerSources({
  citations,
  assistantText,
  sessionId,
  workspaceKey,
}: {
  citations: readonly KnowledgeTurnCitation[];
  assistantText: string;
  sessionId: string;
  workspaceKey: string;
}): React.ReactElement | null {
  const { intl } = useDroraIntl();
  const [opening, setOpening] = React.useState<string | null>(null);

  // D-7 修复（2026-10-17 增量评审）：审计对完整回答做分行/围栏解析与多轮正则替换，
  // ConversationTurnGroup 高频重渲染下须按输入 memo，避免长回答反复重算。
  // ui-cite-a-1 修复（2026-10-18 终审）：early return 原先位于本 useMemo 之前，
  // citations 空↔非空翻转时 hook 数量变化违反 Rules of Hooks；现移到 memo 之后，
  // citations 为空时 memo 照算（audit 对 sourceCount=0 已容忍，仅多一次空转）。
  const audit = React.useMemo(
    () => auditKnowledgeAnswerCitationCoverage(assistantText, citations.length),
    [assistantText, citations.length],
  );
  if (citations.length === 0) return null;
  const cited = new Set(audit.knownNumbers);
  const unknown = audit.unknownNumbers;
  const open = async (receiptId: string): Promise<void> => {
    if (opening !== null) return;
    setOpening(receiptId);
    try {
      const result = await requestKnowledgeCitationOpen({
        targetSessionId: sessionId,
        workspaceKey,
        receiptId,
      });
      if (!result.ok) {
        droraToast(intl.formatMessage({ id: `chat.selections.evidenceOpen.${result.reason}` }), {
          variant: "warning",
        });
      }
    } finally {
      setOpening(null);
    }
  };

  return (
    <section
      className="w-full rounded-lg border border-card-border px-3 py-2.5"
      data-testid="knowledge-answer-turn-sources"
    >
      <div className="flex items-center gap-1.5 text-ui-sm font-medium text-foreground">
        <BookOpenText className="size-4" aria-hidden="true" />
        {intl.formatMessage({ id: "chat.knowledgeTurn.sources" })}
      </div>
      <p className="mt-1 text-ui-xs text-foreground-subtle">
        {intl.formatMessage({ id: "chat.knowledgeTurn.disclaimer" })}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {citations.map((source) => (
          <Button
            key={source.receiptId}
            type="button"
            size="xs"
            variant="outline"
            disabled={opening !== null}
            data-testid={`knowledge-answer-source-${source.index}`}
            onClick={() => void open(source.receiptId)}
          >
            {opening === source.receiptId ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <BookOpenText className="size-3.5" aria-hidden="true" />
            )}
            {[`[${source.index}]`, source.relativePath.split("/").at(-1)].filter(Boolean).join(" ")}
            {cited.has(source.index)
              ? ` · ${intl.formatMessage({ id: "chat.knowledgeTurn.mentioned" })}`
              : ""}
          </Button>
        ))}
      </div>
      {audit.unattributedBlocks > 0 ? (
        <p
          role="status"
          data-testid="knowledge-answer-attribution-gaps"
          className="mt-2 text-ui-xs text-foreground-subtle"
        >
          {intl.formatMessage(
            { id: "chat.knowledgeTurn.gaps" },
            {
              missing: audit.unattributedBlocks,
              total: audit.proseBlocks,
            },
          )}
        </p>
      ) : null}
      {unknown.length > 0 ? (
        <p
          role="status"
          className="mt-2 flex items-center gap-1 text-ui-xs text-warning"
          data-testid="knowledge-answer-unknown-citations"
        >
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          {intl.formatMessage(
            { id: "chat.knowledgeTurn.unknown" },
            {
              numbers: unknown.map((number) => `[${number}]`).join(", "),
            },
          )}
        </p>
      ) : null}
    </section>
  );
}
