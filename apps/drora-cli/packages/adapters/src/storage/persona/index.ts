/**
 * cli-persona-store 公开入口：PersonaAppService（服务层）经此端口访问 persona 独立库。
 * 迁移清单（migrations.ts）是仓储内部实现，不经本入口暴露。
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
export { PersonaSqliteStore, openPersonaStore } from "./persona-store.js";
