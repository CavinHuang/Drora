import { Blocks, BookMarked, CalendarClock } from "lucide-react";
import { TID_AUTOMATIONS_OPEN } from "@drora/shared/test-ids";
import type { ProjectSidebarProps } from "@/project-sidebar/contract.js";
import { Button } from "@/components/ui/button.js";
import { NewTaskButtonGroup } from "@/NewTaskButtonGroup.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { WebRemoteControlDeviceHeader } from "@/web-remote-control/WebRemoteControlDeviceHeader.js";

/** 顶部导航只展示 Shell 的选中状态，路由仍由 Shell 唯一持有。 */
export function ProjectSidebarNavigation({
  props,
  onCreate,
}: {
  props: Pick<
    ProjectSidebarProps,
    | "isWebRemoteControl"
    | "onOpenAutomations"
    | "automationsActive"
    | "onOpenPluginStore"
    | "pluginStoreActive"
    | "onOpenVault"
    | "vaultActive"
    | "webRemoteControlWorkspaceSwitcher"
  >;
  onCreate(): void;
}) {
  const { intl } = useDroraIntl();
  const deviceNavigation = props.webRemoteControlWorkspaceSwitcher?.deviceNavigation;
  return (
    <div
      data-testid="sidebar-primary-navigation"
      className={`flex flex-col gap-1 px-2 py-3 ${props.isWebRemoteControl && !deviceNavigation ? "max-md:pt-11" : ""}`}
    >
      {/* Relay V2 远控：当前电脑是项目与任务的上一级，放在导航首行；手机端占用原顶部留白。 */}
      {deviceNavigation ? <WebRemoteControlDeviceHeader navigation={deviceNavigation} /> : null}
      <NewTaskButtonGroup onCreateTask={onCreate} />
      {props.onOpenAutomations ? (
        <Button
          variant="ghost"
          size="lg"
          className={`w-full justify-start gap-2 ${props.automationsActive ? "bg-selected text-foreground" : ""}`}
          aria-pressed={props.automationsActive ?? false}
          data-testid={TID_AUTOMATIONS_OPEN}
          // 点击事件不能进入业务导航的可选 automationId 参数。
          onClick={() => props.onOpenAutomations?.()}
        >
          <CalendarClock className="size-4" />
          {intl.formatMessage({ id: "workspace.openScheduledSettings" })}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="lg"
        className={`w-full justify-start gap-2 ${props.pluginStoreActive ? "bg-selected text-foreground" : ""}`}
        aria-pressed={props.pluginStoreActive ?? false}
        data-testid="plugin-store-sidebar-open"
        onClick={() => props.onOpenPluginStore?.()}
      >
        <Blocks className="size-4" />
        {intl.formatMessage({ id: "workspace.openPluginsSettings" })}
      </Button>
      {/* Drora 扩展槽位：vault 侧栏入口（上游 ProjectSidebarProps 无该槽位，审计
          docs/upstream-sync/2026-10-21-v3.16.1-merge-audit.md F7 回植）。可选接线，
          未接线时不渲染；点击只上报 Shell，vault 路由由 Shell 唯一持有。 */}
      {props.onOpenVault ? (
        <Button
          variant="ghost"
          size="lg"
          className={`w-full justify-start gap-2 ${props.vaultActive ? "bg-selected text-foreground" : ""}`}
          aria-pressed={props.vaultActive ?? false}
          data-testid="vault-sidebar-open"
          onClick={() => props.onOpenVault?.()}
        >
          <BookMarked className="size-4" />
          {intl.formatMessage({ id: "workspace.openVault" })}
        </Button>
      ) : null}
    </div>
  );
}
