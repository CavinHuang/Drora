import { useDroraIntl } from "@/i18n/IntlProvider.js";
import type { TeamUiStatus } from "./contract.js";
import {
  TEAM_STATUS_DOT_TONE,
  TEAM_STATUS_I18N_KEYS,
  TONE_DOT_CLASS,
} from "./team-status-presentation.js";

export function TeamStatusBadge({ status }: { status: TeamUiStatus }) {
  const { intl } = useDroraIntl();
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-ui-sm"
      data-team-status={status}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${TONE_DOT_CLASS[TEAM_STATUS_DOT_TONE[status]]}`}
      />
      {intl.formatMessage({ id: TEAM_STATUS_I18N_KEYS[status] })}
    </span>
  );
}
