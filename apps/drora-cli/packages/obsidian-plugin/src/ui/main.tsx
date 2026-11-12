/**
 * Vault 面板入口（§2 UI 重建、§10-P5）。状态单一所有者在本文件：视图组件只收 props。
 *
 * 启动链：connectPanelHost（握手 + g9 openWith 注册）→ 读 status（D14 冲突态先行分支）
 * → 草稿恢复（hostContext["drora/widgetState"]）→ 按视图装载数据（全部 readData =
 * resources/read，无审批）。写操作一律不接线（D13 保守缺省，各视图降级提示）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { connectPanelHost, type VaultPanelHost } from "./host.js";
import { resolveLocale, translator, type MessageKey, type Translate } from "./i18n.js";
import {
  formatHandoffText,
  parseDraft,
  parseOpenWithPayload,
  type FileSegment,
  type KnowledgeIndexStatus,
  type KnowledgeInsightsSnapshot,
  type KnowledgeNeighborsResult,
  type KnowledgeResolveCitationResult,
  type KnowledgeReviewProposalView,
  type KnowledgeRunView,
  type ObsidianVaultSummary,
  type ObsidianVaultTreeEntry,
  type OpenWithCitation,
  type Page,
} from "./model.js";
import { NotesView, type OpenNoteState } from "./NotesView.js";
import { AskView, handoffSourcesOf, type AskState } from "./AskView.js";
import { InsightsView } from "./InsightsView.js";
import { ReviewView, type WriteGateState } from "./ReviewView.js";

type ViewName = "notes" | "ask" | "insights" | "review";

interface PanelState {
  phase: "connecting" | "conflict" | "unconfigured" | "ready" | "error";
  conflictPaths: { legacyDatabasePath: string; pluginDatabasePath: string } | null;
  errorMessage: string | null;
  summary: ObsidianVaultSummary | null;
  indexStatus: KnowledgeIndexStatus | null;
  view: ViewName;
  // notes
  entries: ObsidianVaultTreeEntry[];
  entriesHasMore: boolean;
  entriesTotal: number;
  filter: string;
  expandedFolders: ReadonlySet<string>;
  openNote: OpenNoteState | null;
  neighbors: { loading: boolean; result: KnowledgeNeighborsResult | null };
  // ask
  ask: AskState;
  // insights
  insights: KnowledgeInsightsSnapshot | null;
  insightsLoading: boolean;
  // review
  writeGate: WriteGateState | null;
  proposals: Page<KnowledgeReviewProposalView> | null;
  proposalsError: string | null;
  selectedProposal: KnowledgeReviewProposalView | null;
  proposalLoading: boolean;
  // g9 citation 回跳
  citation:
    | { phase: "locating" | "current" | "stale" | "missing" | "unavailable"; detail: string | null }
    | null;
  // 未配置引导的目录选择结果（g9 openDirectoryPicker）
  pickedPath: string | null;
}

function initialState(): PanelState {
  return {
    phase: "connecting",
    conflictPaths: null,
    errorMessage: null,
    summary: null,
    indexStatus: null,
    view: "notes",
    entries: [],
    entriesHasMore: false,
    entriesTotal: 0,
    filter: "",
    expandedFolders: new Set(),
    openNote: null,
    neighbors: { loading: false, result: null },
    ask: { draft: "", phase: "idle", run: null, error: null, handoffNote: null },
    insights: null,
    insightsLoading: false,
    writeGate: null,
    proposals: null,
    proposalsError: null,
    selectedProposal: null,
    proposalLoading: false,
    citation: null,
    pickedPath: null,
  };
}

function App(props: { host: VaultPanelHost; contextBump: number }) {
  const { host } = props;
  const [state, setState] = useState<PanelState>(initialState);
  const locale = useMemo(() => resolveLocale(host.locale()), [host, props.contextBump]);
  const t: Translate = useMemo(() => translator(locale), [locale]);
  const hostActions = useMemo(
    () => host.hostActionNames(),
    // contextBump 一并触发重算（能力随握手到达）。
    [host, props.contextBump],
  );
  // 请求代号：刷新/重开笔记后旧在途结果丢弃（site generation 同款纪律）。
  const generation = useRef(0);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const update = useCallback((patch: Partial<PanelState>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  /** 草稿持久化（§2 display modes 段）：视图/打开笔记/检索草稿/展开态防抖写宿主内存；
   *  回收重建时经 hostContext 下发恢复。 */
  useEffect(() => {
    clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      host.saveDraft({
        view: state.view,
        openNotePath: state.openNote?.relativePath ?? null,
        queryDraft: state.ask.draft,
        expandedFolders: [...state.expandedFolders],
      });
    }, 400);
  }, [host, state.view, state.openNote?.relativePath, state.ask.draft, state.expandedFolders]);

  const loadStatus = useCallback(async () => {
    generation.current += 1;
    const current = generation.current;
    const result = await host.readData<{
      mode: string;
      index: KnowledgeIndexStatus;
      vault: ObsidianVaultSummary | null;
    }>("status");
    if (current !== generation.current) return null;
    // D14 冲突封套：结构化呈现两库路径，数据面不可用（不静默合并）。
    if (!result.ok && result.error?.code === "dual_db_conflict") {
      update({
        phase: "conflict",
        conflictPaths: {
          legacyDatabasePath: String(result.error.legacyDatabasePath ?? ""),
          pluginDatabasePath: String(result.error.pluginDatabasePath ?? ""),
        },
      });
      return null;
    }
    if (!result.ok || result.data === undefined) {
      update({ phase: "error", errorMessage: result.error?.message ?? "status read failed" });
      return null;
    }
    if (result.data.vault === null) {
      update({ phase: "unconfigured" });
      return null;
    }
    update({ phase: "ready", summary: result.data.vault, indexStatus: result.data.index });
    return result.data;
  }, [host, update]);

  // ── notes 数据装载（§2：列表分页 / 正文分段 / N2 近邻）──────────────────
  const loadEntries = useCallback(
    async (offset: number) => {
      const result = await host.readData<Page<ObsidianVaultTreeEntry>>("files", { offset, limit: 200 });
      if (!result.ok || result.data === undefined) return;
      setState((current) => ({
        ...current,
        entries: offset === 0 ? result.data!.items : [...current.entries, ...result.data!.items],
        entriesHasMore: result.data!.hasMore,
        entriesTotal: result.data!.total,
      }));
    },
    [host],
  );

  const loadNote = useCallback(
    async (relativePath: string, offset: number, revealLine: number | null) => {
      const result = await host.readData<FileSegment>("file", {
        path: relativePath,
        offset,
        limit: 48000,
      });
      setState((current) => {
        const existing = current.openNote;
        if (existing !== null && existing.relativePath !== relativePath) return current;
        if (!result.ok || result.data === undefined) {
          const message = result.error?.message ?? "read failed";
          return {
            ...current,
            openNote:
              existing === null
                ? {
                    relativePath,
                    text: "",
                    nextOffset: 0,
                    hasMore: false,
                    totalChars: 0,
                    sha256: "",
                    modifiedAt: 0,
                    error: message,
                    revealLine: null,
                  }
                : { ...existing, error: message },
          };
        }
        const segment = result.data;
        return {
          ...current,
          openNote: {
            relativePath,
            text: offset === 0 ? segment.content : existing!.text + segment.content,
            nextOffset: segment.offset + segment.content.length,
            hasMore: segment.hasMore,
            totalChars: segment.totalChars,
            sha256: segment.sha256,
            modifiedAt: segment.modifiedAt,
            error: null,
            revealLine,
          },
        };
      });
    },
    [host],
  );

  const loadNeighbors = useCallback(
    async (relativePath: string) => {
      update({ neighbors: { loading: true, result: null } });
      const result = await host.readData<KnowledgeNeighborsResult>("neighbors", {
        path: relativePath,
        limit: 5,
      });
      update({
        neighbors: { loading: false, result: result.ok ? (result.data ?? null) : null },
      });
    },
    [host, update],
  );

  const openNote = useCallback(
    (relativePath: string, revealLine?: number) => {
      const target = revealLine ?? null;
      update({
        openNote: {
          relativePath,
          text: "",
          nextOffset: 0,
          hasMore: false,
          totalChars: 0,
          sha256: "",
          modifiedAt: 0,
          error: null,
          revealLine: target,
        },
      });
      void loadNote(relativePath, 0, target);
      void loadNeighbors(relativePath);
    },
    [update, loadNote, loadNeighbors],
  );

  const loadInsights = useCallback(async () => {
    update({ insightsLoading: true });
    const result = await host.readData<KnowledgeInsightsSnapshot>("insights");
    update({ insightsLoading: false, insights: result.ok ? (result.data ?? null) : null });
  }, [host, update]);

  const loadReview = useCallback(async () => {
    const [gate, list] = await Promise.all([
      host.readData<WriteGateState>("write-gate"),
      host.readData<Page<KnowledgeReviewProposalView>>("proposals", { offset: 0, limit: 50 }),
    ]);
    update({
      writeGate: gate.ok ? (gate.data ?? null) : null,
      proposals: list.ok ? (list.data ?? null) : null,
      proposalsError: list.ok ? null : (list.error?.message ?? "read failed"),
    });
  }, [host, update]);

  // ── 启动链（一次）：status → 草稿恢复 → 视图数据 ────────────────────────
  // 依赖完整声明：loadStatus/loadEntries/openNote/loadInsights/loadReview/update 均为
  // 稳定 useCallback（依赖只有 host 实例与 setState 包装），boot 引用不变 → effect 只跑一次。
  const boot = useCallback(async () => {
    const status = await loadStatus();
    if (status === null) return;
    const draft = parseDraft(host.initialWidgetState());
    const restoredView: ViewName = draft.view ?? "notes";
    update({
      view: restoredView,
      expandedFolders: new Set(draft.expandedFolders ?? []),
      ...(draft.queryDraft ? { ask: { ...initialState().ask, draft: draft.queryDraft } } : {}),
    });
    if (restoredView === "notes" || draft.openNotePath) {
      void loadEntries(0);
      if (draft.openNotePath) openNote(draft.openNotePath);
    } else if (restoredView === "insights") {
      void loadInsights();
    } else if (restoredView === "review") {
      void loadReview();
    }
  }, [host, loadStatus, loadEntries, openNote, loadInsights, loadReview, update]);
  useEffect(() => {
    void boot();
  }, [boot]);

  // ── ask（N1 lookup：检索即终点）─────────────────────────────────────────
  const submitLookup = useCallback(async () => {
    const query = state.ask.draft.trim();
    if (!query) return;
    generation.current += 1;
    const current = generation.current;
    update({ ask: { ...state.ask, phase: "searching", error: null } });
    const result = await host.readData<KnowledgeRunView>("lookup", {
      q: query,
      // clientRequestId 幂等键（防双击/重试双跑，服务端同键返回同一 run）。
      requestId: `panel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    if (current !== generation.current) return;
    if (!result.ok || result.data === undefined) {
      update({
        ask: { ...state.ask, phase: "failed", error: result.error?.message ?? "lookup failed" },
      });
      return;
    }
    update({ ask: { ...state.ask, phase: "done", run: result.data } });
  }, [host, state.ask, update]);

  const handoff = useCallback(
    async (run: KnowledgeRunView) => {
      try {
        await host.openConversationHandoff(formatHandoffText(handoffSourcesOf(run)));
        update({ ask: { ...state.ask, handoffNote: { ok: true, message: t("vault.ask.handoffDone") } } });
      } catch (error) {
        update({
          ask: {
            ...state.ask,
            handoffNote: {
              ok: false,
              message: t("vault.ask.handoffFailed", {
                message: error instanceof Error ? error.message : String(error),
              }),
            },
          },
        });
      }
    },
    [host, state.ask, t, update],
  );

  // ── g9 宿主→面板 citation 回跳（§3：openWith payload → 面板内解析定位）──
  const resolveCitation = useCallback(
    async (citation: OpenWithCitation) => {
      update({ citation: { phase: "locating", detail: null } });
      const result = await host.readData<KnowledgeResolveCitationResult>("citation", {
        receiptId: citation.receiptId,
      });
      if (!result.ok || result.data === undefined) {
        update({
          citation: { phase: "unavailable", detail: result.error?.message ?? "read failed" },
        });
        return;
      }
      const resolved = result.data;
      if (resolved.status === "current" && resolved.citation !== null) {
        const info = resolved.citation;
        update({ citation: { phase: "current", detail: info.title }, view: "notes" });
        void loadEntries(0);
        openNote(info.relativePath, info.quote.startLine);
      } else if (resolved.status === "stale") {
        // 原文已修改（quote 复验失败）：提示过期，不定位（§5.2 状态机）。
        update({ citation: { phase: "stale", detail: null } });
      } else {
        // missing / forbidden：原文不可达。
        update({ citation: { phase: "missing", detail: resolved.reason ?? null } });
      }
    },
    [host, update, loadEntries, openNote],
  );

  useEffect(() => {
    // 注册发生在 connect 之后（connectPanelHost 已 await app.connect，SDK 对未注册
    // 通知直接丢弃——握手前到达的载荷由宿主暂存补发，CONTRACT.md:13）；resolveCitation
    // 为稳定 useCallback，effect 实际只注册一次，重注册经 Set 去重幂等。
    host.onOpenWith((payload) => {
      const citation = parseOpenWithPayload(payload);
      if (citation !== null) void resolveCitation(citation);
    });
  }, [host, resolveCitation]);

  const pickDirectory = useCallback(async () => {
    const result = await host.selectDirectory(t("vault.notConfigured.pick"));
    update({ pickedPath: "error" in result ? null : result.path });
  }, [host, t, update]);

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  if (state.phase === "connecting") {
    return <div className="vault-state vault-state-center">{t("vault.loading")}</div>;
  }
  if (state.phase === "error") {
    return (
      <div className="vault-state vault-state-center vault-state-danger">
        {t("vault.networkError")}
        {state.errorMessage ? (
          <div className="vault-state-detail">{state.errorMessage}</div>
        ) : null}
        <button type="button" className="vault-btn vault-btn-outline" onClick={() => void loadStatus()}>
          {t("vault.retry")}
        </button>
      </div>
    );
  }
  if (state.phase === "conflict") {
    return (
      <div className="vault-fullpage">
        <h2 className="vault-fullpage-title">{t("vault.conflict.title")}</h2>
        <p>{t("vault.conflict.body")}</p>
        <dl className="vault-conflict-paths">
          <div>
            <dt>{t("vault.conflict.legacy")}</dt>
            <dd>{state.conflictPaths?.legacyDatabasePath}</dd>
          </div>
          <div>
            <dt>{t("vault.conflict.plugin")}</dt>
            <dd>{state.conflictPaths?.pluginDatabasePath}</dd>
          </div>
        </dl>
      </div>
    );
  }
  if (state.phase === "unconfigured") {
    return (
      <div className="vault-fullpage">
        <h2 className="vault-fullpage-title">{t("vault.notConfigured.title")}</h2>
        <p>{t("vault.notConfigured.body")}</p>
        <button type="button" className="vault-btn vault-btn-primary" onClick={() => void pickDirectory()}>
          {t("vault.notConfigured.pick")}
        </button>
        {state.pickedPath ? (
          <>
            <p className="vault-picked">
              {t("vault.notConfigured.picked", { path: state.pickedPath })}
            </p>
            <p className="vault-degraded">{t("vault.notConfigured.configurePending")}</p>
          </>
        ) : null}
      </div>
    );
  }

  const refresh = (): void => {
    void loadStatus();
    void loadEntries(0);
    if (state.view === "insights") void loadInsights();
    if (state.view === "review") void loadReview();
  };

  const citationKey: MessageKey | null =
    state.citation === null
      ? null
      : state.citation.phase === "locating"
        ? "vault.citation.locating"
        : state.citation.phase === "current"
          ? "vault.citation.current"
          : state.citation.phase === "stale"
            ? "vault.citation.stale"
            : state.citation.phase === "missing"
              ? "vault.citation.missing"
              : "vault.citation.unavailable";

  return (
    <div className="vault-shell">
      <header className="vault-header">
        <h1 className="vault-header-title" data-vault="header-title">
            {state.summary?.displayName || t("vault.title")}
          </h1>
        <button type="button" className="vault-btn vault-btn-ghost vault-btn-sm" onClick={refresh}>
          {t("vault.refresh")}
        </button>
      </header>
      {state.citation !== null && citationKey !== null ? (
        <div
          className={`vault-banner ${
            state.citation.phase === "current" ? "vault-banner-info" : "vault-banner-warn"
          }`}
        >
          {t(citationKey, {
            title: state.citation.detail ?? "",
            reason: state.citation.detail ?? "",
          })}
        </div>
      ) : null}
      <nav className="vault-tabs" role="tablist">
        {(["notes", "ask", "insights", "review"] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={state.view === view}
            data-vault-tab={view}
            className={`vault-tab ${state.view === view ? "vault-tab-active" : ""}`}
            onClick={() => {
              update({ view });
              if (view === "notes" && state.entries.length === 0) void loadEntries(0);
              if (view === "insights") void loadInsights();
              if (view === "review" && state.proposals === null) void loadReview();
            }}
          >
            {t(`vault.view.${view}`)}
          </button>
        ))}
      </nav>
      <main className="vault-main">
        {state.view === "notes" ? (
          <NotesView
            t={t}
            entries={state.entries}
            entriesHasMore={state.entriesHasMore}
            totalFiles={state.entriesTotal}
            onLoadMoreEntries={() => void loadEntries(state.entries.length)}
            filter={state.filter}
            onFilterChange={(value) => update({ filter: value })}
            expandedFolders={state.expandedFolders}
            onToggleFolder={(relativePath) => {
              const next = new Set(state.expandedFolders);
              if (next.has(relativePath)) next.delete(relativePath);
              else next.add(relativePath);
              update({ expandedFolders: next });
            }}
            onExpandFolders={(relativePaths) => {
              const next = new Set(state.expandedFolders);
              for (const path of relativePaths) next.add(path);
              update({ expandedFolders: next });
            }}
            openNote={state.openNote}
            onOpenNote={(relativePath, revealLine) => openNote(relativePath, revealLine)}
            onLoadMoreNote={() => {
              if (state.openNote) {
                void loadNote(state.openNote.relativePath, state.openNote.nextOffset, null);
              }
            }}
            neighbors={state.neighbors}
          />
        ) : state.view === "ask" ? (
          <AskView
            t={t}
            state={state.ask}
            indexStatus={state.indexStatus}
            handoffSupported={hostActions?.includes("openConversationHandoff") ?? false}
            onDraftChange={(value) => update({ ask: { ...state.ask, draft: value } })}
            onSubmit={() => void submitLookup()}
            onClear={() => update({ ask: { ...initialState().ask } })}
            onJump={(relativePath, startLine) => {
              update({ view: "notes" });
              if (state.entries.length === 0) void loadEntries(0);
              openNote(relativePath, startLine);
            }}
            onHandoff={(run) => void handoff(run)}
          />
        ) : state.view === "insights" ? (
          <InsightsView
            t={t}
            snapshot={state.insights}
            error={null}
            loading={state.insightsLoading}
          />
        ) : (
          <ReviewView
            t={t}
            writeGate={state.writeGate}
            proposals={state.proposals}
            proposalsError={state.proposalsError}
            selected={state.selectedProposal}
            loadingDetail={state.proposalLoading}
            onLoadMore={() => {
              void (async () => {
                if (state.proposals === null) return;
                const result = await host.readData<Page<KnowledgeReviewProposalView>>("proposals", {
                  offset: state.proposals.items.length,
                  limit: 50,
                });
                if (result.ok && result.data) {
                  update({
                    proposals: {
                      items: [...state.proposals.items, ...result.data.items],
                      offset: state.proposals.items.length,
                      limit: result.data.limit,
                      total: result.data.total,
                      hasMore: result.data.hasMore,
                    },
                  });
                }
              })();
            }}
            onSelect={(proposalId) => {
              void (async () => {
                update({ proposalLoading: true });
                const result = await host.readData<KnowledgeReviewProposalView>("proposal", {
                  id: proposalId,
                });
                update({
                  proposalLoading: false,
                  selectedProposal: result.ok ? (result.data ?? null) : null,
                });
              })();
            }}
          />
        )}
      </main>
    </div>
  );
}

/** 连接壳：hostContext 变化触发 contextBump（locale/theme 重算），App 状态不重建。 */
function Boot(): ReactElement {
  const [host, setHost] = useState<VaultPanelHost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextBump, setContextBump] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void connectPanelHost(() => setContextBump((value) => value + 1))
      .then((connected) => {
        if (!cancelled) setHost(connected);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (error !== null) {
    return <div className="vault-state vault-state-center vault-state-danger">{error}</div>;
  }
  if (host === null) {
    return <div className="vault-state vault-state-center">…</div>;
  }
  return <App host={host} contextBump={contextBump} />;
}

const root = createRoot(document.getElementById("root")!);
// 不包 StrictMode：启动链 effect 只能跑一次（status → 草稿恢复 → 数据装载），
// dev 双调用会重复读草稿并触发两次 lookup 幂等键（site 面板同款取舍）。
root.render(<Boot />);
