/**
 * cli-persona-service 公开入口：PersonaAppService（合同 §3 P0 管理方法）、产品模板资产、
 * 进程级组合与 capture 生产装配（切片 C：E 门端口 + 无会话控制端口；P1b：学习通知端口
 * 工厂 + 只读来源 owner 适配器）。仓储（cli-persona-store）只经 PersonaAppServicePort 的
 * openStore 缺省实现间接使用，不经本入口暴露。acceptLearningSource 是内部面，不经本入口。
 */
export type {
  DroraPersonaSystem,
  PersonaAppService,
  PersonaAppServiceOptions,
  PersonaControlPort,
  PersonaControlPortFactory,
  PersonaSystemBinding,
} from "./contract.js";
export {
  PERSONA_CAPTURE_OMITTED_COMPILE_FAILED,
  PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
  resolvePersonaDatabasePath,
} from "./contract.js";
export type {
  PersonaInternalLearning,
  PersonaLearningAcceptanceOutcome,
  PersonaLearningAcceptanceRequest,
  PersonaLearningCounters,
  PersonaLearningManagement,
  PersonaLearningMessageBoundary,
  PersonaLearningServiceOptions,
  PersonaLearningSkipReason,
  PersonaLearningSourceOwnerPort,
  PersonaLearningSourceVerification,
} from "./learning-contract.js";
export {
  decodePersonaLearningMessageBoundary,
  encodePersonaLearningMessageBoundary,
} from "./learning-contract.js";
export type {
  PersonaLearningCandidateDraft,
  PersonaLearningExtractionInput,
  PersonaLearningExtractionOutcome,
  PersonaLearningExtractionPort,
  PersonaLearningValidatedCandidate,
  PersonaLearningValidationResult,
} from "./learning-extraction.js";
export {
  estimateLearningInputTokens,
  pausedPersonaLearningExtractor,
  validateExtractionDrafts,
} from "./learning-extraction.js";
export { createSessionStoreLearningSourceOwner } from "./learning-source-owner.js";
export { getProductPersonaTemplate, type ProductPersonaTemplate } from "./product-template.js";
export { asPersonaCapturePort, PersonaAppServiceImpl } from "./persona-app-service.js";
export {
  createPersonaControlPort,
  getOrCreateDroraPersonaSystem,
  peekDroraPersonaSystem,
  resetDroraPersonaSystemForTests,
} from "./persona-system.js";
