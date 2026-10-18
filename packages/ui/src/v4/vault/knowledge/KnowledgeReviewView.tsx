/* eslint-disable max-lines -- 写授权状态卡、L2 开关与提案列表/动作是同一审核视图面（服务编排共享 state 与 runAction），拆文件会割裂状态所有权（与 reviewEngine.ts / host registry 同先例）。 */ /**
 * 审核视图（W04 状态卡 + W09 真实 review 服务消费，specs/obsidian-knowledge.md §5e.11/§5e.12）。
 *
 * 消费真实 IKnowledgeReviewService：提案列表、目标内容预览（getProposalChangeContent）、
 * 批准/拒绝/应用/undo/reconcile 全链人工动作。全部错误以服务端结构化结果呈现，UI 不做
 * 二次推断、不伪造提案；当前人工提案入口见 §5e.14。
 * L2 写路径开关（writePathEnabled）缺省关闭；开启经服务端 setWritePathEnabled 持久化到
 * vault-config.json（唯一写入入口），进程内立即生效。
 */
import * as React from "react";
import {
  BookOpenText,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type {
  IKnowledgeReviewService,
  IObsidianVaultService,
  KnowledgeReviewApplyResult,
  KnowledgeReviewChangeKind,
  KnowledgeReviewFileStatus,
  KnowledgeReviewOperationStatus,
  KnowledgeReviewOperationView,
  KnowledgeReviewProposalView,
  KnowledgeReviewUndoResult,
  ObsidianVaultSummary,
} from "@drora/services";
import { createUuid } from "@drora/shared";
import { KnowledgeReviewProposalComposer } from "./KnowledgeReviewProposalComposer.js";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { toast as droraToast } from "@/components/ui/toast.js";

/** 服务端结构化拒绝 → 用户可读文案；未知码原样透出（不本地伪造语义）。 */
function reviewActionErrorMessage(
  error: unknown,
  intl: ReturnType<typeof useDroraIntl>["intl"],
): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("write_path_disabled")) {
    return intl.formatMessage({ id: "vault.review.error.writePathDisabled" });
  }
  if (raw.includes("approval_missing") || raw.includes("approval_expired")) {
    return intl.formatMessage({ id: "vault.review.error.approvalInvalid" });
  }
  if (raw.includes("conflict")) {
    return intl.formatMessage({ id: "vault.review.error.conflict" });
  }
  if (raw.includes("revision_mismatch") || raw.includes("changes_hash_mismatch")) {
    return intl.formatMessage({ id: "vault.review.error.revisionMismatch" });
  }
  if (raw.includes("forbidden")) {
    return intl.formatMessage({ id: "vault.review.error.forbidden" });
  }
  return intl.formatMessage({ id: "vault.review.error.generic" }, { detail: raw.slice(0, 160) });
}

function proposalPhaseKey(
  proposal: KnowledgeReviewProposalView,
  nowMs: number,
): "rejected" | "approvedCurrent" | "approvalExpired" | "pending" {
  if (proposal.rejected) return "rejected";
  if (proposal.approval) {
    return proposal.approval.revision === proposal.revision &&
      proposal.approval.changesHash === proposal.changesHash &&
      proposal.approval.expiresAtMs > nowMs
      ? "approvedCurrent"
      : "approvalExpired";
  }
  return "pending";
}

/**
 * 账本状态枚举 → i18n 键的静态映射（增量评审 ui-review-6：操作状态行不得把
 * applied/applying/undoing 等英文枚举原样插进中文界面）。键集合双语对齐，
 * 由 knowledgeUiDiscipline 测试兜底。
 */
const OPERATION_STATUS_KEYS: Record<KnowledgeReviewOperationStatus, string> = {
  prepared: "vault.review.operationStatus.prepared",
  applying: "vault.review.operationStatus.applying",
  applied: "vault.review.operationStatus.applied",
  conflict: "vault.review.operationStatus.conflict",
  uncertain: "vault.review.operationStatus.uncertain",
};
const FILE_STATUS_KEYS: Record<KnowledgeReviewFileStatus, string> = {
  prepared: "vault.review.fileStatus.prepared",
  applying: "vault.review.fileStatus.applying",
  applied: "vault.review.fileStatus.applied",
  conflict: "vault.review.fileStatus.conflict",
  not_landed: "vault.review.fileStatus.notLanded",
  undoing: "vault.review.fileStatus.undoing",
  undo_applied: "vault.review.fileStatus.undoApplied",
  undo_conflict: "vault.review.fileStatus.undoConflict",
};
/**
 * 变更类型枚举 → i18n 键静态映射（ui-know-a-4，2026-10-18 终审）：提案文件行原先把
 * create/write/delete 英文枚举原样插进界面；与 OPERATION_STATUS_KEYS 同模式收口，
 * 键集合双语对齐由 knowledgeUiDiscipline 测试兜底。
 */
const CHANGE_KIND_KEYS: Record<KnowledgeReviewChangeKind, string> = {
  create: "vault.review.changeKind.create",
  write: "vault.review.changeKind.write",
  delete: "vault.review.changeKind.delete",
};

/** 操作是否处于需要人工 reconcile 落定的卡点态（applying/uncertain/undoing）。 */
function isOperationStuck(operation: KnowledgeReviewOperationView): boolean {
  return (
    operation.status === "applying" ||
    operation.status === "uncertain" ||
    // file 状态联合无 uncertain（不确定态只落在 operation 级）；undoing 为跨 Host 撤销领用。
    operation.files.some((file) => file.status === "applying" || file.status === "undoing")
  );
}

export function KnowledgeReviewView({
  vaultService,
  reviewService,
  onGoToNotes,
}: {
  vaultService: IObsidianVaultService | null;
  reviewService: IKnowledgeReviewService | null;
  /** 未配置 Vault 引导空态的「去笔记页」回跳（spec §5e.11：未配置 → 引导）。 */
  onGoToNotes?: () => void;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  const [summary, setSummary] = React.useState<ObsidianVaultSummary | null>(null);
  // ui-know-a-1 修复（2026-10-18 终审，阻塞④）：区分「加载中」与「已加载且 getSummary
  // resolve null（未配置 Vault）」——此前 null 永久渲染 loading，spec §5e.11 明文要求
  // 未配置时给出引导空态而非无限等待。
  const [summaryLoaded, setSummaryLoaded] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [proposals, setProposals] = React.useState<readonly KnowledgeReviewProposalView[] | null>(
    null,
  );
  const [listFailed, setListFailed] = React.useState(false);
  const [writePathEnabled, setWritePathEnabled] = React.useState<boolean | null>(null);
  const [writeSafetyGatePassed, setWriteSafetyGatePassed] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  // null = a deliberate delete preview; false = RPC error/unavailable.
  // Never render a read failure as if the proposal deleted the note.
  const [changeContents, setChangeContents] = React.useState<
    ReadonlyMap<string, string | null | false>
  >(() => new Map());
  /** Operation ledger is durable; do not keep undo targets only in renderer memory. */
  const [operations, setOperations] = React.useState<readonly KnowledgeReviewOperationView[]>([]);
  // 预览取数的代际令牌：refresh 重置预览状态时递增，迟到的在途响应按代际丢弃，
  // 防止「refresh 强制收起面板 → 旧响应写回空缓存 → previewsReviewed 误真」的
  // fail-open 竞态（增量评审 ui-review-1：批准门禁可能对从未渲染的内容放行）。
  const previewGenerationRef = React.useRef(0);
  const appliedOperations = React.useMemo(() => {
    const targets = new Map<string, string>();
    for (const operation of operations) {
      if (targets.has(operation.proposalId)) continue;
      // A mixed/partially reverted operation can still contain undoable files,
      // but an outstanding undo claim must first be handled, not overwritten.
      if (operation.files.some((file) => file.status === "undoing")) continue;
      if (operation.files.some((file) => file.status === "applied")) {
        targets.set(operation.proposalId, operation.operationId);
      }
    }
    return targets;
  }, [operations]);

  const refreshSummary = React.useCallback(async (): Promise<void> => {
    if (!vaultService) return;
    try {
      setSummary(await vaultService.getSummary());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setSummaryLoaded(true);
    }
  }, [vaultService]);

  const refresh = React.useCallback(async (): Promise<void> => {
    if (!reviewService) return;
    try {
      const [list, history, writePath, gate] = await Promise.all([
        reviewService.listProposals(),
        reviewService.listRecentOperations(),
        Promise.resolve(reviewService.isWritePathEnabled()),
        Promise.resolve(reviewService.isWritePathActivationAllowed()),
      ]);
      setProposals(list);
      setOperations(history);
      // Reset both halves of the preview state. A failed/stale result must be
      // refetchable via Refresh; keeping a panel open with an empty cache would
      // otherwise leave it stuck on "loading" indefinitely.
      previewGenerationRef.current += 1;
      setExpanded(new Set());
      setChangeContents(new Map());
      setWritePathEnabled(writePath);
      setWriteSafetyGatePassed(gate);
      setListFailed(false);
    } catch {
      setListFailed(true);
    }
  }, [reviewService]);

  React.useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = React.useCallback(
    async (key: string, action: () => Promise<string | null>): Promise<void> => {
      setBusy(key);
      setActionMessage(null);
      try {
        const message = await action();
        if (message) {
          droraToast(message, { variant: "info" });
        }
        await refresh();
      } catch (error) {
        setActionMessage(reviewActionErrorMessage(error, intl));
      } finally {
        setBusy(null);
      }
    },
    [intl, refresh],
  );

  const toggleWritePath = React.useCallback(
    (enabled: boolean) => {
      void runAction("writePath", async () => {
        if (!reviewService) return null;
        await reviewService.setWritePathEnabled(enabled);
        setWritePathEnabled(enabled);
        return null;
      });
    },
    [reviewService, runAction],
  );

  const toggleAgentWrites = React.useCallback(
    (enabled: boolean) => {
      void runAction("agentWrites", async () => {
        if (!vaultService) return null;
        // Revoking or changing L1 permission also invalidates L2's current
        // authorization and approval epoch; disable the L2 user switch first.
        if (writePathEnabled && reviewService) {
          await reviewService.setWritePathEnabled(false);
        }
        const nextSummary = await vaultService.setAgentWritesEnabled({ enabled });
        setSummary(nextSummary);
        setWritePathEnabled(false);
        return null;
      });
    },
    [reviewService, runAction, vaultService, writePathEnabled],
  );

  const applyProposal = React.useCallback(
    (proposal: KnowledgeReviewProposalView) => {
      void runAction(`apply:${proposal.proposalId}`, async () => {
        if (!reviewService) return null;
        // operationId 是调用方幂等键（A33）：重复提交返回账本既有记录，绝不二次执行。
        const result: KnowledgeReviewApplyResult = await reviewService.applyProposal({
          proposalId: proposal.proposalId,
          operationId: createUuid(),
        });
        if (result.outcome === "applied") return intl.formatMessage({ id: "vault.review.applied" });
        if (result.outcome === "idempotent_replay") {
          return intl.formatMessage({ id: "vault.review.idempotentReplay" });
        }
        if (result.outcome === "reconcile_required") {
          return intl.formatMessage({ id: "vault.review.reconcileRequired" });
        }
        // conflict / blocked：结构化原因由错误横幅或 reason 呈现。
        setActionMessage(
          result.reason === "write_path_disabled"
            ? intl.formatMessage({ id: "vault.review.error.writePathDisabled" })
            : (result.message ??
                intl.formatMessage(
                  { id: "vault.review.error.generic" },
                  { detail: result.reason ?? "" },
                )),
        );
        return null;
      });
    },
    [intl, reviewService, runAction],
  );

  const undoOperation = React.useCallback(
    (proposal: KnowledgeReviewProposalView) => {
      void runAction(`undo:${proposal.proposalId}`, async () => {
        if (!reviewService) return null;
        const operationId = appliedOperations.get(proposal.proposalId) ?? null;
        if (!operationId) {
          setActionMessage(intl.formatMessage({ id: "vault.review.error.noUndoTarget" }));
          return null;
        }
        const result: KnowledgeReviewUndoResult = await reviewService.undoOperation({
          operationId,
        });
        if (result.outcome === "applied" || result.outcome === "partial") {
          return intl.formatMessage({ id: "vault.review.undone" });
        }
        setActionMessage(
          result.message ??
            intl.formatMessage({ id: "vault.review.error.generic" }, { detail: result.outcome }),
        );
        return null;
      });
    },
    [appliedOperations, intl, reviewService, runAction],
  );

  const reconcileStuck = React.useCallback(
    (operationId: string) => {
      void runAction(`reconcile:${operationId}`, async () => {
        if (!reviewService) return null;
        // reconcile 是只读盘面核验 + 账本落定（A33：绝不写盘、绝不自动重放），
        // 是 applying/uncertain/undoing 卡点在产品内的唯一解除路径，S03 NO-GO
        // 期间也必须可用（增量评审 D-1/l2-engine-4：此前接口存在但 UI 零接线，
        // apply 返回 reconcile_required 后用户无路可走）。
        const result = await reviewService.reconcileOperation({ operationId });
        if (result.outcome === "reconciled") {
          return intl.formatMessage({ id: "vault.review.reconciled" });
        }
        if (result.outcome === "not_applicable") {
          return intl.formatMessage({ id: "vault.review.reconcileNotApplicable" });
        }
        setActionMessage(
          intl.formatMessage(
            { id: "vault.review.error.generic" },
            { detail: result.reason ?? result.outcome },
          ),
        );
        return null;
      });
    },
    [intl, reviewService, runAction],
  );

  const toggleExpanded = React.useCallback(
    (proposalId: string, revision: number, relativePath: string) => {
      // Revision is part of the cache identity: a re-approved/edited proposal
      // must never expose a previous revision's target text as current.
      const key = `${proposalId}\0${revision}\0${relativePath}`;
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(key)) {
          next.delete(key);
          return next;
        }
        next.add(key);
        return next;
      });
      if (!changeContents.has(key)) {
        // 代际守卫：取数发出后若发生过 refresh（重置预览缓存），迟到的响应
        // 直接丢弃，避免把用户从未看到的内容写回缓存而误开批准门。
        const generation = previewGenerationRef.current;
        void reviewService
          ?.getProposalChangeContent({ proposalId, relativePath })
          .then((content) => {
            if (previewGenerationRef.current !== generation) return;
            setChangeContents((current) =>
              new Map(current).set(
                key,
                content && content.revision === revision ? content.content : false,
              ),
            );
          })
          .catch(() => {
            if (previewGenerationRef.current !== generation) return;
            setChangeContents((current) => new Map(current).set(key, false));
          });
      }
    },
    [changeContents, reviewService],
  );

  const nowMs = Date.now();

  if (!reviewService && !vaultService) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center">
        <p className="px-6 text-center text-ui-sm text-muted-foreground">
          {intl.formatMessage({ id: "vault.ask.serviceUnavailable" })}
        </p>
      </section>
    );
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="knowledge-review-view"
    >
      <div className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4 scrollbar-thin">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-ui-lg font-medium text-foreground">
              {intl.formatMessage({ id: "vault.review.title" })}
            </h2>
            <p className="mt-1 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "vault.review.subtitle" })}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => {
              void refreshSummary();
              void refresh();
            }}
          >
            <RefreshCw className="size-3.5" />
            {intl.formatMessage({ id: "vault.review.refresh" })}
          </Button>
        </header>

        {actionMessage && (
          <p
            className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-ui-sm text-foreground"
            data-testid="review-action-message"
          >
            {actionMessage}
          </p>
        )}

        <div className="rounded-xl border border-card-border bg-card p-4">
          <p className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "vault.review.writePolicy" })}
          </p>
          {loadFailed && (
            <p className="mt-2 text-ui-sm text-destructive">
              {intl.formatMessage({ id: "vault.review.statusFailed" })}
            </p>
          )}
          {!loadFailed && !summaryLoaded && (
            <p className="mt-2 flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
              <Loader2 className="size-3.5 animate-spin" />
              {intl.formatMessage({ id: "vault.review.statusLoading" })}
            </p>
          )}
          {/* 阻塞④（ui-know-a-1）：getSummary 成功返回 null = 服务可用但未配置 Vault，
              引导去笔记页完成配置（spec §5e.11「未配置 Vault → 引导」），不再伪装成加载中。 */}
          {!loadFailed && summaryLoaded && !summary && vaultService && (
            <div
              className="mt-3 flex flex-col items-start gap-2 rounded-lg border border-dashed border-border px-4 py-5"
              data-testid="review-vault-not-configured"
            >
              <div className="flex items-center gap-2 text-ui-base font-medium text-foreground">
                <BookOpenText className="size-4 text-foreground-subtle" aria-hidden="true" />
                {intl.formatMessage({ id: "vault.review.vaultNotConfiguredTitle" })}
              </div>
              <p className="text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "vault.review.vaultNotConfiguredHint" })}
              </p>
              {onGoToNotes && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="review-vault-not-configured-go-notes"
                  onClick={onGoToNotes}
                >
                  {intl.formatMessage({ id: "vault.review.vaultNotConfiguredGoNotes" })}
                </Button>
              )}
            </div>
          )}
          {summary && (
            <>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ui-sm">
                <dt className="text-foreground-subtle">
                  {intl.formatMessage({ id: "vault.review.vault" })}
                </dt>
                <dd className="min-w-0 truncate text-foreground">{summary.displayName}</dd>
                <dt className="text-foreground-subtle">
                  {intl.formatMessage({ id: "vault.review.agentWrites" })}
                </dt>
                <dd
                  className="flex items-center gap-2 text-foreground"
                  data-testid="review-agent-writes-toggle"
                >
                  <span className="text-ui-sm">
                    {summary.allowAgentWrites
                      ? intl.formatMessage({ id: "vault.review.agentWritesOn" })
                      : intl.formatMessage({ id: "vault.review.agentWritesOff" })}
                  </span>
                  <Switch
                    checked={summary.allowAgentWrites}
                    disabled={busy !== null || !vaultService}
                    onCheckedChange={toggleAgentWrites}
                    aria-label={intl.formatMessage({ id: "vault.review.agentWrites" })}
                  />
                </dd>
                <dt className="text-foreground-subtle">
                  {intl.formatMessage({ id: "vault.review.hookScope" })}
                </dt>
                <dd className="text-foreground">
                  {intl.formatMessage({ id: "vault.review.hookScopeValue" })}
                </dd>
              </dl>
            </>
          )}
          {reviewService && (
            <div
              className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-card-border px-3 py-2.5"
              data-testid="review-write-path-toggle"
            >
              <div className="min-w-0">
                <p className="text-ui-sm font-medium text-foreground">
                  {intl.formatMessage({ id: "vault.review.writePathToggle" })}
                </p>
                <p className="mt-0.5 text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "vault.review.writePathToggleHint" })}
                </p>
                {!writeSafetyGatePassed && (
                  <p
                    className="mt-1 text-ui-sm text-warning"
                    data-testid="review-write-safety-gate-blocked"
                  >
                    {intl.formatMessage({ id: "vault.review.s03GateBlocked" })}
                  </p>
                )}
              </div>
              {writePathEnabled === null ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-foreground-subtle" />
              ) : (
                <Switch
                  checked={writePathEnabled}
                  disabled={busy !== null || !writeSafetyGatePassed}
                  onCheckedChange={toggleWritePath}
                  aria-label={intl.formatMessage({ id: "vault.review.writePathToggle" })}
                />
              )}
            </div>
          )}
        </div>

        <KnowledgeReviewProposalComposer
          vaultService={vaultService}
          reviewService={reviewService}
          onCreated={refresh}
          disabled={busy !== null || !summary}
        />

        {listFailed && (
          <p className="text-ui-sm text-destructive">
            {intl.formatMessage({ id: "vault.review.listFailed" })}
          </p>
        )}
        {!listFailed && proposals === null && reviewService && (
          <p className="flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
            <Loader2 className="size-3.5 animate-spin" />
            {intl.formatMessage({ id: "vault.review.statusLoading" })}
          </p>
        )}
        {proposals !== null && proposals.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
            <ClipboardCheck className="size-6 text-foreground-subtlest" />
            <p className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "vault.review.emptyTitle" })}
            </p>
            <p className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "vault.review.emptyHint" })}
            </p>
          </div>
        )}
        {proposals?.map((proposal) => {
          const phase = proposalPhaseKey(proposal, nowMs);
          const latestOperation = operations.find(
            (operation) => operation.proposalId === proposal.proposalId,
          );
          const operationStuck = latestOperation ? isOperationStuck(latestOperation) : false;
          // Every path of THIS revision must have had its exact content
          // retrieved successfully before the human can grant approval.
          // A stale/failed RPC or unviewed path fails closed.
          const previewsReviewed =
            proposal.changes.length > 0 &&
            proposal.changes.every((change) => {
              const key = `${proposal.proposalId}\0${proposal.revision}\0${change.relativePath}`;
              // An already fetched preview remains reviewed when the row is
              // collapsed; require exact current-revision content, not open UI.
              return changeContents.has(key) && changeContents.get(key) !== false;
            });
          return (
            <article
              key={proposal.proposalId}
              className="rounded-xl border border-card-border bg-card p-4"
              data-testid="review-proposal-card"
              data-proposal-phase={phase}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-ui-base font-medium text-foreground">
                    {proposal.title}
                  </p>
                  <p className="mt-0.5 text-ui-sm text-foreground-subtle">
                    {intl.formatMessage(
                      { id: "vault.review.revisionLabel" },
                      { revision: String(proposal.revision) },
                    )}{" "}
                    · {proposal.changesHash.slice(0, 12)} ·{" "}
                    {intl.formatMessage({ id: `vault.review.phase.${phase}` })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {phase === "pending" && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null || !previewsReviewed}
                        onClick={() => {
                          void runAction(`approve:${proposal.proposalId}`, async () => {
                            await reviewService?.approveProposal({
                              proposalId: proposal.proposalId,
                            });
                            return intl.formatMessage({ id: "vault.review.approved" });
                          });
                        }}
                      >
                        {busy === `approve:${proposal.proposalId}` && (
                          <Loader2 className="size-3.5 animate-spin" />
                        )}
                        {intl.formatMessage({ id: "vault.review.approve" })}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => {
                          void runAction(`reject:${proposal.proposalId}`, async () => {
                            await reviewService?.rejectProposal({
                              proposalId: proposal.proposalId,
                            });
                            return intl.formatMessage({ id: "vault.review.rejected" });
                          });
                        }}
                      >
                        {intl.formatMessage({ id: "vault.review.reject" })}
                      </Button>
                    </>
                  )}
                  {phase === "approvedCurrent" && (
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy !== null || !writeSafetyGatePassed || !writePathEnabled}
                      data-testid="review-proposal-apply"
                      onClick={() => applyProposal(proposal)}
                    >
                      {busy === `apply:${proposal.proposalId}` && (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}
                      {intl.formatMessage({ id: "vault.review.apply" })}
                    </Button>
                  )}
                  {phase === "approvalExpired" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || !previewsReviewed}
                      onClick={() => {
                        void runAction(`approve:${proposal.proposalId}`, async () => {
                          await reviewService?.approveProposal({ proposalId: proposal.proposalId });
                          return intl.formatMessage({ id: "vault.review.approved" });
                        });
                      }}
                    >
                      {intl.formatMessage({ id: "vault.review.reapprove" })}
                    </Button>
                  )}
                  {operationStuck && latestOperation && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      data-testid="review-proposal-reconcile"
                      onClick={() => reconcileStuck(latestOperation.operationId)}
                    >
                      {busy === `reconcile:${latestOperation.operationId}` && (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}
                      {intl.formatMessage({ id: "vault.review.reconcile" })}
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={
                      busy !== null ||
                      !writeSafetyGatePassed ||
                      !writePathEnabled ||
                      !appliedOperations.has(proposal.proposalId)
                    }
                    data-testid="review-proposal-undo"
                    onClick={() => undoOperation(proposal)}
                  >
                    {busy === `undo:${proposal.proposalId}` && (
                      <Loader2 className="size-3.5 animate-spin" />
                    )}
                    {intl.formatMessage({ id: "vault.review.undo" })}
                  </Button>
                </div>
              </div>
              {!previewsReviewed && (phase === "pending" || phase === "approvalExpired") && (
                <p
                  className="mt-2 text-ui-sm text-foreground-subtle"
                  data-testid="review-approval-preview-required"
                >
                  {intl.formatMessage({ id: "vault.review.previewRequired" })}
                </p>
              )}
              {latestOperation && (
                <p
                  className="mt-2 text-ui-sm text-foreground-subtle"
                  data-testid="review-operation-state"
                >
                  {latestOperation.operationId.slice(0, 16)} ·{" "}
                  {intl.formatMessage({ id: OPERATION_STATUS_KEYS[latestOperation.status] })} ·{" "}
                  {latestOperation.files
                    .map((file) => intl.formatMessage({ id: FILE_STATUS_KEYS[file.status] }))
                    .join(", ")}
                </p>
              )}
              {proposal.reason && (
                <p className="mt-2 whitespace-pre-wrap text-ui-sm text-foreground-subtle">
                  {proposal.reason}
                </p>
              )}
              <ul className="mt-3 flex flex-col gap-1">
                {proposal.changes.map((change) => {
                  const key = `${proposal.proposalId}\0${proposal.revision}\0${change.relativePath}`;
                  const isOpen = expanded.has(key);
                  return (
                    <li key={change.relativePath}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-ui-sm text-foreground hover:bg-menu-hover"
                        data-testid="review-change-toggle"
                        onClick={() =>
                          toggleExpanded(
                            proposal.proposalId,
                            proposal.revision,
                            change.relativePath,
                          )
                        }
                      >
                        {isOpen ? (
                          <ChevronDown className="size-3.5 shrink-0 text-foreground-subtle" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0 text-foreground-subtle" />
                        )}
                        <span className="truncate">{change.relativePath}</span>
                        <span className="shrink-0 text-foreground-subtlest">
                          {/* ui-know-a-4：kind 枚举走 i18n，不再把 create/write/delete 英文原样入界面。 */}
                          {intl.formatMessage({ id: CHANGE_KIND_KEYS[change.kind] })} ·{" "}
                          {change.sizeBytes === null ? "—" : `${change.sizeBytes}B`}
                        </span>
                      </button>
                      {isOpen && (
                        <pre
                          className="mt-1 max-h-72 overflow-auto rounded-lg border border-card-border bg-background p-2 text-ui-sm scrollbar-thin"
                          data-testid="review-change-content"
                        >
                          {!changeContents.has(key)
                            ? intl.formatMessage({ id: "vault.review.previewLoading" })
                            : changeContents.get(key) === false
                              ? intl.formatMessage({ id: "vault.review.previewFailed" })
                              : (changeContents.get(key) ??
                                intl.formatMessage({ id: "vault.review.deleteContent" }))}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}
