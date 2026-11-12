/**
 * knowledge MCP server 工具注册表（specs/obsidian-vault-phase2-true-extraction.md
 * §3「UI 服务面→MCP 映射」；映射清单逐项对验收见 docs/knowledge-mcp-mapping.md）。
 *
 * 拆分史（均因 architecture:check 的 managed 模块 max-file-lines 上限 800 行，
 * 纯机械搬移、注册表内容与行为零变化，拆分后 MCP 冒烟测试复跑验证）：
 * - P3 第 2 次尝试（2026-11-12）：原 server.ts 单文件 983 行超限 → 拆出本文件
 *   （工具注册表）+ server.ts（接线/stdio 生命周期）。
 * - P7 第 2 次尝试（2026-11-12）：本文件 830 行超限（后续批次在注册表内追加了
 *   工具条目）→ vault 门面工具组（vaultTools）拆出 tools-vault.ts。
 * - P6（2026-11-12，gate 拦路缺陷就地修复）：P7 拆分把共享骨架留在本文件形成
 *   tools.ts ↔ tools-vault.ts 模块环，src 直连导入（node:test/tsx ESM 求值）TDZ
 *   崩溃（bundle 被 esbuild 摊平掩蔽）→ 骨架移 tool-shared.ts，本文件保留数据面
 *   装配 + index/query/review/status 四组注册表，并再导出骨架维持既有导入面。
 */
import { z } from "zod";
import { createKnowledgeServices } from "../server/knowledge/knowledgeServices.js";
import { createLocalEmbeddingPort } from "../server/knowledge/search/localEmbeddingPort.js";
import { isReleasedReviewWriteAuthority } from "../server/knowledge/review/reviewReleasePolicy.js";
import { createObsidianVaultService } from "../server/vault/obsidianVaultService.js";
import type { KnowledgeDataPlan } from "../server/platform/dataPaths.js";
import { vaultTools } from "./tools-vault.js";
import {
  conflictPayload,
  migratingPayload,
  pagingSchema,
  paginate,
  requireDataPlane,
  type KnowledgeServerDataPlane,
  type ToolSpec,
} from "./tool-shared.js";

// 骨架单一出处移至 tool-shared.ts（消环，见文件头）；再导出维持既有消费方导入面。
export {
  READ_FILE_DEFAULT_CHARS,
  READ_FILE_MAX_CHARS,
  conflictPayload,
  migratingPayload,
  requireDataPlane,
  pagingSchema,
  paginate,
  DualDbConflictError,
  MigrationPendingError,
} from "./tool-shared.js";
export type {
  KnowledgeMigrationState,
  KnowledgeServerDataPlane,
  Page,
  ToolContext,
  ToolHandler,
  ToolSpec,
} from "./tool-shared.js";

export function buildDataPlane(plan: KnowledgeDataPlan & { mode: "legacy" | "plugin" }): KnowledgeServerDataPlane {
  // 本地语义端口随库同侧（§5：模型根数据根口径随迁移进插件目录；onnxruntime-node
  // 动态 import 缺模块降级语义原样——插件自带确定性子树后正常态可加载）。
  const embeddingPort = createLocalEmbeddingPort({ modelRoot: plan.modelRoot });
  return {
    services: createKnowledgeServices({
      databasePath: plan.databasePath,
      pluginDataDir: plan.pluginDataDir,
      embeddingPort,
      // §5b.8 两触发点语义原样（装配后延迟一次 + search TTL；fs watcher 明确不迁）。
      autoIndexEnabled: true,
      // D5：reviewReleasePolicy GO 门随 review 栈迁插件，writePathEnabled 门语义原样。
      // 插件 server 只在 desktop-local host 语境被拉起（P1-②：server/stdio host 不装配
      // appService），按同函数传 desktop-local。
      reviewWriteSafetyGatePassed: isReleasedReviewWriteAuthority("desktop-local"),
    }),
    vault: createObsidianVaultService({ pluginDataDir: plan.pluginDataDir }),
  };
}

const indexTools: ToolSpec[] = [
  {
    name: "knowledge_index_get_status",
    description: "索引状态（源指纹/coverage/job/lease/semantic；锚点 IKnowledgeIndexService.getStatus）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) => requireDataPlane(context).services.indexService.getStatus(),
  },
  {
    name: "knowledge_index_get_insights",
    description: "洞察快照（§5g；锚点 IKnowledgeIndexService.getInsights）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) => requireDataPlane(context).services.indexService.getInsights(),
  },
  {
    name: "knowledge_index_refresh_decision_config",
    description: "配置热刷新（Jev/语义端口；锚点 IKnowledgeIndexService.refreshDecisionConfig）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) =>
      requireDataPlane(context).services.indexService.refreshDecisionConfig(),
  },
  {
    name: "knowledge_index_test_jev_connection",
    description: "Jev 连接探测（插件侧 D8 静态化接线前恒为「配置未完成」；锚点 IKnowledgeIndexService.testJevConnection）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) =>
      requireDataPlane(context).services.indexService.testJevConnection(),
  },
  {
    name: "knowledge_index_get_semantic_status",
    description: "本地语义端口状态（锚点 IKnowledgeIndexService.getSemanticStatus）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) =>
      requireDataPlane(context).services.indexService.getSemanticStatus(),
  },
  {
    name: "knowledge_index_download_semantic_model",
    description: "手动触发 bge 模型下载（首用下载落插件数据目录语义原样；锚点 IKnowledgeIndexService.downloadSemanticModel）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) =>
      requireDataPlane(context).services.indexService.downloadSemanticModel(),
  },
  {
    name: "knowledge_index_start_reconcile",
    description: "触发增量 reconcile 索引作业（锚点 IKnowledgeIndexService.startReconcile）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) =>
      requireDataPlane(context).services.indexService.startReconcile(),
  },
  {
    name: "knowledge_index_request_rebuild",
    description: "触发全量重建索引作业（锚点 IKnowledgeIndexService.requestRebuild）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) =>
      requireDataPlane(context).services.indexService.requestRebuild(),
  },
  {
    name: "knowledge_index_cancel_job",
    description: "取消索引作业（锚点 IKnowledgeIndexService.cancelJob）。",
    schema: z.object({ jobId: z.string().min(1) }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.indexService.cancelJob(z.object({ jobId: z.string().min(1) }).parse(args ?? {})),
  },
];

const queryTools: ToolSpec[] = [
  {
    name: "knowledge_query_create_run",
    description: "创建检索 run（锚点 IKnowledgeQueryService.createRun）。",
    schema: z.object({
      query: z.string().min(1),
      /** 客户端幂等键：同键重复 createRun 返回同一 run（防双击/重试双跑）。 */
      clientRequestId: z.string().min(1),
      sessionId: z.string().optional(),
    }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.queryService.createRun(
        z.object({ query: z.string().min(1), clientRequestId: z.string().min(1), sessionId: z.string().optional() }).parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_query_search",
    description: "执行检索并返回 run 视图（锚点 IKnowledgeQueryService.search）。",
    schema: z
      .object({
        runId: z.string().min(1),
        decisionConsentId: z.string().optional(),
      })
      .passthrough(),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.queryService.search(
        z.object({ runId: z.string().min(1) }).passthrough().parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_query_neighbors",
    description: "笔记近邻（chunk_vectors 余弦；锚点 IKnowledgeQueryService.neighbors）。",
    schema: z.object({ notePath: z.string().min(1), limit: z.number().int().min(1).max(10).optional() }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.queryService.neighbors(
        z.object({ notePath: z.string().min(1) }).passthrough().parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_query_grant_decision_consent",
    description: "授予决策授权（锚点 IKnowledgeQueryService.grantDecisionConsent）。",
    schema: z.object({ runId: z.string().min(1), candidateIds: z.array(z.string()).optional() }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.queryService.grantDecisionConsent(
        z.object({ runId: z.string().min(1) }).passthrough().parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_query_revoke_decision_consent",
    description: "撤销决策授权（锚点 IKnowledgeQueryService.revokeDecisionConsent）。",
    schema: z.object({ consentId: z.string().min(1) }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.queryService.revokeDecisionConsent(
        z.object({ consentId: z.string().min(1) }).parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_query_get_run",
    description: "全量拉取 run 视图（订阅通知后的兜底拉取与 offset 轮询降级入口；锚点 IKnowledgeQueryService.getRun）。",
    schema: z.object({ runId: z.string().min(1) }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.queryService.getRun(z.object({ runId: z.string().min(1) }).parse(args ?? {})),
  },
  {
    name: "knowledge_query_cancel_run",
    description: "取消 run（锚点 IKnowledgeQueryService.cancelRun）。",
    schema: z.object({ runId: z.string().min(1) }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.queryService.cancelRun(z.object({ runId: z.string().min(1) }).parse(args ?? {})),
  },
  {
    name: "knowledge_query_prepare_evidence",
    description: "准备证据 receipt（锚点 IKnowledgeQueryService.prepareEvidence）。",
    schema: z.object({ runId: z.string().min(1), articleId: z.string().min(1) }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.queryService.prepareEvidence(
        z.object({ runId: z.string().min(1), articleId: z.string().min(1) }).parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_query_resolve_citation",
    description: "复验引用 receipt（g9 citation openWith 后面板内解析入口；锚点 IKnowledgeQueryService.resolveCitation）。",
    schema: z.object({ receiptId: z.string().min(1), sessionId: z.string().optional() }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.queryService.resolveCitation(
        z.object({ receiptId: z.string().min(1), sessionId: z.string().optional() }).parse(args ?? {}),
      ),
  },
];

const reviewTools: ToolSpec[] = [
  {
    name: "knowledge_review_create_proposal",
    description: "创建审核提案（L2 治理写唯一入口；锚点 IKnowledgeReviewService.createProposal）。",
    schema: z.object({
      title: z.string().min(1),
      reason: z.string().min(1),
      evidence: z
        .array(
          z.object({
            receiptId: z.string().optional(),
            note: z.string().optional(),
          }),
        )
        .optional(),
      changes: z.array(
        z.object({
          kind: z.enum(["create", "write", "delete"]),
          relativePath: z.string().min(1),
          baseSha256: z.string().nullable().optional(),
          content: z.string().optional(),
        }),
      ),
    }),
    needsDataPlane: true,
    handler: async (args, context) => {
      const input = z
        .object({
          title: z.string().min(1),
          reason: z.string().min(1),
          evidence: z
            .array(z.object({ receiptId: z.string().optional(), note: z.string().optional() }))
            .optional(),
          changes: z.array(
            z.object({
              kind: z.enum(["create", "write", "delete"]),
              relativePath: z.string().min(1),
              baseSha256: z.string().nullable().optional(),
              content: z.string().optional(),
            }),
          ),
        })
        .parse(args ?? {});
      return requireDataPlane(context).services.reviewService.createProposal(input);
    },
  },
  {
    name: "knowledge_review_revise_proposal",
    description: "修订提案（revision+1，旧批准失效；锚点 IKnowledgeReviewService.reviseProposal）。",
    schema: z.object({ proposalId: z.string().min(1) }).passthrough(),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.reviewService.reviseProposal(
        z.object({ proposalId: z.string().min(1) }).passthrough().parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_review_get_proposal",
    description: "读取提案（锚点 IKnowledgeReviewService.getProposal）。",
    schema: z.object({ proposalId: z.string().min(1) }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.reviewService.getProposal(
        z.object({ proposalId: z.string().min(1) }).parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_review_list_proposals",
    description: "当前 vault 提案列表（分页；锚点 IKnowledgeReviewService.listProposals）。",
    schema: pagingSchema,
    needsDataPlane: true,
    handler: async (args, context) => {
      const parsed = pagingSchema.parse(args ?? {});
      const proposals = await requireDataPlane(context).services.reviewService.listProposals();
      return paginate(proposals, parsed.offset, parsed.limit);
    },
  },
  {
    name: "knowledge_review_approve_proposal",
    description: "人工批准提案（绑定 revision/changesHash/sourceEpoch；锚点 IKnowledgeReviewService.approveProposal）。",
    schema: z.object({ proposalId: z.string().min(1), ttlMs: z.number().int().optional() }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.reviewService.approveProposal(
        z.object({ proposalId: z.string().min(1) }).passthrough().parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_review_reject_proposal",
    description: "拒绝提案（终态标记；锚点 IKnowledgeReviewService.rejectProposal）。",
    schema: z.object({ proposalId: z.string().min(1) }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.reviewService.rejectProposal(
        z.object({ proposalId: z.string().min(1) }).parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_review_apply_proposal",
    description: "执行已批准提案（唯一写盘路径，经 Vault 门面 CAS；锚点 IKnowledgeReviewService.applyProposal）。",
    schema: z.object({ proposalId: z.string().min(1), operationId: z.string().optional() }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.reviewService.applyProposal(
        z.object({ proposalId: z.string().min(1) }).passthrough().parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_review_reconcile_operation",
    description: "只读核验 + 账本落定（绝不写文件/重放；锚点 IKnowledgeReviewService.reconcileOperation）。",
    schema: z.object({ operationId: z.string().min(1) }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.reviewService.reconcileOperation(
        z.object({ operationId: z.string().min(1) }).parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_review_list_recent_operations",
    description: "最近操作历史（≤100，分页；锚点 IKnowledgeReviewService.listRecentOperations）。",
    schema: pagingSchema,
    needsDataPlane: true,
    handler: async (args, context) => {
      const parsed = pagingSchema.parse(args ?? {});
      const operations = await requireDataPlane(context).services.reviewService.listRecentOperations();
      return paginate(operations, parsed.offset, parsed.limit);
    },
  },
  {
    name: "knowledge_review_reconcile_stuck_operations",
    description: "重启恢复：落定全部 applying/uncertain（锚点 IKnowledgeReviewService.reconcileStuckOperations）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) =>
      requireDataPlane(context).services.reviewService.reconcileStuckOperations(),
  },
  {
    name: "knowledge_review_undo_operation",
    description: "逆操作还原（带当前 SHA 验证；锚点 IKnowledgeReviewService.undoOperation）。",
    schema: z.object({ operationId: z.string().min(1) }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.reviewService.undoOperation(
        z.object({ operationId: z.string().min(1) }).parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_review_get_proposal_change_content",
    description: "Diff 预览：提案内某文件的目标内容（锚点 IKnowledgeReviewService.getProposalChangeContent）。",
    schema: z.object({ proposalId: z.string().min(1), relativePath: z.string().min(1) }),
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).services.reviewService.getProposalChangeContent(
        z.object({ proposalId: z.string().min(1), relativePath: z.string().min(1) }).parse(args ?? {}),
      ),
  },
  {
    name: "knowledge_review_is_write_path_enabled",
    description: "L2 写路径总门状态（锚点 IKnowledgeReviewService.isWritePathEnabled）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) =>
      requireDataPlane(context).services.reviewService.isWritePathEnabled(),
  },
  {
    name: "knowledge_review_is_write_path_activation_allowed",
    description: "本 Host 是否被 release policy 授予 L2 开通资格（锚点 IKnowledgeReviewService.isWritePathActivationAllowed）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) =>
      requireDataPlane(context).services.reviewService.isWritePathActivationAllowed(),
  },
  {
    name: "knowledge_review_set_write_path_enabled",
    description: "显式开/关 L2 写路径总门（持久化 vault-config.json；锚点 IKnowledgeReviewService.setWritePathEnabled）。",
    schema: z.object({ enabled: z.boolean() }),
    needsDataPlane: true,
    handler: async (args, context) => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(args ?? {});
      return requireDataPlane(context).services.reviewService.setWritePathEnabled(enabled);
    },
  },
];

/** 元状态工具（conflict/migrating 态也可用）：D14 状态机与 §5 迁移门的结构化呈现。 */
const statusTools: ToolSpec[] = [
  {
    name: "knowledge_server_status",
    description:
      "knowledge server 数据面状态：ok（含路径与模式，搬迁被拒/失败回退时附 migration 原因）/ dual_db_conflict / migrating（§5 搬迁进行中）。",
    schema: z.object({}),
    needsDataPlane: false,
    handler: async (_args, context) => {
      const plan = context.plan;
      if (plan.mode === "dual_db_conflict") {
        return { status: "dual_db_conflict", ...conflictPayload(plan) };
      }
      // §5 迁移门：running = 数据面拒绝（面板/调用方等待完成）；blocked_*/failed =
      // 数据面按 legacy 原件继续服务但如实携带原因；completed = 本进程已完成搬迁。
      if (context.migration?.phase === "running") {
        return { ...migratingPayload(context.migration), mode: plan.mode };
      }
      return {
        status: "ok",
        // P7 后 legacy = 升级首启搬迁前的过渡态（数据面继续读旧路径原件）。
        mode: plan.mode,
        databasePath: plan.databasePath,
        modelRoot: plan.modelRoot,
        pluginDataDir: plan.pluginDataDir,
        ...(context.migration !== null ? { migration: context.migration } : {}),
      };
    },
  },
];

// P7 第 2 次尝试拆分：vault 门面工具组自 tools-vault.ts 并入（顺序不变）。
export const ALL_TOOLS: ToolSpec[] = [...statusTools, ...vaultTools, ...indexTools, ...queryTools, ...reviewTools];

export const RUN_RESOURCE_PREFIX = "vault://runs/";
export const RUN_URI_TEMPLATE = `${RUN_RESOURCE_PREFIX}{runId}`;

/** zod schema → MCP inputSchema（JSON Schema）转换：zod v4 原生 toJSONSchema。 */
export function toolInputSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
}
