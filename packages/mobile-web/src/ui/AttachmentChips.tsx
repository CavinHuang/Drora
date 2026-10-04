// §33.18.20 附件芯片（纯展示）：已上传引用（×可移除）+ 上传中进度。
import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";

export interface AttachmentChipsProps {
  refs: readonly AttachmentRef[];
  uploadProgress: { name: string; percent: number } | null;
  onRemove: (ref: string) => void;
}

export function AttachmentChips(props: AttachmentChipsProps) {
  if (props.refs.length === 0 && !props.uploadProgress) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 pb-1">
      {props.refs.map((attachment) => (
        <span
          key={attachment.ref}
          className="inline-flex max-w-45 items-center gap-1 rounded-md bg-surface px-2 py-1 text-ui-xs text-foreground-subtle"
        >
          <span className="truncate">{attachment.fileName}</span>
          <button
            type="button"
            aria-label={`移除附件 ${attachment.fileName}`}
            className="shrink-0 text-foreground-subtlest hover:text-foreground"
            onClick={() => props.onRemove(attachment.ref)}
          >
            ×
          </button>
        </span>
      ))}
      {props.uploadProgress ? (
        <span className="text-ui-xs text-foreground-subtlest">
          上传中 {props.uploadProgress.name} {props.uploadProgress.percent}%
        </span>
      ) : null}
    </div>
  );
}
