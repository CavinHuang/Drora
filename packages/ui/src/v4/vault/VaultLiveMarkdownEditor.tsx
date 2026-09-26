import * as React from "react";
import {
  LiveMarkdownEditor,
  type LiveMarkdownEditorHandle,
  type LiveMarkdownTextSelection,
  type LiveMarkdownPropertyEntry,
} from "@/components/markdown/LiveMarkdownEditor.js";
import { serializeFlatLeadingFrontmatter } from "@/components/markdown/live-markdown-frontmatter.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";

import { createVaultWikiLinks } from "./vault-wikilinks.js";

const MAX_PASTED_IMAGE_BYTES = 10 * 1024 * 1024;

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

interface VaultLiveMarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  /** 选区变化由 Vault 外层处理为引用/右侧问答浮窗。 */
  onTextSelectionChange?: (selection: LiveMarkdownTextSelection | null) => void;
  /** CodeMirror 异步挂载完成后通知外层，用于恢复阅读位置。 */
  onReady?: () => void;
  relativePath: string;
  onOpenWikiLink: (target: string) => void;
}

/**
 * Vault's file adapter around the reusable, domain-neutral Markdown editor.
 *
 * 媒体链路适配：Proma 经 IPC 换取 proma-file: token URL；Drora 的
 * IObsidianVaultService.resolveMedia 返回根内绝对路径，再经
 * IPlatformService.createLocalMediaPreviewUrl 换成本地预览 URL。
 */
export const VaultLiveMarkdownEditor = React.forwardRef<
  LiveMarkdownEditorHandle,
  VaultLiveMarkdownEditorProps
>(function VaultLiveMarkdownEditor(
  { relativePath, onOpenWikiLink, ...props },
  ref,
): React.ReactElement {
  const onOpenRef = React.useRef(onOpenWikiLink);
  onOpenRef.current = onOpenWikiLink;
  const extensions = React.useMemo(
    () => [createVaultWikiLinks((target) => onOpenRef.current(target))],
    [],
  );
  const valueRef = React.useRef(props.value);
  const onChangeRef = React.useRef(props.onChange);
  valueRef.current = props.value;
  onChangeRef.current = props.onChange;
  const vaultService = useOptionalServices()?.obsidianVaultService;
  const platform = useOptionalPlatform();
  const mediaRequestsRef = React.useRef(new Map<string, Promise<string | null>>());
  const resolveImageSrc = React.useCallback(
    (src: string): Promise<string | null> => {
      if (!vaultService) return Promise.resolve(null);
      const cached = mediaRequestsRef.current.get(src);
      if (cached) return cached;
      const request = vaultService
        .resolveMedia({ noteRelativePath: relativePath, src })
        .then((result) => {
          if (!result) return null;
          try {
            return platform?.createLocalMediaPreviewUrl?.(result) ?? null;
          } catch {
            return null;
          }
        })
        .catch(() => null);
      mediaRequestsRef.current.set(src, request);
      return request;
    },
    [platform, relativePath, vaultService],
  );

  const savePastedImage = React.useCallback(
    async (file: File): Promise<string | null> => {
      if (!vaultService) return null;
      // Reject before allocating raw bytes, a binary string, Base64, and IPC copies.
      if (file.size <= 0 || file.size > MAX_PASTED_IMAGE_BYTES) return null;
      return (
        (
          await vaultService.savePastedImage({
            noteRelativePath: relativePath,
            mimeType: file.type,
            base64: await fileToBase64(file),
          })
        )?.src ?? null
      );
    },
    [relativePath, vaultService],
  );

  const handlePropertiesChange = React.useCallback(
    (entries: LiveMarkdownPropertyEntry[], documentValue?: string): void => {
      // This callback is retained by the one-time CodeMirror extension. Prefer
      // its live document snapshot, then the latest controlled value, so a
      // property change cannot reintroduce body text from a previous render.
      const nextValue = serializeFlatLeadingFrontmatter(documentValue ?? valueRef.current, entries);
      onChangeRef.current(nextValue);
    },
    [],
  );

  return (
    <LiveMarkdownEditor
      ref={ref}
      {...props}
      extensions={extensions}
      enableProperties
      onChangeProperties={handlePropertiesChange}
      resolveImageSrc={resolveImageSrc}
      savePastedImage={savePastedImage}
    />
  );
});
