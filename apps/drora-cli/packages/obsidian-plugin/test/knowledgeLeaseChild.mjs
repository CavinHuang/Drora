// 迁自 packages/services/test/knowledgeLeaseChild.mjs @ bf872a6c0（specs/
// obsidian-vault-phase2-true-extraction.md §1-C10、§10-P3：测试随实现迁入插件包，
// node:test/vitest 直连插件 server 模块（迁后路径）。除本头注释与导入重指
// （../src/knowledge|obsidian-vault|paths → ../src/server/... 同深度镜像）外与 HEAD
// 逐字节等价。原 services/test 文件随迁删除（本体实现在 P7 拆除，测试归属插件侧）。
/**
 * 子进程：以独立 OS 进程身份持有 knowledge-index 租约（A05 双真实 Host 竞争）。
 * 由 knowledgeLeaseFencing.test.ts 通过 `node --import tsx` spawn。
 * 输出协议：ACQUIRED <fence> / REJECTED <fence>；被硬杀时不释放租约。
 */
import { openKnowledgeDatabase } from "../src/server/knowledge/store/knowledgeDatabase.js";
import {
  acquireIndexLease,
  heartbeatIndexLease,
  KNOWLEDGE_INDEX_LEASE_NAME,
} from "../src/server/knowledge/store/indexLease.js";

const [dbPath, owner, ttlMsArg] = process.argv.slice(2);
if (!dbPath || !owner) {
  console.error("usage: child <dbPath> <owner> <ttlMs>");
  process.exit(2);
}
const ttlMs = Number(ttlMsArg ?? "1200");
const db = openKnowledgeDatabase(dbPath);
const result = acquireIndexLease(db, KNOWLEDGE_INDEX_LEASE_NAME, owner, ttlMs, Date.now());
if (!result.acquired) {
  console.log(`REJECTED ${result.fence}`);
  process.exit(3);
}
console.log(`ACQUIRED ${result.fence}`);
// 心跳维持租约；进程被 SIGKILL/TerminateProcess 时租约原地保留（死亡检测只能靠 TTL）。
const heartbeat = setInterval(
  () => {
    heartbeatIndexLease(db, KNOWLEDGE_INDEX_LEASE_NAME, owner, result.fence, ttlMs, Date.now());
  },
  Math.max(50, Math.floor(ttlMs / 6)),
);
heartbeat.unref?.();
setInterval(() => {}, 1000); // keep-alive：等待父进程硬杀。
