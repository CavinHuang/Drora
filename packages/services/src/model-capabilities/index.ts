/**
 * services-model-capabilities 模块公共入口（architecture-governance managed 模块）。
 * 跨模块消费（node.ts 装配、desktop host 构造）只经本文件；实现细节留在模块内。
 */
export { IModelCapabilitiesService } from "./contract.js";
export {
  createModelCapabilitiesService,
  type ModelCapabilitiesServiceDependencies,
} from "./modelCapabilitiesService.js";
export {
  createImageGenerationService,
  type ImageGenerationResult,
  type ImageGenerationServiceDependencies,
} from "./imageGenerationService.js";
