import { CheckIcon, CircleIcon } from "lucide-react";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { teamFacts } from "./presentation.js";
import type { TeamPanelModel } from "./view-model.js";
import type { TeamUiFocus } from "./contract.js";

export function TeamStageRail({
  model,
  onSelect,
}: {
  model: TeamPanelModel;
  onSelect: (focus: TeamUiFocus) => void;
}) {
  const { intl } = useDroraIntl(),
    facts = teamFacts(model);
  const stages = [
    {
      label: "team.ui.phasePlan",
      complete: model.status !== "staged",
      running: model.status === "staged",
      kind: "overview",
    },
    {
      label: "team.ui.phaseWork",
      complete: facts.total > 0 && facts.completed === facts.total,
      running: model.status === "active",
      kind: "overview",
    },
    {
      label: "team.ui.phaseDone",
      complete: facts.total > 0 && facts.completed === facts.total,
      running: false,
      kind: "process",
    },
  ] as const;
  return (
    <div className="mt-3 flex min-w-0 items-center gap-1" data-testid="team-stage-rail">
      {stages.map((stage, index) => (
        <div
          key={stage.label}
          className={index ? "flex min-w-0 flex-1 items-center gap-1" : "flex min-w-0 items-center"}
        >
          {index ? <span className="h-px min-w-1 flex-1 bg-workflow-trace" /> : null}
          <button
            type="button"
            onClick={() => onSelect({ teamId: model.teamId, kind: stage.kind })}
            className="flex shrink-0 items-center gap-1 rounded-md px-1 py-1 text-ui-sm hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
          >
            {stage.complete ? (
              <CheckIcon className="size-3 text-success" />
            ) : (
              <CircleIcon
                className={`size-3 ${stage.running ? "text-warning" : "text-foreground-subtlest"}`}
              />
            )}
            {intl.formatMessage({ id: stage.label })}
          </button>
        </div>
      ))}
    </div>
  );
}
