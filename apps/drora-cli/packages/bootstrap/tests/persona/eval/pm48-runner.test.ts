/**
 * PM48 归因评测 runner（specs/drora-persona-system.md §13 第十四批；合同 §8「12 条固定
 * 序列」）。env 门控默认跳过：DRORA_PERSONA_EVAL=1（真实调用）或
 * DRORA_PERSONA_EVAL_MOCK=1（零网络干跑）。重复次数 DRORA_PERSONA_EVAL_REPEATS
 * （试点冻结=1，全量=3）。
 *
 * 每序列×模型×重复：mkdtemp 独立临时库（生产 10 次/日帽按库独立、实验预算冻结记录在
 * spec §13 第十四批）；真实 PersonaAppService + 逐轮增长的 owner 窗口 + 真实模型抽取
 * 适配器（PM38/40/48 提示词），全链路接收→领取→预算→抽取→机械闸→提交。
 *
 * 判定（合同指标表）：
 * - 「自动归因：固定禁止学习负例有效写入为 0」——forbid 轮零槽变更为 pass；
 * - 「有效学习：合格 accepted 正确写入 ≥90%」——learn 轮槽值等于期望；
 * - conflict 轮 disputed/pending 语义、pinned_guard 轮 pinned 值不变、forget 轮管理面
 *   清理生效。逐轮槽快照与抽取草稿全文落 artifacts，报告消费；本文件只断言采集完整性
 *   （PM57 先例），不设达标阈值判定（判定归所有者）。
 */
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERSONA_STORAGE_KEYS } from "@drora/shared";
import { PersonaAppServiceImpl } from "../../../src/app/drora-persona/persona-app-service.js";
import type {
  PersonaLearningExtractionOutcome,
  PersonaLearningExtractionPort,
  PersonaLearningSourceOwnerPort,
  PersonaLearningSourceVerification,
} from "../../../src/app/drora-persona/learning-contract.js";
import { createModelPersonaLearningExtractor } from "../../../src/app/drora-persona/learning-model-extraction.js";
import { PM48_SEQUENCES, type Pm48Expectation, type Pm48Sequence } from "./corpus/pm48-sequences.js";
import {
  artifactsDir,
  CostLedger,
  EVAL_ENABLED,
  EVAL_MOCK,
  openJsonl,
} from "./harness-support.js";
import { createEvalModels, type EvalModelHandle, type EvalModelSet } from "./model-access.js";

const RUN_ENABLED = EVAL_ENABLED || EVAL_MOCK;
const REPEATS = Math.max(1, Number(process.env.DRORA_PERSONA_EVAL_REPEATS ?? "1"));
const SEQUENCE_FILTER = process.env.DRORA_PERSONA_EVAL_SEQUENCES?.split(",").map((id) => id.trim());

const ledger = new CostLedger();
const records = openJsonl(join(artifactsDir("pm48"), "runs.jsonl"));
let modelSet: EvalModelSet | undefined;

/** 逐轮窗口 owner：按 boundary.userMessageId 登记该轮人类消息原文（接收门读取键）。 */
function sequencingOwner(): PersonaLearningSourceOwnerPort & {
  registerRound(userMessageId: string, message: string): void;
} {
  const windows = new Map<string, string[]>();
  return {
    registerRound(userMessageId, message) {
      windows.set(userMessageId, [message]);
    },
    async verifyLearningSource(input): Promise<PersonaLearningSourceVerification> {
      return {
        branchEvidence: "head",
        sourceRevision: input.boundary.boundaryMessageId,
        status: "verified",
      };
    },
    async readTurnHumanMessages(input) {
      return [...(windows.get(input.boundary.userMessageId) ?? [])];
    },
  };
}

function recordingExtractor(
  model: EvalModelHandle,
  sink: Array<{ evidenceId: string; outcome: PersonaLearningExtractionOutcome }>,
): PersonaLearningExtractionPort {
  const base = createModelPersonaLearningExtractor({
    model: { generateText: (request) => model.generateText(request, "pm48-extract") },
  });
  return {
    availability: "configured",
    async extract(input) {
      const outcome = await base.extract(input);
      sink.push({ evidenceId: input.evidenceId, outcome });
      return outcome;
    },
  };
}

interface SlotSnapshot {
  readonly key: string;
  readonly value: string;
  readonly revision: number;
  readonly pinned: boolean;
  readonly disputed: boolean;
  readonly status: string;
  readonly provenanceKind: string;
  readonly pendingValue?: string;
}

async function snapshotSlots(service: PersonaAppServiceImpl): Promise<SlotSnapshot[]> {
  const list = await service.listPreferences();
  if (!list.ok) throw new Error(`listPreferences 失败: ${JSON.stringify(list)}`);
  return list.value.map((slot) => ({
    key: slot.key,
    value: slot.value,
    revision: slot.revision,
    pinned: slot.pinned,
    disputed: slot.disputed,
    status: slot.status,
    provenanceKind: slot.provenanceKind,
    pendingValue: slot.pendingCandidate?.value,
  }));
}

function slotFor(slots: readonly SlotSnapshot[], key?: string): SlotSnapshot | undefined {
  return key ? slots.find((slot) => slot.key === key) : undefined;
}

function slotsChanged(
  before: readonly SlotSnapshot[],
  after: readonly SlotSnapshot[],
): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** 逐轮判定：输出 {pass, detail} 供 artifacts；pass=false 即候选合同违例（报告判定用）。 */
function judgeExpectation(input: {
  readonly expectation: Pm48Expectation;
  readonly before: readonly SlotSnapshot[];
  readonly after: readonly SlotSnapshot[];
}): { pass: boolean; detail: string } {
  const { expectation, before, after } = input;
  const afterSlot = slotFor(after, expectation.key);
  switch (expectation.kind) {
    case "no_op":
    case "forbid": {
      // 负例「有效写入=0」：本轮任意槽（含待确认/pending）零变更。
      if (slotsChanged(before, after)) {
        return { pass: false, detail: `负例轮发生槽变更: ${JSON.stringify({ before, after })}` };
      }
      return { pass: true, detail: "零槽变更" };
    }
    case "learn": {
      if (!afterSlot || afterSlot.value !== expectation.value) {
        return {
          pass: false,
          detail: `期望 ${expectation.key}=${expectation.value}，实际 ${JSON.stringify(afterSlot)}`,
        };
      }
      if (afterSlot.pinned || afterSlot.disputed) {
        return { pass: false, detail: `值正确但状态异常: ${JSON.stringify(afterSlot)}` };
      }
      return { pass: true, detail: `inferred 写入 ${expectation.key}=${expectation.value}` };
    }
    case "conflict": {
      const disputed = afterSlot?.disputed === true;
      const pendingDifferent =
        afterSlot?.pendingValue === expectation.value && afterSlot.value !== expectation.value;
      if (disputed || pendingDifferent) {
        return { pass: true, detail: `冲突语义生效: ${JSON.stringify(afterSlot)}` };
      }
      return { pass: false, detail: `期望 disputed/待确认，实际 ${JSON.stringify(afterSlot)}` };
    }
    case "pinned_guard": {
      if (!afterSlot || afterSlot.pinned !== true) {
        return { pass: false, detail: `期望 pinned 保留: ${JSON.stringify(afterSlot)}` };
      }
      return { pass: true, detail: `pinned 保持: ${JSON.stringify(afterSlot)}` };
    }
    case "forget":
      return { pass: true, detail: "抽取面零变更由本轮 before/after 判定；管理面清理另行验证" };
  }
}

async function driveSequence(input: {
  readonly model: EvalModelHandle;
  readonly sequence: Pm48Sequence;
  readonly repeat: number;
}): Promise<Record<string, unknown>> {
  const { model, sequence } = input;
  const root = await mkdtemp(join(tmpdir(), `persona-pm48-${sequence.id}-`));
  const dbPath = join(root, PERSONA_STORAGE_KEYS.directory, PERSONA_STORAGE_KEYS.database);
  const owner = sequencingOwner();
  const extractorSinks: Array<{ evidenceId: string; outcome: PersonaLearningExtractionOutcome }> = [];
  const serviceLogs: string[] = [];
  const service = new PersonaAppServiceImpl({
    dbPath,
    learning: {
      extractor: recordingExtractor(model, extractorSinks),
      sourceOwner: owner,
    },
    logger: {
      debug: (message) => serviceLogs.push(`debug: ${message}`),
      info: () => undefined,
      warn: (message, context) => serviceLogs.push(`warn: ${message} ${JSON.stringify(context ?? {})}`),
      error: (message) => serviceLogs.push(`error: ${message}`),
      child: () =>
        ({
          debug: (m: string) => serviceLogs.push(`debug: ${m}`),
          info: () => undefined,
          warn: (m: string, c?: unknown) => serviceLogs.push(`warn: ${m} ${JSON.stringify(c ?? {})}`),
          error: (m: string) => serviceLogs.push(`error: ${m}`),
          child: () => undefined as never,
        }) as never,
    },
  });
  try {
    const initialized = await service.initializePersona({ mutationId: "eval-init" });
    if (!initialized.ok) throw new Error(`初始化失败: ${JSON.stringify(initialized)}`);
    const policy = await service.setPersonalPolicy({
      autoLearn: true,
      expectedPolicyRevision: 0,
      mutationId: "eval-policy",
      usePreferences: true,
    });
    if (!policy.ok) throw new Error(`策略开启失败: ${JSON.stringify(policy)}`);

    // 前置状态布置（pinned=显式保存；inferred=经真实管线学入旧值）。
    if (sequence.precondition.kind === "pinned_preference") {
      const saved = await service.savePreference({
        expectedRevision: 0,
        key: sequence.precondition.key,
        mutationId: "eval-pinned-precondition",
        value: sequence.precondition.value,
      });
      if (!saved.ok) throw new Error(`pinned 前置失败: ${JSON.stringify(saved)}`);
    }
    let preconditionStatus = "none";
    if (sequence.precondition.kind === "inferred_preference") {
      const message = `以后都叫我「${sequence.precondition.value}」，全局所有会话都这样。`;
      owner.registerRound("msg-u-precondition", message);
      await service.acceptLearningSource({
        boundary: { boundaryMessageId: "msg-a-precondition", userMessageId: "msg-u-precondition" },
        personaPermission: true,
        sessionId: `sess-${sequence.id}`,
        turnId: "t-precondition",
        workspaceKey: "ws-persona-eval",
      });
      while ((await service.processLearningWork()) === "claimed") {
        /* 排空工作队列 */
      }
      const slots = await snapshotSlots(service);
      const slot = slotFor(slots, sequence.precondition.key);
      preconditionStatus =
        slot?.value === sequence.precondition.value ? "inferred-ready" : `inferred-miss:${JSON.stringify(slot)}`;
    }

    // 逐轮驱动。
    const roundVerdicts: Array<Record<string, unknown>> = [];
    const acceptanceKinds: Array<{ round: number; kind: string; reason?: string }> = [];
    let before = await snapshotSlots(service);
    for (const [index, roundText] of sequence.rounds.entries()) {
      const round = index + 1;
      const turnId = `t-${sequence.id}-r${round}`;
      const userMessageId = `msg-u-${sequence.id}-${round}`;
      owner.registerRound(userMessageId, roundText);
      const accepted = await service.acceptLearningSource({
        boundary: {
          boundaryMessageId: `msg-a-${sequence.id}-${round}`,
          userMessageId,
        },
        personaPermission: true,
        sessionId: `sess-${sequence.id}`,
        turnId,
        workspaceKey: "ws-persona-eval",
      });
      let processed = 0;
      while ((await service.processLearningWork()) === "claimed") {
        processed += 1;
      }
      const overview = await service.getPersonaLearningOverview();
      acceptanceKinds.push({
        round,
        kind: accepted.kind,
        ...("reason" in accepted ? { reason: String(accepted.reason) } : {}),
        ...(overview.ok ? { overview: JSON.parse(JSON.stringify(overview.value)) } : { overviewError: JSON.stringify(overview) }),
      });
      const after = await snapshotSlots(service);
      const roundExpectations = sequence.expectations.filter((item) => item.round === round);
      for (const expectation of roundExpectations) {
        const verdict = judgeExpectation({ after, before, expectation });
        roundVerdicts.push({
          round,
          expectedKind: expectation.kind,
          expectedKey: expectation.key ?? null,
          expectedValue: expectation.value ?? null,
          note: expectation.note,
          ...verdict,
        });
      }
      // forget 期望：抽取面判定之后走管理面逻辑忘记并验证清理。
      if (roundExpectations.some((item) => item.kind === "forget")) {
        const key = roundExpectations.find((item) => item.kind === "forget")!.key!;
        const target = (await snapshotSlots(service)).find((slot) => slot.key === key);
        const forgotten = await service.forgetPreference({
          expectedRevision: target?.revision ?? 0,
          key,
          mutationId: `eval-forget-${round}`,
        });
        const slotsAfterForget = await snapshotSlots(service);
        const forgottenSlot = slotFor(slotsAfterForget, key);
        roundVerdicts.push({
          round,
          expectedKind: "forget-management",
          forgetResult: JSON.stringify(forgotten),
          slotAfterForget: JSON.stringify(forgottenSlot),
          managementCleaned: forgottenSlot === undefined || forgottenSlot.value === "",
        });
        // 管理面变异后刷新基线：后续轮的 before/after 对比不得把本轮忘记误判为变更。
        before = slotsAfterForget;
        continue;
      }
      before = after;
    }

    const slotsFinal = await snapshotSlots(service);
    return {
      preconditionStatus,
      acceptanceKinds,
      serviceLogs,
      roundVerdicts,
      slotsFinal,
      extractorCalls: extractorSinks.map((entry) => ({
        evidenceId: entry.evidenceId,
        status: entry.outcome.status,
        drafts: entry.outcome.status === "extracted" ? entry.outcome.drafts : [],
      })),
      summary: {
        negativeRounds: roundVerdicts.filter((item) => item.expectedKind === "forbid").length,
        negativeViolations: roundVerdicts.filter(
          (item) => item.expectedKind === "forbid" && item.pass === false,
        ).length,
        learnRounds: roundVerdicts.filter(
          (item) => item.expectedKind === "learn" || item.expectedKind === "conflict",
        ).length,
        learnPassed: roundVerdicts.filter(
          (item) =>
            (item.expectedKind === "learn" || item.expectedKind === "conflict") && item.pass === true,
        ).length,
      },
    };
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
}

describe.skipIf(!RUN_ENABLED)("PM48 归因评测 harness", () => {
  beforeAll(async () => {
    modelSet = await createEvalModels({ ledger, mock: EVAL_MOCK });
  }, 120_000);

  afterAll(() => {
    modelSet?.dispose();
    const summaryPath = join(artifactsDir("pm48"), "summary.json");
    writeFileSync(
      summaryPath,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          repeats: REPEATS,
          corpusSequences: PM48_SEQUENCES.length,
          cost: ledger.summary(),
          note: "只采集与判定明细，不设达标阈值（合同 §8 阈值判定归所有者）",
        },
        null,
        2,
      ),
      "utf8",
    );
  });

  const sequences = SEQUENCE_FILTER
    ? PM48_SEQUENCES.filter((sequence) => SEQUENCE_FILTER.includes(sequence.id))
    : PM48_SEQUENCES;
  const plannedRunKeys: string[] = [];

  it.each([["step-5-preview"], ["step-3.7-flash"]] as const)(
    "PM48 全序列 × %s",
    async (modelKey) => {
      const model = modelSet?.models.find((handle) => handle.key === modelKey);
      if (!model) throw new Error(`模型未就绪: ${modelKey}`);
      for (const sequence of sequences) {
        for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
          const runKey = `pm48/${modelKey}/${sequence.id}/r${repeat}`;
          plannedRunKeys.push(runKey);
          if (records.completedKeys().has(runKey)) continue;
          let record: Record<string, unknown>;
          try {
            const outcome = await driveSequence({ model, sequence, repeat });
            record = { runKey, model: modelKey, sequenceId: sequence.id, covers: sequence.covers, repeat, status: "ok", ...outcome };
          } catch (error) {
            record = {
              runKey,
              model: modelKey,
              sequenceId: sequence.id,
              repeat,
              status: "error",
              error: String(error),
            };
          }
          records.append(record);
        }
      }
      // 采集完整性：计划内 runKey 全部有记录（PM57 先例：唯一断言）。
      for (const runKey of plannedRunKeys) {
        expect(records.completedKeys(), `缺少采集记录 ${runKey}`).toContain(runKey);
      }
    },
    3_600_000,
  );
});
