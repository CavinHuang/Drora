/**
 * P1b 学习层测试支撑（非 *.test.ts，不进 vitest 收集）：受控来源 owner、受控抽取替身、
 * 学习就绪服务工厂。生产语义不被本文件改变；只提供确定性的受控输入。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { openPersonaStore, type PersonaStorePort } from "@drora/adapters/storage/persona";
import {
  PERSONA_STORAGE_KEYS,
  type PersonaPreferenceKey,
} from "@drora/shared";
import { PersonaAppServiceImpl } from "../../src/app/drora-persona/persona-app-service.js";
import type {
  PersonaLearningMessageBoundary,
  PersonaLearningSourceOwnerPort,
  PersonaLearningSourceVerification,
} from "../../src/app/drora-persona/learning-contract.js";
import type {
  PersonaLearningCandidateDraft,
  PersonaLearningExtractionInput,
  PersonaLearningExtractionOutcome,
  PersonaLearningExtractionPort,
} from "../../src/app/drora-persona/learning-extraction.js";

export const NOW = 1_700_000_000_000;

export const WORKSPACE_KEY = "D:/workspace/example";
export const SESSION_ID = "session-learning-1";
export const USER_MESSAGE_ID = "msg-user-1";
export const BOUNDARY_MESSAGE_ID = "msg-assistant-1";

export function learningBoundary(
  overrides?: Partial<PersonaLearningMessageBoundary>,
): PersonaLearningMessageBoundary {
  return {
    boundaryMessageId: BOUNDARY_MESSAGE_ID,
    userMessageId: USER_MESSAGE_ID,
    ...overrides,
  };
}

export interface ControlledSourceOwner extends PersonaLearningSourceOwnerPort {
  readonly verifyCalls: Array<Parameters<PersonaLearningSourceOwnerPort["verifyLearningSource"]>[0]>;
  readonly readCalls: Array<
    Parameters<PersonaLearningSourceOwnerPort["readTurnHumanMessages"]>[0]
  >;
}

export interface ControlledSourceOwnerScript {
  /** 逐次验证结果脚本；耗尽后回到缺省 verified。 */
  readonly verifications?: readonly PersonaLearningSourceVerification["status"][];
  /**
   * readTurnHumanMessages 的返回；键存在且值为 undefined＝owner 暂不可用（缺键＝使用
   * 缺省窗口原话）。
   */
  readonly messages?: readonly string[] | undefined;
}

export function controlledSourceOwner(script: ControlledSourceOwnerScript = {}): ControlledSourceOwner {
  let verifyIndex = 0;
  const messagesAvailable = !("messages" in script) || script.messages !== undefined;
  const owner: ControlledSourceOwner = {
    verifyCalls: [],
    readCalls: [],
    async verifyLearningSource(input) {
      owner.verifyCalls.push(input);
      const next = script.verifications?.[verifyIndex];
      verifyIndex += 1;
      if (next !== undefined && next !== "verified") {
        return { status: next } as PersonaLearningSourceVerification;
      }
      return {
        branchEvidence: "head",
        sourceRevision: input.boundary.boundaryMessageId,
        status: "verified",
      };
    },
    async readTurnHumanMessages(input) {
      owner.readCalls.push(input);
      if (!messagesAvailable) return undefined;
      if ("messages" in script && script.messages !== undefined) {
        return [...script.messages];
      }
      return ["请以后都用中文回复我，这条是原话。"];
    },
  };
  return owner;
}

export interface ControlledExtractor extends PersonaLearningExtractionPort {
  readonly calls: PersonaLearningExtractionInput[];
}

export function controlledExtractor(
  outcome:
    | { readonly kind: "drafts"; readonly drafts: readonly PersonaLearningCandidateDraft[] }
    | { readonly kind: "error" }
    | { readonly kind: "no_candidates" },
  options?: { readonly availability?: "configured" | "paused" },
): ControlledExtractor {
  const extractor: ControlledExtractor = {
    availability: options?.availability ?? "configured",
    calls: [],
    async extract(input) {
      extractor.calls.push(input);
      if (outcome.kind === "error") throw new Error("extraction stand-in failed");
      if (outcome.kind === "no_candidates") {
        const none: PersonaLearningExtractionOutcome = { status: "no_candidates" };
        return none;
      }
      const extracted: PersonaLearningExtractionOutcome = {
        drafts: outcome.drafts,
        status: "extracted",
        usage: { inputTokens: 12, outputTokens: 7 },
      };
      return extracted;
    },
  };
  return extractor;
}

/** 合格候选草稿（默认引用与缺省窗口原话逐字一致）。 */
export function draft(
  key: PersonaPreferenceKey,
  value: string,
  evidenceRefs: readonly string[] = ["用中文回复"],
  overrides?: Partial<Pick<PersonaLearningCandidateDraft, "scope">>,
): PersonaLearningCandidateDraft {
  return { evidenceRefs, key, scope: "global", value, ...overrides };
}

export interface LearningReadyService {
  readonly service: PersonaAppServiceImpl;
  readonly owner: ControlledSourceOwner;
  readonly root: string;
  readonly dbPath: string;
  /** 直接打开的第二条库连接（预算台账/工作行观测用）。 */
  openSecondStore(): Promise<PersonaStorePort>;
  cleanup(): Promise<void>;
}

/**
 * 创建并初始化到「学习就绪」（authority 存在、U on、L on）的服务；每个测试独立临时库。
 */
export async function createLearningReadyService(learning?): Promise<LearningReadyService> {
  const root = await mkdtemp(join(tmpdir(), "drora-persona-p1b-"));
  const dbPath = join(root, PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database);
  const owner = learning?.owner ?? controlledSourceOwner();
  const service = new PersonaAppServiceImpl({
    dbPath,
    learning: {
      extractor: learning?.extractor,
      leaseDurationMs: learning?.leaseDurationMs,
      outputTokenReserveMax: learning?.outputTokenReserveMax,
      sourceOwner: owner,
    },
    now: () => NOW,
  });
  const initialized = await service.initializePersona({ mutationId: "init-1" });
  expect(initialized.ok).toBe(true);
  const policy = await service.setPersonalPolicy({
    autoLearn: true,
    expectedPolicyRevision: 0,
    mutationId: "policy-1",
    usePreferences: true,
  });
  expect(policy).toMatchObject({ ok: true, value: { status: "saved" } });
  return {
    cleanup: async () => {
      await service.close();
      await rm(root, { recursive: true, force: true });
    },
    dbPath,
    openSecondStore: () => openPersonaStore({ dbPath }),
    owner,
    root,
    service,
  };
}

/** 接收请求（缺省与受控 owner 的 verified 边界一致）。 */
export function acceptanceRequest(overrides?: {
  readonly boundary?: PersonaLearningMessageBoundary;
  readonly personaPermission?: boolean;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly workspaceKey?: string;
}): {
  boundary: PersonaLearningMessageBoundary;
  personaPermission: boolean;
  sessionId: string;
  turnId: string;
  workspaceKey: string;
} {
  return {
    boundary: learningBoundary(overrides?.boundary),
    personaPermission: overrides?.personaPermission ?? true,
    sessionId: overrides?.sessionId ?? SESSION_ID,
    turnId: overrides?.turnId ?? "turn-1",
    workspaceKey: overrides?.workspaceKey ?? WORKSPACE_KEY,
  };
}
