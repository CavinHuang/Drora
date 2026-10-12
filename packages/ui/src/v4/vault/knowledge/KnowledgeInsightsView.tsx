/**
 * 洞察视图（VaultView 四视图之三，spec §5g）。
 *
 * 四区真实数据卡片：库存（documents/chunks/tags 文档/双链总数）→ 收录覆盖（排除明细
 * + partial）→ 索引活动（最近 job 列表）→ 检索与决策（telemetry 快照，注明「重启后
 * 清零」）。诚实边界：全部数字来自 `IKnowledgeIndexService.getInsights` 的 host 端
 * 聚合纯查询（spec §5g.1），本组件零派生事实；未配置 Vault 沿用既有 noVault 空态
 * （A01，不自动扫描）；host 未注册频道/断连沿用 serviceUnavailable 错误态。
 */
import * as React from "react";
import { Loader2 } from "lucide-react";
import type { IKnowledgeIndexService, KnowledgeInsightsSnapshot } from "@drora/services";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import {
  INSIGHTS_POLL_INTERVAL_MS,
  deriveInsightsPolling,
  formatInsightsDuration,
  nonZeroCoverageExclusions,
} from "./knowledgeInsightsModel.js";

/** 统计瓦片：数值 + 标签（DESIGN.md：text-ui-* 令牌 + 语义色）。 */
function StatTile({ value, label }: { value: number | string; label: string }): React.ReactElement {
  return (
    <div className="min-w-0 rounded-lg border border-border px-3 py-2">
      <p className="truncate text-ui-lg font-medium text-foreground">{value}</p>
      <p className="mt-0.5 text-ui-xs text-foreground-subtle">{label}</p>
    </div>
  );
}

/** 卡片骨架：标题 + 内容（四区共用）。 */
function InsightCard({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-ui-base font-medium text-foreground">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

export function KnowledgeInsightsView({
  indexService,
}: {
  indexService: IKnowledgeIndexService | null;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  const [snapshot, setSnapshot] = React.useState<KnowledgeInsightsSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  const refresh = React.useCallback(async (): Promise<void> => {
    if (!indexService) return;
    try {
      setSnapshot(await indexService.getInsights());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [indexService]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // 进行中 job 轮询（与 ask 视图同模式）：离场即停（轮询条件不满足）。
  const polling = deriveInsightsPolling(snapshot);
  React.useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, INSIGHTS_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);

  if (!indexService) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center">
        <p className="px-6 text-center text-ui-sm text-muted-foreground">
          {intl.formatMessage({ id: "vault.ask.serviceUnavailable" })}
        </p>
      </section>
    );
  }

  const coverageExclusions = snapshot ? nonZeroCoverageExclusions(snapshot.coverage) : [];

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="knowledge-insights-view"
    >
      <div className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4 scrollbar-thin">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-ui-lg font-medium text-foreground">
              {intl.formatMessage({ id: "vault.insights.title" })}
            </h2>
            <p className="mt-1 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "vault.insights.subtitle" })}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
            {intl.formatMessage({ id: "vault.insights.refresh" })}
          </Button>
        </header>

        {loadFailed && (
          <InsightCard title={intl.formatMessage({ id: "vault.insights.statusFailed" })}>
            <p className="mt-2 text-ui-sm text-destructive">
              {intl.formatMessage({ id: "vault.ask.serviceUnavailable" })}
            </p>
          </InsightCard>
        )}

        {!loadFailed && !snapshot && (
          <InsightCard title={intl.formatMessage({ id: "vault.insights.title" })}>
            <p className="mt-2 flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
              <Loader2 className="size-3.5 animate-spin" />
              {intl.formatMessage({ id: "vault.insights.statusLoading" })}
            </p>
          </InsightCard>
        )}

        {snapshot && !snapshot.configured && (
          <InsightCard title={intl.formatMessage({ id: "vault.insights.title" })}>
            <p className="mt-2 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "vault.insights.noVault" })}
            </p>
          </InsightCard>
        )}

        {snapshot && snapshot.configured && (
          <>
            {/* ── 库存（spec §5g.2）────────────────────────────── */}
            <InsightCard title={intl.formatMessage({ id: "vault.insights.inventory" })}>
              <p className="truncate text-ui-xs text-foreground-subtle">
                {intl.formatMessage({ id: "vault.insights.vault" })} ·{" "}
                {snapshot.source?.displayName}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile
                  value={snapshot.inventory.documents}
                  label={intl.formatMessage({ id: "vault.insights.inventory.documents" })}
                />
                <StatTile
                  value={snapshot.inventory.chunks}
                  label={intl.formatMessage({ id: "vault.insights.inventory.chunks" })}
                />
                <StatTile
                  value={snapshot.inventory.taggedDocuments}
                  label={intl.formatMessage({ id: "vault.insights.inventory.tagged" })}
                />
                <StatTile
                  value={snapshot.inventory.wikilinkCount}
                  label={intl.formatMessage({ id: "vault.insights.inventory.wikilinks" })}
                />
              </div>
            </InsightCard>

            {/* ── 收录覆盖（spec §5g.3）────────────────────────── */}
            <InsightCard title={intl.formatMessage({ id: "vault.insights.coverage" })}>
              <p className="mt-2 text-ui-sm text-foreground">
                {snapshot.coverage.partial
                  ? intl.formatMessage({ id: "vault.insights.coveragePartial" })
                  : intl.formatMessage({ id: "vault.insights.coverageComplete" })}
              </p>
              {coverageExclusions.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {coverageExclusions.map((exclusion) => (
                    <StatTile
                      key={exclusion.key}
                      value={exclusion.count}
                      label={intl.formatMessage({ id: `vault.insights.exclude.${exclusion.key}` })}
                    />
                  ))}
                </div>
              )}
            </InsightCard>

            {/* ── 索引活动（spec §5g.4）────────────────────────── */}
            <InsightCard title={intl.formatMessage({ id: "vault.insights.activity" })}>
              {snapshot.recentJobs.length === 0 ? (
                <p className="mt-2 text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "vault.insights.jobEmpty" })}
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {snapshot.recentJobs.map((job, index) => (
                    <li
                      key={`${job.startedAtMs}-${job.kind}-${index}`}
                      className="rounded-lg border border-border px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-ui-sm text-foreground">
                          {intl.formatMessage({ id: `vault.insights.jobKind.${job.kind}` })}
                          <span className="text-foreground-subtle">
                            {" · "}
                            {intl.formatMessage({ id: `vault.insights.jobStatus.${job.status}` })}
                          </span>
                        </p>
                        <p className="flex shrink-0 items-center gap-1.5 text-ui-xs text-foreground-subtle">
                          {job.status === "running" && <Loader2 className="size-3 animate-spin" />}
                          {job.durationMs !== null
                            ? intl.formatMessage(
                                { id: "vault.insights.jobDuration" },
                                { duration: formatInsightsDuration(job.durationMs) },
                              )
                            : null}
                        </p>
                      </div>
                      <p className="mt-1 text-ui-xs text-foreground-subtle">
                        {intl.formatMessage(
                          { id: "vault.insights.jobIndexed" },
                          { files: job.indexedFiles, chunks: job.indexedChunks },
                        )}
                        {job.reason !== null && job.reason !== "" ? (
                          <span className="text-destructive">
                            {" · "}
                            {intl.formatMessage(
                              { id: "vault.insights.jobReason" },
                              { reason: job.reason },
                            )}
                          </span>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </InsightCard>

            {/* ── 检索与决策（spec §5g.5）──────────────────────── */}
            <InsightCard title={intl.formatMessage({ id: "vault.insights.decision" })}>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <StatTile
                  value={snapshot.decision.outboundCountTotal}
                  label={intl.formatMessage({ id: "vault.insights.decision.outbound" })}
                />
                <StatTile
                  value={snapshot.decision.cacheHitCountTotal}
                  label={intl.formatMessage({ id: "vault.insights.decision.cacheHits" })}
                />
                <StatTile
                  value={snapshot.decision.fallbackCountTotal}
                  label={intl.formatMessage({ id: "vault.insights.decision.fallbacks" })}
                />
                <StatTile
                  value={snapshot.decision.scoredCountTotal}
                  label={intl.formatMessage({ id: "vault.insights.decision.scored" })}
                />
                <StatTile
                  value={snapshot.decision.inputTokensTotal}
                  label={intl.formatMessage({ id: "vault.insights.decision.inputTokens" })}
                />
                <StatTile
                  value={snapshot.decision.outputTokensTotal}
                  label={intl.formatMessage({ id: "vault.insights.decision.outputTokens" })}
                />
              </div>
              <p className="mt-2 text-ui-xs text-foreground-subtle">
                {intl.formatMessage({ id: "vault.insights.decision.volatile" })}
              </p>
            </InsightCard>
          </>
        )}
      </div>
    </section>
  );
}
