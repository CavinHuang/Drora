/**
 * model-capabilities Host 侧实现入口（specs/model-capabilities.md §13 双入口拆分）。
 *
 * 仅 Host 进程（desktop host / node.ts 装配）经 `@drora/services/model-capabilities-node`
 * 消费；renderer 不允许 import 本文件——实现静态依赖 "@drora/shared/node"（node:fs），
 * 进入 renderer 模块图会在 vite 浏览器外部化的模块链接期抛错（白屏事故根因，见
 * index.ts 头注释）。
 */
export {
  createModelCapabilitiesService,
  type ModelCapabilitiesServiceDependencies,
} from "./modelCapabilitiesService.js";
export {
  createImageGenerationService,
  type ImageGenerationResult,
  type ImageGenerationServiceDependencies,
} from "./imageGenerationService.js";
export { migrateSelfContainedEntries, upgradeV1FileToV2 } from "./providerRefMigration.js";
