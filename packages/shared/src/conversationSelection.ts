import { z } from "zod";
export const CONVERSATION_SELECTION_MAX_TEXT_LENGTH = 8_000;
export const CONVERSATION_SELECTION_MAX_COUNT = 8;
export const CONVERSATION_SELECTION_MAX_TOTAL_LENGTH = 16_000;

export const conversationQuoteSchema = z.object({
  text: z.string().max(CONVERSATION_SELECTION_MAX_TEXT_LENGTH),
  path: z.string().optional(),
  senderName: z.string().optional(),
  senderId: z.string().optional(),
  messageId: z.string().optional(),
  sentAt: z.string().datetime({ offset: true }).optional(),
  /**
   * 可选的服务端收据绑定（D-2 修复，2026-10-17）：渲染器序列化可信 Markdown 引用时
   * 携带，普通对话选区缺省。投影/读取端据此区分「可信证据引用」与普通选区，
   * 混合输入不再导致完成态引用整组丢失。旧投影行无此字段，读取端回落整表等长
   * 校验。该字段只进结构化 quote 元数据（UI 投影面），不进入模型可见提示词。
   */
  evidenceReceiptId: z.string().optional(),
});
export const conversationQuotesSchema = z
  .array(conversationQuoteSchema)
  .max(CONVERSATION_SELECTION_MAX_COUNT)
  .refine(
    (quotes) =>
      quotes.reduce((sum, quote) => sum + quote.text.length, 0) <=
      CONVERSATION_SELECTION_MAX_TOTAL_LENGTH,
  );
export type ConversationSelectionText = z.infer<typeof conversationQuoteSchema>;

export function buildPromptWithConversationSelections(
  visibleContent: string,
  references: readonly ConversationSelectionText[],
): string {
  if (references.length === 0) return visibleContent;
  // 文件选段曾只发正文，导致模型与历史丢失文件来源；只保留路径，不发送内部身份字段。
  const block = [
    "# userselect:",
    "```userselect",
    JSON.stringify(references.map(({ text, path }) => (path?.trim() ? { path, text } : { text }))),
    "```",
  ].join("\n");
  return visibleContent ? `${visibleContent}\n\n${block}` : block;
}
