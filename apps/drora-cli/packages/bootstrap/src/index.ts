// Bootstrap public API surface.

export * from "./app/create-app.js";
export type {
  ListDroraSessionsOptions,
  PromptInput,
  ResolveLatestSessionOptions,
  ResumeOptions,
  RunDroraProtocolAgentOptions,
  SendInputOptions,
  SendInputResult,
  SetLocaleResult,
  SteerTurnOptions,
  SubmitPromptOptions,
  UserPromptInput,
  DroraApp,
  DroraAppOptions,
  DroraModelOption,
} from "./app/types.js";
export * from "./auth-login.js";
export {
  inspectDroraCustomCommand,
  listDroraCustomCommands,
  loadDroraCustomCommand,
} from "./custom-commands.js";
export type {
  InspectDroraCustomCommandOptions,
  ListDroraCustomCommandsOptions,
  DroraCustomCommandInspection,
} from "./custom-commands.js";
export { createModelAdapter } from "./model-factory.js";
export type { CreateModelAdapterOptions } from "./model-factory.js";
export { startProcessProviderRegistryRuntime } from "./app/process-provider-registry-runtime.js";
export type { ProcessProviderRegistryRuntimeOptions } from "./app/process-provider-registry-runtime.js";
export {
  addDroraPluginMarketplace,
  getDroraPluginsOverview,
  installDroraMarketplacePlugin,
  listDroraPlugins,
  removeDroraPluginMarketplace,
  resolveDroraPlugins,
  setDroraPluginEnabled,
  uninstallDroraMarketplacePlugin,
  updateDroraMarketplacePlugin,
  updateDroraPluginMarketplace,
  validateDroraPluginPath,
} from "./plugins.js";
export type {
  AddDroraMarketplaceOptions,
  InstallDroraMarketplacePluginOptions,
  ListDroraPluginsOptions,
  RemoveDroraMarketplaceOptions,
  ResolveDroraPluginsOptions,
  SetDroraPluginEnabledOptions,
  SetDroraPluginEnabledResult,
  UninstallDroraMarketplacePluginOptions,
  UpdateDroraMarketplaceOptions,
  UpdateDroraMarketplacePluginOptions,
  ValidateDroraPluginPathOptions,
  DroraAvailablePluginData,
  DroraInstalledPluginData,
  DroraMarketplaceSummaryData,
  DroraMarketplaceUpdateData,
  DroraPluginInstallData,
  DroraPluginUpdateData,
  DroraPluginsOverviewData,
} from "./plugins.js";
export { runDroraProtocolAgent } from "./drora-protocol-entrypoint.js";
// Exposed for the CLI's --output-format stream-json: it needs the same event
// shape the protocol server emits, rather than inventing a second one.
export { mapSessionEvent } from "./drora-protocol/session-mapper.js";
export { prepareDroraTelemetryEnv, shutdownDroraTelemetry } from "./telemetry-bootstrap.js";
export type { SessionTranscriptMessage, SessionTranscriptPart } from "./session-transcript.js";
export { listDroraSessions, resolveLatestSession } from "./sessions.js";
export { inspectDroraSkill, listDroraSkills } from "./skills.js";
export type {
  InspectDroraSkillOptions,
  ListDroraSkillsOptions,
  DroraSkillInspection,
} from "./skills.js";
// Exposed for the CLI's headless slash routing: it must decide "is this a real
// custom command?" with the *same* reserved-name gate the app facade's
// customCommandPromptResolver applies, or the two disagree and a reserved name
// reaches the model as literal prompt text. See prompt-command.ts.
export { isReservedDroraSlashCommandName } from "./slash-command-surface.js";
export {
  grantWorkspaceHookTrust,
  inspectWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
} from "./workspace-hook-trust-cli.js";
export type {
  WorkspaceHookTrustCliItem,
  WorkspaceHookTrustCliStatus,
  WorkspaceHookTrustCliTarget,
} from "./workspace-hook-trust-cli.js";
