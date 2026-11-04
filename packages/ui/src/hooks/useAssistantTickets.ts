/**
 * Mate 工单快照 hook（01 详设 §5；唯一 UI 访问入口）。
 *
 * 与 useModelCapabilities 同构（组件经 hooks 访问服务）：判空降级 + getSnapshot 拉一次 +
 * onDidChange 订阅。服务缺席（远程 workspace / 旧 Host 未注册 assistantTicketService）→
 * snapshot=null、service=null，消费方按 fail-closed 渲染不可用态，不在 renderer 建立
 * 第二数据源。快照不进 zustand——mateStore 只存过滤/选中/展开三件局部态（01 §5 推模式，
 * 避免第二业务状态）。
 */
import { useEffect, useRef, useState } from "react";
import type { AssistantSnapshot, IAssistantTicketService } from "@drora/services";

import { useOptionalServices } from "./useServices.js";
import { logger } from "@/logger.js";

export interface AssistantTicketsController {
  /** 最新工单快照；null=服务缺席或首载未完成（消费方渲染不可用态，不伪造数据）。 */
  snapshot: AssistantSnapshot | null;
  /** 服务实例（null=当前上下文不可达；动作入口据此禁用）。 */
  service: IAssistantTicketService | null;
  /** 首载进行中（服务缺席时恒 false）。 */
  loading: boolean;
  /** 读失败文案（服务在但读取/订阅异常；重连后的 resync 快照会自愈）。 */
  error: string | null;
}

export function useAssistantTickets(): AssistantTicketsController {
  const service = useOptionalServices()?.assistantTicketService ?? null;
  const [snapshot, setSnapshot] = useState<AssistantSnapshot | null>(null);
  const [loading, setLoading] = useState(service !== null);
  const [error, setError] = useState<string | null>(null);
  // 拉取与推送的竞态防线：挂载时会同时启动 getSnapshot() 与 onDidChange 订阅，若拉取
  // 迟于某次推送返回，旧的全量快照不得覆盖新推送（01 §3 resync 竞态以 updated_ms 单调
  // 丢弃旧写的同款纪律，落在本 hook 消费侧）。
  const latestUpdatedAtMsRef = useRef(0);

  useEffect(() => {
    if (!service) {
      return;
    }
    let cancelled = false;
    latestUpdatedAtMsRef.current = 0;
    setLoading(true);
    const apply = (next: AssistantSnapshot) => {
      if (next.updatedAtMs < latestUpdatedAtMsRef.current) return; // 旧快照丢弃
      latestUpdatedAtMsRef.current = next.updatedAtMs;
      setSnapshot(next);
      setError(null);
      setLoading(false);
    };
    void service
      .getSnapshot()
      .then((snap) => {
        if (cancelled) return;
        apply(snap);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        logger.warn("[useAssistantTickets] 拉取工单快照失败", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      });
    // onDidChange 返回 disposable 对象（ProxyChannel listen 语义，proxy-channel.ts:126-133，
    // 照 IModelCapabilitiesService 先例）；清理即 dispose。
    const subscription = service.onDidChange((next) => {
      if (cancelled) return;
      apply(next);
    });
    return () => {
      cancelled = true;
      subscription.dispose();
    };
  }, [service]);

  return { snapshot, service, loading, error };
}
