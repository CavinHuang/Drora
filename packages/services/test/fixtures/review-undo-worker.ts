/**
 * Real OS-process contender for the L2 undo ownership test.
 * Test-only S03 override; never invoked by the desktop production host.
 */
import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setDataBaseDir } from "../../src/paths.js";
import { createKnowledgeServices } from "../../src/knowledge/knowledgeServices.js";

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
  await writeFile(outputPath, JSON.stringify({ outcome: result.outcome, reason: result.reason }), "utf-8");
} finally {
  services.dispose();
}
