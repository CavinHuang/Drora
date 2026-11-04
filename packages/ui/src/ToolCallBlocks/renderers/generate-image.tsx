// ============================================================
// generate_image 文生图工具卡（specs/model-capabilities.md §6/§12 F-1）
// ============================================================
// 修复背景：CLI 侧已产出 node_repl_images 展示载荷（≤200KiB 内联），但该载荷此前
// 只被 node-repl family 的渲染分流消费；generate_image 未登记工具身份时落 raw
// fallback 卡，用户在消息流只看到「Image saved to: <path>」文本（§12 修复 F-1）。
// 本卡复用 NodeReplImageGrid 呈现 display 内联图；大图（>200KiB 无 display）与
// 分享投影（conversationShareInlineImages 按 display.kind 分流）互不影响。

import { ImageIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { buildNodeReplDisplayModel } from "@/lib/nodeReplToolDisplay.js";
import { NodeReplImageGrid } from "@/ToolCallBlocks/renderers/nodeReplImageGrid.js";
import { ToolLayout } from "@/ToolCallBlocks/ToolLayout.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";

const GENERATE_IMAGE_TOOL_ICON = <ImageIcon className="size-4 shrink-0 text-foreground-subtle" />;

export function GenerateImageToolCallBlock(context: ToolCallBlockRenderContext) {
  const { intl } = useDroraIntl();
  const { toolCall } = context.toolCallNode;
  // buildNodeReplDisplayModel 从 output/raw 中按 node_repl_images display 归一化出
  // images（与 node-repl 卡同源提取）；无 display 时 images 为空，走文本路径。
  const model = useMemo(() => buildNodeReplDisplayModel(toolCall), [toolCall]);
  const images = model.images;
  const promptText =
    typeof toolCall.input === "object" && toolCall.input !== null
      ? String((toolCall.input as { prompt?: unknown }).prompt ?? "")
      : "";
  const kindLabelId = context.isRunning
    ? "chat.toolCall.generateImage.generating"
    : "chat.toolCall.kind.generateImage";
  const primaryText = useMemo(
    () => (
      <span className="min-w-0 truncate">{promptText || toolCall.title || "generate_image"}</span>
    ),
    [promptText, toolCall.title],
  );
  const resultImageLabel = intl.formatMessage({ id: "chat.toolCall.generateImage.resultImage" });

  const renderContent = useCallback(() => {
    if (images.length > 0) {
      return <NodeReplImageGrid images={images} resultImageLabel={resultImageLabel} />;
    }
    // 大图（>200KiB）display 不内联，只保留 output 文本（含落盘绝对路径）。
    const fallbackText =
      typeof toolCall.output === "string" && toolCall.output.trim().length > 0
        ? toolCall.output
        : (context.errorText ?? "");
    if (!fallbackText) {
      return undefined;
    }
    return (
      <div className="rounded-lg border border-border bg-panel px-4 py-3">
        <p className="whitespace-pre-wrap break-words font-mono text-ui-base leading-5 text-foreground">
          {fallbackText}
        </p>
      </div>
    );
  }, [context.errorText, images, resultImageLabel, toolCall.output]);

  const hasContent = images.length > 0 || typeof renderContent() !== "undefined";

  return (
    <ToolLayout
      toolId={toolCall.toolId}
      icon={GENERATE_IMAGE_TOOL_ICON}
      showIcon={context.showIcon !== false}
      canToggle={hasContent && (context.canToggle ?? true)}
      forceOpen={hasContent && (context.forceOpen ?? false)}
      kindLabel={intl.formatMessage({ id: kindLabelId })}
      sourceLabel={context.sourceLabel}
      primaryText={primaryText}
      isRunning={context.isRunning}
      title={toolCall.title}
      renderContent={hasContent ? renderContent : undefined}
    />
  );
}
