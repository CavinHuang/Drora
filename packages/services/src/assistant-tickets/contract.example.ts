/**
 * assistant-tickets 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 *
 * 展示一次完整链路（P1 准入主路径）：recordTrigger 记录触发并过准入门 → observe 下
 * explicit 落决策卡 → approveDecision 人工放行（Tier2 预检/W1 规划/软预算排队/Mode A
 * 派发都在服务内编排，调用方只给目标与档位）→ 快照经 onDidChange 订阅消费（UI 侧经
 * useAssistantTickets 包装，见 ui-mate/contract.example.ts）。约定要点：
 *   - 结果都是 AssistantResult（ok/error 固定错误码，不抛业务异常）；
 *   - 消息不能改变权限——targetWorkspaceIdentity/tier 只来自人的放行输入，不解析正文；
 *   - 决策卡/放行是两个事务（放行幂等：decided 已消费返回既有 ticketId）。
 */
import type { IAssistantTicketService } from "./assistantTickets.js";

export async function exampleAssistantTickets(
  service: IAssistantTicketService,
  workspaceKey: string,
): Promise<void> {
  // 1. 记录一次显式点名触发（本地双按钮=测试工具；真实 Source 走 ingestSourceEvent/
  //    submitSourceEntry，强度由 mention && allowlist 真实规则决定）。
  const recorded = await service.recordTrigger({
    text: "帮我把 e2e 用例跑一遍并汇总失败",
    simulated: "explicit",
    targetWorkspaceIdentity: workspaceKey,
  });
  if (!recorded.ok) return; // 固定错误码（storeBusy/migration 等），调用方按码提示

  // 2. observe 模式下 explicit 落决策卡；auto 信任门达标时才可能 auto 直派（告知卡）。
  if (recorded.value.outcome !== "decision_card") return;

  // 3. 人工放行：决策卡 id 来自快照（此处省略订阅细节）；档位仅 build/guarded——
  //    yolo 必须人在决策卡上逐次确认，不存在程序化放行。
  const approved = await service.approveDecision({
    decisionId: 0, // 实参取自快照 decisions[].id（outcome=decision_card 且未消费）
    targetWorkspaceIdentity: workspaceKey,
    permissionTier: "build",
  });
  if (!approved.ok) return; // attachTargetInvalid/dispatchRejected 等：卡未消费可改选重放

  // 4. 后续状态（running→done/failed、换代、usage）由服务内部帧归账推进，调用方只读
  //    快照（onDidChange 订阅或 getSnapshot 拉取），不轮询、不另存副本。
  const snapshot = await service.getSnapshot();
  const ticket = snapshot.tickets.find((t) => t.id === approved.value.ticketId);
  if (ticket) {
    // 消费示例：进行中/终态判定用 view-model 纯函数（ui 侧），服务只给事实。
    void ticket.status;
  }
}
