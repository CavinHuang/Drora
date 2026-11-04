/**
 * 「语义嵌入」（embedding）条目表单（specs/model-capabilities.md §5.1 字段表）。
 *
 * 语义开关 + 本地模型说明行 + 四态状态面 + 下载/重试——自 KnowledgeSettingsSection
 * §5b.9 状态面整体迁入，轮询节奏不变（开启时取一次；下载中每 1.5s 跟进直到落定）。
 * 开关数据源从 AppSettings knowledgeSemanticEnabled 旧键切到档案 embedding.enabled；
 * 写后调 refreshDecisionConfig 触发语义端口热切换（既有 §5b.9 热生效路径）。
 * V1 仅本地形态（mode 恒 local，档案 schema 钉住；remote 为预留 fail-closed）。
 */
import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { KnowledgeSemanticPortStatus } from "@drora/services";
import {
  TID_MODEL_CAPABILITY_EMBEDDING_DOWNLOAD_BUTTON,
  TID_MODEL_CAPABILITY_TOGGLE,
  testId,
} from "@drora/shared/test-ids";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { toast } from "@/components/ui/toast.js";
import { useServices } from "@/hooks/useServices.js";
import { useModelCapabilities } from "@/hooks/useModelCapabilities.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { startUserAction } from "@/lib/userActionTelemetry.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function EmbeddingCapabilityForm() {
  const { intl } = useDroraIntl();
  const { capabilities, update } = useModelCapabilities();
  const indexService = useServices().knowledgeIndexService ?? null;
  const semanticEnabled = capabilities?.embedding.enabled === true;

  const handleSemanticChange = useCallback(
    async (enabled: boolean) => {
      const trace = startUserAction({
        featureId: "settings.model_capabilities",
        action: "toggle_embedding",
        trigger: "switch",
      });
      try {
        await update({ capabilities: { embedding: { enabled } } });
        await indexService?.refreshDecisionConfig(); // 语义端口热切换（§5b.9 既有路径）
        toast(intl.formatMessage({ id: "settings.modelCapability.saved" }));
        trace.complete({
          resultSource: "setting_service",
          stateAfter: enabled ? "enabled" : "disabled",
        });
      } catch (error) {
        trace.fail({ failureStage: "setting_update" });
        throw error;
      }
    },
    [indexService, intl, update],
  );

  // --- 状态面（自 KnowledgeSettingsSection 迁入，轮询节奏不变：开启时取一次；
  // 下载中每 1.5s 跟进直到落定）---
  const [semanticStatus, setSemanticStatus] = useState<KnowledgeSemanticPortStatus | null>(null);
  const [modelDownloading, setModelDownloading] = useState(false);

  useEffect(() => {
    if (!semanticEnabled || !indexService) return;
    let cancelled = false;
    const refresh = async (): Promise<boolean> => {
      try {
        const status = await indexService.getSemanticStatus();
        if (!cancelled) setSemanticStatus(status);
        return status.state === "downloading";
      } catch {
        return false;
      }
    };
    void refresh().then((downloading) => {
      if (!downloading) return;
      const timer = setInterval(() => {
        void refresh().then((still) => {
          if (!still) {
            clearInterval(timer);
            setModelDownloading(false);
          }
        });
      }, 1500);
      return () => clearInterval(timer);
    });
    return () => {
      cancelled = true;
    };
  }, [semanticEnabled, indexService, modelDownloading]);

  const handleDownloadModel = useCallback(async () => {
    if (!indexService) return;
    const trace = startUserAction({
      featureId: "settings.model_capabilities",
      action: "download_embedding_model",
      trigger: "button",
    });
    setModelDownloading(true);
    try {
      const result = await indexService.downloadSemanticModel();
      if (result.error) {
        setSemanticStatus((previous) =>
          previous ? { ...previous, state: "failed", lastError: result.error } : previous,
        );
        toast(intl.formatMessage({ id: "settings.modelCapability.embedding.download.failed" }));
        trace.fail({ failureStage: "model_download" });
        return;
      }
      trace.complete({ resultSource: "authority_ack" });
    } catch (error) {
      trace.fail({ failureStage: "model_download" });
      throw error;
    }
  }, [indexService, intl]);

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.modelCapability.embedding.enabled.label" })}
        description={intl.formatMessage({
          id: "settings.modelCapability.embedding.enabled.description",
        })}
        control={
          <Switch
            aria-label={intl.formatMessage({
              id: "settings.modelCapability.embedding.enabled.label",
            })}
            data-testid={testId(TID_MODEL_CAPABILITY_TOGGLE, "embedding")}
            checked={semanticEnabled}
            onCheckedChange={(checked) => void handleSemanticChange(checked)}
          />
        }
        detail={
          semanticEnabled ? (
            <div className="space-y-2">
              <div className="text-ui-base leading-6 text-foreground-subtle">
                {intl.formatMessage({
                  id: "settings.modelCapability.embedding.localModel.description",
                })}
              </div>
              <div className="flex items-center gap-2">
                {(() => {
                  const state = semanticStatus?.state ?? "model_missing";
                  const failed = state === "failed";
                  const stateId = failed
                    ? "settings.modelCapability.embedding.status.failed"
                    : state === "downloading"
                      ? "settings.modelCapability.embedding.status.downloading"
                      : state === "ready"
                        ? "settings.modelCapability.embedding.status.ready"
                        : "settings.modelCapability.embedding.status.modelMissing";
                  return (
                    <>
                      <span
                        className={
                          failed
                            ? "text-ui-xs text-destructive"
                            : "text-ui-xs text-foreground-subtle"
                        }
                      >
                        {intl.formatMessage({ id: stateId })}
                      </span>
                      {(state === "model_missing" || failed) && !modelDownloading ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid={testId(
                            TID_MODEL_CAPABILITY_EMBEDDING_DOWNLOAD_BUTTON,
                            failed ? "retry" : "action",
                          )}
                          onClick={() => void handleDownloadModel()}
                        >
                          {intl.formatMessage({
                            id: failed
                              ? "settings.modelCapability.embedding.download.retry"
                              : "settings.modelCapability.embedding.download.action",
                          })}
                        </Button>
                      ) : null}
                      {state === "downloading" || modelDownloading ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                    </>
                  );
                })()}
              </div>
            </div>
          ) : undefined
        }
      />
    </SettingsGroupCard>
  );
}
