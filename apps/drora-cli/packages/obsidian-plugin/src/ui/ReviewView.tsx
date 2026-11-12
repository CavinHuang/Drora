/**
 * review 视图（L2 审核，obsidian-knowledge.md §5e）：提案列表/详情只读呈现 + 写路径
 * 总门状态。approve/reject/apply/undo 全是治理写（MCP 工具面逐次 ask + S03 NO-GO
 * write_path_disabled fail-closed）——D13 保守缺省：只读呈现 + 降级提示。
 */
import type { Translate } from "./i18n.js";
import type { KnowledgeReviewProposalView, Page } from "./model.js";
import { DegradedWriteNotice, EmptyState, LoadMoreButton } from "./parts.js";

export interface WriteGateState {
  enabled: boolean;
  activationAllowed: boolean;
}

export interface ReviewViewProps {
  t: Translate;
  writeGate: WriteGateState | null;
  proposals: Page<KnowledgeReviewProposalView> | null;
  proposalsError: string | null;
  selected: KnowledgeReviewProposalView | null;
  loadingDetail: boolean;
  onLoadMore: () => void;
  onSelect: (proposalId: string) => void;
}

export function ReviewView(props: ReviewViewProps) {
  const { t, proposals, writeGate } = props;
  return (
    <div className="vault-review">
      {writeGate !== null ? (
        <div className="vault-review-gate">
          <span className="vault-review-gate-label">{t("vault.review.writeGate")}</span>
          <span
            className={`vault-tag ${writeGate.enabled ? "vault-tag-ok" : "vault-tag-muted"}`}
          >
            {writeGate.enabled ? t("vault.review.writeGateOn") : t("vault.review.writeGateOff")}
          </span>
          <span className="vault-review-gate-activation">
            {t("vault.review.writeGateActivation", {
              value: writeGate.activationAllowed ? "yes" : "no",
            })}
          </span>
        </div>
      ) : null}

      {proposals === null ? (
        props.proposalsError !== null ? (
          <EmptyState title={t("vault.networkError")} hint={props.proposalsError} />
        ) : (
          <div className="vault-state">{t("vault.loading")}</div>
        )
      ) : proposals.items.length === 0 ? (
        <EmptyState title={t("vault.review.noProposals")} />
      ) : (
        <>
          <ul className="vault-proposals">
            {proposals.items.map((proposal) => (
              <li key={proposal.proposalId} className="vault-proposal">
                <button
                  type="button"
                  className="vault-proposal-main"
                  onClick={() => props.onSelect(proposal.proposalId)}
                >
                  <span className="vault-proposal-title">{proposal.title}</span>
                  <span className="vault-proposal-meta">
                    {t("vault.review.proposalRevision", { revision: proposal.revision })}
                    {" · "}
                    {proposal.changes.length}
                    {" · "}
                    {new Date(proposal.createdAtMs).toLocaleString()}
                    {proposal.rejected ? ` · ${t("vault.review.rejected")}` : ""}
                    {proposal.approval && !proposal.approval.expired
                      ? ` · ${t("vault.review.approved")}`
                      : ""}
                    {proposal.approval?.expired ? ` · ${t("vault.review.approvalExpired")}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {proposals.hasMore ? <LoadMoreButton t={t} onClick={props.onLoadMore} /> : null}
        </>
      )}

      {props.selected !== null ? (
        <ProposalDetail t={t} proposal={props.selected} loading={props.loadingDetail} />
      ) : null}
    </div>
  );
}

function ProposalDetail(props: {
  t: Translate;
  proposal: KnowledgeReviewProposalView;
  loading: boolean;
}) {
  const { t, proposal } = props;
  return (
    <section className="vault-proposal-detail">
      <h3 className="vault-insights-title">
        {proposal.title}
        <span className="vault-proposal-revision">
          {t("vault.review.proposalRevision", { revision: proposal.revision })}
        </span>
      </h3>
      <div className="vault-proposal-reason">
        {t("vault.review.reason")}：{proposal.reason}
      </div>
      <div className="vault-proposal-section">{t("vault.review.changes")}</div>
      <ul className="vault-proposal-changes">
        {proposal.changes.map((change, index) => (
          <li key={`${change.relativePath}-${index}`} className="vault-proposal-change">
            <span
              className={`vault-tag ${
                change.kind === "delete" ? "vault-tag-danger" : "vault-tag-muted"
              }`}
            >
              {t(`vault.review.changeKind.${change.kind}`)}
            </span>
            <span className="vault-candidate-path">{change.relativePath}</span>
          </li>
        ))}
      </ul>
      {proposal.evidence.length > 0 ? (
        <>
          <div className="vault-proposal-section">{t("vault.review.evidence")}</div>
          <ul className="vault-proposal-evidence">
            {proposal.evidence.map((entry, index) => (
              <li key={index} className="vault-health-item">
                {entry.receiptId ? `receipt ${entry.receiptId}` : ""}
                {entry.receiptId && entry.note ? " · " : ""}
                {entry.note ?? ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="vault-proposal-actions">
        {/* approve/reject/apply 是治理写（S03 NO-GO：write_path_disabled fail-closed）——
            D13 保守缺省不放死按钮，降级提示指明可用路径（对话经 agent L2 工具面）。 */}
        <DegradedWriteNotice t={t} />
      </div>
    </section>
  );
}
