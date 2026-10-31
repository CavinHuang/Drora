/**
 * P1b 学习域只读观测方法（本切片为 capture 读取侧复验与接收预算门新增）：
 * readLearningBudgetUsage（UTC 日台账，跨进程一致）、readInferredSlotSources（inferred 槽
 * 合并来源联读）、hasLearningEvidence（evidenceId 存在性，幂等消歧依据）。写侧屏障语义
 * 由 persona-learning-store.test.ts 钉住，本文件只钉读侧。
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSONA_ERROR_CODES, PERSONA_PREFERENCE_KEYS, PERSONA_STORAGE_KEYS } from "@drora/shared";
import {
  openPersonaStore,
  type PersonaLearningEvidenceInput,
  type PersonaStorePort,
} from "../../src/storage/persona/index.js";

const NOW = 1_760_000_000_000;

let handleAuthorityId = "authority-read";

function digest(...parts: Array<unknown>): string {
  return JSON.stringify(parts);
}

function evidenceInput(overrides?: Partial<PersonaLearningEvidenceInput>): PersonaLearningEvidenceInput {
  return {
    evidenceId: "evidence-read-1",
    keyGenerations: {},
    now: NOW,
    policyEpoch: 0,
    sourceHandle: {
      authorityId: handleAuthorityId,
      branchEvidence: "head",
      messageBoundary: '{"boundaryMessageId":"b1","userMessageId":"u1"}',
      origin: "drora-cli-local-runtime",
      productTurnId: "turn-1",
      sessionId: "session-1",
      sourceRevision: "b1",
      workspaceKey: "D:/workspace/example",
    },
    ...overrides,
  };
}

describe("persona P1b 学习域只读观测", () => {
  let root: string;
  let dbPath: string;
  let store: PersonaStorePort;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "drora-persona-learning-reads-"));
    dbPath = join(root, PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database);
    await mkdir(dirname(dbPath), { recursive: true });
    store = await openPersonaStore({ dbPath });
    const initialized = await store.initializeAuthority({
      initialCore: {
        displayName: "Drora",
        selfDescription: "",
        warmth: "balanced",
        directness: "direct",
        humor: "light",
      },
      mutationId: "init-1",
      now: NOW,
      requestDigest: digest("init"),
      templateVersion: 1,
    });
    expect(initialized.ok).toBe(true);
    if (initialized.ok) {
      handleAuthorityId = initialized.value.snapshot.authority.authorityId;
    }
  });

  afterEach(async () => {
    await store.close();
    await rm(root, { recursive: true, force: true });
  });

  it("readLearningBudgetUsage：无记账日为 0；预留后跨连接可见（DB 判定）", async () => {
    const empty = await store.learning.readLearningBudgetUsage(NOW);
    expect(empty).toEqual({
      ok: true,
      value: { attemptsUsed: 0, day: "2025-10-09", inputTokensUsed: 0, outputTokensUsed: 0 },
    });
    const reserved = await store.learning.reserveLearningBudget({
      estimatedInputTokens: 5,
      maxOutputTokens: 7,
      now: NOW,
    });
    expect(reserved.ok).toBe(true);
    const second = await openPersonaStore({ dbPath });
    try {
      const observed = await second.learning.readLearningBudgetUsage(NOW);
      expect(observed.ok).toBe(true);
      if (observed.ok) {
        expect(observed.value.attemptsUsed).toBe(1);
        expect(observed.value.inputTokensUsed).toBe(5);
        expect(observed.value.outputTokensUsed).toBe(7);
      }
    } finally {
      await second.close();
    }
  });

  it("readInferredSlotSources：无 inferred 槽为空；提交后联读出定位元数据（无正文）", async () => {
    const emptyBefore = await store.learning.readInferredSlotSources();
    expect(emptyBefore).toEqual({ ok: true, value: [] });
    // 开启 U+L 后接收并提交一个 inferred 候选。
    const policy = await store.updatePolicy({
      autoLearn: true,
      expectedPolicyRevision: 0,
      mutationId: "policy-1",
      now: NOW,
      requestDigest: digest("policy"),
      usePreferences: true,
    });
    expect(policy).toMatchObject({ ok: true });
    const accepted = await store.learning.acceptLearningEvidence(
      evidenceInput({
        keyGenerations: { [PERSONA_PREFERENCE_KEYS.replyLanguage]: 0 },
        policyEpoch: 1,
      }),
    );
    expect(accepted).toMatchObject({ ok: true, value: { status: "accepted" } });
    const claimed = await store.learning.claimLearningWork({
      leaseDurationMs: 60_000,
      leaseOwner: "test-worker",
      now: NOW,
    });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok || claimed.value.status !== "claimed") return;
    const committed = await store.learning.commitLearningWork({
      candidates: [
        {
          evidenceRefs: ["用中文回复"],
          key: PERSONA_PREFERENCE_KEYS.replyLanguage,
          value: "zh-CN",
        },
      ],
      fence: claimed.value.claim.fence,
      now: NOW,
      workId: claimed.value.claim.workId,
    });
    expect(committed).toMatchObject({ ok: true, value: { status: "applied" } });
    const bindings = await store.learning.readInferredSlotSources();
    expect(bindings.ok).toBe(true);
    if (!bindings.ok) return;
    expect(bindings.value).toHaveLength(1);
    expect(bindings.value[0]).toMatchObject({
      evidenceId: "evidence-read-1",
      key: PERSONA_PREFERENCE_KEYS.replyLanguage,
      sessionId: "session-1",
      sourceRevision: "b1",
      workspaceKey: "D:/workspace/example",
    });
    expect(bindings.value[0]?.messageBoundary).toContain("boundaryMessageId");
  });

  it("hasLearningEvidence：接收前 false、接收后 true；跨连接一致", async () => {
    const before = await store.learning.hasLearningEvidence("evidence-read-1");
    expect(before).toEqual({ ok: true, value: false });
    const policy = await store.updatePolicy({
      autoLearn: true,
      expectedPolicyRevision: 0,
      mutationId: "policy-1",
      now: NOW,
      requestDigest: digest("policy"),
      usePreferences: true,
    });
    expect(policy).toMatchObject({ ok: true });
    const accepted = await store.learning.acceptLearningEvidence(evidenceInput());
    expect(accepted).toMatchObject({ ok: true });
    const after = await store.learning.hasLearningEvidence("evidence-read-1");
    expect(after).toEqual({ ok: true, value: true });
    const second = await openPersonaStore({ dbPath });
    try {
      const observed = await second.learning.hasLearningEvidence("evidence-read-1");
      expect(observed).toEqual({ ok: true, value: true });
      const missing = await second.learning.hasLearningEvidence("evidence-other");
      expect(missing).toEqual({ ok: true, value: false });
    } finally {
      await second.close();
    }
    const invalid = await store.learning.hasLearningEvidence("");
    expect(invalid).toEqual({ ok: false, code: PERSONA_ERROR_CODES.validationFailed });
  });
});
