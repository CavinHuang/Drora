import { useEffect, useState } from "react";
import { hostSupportsPersonaControlV1 } from "@drora/shared/drora-protocol-v4";
import type { IDroraAgentService } from "@drora/services";
import { logger } from "@/logger.js";
import { ensureAgentV4ConnectionHandshake } from "@/v4/agentV4ConnectionHandshake.js";
import type { PersonaControlAvailability } from "./contract.js";

export type { PersonaControlAvailability };

/**
 * Host↔UI 双层能力发现的上层（specs/drora-persona-system.md §10、合同 §4.1）：
 * hello.capabilities 的 personaControlV1 位只表示 Host 注册了 persona 管理路由，
 * 不是启用、授权或资料健康状态；进入分区后 UI 仍须经 getPersonaOverview 确认
 * 目标本地 CLI 的支持与服务状态。缺失、握手失败一律视为不可用，原功能不受影响；
 * 不试发 persona 方法探测。
 *
 * hello 探测复用 agentV4ConnectionHandshake 的 per-service 缓存（同一连接只握手一次；
 * 失败结果不缓存，重连后重查）。CLI 级能力缓存按连接实例保存在 services 层
 * （independentPlanSupport），不按 workspacePath 全局缓存。
 */

type PersonaControlHandshakeService = Pick<
  IDroraAgentService,
  "helloConversationV4" | "initializeConversationV4"
>;

export function usePersonaControlAvailability(options: {
  /** 承载 hello 握手的 agent service（本机 Host）；null 表示当前装配不探测。 */
  service: PersonaControlHandshakeService | null;
  /** 平台门（桌面本地设置页）不满足时直接 unavailable，不发握手。 */
  enabled: boolean;
}): PersonaControlAvailability {
  const { service, enabled } = options;
  const [availability, setAvailability] = useState<PersonaControlAvailability>(() =>
    enabled && service ? "checking" : "unavailable",
  );

  useEffect(() => {
    if (!enabled || !service) {
      setAvailability("unavailable");
      return;
    }
    let stale = false;
    setAvailability("checking");
    ensureAgentV4ConnectionHandshake(service)
      .then((hello) => {
        if (stale) return;
        // 非 strict 对象的旧 Host 缺失该键 === undefined，必须 === true 判真。
        setAvailability(
          hostSupportsPersonaControlV1(hello.capabilities) ? "available" : "unavailable",
        );
      })
      .catch((cause: unknown) => {
        if (stale) return;
        // 握手失败（Host 未就绪/断开）按不可用降级；失败结果未被缓存，重连后重查。
        logger.warn("[persona] hello 能力探测失败，管理入口保持关闭", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        setAvailability("unavailable");
      });
    return () => {
      stale = true;
    };
  }, [enabled, service]);

  return availability;
}
