/**
 * 智能问库视图（W04 / specs/obsidian-knowledge.md §5c）。
 *
 * 接真实 Query/Index/Citation RPC：createRun→search、getStatus、cancelRun、
 * prepareEvidence→resolveCitation。呈现边界（诚实优先）：
 * - 候选永远是本地检索结果；Jev（W05）未接入前排序增强区只显示「未启用」。
 * - 「加入 Agent」复用 selection UI 承载摘录，并随 sendText 单独携带可信 Receipt；
 *   CLI gate 在 admission / queued promotion 复验。普通 userselect 仍不自带证据特权。
 * - 「跳到原文」只在 resolveCitation 返回 current 后可用。
 * - 全部业务失败以结构化状态呈现，不编造标题/链接（A10）。
 */
import * as React from "react";
import type {
  IKnowledgeIndexService,
  IKnowledgeQueryService,
  KnowledgeIndexStatus,
} from "@drora/services";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { toast as droraToast } from "@/components/ui/toast.js";
import type { MarkdownSelectionTarget } from "@/lib/conversationSelectionReference.js";
import {
  ASK_DEFAULT_VISIBLE_CANDIDATES,
  createInitialKnowledgeAskState,
  deriveAskBanners,
  deriveIndexColdStart,
  getAskOutcome,
  reduceKnowledgeAsk,
  resolveAskIntent,
  sliceCandidates,
  type KnowledgeAskIntent,
  type KnowledgeAskIntentChoice,
  type KnowledgeEvidenceQuote,
} from "./knowledgeAskModel.js";
import {
  AskBannerList,
  KnowledgeCandidateCard,
} from "./KnowledgeCandidateCard.js";
import {
  AskDecisionTrace,
  AskEmptyState,
  AskIndexColdStart,
  AskNoVaultState,
  AskPreviousRound,
  AskSourceStaleState,
} from "./KnowledgeAskResults.js";
import { KnowledgeAskInput } from "./KnowledgeAskInput.js";
import { usePreviousKnowledgeActions } from "./usePreviousKnowledgeActions.js";
import { useKnowledgeAgentActions } from "./useKnowledgeAgentActions.js";
import { useKnowledgeCandidateVerification } from "./useKnowledgeCandidateVerification.js";

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
  onOpenNote: (
    relativePath: string,
    reveal?: KnowledgeEvidenceQuote,
    isCurrent?: () => boolean,
    expectedExcerpt?: string,
    expectedFileSha256?: string,
  ) => void;
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
  const selectionVersionRef = React.useRef(0);
  const inFlightRunIdRef = React.useRef<string | null>(null);
  // 重试必须复用同一 clientRequestId（幂等契约，spec §5b.1/§5c.2）。
  const lastSubmitRef = React.useRef<{ query: string; clientRequestId: string; intent: KnowledgeAskIntent } | null>(null);
  const selectionTarget: MarkdownSelectionTarget | null =
    sessionId && workspaceKey ? { sessionId, workspaceKey } : null;
  const { openingPreviousId, usePreviousCandidate, cancelPendingPrevious, openFollowUpSideChat } = usePreviousKnowledgeActions({
    previous: state.previous,
    queryService,
    sessionId,
    selectionTarget,
    submitSeqRef,
    onOpenNote,
  });

  // A mounted query view may be reused for another session/workspace or RPC host.
  // Discard previous candidates, receipts, retries and pending async completions.
  const scopeRef = React.useRef({ sessionId, workspaceKey, queryService, indexService });
  React.useEffect(() => {
    const prior = scopeRef.current;
    if (prior.sessionId === sessionId && prior.workspaceKey === workspaceKey &&
        prior.queryService === queryService && prior.indexService === indexService) return;
    scopeRef.current = { sessionId, workspaceKey, queryService, indexService };
    submitSeqRef.current += 1;
    inFlightRunIdRef.current = null;
    lastSubmitRef.current = null;
    cancelPendingPrevious();
    dispatch({ type: "scopeReset" });
    setInput("");
    setIndexStatus(null);
    setTraceOpen(false);
  }, [sessionId, workspaceKey, queryService, indexService, cancelPendingPrevious]);

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
    async (rawQuery: string, retry?: { clientRequestId: string; intent: KnowledgeAskIntent }): Promise<void> => {
      const query = rawQuery.trim();
      if (!query || !queryService) return;
      const clientRequestId = retry?.clientRequestId ?? crypto.randomUUID();
      const intent = retry?.intent ?? resolveAskIntent(intentChoice, query);
      lastSubmitRef.current = { query, clientRequestId, intent };
      const seq = ++submitSeqRef.current;
      inFlightRunIdRef.current = null;
      cancelPendingPrevious();
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
          try {
            const settled = await queryService.search({ runId: run.runId });
            // Cancellation or a newer submission invalidates this async result.
            if (seq === submitSeqRef.current && inFlightRunIdRef.current === run.runId) {
              dispatch({ type: "runSettled", run: settled });
            }
          } finally {
            if (seq === submitSeqRef.current && inFlightRunIdRef.current === run.runId) {
              inFlightRunIdRef.current = null;
            }
          }
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
    [cancelPendingPrevious, intentChoice, queryService, refreshIndexStatus, sessionId],
  );

  const retryLast = React.useCallback((): void => {
    const last = lastSubmitRef.current;
    if (!last) return;
    // 复用同一 clientRequestId：Host 重连后服务端幂等返回同一 run（spec §5c.4）。
    void submit(last.query, last);
  }, [submit]);

  const cancel = React.useCallback(async (): Promise<void> => {
    const runId = inFlightRunIdRef.current;
    if (!runId || !queryService) return;
    const cancelSeq = submitSeqRef.current;
    try {
      const result = await queryService.cancelRun({ runId });
      // A completed query must not be marked cancelled just because its ACK arrives late.
      // If cancellation lost the race, let the original search() settle normally.
      if (result.cancelled && submitSeqRef.current === cancelSeq && inFlightRunIdRef.current === runId) {
        dispatch({ type: "cancelSucceeded", runId });
        inFlightRunIdRef.current = null;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [queryService]);

  const startPageIndex = React.useCallback(async (): Promise<void> => {
    if (!indexService || indexActionBusy) return;
    setIndexActionBusy(true);
    try {
      // startReconcile 幂等（spec §5b.8）：任务已在跑时服务端返回 alreadyRunning=true
      // 的既有任务、不产生第二个 job——重复点击被服务端幂等吸收，UI 再以 busy 态 +
      // 「建立中」态替换按钮防抖；随后刷新状态条，引导块切到进行中展示。
      await indexService.startReconcile();
      await refreshIndexStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIndexActionBusy(false);
    }
  }, [indexActionBusy, indexService, refreshIndexStatus]);

  const { verifyEvidence, openCurrentCandidate } = useKnowledgeCandidateVerification({
    state, queryService, sessionId, submitSeqRef, scopeRef, dispatch, onOpenNote,
  });

  const { addingArticleId, handoffBusy, addVerifiedEvidenceToAgent, handoffQuestionToAgent } =
    useKnowledgeAgentActions({
      queryService,
      selectionTarget,
      state,
      submitSeqRef,
      selectionVersionRef,
      verifyEvidence,
    });

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
  const coldStart = deriveIndexColdStart(indexStatus);
  const isRetrieving = outcome === "retrieving" || outcome === "submitting";
  const isEmptyQueryState = outcome === "idle" || outcome === "failed";

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="knowledge-ask-view"
      data-index-configured={indexStatus?.configured === undefined ? "loading" : String(indexStatus.configured)}
      data-indexed-files={indexStatus?.coverage.indexedFiles ?? -1}
      data-index-job-status={indexStatus?.job?.status ?? "none"}
    >
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
          {/* 冷启动索引引导（spec §5c.4）：configured 且索引为空/建立中时常驻，
              不再限于空查询态；未配置 vault 的 noVault 既有语义不受影响。 */}
          {indexStatus?.configured && (coldStart.needsBuild || coldStart.building) && (
            <AskIndexColdStart
              building={coldStart.building}
              busy={indexActionBusy}
              jobIndexedFiles={coldStart.building ? (indexStatus.job?.indexedFiles ?? 0) : null}
              onStart={() => void startPageIndex()}
            />
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
              {currentRound.intent !== "find" && (
                <div className="flex flex-wrap items-center gap-2" data-testid="ask-agent-handoff">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      handoffBusy ||
                      !selectionTarget ||
                      state.selectedArticleIds.length < (currentRound.intent === "compare" ? 2 : 1)
                    }
                    onClick={() => void handoffQuestionToAgent()}
                  >
                    {handoffBusy
                      ? intl.formatMessage({ id: "vault.ask.handoff.checking" })
                      : intl.formatMessage({ id: `vault.ask.handoff.${currentRound.intent}` })}
                  </Button>
                  <span className="text-ui-xs text-foreground-subtle">
                    {intl.formatMessage({
                      id: currentRound.intent === "compare"
                        ? "vault.ask.handoff.compareHint"
                        : "vault.ask.handoff.answerHint",
                    })}
                  </span>
                </div>
              )}
              {slice.visible.map((candidate) => (
                <KnowledgeCandidateCard
                  key={candidate.articleId}
                  candidate={candidate}
                  query={currentRound.submittedQuery}
                  selected={currentRound.intent === "find" ? state.selectedArticleId === candidate.articleId : state.selectedArticleIds.includes(candidate.articleId)}
                  inspect={state.evidence[candidate.articleId]}
                  sessionId={sessionId}
                  selectionTarget={selectionTarget}
                  adding={addingArticleId === candidate.articleId}
                  onAddToAgent={(entry) => void addVerifiedEvidenceToAgent(entry)}
                  onOpenNote={(candidate) => void openCurrentCandidate(candidate)}
                  onSelect={(articleId) => {
                    // Invalidate pending evidence batches synchronously before React render.
                    selectionVersionRef.current += 1;
                    dispatch({ type: "candidateSelected", articleId });
                  }}
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
              openingArticleId={openingPreviousId}
              canAddToAgent={Boolean(selectionTarget?.sessionId)}
              onOpenNote={(candidate) => void usePreviousCandidate(candidate, "open")}
              onAddToAgent={(candidate) => void usePreviousCandidate(candidate, "attach")}
            />
          )}

          {/* Decision trace：默认折叠（工作单要求），收纳全部诊断数据 */}
          <AskDecisionTrace run={currentRun} open={traceOpen} onOpenChange={setTraceOpen} />
        </div>
      </div>
    </section>
  );
}
