/**
 * knowledge MCP server 工具面共享骨架（specs/obsidian-vault-phase2-true-extraction.md
 * §3/§10-P6 就地修复拆出）。
 *
 * 拆分原因（gate 拦路缺陷，非顺带重构）：P7 第 2 次尝试把 vaultTools 拆到
 * tools-vault.ts 后，共享骨架（pagingSchema/requireDataPlane/ToolSpec 等）仍留在
 * tools.ts，形成 tools.ts → tools-vault.ts → tools.ts 的模块环——esbuild bundle 会
 * 摊平该环（MCP 冒烟走 bundle 故未暴露），但任何对 src 的直接导入（node:test/tsx
 * 按 ESM 环语义求值）在 tools-vault.ts 模块体求值期访问未初始化的 pagingSchema
 * 即 TDZ ReferenceError（P6 迁移单测首跑实证：`node --import tsx --test
 * test/knowledgeAgentTools.test.ts` 在工作区基线同样失败）。按 P7 拆分自身声明的
 * 「共享骨架单一出处」意图，骨架移入本独立模块消环：依赖方向 tools.ts →
 * tools-vault.ts → tool-shared.ts、tools.ts → tool-shared.ts，环为零；tools.ts
 * 保留再导出，既有消费方（agent-tools/uiResources/server）导入面不变。
 */
import { z } from "zod";
import type { KnowledgeServices } from "../server/knowledge/knowledgeServices.js";
import type { IObsidianVaultService } from "../server/vault/obsidianVault.js";
import type { KnowledgeDataPlan } from "../server/platform/dataPaths.js";

/** 数据面（dual_db_conflict 时为 null，数据工具统一走结构化拒绝）。 */
export interface KnowledgeServerDataPlane {
  services: KnowledgeServices;
  vault: IObsidianVaultService;
}

/** 分页缺省/上限（office-runtime offset/limit chunk 先例同款纪律；8MiB 资源面约束内取保守值）。 */
const LIST_DEFAULT_LIMIT = 200;
const LIST_MAX_LIMIT = 1000;
// P7 第 2 次尝试拆分：READ_FILE_* 随 vault 门面工具组（tools-vault.ts）消费改 export
//（分页常量清单单一出处仍在本骨架，uiResources.ts 的同值副本系 P5 既有独立清单）。
export const READ_FILE_DEFAULT_CHARS = 48_000;
export const READ_FILE_MAX_CHARS = 200_000;

export const pagingSchema = z.object({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(LIST_MAX_LIMIT).default(LIST_DEFAULT_LIMIT),
});

export interface Page<T> {
  items: T[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export function paginate<T>(items: T[], offset: number, limit: number): Page<T> {
  return {
    items: items.slice(offset, offset + limit),
    offset,
    limit,
    total: items.length,
    hasMore: offset + limit < items.length,
  };
}

/**
 * §5 迁移门的结构化状态（P6 搬迁接线启用）：running = 搬迁进行中（数据面拒绝）；
 * blocked/failed = 搬迁被拒或已失败回退（数据面按 legacy 原件继续服务，状态面如实
 * 呈现原因）；completed = 本进程内搬迁已完成（数据面 plugin 态）。
 */
export interface KnowledgeMigrationState {
  phase: "running" | "blocked_active_writer" | "blocked_busy" | "blocked_concurrent" | "failed" | "completed";
  reason?: string;
  ownerPids?: number[];
  movedFiles?: number;
}

export interface ToolContext {
  dataPlane: KnowledgeServerDataPlane | null;
  plan: KnowledgeDataPlan;
  /** §5 迁移门：null = 本进程不涉及搬迁（plugin 态直启）；running 期间 dataPlane=null。 */
  migration: KnowledgeMigrationState | null;
}

export type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  schema: z.ZodType;
  /** true = 需要数据面（conflict/migrating 态下结构化拒绝）。 */
  needsDataPlane: boolean;
  handler: ToolHandler;
}

export function conflictPayload(plan: KnowledgeDataPlan): Record<string, unknown> {
  if (plan.mode !== "dual_db_conflict") throw new Error("conflictPayload 仅在 dual_db_conflict 态调用");
  return {
    status: "dual_db_conflict",
    // D14：人工取舍提示，不静默合并——两份库都在，必须由用户决定保留哪份。
    message:
      "检测到旧路径与插件数据目录各有一份知识库（dual_db_conflict）。请先取舍（保留一份并移除另一份）后重启；工具面拒绝静默合并。",
    legacyDatabasePath: plan.legacyDatabasePath,
    pluginDatabasePath: plan.pluginDatabasePath,
  };
}

/** §5 迁移门：搬迁进行中的结构化载荷（工具面 migrating 状态单一出处）。 */
export function migratingPayload(state: KnowledgeMigrationState): Record<string, unknown> {
  return {
    status: "migrating",
    message: "旧路径知识库正在自动搬迁到插件数据目录，完成后自动恢复服务；请稍后重试。",
    phase: state.phase,
    ...(state.reason !== undefined ? { reason: state.reason } : {}),
  };
}

export function requireDataPlane(context: ToolContext): KnowledgeServerDataPlane {
  if (context.dataPlane === null) {
    // null 态两种（P6 起）：dual_db_conflict（D14）与 migrating-running（§5 迁移门）。
    if (context.migration?.phase === "running") {
      throw new MigrationPendingError(migratingPayload(context.migration));
    }
    if (context.plan.mode === "dual_db_conflict") {
      throw new DualDbConflictError(conflictPayload(context.plan));
    }
    // blocked_concurrent 期间不建 legacy 数据面（防惰性开库在旧路径造空库，见
    // knowledgeMigration.ts 文件头已知边界）：数据面保持拒绝并携带结构化原因。
    if (context.migration !== null) {
      throw new MigrationPendingError({
        status: "migrating",
        message: "知识库数据面暂不可用：搬迁尚未收敛。",
        phase: context.migration.phase,
        ...(context.migration.reason !== undefined ? { reason: context.migration.reason } : {}),
      });
    }
    throw new Error("data plane unavailable");
  }
  return context.dataPlane;
}

export class DualDbConflictError extends Error {
  constructor(readonly payload: Record<string, unknown>) {
    super("dual_db_conflict");
  }
}

export class MigrationPendingError extends Error {
  constructor(readonly payload: Record<string, unknown>) {
    super("migrating");
  }
}
