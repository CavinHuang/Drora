/**
 * useServices —— 通过 React Context 提供 IServiceAccessor
 *
 * 替代 props drilling，组件通过 useServices() 直接获取服务。
 */
import { createContext, useContext, type ReactNode } from "react";
import type { IServiceAccessor } from "@drora/services";

// 临时诊断（GitPane 一期崩源，用后即还原）：模块执行 id + Provider 渲染印记。
const __svcModuleId = ((globalThis as { __svcModuleId?: string }).__svcModuleId ??= Math.random()
  .toString(36)
  .slice(2, 8)) as string;
const ServiceContext = createContext<IServiceAccessor | null>(null);

export function ServiceProvider({
  services,
  children,
}: {
  services: IServiceAccessor;
  children: ReactNode;
}) {
  (globalThis as { __prov?: string[] }).__prov ??= [];
  (globalThis as { __prov?: string[] }).__prov.push("provider:" + __svcModuleId);
  return <ServiceContext.Provider value={services}>{children}</ServiceContext.Provider>;
}

export function useServices(): IServiceAccessor {
  const ctx = useContext(ServiceContext);
  if (!ctx) {
    // 临时诊断探针（GitPane 一期崩源定位，用后即还原）：
    (globalThis as { __useServicesProbe?: string }).__useServicesProbe = new Error().stack ?? "";
    throw new Error("useServices 必须在 ServiceProvider 内使用");
  }
  return ctx;
}

export function useOptionalServices(): IServiceAccessor | null {
  return useContext(ServiceContext);
}
