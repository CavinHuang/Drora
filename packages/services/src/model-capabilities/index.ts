/**
 * services-model-capabilities 模块公共入口（architecture-governance managed 模块）。
 *
 * §13 双入口拆分（renderer 白屏根因修复）：本文件只暴露**契约面**（descriptor +
 * 类型）——services barrel（index.ts）会把它拖进 renderer 模块图，而实现文件
 * （modelCapabilitiesService.ts）顶层静态导入 "@drora/shared/node"（node:fs 具名
 * 形态），vite 浏览器外部化在模块链接期即抛错 → React 永不挂载 → 整窗空白。
 * Host 侧实现走 `@drora/services/model-capabilities-node` 子路径入口（照
 * "./storage-startup" 先例），与 renderer 图隔离。
 */
export { IModelCapabilitiesService } from "./contract.js";
export type {
  ModelCapabilities,
  ModelCapabilitiesFile,
  ModelCapabilitiesUpdate,
  ModelCapabilityEntriesPatch,
} from "@drora/shared";
