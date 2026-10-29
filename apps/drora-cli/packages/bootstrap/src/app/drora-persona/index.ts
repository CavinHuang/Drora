/**
 * cli-persona-service 公开入口：PersonaAppService（合同 §3 P0 管理方法）、产品模板资产、
 * 进程级组合与 capture 生产装配。仓储（cli-persona-store）只经 PersonaAppServicePort
 * 的 openStore 缺省实现间接使用，不经本入口暴露。
 */
export type {
  DroraPersonaSystem,
  PersonaAppService,
  PersonaAppServiceOptions,
  PersonaSystemBinding,
} from "./contract.js";
export {
  PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
  resolvePersonaDatabasePath,
} from "./contract.js";
export { getProductPersonaTemplate, type ProductPersonaTemplate } from "./product-template.js";
export { asPersonaCapturePort, PersonaAppServiceImpl } from "./persona-app-service.js";
export {
  getOrCreateDroraPersonaSystem,
  peekDroraPersonaSystem,
  resetDroraPersonaSystemForTests,
} from "./persona-system.js";
