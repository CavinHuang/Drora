/**
 * insights 视图（§5g + N4 健康体检，specs/obsidian-knowledge.md §5h.3）：覆盖/inventory/
 * 最近作业只读呈现 + 孤儿/断链/空笔记体检段。索引触发（reconcile/rebuild）是写操作
 * （MCP 工具面）——D13 保守缺省降级提示（S03 同口径：批量面只读 + fail-closed）。
 */
import type { Translate } from "./i18n.js";
import type { KnowledgeInsightsSnapshot } from "./model.js";
import { DegradedWriteNotice, EmptyState } from "./parts.js";

export interface InsightsViewProps {
  t: Translate;
  snapshot: KnowledgeInsightsSnapshot | null;
  error: string | null;
  loading: boolean;
}

export function InsightsView(props: InsightsViewProps) {
  const { t, snapshot } = props;
  if (props.loading && snapshot === null) {
    return <div className="vault-state">{t("vault.loading")}</div>;
  }
  if (props.error !== null && snapshot === null) {
    return <EmptyState title={t("vault.networkError")} hint={props.error} />;
  }
  if (snapshot === null) {
    return <EmptyState title={t("vault.notes.empty")} />;
  }
  const health = snapshot.health;
  const emptyHealth =
    health !== undefined && health.orphanCount === 0 && health.brokenLinkCount === 0 && health.emptyNoteCount === 0;
  return (
    <div className="vault-insights">
      <section className="vault-insights-card">
        <h3 className="vault-insights-title">{t("vault.insights.coverage")}</h3>
        <div className="vault-stat-grid">
          <Stat
            label={t("vault.insights.indexedFiles", {
              indexed: snapshot.coverage.indexedFiles,
              total: snapshot.inventory.documents,
            })}
          />
          <Stat label={t("vault.insights.chunks", { count: snapshot.coverage.indexedChunks })} />
          {snapshot.coverage.partial ? <Stat label={t("vault.banner.indexPartial")} /> : null}
          {snapshot.coverage.indexedFiles === 0 ? <Stat label={t("vault.banner.indexMissing")} /> : null}
        </div>
      </section>

      <section className="vault-insights-card">
        <h3 className="vault-insights-title">{t("vault.insights.recentJobs")}</h3>
        {snapshot.recentJobs.length === 0 ? (
          <div className="vault-related-empty">{t("vault.insights.noJobs")}</div>
        ) : (
          <ul className="vault-jobs">
            {snapshot.recentJobs.map((job) => (
              <li key={`${job.kind}-${job.startedAtMs}`} className="vault-job">
                <span className="vault-job-kind">
                  {t("vault.insights.jobStatus", { kind: job.kind, status: job.status })}
                </span>
                <span className="vault-job-time">{new Date(job.startedAtMs).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
        {/* startReconcile/requestRebuild 是 MCP 写工具（工具面逐次 ask）——面板不内联触发。 */}
        <DegradedWriteNotice t={t} />
      </section>

      <section className="vault-insights-card">
        <h3 className="vault-insights-title">{t("vault.insights.health")}</h3>
        {health === undefined ? (
          <div className="vault-related-empty">{t("vault.notes.relatedEmpty")}</div>
        ) : emptyHealth ? (
          <div className="vault-related-empty">{t("vault.insights.health.empty")}</div>
        ) : (
          <div className="vault-health">
            <HealthList
              t={t}
              title={t("vault.insights.health.orphanNotes")}
              count={health.orphanCount}
              shown={health.orphanNotes.map((entry) => entry.relativePath)}
            />
            <HealthList
              t={t}
              title={t("vault.insights.health.brokenLinks")}
              count={health.brokenLinkCount}
              shown={health.brokenLinks.map((entry) => `${entry.sourcePath} → ${entry.target}`)}
            />
            <HealthList
              t={t}
              title={t("vault.insights.health.emptyNotes")}
              count={health.emptyNoteCount}
              shown={health.emptyNotes.map((entry) => entry.relativePath)}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label }: { label: string }) {
  return <div className="vault-stat">{label}</div>;
}

function HealthList(props: { t: Translate; title: string; count: number; shown: string[] }) {
  const { t } = props;
  return (
    <div className="vault-health-group">
      <div className="vault-health-head">
        {props.title}
        <span className="vault-health-count">{props.count}</span>
      </div>
      {props.shown.length > 0 ? (
        <ul className="vault-health-list">
          {props.shown.map((item, index) => (
            <li key={`${item}-${index}`} className="vault-health-item">
              {item}
            </li>
          ))}
        </ul>
      ) : null}
      {props.shown.length < props.count ? (
        <div className="vault-health-more">
          {t("vault.insights.health.more", { count: props.count, shown: props.shown.length })}
        </div>
      ) : null}
    </div>
  );
}
