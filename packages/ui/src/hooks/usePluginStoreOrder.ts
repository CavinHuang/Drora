import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginStoreOrder } from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

/** 只持有当前页面投影；请求合并与 TTL 统一归 Host 配置服务管理。 */
export function usePluginStoreOrder(enabled = true) {
  const { clientConfigService: service } = useServices();
  const [snapshot, setSnapshot] = useState<{
    service: typeof service;
    order: PluginStoreOrder | null;
  }>();
  const generation = useRef(0);
  const refresh = useCallback(
    async (forceRefresh = false) => {
      // 服务未桥接的环境（手机远控桩/降级附着）直接放弃：下方恒等陷阱
      // `snapshot?.service === service` 在两者皆 undefined 时为真，会读
      // `snapshot.order` 崩掉整个 React 树（§33.18.19 同族，假设备实测复现）。
      if (!service) return;
      const current = ++generation.current;
      try {
        const { pluginStoreOrder: order } = await service.getSnapshot({ forceRefresh });
        if (generation.current === current) setSnapshot({ service, order });
      } catch {
        if (generation.current === current) {
          logger.warn("[PluginStoreOrder] 配置读取失败，保留当前排序");
        }
      }
    },
    [service],
  );

  useEffect(() => {
    if (enabled) void refresh();
    return () => {
      generation.current += 1;
    };
  }, [enabled, refresh]);

  return { order: snapshot && snapshot.service === service ? snapshot.order : null, refresh };
}
