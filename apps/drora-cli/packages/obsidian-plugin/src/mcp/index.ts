/**
 * obsidian-plugin-server 模块公开入口（architecture-governance managed 模块
 * publicEntrypoints 锚点；specs/obsidian-vault-phase2-true-extraction.md §10-P3）。
 *
 * 模块 = 插件宿主服务进程的全部实现（src/mcp MCP 工具面 + src/server 迁入的
 * knowledge 栈与 vault 门面）。跨模块消费只允许经本入口与 contract.ts；四服务
 * 接口与 MCP 映射的逐项契约见 docs/knowledge-mcp-mapping.md（P3 交付物）。
 */
export {
  createKnowledgeMcpServer,
  main as startKnowledgeMcpServer,
  KNOWLEDGE_SERVER_VERSION,
} from "./server.js";
export { buildDataPlane, ALL_TOOLS, type ToolContext } from "./tools.js";
export { resolveKnowledgeDataPlan } from "../server/platform/dataPaths.js";
export type { KnowledgeDataPlan } from "../server/platform/dataPaths.js";
