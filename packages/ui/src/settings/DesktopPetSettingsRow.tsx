import { DESKTOP_PET_BUILTINS, DESKTOP_PET_CONTRACT as C } from "@drora/shared";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch.js";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { useDesktopPetLibrary } from "@/hooks/useDesktopPetLibrary.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function DesktopPetSettingsRow({
  checked,
  character = "violet",
  size = C.defaultSize,
  onChange,
  onCharacterChange,
  onSizeChange,
  onCreatePet,
  onUpgradePet,
}: {
  checked: boolean;
  character?: string;
  size?: number;
  onChange(checked: boolean): void;
  onCharacterChange(character: string): void;
  onSizeChange(size: number): void;
  onCreatePet?(directory: string): void;
  onUpgradePet?(directory: string, source: string): void;
}) {
  const { intl, locale } = useDroraIntl();
  const { catalog, preview, busy, error, run, supported } = useDesktopPetLibrary(character);
  const [sizeDraft, setSizeDraft] = useState(size);
  useEffect(() => {
    setSizeDraft(size);
  }, [size]);
  const message = (key: string) => intl.formatMessage({ id: `settings.desktopPet.${key}` });
  const custom = character.startsWith(C.customPrefix);
  const entries = [
    ...DESKTOP_PET_BUILTINS.map((pet) => ({
      id: pet.id,
      label: locale.startsWith("zh") ? pet.nameZh : pet.nameEn,
    })),
    ...(catalog?.pets ?? []).map((pet) => ({ id: pet.id, label: pet.displayName })),
  ];
  const missing = !entries.some((pet) => pet.id === character);
  const canUpgrade = catalog?.pets.some(
    (pet) => pet.id === character && pet.spriteVersionNumber === 1,
  );
  // 固定 192px 控件列会把窄窗口的说明挤成短行；复用现有 wide 布局，在小屏上下排列。
  return (
    <SettingsGroupCard>
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.desktopPet" })}
        description={intl.formatMessage({ id: "settings.desktopPetDescription" })}
        control={
          <Switch checked={checked} onCheckedChange={onChange} data-testid="desktop-pet-enabled" />
        }
      />
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.desktopPetCharacter" })}
        description={intl.formatMessage({ id: "settings.desktopPetCharacterDescription" })}
        control={
          <Select value={character} onValueChange={onCharacterChange}>
            <SelectTrigger
              className="w-44"
              aria-label={intl.formatMessage({ id: "settings.desktopPetCharacter" })}
              data-testid="desktop-pet-character"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {missing ? (
                <SelectItem value={character} disabled>
                  {message("unavailable")}
                </SelectItem>
              ) : null}
              {entries.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {preview ? (
        <div
          className="flex justify-center p-3"
          aria-hidden="true"
          data-testid="desktop-pet-preview"
        >
          <div
            className="bg-no-repeat"
            style={{
              width: preview.width,
              height: preview.height,
              backgroundImage: `url("${preview.image}")`,
              backgroundSize: `${preview.columns * 100}% ${preview.rows * 100}%`,
            }}
          />
        </div>
      ) : null}
      <SettingsRow
        controlLayout="wide"
        label={message("size")}
        description={`${sizeDraft} px`}
        control={
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={C.minSize}
              max={C.maxSize}
              value={sizeDraft}
              aria-label={message("size")}
              data-testid="desktop-pet-size"
              className="w-32 accent-primary"
              onChange={(event) => setSizeDraft(Number(event.target.value))}
              onPointerUp={() => onSizeChange(sizeDraft)}
              onKeyUp={() => onSizeChange(sizeDraft)}
              onBlur={() => {
                if (sizeDraft !== size) onSizeChange(sizeDraft);
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => onSizeChange(C.defaultSize)}>
              {message("reset")}
            </Button>
          </div>
        }
      />
      {supported ? (
        <div className="space-y-2 border-t border-border px-3 py-3" aria-busy={busy}>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run({ action: "refresh" })}
              data-testid="desktop-pet-refresh"
            >
              {message("refresh")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run({ action: "open-folder" })}
            >
              {message("folder")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run({ action: "import-directory" })}
              data-testid="desktop-pet-import"
            >
              {message("importPack")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run({ action: "import-image" })}
            >
              {message("importImage")}
            </Button>
            {onCreatePet ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !catalog?.directoryPath}
                onClick={() => {
                  if (catalog?.directoryPath) onCreatePet(catalog.directoryPath);
                }}
                data-testid="desktop-pet-create"
              >
                {message("create")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void run({ action: "create-template" })}
            >
              {message("guide")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || missing}
              data-testid="desktop-pet-export"
              onClick={() => void run({ action: "export", id: character })}
            >
              {message("export")}
            </Button>
            {custom ? (
              <>
                {onUpgradePet && canUpgrade ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    data-testid="desktop-pet-upgrade"
                    onClick={() => {
                      void run({ action: "prepare-upgrade", id: character }).then((result) => {
                        if (result?.upgrade)
                          onUpgradePet(result.directoryPath, result.upgrade.directoryPath);
                      });
                    }}
                  >
                    {message("upgrade")}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || missing}
                  onClick={() => void run({ action: "delete", id: character })}
                >
                  {message("delete")}
                </Button>
              </>
            ) : null}
          </div>
          <p className="text-ui-caption text-foreground-subtle">{message("compatibility")}</p>
          {catalog?.directoryPath ? (
            <p className="break-all text-ui-caption text-foreground-subtlest">
              {catalog.directoryPath}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-ui-caption text-destructive">
              {message("error")}
            </p>
          ) : null}
          {catalog?.errors.length ? (
            <p role="status" className="text-ui-caption text-warning">
              {intl.formatMessage(
                { id: "settings.desktopPet.invalid" },
                { count: catalog.errors.length },
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </SettingsGroupCard>
  );
}
