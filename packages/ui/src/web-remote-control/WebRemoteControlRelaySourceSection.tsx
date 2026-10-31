import { useEffect, useMemo, useState } from "react";
import { normalizeDroraEndpointOrigin } from "@drora/shared";
import { ChevronDown, Server } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { Input } from "@/components/ui/input.js";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group.js";
import { Label } from "@/components/ui/label.js";
import { toast } from "@/components/ui/toast.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { logger } from "@/logger.js";

type RelaySourceMode = "official" | "custom";

function formatOriginForDisplay(origin: string | undefined): string {
  const trimmed = origin?.trim();
  return trimmed ? trimmed : "";
}

/**
 * 远控「官方/自建 Relay」切换区（specs/relay-v2-server.md §8.7）。
 *
 * 保存语义为切换式：写设置键 webRemoteControlRelayOrigin → 停止当前远控 → 通知弹窗按新源
 * 自动重启（弹窗 open-effect 对 idle 目标不匹配会 startWebRemoteControl，manager 每次 start
 * 现查 getEndpointUrls）。官方 = 清空设置键（空串哨兵经 normalizeSettingsPatch 删除落盘值）。
 */
export function WebRemoteControlRelaySourceSection({
  onRestart,
  disabled,
}: {
  onRestart: () => void;
  disabled?: boolean;
}) {
  const { intl } = useDroraIntl();
  const platform = usePlatform();
  const { settings, update } = useSettings();
  const savedRelayOrigin = formatOriginForDisplay(settings?.webRemoteControlRelayOrigin);
  const [mode, setMode] = useState<RelaySourceMode>(savedRelayOrigin ? "custom" : "official");
  const [originDraft, setOriginDraft] = useState(savedRelayOrigin);
  const [originError, setOriginError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    // 外部（其他窗口/兜底通道）改写设置后回填本地草稿；草稿被用户编辑中时以保存值为准的做法
    // 与设置页一致——只在保存值变化时覆盖。
    setMode(savedRelayOrigin ? "custom" : "official");
    setOriginDraft(savedRelayOrigin);
  }, [savedRelayOrigin]);

  const summaryLabelId = useMemo(
    () => (savedRelayOrigin ? "webRemoteControl.relaySource.custom" : "webRemoteControl.relaySource.official"),
    [savedRelayOrigin],
  );

  const handleApply = async () => {
    let nextRelayOrigin = "";
    if (mode === "custom") {
      const trimmed = originDraft.trim();
      if (!trimmed) {
        setOriginError(intl.formatMessage({ id: "webRemoteControl.relaySource.originRequired" }));
        return;
      }
      try {
        // 与落盘 schema 同一归一入口：非法 origin 在此拒绝而不是被 schema 静默丢弃回落官方。
        nextRelayOrigin = normalizeDroraEndpointOrigin(trimmed);
      } catch {
        setOriginError(intl.formatMessage({ id: "webRemoteControl.relaySource.originInvalid" }));
        return;
      }
    }
    setOriginError(null);
    setApplying(true);
    try {
      await update({ webRemoteControlRelayOrigin: nextRelayOrigin });
      try {
        await platform.stopWebRemoteControl();
      } catch (stopError) {
        // 未开启远控时 stop 可能报错；切换语义只关心下一次 start 用新源，不因 stop 失败中断。
        logger.info("[WebRemoteControlRelaySource] 停止旧远控会话失败（可能未开启）", stopError);
      }
      onRestart();
      toast(intl.formatMessage({ id: "webRemoteControl.relaySource.applied" }));
      logger.info("[WebRemoteControlRelaySource] 已切换远控 Relay 来源", {
        mode,
        relayOrigin: nextRelayOrigin || "official",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(
        intl.formatMessage({ id: "webRemoteControl.relaySource.applyFailed" }, { error: message }),
      );
      logger.error("[WebRemoteControlRelaySource] 切换远控 Relay 来源失败", message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <Collapsible data-testid="web-remote-control-relay-source">
      <div className="mt-4 rounded-xl border border-border bg-card">
        <CollapsibleTrigger
          data-testid="web-remote-control-relay-source-trigger"
          className="flex w-full cursor-pointer items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Server className="size-4 shrink-0 text-foreground-subtle" />
            <span className="text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "webRemoteControl.relaySource.title" })}
            </span>
            <span className="min-w-0 truncate text-ui-caption text-foreground-subtle">
              {intl.formatMessage({ id: summaryLabelId })}
              {savedRelayOrigin ? ` · ${savedRelayOrigin}` : ""}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-foreground-subtle" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 border-t border-border px-4 py-3">
            <RadioGroup
              data-testid="web-remote-control-relay-source-mode"
              value={mode}
              onValueChange={(nextMode) => setMode(nextMode as RelaySourceMode)}
              className="gap-2"
              disabled={applying || disabled}
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem
                  value="official"
                  id="web-remote-control-relay-source-official"
                  className="mt-0.5"
                />
                <div className="min-w-0 space-y-0.5">
                  <Label
                    htmlFor="web-remote-control-relay-source-official"
                    className="cursor-pointer text-ui-base font-medium text-foreground"
                  >
                    {intl.formatMessage({ id: "webRemoteControl.relaySource.official" })}
                  </Label>
                  <p className="text-ui-caption/relaxed text-foreground-subtle">
                    {intl.formatMessage({ id: "webRemoteControl.relaySource.officialDescription" })}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem
                  value="custom"
                  id="web-remote-control-relay-source-custom"
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <Label
                    htmlFor="web-remote-control-relay-source-custom"
                    className="cursor-pointer text-ui-base font-medium text-foreground"
                  >
                    {intl.formatMessage({ id: "webRemoteControl.relaySource.custom" })}
                  </Label>
                  <p className="text-ui-caption/relaxed text-foreground-subtle">
                    {intl.formatMessage({ id: "webRemoteControl.relaySource.customDescription" })}
                  </p>
                </div>
              </div>
            </RadioGroup>
            {mode === "custom" ? (
              <div className="space-y-1.5 pl-6">
                <Input
                  data-testid="web-remote-control-relay-source-origin"
                  value={originDraft}
                  onChange={(event) => {
                    setOriginDraft(event.target.value);
                    if (originError) setOriginError(null);
                  }}
                  placeholder={intl.formatMessage({
                    id: "webRemoteControl.relaySource.originPlaceholder",
                  })}
                  disabled={applying || disabled}
                  aria-invalid={originError ? true : undefined}
                  className="text-ui-base"
                />
                {originError ? (
                  <p
                    data-testid="web-remote-control-relay-source-error"
                    className="text-ui-caption/relaxed text-destructive"
                  >
                    {originError}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex justify-end pl-6">
              <Button
                type="button"
                variant="outline"
                size="default"
                data-testid="web-remote-control-relay-source-apply"
                className="gap-2 enabled:cursor-pointer"
                onClick={() => void handleApply()}
                disabled={applying || disabled}
              >
                {intl.formatMessage({ id: "webRemoteControl.relaySource.apply" })}
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
