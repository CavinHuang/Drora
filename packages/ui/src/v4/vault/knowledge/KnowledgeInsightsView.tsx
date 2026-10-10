/**
 * 洞察视图（W04）。
 *
 * 诚实边界（spec §5c.1）：洞察建议（冲突提示/相关内容/时效解释）属 W05 数据集与
 * 决策引擎范围，本阶段**未开放**；本视图只呈现真实索引健康状态
 * （`IKnowledgeIndexService.getStatus`），不伪装任何洞察卡片。
 */
import * as React from "react";
import { LineChart, Loader2 } from "lucide-react";
import type { IKnowledgeIndexService, KnowledgeIndexStatus } from "@drora/services";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";

export function KnowledgeInsightsView({
  indexService,
}: {
  indexService: IKnowledgeIndexService | null;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  const [status, setStatus] = React.useState<KnowledgeIndexStatus | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  const refresh = React.useCallback(async (): Promise<void> => {
    if (!indexService) return;
    try {
      setStatus(await indexService.getStatus());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [indexService]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!indexService) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center">
        <p className="px-6 text-center text-ui-sm text-muted-foreground">
          {intl.formatMessage({ id: "vault.ask.serviceUnavailable" })}
        </p>
      </section>
    );
  }

  const coverage = status?.coverage ?? null;
  const job = status?.job ?? null;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="knowledge-insights-view">
      <div className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4 scrollbar-thin">
        <header>
          <h2 className="text-ui-lg font-medium text-foreground">
            {intl.formatMessage({ id: "vault.insights.title" })}
          </h2>
          <p className="mt-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "vault.insights.unavailable" })}
          </p>
        </header>

        <div className="rounded-xl border border-card-border bg-card p-4">
          <p className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "vault.insights.indexStatus" })}
          </p>
          {loadFailed && (
            <p className="mt-2 text-ui-sm text-destructive">
              {intl.formatMessage({ id: "vault.insights.statusFailed" })}
            </p>
          )}
          {!loadFailed && !status && (
            <p className="mt-2 flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
              <Loader2 className="size-3.5 animate-spin" />
              {intl.formatMessage({ id: "vault.insights.statusLoading" })}
            </p>
          )}
          {status && (
            <>
              {!status.configured ? (
                <p className="mt-2 text-ui-sm text-foreground-subtle">
                  {intl.formatMessage({ id: "vault.insights.noVault" })}
                </p>
              ) : (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ui-sm">
                  <dt className="text-foreground-subtle">{intl.formatMessage({ id: "vault.insights.vault" })}</dt>
                  <dd className="min-w-0 truncate text-foreground">{status.source?.displayName}</dd>
                  <dt className="text-foreground-subtle">{intl.formatMessage({ id: "vault.insights.indexed" })}</dt>
                  <dd className="text-foreground">
                    {intl.formatMessage(
                      { id: "vault.insights.indexedValue" },
                      { files: coverage?.indexedFiles ?? 0, chunks: coverage?.indexedChunks ?? 0 },
                    )}
                  </dd>
                  <dt className="text-foreground-subtle">{intl.formatMessage({ id: "vault.insights.partial" })}</dt>
                  <dd className="text-foreground">
                    {coverage?.partial
                      ? intl.formatMessage({ id: "vault.insights.partialYes" }, { excluded: (coverage.excludedHidden + coverage.excludedSymlink + coverage.excludedNotMarkdown + coverage.excludedOverSize + coverage.excludedOverQuota + coverage.excludedDepth) })
                      : intl.formatMessage({ id: "vault.insights.partialNo" })}
                  </dd>
                  <dt className="text-foreground-subtle">{intl.formatMessage({ id: "vault.insights.semantic" })}</dt>
                  <dd className="text-foreground">
                    {status.semantic === "available"
                      ? intl.formatMessage({ id: "vault.insights.semanticOn" })
                      : intl.formatMessage({ id: "vault.insights.semanticOff" })}
                  </dd>
                  <dt className="text-foreground-subtle">{intl.formatMessage({ id: "vault.insights.lastJob" })}</dt>
                  <dd className="text-foreground">
                    {job
                      ? intl.formatMessage({ id: "vault.insights.jobValue" }, { kind: job.kind, status: job.status })
                      : intl.formatMessage({ id: "vault.insights.jobNone" })}
                  </dd>
                </dl>
              )}
              <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void refresh()}>
                {intl.formatMessage({ id: "vault.insights.refresh" })}
              </Button>
            </>
          )}
        </div>

        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <LineChart className="size-6 text-foreground-subtlest" />
          <p className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "vault.insights.comingTitle" })}
          </p>
          <p className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "vault.insights.comingHint" })}
          </p>
        </div>
      </div>
    </section>
  );
}
