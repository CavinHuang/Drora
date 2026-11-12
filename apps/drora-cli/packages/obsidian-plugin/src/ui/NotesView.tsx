/**
 * notes 视图：树浏览 + 笔记阅读 + N2/N3 相关笔记（specs/obsidian-vault-phase2-true-
 * extraction.md §2「行为等价基准」的 webview 只读重建）。
 *
 * 与 HEAD v4/VaultView.tsx 的对照关系：树模型/滚动记忆/wikilink 解析语义原样（model.ts
 * 纯函数）；编辑器（LiveMarkdown/CodeMirror）、标题提交、新建/改名/删除、选区浮层是
 * 写操作面——D13 保守缺省降级为提示，等 g10 终裁后另批（§2 审批语义段）。
 */
import { useEffect, useMemo, useRef } from "react";
import type { Translate } from "./i18n.js";
import {
  buildVaultTree,
  extractWikiLinks,
  formatSize,
  getFolderAncestors,
  resolveVaultWikiLink,
  splitLinkSuggestions,
  type KnowledgeNeighborsResult,
  type ObsidianVaultTreeEntry,
  type VaultFolderNode,
} from "./model.js";
import { DegradedWriteNotice, EmptyState, LoadMoreButton } from "./parts.js";

export interface OpenNoteState {
  relativePath: string;
  /** 已加载的拼接正文（分段读取累积）。 */
  text: string;
  nextOffset: number;
  hasMore: boolean;
  totalChars: number;
  sha256: string;
  modifiedAt: number;
  error: string | null;
  /** 定位目标行（citation 回跳 / ask 定位跳转）；消费一次后清除。 */
  revealLine: number | null;
}

export interface NotesViewProps {
  t: Translate;
  entries: ObsidianVaultTreeEntry[];
  entriesHasMore: boolean;
  totalFiles: number;
  onLoadMoreEntries: () => void;
  filter: string;
  onFilterChange: (value: string) => void;
  expandedFolders: ReadonlySet<string>;
  onToggleFolder: (relativePath: string) => void;
  onExpandFolders: (relativePaths: string[]) => void;
  openNote: OpenNoteState | null;
  onOpenNote: (relativePath: string, revealLine?: number) => void;
  onLoadMoreNote: () => void;
  neighbors: { loading: boolean; result: KnowledgeNeighborsResult | null };
}

export function NotesView(props: NotesViewProps) {
  const { t, entries, filter, openNote } = props;
  const filePaths = useMemo(
    () => entries.filter((entry) => entry.kind === "file").map((entry) => entry.relativePath),
    [entries],
  );
  const tree = useMemo(() => buildVaultTree(entries), [entries]);
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return null;
    return entries.filter(
      (entry) => entry.kind === "file" && entry.relativePath.toLowerCase().includes(needle),
    );
  }, [entries, filter]);

  return (
    <div className="vault-notes">
      <aside className="vault-sidebar">
        <div className="vault-sidebar-toolbar">
          <input
            className="vault-filter"
            type="search"
            value={filter}
            placeholder={t("vault.notes.searchPlaceholder")}
            onChange={(event) => props.onFilterChange(event.target.value)}
          />
          <button
            type="button"
            className="vault-btn vault-btn-ghost vault-btn-sm"
            title={t("vault.notes.newNote")}
            disabled
          >
            +
          </button>
        </div>
        {filtered ? (
          filtered.length === 0 ? (
            <EmptyState title={t("vault.notes.noMatch")} />
          ) : (
            <ul className="vault-filelist">
              {filtered.map((entry) =>
                entry.kind === "file" ? (
                  <li key={entry.relativePath}>
                    <button
                      type="button"
                      className={`vault-file ${
                        openNote?.relativePath === entry.relativePath ? "vault-file-active" : ""
                      }`}
                      onClick={() => props.onOpenNote(entry.relativePath)}
                    >
                      <span className="vault-file-name">{entry.name}</span>
                      <span className="vault-file-meta">{formatSize(entry.size)}</span>
                    </button>
                  </li>
                ) : null,
              )}
            </ul>
          )
        ) : (
          <FolderTree
            node={tree}
            expanded={props.expandedFolders}
            onToggle={props.onToggleFolder}
            activePath={openNote?.relativePath ?? null}
            onOpen={props.onOpenNote}
          />
        )}
        {props.entriesHasMore ? (
          <LoadMoreButton t={t} onClick={props.onLoadMoreEntries} />
        ) : (
          <div className="vault-sidebar-count">
            {t("vault.insights.indexedFiles", {
              indexed: filePaths.length,
              total: props.totalFiles,
            })}
          </div>
        )}
      </aside>
      <section className="vault-reader">
        {openNote === null ? (
          <EmptyState title={t("vault.notes.empty")} />
        ) : (
          <NoteReader
            {...props}
            openNote={openNote}
            filePaths={filePaths}
          />
        )}
      </section>
    </div>
  );
}

function FolderTree(props: {
  node: VaultFolderNode;
  expanded: ReadonlySet<string>;
  onToggle: (relativePath: string) => void;
  activePath: string | null;
  onOpen: (relativePath: string) => void;
}) {
  const { node, expanded } = props;
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ul className="vault-tree">
      {folders.map((folder) => {
        const open = expanded.has(folder.relativePath);
        return (
          <li key={folder.relativePath}>
            <button
              type="button"
              className="vault-folder"
              aria-expanded={open}
              onClick={() => props.onToggle(folder.relativePath)}
            >
              <span className="vault-folder-chevron">{open ? "▾" : "▸"}</span>
              <span className="vault-folder-name">{folder.name}</span>
            </button>
            {open ? (
              <FolderTree
                node={folder}
                expanded={expanded}
                onToggle={props.onToggle}
                activePath={props.activePath}
                onOpen={props.onOpen}
              />
            ) : null}
          </li>
        );
      })}
      {files.map((file) => (
        <li key={file.relativePath}>
          <button
            type="button"
            data-vault="note-item"
            data-path={file.relativePath}
            className={`vault-file ${props.activePath === file.relativePath ? "vault-file-active" : ""}`}
            onClick={() => props.onOpen(file.relativePath)}
          >
            <span className="vault-file-name">{file.name}</span>
            <span className="vault-file-meta">{formatSize(file.size)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NoteReader(props: {
  t: Translate;
  openNote: OpenNoteState;
  filePaths: readonly string[];
  neighbors: { loading: boolean; result: KnowledgeNeighborsResult | null };
  onLoadMoreNote: () => void;
  onOpenNote: (relativePath: string, revealLine?: number) => void;
  onExpandFolders: (relativePaths: string[]) => void;
}) {
  const { t, openNote, filePaths } = props;
  const scroller = useRef<HTMLDivElement | null>(null);

  // 滚动记忆：旧 useVaultScrollMemory 语义的页面内存版——离开前记住 scrollTop，
  // 同一篇重开恢复（key = relativePath）。卸载时机由父级持有，这里在路径切换 effect 里读写。
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (openNote.revealLine !== null) {
      const target = node.querySelector(`[data-line="${openNote.revealLine}"]`);
      if (target) target.scrollIntoView({ block: "center" });
      return;
    }
    const remembered = scrollMemory.get(openNote.relativePath);
    if (remembered !== undefined) node.scrollTop = remembered;
  }, [openNote.relativePath, openNote.revealLine, openNote.text]);

  const lines = useMemo(() => openNote.text.split("\n"), [openNote.text]);
  const suggestions = useMemo(() => {
    const neighbors = props.neighbors.result;
    if (neighbors?.status !== "ready" && neighbors?.status !== "partial") return null;
    const split = splitLinkSuggestions(neighbors.candidates, openNote.text);
    const shape = (entries: Array<{ target: string }>) =>
      entries.map((entry) => {
        const candidate = neighbors.candidates.find(
          (item) => entry.target === item.relativePath.replace(/\.md$/u, ""),
        );
        return { target: entry.target, heading: candidate?.matchedHeading ?? null };
      });
    return { suggested: shape(split.suggested), linked: shape(split.linked) };
  }, [props.neighbors.result, openNote.text]);

  return (
    <div className="vault-note-layout">
      <div
        className="vault-note-scroll"
        ref={scroller}
        onScroll={(event) => {
          scrollMemory.set(openNote.relativePath, event.currentTarget.scrollTop);
        }}
      >
        <header className="vault-note-header">
          <h2 className="vault-note-title">{titleOf(openNote.relativePath)}</h2>
          <div className="vault-note-meta">
            {openNote.relativePath} · {formatSize(openNote.totalChars)} ·{" "}
            {new Date(openNote.modifiedAt).toLocaleString()}
          </div>
        </header>
        {openNote.error ? (
          <div className="vault-state vault-state-danger">
            {t("vault.notes.unreadable", { message: openNote.error })}
          </div>
        ) : null}
        <article className="vault-note-body" data-vault="note-body">
          {lines.map((line, index) => (
            <NoteLine
              key={index}
              lineNumber={index + 1}
              line={line}
              source={openNote.relativePath}
              filePaths={filePaths}
              onOpen={(target) => {
                const resolved = resolveVaultWikiLink(target, openNote.relativePath, filePaths);
                if (resolved) {
                  props.onExpandFolders(getFolderAncestors(resolved));
                  props.onOpenNote(resolved);
                }
              }}
            />
          ))}
        </article>
        {openNote.hasMore ? (
          <LoadMoreButton
            t={t}
            onClick={props.onLoadMoreNote}
            label={t("vault.notes.readMore", {
              offset: openNote.nextOffset,
              total: openNote.totalChars,
            })}
          />
        ) : null}
      </div>
      <RelatedNotesRail
        t={t}
        loading={props.neighbors.loading}
        status={props.neighbors.result?.status ?? null}
        suggestions={suggestions}
        onOpen={(path) => {
          props.onExpandFolders(getFolderAncestors(path));
          props.onOpenNote(path);
        }}
      />
    </div>
  );
}

/** 页面模块级滚动记忆（per-note scrollTop；旧面板 per-session store 的页面内存等价物）。 */
const scrollMemory = new Map<string, number>();

function NoteLine(props: {
  lineNumber: number;
  line: string;
  source: string;
  filePaths: readonly string[];
  onOpen: (target: string) => void;
}) {
  const links = extractWikiLinks(props.line);
  if (links.length === 0) {
    return (
      <div className="vault-line" data-line={props.lineNumber}>
        {props.line || "\u00A0"}
      </div>
    );
  }
  // 行内含 wikilink：按链接切分渲染，可解析目标渲染为按钮（旧面板 widget 语义的只读版）。
  const parts: Array<string | { target: string; label: string }> = [];
  let cursor = 0;
  for (const link of links) {
    const at = props.line.indexOf(link.raw, cursor);
    if (at > cursor) parts.push(props.line.slice(cursor, at));
    const aliasMatch = /\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/.exec(link.raw);
    parts.push({
      target: link.target,
      label: (aliasMatch?.[2] ?? aliasMatch?.[1] ?? link.target).trim(),
    });
    cursor = at + link.raw.length;
  }
  if (cursor < props.line.length) parts.push(props.line.slice(cursor));
  return (
    <div className="vault-line" data-line={props.lineNumber}>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <span key={index}>{part}</span>
        ) : (
          <button
            key={index}
            type="button"
            className="vault-wikilink"
            onClick={() => props.onOpen(part.target)}
            title={part.target}
          >
            {part.label}
          </button>
        ),
      )}
    </div>
  );
}

function RelatedNotesRail(props: {
  t: Translate;
  loading: boolean;
  status: string | null;
  suggestions: {
    suggested: Array<{ target: string; heading: string | null }>;
    linked: Array<{ target: string; heading: string | null }>;
  } | null;
  onOpen: (path: string) => void;
}) {
  const { t } = props;
  return (
    <aside className="vault-related">
      <h3 className="vault-related-title">{t("vault.notes.related")}</h3>
      {props.loading ? (
        <div className="vault-state">{t("vault.loading")}</div>
      ) : props.suggestions === null ? (
        <div className="vault-related-empty">{t("vault.notes.relatedEmpty")}</div>
      ) : (
        <>
          {props.suggestions.linked.length > 0 ? (
            <div className="vault-related-group">
              {t("vault.notes.linked", { count: props.suggestions.linked.length })}
            </div>
          ) : null}
          {props.suggestions.suggested.length > 0 ? (
            <>
              <div className="vault-related-group">{t("vault.notes.suggested")}</div>
              <ul className="vault-related-list">
                {props.suggestions.suggested.map((entry) => (
                  <li key={entry.target} className="vault-related-item">
                    <button
                      type="button"
                      className="vault-related-open"
                      onClick={() => props.onOpen(entry.target)}
                      title={entry.heading ?? entry.target}
                    >
                      {entry.target}
                    </button>
                  </li>
                ))}
              </ul>
              {/* N2 一键插入 [[wikilink]] 是写操作（门面 CAS 直写）——D13 保守缺省：列建议、
                  插入降级提示，不放死按钮。 */}
              <DegradedWriteNotice t={t} />
            </>
          ) : null}
        </>
      )}
    </aside>
  );
}

function titleOf(relativePath: string): string {
  const base = relativePath.split("/").pop() ?? relativePath;
  return base.replace(/\.md$/i, "");
}
