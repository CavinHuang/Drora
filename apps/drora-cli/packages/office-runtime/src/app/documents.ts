import { randomUUID } from "node:crypto";
import {
  FILE_CHUNK_BYTES,
  OfficeError,
  type DocumentInfo,
  type DocxBlockKey,
  type FileHandle,
  type Selection,
  type ShowTarget,
  type ViewerSnapshot,
  type ViewState,
} from "#office/contract.ts";
import { formatLocator, parseLocator, splitAnchor } from "#office/domain/anchor.ts";
import type { Hit, ParsedDocument, ReadPage } from "#office/domain/model.ts";
import { cut } from "#office/domain/text.ts";
import type { LoadedFile, WorkspaceFiles } from "#office/adapters/files.ts";

export type Parser = (file: LoadedFile) => Promise<ParsedDocument>;

interface Entry {
  file: LoadedFile;
  fingerprint: string;
  parsed: Promise<ParsedDocument>;
}

const MAX_CACHED = 6;
const MAX_HANDLES = 4;
// 会话多路复用：上限与缺省会话键还原自官方 0.2.1/0.2.2 一轮的 office 插件 dist
// （presentations-plugin/dist/server.mjs :43656-43657，spreadsheets 0.2.1 首现 :65911）。
// 宿主给 MCP server 配 isolation:"workspace" 后，同一工作区多个 agent 会话共享一个
// server 进程，查看器状态必须按调用 _meta.session_id 分桶（specs/official-plugin-sync-2026-10.md §2.3）。
const MAX_SESSIONS = 32;
const DEFAULT_SESSION = "default";

/**
 * Owns everything the viewer knows: parsed documents (cached by path and revision), file handles
 * the panel reads bytes through and the per-session viewer state (the document each session shows
 * and its last reported view). Server tools and the panel only go through this owner.
 */
export function createDocumentOwner({ files, parse }: { files: WorkspaceFiles; parse: Parser }) {
  const cache = new Map<string, Entry>();
  const handles = new Map<string, { bytes: Uint8Array; path: string; revision: string }>();
  const sessions = new Map<string, ReturnType<typeof createSession>>();

  async function entry(input: string): Promise<Entry> {
    const { path } = await files.resolve(input);
    const fingerprint = await files.fingerprint(path);
    const cached = cache.get(path);
    if (cached && cached.fingerprint === fingerprint) {
      cache.delete(path);
      cache.set(path, cached);
      return cached;
    }
    const file = await files.load(path);
    const fresh: Entry = { file, fingerprint, parsed: parse(file) };
    fresh.parsed.catch(() => cache.delete(path));
    cache.set(path, fresh);
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    return fresh;
  }

  async function document(input: string) {
    const item = await entry(input);
    return { file: item.file, doc: await item.parsed };
  }

  const describe = (file: LoadedFile, doc: ParsedDocument): DocumentInfo => ({
    path: file.path,
    kind: file.kind,
    title: doc.title,
    bytes: file.bytes.byteLength,
    revision: file.revision,
    units: doc.units,
    outline: doc.outline,
  });

  /** Validate and normalise a locator for a document; returns its canonical text. */
  function canonical(doc: ParsedDocument, at: string): string {
    return formatLocator(doc.check(parseLocator(doc.kind, at)));
  }

  // 每会话独立状态（current/views/reports/tokens/sequence/revealSeq/disposed）整体下沉到
  // createSession：还原自官方 dist（presentations-plugin/dist/server.mjs :43694-43833）。
  function createSession(id: string) {
    let current: DocumentInfo | null = null;
    let disposed = false;
    const emptyView = (): ViewState => ({
      path: null,
      kind: null,
      at: null,
      selection: null,
      updatedAt: 0,
    });
    const views = new Map<string, ViewState>();
    const reports = new Map<string, number>();
    const tokens: string[] = [];
    let sequence = 0;
    let revealSeq = 0;

    function snapshot(reveal?: { targets: ShowTarget[]; note?: string }): ViewerSnapshot {
      return {
        document: current,
        ...(reveal ? { reveal: { ...reveal, seq: ++revealSeq } } : {}),
      };
    }

    return {
      /** The key this session is stored under; also owns the session's file imports. */
      id,
      async info(path: string): Promise<DocumentInfo> {
        const { file, doc } = await document(path);
        return describe(file, doc);
      },

      /** Make `path` the viewer's document, optionally revealing a location in it. */
      async open(path: string, at?: string | null): Promise<ViewerSnapshot> {
        const { file, doc } = await document(path);
        const target = at ? canonical(doc, at) : null;
        current = describe(file, doc);
        return snapshot(target ? { targets: [{ at: target }] } : undefined);
      },

      /** Point the user at one or more places in one document; opens it if needed. */
      async show(
        targets: { anchor: string; quote?: string }[],
        note?: string,
      ): Promise<ViewerSnapshot> {
        if (!targets.length)
          throw new OfficeError("invalid_anchor", "Give at least one anchor to show.");
        const split = targets.map((target) => ({
          ...splitAnchor(target.anchor),
          quote: target.quote,
        }));
        const path = split[0].path;
        const { path: resolved } = await files.resolve(path);
        for (const item of split) {
          if ((await files.resolve(item.path)).path !== resolved)
            throw new OfficeError(
              "invalid_anchor",
              "All anchors passed to show must be in the same document.",
            );
        }
        const { file, doc } = await document(resolved);
        const resolvedTargets = split.map((item) => ({
          at: item.at ? canonical(doc, item.at) : defaultAt(doc),
          ...(item.quote?.trim() ? { quote: cut(item.quote.trim(), 0, 500) } : {}),
        }));
        current = describe(file, doc);
        return snapshot({
          targets: resolvedTargets,
          ...(note?.trim() ? { note: cut(note.trim(), 0, 500) } : {}),
        });
      },

      async read(
        anchor: string,
        cursor = 0,
      ): Promise<{ info: DocumentInfo; at: string | null; page: ReadPage }> {
        const { path, at } = splitAnchor(anchor);
        const { file, doc } = await document(path);
        const locator = at ? doc.check(parseLocator(doc.kind, at)) : null;
        return {
          info: describe(file, doc),
          at: locator ? formatLocator(locator) : null,
          page: doc.read(locator, cursor),
        };
      },

      async search(
        path: string,
        query: string,
        limit: number,
      ): Promise<{ info: DocumentInfo; hits: Hit[] }> {
        if (!query.trim()) throw new OfficeError("invalid_anchor", "The search query is empty.");
        const { file, doc } = await document(path);
        return { info: describe(file, doc), hits: doc.search(query.trim(), limit) };
      },

      /** Panel only: load bytes for rendering and hand out a token to read them in chunks. */
      async load(
        path: string,
      ): Promise<{ info: DocumentInfo; file: FileHandle; blocks?: DocxBlockKey[] }> {
        const { file, doc } = await document(path);
        // 解析 await 期间本会话可能已被 LRU 逐出：拿到 bytes 后仍要检查，逐出则不发给新令牌，
        // 文案还原自官方 dist（presentations-plugin/dist/server.mjs :43775-43779）。
        if (disposed)
          throw new OfficeError(
            "invalid_token",
            "This viewer session was reset; reload the document.",
          );
        const token = randomUUID();
        handles.set(token, { bytes: file.bytes, path: file.path, revision: file.revision });
        tokens.push(token);
        // MAX_HANDLES 是会话私有 tokens 数组的每会话上限，与官方 0.2.1 dist/server.mjs
        // :43780-43783 逐字节一致（2026-10 dist 对照台账修正：官方本就按会话上限，原注释
        // 误述为"从全局上限改为"）：淘汰只影响本会话最旧令牌。
        while (tokens.length > MAX_HANDLES) handles.delete(tokens.shift()!);
        return {
          info: describe(file, doc),
          file: {
            token,
            bytes: file.bytes.byteLength,
            chunks: Math.max(1, Math.ceil(file.bytes.byteLength / FILE_CHUNK_BYTES)),
          },
          ...(doc.blocks ? { blocks: doc.blocks } : {}),
        };
      },

      /** Panel only: record where the user is. The path must be the panel's current document. */
      async report(input: {
        viewId?: string;
        path: string;
        at?: string | null;
        selection?: Selection | null;
      }): Promise<ViewState> {
        const viewId = input.viewId ?? "legacy";
        const ticket = ++sequence;
        reports.set(viewId, ticket);
        const { path, kind } = await files.resolve(input.path);
        const clip = (text: string) => cut(text, 0, 2000);
        const view: ViewState = {
          path,
          kind,
          at: input.at ? cut(input.at, 0, 300) : null,
          selection: input.selection?.at
            ? { at: cut(input.selection.at, 0, 300), text: clip(input.selection.text ?? "") }
            : null,
          updatedAt: Date.now(),
        };
        // 多窗口不能共用最后写者；上报也不应修改 Agent 专用 surface 的当前文档。
        // 旧上报完成时不能覆盖新上报，也不能重新创建已释放的窗口。
        if (reports.get(viewId) !== ticket) return views.get(viewId) ?? emptyView();
        views.set(viewId, view);
        return view;
      },

      views: () => [...views].map(([viewId, view]) => ({ viewId, ...view })),
      releaseView: (viewId: string) => {
        reports.delete(viewId);
        views.delete(viewId);
      },
      view: (viewId?: string) =>
        viewId
          ? (views.get(viewId) ?? emptyView())
          : views.size === 1
            ? views.values().next().value!
            : emptyView(),
      current: () => current,
      snapshot: () => snapshot(),
      close() {
        current = null;
        reports.clear();
        views.clear();
        return snapshot();
      },
      list: (limit?: number) => files.list({ limit }),

      /** Drop this session's handles when the session itself is dropped（官方 :43827-43831）。 */
      dispose() {
        disposed = true;
        for (const token of tokens.splice(0)) handles.delete(token);
      },
    };
  }

  return {
    /**
     * The viewer state of one session (`_meta.session_id` of the call); calls without one share
     * the default session. Keeps the {@link MAX_SESSIONS} most recently used sessions.
     * LRU 触碰（delete+set）与逐出还原自官方 dist（presentations-plugin/dist/server.mjs :43839-43851）。
     */
    session(id?: string) {
      const key = id || DEFAULT_SESSION;
      let state = sessions.get(key);
      if (state) sessions.delete(key);
      else state = createSession(key);
      sessions.set(key, state);
      while (sessions.size > MAX_SESSIONS) {
        const [oldest, dropped] = sessions.entries().next().value!;
        sessions.delete(oldest);
        dropped.dispose();
      }
      return state;
    },

    /** Panel only: one chunk of a loaded file. Tokens are unique across sessions. */
    chunk(token: string, index: number): string {
      const handle = handles.get(token);
      if (!handle)
        throw new OfficeError("invalid_token", "This file handle expired; reload the document.");
      const start = index * FILE_CHUNK_BYTES;
      if (!Number.isInteger(index) || index < 0 || (start >= handle.bytes.byteLength && index > 0))
        throw new OfficeError("invalid_token", "Chunk index out of range.");
      const data = Buffer.from(handle.bytes.subarray(start, start + FILE_CHUNK_BYTES)).toString(
        "base64",
      );
      // 读到尾块即释放句柄，不等 LRU 淘汰（官方 :43863）；逐出会话遗留的在途读仍可完成。
      if (start + FILE_CHUNK_BYTES >= handle.bytes.byteLength) handles.delete(token);
      return data;
    },
  };
}

function defaultAt(doc: ParsedDocument): string {
  switch (doc.kind) {
    case "pdf":
      return "page:1";
    case "pptx":
      return "slide:1";
    case "docx":
      return "p:1";
    case "xlsx":
      return doc.outline[0]?.at ?? "Sheet1";
  }
}

export type DocumentOwner = ReturnType<typeof createDocumentOwner>;
export type DocumentSession = ReturnType<DocumentOwner["session"]>;
