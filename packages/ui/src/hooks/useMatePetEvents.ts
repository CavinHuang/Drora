/**
 * Mate 桌宠接缝导航端口 handler（specs/drora-personal-assistant.md §11 P3 落地注记；
 * docs/mate-implementation-plan-2026-11-04/03-p3-detailed-design.md §6）。
 *
 * Main→Renderer 事件的 renderer 侧执行体，三个事件共用一条导航端口：
 * - open-mate：当前 workspace 打开（或聚焦）大副面板（handleOpenMateSidePane 同位入口）。
 * - open-ticket：按目标 workspace 匹配已开 tab（identity 优先，无命中回落当前
 *   workspace——面板投影覆盖 Host 全部工单），激活该 workspace 并打开大副面板选中工单
 *   （详情二级视图=工单直达落点；汇报全文在详情汇报页签）。
 * - decide：速览放行/忽略——直调 IAssistantTicketService（与面板放行同一服务、同一
 *   事务与幂等），快照推送后两侧状态自然一致（验收 §7.5「tray 放行与主窗口一致」）。
 *
 * 平台面缺席（Web/手机/旧 preload）时为 no-op，不建订阅。
 */
import { useEffect } from "react";
import { ASSISTANT_PERMISSION_TIERS } from "@drora/shared";
import type { MatePetRendererEvent } from "@drora/shared";

import { logger } from "@/logger.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { useMateStore } from "@/store/mateStore.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import type { IPlatformService } from "@drora/shared";

export function useMatePetEvents(params: {
  platform: IPlatformService | null | undefined;
  /** 当前 workspace（App 作用域；open-mate 与 identity 无命中时的回落落点）。 */
  workspaceAbsPath: string;
  workspaceIdentity?: string;
  /** 打开（或聚焦）workspace 级大副面板 tab（useAppPanels 同一入口）。 */
  onOpenMateSidePane(request: { workspacePath: string; workspaceIdentity?: string }): void;
}): void {
  const { platform, workspaceAbsPath, workspaceIdentity, onOpenMateSidePane } = params;
  const service = useOptionalServices()?.assistantTicketService ?? null;
  const tabStore = useTabStoreApi();
  useEffect(() => {
    if (!platform?.onMatePetEvent) return;
    return platform.onMatePetEvent((event: MatePetRendererEvent) => {
      if (event.kind === "open-mate") {
        onOpenMateSidePane({
          workspacePath: workspaceAbsPath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
        });
        return;
      }
      if (event.kind === "open-ticket") {
        // 目标 workspace 匹配：identity 键=AGENTS 身份键规则（trim 后优先）；无已开
        // tab 命中时回落当前 workspace（大副面板投影覆盖 Host 全部工单，选中不受限）。
        const tabs = tabStore.getState().tabs.filter(isWorkspaceTab);
        const identityKey = event.targetWorkspaceIdentity?.trim() || "";
        const matched = identityKey
          ? tabs.find((tab) => (tab.workspaceIdentity?.trim() || "") === identityKey)
          : undefined;
        const target = matched ?? tabs.find((tab) => tab.workspacePath === workspaceAbsPath);
        const targetPath = target?.workspacePath ?? workspaceAbsPath;
        const targetIdentity = target?.workspaceIdentity ?? workspaceIdentity;
        const workspaceKey = targetIdentity?.trim() || targetPath;
        onOpenMateSidePane({
          workspacePath: targetPath,
          ...(targetIdentity ? { workspaceIdentity: targetIdentity } : {}),
        });
        useMateStore.getState().selectTicket(workspaceKey, event.ticketId);
        return;
      }
      // decide：速览放行与面板放行同参（spec §11 收尾注记）——Main 从投影查出的
      // Router 建议档预填（yolo 不透传、缺席回落 build，与面板 approveTier 同规则；
      // yolo 档不经此通道——接口类型排除+服务侧人批门双兜底）。服务缺席（远程
      // workspace 未注册能力位）诚实告警。
      if (!service) {
        logger.warn("[mate-pet] 速览动作丢弃：当前上下文无工单服务");
        return;
      }
      const action =
        event.choice === "approve"
          ? () =>
              service.approveDecision({
                decisionId: event.decisionId,
                permissionTier: event.suggestedTier ?? ASSISTANT_PERMISSION_TIERS.build,
              })
          : () => service.ignoreDecision({ decisionId: event.decisionId });
      void action()
        .then((result) => {
          if (!result.ok)
            logger.warn("[mate-pet] 速览动作未成功（快照推送侧自愈展示）", {
              code: result.error.code,
            });
        })
        .catch((error: unknown) => {
          logger.warn("[mate-pet] 速览动作传输失败", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });
  }, [onOpenMateSidePane, platform, service, tabStore, workspaceAbsPath, workspaceIdentity]);
}
