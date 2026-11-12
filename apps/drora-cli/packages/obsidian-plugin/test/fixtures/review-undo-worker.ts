// 迁自 packages/services/test/fixtures/review-undo-worker.ts @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：随 knowledge 测试迁入
// 插件包；除本头注释与导入重指（../../src/... → ../../src/server/...）外与 HEAD
// 逐字节等价。
/**
 * Real OS-process contender for the L2 undo ownership test.
 * Test-only S03 override; never invoked by the desktop production host.
 */
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setDataBaseDir } from "../../src/server/platform/dataPaths.js";
import { createKnowledgeServices } from "../../src/server/knowledge/knowledgeServices.js";

const [databasePath, pluginDataDir, operationId, outputPath] = process.argv.slice(2);
if (!databasePath || !pluginDataDir || !operationId || !outputPath) {
  throw new Error("Missing undo-worker arguments");
}
setDataBaseDir(dirname(dirname(databasePath)));
const services = createKnowledgeServices({
  databasePath,
  pluginDataDir,
  reviewWritePathEnabled: true,
  reviewWriteSafetyGatePassed: true,
});
try {
  const result = await services.reviewService.undoOperation({ operationId });
  await writeFile(
    outputPath,
    JSON.stringify({ outcome: result.outcome, reason: result.reason }),
    "utf-8",
  );
} finally {
  services.dispose();
}
