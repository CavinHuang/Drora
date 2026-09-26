/**
 * Obsidian Vault 面板服务接口（host 常驻）。
 *
 * 数据面与 obsidian MCP server（agent 会话子进程）共享同一个 vault-config.json：
 * - 路径推导见 obsidianVaultService.resolveObsidianPluginDataDir；
 * - MCP server 侧由插件 manifest env `OBSIDIAN_PLUGIN_DATA=${DRORA_PLUGIN_DATA}`
 *   注入同一路径，两侧读写天然一致。
 * 安全不变量集中在 ./vault-fs.ts、./paths.ts、./atomic.ts、./image.ts、./discovery.ts
 * （移植自 obsidian-plugin src/lib，逐条保留，不得弱化）。
 */
import { ServiceChannels } from "@drora/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** 工具面可见的 Vault 概要：稳定 vaultId + 展示字段，不携带根路径之外的信息。 */
export interface ObsidianVaultSummary {
  vaultId: string;
  displayName: string;
  inboxPath: string;
  allowAgentWrites: boolean;
  configuredAt: number;
}

/** Vault 候选（托管 Vault + Obsidian 注册表条目）。 */
export interface ObsidianVaultCandidate {
  path: string;
  displayName: string;
  isObsidianVault: boolean;
  isDroraManaged: boolean;
}

export interface ObsidianVaultConfigureOptions {
  inboxPath?: string;
  displayName?: string;
  allowAgentWrites?: boolean;
}

export type ObsidianVaultTreeEntry =
  | { kind: "file"; relativePath: string; name: string; size: number; modifiedAt: number }
  | { kind: "folder"; relativePath: string; name: string };

export interface ObsidianVaultReadResult {
  relativePath: string;
  content: string;
  sha256: string;
  modifiedAt: number;
}

export interface ObsidianVaultWriteInput {
  relativePath: string;
  content: string;
  expectedSha256?: string;
  createOnly?: boolean;
}

export type ObsidianVaultWriteResult =
  | { ok: true; relativePath: string; sha256: string; modifiedAt: number }
  | { ok: false; reason: "conflict"; currentSha256: string; currentModifiedAt: number };

export interface ObsidianVaultRenameInput {
  relativePath: string;
  name: string;
  expectedSha256?: string;
}

export interface ObsidianVaultDeleteInput {
  relativePath: string;
  expectedSha256?: string;
}

export interface ObsidianVaultSavePastedImageInput {
  noteRelativePath: string;
  mimeType: string;
  base64: string;
}

/** 面板当前焦点（用户正在看的文件/文件夹），供后续 Agent 上下文消费。 */
export interface ObsidianVaultFocus {
  kind: "file" | "folder";
  relativePath: string;
  /** renderer 侧单调递增序号：过期的 IPC 不得覆盖较新的焦点。 */
  sequence: number;
}

export interface ObsidianVaultUserContextSnapshot {
  rootPath: string;
  displayName: string;
  focus: ObsidianVaultFocus;
  openedAt: number;
}

/**
 * Obsidian Vault 面板 RPC 服务面。
 * 未配置 Vault 时读取面返回 null/空列表或抛“尚未配置”，由面板展示引导而非报错。
 */
export interface IObsidianVaultService {
  /** 当前配置概要；未配置（或根失效）时返回 null。 */
  getSummary(): Promise<ObsidianVaultSummary | null>;

  /** 托管 Vault + Obsidian 注册表候选；坏注册表条目静默跳过。 */
  listCandidates(): Promise<ObsidianVaultCandidate[]>;

  /** 选择托管 Vault（未安装 Obsidian 用户的默认路径）。 */
  selectManagedVault(options?: ObsidianVaultConfigureOptions): Promise<ObsidianVaultSummary>;

  /** 显式授权一个根目录并写入共享配置；根必须真实存在（realpath 解析）。 */
  configureVault(params: {
    rootPath: string;
    options?: ObsidianVaultConfigureOptions;
  }): Promise<ObsidianVaultSummary>;

  /** 授权一个候选：路径必须仍在候选列表内（防陈旧 IPC 授权任意目录）。 */
  authorizeCandidate(params: {
    path: string;
    options?: ObsidianVaultConfigureOptions;
  }): Promise<ObsidianVaultSummary>;

  /** 列出 Vault 内全部 Markdown 文件与文件夹（带配额与深度上限）。 */
  listFiles(): Promise<ObsidianVaultTreeEntry[]>;

  /** 读取一个笔记（≤2MB），返回内容与 sha256 乐观锁版本。 */
  readFile(params: { relativePath: string }): Promise<ObsidianVaultReadResult>;

  /** 原子写入笔记；expectedSha256 不匹配时返回 conflict 而非覆盖。 */
  writeFile(input: ObsidianVaultWriteInput): Promise<ObsidianVaultWriteResult>;

  /** 在 Inbox 创建不覆盖既有文件的新笔记。 */
  createUntitledFile(): Promise<ObsidianVaultWriteResult>;

  /** 在指定文件夹创建不覆盖既有文件的新笔记。 */
  createUntitledFileInFolder(params: { folderPath: string }): Promise<ObsidianVaultWriteResult>;

  /** 创建文件夹（不递归，父目录必须存在）。 */
  createFolder(params: { relativePath: string }): Promise<void>;

  /** 重命名/改名 Markdown 文件（不移动目录）。 */
  renameFile(input: ObsidianVaultRenameInput): Promise<ObsidianVaultReadResult>;

  /** 删除一个 Markdown 文件（仅普通文件，逐段软链校验）。 */
  deleteFile(input: ObsidianVaultDeleteInput): Promise<void>;

  /** 解析笔记内相对媒体引用到根内绝对路径；越界/不存在返回 null。 */
  resolveMedia(params: { noteRelativePath: string; src: string }): Promise<string | null>;

  /** 保存粘贴图片（MIME 白名单 + 魔数 + ≤10MB），返回笔记相对 Markdown 引用。 */
  savePastedImage(
    input: ObsidianVaultSavePastedImageInput,
  ): Promise<{ src: string } | null>;

  /** 记录某个会话的面板焦点；focus 为 null 时清除。 */
  setUserContext(params: { sessionId: string; focus: ObsidianVaultFocus | null }): Promise<void>;

  /** 读取某个会话的面板焦点；会话未设置或 Vault 已切换时返回 null。 */
  getUserContext(params: { sessionId: string }): Promise<ObsidianVaultUserContextSnapshot | null>;
}

export const IObsidianVaultService = createServiceDescriptor<IObsidianVaultService>(
  ServiceChannels.ObsidianVault,
);
