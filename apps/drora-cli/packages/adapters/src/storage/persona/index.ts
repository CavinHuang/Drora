/**
 * cli-persona-store 公开入口：PersonaAppService（服务层）经此端口访问 persona 独立库。
 * 迁移清单（migrations.ts）与学习域行原语（persona-learning-rows.ts）是仓储内部实现，
 * 不经本入口暴露。P1b 学习面（证据接收/工作队列/预算/候选提交）经
 * `PersonaSqliteStore.learning`（PersonaStorePort.learning）访问。
 */
export {
  PERSONA_STORE_DEFAULTS,
  PersonaStoreError,
  isPersonaStoreError,
  type PersonaStoreAuthorityFacts,
  type PersonaStoreCoreFacts,
  type PersonaStoreInitializeInput,
  type PersonaStoreInitializedValue,
  type PersonaStoreMutationBase,
  type PersonaStoreOptions,
  type PersonaStorePort,
  type PersonaStoreSnapshot,
  type PersonaStoreUpdateCoreInput,
  type PersonaStoreUpdateCoreResult,
} from "./contract.js";
export type {
  PersonaLearningAcceptResult,
  PersonaLearningBudgetReservation,
  PersonaLearningBudgetReserveInput,
  PersonaLearningBudgetSettleInput,
  PersonaLearningBudgetSettleResult,
  PersonaLearningBudgetUsage,
  PersonaLearningCandidateOutcome,
  PersonaLearningClaimInput,
  PersonaLearningClaimResult,
  PersonaLearningCommitCandidate,
  PersonaLearningCommitInput,
  PersonaLearningCommitResult,
  PersonaLearningCommitOutcome,
  PersonaLearningEvidenceInput,
  PersonaLearningSettleWorkInput,
  PersonaLearningSettleWorkResult,
  PersonaLearningSlotSourceBinding,
  PersonaLearningSourceHandle,
  PersonaLearningStorePort,
  PersonaLearningWorkClaim,
} from "./persona-learning-contract.js";
export { PersonaSqliteStore, openPersonaStore } from "./persona-store.js";
export {
  PersonaWorkerStore,
  openWorkerPersonaStore,
  terminatePersonaWorkerForTests,
} from "./persona-store-worker-client.js";
