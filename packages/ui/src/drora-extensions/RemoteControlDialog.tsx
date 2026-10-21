import { useMemo, useState, type ComponentProps } from "react";
import { WebRemoteControlDialog } from "@/web-remote-control/index.js";
import { useSettings } from "../hooks/useSettingService.js";
import { usePlatform } from "../hooks/usePlatform.js";
import { useDroraIntl } from "../i18n/IntlProvider.js";
import { toast } from "../components/ui/toast.js";

/** 部署选项属于 Drora；二维码、状态和连接操作继续复用官方弹层。 */
export function DroraRemoteControlDialog(props: ComponentProps<typeof WebRemoteControlDialog>) {
  const { settings, loading, update } = useSettings();
  const platform = usePlatform();
  const { locale } = useDroraIntl();
  const [changing, setChanging] = useState(false);
  const transport = settings?.mobileRelayTransport ?? "lan";
  const zh = locale.startsWith("zh");
  const deploymentControls = useMemo(
    () => (
      <label className="mt-4 flex items-center gap-2 text-sm">
        {zh ? "连接方式" : "Connection"}
        <select
          className="rounded border border-border bg-background p-2"
          value={transport}
          disabled={changing}
          onChange={async (event) => {
            const next = event.target.value as "lan" | "relay";
            setChanging(true);
            try {
              await platform.stopWebRemoteControl();
              await update({ mobileRelayTransport: next });
            } catch (error) {
              toast(error instanceof Error ? error.message : String(error), {
                variant: "warning",
              });
            } finally {
              setChanging(false);
            }
          }}
        >
          <option value="lan">{zh ? "局域网" : "Local network"}</option>
          <option value="relay">{zh ? "云中继 / 自建 Relay" : "Cloud / self-hosted Relay"}</option>
        </select>
      </label>
    ),
    [zh, transport, changing, platform, update],
  );
  if (loading || !settings) return null;
  return (
    <WebRemoteControlDialog {...props} key={transport} deploymentControls={deploymentControls} />
  );
}
