/**
 * knowledge server 的 UI 面板资源面（specs/obsidian-vault-phase2-true-extraction.md
 * §2「UI 重建：VaultView webview 形态」、§10-P5）。
 *
 * 为什么是 resources 而不是工具：面板页面的一切数据读取走 `resources/read`
 * （`mcp/uiReadResource` 通道：限同插件 server、8 MiB、MIME 白名单），**不经过
 * MCP 工具审批**——这是 drora-site（server.ts「读走资源…轮询不会弹窗」）与
 * office-runtime（panel/file chunk 全资源）的既有先例，也是 D7/D13 保守缺省下
 * 只读面板唯一可用的数据通道：页面调工具会复用 Agent 权限链逐次弹审批
 * （bootstrap mcp-ui handlers.callTool → authorizeAppTool → resolveToolPermission），
 * 浏览/检索/轮询将不可用。§3 的 52 件工具面继续服务 agent；本文件只加页面读面。
 *
 * 端点全部只读 + offset/limit 分页/分段（§2 数据通道；office-runtime offset/limit
 * chunk 先例）。写操作（保存/新建/改名/删除/批准/configureVault/startReconcile）
 * 按 D13 保守缺省不交付：面板如实降级提示，等 g10 信任分类终裁后另立补批。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MCP_APPS_RESOURCE_MIME_TYPE } from "@drora/shared/mcp-apps";
import {
  conflictPayload,
  DualDbConflictError,
  MigrationPendingError,
  type ToolContext,
} from "./tools.js";

/** 面板页面资源（manifest ui.surfaces[].resourceUri 同值——单一出处常量在包内导出，manifest 为部署副本）。 */
export const UI_PANEL_URI = "ui://obsidian/panel.html";
/** 页面数据端点前缀（面板 host.ts 与本文件共用，防两侧 URI 空间漂移）。 */
export const UI_DATA_PREFIX = "ui://obsidian/data/";

/** 分页缺省/上限：与 tools.ts 服务面同款纪律（单一出处见 tools.ts 常量注释，此处按面板读面需要重述同值）。 */
const LIST_DEFAULT_LIMIT = 200;
const LIST_MAX_LIMIT = 1000;
const READ_FILE_DEFAULT_CHARS = 48_000;
const READ_FILE_MAX_CHARS = 200_000;

/** 面板 HTML 的资源级 `_meta`：申报后台保留（§2 display modes 段——草稿经 widgetState 落宿主内存，回收重建时下发）。 */
export const UI_PANEL_META: Record<string, unknown> = { ui: { backgroundRetention: true } };

/** 统一结果封套：页面侧 isUiDataResult 判形后按 ok 分支渲染（错误码机器可读）。 */
export interface UiDataResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; [key: string]: unknown };
}

function ok<T>(data: T): UiDataResult<T> {
  return { ok: true, data };
}

function fail(code: string, message: string, extra?: Record<string, unknown>): UiDataResult<never> {
  return { ok: false, error: { code, message, ...(extra ?? {}) } };
}

/**
 * 数据面不可用的结构化封套（D14 + §5 迁移门）：conflict 态给人工取舍提示；搬迁
 * running/blocked_concurrent 给 migrating 提示（面板按 code 呈现等待/重试，不炸页面）。
 */
function dataPlaneUnavailableResult(context: ToolContext): UiDataResult<never> {
  if (context.plan.mode === "dual_db_conflict") {
    const payload = conflictPayload(context.plan);
    return fail("dual_db_conflict", String(payload.message), payload);
  }
  // legacy 态的 null 数据面 = §5 搬迁未收敛（running/blocked_concurrent 轮询超时）。
  const phase = context.migration?.phase ?? "running";
  return fail("migrating", "旧路径知识库正在自动搬迁，完成后自动恢复；请稍后重试。", {
    phase,
    ...(context.migration?.reason !== undefined ? { reason: context.migration.reason } : {}),
  });
}

interface Page<T> {
  items: T[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

function paginate<T>(items: T[], offset: number, limit: number): Page<T> {
  return {
    items: items.slice(offset, offset + limit),
    offset,
    limit,
    total: items.length,
    hasMore: offset + limit < items.length,
  };
}

/** query 参数解析：非负整数带缺省与上限钳制（页面只传 well-formed 值，越界按上限收）。 */
function intParam(params: URLSearchParams, key: string, defaultValue: number, max: number): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return defaultValue;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) return defaultValue;
  return Math.min(value, max);
}

/** dist/ui/panel.html 的落点：DRORA_PLUGIN_ROOT env（宿主注入）优先，缺省按 bundle 自身位置推导。 */
function resolvePanelPath(): string {
  const root = process.env.DRORA_PLUGIN_ROOT?.trim();
  if (root) return join(root, "dist", "ui", "panel.html");
  // dist/mcp/server.js → dist/ui/panel.html（bundle 保持 esm，import.meta.dirname 可用）。
  return join(import.meta.dirname, "..", "ui", "panel.html");
}

/**
 * UI 资源读取分发。返回 contents 或 null（null = 非 UI 资源，调用方继续走既有 run 资源分支）。
 * 抛错语义与既有 resources/read 一致（unknown resource / panel 缺失），数据端点的业务
 * 态一律走 ok/error 封套不抛错——页面的降级展示需要可判别的结构化状态。
 */
export async function readUiResource(
  uri: string,
  context: ToolContext,
): Promise<{ uri: string; mimeType: string; text: string; _meta?: Record<string, unknown> }[] | null> {
  if (uri === UI_PANEL_URI) {
    // 面板本体不依赖数据面（conflict 态也要能打开页面呈现冲突说明）。
    const text = await readFile(resolvePanelPath(), "utf8");
    return [{ uri, mimeType: MCP_APPS_RESOURCE_MIME_TYPE, text, _meta: UI_PANEL_META }];
  }
  if (!uri.startsWith(UI_DATA_PREFIX)) return null;

  const parsed = new URL(uri);
  const endpoint = parsed.pathname.slice("/data/".length);
  const params = parsed.searchParams;
  let payload: UiDataResult<unknown>;
  try {
    payload = await readUiDataEndpoint(endpoint, params, context);
  } catch (error) {
    if (error instanceof DualDbConflictError || error instanceof MigrationPendingError) {
      // 数据面结构化拒绝（D14 冲突 / §5 迁移门）：按当前 context 事实封套给页面。
      payload = dataPlaneUnavailableResult(context);
    } else {
      // 业务错（如 vault 未配置读文件）：封套化，页面按 code 降级，不炸整次读取。
      const message = error instanceof Error ? error.message : String(error);
      payload = fail("server_error", message);
    }
  }
  return [{ uri, mimeType: "application/json", text: JSON.stringify(payload) }];
}

async function readUiDataEndpoint(
  endpoint: string,
  params: URLSearchParams,
  context: ToolContext,
): Promise<UiDataResult<unknown>> {
  switch (endpoint) {
    case "status": {
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      const [indexStatus, summary] = await Promise.all([
        context.dataPlane.services.indexService.getStatus(),
        context.dataPlane.vault.getSummary(),
      ]);
      return ok({
        mode: context.plan.mode,
        index: indexStatus,
        vault: summary,
      });
    }
    case "summary": {
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      return ok(await context.dataPlane.vault.getSummary());
    }
    case "files": {
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      const offset = intParam(params, "offset", 0, Number.MAX_SAFE_INTEGER);
      const limit = intParam(params, "limit", LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
      const entries = await context.dataPlane.vault.listFiles();
      return ok(paginate(entries, offset, limit));
    }
    case "file": {
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      const relativePath = params.get("path");
      if (!relativePath) return fail("invalid_params", "path is required");
      const offset = intParam(params, "offset", 0, Number.MAX_SAFE_INTEGER);
      const limit = intParam(params, "limit", READ_FILE_DEFAULT_CHARS, READ_FILE_MAX_CHARS);
      const result = await context.dataPlane.vault.readFile({ relativePath });
      // 分段语义与 vault_read_file 工具同款（§2 大文件读取走分段；8 MiB 资源面约束）。
      return ok({
        relativePath: result.relativePath,
        offset,
        limit,
        totalChars: result.content.length,
        hasMore: offset + limit < result.content.length,
        content: result.content.slice(offset, offset + limit),
        sha256: result.sha256,
        modifiedAt: result.modifiedAt,
      });
    }
    case "insights": {
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      return ok(await context.dataPlane.services.indexService.getInsights());
    }
    case "neighbors": {
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      const notePath = params.get("path");
      if (!notePath) return fail("invalid_params", "path is required");
      const limit = intParam(params, "limit", 5, 10);
      return ok(
        await context.dataPlane.services.queryService.neighbors({ notePath, limit }),
      );
    }
    case "lookup": {
      // N1 Smart Lookup（检索即终点）：资源读内联 createRun+search，不暴露 QA run 的
      // 发起面（answer/compare 的 agent 供给入口按 lookup 语义隐藏，见 knowledgeAskModel
      // lookup 注释）。clientRequestId 由页面生成，幂等防双击双跑。
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      const query = params.get("q");
      const clientRequestId = params.get("requestId");
      if (!query || !clientRequestId) return fail("invalid_params", "q and requestId are required");
      const run = await context.dataPlane.services.queryService.createRun({
        query,
        clientRequestId,
      });
      return ok(await context.dataPlane.services.queryService.search({ runId: run.runId }));
    }
    case "citation": {
      // g9 宿主→面板 openWith 后的面板内解析（§3 映射：C5a citation 打开路由消费端）。
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      const receiptId = params.get("receiptId");
      if (!receiptId) return fail("invalid_params", "receiptId is required");
      return ok(
        await context.dataPlane.services.queryService.resolveCitation({ receiptId }),
      );
    }
    case "proposals": {
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      const offset = intParam(params, "offset", 0, Number.MAX_SAFE_INTEGER);
      const limit = intParam(params, "limit", LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
      const proposals = await context.dataPlane.services.reviewService.listProposals();
      return ok(paginate(proposals, offset, limit));
    }
    case "proposal": {
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      const proposalId = params.get("id");
      if (!proposalId) return fail("invalid_params", "id is required");
      const proposal = await context.dataPlane.services.reviewService.getProposal({
        proposalId,
      });
      return ok(proposal);
    }
    case "proposal-content": {
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      const proposalId = params.get("id");
      const relativePath = params.get("path");
      if (!proposalId || !relativePath) return fail("invalid_params", "id and path are required");
      return ok(
        await context.dataPlane.services.reviewService.getProposalChangeContent({
          proposalId,
          relativePath,
        }),
      );
    }
    case "write-gate": {
      // review 视图只读呈现 L2 写路径总门（approve/apply 按钮降级为提示，D13）。
      if (context.dataPlane === null) return dataPlaneUnavailableResult(context);
      const [enabled, activationAllowed] = await Promise.all([
        context.dataPlane.services.reviewService.isWritePathEnabled(),
        context.dataPlane.services.reviewService.isWritePathActivationAllowed(),
      ]);
      return ok({ enabled, activationAllowed });
    }
    default:
      // 未知端点按参数错误封套（页面不会构造；封套化保证 8 MiB/白名单读链路不因
      // 开发期笔误把整次 resources/read 炸成协议错）。
      return fail("invalid_params", `unknown data endpoint: ${endpoint}`);
  }
}

/** resources/list 的静态条目（面板本体；run 实例资源由 server.ts 既有分支继续合成）。 */
export function uiPanelListEntry(): {
  uri: string;
  name: string;
  mimeType: string;
  _meta: Record<string, unknown>;
} {
  return {
    uri: UI_PANEL_URI,
    name: "Vault panel",
    mimeType: MCP_APPS_RESOURCE_MIME_TYPE,
    _meta: UI_PANEL_META,
  };
}
