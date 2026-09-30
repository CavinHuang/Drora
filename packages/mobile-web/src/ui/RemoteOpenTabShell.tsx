// 官方 side-pane-toggle 首屏壳（bundle index-NjWRUABD.js:241629-241685）。
// tab 命令由上层按实际 attachment 能力注入；无命令时只展示文案，不伪造按钮。
import type { ReactNode } from "react";
import { PanelRightClose } from "lucide-react";
import { useIntl } from "./intl.js";

export interface RemoteOpenTabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onOpen: () => void;
}

export function RemoteOpenTabShell({
  onClose,
  items = [],
}: {
  onClose: () => void;
  items?: readonly RemoteOpenTabItem[];
}) {
  const { formatMessage } = useIntl();
  return (
    <aside
      aria-label={formatMessage({ id: "sidePane.openTabs" })}
      className="absolute inset-y-0 right-0 z-20 w-80 max-w-[85%] border-l border-border bg-background shadow-lg"
    >
      <div className="side-pane-open-tab-shell flex h-full min-h-0 flex-col bg-background">
        <div className="flex h-12 shrink-0 items-center justify-end px-2">
          <button
            type="button"
            aria-label={formatMessage({ id: "sidePane.collapse" })}
            className="inline-flex size-7 items-center justify-center rounded-lg text-foreground-subtle hover:bg-surface-hover"
            onClick={onClose}
          >
            <PanelRightClose aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-10">
          <div className="side-pane-open-tab-content flex w-full max-w-[20rem] flex-col gap-5">
            <div className="flex flex-col gap-2 text-center">
              <h2 className="text-ui-xl font-semibold leading-7 text-foreground">
                {formatMessage({ id: "sidePane.openTab" })}
              </h2>
              <p className="text-ui-base leading-5 text-foreground-subtle">
                {formatMessage({ id: "sidePane.openTabDescription" })}
              </p>
            </div>
            <div className="side-pane-open-tab-list flex w-full flex-col gap-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-side-pane-open-tab-item={item.id}
                  className="side-pane-open-tab-button flex h-12 min-w-0 items-center gap-3 rounded-xl bg-surface px-3 text-ui-base font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={item.onOpen}
                >
                  {item.icon}
                  <span className="side-pane-open-tab-button-label min-w-0 flex-1 truncate text-left">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
