/**
 * PM47 效果对照评测 runner（specs/drora-persona-system.md §13 第十四批；合同 §8「六类
 * ×≥5 场景×两模型×3 重复+无人格基线」）。env 门控同 PM48；试点冻结=每类前 2 场景×
 * 1 重复（DRORA_PERSONA_EVAL_SCENARIO_SUBSET=first2ofclass），全量=30 场景×3 重复
 * （DRORA_PERSONA_EVAL_SCENARIO_SUBSET=all）。
 *
 * 每场景×模型×配置（persona-on/off）×重复：
 * - persona-on：compilePersonaContribution（冻结评测人格=核心五字段+受控四键）编译两次
 *   断言同输入同输出（PM47 确定性），sha256 入 artifacts；贡献以 leading system 消息
 *   注入（与生产 applyPersonaContribution 的前导 system 组 splice 语义一致——本剥离
 *   路径无其他 system 内容）。persona-off（基线）：不加贡献。
 * - 主请求 generateText（结构化类带 responseJsonSchema、输出上界 2048）。
 * - 判定：keyPoints anyOf 自动检查（任务质量关键事实）+ 结构化 schema 自动校验
 *   （人格破坏指定输出=关键失败信号）；自然度/身份稳定归隐藏标签盲评。
 *
 * 盲评材料：repeat=1 的 on/off 输出按种子随机分配 A/B 标签生成对照（标签映射单独
 * 存 mapping.secret.json，评分表无标签）；本文件只断言采集完整性。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compilePersonaContribution } from "@drora/core/persona";
import {
  artifactsDir,
  CostLedger,
  EVAL_ENABLED,
  EVAL_MOCK,
  matchesAnyOf,
  openJsonl,
  parseAndCheckSchema,
  seededRandom,
  sha256,
} from "./harness-support.js";
import { createEvalModels, type EvalModelSet } from "./model-access.js";
import {
  PM47_CORPUS_VERSION,
  PM47_EVAL_PERSONA_CORE,
  PM47_EVAL_PREFERENCES,
  PM47_SCENARIOS,
  type Pm47Scenario,
} from "./corpus/pm47-scenarios.js";

const RUN_ENABLED = EVAL_ENABLED || EVAL_MOCK;
const REPEATS = Math.max(1, Number(process.env.DRORA_PERSONA_EVAL_REPEATS ?? "1"));
const SUBSET = process.env.DRORA_PERSONA_EVAL_SCENARIO_SUBSET ?? "first2ofclass";

const ledger = new CostLedger();
const records = openJsonl(join(artifactsDir("pm47"), "runs.jsonl"));
let modelSet: EvalModelSet | undefined;

const EVAL_PREFERENCES_INPUT = Object.entries(PM47_EVAL_PREFERENCES).map(([key, value]) => ({
  key,
  value,
}));

function compileFrozenContribution(): { content: string; contentSha256: string } {
  const first = compilePersonaContribution(
    PM47_EVAL_PERSONA_CORE,
    1,
    EVAL_PREFERENCES_INPUT,
    1,
  );
  const second = compilePersonaContribution(
    PM47_EVAL_PERSONA_CORE,
    1,
    EVAL_PREFERENCES_INPUT,
    1,
  );
  if (first.status !== "compiled" || second.status !== "compiled") {
    throw new Error(`冻结人格编译失败: ${JSON.stringify(first)}`);
  }
  if (first.contribution.content !== second.contribution.content) {
    throw new Error("PM47 确定性破坏：同输入两次编译不一致");
  }
  return { content: first.contribution.content, contentSha256: sha256(first.contribution.content) };
}

function selectScenarios(): readonly Pm47Scenario[] {
  if (SUBSET === "all") return PM47_SCENARIOS;
  if (SUBSET === "first2ofclass") {
    const picked: Pm47Scenario[] = [];
    const seen = new Map<string, number>();
    for (const scenario of PM47_SCENARIOS) {
      const count = seen.get(scenario.klass) ?? 0;
      if (count < 2) {
        picked.push(scenario);
        seen.set(scenario.klass, count + 1);
      }
    }
    return picked;
  }
  const ids = SUBSET.split(",").map((id) => id.trim());
  return PM47_SCENARIOS.filter((scenario) => ids.includes(scenario.id));
}

interface BlindPair {
  readonly pairId: string;
  readonly model: string;
  readonly scenarioId: string;
  readonly title: string;
  readonly task: string;
  on?: string;
  off?: string;
}

function writeBlindMaterials(pairs: readonly BlindPair[]): void {
  const blindDir = artifactsDir("blind");
  const rng = seededRandom(20261102);
  const mapping: Array<{ pairId: string; A: "on" | "off"; B: "on" | "off" }> = [];
  const assignments = new Map<string, { A: string; B: string }>();
  for (const pair of pairs) {
    if (pair.on === undefined || pair.off === undefined) continue;
    const onIsA = rng() < 0.5;
    mapping.push({ pairId: pair.pairId, A: onIsA ? "on" : "off", B: onIsA ? "off" : "on" });
    assignments.set(pair.pairId, {
      A: onIsA ? pair.on : pair.off,
      B: onIsA ? pair.off : pair.on,
    });
  }
  writeFileSync(join(blindDir, "mapping.secret.json"), JSON.stringify(mapping, null, 2), "utf8");
  if (assignments.size === 0) return;
  for (const model of new Set(pairs.map((pair) => pair.model))) {
    const modelPairs = pairs.filter((pair) => pair.model === model && assignments.has(pair.pairId));
    const body = modelPairs
      .map((pair, index) => {
        const assigned = assignments.get(pair.pairId)!;
        const scoring = ["自然度（1-5）：____", "身份一致（1-5）：____", "偏好：A / B / 平局"].join(
          "\n",
        );
        return [
          `## 对照 ${index + 1}（${pair.pairId}）`,
          "",
          `### 任务`,
          pair.task,
          "",
          `### 回答 A`,
          "",
          "```text",
          assigned.A,
          "```",
          "",
          `### 回答 B`,
          "",
          "```text",
          assigned.B,
          "```",
          "",
          scoring,
          "",
        ].join("\n");
      })
      .join("\n");
    writeFileSync(
      join(blindDir, `review-${model.replace(/[^A-Za-z0-9.-]/g, "_")}.md`),
      [
        `# PM47 盲评材料（${model}）`,
        "",
        `语料 ${PM47_CORPUS_VERSION}；每对照为同一任务的两种配置输出，标签已隐藏。`,
        "评分口径：自然度=表达自然与身份稳定；偏好=整体更喜欢哪个；A/B 无好坏预设。",
        "",
        body,
      ].join("\n"),
      "utf8",
    );
  }
}

/** 断点续跑后从 JSONL 全量重建 r1 盲评配对（跳过的记录不在本进程内存）。 */
function rebuildBlindPairsFromRecords(): BlindPair[] {
  const byId = new Map<string, BlindPair>();
  const lines = readFileSync(records.path, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (record.status === "error" || record.runKey === undefined) continue;
    if (!String(record.runKey).endsWith("/r1")) continue;
    const scenario = PM47_SCENARIOS.find((entry) => entry.id === record.scenarioId);
    if (!scenario) continue;
    const pairId = `${String(record.model)}/${scenario.id}`;
    const existing = byId.get(pairId) ?? {
      pairId,
      model: String(record.model),
      scenarioId: scenario.id,
      title: scenario.title,
      task: scenario.turns.filter((turn) => turn.role === "user").map((turn) => turn.content).join("\n---\n"),
    };
    const merged: BlindPair =
      record.config === "on"
        ? { ...existing, on: String(record.outputText ?? "") }
        : { ...existing, off: String(record.outputText ?? "") };
    byId.set(pairId, merged);
  }
  return [...byId.values()];
}

describe.skipIf(!RUN_ENABLED)("PM47 效果对照评测 harness", () => {
  const scenarios = selectScenarios();
  const contribution = compileFrozenContribution();
  const blindPairs: BlindPair[] = [];
  const blindPairById = new Map<string, BlindPair>();
  const plannedRunKeys: string[] = [];

  beforeAll(async () => {
    modelSet = await createEvalModels({ ledger, mock: EVAL_MOCK });
  }, 120_000);

  afterAll(() => {
    modelSet?.dispose();
    const pairs = [...blindPairs, ...rebuildBlindPairsFromRecords()];
    const deduped = new Map(pairs.map((pair) => [pair.pairId, pair]));
    if (deduped.size > 0) writeBlindMaterials([...deduped.values()]);
    writeFileSync(
      join(artifactsDir("pm47"), "summary.json"),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          subset: SUBSET,
          repeats: REPEATS,
          scenarios: scenarios.length,
          contributionSha256: contribution.contentSha256,
          cost: ledger.summary(),
          note: "只采集与自动检查明细，不设达标阈值（合同 §8 阈值判定归所有者）",
        },
        null,
        2,
      ),
      "utf8",
    );
  });

  it.each([["step-5-preview"], ["step-3.7-flash"]] as const)(
    "PM47 场景矩阵 × %s",
    async (modelKey) => {
      const model = modelSet?.models.find((handle) => handle.key === modelKey);
      if (!model) throw new Error(`模型未就绪: ${modelKey}`);
      const reasoningLevel =
        typeof model.frozenOptions.reasoningLevel === "string" ? model.frozenOptions.reasoningLevel : "medium";
      for (const scenario of scenarios) {
        for (let repeat = 1; repeat <= REPEATS; repeat += 1) {
          for (const config of ["on", "off"] as const) {
            const runKey = `pm47/${modelKey}/${scenario.id}/${config}/r${repeat}`;
            plannedRunKeys.push(runKey);
            if (records.completedKeys().has(runKey)) continue;
            const messages = [
              ...(config === "on" ? [{ role: "system" as const, content: contribution.content }] : []),
              ...scenario.turns.map((turn) => ({ role: turn.role, content: turn.content })),
            ];
            let record: Record<string, unknown>;
            try {
              const result = await model.generateText(
                {
                  messages,
                  ...(scenario.responseSchema ? { responseJsonSchema: scenario.responseSchema } : {}),
                  options: { maxOutputTokens: 2_048, reasoningLevel },
                },
                "pm47-main",
              );
              const keyPointResults = (scenario.keyPoints ?? []).map((point, index) => ({
                point: point.anyOf,
                passed: matchesAnyOf(result.text, point.anyOf),
                index,
              }));
              const schemaResult = scenario.responseSchema
                ? parseAndCheckSchema(result.text, scenario.responseSchema)
                : undefined;
              record = {
                runKey,
                model: modelKey,
                scenarioId: scenario.id,
                klass: scenario.klass,
                config,
                repeat,
                finishReason: result.finishReason,
                outputText: result.text,
                keyPoints: keyPointResults,
                keyPointsPassed: keyPointResults.every((point) => point.passed),
                schemaCheck: schemaResult?.check,
                usage: result.usage,
              };
              if (repeat === 1) {
                const pairId = `${modelKey}/${scenario.id}`;
                const existing = blindPairById.get(pairId) ?? {
                  pairId,
                  model: modelKey,
                  scenarioId: scenario.id,
                  title: scenario.title,
                  task: scenario.turns.filter((turn) => turn.role === "user").map((turn) => turn.content).join("\n---\n"),
                };
                const merged: BlindPair =
                  config === "on" ? { ...existing, on: result.text } : { ...existing, off: result.text };
                if (!blindPairById.has(pairId)) blindPairs.push(merged);
                blindPairById.set(pairId, merged);
              }
            } catch (error) {
              record = { runKey, model: modelKey, scenarioId: scenario.id, config, repeat, status: "error", error: String(error) };
            }
            records.append(record);
          }
        }
      }
      const completed = records.completedKeys();
      for (const runKey of plannedRunKeys) {
        expect(completed, `缺少采集记录 ${runKey}`).toContain(runKey);
      }
    },
    3_600_000,
  );
});
