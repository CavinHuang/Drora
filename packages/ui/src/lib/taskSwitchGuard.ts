import type { ModelSwitchStage } from "@/store/droraSessionStoreTypes.js";

export function shouldBlockTaskSelectionDuringModelRestart(
  modelSwitchPending: boolean,
  modelSwitchStage: ModelSwitchStage,
): boolean {
  return modelSwitchPending && modelSwitchStage === "restartingRuntime";
}
