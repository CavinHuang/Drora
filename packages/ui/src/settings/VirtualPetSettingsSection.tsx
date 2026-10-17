import { useEffect, useState, type ReactNode } from "react";
import { PawPrint } from "lucide-react";
import type { CSSProperties } from "react";
import type { DesktopPetCatalogEntry } from "@drora/shared";
import { Switch } from "@/components/ui/switch.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { logger } from "@/logger.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

/**
 * 虚拟宠物管理中心（specs/desktop-pet.md §third release）：
 * 顶部总开关 + 当前宠物大图预览 + "我的虚拟宠物"图库网格。
 * 角色目录来自平台通道（运行时单一出处），UI 不持有镜像角色表；
 * 精灵预览用整图集 + CSS 裁剪显示待机静帧，仅静帧不动画（reduced-motion 友好）。
 */

function PetSprite({ entry, scale }: { entry: DesktopPetCatalogEntry; scale: number }) {
  const { preview } = entry;
  const style: CSSProperties = {
    width: preview.frameWidth * scale,
    height: preview.frameHeight * scale,
    backgroundImage: `url("${preview.dataUrl}")`,
    backgroundSize: `${preview.columns * preview.frameWidth * scale}px ${
      preview.rows * preview.frameHeight * scale
    }px`,
    backgroundPosition: `${-preview.column * preview.frameWidth * scale}px ${
      -preview.row * preview.frameHeight * scale
    }px`,
    backgroundRepeat: "no-repeat",
    imageRendering: "pixelated",
  };
  return <span aria-hidden="true" className="inline-block shrink-0" style={style} />;
}

function PetCard({
  selected,
  name,
  description,
  preview,
  onSelect,
  ariaLabel,
}: {
  selected: boolean;
  name: string;
  description: string;
  preview: ReactNode;
  onSelect: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      onClick={onSelect}
      className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-center transition-colors ${
        selected
          ? "border-brand bg-card-selected"
          : "border-border bg-card hover:bg-surface-hover"
      }`}
    >
      {preview}
      <span className="text-ui-base font-medium text-foreground">{name}</span>
      <span className="text-ui-sm leading-5 text-foreground-subtle">{description}</span>
    </button>
  );
}

export function VirtualPetSettingsSection({  enabled,
  character,
  onChangeEnabled,
  onSelectPet,
}: {
  enabled: boolean;
  character?: string;
  onChangeEnabled: (enabled: boolean) => void;
  /** 传 null 表示选择"无"（不在桌面显示宠物，保留上次角色值）。 */
  onSelectPet: (characterId: string | null) => void;
}) {
  const { intl, locale } = useDroraIntl();
  const platform = usePlatform();
  const [catalog, setCatalog] = useState<DesktopPetCatalogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const entries = await platform.getDesktopPetCatalog?.();
        if (!cancelled) setCatalog(Array.isArray(entries) ? entries : []);
      } catch (error) {
        logger.warn("[virtual-pet] 角色目录拉取失败", {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) setCatalog([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const current = enabled ? (catalog.find((entry) => entry.id === character) ?? null) : null;
  const characterName = (entry: DesktopPetCatalogEntry) =>
    locale.startsWith("zh") ? entry.nameZh : entry.nameEn;
  const characterDescription = (entry: DesktopPetCatalogEntry) =>
    intl.formatMessage({ id: `settings.desktopPetGallery.${entry.id}` });
  // 大图预览按显示格整数倍缩放，避免 pixelated 采样出杂点：猫娘格高 192 用 1x，紫猫 96 用 2x。
  const heroScale = current && current.preview.frameHeight >= 192 ? 1 : 2;

  return (
    <div className="space-y-4">
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.desktopPetShow" })}
          description={intl.formatMessage({ id: "settings.desktopPetDescription" })}
          control={<Switch checked={enabled} onCheckedChange={onChangeEnabled} />}
        />
      </SettingsGroupCard>

      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-4 py-8">
        {current ? (
          <PetSprite entry={current} scale={heroScale} />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-24 items-center justify-center rounded-xl border border-dashed border-border text-foreground-subtle"
          >
            <PawPrint className="size-8" />
          </span>
        )}
        <span className="mt-2 text-ui-lg font-medium text-foreground">
          {current
            ? characterName(current)
            : intl.formatMessage({ id: "settings.desktopPetGallery.none" })}
        </span>
        <span className="text-ui-sm text-foreground-subtle">
          {current
            ? characterDescription(current)
            : intl.formatMessage({ id: "settings.desktopPetGallery.noneDescription" })}
        </span>
      </div>

      <div>
        <div className="text-ui-base font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.desktopPetGallery" })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <PetCard
            selected={!enabled}
            name={intl.formatMessage({ id: "settings.desktopPetGallery.none" })}
            description={intl.formatMessage({
              id: "settings.desktopPetGallery.noneDescription",
            })}
            ariaLabel={intl.formatMessage({ id: "settings.desktopPetGallery.none" })}
            preview={
              <span
                aria-hidden="true"
                className="flex size-16 items-center justify-center rounded-lg border border-dashed border-border text-foreground-subtle"
              >
                <PawPrint className="size-5" />
              </span>
            }
            onSelect={() => onSelectPet(null)}
          />
          {catalog.map((entry) => (
            <PetCard
              key={entry.id}
              selected={enabled && entry.id === character}
              name={characterName(entry)}
              description={characterDescription(entry)}
              ariaLabel={characterName(entry)}
              preview={<PetSprite entry={entry} scale={1} />}
              onSelect={() => onSelectPet(entry.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
