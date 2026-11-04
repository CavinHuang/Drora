import { useState } from "react";
import { PERSONA_PRESETS, type PersonaEditableCore, type PersonaPreset } from "@drora/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js";
import { Spinner } from "@/components/ui/spinner.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";
import { matchesPresetCore } from "./usePersonaPresets.js";

/**
 * 人设预设选择卡（specs/drora-persona-system.md §13 第十五批）：六张内置人格起点的
 * 卡片网格＋「使用中」徽标（core 五字段全等判定，偏好/学习漂移不参与）＋覆盖确认。
 * 应用状态机见 usePersonaPresets（非原子组合，结果由父级以 notice 呈现）；
 * 生效＝下一轮捕获读库（无需重启），本组件不做生效性宣称。
 */

export interface PersonaPresetApplyNotice {
  readonly tone: "success" | "error" | "info";
  readonly message: string;
}

export function PersonaPresetSection({
  currentCore,
  applyingPresetId,
  applyNotice,
  onApply,
}: {
  /** 服务权威 core（editor.saved.core）；null＝尚未读到（不渲染徽标）。 */
  readonly currentCore: PersonaEditableCore | null;
  readonly applyingPresetId: PersonaPreset["id"] | null;
  readonly applyNotice: PersonaPresetApplyNotice | null;
  readonly onApply: (preset: PersonaPreset) => Promise<void>;
}) {
  const { intl, locale } = useDroraIntl();
  const [pendingPreset, setPendingPreset] = useState<PersonaPreset | null>(null);
  const zh = locale.startsWith("zh");

  const nameOf = (preset: PersonaPreset): string => (zh ? preset.nameZh : preset.nameEn);
  const taglineOf = (preset: PersonaPreset): string => (zh ? preset.taglineZh : preset.taglineEn);

  const noticeClassName =
    applyNotice?.tone === "success"
      ? "text-ui-sm text-success"
      : applyNotice?.tone === "error"
        ? "text-ui-sm text-destructive"
        : "text-ui-sm text-foreground-subtle";

  return (
    <SettingsGroupCard>
      {/* 卡片网格放标题下方全宽排布（不塞 SettingsRow 右侧 280px 窄列，六卡三行过挤）。 */}
      <div className="px-4 pt-3">
        <div className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "settings.drora.presets.title" })}
        </div>
        <div className="mt-1 text-ui-base leading-6 text-foreground-subtle">
          {intl.formatMessage({ id: "settings.drora.presets.description" })}
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        <div
          className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="persona-preset-grid"
        >
          {PERSONA_PRESETS.map((preset) => {
            const active = currentCore !== null && matchesPresetCore(currentCore, preset);
            const applying = applyingPresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`persona-preset-card-${preset.id}`}
                aria-pressed={active}
                disabled={applyingPresetId !== null}
                onClick={() => {
                  if (!active) setPendingPreset(preset);
                }}
                className={`flex min-h-20 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50 hover:bg-accent"
                } ${applyingPresetId !== null ? "opacity-60" : ""}`}
              >
                <span className="text-ui-lg leading-6" aria-hidden="true">
                  {preset.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-ui-base font-medium text-foreground">
                      {nameOf(preset)}
                    </span>
                    {active ? (
                      <span
                        data-testid={`persona-preset-active-${preset.id}`}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-ui-xs text-primary"
                      >
                        {intl.formatMessage({ id: "settings.drora.presets.active" })}
                      </span>
                    ) : null}
                    {applying ? <Spinner className="size-4" /> : null}
                  </span>
                  <span className="mt-0.5 block text-ui-sm leading-5 text-foreground-subtle">
                    {taglineOf(preset)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 space-y-1">
          {applyNotice ? (
            <p className={noticeClassName} data-testid="persona-preset-notice" role="status">
              {applyNotice.message}
            </p>
          ) : null}
          <p className="text-ui-sm leading-5 text-foreground-subtlest">
            {intl.formatMessage({ id: "settings.drora.presets.overwriteHint" })}
          </p>
        </div>
      </div>

      <AlertDialog
        open={pendingPreset !== null}
        onOpenChange={(open) => {
          if (applyingPresetId === null && !open) setPendingPreset(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({ id: "settings.drora.presets.confirmTitle" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                { id: "settings.drora.presets.confirmDescription" },
                { name: pendingPreset ? nameOf(pendingPreset) : "" },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{intl.formatMessage({ id: "common.cancel" })}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="persona-preset-confirm"
              onClick={(event) => {
                event.preventDefault();
                if (pendingPreset) {
                  const preset = pendingPreset;
                  setPendingPreset(null);
                  void onApply(preset);
                }
              }}
            >
              {intl.formatMessage({ id: "settings.drora.presets.confirmAction" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsGroupCard>
  );
}
