/**
 * 审核视图（W04）。
 *
 * 诚实边界（spec §2/§5c.1）：L2 知识治理（Proposal → 人工批准 → 版本校验和账本）
 * 属 W06，本阶段**未开放**；本视图只呈现真实写入授权状态（vault-config.json 经
 * `IObsidianVaultService.getSummary()`），并如实说明 hook 能力边界——PermissionRequest
 * 自动放行只覆盖「根内普通 .md 的 Write/Edit ask 询问」，Bash/MCP 等通道不经 hook，
 * 不声称能阻断 L2/L3 写入（spec §2 不变量）。
 */
import * as React from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import type { IObsidianVaultService, ObsidianVaultSummary } from "@drora/services";
import { Button } from "@/components/ui/button.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";

export function KnowledgeReviewView({
  vaultService,
}: {
  vaultService: IObsidianVaultService | null;
}): React.ReactElement {
  const { intl } = useDroraIntl();
  const [summary, setSummary] = React.useState<ObsidianVaultSummary | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);

  const refresh = React.useCallback(async (): Promise<void> => {
    if (!vaultService) return;
    try {
      setSummary(await vaultService.getSummary());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [vaultService]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!vaultService) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center">
        <p className="px-6 text-center text-ui-sm text-muted-foreground">
          {intl.formatMessage({ id: "vault.ask.serviceUnavailable" })}
        </p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="knowledge-review-view">
      <div className="mx-auto flex h-full w-full max-w-4xl min-h-0 flex-col gap-3 overflow-y-auto px-4 py-4 scrollbar-thin">
        <header>
          <h2 className="text-ui-lg font-medium text-foreground">
            {intl.formatMessage({ id: "vault.review.title" })}
          </h2>
          <p className="mt-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "vault.review.unavailable" })}
          </p>
        </header>

        <div className="rounded-xl border border-card-border bg-card p-4">
          <p className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "vault.review.writePolicy" })}
          </p>
          {loadFailed && (
            <p className="mt-2 text-ui-sm text-destructive">
              {intl.formatMessage({ id: "vault.review.statusFailed" })}
            </p>
          )}
          {!loadFailed && !summary && (
            <p className="mt-2 flex items-center gap-1.5 text-ui-sm text-foreground-subtle">
              <Loader2 className="size-3.5 animate-spin" />
              {intl.formatMessage({ id: "vault.review.statusLoading" })}
            </p>
          )}
          {summary && (
            <>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-ui-sm">
                <dt className="text-foreground-subtle">{intl.formatMessage({ id: "vault.review.vault" })}</dt>
                <dd className="min-w-0 truncate text-foreground">{summary.displayName}</dd>
                <dt className="text-foreground-subtle">{intl.formatMessage({ id: "vault.review.agentWrites" })}</dt>
                <dd className="text-foreground">
                  {summary.allowAgentWrites
                    ? intl.formatMessage({ id: "vault.review.agentWritesOn" })
                    : intl.formatMessage({ id: "vault.review.agentWritesOff" })}
                </dd>
                <dt className="text-foreground-subtle">{intl.formatMessage({ id: "vault.review.hookScope" })}</dt>
                <dd className="text-foreground">{intl.formatMessage({ id: "vault.review.hookScopeValue" })}</dd>
              </dl>
              <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void refresh()}>
                {intl.formatMessage({ id: "vault.review.refresh" })}
              </Button>
            </>
          )}
        </div>

        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <ClipboardCheck className="size-6 text-foreground-subtlest" />
          <p className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "vault.review.comingTitle" })}
          </p>
          <p className="text-ui-sm text-foreground-subtle">{intl.formatMessage({ id: "vault.review.comingHint" })}</p>
        </div>
      </div>
    </section>
  );
}
