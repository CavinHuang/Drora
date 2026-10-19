export {
  TEAM_UI_MODULE_ID,
  createTeamPanelController,
  type TeamPanelController,
  type TeamPanelViewModel,
  type TeamUiStatus,
} from "./contract.js";
export { teamUiModule } from "./module.js";
export {
  abandonTeamPlan,
  approveTeamPlan,
  haltTeam,
  resumeTeam,
  reviseTeamPlan,
  sendTeamMessage,
  setTeamMemberName,
  stopTeamMember,
  type TeamCommandInput,
  type TeamCommandOutcome,
  type TeamCommandSender,
} from "./commands.js";
export {
  TeamPanel,
  teamPanelActionVisibility,
  type TeamPanelActionVisibility,
  type TeamPanelCommand,
  type TeamPanelCommandType,
  type TeamPanelProps,
} from "./TeamPanel.js";
export { TeamStagedEditor, type TeamStagedEditorProps } from "./TeamStagedEditor.js";
export {
  buildTeamReviseComposerPrefill,
  TEAM_REVISE_PREFILL_PROMPT_KEY,
  type TeamReviseComposerPrefillInput,
} from "./revise-prefill.js";
export {
  resolveTeamMemberDrillSession,
  TeamMemberSidePane,
  type TeamMemberDrillState,
  type TeamMemberSidePaneProps,
} from "./TeamMemberSidePane.js";
export { shouldAutoOpenTeamPanel } from "./auto-open.js";
export { useWorkspaceConfigCatalogSync } from "./workspace-config-catalog-sync.js";
export {
  TEAM_STATUS_DOT_TONE,
  TEAM_STATUS_I18N_KEYS,
  type TeamStatusDotTone,
} from "./team-status-presentation.js";
export { TeamStagedAutoOpenBridge } from "./TeamStagedAutoOpenBridge.js";
export { TeamTabStatusDot } from "./TeamTabStatusDot.js";
export {
  mapTeamProjectionToViewModel,
  type TeamPanelMemberView,
  type TeamPanelModel,
  type TeamPanelStagedDraftView,
  type TeamPanelStagedMemberView,
  type TeamPanelStagedTaskView,
  type TeamPanelTaskView,
} from "./view-model.js";
