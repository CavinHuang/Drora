/**
 * 评测模型接入层（specs/drora-persona-system.md §13 第十四批）。
 *
 * 两个实际支持模型的装配（合同 §8，2026-11-02 修订）：
 * - `step-5-preview` 与 `step-3.7-flash`：均经 builtin `stepfun-step-plan` 模板事实
 *   （api-key、anthropic-messages @ https://api.stepfun.com/step_plan、两模型在模板
 *   builtinModelIds 清单内）以手搭 Provider 呈现——真 ProviderRegistry → 真
 *   AiSdkModelAdapter → 真 ApiProviderModelRuntime.modelFactory，与生产同一条 HTTP
 *   解析路径；Key 只从本地 `.env.persona-eval.local` 读取。
 * - GLM-5.3-Flash Coding Plan 为桌面 Host 中介鉴权，headless 不可复用（spec 第十四批
 *   修订记录），本轮不接入。
 * - mock：DRORA_PERSONA_EVAL_MOCK=1 干跑用，零网络。
 *
 * 所有调用统一走 withBackoff（429/5xx/网络瞬态）+ 成本台账逐次记录；reasoning 档位
 * 冻结为 disabled（映射为不发送思考参数，模型默认行为生效）并写入 artifacts。
 */
import type { ModelRequest, ModelResult } from "@drora/contracts";
import { AiSdkModelAdapter } from "@drora/adapters/model";
import {
  ModelConfig,
  ModelInputFormatConfig,
  ModelOptionSpecsConfig,
  ModelOutputFormatConfig,
  ModelPropertiesConfig,
  ProviderRegistry,
  type ModelSelection,
  type Provider,
} from "@drora/provider";
import {
  ApiProviderModelRuntime,
} from "../../../src/app/provider-registry-model-runtime.js";
import { createApiKeyProviderConfig } from "../../provider-config-fixtures.js";
import {
  loadEvalEnvFile,
  withBackoff,
  type CostLedger,
} from "./harness-support.js";

export const STEPFUN_MODEL_KEY = "step-5-preview";
export const FLASH_MODEL_KEY = "step-3.7-flash";
const STEPFUN_BASE_URL_DEFAULT = "https://api.stepfun.com/step_plan";

export type EvalCallPurpose = "pm48-extract" | "pm48-precondition" | "pm47-main" | "connectivity";

export interface EvalModelHandle {
  readonly key: string;
  readonly providerId: string;
  readonly modelId: string;
  /** 冻结参数附录：reasoning 档位与 optionSpecs 摘要。 */
  readonly frozenOptions: Record<string, unknown>;
  generateText(request: ModelRequest, purpose: EvalCallPurpose): Promise<ModelResult>;
}

export interface EvalModelSet {
  readonly models: readonly EvalModelHandle[];
  dispose(): void;
}

const RETRY_OPTIONS = {
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  maxAttempts: 3,
} as const;

function stepFunModelConfig(contextWindow: number): ModelConfig {
  return new ModelConfig({
    enabled: true,
    properties: new ModelPropertiesConfig({
      requiresMfjsToolSchema: false,
      contextWindow,
      inputFormat: new ModelInputFormatConfig({
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      }),
      outputFormat: new ModelOutputFormatConfig({ supportsText: true }),
      supportsToolCall: true,
      supportsJsonSchemaOutput: true,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: true,
    }),
    optionSpecs: new ModelOptionSpecsConfig({
      maxOutputTokens: { max: 1_000_000, map: '{"max_tokens": maxOutputTokens}' },
      reasoningLevel: { values: ["disabled", "low", "medium", "high"], map: "{}" },
    }),
  });
}

function asSelection(providerId: string, modelId: string, reasoningLevel: string): ModelSelection {
  return { providerId, modelId, options: { reasoningLevel } } as unknown as ModelSelection;
}

function wrapWithLedgerAndBackoff(input: {
  readonly key: string;
  readonly generate: (request: ModelRequest) => Promise<ModelResult>;
  readonly ledger: CostLedger;
}): EvalModelHandle["generateText"] {
  return async (request, purpose) => {
    const startedAt = Date.now();
    const result = await withBackoff(() => input.generate(request));
    input.ledger.record({
      model: input.key,
      purpose,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      latencyMs: Date.now() - startedAt,
    });
    return result;
  };
}

function mockModel(key: string, ledger: CostLedger): EvalModelHandle {
  return {
    key,
    providerId: `mock-${key}`,
    modelId: key,
    frozenOptions: { reasoningLevel: "disabled", note: "mock 干跑" },
    generateText: wrapWithLedgerAndBackoff({
      key,
      ledger,
      async generate(request) {
        const schema = request.responseJsonSchema as { properties?: Record<string, unknown> } | undefined;
        const text =
          schema && "drafts" in (schema.properties ?? {})
            ? JSON.stringify({ drafts: [] })
            : "（mock 输出）老黄，这里是干跑占位回复，包含 const/let 与收窄等关键词以走通检查。";
        return {
          text,
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    }),
  };
}

export async function createEvalModels(options: {
  readonly ledger: CostLedger;
  readonly mock: boolean;
}): Promise<EvalModelSet> {
  if (options.mock) {
    return {
      models: [mockModel(STEPFUN_MODEL_KEY, options.ledger), mockModel(FLASH_MODEL_KEY, options.ledger)],
      dispose: () => undefined,
    };
  }

  const evalEnv = { ...loadEvalEnvFile(), ...process.env } as Record<string, string>;
  const stepFunKey = evalEnv.DRORA_PERSONA_EVAL_STEPFUN_API_KEY?.trim();
  if (!stepFunKey) throw new Error("缺少 DRORA_PERSONA_EVAL_STEPFUN_API_KEY（.env.persona-eval.local）");
  const stepFunBaseUrl = evalEnv.DRORA_PERSONA_EVAL_STEPFUN_BASE_URL?.trim() || STEPFUN_BASE_URL_DEFAULT;

  // ── 两模型同端点同 Key（builtin stepfun-step-plan 模板清单内）──
  const modelDefs: ReadonlyArray<{ key: string; contextWindow: number }> = [
    { key: STEPFUN_MODEL_KEY, contextWindow: 1_000_000 },
    { key: FLASH_MODEL_KEY, contextWindow: 256_000 },
  ];
  const providers: Provider[] = modelDefs.map((def) => ({
    providerId: `stepfun-step-plan-eval-${def.key}`,
    config: createApiKeyProviderConfig({
      apiFormat: "anthropic-messages",
      apiKey: stepFunKey,
      baseURL: stepFunBaseUrl,
      models: [def.key],
    }),
    models: [{ modelId: def.key, config: stepFunModelConfig(def.contextWindow) }],
  })) as unknown as Provider[];
  const registry = new ProviderRegistry(providers);
  const adapter = new AiSdkModelAdapter({ env: {}, retry: RETRY_OPTIONS });
  const runtime = new ApiProviderModelRuntime({ registry, modelAdapter: adapter });
  runtime.start();
  const handles: EvalModelHandle[] = modelDefs.map((def) => {
    const model = runtime.modelFactory({
      selection: asSelection(`stepfun-step-plan-eval-${def.key}`, def.key, "disabled"),
    });
    return {
      key: def.key,
      providerId: `stepfun-step-plan-eval-${def.key}`,
      modelId: def.key,
      frozenOptions: {
        baseUrl: stepFunBaseUrl,
        apiType: "anthropic-messages",
        reasoningLevel: "disabled",
        contextWindow: def.contextWindow,
        source: "builtin stepfun-step-plan 模板事实 + 手搭 Provider（评测）",
      },
      generateText: wrapWithLedgerAndBackoff({
        key: def.key,
        ledger: options.ledger,
        generate: (request) => model.generateText(request),
      }),
    };
  });

  return {
    models: handles,
    dispose: () => runtime.dispose(),
  };
}
