import { memo, type ReactNode } from "react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";

import { MATE_UNTARGETED_WORKSPACE_KEY, type MateWorkspaceGroup as Group } from "./view-model.js";

/**
 * 按目标 workspace 分组的容器（01 §5 MateWorkspaceGroup）：组头 = 目标 identity（mono）+
 * 组内实耗合计（token-only，01 §1.1；服务侧差值口径，这里只求和展示）。
 * 未指名目标（null/""，view-model 归键 ""）用 mate.workspace.untargeted 文案，不显示空串。
 */
export const MateWorkspaceGroup = memo(function MateWorkspaceGroup({
  group,
  children,
}: {
  group: Group;
  children: ReactNode;
}) {
  const { intl } = useDroraIntl();
  return (
    <section className="flex flex-col gap-1.5">
      <header className="flex items-center justify-between gap-2 px-0.5">
        <span
          className="min-w-0 truncate font-mono text-ui-xs text-foreground-subtle"
          data-testid="mate-group-key"
        >
          {group.key === MATE_UNTARGETED_WORKSPACE_KEY
            ? intl.formatMessage({ id: "mate.workspace.untargeted" })
            : group.key}
        </span>
        <span className="shrink-0 font-mono text-ui-xs text-foreground-subtlest">
          Σ {group.usageTotal.inputTokens}/{group.usageTotal.outputTokens}
        </span>
      </header>
      {children}
    </section>
  );
});
