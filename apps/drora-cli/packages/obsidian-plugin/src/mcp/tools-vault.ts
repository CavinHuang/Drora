/**
 * knowledge MCP server 的 vault 门面工具组（specs/obsidian-vault-phase2-true-extraction.md
 * §3「UI 服务面→MCP 映射」；映射清单逐项对验收见 docs/knowledge-mcp-mapping.md）。
 *
 * 拆分原因（P7 第 2 次尝试，2026-11-12）：architecture:check 的 managed 模块
 * max-file-lines 上限 800 行，tools.ts 注册表 830 行超限（后续批次追加工具条目
 * 所致）→ vault 门面组（vaultTools）拆出本文件。**纯机械搬移**：数组内容与
 * 拆分前 tools.ts 工作区版本（本拆分提交前状态）逐字节等价，行为零变化；共享
 * 骨架（pagingSchema/paginate/READ_FILE 系常量/requireDataPlane/ToolSpec）单一
 * 出处原在 tools.ts——P6（2026-11-12）消环修复移至 tool-shared.ts（tools.ts ↔
 * 本文件的模块环在 src 直连导入下 TDZ 崩溃，见 tool-shared.ts 文件头），本文件
 * 只 import 不复制。
 *
 * 2026-11-15 审计收敛（docs/upstream-v3.18.0-diff-2026-11-11/10-plugin-audit.md §四
 * 「工具 schema 与 handler 内 z.parse 双份字面量」）：每个工具的入参 z.object 提升
 * 为单出处命名常量，`schema:`（tools/list 申报面）与 handler 内 parse 共用同一
 * 实例（agent-tools.ts 先例同款），消除两份字面量漂移面。行为零变化：工具框架
 * （server.ts tools/call）本就先经 schema.parse 再进 handler，handler 内 parse 仅
 * 为直调路径（测试/内部装配）兜底，沿用同一 schema 实例输出不变。
 */
import { z } from "zod";
import {
  READ_FILE_DEFAULT_CHARS,
  READ_FILE_MAX_CHARS,
  paginate,
  pagingSchema,
  requireDataPlane,
  type ToolSpec,
} from "./tool-shared.js";

// ── 入参契约（单出处常量，schema 申报面与 handler 解析共用；见文件头 2026-11-15 注）──

const vaultSelectManagedVaultInputSchema = z.object({
  inboxPath: z.string().optional(),
  displayName: z.string().optional(),
  allowAgentWrites: z.boolean().optional(),
});

const vaultConfigureInputSchema = z.object({
  rootPath: z.string().min(1),
  inboxPath: z.string().optional(),
  displayName: z.string().optional(),
  allowAgentWrites: z.boolean().optional(),
});

const vaultAuthorizeCandidateInputSchema = z.object({
  path: z.string().min(1),
  inboxPath: z.string().optional(),
  displayName: z.string().optional(),
  allowAgentWrites: z.boolean().optional(),
});

const vaultSetAgentWritesEnabledInputSchema = z.object({ enabled: z.boolean() });

const vaultReadFileInputSchema = z.object({
  relativePath: z.string().min(1),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(READ_FILE_MAX_CHARS).default(READ_FILE_DEFAULT_CHARS),
});

const vaultWriteFileInputSchema = z.object({
  relativePath: z.string().min(1),
  content: z.string(),
  expectedSha256: z.string().optional(),
  createOnly: z.boolean().optional(),
});

const vaultCreateUntitledFileInFolderInputSchema = z.object({ folderPath: z.string().min(1) });

const vaultCreateFolderInputSchema = z.object({ relativePath: z.string().min(1) });

const vaultRenameFileInputSchema = z.object({
  relativePath: z.string().min(1),
  name: z.string().min(1),
  expectedSha256: z.string().optional(),
});

const vaultDeleteFileInputSchema = z.object({
  relativePath: z.string().min(1),
  expectedSha256: z.string().optional(),
});

const vaultResolveMediaInputSchema = z.object({ noteRelativePath: z.string().min(1), src: z.string().min(1) });

const vaultSavePastedImageInputSchema = z.object({
  noteRelativePath: z.string().min(1),
  mimeType: z.string().min(1),
  base64: z.string().min(1),
});

const vaultSetUserContextInputSchema = z.object({
  sessionId: z.string().min(1),
  focus: z
    .object({ kind: z.enum(["file", "folder"]), relativePath: z.string().min(1), sequence: z.number().int().min(0) })
    .nullable(),
});

const vaultGetUserContextInputSchema = z.object({ sessionId: z.string().min(1) });

export const vaultTools: ToolSpec[] = [
  {
    name: "vault_get_summary",
    description: "当前 Vault 配置概要；未配置返回 null（锚点 IObsidianVaultService.getSummary）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) => requireDataPlane(context).vault.getSummary(),
  },
  {
    name: "vault_list_candidates",
    description: "托管 Vault + Obsidian 注册表候选（分页；锚点 IObsidianVaultService.listCandidates）。",
    schema: pagingSchema,
    needsDataPlane: true,
    handler: async (args, context) => {
      const parsed = pagingSchema.parse(args ?? {});
      const candidates = await requireDataPlane(context).vault.listCandidates();
      return paginate(candidates, parsed.offset, parsed.limit);
    },
  },
  {
    name: "vault_select_managed_vault",
    description: "选择托管 Vault（未安装 Obsidian 用户的默认路径；锚点 IObsidianVaultService.selectManagedVault）。",
    schema: vaultSelectManagedVaultInputSchema,
    needsDataPlane: true,
    handler: async (args, context) => {
      const options = vaultSelectManagedVaultInputSchema.parse(args ?? {});
      return requireDataPlane(context).vault.selectManagedVault(options);
    },
  },
  {
    name: "vault_configure",
    description:
      "显式授权一个根目录并写共享配置（根必须真实存在；根目录选择经宿主 drora/openDirectoryPicker 取路径后调用；锚点 IObsidianVaultService.configureVault）。",
    schema: vaultConfigureInputSchema,
    needsDataPlane: true,
    handler: async (args, context) => {
      const input = vaultConfigureInputSchema.parse(args ?? {});
      const { rootPath, ...options } = input;
      return requireDataPlane(context).vault.configureVault({ rootPath, options });
    },
  },
  {
    name: "vault_authorize_candidate",
    description: "授权一个候选（路径必须仍在候选列表内；锚点 IObsidianVaultService.authorizeCandidate）。",
    schema: vaultAuthorizeCandidateInputSchema,
    needsDataPlane: true,
    handler: async (args, context) => {
      const input = vaultAuthorizeCandidateInputSchema.parse(args ?? {});
      const { path, ...options } = input;
      return requireDataPlane(context).vault.authorizeCandidate({ path, options });
    },
  },
  {
    name: "vault_set_agent_writes_enabled",
    description: "开启/关闭当前 Vault 的 Agent 写授权（翻转使旧批准失效；锚点 IObsidianVaultService.setAgentWritesEnabled）。",
    schema: vaultSetAgentWritesEnabledInputSchema,
    needsDataPlane: true,
    handler: async (args, context) => {
      const { enabled } = vaultSetAgentWritesEnabledInputSchema.parse(args ?? {});
      return requireDataPlane(context).vault.setAgentWritesEnabled({ enabled });
    },
  },
  {
    name: "vault_list_files",
    description: "列出 Vault 内全部 Markdown 文件与文件夹（分页；配额与深度上限不变；锚点 IObsidianVaultService.listFiles）。",
    schema: pagingSchema,
    needsDataPlane: true,
    handler: async (args, context) => {
      const parsed = pagingSchema.parse(args ?? {});
      const entries = await requireDataPlane(context).vault.listFiles();
      return paginate(entries, parsed.offset, parsed.limit);
    },
  },
  {
    name: "vault_read_file",
    description:
      "分段读取一个笔记（≤2MB；offset/limit 按 UTF-16 code unit 切片，sha256/modifiedAt 用于续读校验与乐观锁；锚点 IObsidianVaultService.readFile）。",
    schema: vaultReadFileInputSchema,
    needsDataPlane: true,
    handler: async (args, context) => {
      const parsed = vaultReadFileInputSchema.parse(args ?? {});
      const result = await requireDataPlane(context).vault.readFile({
        relativePath: parsed.relativePath,
      });
      return {
        relativePath: result.relativePath,
        offset: parsed.offset,
        limit: parsed.limit,
        totalChars: result.content.length,
        hasMore: parsed.offset + parsed.limit < result.content.length,
        // 分段语义：只回传请求窗口（§2 大文件读取走分段工具；8MiB 资源面约束）。
        content: result.content.slice(parsed.offset, parsed.offset + parsed.limit),
        sha256: result.sha256,
        modifiedAt: result.modifiedAt,
      };
    },
  },
  {
    name: "vault_write_file",
    description: "原子写入笔记；expectedSha256 不匹配返回 conflict 而非覆盖（锚点 IObsidianVaultService.writeFile）。",
    schema: vaultWriteFileInputSchema,
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).vault.writeFile(vaultWriteFileInputSchema.parse(args ?? {})),
  },
  {
    name: "vault_create_untitled_file",
    description: "在 Inbox 创建不覆盖既有文件的新笔记（锚点 IObsidianVaultService.createUntitledFile）。",
    schema: z.object({}),
    needsDataPlane: true,
    handler: async (_args, context) => requireDataPlane(context).vault.createUntitledFile(),
  },
  {
    name: "vault_create_untitled_file_in_folder",
    description: "在指定文件夹创建不覆盖既有文件的新笔记（锚点 IObsidianVaultService.createUntitledFileInFolder）。",
    schema: vaultCreateUntitledFileInFolderInputSchema,
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).vault.createUntitledFileInFolder(
        vaultCreateUntitledFileInFolderInputSchema.parse(args ?? {}),
      ),
  },
  {
    name: "vault_create_folder",
    description: "创建文件夹（不递归，父目录必须存在；锚点 IObsidianVaultService.createFolder）。",
    schema: vaultCreateFolderInputSchema,
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).vault.createFolder(vaultCreateFolderInputSchema.parse(args ?? {})),
  },
  {
    name: "vault_rename_file",
    description: "重命名 Markdown 文件（不移动目录；锚点 IObsidianVaultService.renameFile）。",
    schema: vaultRenameFileInputSchema,
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).vault.renameFile(vaultRenameFileInputSchema.parse(args ?? {})),
  },
  {
    name: "vault_delete_file",
    description: "删除一个 Markdown 文件（仅普通文件，逐段软链校验；锚点 IObsidianVaultService.deleteFile）。",
    schema: vaultDeleteFileInputSchema,
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).vault.deleteFile(vaultDeleteFileInputSchema.parse(args ?? {})),
  },
  {
    name: "vault_resolve_media",
    description: "解析笔记内相对媒体引用到根内绝对路径；越界/不存在返回 null（锚点 IObsidianVaultService.resolveMedia）。",
    schema: vaultResolveMediaInputSchema,
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).vault.resolveMedia(vaultResolveMediaInputSchema.parse(args ?? {})),
  },
  {
    name: "vault_save_pasted_image",
    description: "保存粘贴图片（MIME 白名单 + 魔数 + ≤10MB；锚点 IObsidianVaultService.savePastedImage）。",
    schema: vaultSavePastedImageInputSchema,
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).vault.savePastedImage(vaultSavePastedImageInputSchema.parse(args ?? {})),
  },
  {
    name: "vault_set_user_context",
    description: "记录某个会话的面板焦点；focus 为 null 时清除（锚点 IObsidianVaultService.setUserContext）。",
    schema: vaultSetUserContextInputSchema,
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).vault.setUserContext(vaultSetUserContextInputSchema.parse(args ?? {})),
  },
  {
    name: "vault_get_user_context",
    description: "读取某个会话的面板焦点快照；未设置或 Vault 已切换返回 null（锚点 IObsidianVaultService.getUserContext）。",
    schema: vaultGetUserContextInputSchema,
    needsDataPlane: true,
    handler: async (args, context) =>
      requireDataPlane(context).vault.getUserContext(vaultGetUserContextInputSchema.parse(args ?? {})),
  },
];
