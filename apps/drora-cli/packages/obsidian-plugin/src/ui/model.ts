/**
 * Vault 面板纯模型（specs/obsidian-vault-phase2-true-extraction.md §2「UI 重建」、§10-P5）。
 *
 * 与本体 v4/vault/* 的关系：行为语义对照 HEAD 基准（树模型/滚动记忆/wikilink 解析/
 * N1-N4 判定），但实现独立——webview 面板不可复用本体 React 组件（§2），也不经本体
 * 服务 RPC。本文件只做纯计算，可脱离 DOM 用 node:test 直测（B6 模型测试随插件 UI
 * 工程重建的先例）。类型从插件 server 侧 type-only 引入（运行时零依赖）。
 */
import type { ObsidianVaultSummary, ObsidianVaultTreeEntry } from "../server/vault/obsidianVault.js";
import type {
  KnowledgeHealthReport,
  KnowledgeIndexStatus,
  KnowledgeInsightsSnapshot,
  KnowledgeNeighborsCandidate,
  KnowledgeNeighborsResult,
  KnowledgeRunView,
} from "../server/knowledge/knowledgeTypes.js";
import type { KnowledgeResolveCitationResult } from "../server/knowledge/evidence/evidenceRegistry.js";
import type { KnowledgeReviewProposalView } from "../server/knowledge/review/reviewTypes.js";

// ── 服务 payload 类型（面板侧具名 re-export，视图不触 server 内部路径）──────────
export type {
  ObsidianVaultSummary,
  ObsidianVaultTreeEntry,
  KnowledgeHealthReport,
  KnowledgeIndexStatus,
  KnowledgeInsightsSnapshot,
  KnowledgeNeighborsCandidate,
  KnowledgeNeighborsResult,
  KnowledgeReviewProposalView,
  KnowledgeRunView,
  KnowledgeResolveCitationResult,
};

/** server uiResources 的统一封套（见 src/mcp/uiResources.ts UiDataResult）。 */
export interface UiDataResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; [key: string]: unknown };
}

export interface Page<T> {
  items: T[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface FileSegment {
  relativePath: string;
  offset: number;
  limit: number;
  totalChars: number;
  hasMore: boolean;
  content: string;
  sha256: string;
  modifiedAt: number;
}

// ── 树模型（语义对照 HEAD v4/vault/vault-tree-model.ts：文件夹嵌套、文件挂父目录）──

export type VaultFileEntry = Extract<ObsidianVaultTreeEntry, { kind: "file" }>;

export interface VaultFolderNode {
  name: string;
  relativePath: string;
  folders: Map<string, VaultFolderNode>;
  files: VaultFileEntry[];
}

export function buildVaultTree(entries: ObsidianVaultTreeEntry[]): VaultFolderNode {
  const root: VaultFolderNode = { name: "", relativePath: "", folders: new Map(), files: [] };
  const getOrCreateFolder = (relativePath: string): VaultFolderNode => {
    let parent = root;
    let currentPath = "";
    for (const folderName of relativePath.split("/").filter(Boolean)) {
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
      let folder = parent.folders.get(folderName);
      if (!folder) {
        folder = { name: folderName, relativePath: currentPath, folders: new Map(), files: [] };
        parent.folders.set(folderName, folder);
      }
      parent = folder;
    }
    return parent;
  };
  for (const entry of entries) {
    if (entry.kind === "folder") {
      getOrCreateFolder(entry.relativePath);
      continue;
    }
    const separatorIndex = entry.relativePath.lastIndexOf("/");
    const parent =
      separatorIndex < 0 ? root : getOrCreateFolder(entry.relativePath.slice(0, separatorIndex));
    parent.files.push(entry);
  }
  return root;
}

/** 展开 folder 的祖先链（打开文件时自动展开路径，旧面板 getVaultFolderAncestors 语义）。 */
export function getFolderAncestors(relativePath: string): string[] {
  const folders = relativePath.split("/").filter(Boolean).slice(0, -1);
  const ancestors: string[] = [];
  let currentPath = "";
  for (const folderName of folders) {
    currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
    ancestors.push(currentPath);
  }
  return ancestors;
}

// ── wikilink 解析（语义对照 HEAD vault-wikilinks.ts resolveVaultWikiLink：根精确 >
// 当前目录 > 唯一后缀；不解析 #heading/^block/跨库别名）────────────────────────

export function resolveVaultWikiLink(
  target: string,
  source: string,
  files: readonly string[],
): string | null {
  const note = target.trim().replace(/\.md$/i, "");
  if (!note || /[#^:]/.test(note)) return null;
  const normalize = (path: string): string | null => {
    const parts: string[] = [];
    for (const part of path.split("/")) {
      if (part === "..") {
        if (!parts.length) return null;
        parts.pop();
      } else if (part && part !== ".") parts.push(part);
    }
    return parts.join("/");
  };
  const stem = (file: string): string => file.replace(/\.md$/i, "");
  const folder = source.slice(0, source.lastIndexOf("/") + 1);
  const relative = normalize(folder + note);
  const root = normalize(note);
  if (note.startsWith("./") || note.startsWith("../")) {
    return relative === null ? null : (files.find((file) => stem(file) === relative) ?? null);
  }
  const exact = files.find((file) => stem(file) === root);
  if (exact) return exact;
  const local = files.find((file) => stem(file) === relative);
  if (local) return local;
  const matches = files.filter((file) => stem(file).endsWith(`/${note}`));
  return matches.length === 1 ? matches[0]! : null;
}

/** 正文 wikilink 提取（渲染可点击目标；`|别名`/`#标题` 取前段）。 */
export function extractWikiLinks(content: string): Array<{ raw: string; target: string }> {
  const links: Array<{ raw: string; target: string }> = [];
  for (const match of content.matchAll(/\[\[([^[\]\n|]+)(?:\|[^[\]\n]+)?\]\]/g)) {
    const target = (match[1] ?? "").trim();
    if (target) links.push({ raw: match[0], target });
  }
  return links;
}

// ── N2/N3 Connections（语义对照 HEAD knowledgeConnectionsModel.ts：建议 = 近邻 − 已链接）──

export function wikilinkTargetOf(relativePath: string): string {
  return relativePath.replace(/\.md$/u, "");
}

export function isNoteLinkedFromContent(content: string, relativePath: string): boolean {
  const targets = new Set([wikilinkTargetOf(relativePath), relativePath]);
  const base = wikilinkTargetOf(relativePath).split("/").pop() ?? "";
  if (base) targets.add(base);
  for (const match of content.matchAll(/\[\[([^[\]]+?)\]\]/gu)) {
    const raw = match[1] ?? "";
    const linked = raw.split(/[|#]/u)[0]?.trim() ?? "";
    if (linked && targets.has(linked)) return true;
  }
  return false;
}

export interface ConnectionsSuggestion {
  candidate: KnowledgeNeighborsCandidate;
  target: string;
}

export function splitLinkSuggestions(
  candidates: readonly KnowledgeNeighborsCandidate[],
  noteContent: string | null,
): { suggested: ConnectionsSuggestion[]; linked: ConnectionsSuggestion[] } {
  const suggested: ConnectionsSuggestion[] = [];
  const linked: ConnectionsSuggestion[] = [];
  for (const candidate of candidates) {
    const entry: ConnectionsSuggestion = {
      candidate,
      target: wikilinkTargetOf(candidate.relativePath),
    };
    // 正文不可读（null）按「未链接」处理——建议宁多勿漏（HEAD 同口径）。
    const isLinked =
      noteContent !== null && isNoteLinkedFromContent(noteContent, candidate.relativePath);
    (isLinked ? linked : suggested).push(entry);
  }
  return { suggested, linked };
}

// ── N1 lookup 结果状态条（语义对照 HEAD knowledgeAskModel：状态码 → 面板文案键）──

export type LookupBanner =
  | "noVault"
  | "indexMissing"
  | "indexing"
  | "indexPartial"
  | "semanticUnavailable"
  | "sourceStale"
  | "noAnswer"
  | "failed";

export function deriveLookupBanners(params: {
  run: KnowledgeRunView | null;
  indexStatus: KnowledgeIndexStatus | null;
}): LookupBanner[] {
  const banners: LookupBanner[] = [];
  const { run, indexStatus } = params;
  // noVault 短路（HEAD deriveAskBanners 同款：未配置时只有这一条）。
  if (run?.status === "no_source" || indexStatus?.configured === false) {
    banners.push("noVault");
    return banners;
  }
  // 索引横幅与 run 无关（run 为 null = 尚未检索，也照发——HEAD 状态条语义）。
  const building = indexStatus?.job?.status === "running";
  const needsBuild =
    Boolean(indexStatus?.configured) && (indexStatus?.coverage.indexedFiles ?? 0) === 0 && !building;
  if (building) banners.push("indexing");
  if (needsBuild) banners.push("indexMissing");
  if (indexStatus?.coverage.partial) banners.push("indexPartial");
  if (indexStatus?.semantic === "unavailable") banners.push("semanticUnavailable");
  if (run?.status === "source_stale") banners.push("sourceStale");
  if (run?.status === "empty") banners.push("noAnswer");
  if (run?.status === "failed") banners.push("failed");
  return banners;
}

// ── widgetState 草稿（§2 display modes 段：后台回收前草稿落宿主内存，重建时经
//    hostContext["drora/widgetState"] 下发恢复；服务端草稿持久化随写操作面补批，D13）──

/** 面板持久化草稿：视图路由 + 打开笔记 + 检索草稿 + 树展开态。形状向后兼容（缺省逐字段回退）。 */
export interface VaultPanelDraft {
  view?: "notes" | "ask" | "insights" | "review";
  openNotePath?: string | null;
  queryDraft?: string;
  expandedFolders?: string[];
}

export function parseDraft(value: unknown): VaultPanelDraft {
  if (typeof value !== "object" || value === null) return {};
  const draft = value as Record<string, unknown>;
  const view =
    draft.view === "notes" || draft.view === "ask" || draft.view === "insights" || draft.view === "review"
      ? draft.view
      : undefined;
  return {
    ...(view ? { view } : {}),
    ...(typeof draft.openNotePath === "string" ? { openNotePath: draft.openNotePath } : {}),
    ...(typeof draft.queryDraft === "string" ? { queryDraft: draft.queryDraft } : {}),
    ...(Array.isArray(draft.expandedFolders)
      ? {
          expandedFolders: draft.expandedFolders.filter(
            (item): item is string => typeof item === "string",
          ),
        }
      : {}),
  };
}

// ── g9 openWith 载荷（宿主→面板 citation 回跳；payload 透传形状由面板自定义）──────

export interface OpenWithCitation {
  kind: "citation";
  receiptId: string;
}

/** 解析宿主 openWith 载荷：只认 citation 一种（§3 映射 g9 四动作清单）；其余忽略返回 null。 */
export function parseOpenWithPayload(payload: unknown): OpenWithCitation | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (record.kind !== "citation" || typeof record.receiptId !== "string" || !record.receiptId) {
    return null;
  }
  return { kind: "citation", receiptId: record.receiptId };
}

/** handoff 文本（g9 openConversationHandoff content[0].text）：语言中立来源清单，
 *  与 HEAD conversationKnowledgeSources 的 manifest 格式解耦（C5b 生产端随面板重建，
 * 旧 chip/manifest 机制不进 webview）——路径/行号来自服务端候选，可复核。 */
export function formatHandoffText(sources: Array<{
  title: string;
  relativePath: string;
  heading: string | null;
  startLine: number;
  endLine: number;
  excerpt: string;
}>): string {
  const lines: string[] = [];
  for (const source of sources) {
    const heading = source.heading ? ` > ${source.heading}` : "";
    lines.push(
      `- ${source.title}（${source.relativePath}${heading}，L${source.startLine}-L${source.endLine}）`,
    );
    lines.push(`  > ${source.excerpt.replace(/\s+/g, " ").trim()}`);
  }
  return lines.join("\n");
}

/** 卷动记忆（旧 useVaultScrollMemory 语义的页面内存版：per-note scrollTop，重开恢复）。 */
export class ScrollMemory {
  #map = new Map<string, number>();

  remember(key: string, scrollTop: number): void {
    this.#map.set(key, scrollTop);
  }

  recall(key: string): number | undefined {
    return this.#map.get(key);
  }
}

/** 展示类型小工具：文件大小（旧面板同数量级呈现）。 */
export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
