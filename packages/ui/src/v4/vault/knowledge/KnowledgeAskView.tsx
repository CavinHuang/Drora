/**
 * 智能问库视图（W04 / specs/obsidian-knowledge.md §5c）。
 *
 * 接真实 Query/Index/Citation RPC：createRun→search、getStatus、cancelRun、
 * prepareEvidence→resolveCitation。呈现边界（诚实优先）：
 * - 候选永远是本地检索结果；Jev（W05）未接入前排序增强区只显示「未启用」。
 * - 「加入 Agent」走既有 selection 引用通道（userselect 数据语义，不是 Receipt，
 *   不获执行时复验——spec §5.4），按钮文案明示。
 * - 「跳到原文」只在 resolveCitation 返回 current 后可用。
 * - 全部业务失败以结构化状态呈现，不编造标题/链接（A10）。
 */
import * as React from "react";
import type {
  IKnowledgeIndexService,
  IKnowledgeQueryService,
  KnowledgeArticleCandidate,
  KnowledgeIndexStatus,
} from "@drora/services";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { toast as droraToast } from "@/components/ui/toast.js";
import {
  createConversationSelectionReference,
  type MarkdownSelectionTarget,
} from "@/lib/conversationSelectionReference.js";
import { buildSelectionSideChatKey, requestSelectionSideChatOpen } from "@/lib/selectionSideChatRuntime.js";
import {
  ASK_DEFAULT_VISIBLE_CANDIDATES,
  createInitialKnowledgeAskState,
  deriveAskBanners,
  getAskOutcome,
  reduceKnowledgeAsk,
  resolveAskIntent,
  sliceCandidates,
  type KnowledgeAskIntentChoice,
  type KnowledgeEvidenceQuote,
} from "./knowledgeAskModel.js";
import {
  AskBannerList,
  KnowledgeCandidateCard,
  displayCandidateTitle,
} from "./KnowledgeCandidateCard.js";
import {
  AskBuildIndexButton,
  AskDecisionTrace,
  AskEmptyState,
  AskNoVaultState,
  AskPreviousRound,
  AskSourceStaleState,
} from "./KnowledgeAskResults.js";
import { KnowledgeAskInput } from "./KnowledgeAskInput.js";

const toast = {
  error: (message: string): void => {
    droraToast(message, { variant: "warning" });
  },
};

export interface KnowledgeAskViewProps {
  indexService: IKnowledgeIndexService | null;
  queryService: IKnowledgeQueryService | null;
  sessionId?: string;
  workspaceKey?: string;
  /** 证据回跳：切到笔记视图并打开目标笔记（reveal = quote 行号区间）。 */
  onOpenNote: (relativePath: string, reveal?: KnowledgeEvidenceQuote) => void;
  /** 无 Vault 时的引导动作（切回笔记视图使用左下角连接器）。 */
  onGoToNotes: () => void;
}

export function KnowledgeAskView({
  indexService,
  queryService,
  sessionId,
  workspaceKey,
  onOpenNote,
  onGoToNotes,
}: KnowledgeAskViewProps): React.ReactElement {
  const { intl } = useDroraIntl();
  const [state, dispatch] = React.useReducer(
    reduceKnowledgeAsk,
    undefined,
    createInitialKnowledgeAskState,
  );
  const [input, setInput] = React.useState("");
  const [intentChoice, setIntentChoice] = React.useState<KnowledgeAskIntentChoice>("auto");
  const [indexStatus, setIndexStatus] = React.useState<KnowledgeIndexStatus | null>(null);
  const [indexActionBusy, setIndexActionBusy] = React.useState(false);
  const [traceOpen, setTraceOpen] = React.useState(false);
  // Decision trace 默认折叠（工作单要求）：traceOpen 初始 false，展开状态不持久化。
  const submitSeqRef = React.useRef(0);
  const inFlightRunIdRef = React.useRef<string | null>(null);
  // 重试必须复用同一 clientRequestId（幂等契约，spec §5b.1/§5c.2）。
  const lastSubmitRef = React.useRef<{ query: string; clientRequestId: string } | null>(null);

  const selectionTarget: MarkdownSelectionTarget | null =
    sessionId && workspaceKey ? { sessionId, workspaceKey } : null;

  const refreshIndexStatus = React.useCallback(async (): Promise<void> => {
    if (!indexService) return;
    try {
      setIndexStatus(await indexService.getStatus());
    } catch {
      // Host 断连等场景：状态条如实显示不可用，不打断检索主流程。
      setIndexStatus(null);
    }
  }, [indexService]);

  React.useEffect(() => {
    void refreshIndexStatus();
  }, [refreshIndexStatus]);

  // 索引任务进行中轮询状态条；job 离场后自动停止（轮询条件不满足）。
  React.useEffect(() => {
    const jobStatus = indexStatus?.job?.status;
    if (jobStatus !== "running") return;
    const timer = window.setInterval(() => {
      void refreshIndexStatus();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [indexStatus?.job?.status, refreshIndexStatus]);

  React.useEffect(() => {
    if (!queryService) return;
    // 迟到事件守卫（runId+代数+seq）在 reducer 内；订阅本身随组件卸载释放。
    const subscription = queryService.onRunUpdated((event) => {
      dispatch({ type: "runEvent", event });
    });
    return () => subscription.dispose();
  }, [queryService]);

  const submit = React.useCallback(
    async (rawQuery: string): Promise<void> => {
      const query = rawQuery.trim();
      if (!query || !queryService) return;
      const clientRequestId = crypto.randomUUID();
      const intent = resolveAskIntent(intentChoice, query);
      lastSubmitRef.current = { query, clientRequestId };
      const seq = ++submitSeqRef.current;
      inFlightRunIdRef.current = null;
      dispatch({ type: "submitStarted", query, clientRequestId, intent });
      try {
        const run = await queryService.createRun({
          query,
          clientRequestId,
          sessionId: sessionId ?? undefined,
        });
        // 已被更新的提交取代（seq 不匹配）→ 丢弃，避免旧 run 借新提交的元数据落位。
        if (seq !== submitSeqRef.current) return;
        dispatch({ type: "runCreated", run });
        if (run.status === "retrieving") {
          inFlightRunIdRef.current = run.runId;
          const settled = await queryService.search({ runId: run.runId });
          // runId 守卫在 reducer（A22）；这里无需再比对。
          dispatch({ type: "runSettled", run: settled });
        }
        void refreshIndexStatus();
      } catch (error) {
        if (seq !== submitSeqRef.current) return;
        dispatch({
          type: "submitFailed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [intentChoice, queryService, refreshIndexStatus, sessionId],
  );

  const retryLast = React.useCallback((): void => {
    const last = lastSubmitRef.current;
    if (!last) return;
    // 复用同一 clientRequestId：Host 重连后服务端幂等返回同一 run（spec §5c.4）。
    void submit(last.query);
  }, [submit]);

  const cancel = React.useCallback(async (): Promise<void> => {
    const runId = inFlightRunIdRef.current;
    if (!runId || !queryService) return;
    try {
      await queryService.cancelRun({ runId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      // 取消后保留已有候选展示（PRD：禁止清空上次可用结果）。
      dispatch({ type: "cancelSucceeded" });
      inFlightRunIdRef.current = null;
    }
  }, [queryService]);

  const startPageIndex = React.useCallback(async (): Promise<void> => {
    if (!indexService || indexActionBusy) return;
    setIndexActionBusy(true);
    try {
      await indexService.startReconcile();
      await refreshIndexStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIndexActionBusy(false);
    }
  }, [indexActionBusy, indexService, refreshIndexStatus]);

  const verifyEvidence = React.useCallback(
    async (candidate: KnowledgeArticleCandidate): Promise<void> => {
      const runId = state.current?.run.runId;
      if (!queryService || !runId) return;
      dispatch({ type: "evidenceChecking", articleId: candidate.articleId });
      try {
        const prepared = await queryService.prepareEvidence({ runId, articleId: candidate.articleId });
        if (prepared.status !== "current") {
          dispatch({
            type: "evidenceResolved",
            articleId: candidate.articleId,
            state: { phase: "unavailable", status: prepared.status, reason: null },
          });
          return;
        }
        const resolved = await queryService.resolveCitation({
          receiptId: prepared.receipt.receiptId,
          sessionId: sessionId ?? undefined,
        });
        // KnowledgeResolveCitationResult 的失败分支 status 词表含 "current"（类型上不可
        // 区分），因此以 citation 是否存在为准做窄化，status/reason 经 "in" 守卫读取。
        const resolvedReason = "reason" in resolved ? resolved.reason : null;
        if (resolved.status === "current" && resolved.citation) {
          dispatch({
            type: "evidenceResolved",
            articleId: candidate.articleId,
            state: {
              phase: "verified",
              receiptId: resolved.citation.receiptId,
              excerpt: resolved.citation.excerpt,
              relativePath: resolved.citation.relativePath,
              title: resolved.citation.title,
              heading: resolved.citation.heading,
              quote: resolved.citation.quote,
            },
          });
        } else {
          dispatch({
            type: "evidenceResolved",
            articleId: candidate.articleId,
            state: {
              phase: "unavailable",
              status: resolved.status === "current" ? "forbidden" : resolved.status,
              reason: resolvedReason,
            },
          });
        }
      } catch (error) {
        dispatch({
          type: "evidenceResolved",
          articleId: candidate.articleId,
          state: {
            phase: "failed",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    },
    [queryService, sessionId, state.current?.run.runId],
  );

  const openFollowUpSideChat = React.useCallback(
    (candidate: KnowledgeArticleCandidate): void => {
      // MarkdownSelectionTarget.sessionId 类型允许 null；追问需要真实会话 id。
      if (!selectionTarget?.sessionId) {
        toast.error(intl.formatMessage({ id: "vault.ask.candidate.needSession" }));
        return;
      }
      const sideChatKey = buildSelectionSideChatKey(selectionTarget.workspaceKey, selectionTarget.sessionId);
      const reference = createConversationSelectionReference({
        contentType: "markdown",
        sourceKey: `vault:${candidate.relativePath}`,
        sourceTitle: displayCandidateTitle(candidate),
        path: candidate.relativePath,
        text: candidate.excerpt,
      });
      if (!requestSelectionSideChatOpen(sideChatKey, reference)) {
        toast.error(intl.formatMessage({ id: "vault.selection.sideChatFailed" }));
      }
    },
    [intl, selectionTarget],
  );

  if (!queryService || !indexService) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center" data-testid="ask-unavailable">
        <p className="px-6 text-center text-ui-sm text-muted-foreground">
          {intl.formatMessage({ id: "vault.ask.serviceUnavailable" })}
        </p>
      </section>
    );
  }

  const outcome = getAskOutcome(state);
  const banners = deriveAskBanners({ state, indexStatus, hasSession: Boolean(sessionId) });
  const currentRound = state.current;
  const currentRun = currentRound?.run ?? null;
  const slice = sliceCandidates(currentRun?.candidates ?? [], state.visibleCandidateLimit);
  const job = indexStatus?.job ?? null;
  const isRetrieving = outcome === "retrieving" || outcome === "submitting";
  const isEmptyQueryState = outcome === "idle" || outcome === "failed";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="knowledge-ask-view">
      <div className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col gap-3 px-4 py-4">
        {/* 状态条：低噪音，位于输入上方（PRD V07：结果顶部固定状态说明） */}
        <AskBannerList banners={banners} />

        {/* 输入区（意图/输入/取消/重试，spec §5c.3） */}
        <KnowledgeAskInput
          input={input}
          onInputChange={setInput}
          intentChoice={intentChoice}
          onIntentChoiceChange={setIntentChoice}
          indexStatus={indexStatus}
          retrieving={isRetrieving}
          failed={outcome === "failed"}
          canRetry={Boolean(lastSubmitRef.current)}
          onSubmit={() => {
            void submit(input);
          }}
          onCancel={() => {
            void cancel();
          }}
          onRetry={retryLast}
          onConnectVault={onGoToNotes}
        />

        {/* 结果区 */}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" data-testid="ask-results">
          {isEmptyQueryState && state.error && (
            <p
              className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-ui-sm text-destructive"
              data-testid="ask-error"
            >
              {intl.formatMessage({ id: "vault.ask.error" }, { message: state.error })}
            </p>
          )}
          {isEmptyQueryState && !state.error && <AskEmptyState />}
          {outcome === "noVault" && <AskNoVaultState onConnect={onGoToNotes} />}
          {indexStatus?.configured && indexStatus.coverage.indexedFiles === 0 && !job && isEmptyQueryState && (
            <AskBuildIndexButton busy={indexActionBusy} onStart={() => void startPageIndex()} />
          )}
          {currentRound &&
            (outcome === "ready" || outcome === "partial" || outcome === "empty" || outcome === "cancelled") && (
            <div className="flex flex-col gap-2">
              <p className="text-ui-sm text-foreground-subtle" data-testid="ask-result-summary">
                {intl.formatMessage(
                  { id: "vault.ask.candidates.count" },
                  { count: currentRun?.candidates.length ?? 0 },
                )}
                {currentRound.cancelledByUser && (
                  <span className="ml-2 text-ui-xs text-foreground-subtlest">
                    ({intl.formatMessage({ id: "vault.ask.cancelled.suffix" })})
                  </span>
                )}
              </p>
              {slice.visible.map((candidate) => (
                <KnowledgeCandidateCard
                  key={candidate.articleId}
                  candidate={candidate}
                  selected={state.selectedArticleId === candidate.articleId}
                  inspect={state.evidence[candidate.articleId]}
                  sessionId={sessionId}
                  selectionTarget={selectionTarget}
                  onOpenNote={(relativePath, reveal) => {
                    onOpenNote(relativePath, reveal);
                  }}
                  onSelect={(articleId) => dispatch({ type: "candidateSelected", articleId })}
                  onVerify={(entry) => void verifyEvidence(entry)}
                  onFollowUp={openFollowUpSideChat}
                />
              ))}
              {slice.canExpand && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="self-center"
                  onClick={() =>
                    dispatch({
                      type: "expandCandidates",
                      limit: currentRun?.candidates.length ?? ASK_DEFAULT_VISIBLE_CANDIDATES,
                    })
                  }
                >
                  {intl.formatMessage({ id: "vault.ask.expandMore" }, { count: slice.hiddenCount })}
                </Button>
              )}
            </div>
          )}
          {outcome === "sourceStale" && currentRound && <AskSourceStaleState />}

          {/* 上一轮（追问后保留，默认折叠展示） */}
          {state.previous && (
            <AskPreviousRound
              candidates={state.previous.run.candidates}
              submittedQuery={state.previous.submittedQuery}
              onOpenNote={(relativePath) => onOpenNote(relativePath)}
            />
          )}

          {/* Decision trace：默认折叠（工作单要求），收纳全部诊断数据 */}
          <AskDecisionTrace run={currentRun} open={traceOpen} onOpenChange={setTraceOpen} />
        </div>
      </div>
    </section>
  );
}
