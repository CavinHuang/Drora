import type { TuiSubmitPromptResult } from "@drora/tui";
import { parseModelPickerValue, type ModelSelection } from "@drora/shared/model-selection";
import { listAppEffortOptions } from "../effort-options.js";
import { rememberCurrentModelSelection } from "../model-selection.js";
import type { CommandCenterDeps, CommandCenterModelOption } from "../types.js";

export async function handleModelCommand(
  args: string,
  deps: CommandCenterDeps,
  selectedRef?: ModelSelection,
): Promise<TuiSubmitPromptResult> {
  const app = await deps.getApp();
  const current = app.getModel?.();
  const options = app.listModels ? await app.listModels() : undefined;

  if (!app.getModel || !app.listModels || !app.setModel || !options) {
    return {
      mode: deps.getMode?.(),
      response: "Model selection is not available in this client.",
    };
  }

  if (!selectedRef && (args.length === 0 || args === "list")) {
    const effortOptions = await listAppEffortOptions(app);
    return {
      ...(effortOptions ? { effortOptions } : {}),
      mode: deps.getMode?.(),
      model: current,
      modelOptions: options,
      response: formatModelList(current, options),
      thoughtLevel: app.getThoughtLevel?.(),
    };
  }

  try {
    // /model main（官方 i9a/h$o 同款语义）：保留当前会话的模型选择，仅把推理档重置为
    // 该模型目录默认值。经 selectedRef 通道送入解析器可复用现有校验与默认档回落
    // （requested 无 options 时取 option.reasoning.defaultLevel，即官方 h$o 的重置语义）。
    const trimmed = args.trim();
    const mainRef =
      !selectedRef && trimmed === "main" ? app.getCurrentModelOption?.()?.ref : undefined;
    if (!selectedRef && trimmed === "main" && !mainRef) {
      throw new Error("main requires an active model selection. Use /model provider/model.");
    }
    const selection = resolveTuiModelSelection(args, options, selectedRef ?? mainRef);
    const result = await app.setModel(selection);
    const persistenceWarning = await rememberCurrentModelSelection(app, deps);
    const effortOptions = await listAppEffortOptions(app);
    return {
      ...(effortOptions ? { effortOptions } : {}),
      mode: deps.getMode?.(),
      model: result.model,
      modelOptions: options,
      loginRequired: false,
      response: `Model switched to ${result.model} (${selection.options!.reasoningLevel}).${persistenceWarning}`,
      thoughtLevel: result.thoughtLevel ?? app.getThoughtLevel?.(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      mode: deps.getMode?.(),
      response: `Unable to switch model: ${message}`,
      model: current,
      modelOptions: options,
      thoughtLevel: app.getThoughtLevel?.(),
    };
  }
}

/** A deliberate new selection uses the catalog default; restored selections never pass here. */
function resolveTuiModelSelection(
  args: string,
  options: readonly CommandCenterModelOption[],
  selectedRef?: ModelSelection,
): ModelSelection {
  // Exact catalog matching preserves literal slashes and dollar signs in model IDs.
  const requested =
    selectedRef ??
    options.find((option) => `${option.ref.providerId}/${option.ref.modelId}` === args)?.ref ??
    parseModelPickerValue(args);
  const option = options.find(
    ({ ref }) => ref.providerId === requested.providerId && ref.modelId === requested.modelId,
  );
  if (!option) throw new Error(`Model is not available: ${args}`);
  if (option.disabledReason) throw new Error(option.disabledReason);
  const reasoningLevel = requested.options?.reasoningLevel ?? option.reasoning?.defaultLevel;
  if (
    !reasoningLevel ||
    !option.reasoning?.levels.some((level) => level.value === reasoningLevel)
  ) {
    throw new Error(
      `Select a supported reasoning effort: ${option.reasoning?.levels.map((level) => level.value).join(", ") || "none available"}`,
    );
  }
  return {
    providerId: requested.providerId,
    modelId: requested.modelId,
    options: { reasoningLevel },
  };
}

function formatModelList(current: string | undefined, options: CommandCenterModelOption[]): string {
  const currentLine = `Current model: ${current || "not selected"}.`;
  if (options.length === 0) {
    return `${currentLine}\nNo selectable models are configured.`;
  }

  const lines = options.map((option) => {
    const id = `${option.ref.providerId}/${option.ref.modelId}`;
    const provider = option.providerLabel ?? option.ref.providerId;
    const disabled = option.disabledReason ? ` — ${option.disabledReason}` : "";
    return `- ${id} (${option.label}; ${provider})${disabled}`;
  });

  return [
    currentLine,
    "Available models:",
    ...lines,
    "Use /model <provider/model> to select a model, then /effort <level> to change reasoning effort.",
  ].join("\n");
}
