import { Switch } from "@/components/ui/switch.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function DesktopPetSettingsRow({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.desktopPet" })}
        description={intl.formatMessage({ id: "settings.desktopPetDescription" })}
        control={<Switch checked={checked} onCheckedChange={onChange} />}
      />
    </SettingsGroupCard>
  );
}
