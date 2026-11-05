import { useEffect, useRef } from "react";
import type { IPlatformService } from "@drora/shared";

import { useAssistantTickets } from "@/hooks/useAssistantTickets.js";
import { logger } from "@/logger.js";
import { deriveMatePetBubble, projectMatePet } from "@/mate/index.js";

/**
 * Mate 桌宠接缝发布方（spec §11 P3 落地注记；03 详设 §6）：主窗口 renderer 把窗口
 * Host 工单快照投影为有界 MatePetProjection（ui/mate petProjection 纯函数）经
 * platform.publishMatePet 发布，Main 只转发给宠物窗（badge/气泡）与 tray 窗（速览）。
 *
 * 挂载点=Root（窗口 Host services 作用域——Mate 台账注册在窗口 Host，投影覆盖全部
 * 目标 workspace 的工单；桌面宠物发布面缺席（Web/手机/旧 preload）时本组件不渲染，
 * 不建第二条订阅）。气泡判定=登记键差分（纯函数 deriveMatePetBubble 单测锁定）：
 * 冷启动首帧只登记不弹；同工单后续快照刷新不重弹。配额闸归 P4 配额中心，本组件
 * 不建第二计数器（03 §6 注记）。
 */
export function MatePetSync({ platform }: { platform: IPlatformService }) {
  const { snapshot } = useAssistantTickets();
  const shownBubbleKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const projection = projectMatePet(snapshot);
    const decision = deriveMatePetBubble(shownBubbleKeyRef.current, projection.latestReport);
    shownBubbleKeyRef.current = decision.nextKey;
    const published = { ...projection, bubble: decision.show ? projection.latestReport : null };
    try {
      platform.publishMatePet?.(published);
    } catch (error) {
      logger.warn("[mate-pet] 投影发布失败（下一次快照推送重试）", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [platform, snapshot]);
  return null;
}
