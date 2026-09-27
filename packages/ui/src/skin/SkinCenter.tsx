import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useDroraStore } from "@/store/StoreProvider.js";
import {
  DEFAULT_CUSTOM_ACCENT_COLOR,
  DEFAULT_SKIN_PREFERENCE,
  SKIN_PRESET_IDS,
  validateWallpaperFile,
} from "@/skin/skinPreference.js";
import { decodeWallpaper, deleteWallpaper, saveWallpaper } from "@/skin/skinImageStore.js";

const OPACITY_FIELDS = ["conversationOpacity", "sidebarOpacity", "sidePaneOpacity"] as const;

// 原生 range 无样式时是纯黑轨道+黑圆头（设置页实测刺眼）；统一样式化为
// 4px 细轨道（border token）+ 12px 品牌色圆头，遵守 DESIGN.md 低饱和卡片化语言。
const SKIN_RANGE_INPUT_CLASS = [
  "w-full cursor-pointer appearance-none bg-transparent",
  "h-4",
  "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-border",
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:-mt-1 [&::-webkit-slider-thumb]:rounded-full",
  "[&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm",
  "[&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-background",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
].join(" ");

export function SkinCenter() {
  const { intl } = useDroraIntl();
  const preference = useDroraStore((state) => state.skin);
  const setSkin = useDroraStore((state) => state.setSkin);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearWallpaper = async (reset: boolean) => {
    const request = ++requestRef.current;
    setBusy(true);
    setError(null);
    try {
      await deleteWallpaper();
    } catch {
      if (request === requestRef.current) {
        // 修复：本地图片清理失败不应阻止用户恢复配色与面板背景。
        setError(intl.formatMessage({ id: "settings.skin.cleanupError" }));
      }
    } finally {
      if (request === requestRef.current) {
        setSkin(reset ? DEFAULT_SKIN_PREFERENCE : { wallpaperRevision: null });
        setBusy(false);
      }
    }
  };

  const onFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const request = ++requestRef.current;
    setBusy(true);
    setError(null);
    try {
      const validation = await validateWallpaperFile(file);
      if (validation) {
        setError(intl.formatMessage({ id: `settings.skin.${validation}` }));
        return;
      }
      try {
        await decodeWallpaper(file);
      } catch {
        setError(intl.formatMessage({ id: "settings.skin.invalid" }));
        return;
      }
      if (request !== requestRef.current) return;
      await saveWallpaper(file);
      if (request !== requestRef.current) return;
      setSkin({ wallpaperRevision: crypto.randomUUID() });
    } catch {
      if (request === requestRef.current) {
        setError(intl.formatMessage({ id: "settings.skin.storageError" }));
      }
    } finally {
      if (request === requestRef.current) setBusy(false);
    }
  };

  return (
    <section className="min-w-0 space-y-4">
      <div>
        <h3 className="text-ui-lg font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.skin.title" })}
        </h3>
        <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
          {intl.formatMessage({ id: "settings.skin.description" })}
        </p>
      </div>

      <div className="skin-current-preview flex h-28 flex-col justify-between overflow-hidden rounded-lg border border-border p-3">
        <span className="self-start rounded-md bg-background/90 px-2 py-1 text-ui-sm text-foreground">
          {intl.formatMessage({ id: "settings.skin.preview" })}
        </span>
        <div aria-hidden="true" className="flex h-6 gap-1">
          <div
            data-skin-preview-panel="sidebar"
            className="w-1/4 rounded border border-border/50"
          />
          <div
            data-skin-preview-panel="conversation"
            className="flex-1 rounded border border-border/50"
          />
          <div data-skin-preview-panel="side" className="w-1/5 rounded border border-border/50" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-3">
        <div className="min-w-0">
          <label id="skin-panel-color-label" className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.skin.panelColorTitle" })}
          </label>
          <p id="skin-panel-color-description" className="mt-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "settings.skin.panelColorDescription" })}
          </p>
        </div>
        <Switch
          checked={preference.matchPanelColorsToWallpaper}
          onCheckedChange={(checked) => setSkin({ matchPanelColorsToWallpaper: checked })}
          aria-labelledby="skin-panel-color-label"
          aria-describedby="skin-panel-color-description"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SKIN_PRESET_IDS.map((presetId) => (
          <button
            key={presetId}
            type="button"
            aria-pressed={preference.presetId === presetId}
            onClick={() => setSkin({ presetId })}
            className="min-w-0 rounded-lg border border-border bg-card p-2 text-left text-ui-base text-foreground transition-colors hover:border-border-hover aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary/30"
          >
            <span
              aria-hidden="true"
              data-preset={presetId}
              className="skin-preview mb-2 block h-16 rounded-md"
            />
            {intl.formatMessage({ id: `settings.skin.preset.${presetId}` })}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <label className="flex min-w-0 flex-1 items-center gap-3 text-ui-base text-foreground">
          <span>{intl.formatMessage({ id: "settings.skin.customAccent" })}</span>
          <input
            type="color"
            value={preference.customAccentColor ?? DEFAULT_CUSTOM_ACCENT_COLOR}
            onChange={(event) => setSkin({ customAccentColor: event.currentTarget.value })}
            className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent p-1"
          />
          <span className="text-ui-sm text-foreground-subtle">
            {preference.customAccentColor ??
              intl.formatMessage({ id: "settings.skin.presetAccent" })}
          </span>
        </label>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setSkin({
              customAccentColor: preference.customAccentColor ? null : DEFAULT_CUSTOM_ACCENT_COLOR,
            })
          }
        >
          {intl.formatMessage({
            id: preference.customAccentColor
              ? "settings.skin.usePresetAccent"
              : "settings.skin.useCustomAccent",
          })}
        </Button>
        <p className="w-full text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.skin.customAccentDescription" })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          data-testid="skin-wallpaper-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            void onFileChange(event);
          }}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {intl.formatMessage({ id: "settings.skin.import" })}
        </Button>
        {preference.wallpaperRevision ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              void clearWallpaper(false);
            }}
          >
            {intl.formatMessage({ id: "settings.skin.clearImage" })}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void clearWallpaper(true);
          }}
        >
          {intl.formatMessage({ id: "settings.skin.reset" })}
        </Button>
      </div>

      <div className="space-y-3">
        <p className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.skin.opacityHint" })}
        </p>
        {OPACITY_FIELDS.map((field) => (
          <label key={field} className="block space-y-2 text-ui-base text-foreground">
            <span>
              {intl.formatMessage(
                { id: `settings.skin.opacity.${field}` },
                { value: preference[field] },
              )}
            </span>
            <input
              type="range"
              min={20}
              max={100}
              step={1}
              value={preference[field]}
              onChange={(event) => setSkin({ [field]: Number(event.currentTarget.value) })}
              className={SKIN_RANGE_INPUT_CLASS}
            />
          </label>
        ))}
      </div>

      {preference.wallpaperRevision ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(["wallpaperPositionX", "wallpaperPositionY"] as const).map((field) => (
            <label key={field} className="block space-y-2 text-ui-base text-foreground">
              <span>
                {intl.formatMessage({
                  id:
                    field === "wallpaperPositionX"
                      ? "settings.skin.positionX"
                      : "settings.skin.positionY",
                })}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={preference[field]}
                onChange={(event) => setSkin({ [field]: Number(event.currentTarget.value) })}
                className={SKIN_RANGE_INPUT_CLASS}
              />
            </label>
          ))}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
