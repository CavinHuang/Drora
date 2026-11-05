import { memo } from "react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";

import { mateSourceKindMessageId } from "./view-model.js";

/**
 * 触发来源徽标（P3 Source 注册表呈现，spec §11 落地注记）：决策卡/观察行共用——
 * mateSourceKindMessageId 封闭映射，未知来源不渲染（不发明第四种来源）。
 */
export const MateSourceBadge = memo(function MateSourceBadge({ sourceKind }: { sourceKind: string }) {
  const { intl } = useDroraIntl();
  const messageId = mateSourceKindMessageId(sourceKind);
  if (messageId === null) return null;
  return (
    <span
      className="shrink-0 rounded-sm bg-tag px-1.5 py-0.5 text-ui-xs text-foreground-subtle"
      data-testid="mate-source-badge"
      data-source-kind={sourceKind}
    >
      {intl.formatMessage({ id: messageId })}
    </span>
  );
});
