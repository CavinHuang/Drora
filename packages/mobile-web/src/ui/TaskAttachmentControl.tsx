// §33.18.20 附件控制簇（specs/mobile-relay-r3-frontend.md）：隐藏文件选钮 +
// 「添加上下文」+ 上传循环（ui uploadAttachmentTransaction 窄入口经 props 注入）+
// 上传进度内联提示。引用列表归 TaskComposer（发送组合/芯片展示），本组件只产出
// AttachmentRef。自包含（D6：不 import @zcode/ui）。
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { AttachmentRef } from "@zcode/shared/zcode-protocol-v4";

export interface TaskAttachmentControlProps {
  uploadAttachment?: (
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ) => Promise<AttachmentRef>;
  onUploaded: (attachment: AttachmentRef) => void;
}

export function TaskAttachmentControl(props: TaskAttachmentControlProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);

  const handleFiles = (files: File[]) => {
    const upload = props.uploadAttachment;
    if (!upload || files.length === 0) return;
    void (async () => {
      for (const file of files) {
        setProgress({ name: file.name, percent: 0 });
        try {
          const ref = await upload(file, (loaded: number, total: number) => {
            setProgress({
              name: file.name,
              percent: total > 0 ? Math.round((loaded / total) * 100) : 0,
            });
          });
          props.onUploaded(ref);
        } catch {
          // 上传失败：跳过该文件（进度态清除），不阻断其余文件。
        } finally {
          setProgress(null);
        }
      }
    })();
  };

  return (
    <>
      {/* §32.64 官方活体（CDP 探针）：chat-attachment-button aria=添加上下文（非
          添加附件），Plus 图标非回形针。§33.18.20 附件上传链接线：选文件 →
          uploadAttachment → 引用回调。 */}
      <input
        type="file"
        hidden
        multiple
        aria-hidden="true"
        tabIndex={-1}
        ref={inputRef}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          handleFiles(files);
        }}
      />
      <button
        type="button"
        data-testid="chat-attachment-button"
        aria-label="添加上下文"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-foreground-subtlest"
        onClick={() => inputRef.current?.click()}
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
      {progress ? (
        <span className="max-w-40 truncate text-ui-xs text-foreground-subtlest" role="status">
          上传中 {progress.name} {progress.percent}%
        </span>
      ) : null}
    </>
  );
}
