import { Switch } from "@/components/ui/switch.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

// 与 desktop 侧 desktopPetCharacter.ts 的 DESKTOP_PET_CHARACTER_IDS 对齐；
// UI 包不反向依赖 desktop，这里只放展示标签。
const DESKTOP_PET_CHARACTERS = [
  { id: "violet", zh: "紫罗兰 · 小猫", en: "Violet the cat" },
  { id: "noir", zh: "夜墨 · 黑猫娘", en: "Noir" },
  { id: "snow", zh: "雪铃 · 白猫娘", en: "Snow" },
  { id: "ginger", zh: "杏桃 · 橘猫娘", en: "Ginger" },
] as const;

export function DesktopPetSettingsRow({
  checked,
  character,
  onChange,
  onCharacterChange,
}: {
  checked: boolean;
  character?: string;
  onChange: (checked: boolean) => void;
  onCharacterChange: (character: string) => void;
}) {
  const { intl, locale } = useDroraIntl();
  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.desktopPet" })}
        description={intl.formatMessage({ id: "settings.desktopPetDescription" })}
        control={<Switch checked={checked} onCheckedChange={onChange} />}
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.desktopPetCharacter" })}
        description={intl.formatMessage({ id: "settings.desktopPetCharacterDescription" })}
        control={
          <Select
            value={character ?? "violet"}
            onValueChange={onCharacterChange}
          >
            <SelectTrigger
              className="w-44"
              aria-label={intl.formatMessage({ id: "settings.desktopPetCharacter" })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DESKTOP_PET_CHARACTERS.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {locale.startsWith("zh") ? entry.zh : entry.en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsGroupCard>
  );
}
