/**
 * ui-mate 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 *
 * 展示一次完整链路：快照来自 useAssistantTickets()（唯一数据入口，此处以参数代入）→
 * 视图模型纯函数投影 → 动作经 mateStore 以 service 注入（store 不保存服务引用、
 * 不落业务状态；服务缺席时调用方先拒绝，不降级伪造）。
 */
import type { AssistantSnapshot, IAssistantTicketService } from "@drora/services";

import { useMateStore } from "@/store/mateStore.js";

import { deriveMateViewModel, resolveMateErrorMessageId } from "./view-model.js";

export function exampleUiMate(
  snapshot: AssistantSnapshot,
  service: IAssistantTicketService | null,
  workspaceKey: string,
  decisionId: number,
): void {
  // 读：纯函数投影（filter 只作用于 groups，不影响 pills 的全局计数）。
  const viewModel = deriveMateViewModel(snapshot, "all");
  if (viewModel.groups.length === 0 && viewModel.counts.decision === 0) return;

  // 写：动作全走 service 方法；workspaceKey 作分域键（三件局部态与 single-flight 按
  // workspace 隔离）；service 缺席（远程 workspace/旧 Host）即不可用，不伪造动作。
  if (!service) return;
  void useMateStore
    .getState()
    .approveDecision(service, workspaceKey, { decisionId, permissionTier: "build" })
    .then((result) => {
      if (!result.ok) {
        // 失败文案：resolveMateErrorMessageId(result.error) → mate.error.*（i18n 单一出处）。
        void resolveMateErrorMessageId(result.error);
      }
    });
}
