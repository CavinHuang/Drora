/** Isolated real-engine writer paused before Vault IO, controlled through IPC. */
import { dirname } from "node:path";
import { setDataBaseDir } from "../../src/paths.js";
import { createKnowledgeServices } from "../../src/knowledge/knowledgeServices.js";

const [databasePath, pluginDataDir, proposalId, operationId, action] = process.argv.slice(2);
if (
  !databasePath ||
  !pluginDataDir ||
  !proposalId ||
  !operationId ||
  !["apply", "undo"].includes(action ?? "")
) {
  throw new Error("Missing isolated writer arguments");
}
setDataBaseDir(dirname(databasePath));
const services = createKnowledgeServices({
  databasePath,
  pluginDataDir,
  reviewWritePathEnabled: true,
  reviewWriteSafetyGatePassed: true,
  reviewBeforeFileMutationForTest: async () => {
    const resume = new Promise<void>((resolve) => {
      process.once("message", () => resolve());
    });
    process.send?.("ready");
    await resume;
  },
});
try {
  const result =
    action === "apply"
      ? await services.reviewService.applyProposal({ proposalId, operationId })
      : await services.reviewService.undoOperation({ operationId });
  process.send?.({ outcome: result.outcome });
} finally {
  services.dispose();
  process.disconnect?.();
}
