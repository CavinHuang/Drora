/**
 * 证据附件 chip（W09 / specs/obsidian-knowledge.md §5f.1）：镜像
 * ConversationSelectionReferenceChip 的 pill 形态。Tooltip 明示「发送时服务端复验」，
 * 不得宣称附件即可靠证据（stale/cross_session/forbidden 由 CLI gate 裁决）。
 */
import { ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { KnowledgeEvidenceAttachment } from "@/lib/knowledgeEvidenceAttachment.js";
import { ContextAttachmentPill } from "@/v4/composer/ContextAttachmentPill.js";

export function KnowledgeEvidenceChip({
  attachments,
  contentAlign,
  onRemove,
  onRemoveAll,
}: {
  attachments: readonly KnowledgeEvidenceAttachment[];
  contentAlign?: "start" | "center" | "end";
  onRemove?: (receiptId: string) => void;
  onRemoveAll?: () => void;
}) {
  const { intl } = useDroraIntl();
  if (attachments.length === 0) return null;
  const single = attachments.length === 1 ? attachments[0] : undefined;
  const label = single
    ? intl.formatMessage({ id: "chat.evidence.one" }, { name: single.title })
    : intl.formatMessage({ id: "chat.evidence.count" }, { count: String(attachments.length) });
  const removeLabel = intl.formatMessage({ id: "chat.evidence.remove" });
  const removeAllLabel = intl.formatMessage({ id: "chat.evidence.removeAll" });
  return (
    <ContextAttachmentPill
      contentAlign={contentAlign}
      icon={<ShieldCheckIcon className="size-4 shrink-0 text-foreground-subtle" />}
      label={label}
      onRemoveAll={onRemoveAll}
      removeLabel={removeAllLabel}
      triggerProps={{
        "data-knowledge-evidence-count": attachments.length,
      }}
    >
      <div className="max-w-80 px-2 pb-1.5 pt-1 text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "chat.evidence.reverifyHint" })}
      </div>
      {attachments.map((attachment) => (
        <div
          key={attachment.receiptId}
          className="group/evidence flex gap-2 rounded-lg px-2 py-1.5 text-ui-base hover:bg-menu-hover"
        >
          <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
          <div className="min-w-0 flex-1">
            <div className="truncate">{attachment.title}</div>
            <div className="mt-0.5 truncate text-ui-sm text-foreground-subtlest">
              {attachment.relativePath} · {attachment.receiptId}
            </div>
            {attachment.quoteExcerpt ? (
              <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-ui-sm text-foreground-subtlest">
                {attachment.quoteExcerpt}
              </div>
            ) : null}
          </div>
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-5 shrink-0 text-foreground-subtle opacity-0 group-hover/evidence:opacity-100"
              aria-label={removeLabel}
              onClick={() => onRemove(attachment.receiptId)}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ))}
    </ContextAttachmentPill>
  );
}
