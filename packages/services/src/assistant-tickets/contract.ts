/**
 * assistant-tickets 对外契约（specs/drora-personal-assistant.md §5；
 * docs/mate-implementation-plan-2026-11-04/01-p1-detailed-design.md）。
 *
 * 对外真实入口是 assistantTickets.ts 的 IAssistantTicketService descriptor
 * （经 services channel 暴露给 renderer/UI）；本文件声明模块级不变量类型，
 * 防止调用方绕过服务直接触碰台账语义。
 */

/** 工单 id 形态（'T-'+createUuid）；作为 v4 sendText 的 commandId（P1 单发幂等键）。 */
export type AssistantTicketId = string & { readonly __brand: "AssistantTicketId" };

/** Mandate id 形态（'M-'+createUuid）。 */
export type AssistantMandateId = string & { readonly __brand: "AssistantMandateId" };

export interface AssistantTicketsContract {
  /** 触发 → 准入 → 决策 → 派发 → 归账 全链唯一写者是 IAssistantTicketService。 */
  readonly soleWriter: "IAssistantTicketService";
}
