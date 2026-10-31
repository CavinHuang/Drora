/**
 * persona 独立库 worker 的消息协议（cli-persona-store 内部模块；合同 §2「SQLite 位于异步
 * worker」、spec §4 模块表「adapters/persona 独立库 worker」）。
 *
 * 本文件是 client（persona-store-worker-client.ts）与 worker 入口
 * （persona-store-worker-main.ts）共享的类型与常量，零 IO：真正的存储语义全部留在
 * PersonaSqliteStore（worker 内唯一实现），本协议只做搬运。
 *
 * 边界：
 * - 消息经结构化克隆传输，PersonaStorePort 的全部输入/输出都是可克隆的普通对象
 *   （字符串/数字/数组/记录）；AbortSignal 等不可克隆对象不在存储端口上。
 * - PersonaStoreError 以 {code,message,dbPath} 序列化后在 client 侧重水化；非
 *   PersonaStoreError 的意外异常统一映射为 storage_unavailable（原文 message 保留），
 *   不把内部缺陷伪装成业务错误码。堆栈不跨线程传输（诊断信息以 message 为准）。
 * - 协议形状由同模块的 client/worker 两端共同约定，属同一信任域（同进程 spawn 的
 *   workerData/postMessage），不是跨信任边界的 wire 合同；因此 worker 侧按表派发时
 *   对输入做类型断言而非运行时 schema 校验。
 */
import type {
  PersonaStoreAllowLearningInput,
  PersonaStoreForgetPreferenceInput,
  PersonaStoreInitializedValue,
  PersonaStoreInitializeInput,
  PersonaStorePort,
  PersonaStoreSavePreferenceInput,
  PersonaStoreSnapshot,
  PersonaStoreUpdateCoreInput,
  PersonaStoreUpdateCoreResult,
  PersonaStoreUpdatePolicyInput,
} from "./contract.js";
import type {
  PersonaLearningBudgetReserveInput,
  PersonaLearningBudgetSettleInput,
  PersonaLearningClaimInput,
  PersonaLearningCommitInput,
  PersonaLearningEvidenceInput,
  PersonaLearningSettleWorkInput,
  PersonaLearningStorePort,
} from "./persona-learning-contract.js";
import type {
  PersonaManagementResult,
  PersonaPolicyMutationResult,
  PersonaPreferenceFacts,
  PersonaPreferenceMutationResult,
  PersonaForgetResult,
  PersonaAllowLearningResult,
} from "@drora/shared";

type StoreMethod<M extends keyof Omit<PersonaStorePort, "learning">> = Awaited<
  ReturnType<PersonaStorePort[M]>
>;
type LearningMethod<M extends keyof PersonaLearningStorePort> = Awaited<
  ReturnType<PersonaLearningStorePort[M]>
>;

/** 打开选项经 workerData 传入（PersonaStoreOptions 是可克隆的纯数据）。 */
export type PersonaWorkerOpenData = {
  readonly dbPath: string;
  readonly lockWaitTimeoutMs?: number;
  readonly adminRequestBudgetMs?: number;
  readonly receiptRetentionMs?: number;
  readonly receiptMaxPerAuthority?: number;
};

/** 序列化后的 PersonaStoreError（client 侧按原 code/message/dbPath 重水化）。 */
export interface PersonaWorkerSerializedError {
  readonly code: string;
  readonly message: string;
  readonly dbPath?: string;
}

export type PersonaWorkerRequest =
  | { readonly kind: "call"; readonly id: number; readonly op: string; readonly input: unknown }
  | { readonly kind: "close"; readonly id: number };

export type PersonaWorkerResponse =
  | { readonly kind: "ready" }
  | { readonly kind: "open-failed"; readonly error: PersonaWorkerSerializedError }
  | {
      readonly kind: "result";
      readonly id: number;
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly kind: "result";
      readonly id: number;
      readonly ok: false;
      readonly error: PersonaWorkerSerializedError;
    };

/**
 * op 名 → 输入/输出形状表（client 的 call 与 worker 的派发共用同一份键；键与
 * PersonaStorePort / PersonaLearningStorePort 方法一一对应，学习面以 "learning." 前缀区分）。
 */
export interface PersonaWorkerOpTable {
  readSnapshot: { input: undefined; output: PersonaStoreSnapshot };
  initializeAuthority: {
    input: PersonaStoreInitializeInput;
    output: PersonaManagementResult<PersonaStoreInitializedValue>;
  };
  updateCore: {
    input: PersonaStoreUpdateCoreInput;
    output: PersonaManagementResult<PersonaStoreUpdateCoreResult>;
  };
  updatePolicy: {
    input: PersonaStoreUpdatePolicyInput;
    output: PersonaManagementResult<PersonaPolicyMutationResult>;
  };
  savePreference: {
    input: PersonaStoreSavePreferenceInput;
    output: PersonaManagementResult<PersonaPreferenceMutationResult>;
  };
  forgetPreference: {
    input: PersonaStoreForgetPreferenceInput;
    output: PersonaManagementResult<PersonaForgetResult>;
  };
  allowLearningForKey: {
    input: PersonaStoreAllowLearningInput;
    output: PersonaManagementResult<PersonaAllowLearningResult>;
  };
  listPreferences: {
    input: undefined;
    output: PersonaManagementResult<readonly PersonaPreferenceFacts[]>;
  };
  readExportSnapshot: {
    input: undefined;
    output: StoreMethod<"readExportSnapshot">;
  };
  "learning.acceptLearningEvidence": {
    input: PersonaLearningEvidenceInput;
    output: LearningMethod<"acceptLearningEvidence">;
  };
  "learning.claimLearningWork": {
    input: PersonaLearningClaimInput;
    output: LearningMethod<"claimLearningWork">;
  };
  "learning.commitLearningWork": {
    input: PersonaLearningCommitInput;
    output: LearningMethod<"commitLearningWork">;
  };
  "learning.settleLearningWork": {
    input: PersonaLearningSettleWorkInput;
    output: LearningMethod<"settleLearningWork">;
  };
  "learning.reserveLearningBudget": {
    input: PersonaLearningBudgetReserveInput;
    output: LearningMethod<"reserveLearningBudget">;
  };
  "learning.settleLearningBudget": {
    input: PersonaLearningBudgetSettleInput;
    output: LearningMethod<"settleLearningBudget">;
  };
  "learning.readLearningBudgetUsage": {
    input: number;
    output: LearningMethod<"readLearningBudgetUsage">;
  };
  "learning.readInferredSlotSources": {
    input: undefined;
    output: LearningMethod<"readInferredSlotSources">;
  };
  "learning.hasLearningEvidence": {
    input: string;
    output: LearningMethod<"hasLearningEvidence">;
  };
}

export type PersonaWorkerOp = keyof PersonaWorkerOpTable;
