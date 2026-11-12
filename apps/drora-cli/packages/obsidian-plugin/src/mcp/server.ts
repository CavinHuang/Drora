/**
 * obsidian 插件 `knowledge` MCP server——Server 接线与 stdio 生命周期
 * （specs/obsidian-vault-phase2-true-extraction.md §3 插件宿主服务进程、§10-P3）。
 *
 * 形态：stdio MCP server（manifest mcpServers.knowledge；宿主经 g1 appService 常驻拉起
 * 或会话级 MCP client 直连），进程内直连迁入的知识栈（src/server/knowledge + vault），
 * 不再经 drora-protocol 反向请求（§4）。
 * - 工具面 = 四服务 RPC 面 1:1 重暴露 + offset/limit 分页（注册表在 ./tools.ts；
 *   onRunUpdated → `vault://runs/{runId}` 资源订阅 + get_run 全量拉取兜底）；
 *   P4（§4/§10-P4）追加 agent 工具面 vault_search/vault_neighbors（./agent-tools.ts，
 *   C8 契约随迁 + evidence 工具内复验；D15 随 server alwaysLoad 常驻首发）；
 * - 数据路径按 D14 状态机（platform/dataPaths）：dual_db_conflict 拒绝启动数据面，
 *   全部数据工具返回结构化冲突状态；P6 起首启自动搬迁（§5，platform/
 *   knowledgeMigration）：legacy 态进入 migrating（数据面拒绝）→ 搬迁收敛后原位
 *   切换 plan/dataPlane（completed→plugin 态；blocked/failed→legacy 原件继续服务）。
 * 拆分说明（P3 第 2 次尝试）：工具注册表移 ./tools.ts 以满足 managed 模块 800 行上限，
 * 本文件只保留 Server 构造/资源订阅接线/进程生命周期。
 */
import { Server } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { agentTools } from "./agent-tools.js";
import {
  ALL_TOOLS,
  buildDataPlane,
  conflictPayload,
  DualDbConflictError,
  migratingPayload,
  MigrationPendingError,
  toolInputSchema,
  RUN_RESOURCE_PREFIX,
  RUN_URI_TEMPLATE,
  type ToolContext,
} from "./tools.js";
import { resolveKnowledgeDataPlan } from "../server/platform/dataPaths.js";
import {
  migrateLegacyKnowledgeData,
  type KnowledgeMigrationOutcome,
} from "../server/platform/knowledgeMigration.js";
// P5（§2/§10-P5）：面板页面 + 只读数据端点（resources/read，无审批——见 uiResources.ts 文件头）。
import { readUiResource, uiPanelListEntry } from "./uiResources.js";

/** 与包/manifest/官方定义三处版本保持一致（0.4.0，B2 演进注释见 official-plugin-definitions.ts）。 */
export const KNOWLEDGE_SERVER_VERSION = "0.4.0";

/**
 * 完整工具面（P4，§4/§10-P4）：四服务 1:1 面（tools.ts，52 件）+ agent 工具面
 * （agent-tools.ts 的 vault_search/vault_neighbors，C8 契约随迁 + evidence 工具内
 * 复验）= 54 件。合并在此装配点而非 tools.ts 内互相 import，保持 agent-tools →
 * tools 的单向依赖（运行时环为零）。
 */
const SERVER_TOOLS = [...ALL_TOOLS, ...agentTools];

const SERVER_INSTRUCTIONS = [
  "Obsidian Vault 知识服务（specs/obsidian-vault-phase2-true-extraction.md §3/§4）：",
  "vault_* 为 Vault 门面（读/写经安全不变量），knowledge_index_*/knowledge_query_* 为索引与检索，",
  "knowledge_review_* 为 L2 审核治理写；vault_search/vault_neighbors 为 agent 检索工具（结果内嵌",
  "evidence 复验状态）。列表与读取类工具带 offset/limit 分页；",
  "run 进度可订阅 vault://runs/{runId} 资源或用 knowledge_query_get_run 全量拉取。",
].join("\n");

export interface KnowledgeMcpServerHandle {
  server: Server;
  /**
   * 数据面后置装配（P6 首启搬迁收敛）后补挂 onRunUpdated → updated 推送；幂等
   * （构造期数据面已在位则立即挂，搬迁完成后再调一次空转）。
   */
  attachRunEvents(): void;
}

export function createKnowledgeMcpServer(context: ToolContext): KnowledgeMcpServerHandle {
  const server = new Server(
    { name: "knowledge", version: KNOWLEDGE_SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        // onRunUpdated → 资源订阅（§3 映射；SDK 原生 subscribe/unsubscribe + updated 通知）。
        resources: { subscribe: true },
      },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.setRequestHandler("tools/list", async () => ({
    tools: SERVER_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      // zod v4 toJSONSchema 产 draft-7 对象 schema；SDK 的窄类型在此处收敛（io 合法性
      // 由 SDK 侧校验，转换失败会在构造期抛出而非静默）。
      inputSchema: toolInputSchema(tool.schema) as { type: "object"; [key: string]: unknown },
    })),
  }));

  server.setRequestHandler("tools/call", async (request) => {
    const name = request.params.name;
    const tool = SERVER_TOOLS.find((candidate) => candidate.name === name);
    if (tool === undefined) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: `unknown tool: ${name}` }) }],
      };
    }
    const rawArgs =
      request.params.arguments !== undefined && request.params.arguments !== null
        ? (request.params.arguments as Record<string, unknown>)
        : {};
    try {
      const parsed = tool.schema.parse(rawArgs);
      const result = await tool.handler(parsed as Record<string, unknown>, context);
      return { content: [{ type: "text" as const, text: JSON.stringify(result ?? null) }] };
    } catch (error) {
      // D14 冲突与 §5 迁移门同为结构化拒绝：isError 携带事实载荷，调用方可机读。
      if (error instanceof DualDbConflictError || error instanceof MigrationPendingError) {
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(error.payload) }] };
      }
      // 业务错如实携带 message（服务面结构化错误语义保持；参数错带 zod 摘要）。
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: message }) }],
      };
    }
  });

  // ── run 更新流资源（§3：onRunUpdated → vault://runs/{runId} 订阅 + 全量拉取兜底）──
  const subscriptions = new Set<string>();

  server.setRequestHandler("resources/templates/list", async () => ({
    resourceTemplates: [
      {
        uriTemplate: RUN_URI_TEMPLATE,
        name: "Knowledge run 更新流",
        description: "订阅检索 run 进度（增量通知；knowledge_query_get_run 全量拉取兜底/轮询降级）。",
        mimeType: "application/json",
      },
    ],
  }));

  server.setRequestHandler("resources/list", async () => ({
    // 静态列表面板本体（宿主 surface 启动与页面自举可发现）；run 实例资源由订阅派生。
    resources: [
      uiPanelListEntry(),
      ...[...subscriptions].sort().map((uri) => ({
        uri,
        name: `Knowledge run ${uri.slice(RUN_RESOURCE_PREFIX.length)}`,
        mimeType: "application/json",
      })),
    ],
  }));

  server.setRequestHandler("resources/read", async (request) => {
    const uri = request.params.uri;
    // P5 UI 资源面先行分发：panel 本体不依赖数据面（conflict 态页面要能打开呈现冲突），
    // 数据端点在 readUiResource 内自行封套 conflict；返回 null 落回既有 run 资源分支。
    const uiContents = await readUiResource(uri, context);
    if (uiContents !== null) return { contents: uiContents };
    if (context.dataPlane === null) {
      // 数据面不可用（D14 冲突 / §5 迁移门）按当前事实给结构化载荷。
      throw new Error(
        JSON.stringify(
          context.plan.mode === "dual_db_conflict"
            ? conflictPayload(context.plan)
            : migratingPayload({ phase: context.migration?.phase ?? "running" }),
        ),
      );
    }
    if (!uri.startsWith(RUN_RESOURCE_PREFIX)) {
      throw new Error(`unknown resource: ${uri}`);
    }
    const runId = uri.slice(RUN_RESOURCE_PREFIX.length);
    const run = await context.dataPlane.services.queryService.getRun({ runId });
    if (run === null) {
      throw new Error(`run not found: ${runId}`);
    }
    return {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(run) }],
    };
  });

  server.setRequestHandler("resources/subscribe", async (request) => {
    const uri = request.params.uri;
    if (typeof uri !== "string" || !uri.startsWith(RUN_RESOURCE_PREFIX)) {
      throw new Error(`unknown resource: ${String(uri)}`);
    }
    subscriptions.add(uri);
    return {};
  });

  server.setRequestHandler("resources/unsubscribe", async (request) => {
    subscriptions.delete(request.params.uri);
    return {};
  });

  let runEventsAttached = false;
  const attachRunEvents = (): void => {
    if (runEventsAttached || context.dataPlane === null) return;
    runEventsAttached = true;
    // 增量通知：run 事件（runGeneration+seq 递增）→ 已订阅 URI 的 updated 通知。
    context.dataPlane.services.queryService.onRunUpdated((event) => {
      const uri = `${RUN_RESOURCE_PREFIX}${event.runId}`;
      if (subscriptions.has(uri)) {
        void server.sendResourceUpdated({ uri }).catch(() => undefined);
      }
    });
  };
  attachRunEvents();

  return { server, attachRunEvents };
}

/**
 * 首启自动搬迁编排（§5/§10-P6，仅 legacy 态进入）。结局收敛规则：
 * - completed → 重解析 plugin 态并装配数据面（本进程内完成搬迁→直接服务新路径）；
 * - blocked_active_writer / blocked_busy / failed → 原件在旧路径且旧窗口仍可能持有 →
 *   legacy 数据面继续服务（DB fence 仲裁），migration 状态携带结构化原因；
 * - blocked_concurrent → 对端实例搬迁中：短轮询重试（对端完成后重解析即 plugin 态）；
 *   超时仍收敛不了则数据面保持拒绝（不建 legacy——防惰性开库在旧路径造空库引发
 *   dual_db_conflict，见 knowledgeMigration.ts 文件头已知边界）。
 */
/** 按文件系统现势重解析并装配数据面（conflict 态保持拒绝；搬迁收敛路径共用）。 */
function attachResolvedDataPlane(context: ToolContext): void {
  const fresh = resolveKnowledgeDataPlan();
  context.plan = fresh;
  context.dataPlane =
    fresh.mode === "dual_db_conflict" ? null : buildDataPlane(fresh);
}

async function runStartupMigration(
  context: ToolContext,
  onSettled: () => void,
): Promise<void> {
  const plan = context.plan;
  if (plan.mode !== "legacy") return;
  const attemptOnce = async (): Promise<KnowledgeMigrationOutcome | null> => {
    const fresh = resolveKnowledgeDataPlan();
    if (fresh.mode !== "legacy") {
      // 对端实例已完成搬迁（或两库并存）：按文件系统事实收敛，不再搬。
      context.plan = fresh;
      context.migration = null;
      context.dataPlane = fresh.mode === "dual_db_conflict" ? null : buildDataPlane(fresh);
      return null;
    }
    return migrateLegacyKnowledgeData(fresh);
  };
  let outcome = await attemptOnce();
  // blocked_concurrent 短轮询：500ms × 30 = 最长 ~15s 等待对端搬迁收敛。
  for (let attempt = 0; outcome?.phase === "blocked_concurrent" && attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    outcome = await attemptOnce();
  }
  if (outcome === null) {
    onSettled();
    return;
  }
  switch (outcome.phase) {
    case "completed": {
      // 搬迁完成：重解析（应 plugin）并装配新路径数据面。
      attachResolvedDataPlane(context);
      context.migration = { phase: "completed", movedFiles: outcome.movedFiles };
      onSettled();
      return;
    }
    case "blocked_active_writer":
      context.migration = {
        phase: outcome.phase,
        reason: outcome.reason,
        ...(outcome.ownerPids.length > 0 ? { ownerPids: outcome.ownerPids } : {}),
      };
      // 原件在位且旧窗口持有它：继续用旧路径（与旧窗口经 DB fence 仲裁，§3/g8）。
      attachResolvedDataPlane(context);
      onSettled();
      return;
    case "blocked_busy":
    case "failed":
      // 原件已回退保留：legacy 数据面继续服务，migration 状态携带结构化原因。
      context.migration = { phase: outcome.phase, reason: outcome.reason };
      attachResolvedDataPlane(context);
      onSettled();
      return;
    case "blocked_concurrent":
      // 轮询超时：保持数据面拒绝（结构化 migrating/blocked 载荷如实呈现）。
      context.migration = { phase: outcome.phase, reason: outcome.reason };
      return;
  }
}

/** 宿主入口：按 D14 状态机构造数据面并常驻服务 stdio（g1 appService/会话级 MCP 共用）。 */
export async function main(): Promise<void> {
  process.title = "drora-obsidian-knowledge-mcp";
  const plan = resolveKnowledgeDataPlan();
  // P6：legacy 态先不建数据面（搬迁收敛后再装配），期间工具面返回 §5 migrating 状态；
  // conflict 态数据面保持 null；plugin 态直接装配。context 是共享可变对象，搬迁完成后
  // 原位切换 plan/dataPlane/migration 三元组，请求处理器读到的始终是最新事实。
  const context: ToolContext = {
    dataPlane: plan.mode === "legacy" ? null : plan.mode === "plugin" ? buildDataPlane(plan) : null,
    plan,
    migration: plan.mode === "legacy" ? { phase: "running" } : null,
  };
  let mcp: KnowledgeMcpServerHandle | undefined;
  const handle = serveStdio(() => {
    mcp = createKnowledgeMcpServer(context);
    return mcp.server;
  }, { legacy: "reject" });
  if (plan.mode === "legacy") {
    void runStartupMigration(context, () => mcp?.attachRunEvents()).catch((error) => {
      // 搬迁编排自身的意外错误：回退为 failed 语义（legacy 数据面继续服务），不让
      // uncaughtException 路径杀掉常驻进程。
      context.migration = {
        phase: "failed",
        reason: `搬迁编排异常: ${error instanceof Error ? error.message : String(error)}`,
      };
      try {
        attachResolvedDataPlane(context);
        mcp?.attachRunEvents();
      } catch {
        // 装配失败保持数据面拒绝（fail-closed）。
      }
    });
  }
  let shutdownStarted = false;
  const shutdown = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    // dispose：停 run 事件流/autoReconcile 定时器 → 释放租约（TTL 兜底）→ 关 DB。
    try {
      context.dataPlane?.services.dispose();
    } catch {
      // 关闭链错误不阻塞进程退出；租约由 DB 级 TTL 兜底回收（§5e.6）。
    }
    void handle
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("uncaughtException", (error) => {
    process.stderr.write(`[knowledge-server] uncaught: ${String(error)}\n`);
    shutdown();
  });
}

// 直跑入口判定（node-repl-host process-lifecycle.isDirectMcpEntrypoint 同款）：模块
// file URL 与 argv[1] realpath 相等才启动。早前用 endsWith("server.ts") 判定，esbuild
// 产物是 dist/mcp/server.js——argv 不命中、main 从未执行，stdio 客户端握死（P3 冒烟
// 实证修复原因）。realpath 同时兼容 /tmp→/private/tmp 与 symlink 安装目录。
async function isDirectMcpEntrypoint(importMetaUrl: string): Promise<boolean> {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  try {
    const { realpath } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const [modulePath, executablePath] = await Promise.all([
      realpath(fileURLToPath(importMetaUrl)),
      realpath(argvPath),
    ]);
    return modulePath === executablePath;
  } catch {
    return false;
  }
}

if (await isDirectMcpEntrypoint(import.meta.url)) {
  void main();
}
