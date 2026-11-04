/**
 * 模型能力档案 hook（specs/model-capabilities.md §4/§5；唯一 UI 访问入口）。
 *
 * 与 useModelProviders 同构（组件经 hooks 访问服务）：读快照 + onDidChange 订阅 +
 * update 唯一写路径。档案是本机桌面 Host 事实（ModelCapabilitiesService 只在
 * desktop 本地 Host 注册，node.ts 注入；server/stdio/远程 Host 不注册）：
 * - 当前上下文服务缺席（远端 workspace ServiceProvider 等）→ capabilities=null、
 *   service=null，update 拒绝——消费方（语音回退树、表单）按 fail-closed 语义
 *   回落默认态，不在 renderer 建立第二数据源；
 * - apiKey 不在快照内（凭据只写 credentialService，spec §3.2），本 hook 永不
 *   回显凭据明文。
 */
import { useCallback, useEffect, useState } from "react";
import type {
  ModelCapabilities,
  ModelCapabilitiesFile,
  ModelCapabilitiesUpdate,
} from "@drora/shared";
import type { IModelCapabilitiesService } from "@drora/services";
import { useOptionalServices } from "./useServices.js";
import { logger } from "@/logger.js";

export interface ModelCapabilitiesController {
  /** 档案能力面快照；null = 服务缺席（非桌面本地 Host）。 */
  capabilities: ModelCapabilities | null;
  /** 首载进行中（服务缺席时恒 false）。 */
  loading: boolean;
  /** 读失败文案（服务在但读取异常；fail-closed 由消费方处理）。 */
  error: string | null;
  /** 服务实例（null = 当前上下文不可达；表单可据此渲染不可用态）。 */
  service: IModelCapabilitiesService | null;
  /** 唯一写路径（spec §4）：capabilities 浅合并 + credentials 写删；服务缺席时 reject。 */
  update: (params: ModelCapabilitiesUpdate) => Promise<ModelCapabilitiesFile>;
}

export function useModelCapabilities(): ModelCapabilitiesController {
  const service = useOptionalServices()?.modelCapabilitiesService ?? null;
  const [snapshot, setSnapshot] = useState<ModelCapabilitiesFile | null>(null);
  const [loading, setLoading] = useState(service !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!service) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void service
      .get()
      .then((file) => {
        if (cancelled) return;
        setSnapshot(file);
        setError(null);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        logger.warn("[useModelCapabilities] 读取模型能力档案失败", {
          error: cause instanceof Error ? cause.message : String(cause),
        });
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      });
    const subscription = service.onDidChange((next) => {
      if (cancelled) return;
      // onDidChange 载荷不含凭据（spec §4），快照直接落 state。
      setSnapshot(next);
      setError(null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      subscription.dispose();
    };
  }, [service]);

  const update = useCallback(
    (params: ModelCapabilitiesUpdate) => {
      if (!service) {
        return Promise.reject(new Error("model capabilities service unavailable"));
      }
      return service
        .update(params)
        .then((next) => {
          // update 返回写入后的权威快照；onDidChange 也会到达，先落一次保证表单
          // 回显即时一致（事件竞态下后到者幂等覆盖同值）。
          setSnapshot(next);
          setError(null);
          return next;
        })
        .catch((cause: unknown) => {
          logger.warn("[useModelCapabilities] 更新模型能力档案失败", {
            error: cause instanceof Error ? cause.message : String(cause),
          });
          throw cause;
        });
    },
    [service],
  );

  return {
    capabilities: snapshot?.capabilities ?? null,
    loading,
    error,
    service,
    update,
  };
}
