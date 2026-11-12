// 迁自 packages/services/test/fixtures/review-live-worker.ts @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：随 knowledge 测试迁入
// 插件包；除本头注释与导入重指（../../src/... → ../../src/server/...）外与 HEAD
// 逐字节等价。
/** Isolated real-engine writer paused before Vault IO, controlled through IPC. */
import { dirname } from "node:path";
import { setDataBaseDir } from "../../src/server/platform/dataPaths.js";
import { createKnowledgeServices } from "../../src/server/knowledge/knowledgeServices.js";

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
