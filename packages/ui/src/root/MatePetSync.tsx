import { useEffect, useRef } from "react";
import type { IPlatformService } from "@drora/shared";

import { useAssistantTickets } from "@/hooks/useAssistantTickets.js";
import { logger } from "@/logger.js";
import { deriveMateAutonomyBubble, deriveMatePetBubble, projectMatePet } from "@/mate/index.js";
import { ASSISTANT_DISTURBANCE_KINDS } from "@drora/shared";

/**
 * Mate 桌宠接缝发布方（spec §11 P3 落地注记；03 详设 §6）：主窗口 renderer 把窗口
 * Host 工单快照投影为有界 MatePetProjection（ui/mate petProjection 纯函数）经
 * platform.publishMatePet 发布，Main 只转发给宠物窗（badge/气泡）与 tray 窗（速览）。
 *
 * 挂载点=Root（窗口 Host services 作用域——Mate 台账注册在窗口 Host，投影覆盖全部
 * 目标 workspace 的工单；桌面宠物发布面缺席（Web/手机/旧 preload）时本组件不渲染，
 * 不建第二条订阅）。气泡判定=上一帧汇报键差分（纯函数 deriveMatePetBubble 单测锁定）：
 * 挂载首帧（含冷启动已有旧汇报）只登记不弹；会话期间新到达/变化的汇报弹泡。
 * P9（09 详设 §2.2）：差分源扩 report 帧——自主汇报独立差分（deriveMateAutonomyBubble
 * 同构语义），携带 autonomyBubble 字段发布；文本在服务侧已过 admitDisturbance
 * (kind=report) 闸（超额聚合次日摘要不落通知区），发布方不二次计数。
 *
 * **P4 第二棒气泡闸（04 详设 §4；兑现 P3「配额闸归配额中心同一计数」注记）**：弹泡
 * 差分命中时先过 `admitDisturbance(kind=bubble, summary=汇报首行)` 统一计数判定——
 * 未放行（超额聚合次日摘要）或判定通道失败皆不发布气泡帧（fail-closed；summary 已入
 * digest，汇报仍在 tray 速览与面板可见）；decision 类永不抑制的语义由服务侧保证。
 *
 * **在途闸与快照推送的竞态（e2e 实测捕获）**：admitDisturbance 判定本身会推快照
 * （配额计数变化），触发本 effect 重跑——若按「重跑即失效」处理，在途的气泡帧永远
 * 被取消、气泡永不出现。处置：判定在途期间（pendingBubbleKeyRef 非空）跳过无弹泡帧
 * 的发布（不与在途判定竞争写入），判定落定后发布带裁决的气泡帧；登记键已在判定前
 * 推进，重跑帧不会二次差分弹泡（同键不重弹语义不变）。
 */
export function MatePetSync({ platform }: { platform: IPlatformService }) {
  const { snapshot, service } = useAssistantTickets();
  // 上一帧汇报登记态（null=尚未发布过任何帧；deriveMatePetBubble 语义见 petProjection）。
  const previousReportRef = useRef<{ readonly key: string | null } | null>(null);
  // P9（09 详设 §2.2）：上一帧自主 report 登记态（差分源扩 report 帧；deriveMateAutonomyBubble 同构）。
  const previousAutonomyRef = useRef<{ readonly key: string | null } | null>(null);
  // 在途气泡闸的汇报键（null=无在途判定；判定落定时清除）。
  const pendingBubbleKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    const projection = projectMatePet(snapshot);
    const decision = deriveMatePetBubble(previousReportRef.current, projection.latestReport);
    previousReportRef.current = decision.next;
    // P9 自主 report 差分（不进在途闸——report 文本在服务侧已过 admitDisturbance
    // (kind=report) 闸，发布方不二次计数；同键重复帧不重弹语义一致）。
    const autonomyDecision = deriveMateAutonomyBubble(
      previousAutonomyRef.current,
      projection.autonomyBubble ?? null,
    );
    previousAutonomyRef.current = autonomyDecision.next;
    const publish = (bubbleShown: boolean): void => {
      const published = {
        ...projection,
        bubble: bubbleShown ? projection.latestReport : null,
        autonomyBubble: autonomyDecision.show ? (projection.autonomyBubble ?? null) : null,
      };
      try {
        platform.publishMatePet?.(published);
      } catch (error) {
        logger.warn("[mate-pet] 投影发布失败（下一次快照推送重试）", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    if (!decision.show) {
      // 在途闸期间跳过无弹泡帧（见文件头竞态注记）；无在途闸才发布常规帧。
      // P9：自主气泡命中独立发布（携带 autonomyBubble 的帧不受工单气泡在途闸牵连）。
      if (autonomyDecision.show) {
        publish(false);
        return;
      }
      if (pendingBubbleKeyRef.current === null) publish(false);
      return;
    }
    // 气泡闸：先计数判定（kind=bubble 可抑制类）。判定通道缺席/失败/未放行 → 不弹泡
    // （fail-closed，配额语义优先于提示面；登记键已推进，同帧不重试——下一次新汇报
    // 重新差分）。在途闸键登记先于判定（重跑帧据此让路）。
    const reportKey = projection.latestReport
      ? `${projection.latestReport.ticketId}:${projection.latestReport.updatedAtMs}`
      : null;
    pendingBubbleKeyRef.current = reportKey;
    // 闸判定的摘要=投影 latestReport.summary（petProjection 已按首行截断；同一投影值
    // 单一口径，不再回读原票）。判定通道=窗口 Host 工单服务（useAssistantTickets 同源）。
    const summary = projection.latestReport?.summary ?? "";
    const gate: Promise<{ allowed: boolean }> = service
      ? service
          .admitDisturbance({ kind: ASSISTANT_DISTURBANCE_KINDS.bubble, summary })
          .then((result) => ({ allowed: result.ok && result.value.allowed }))
      : Promise.resolve({ allowed: false });
    gate
      .then((verdict) => {
        pendingBubbleKeyRef.current = null;
        if (!mountedRef.current) return; // 卸载后不发布（无消费方）。
        publish(verdict.allowed);
      })
      .catch((error: unknown) => {
        pendingBubbleKeyRef.current = null;
        logger.warn("[mate-pet] 气泡配额判定失败（本帧不弹泡）", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (mountedRef.current) publish(false);
      });
  }, [platform, snapshot, service]);
  return null;
}
