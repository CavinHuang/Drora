import type { TuiReadClipboardImage, TuiWriteClipboardText } from "@drora/tui";
import type { UiLocale } from "@drora/i18n";
import type { Logger } from "@drora/contracts";
import type {
  createManagedCdpBrowserRuntime,
  ManagedCdpBrowserRuntimeOptions,
} from "@drora/adapters/browser";
import type {
  createModelAdapter,
  createDroraApp,
  CreateModelAdapterOptions,
  configureCodingPlanApiKey,
  ConfigureCodingPlanApiKeyOptions,
  inspectDroraSkill,
  inspectWorkspaceHookTrust,
  grantWorkspaceHookTrust,
  revokeWorkspaceHookTrustCli,
  inspectDroraCustomCommand,
  InspectDroraCustomCommandOptions,
  InspectDroraSkillOptions,
  loginDroraCli,
  loginBigmodelCodingPlan,
  LoginBigmodelCodingPlanOptions,
  LoginDroraCliOptions,
  listDroraCustomCommands,
  ListDroraCustomCommandsOptions,
  loadDroraCustomCommand,
  listDroraSessions,
  listDroraSkills,
  ListDroraSessionsOptions,
  ListDroraSkillsOptions,
  logoutDroraCli,
  LogoutDroraCliOptions,
  resolveLatestSession,
  ResolveLatestSessionOptions,
  RunDroraProtocolAgentOptions,
  prepareDroraTelemetryEnv,
  startProcessProviderRegistryRuntime,
  shutdownDroraTelemetry,
  DroraAppOptions,
} from "@drora/bootstrap";
import type { CliEnv, DotenvLoadResult, LoadCliDotenvOptions } from "./env.js";
import type { PluginsCommandOverrides } from "./plugins-command.js";
import type { CliShutdownProcess } from "./shutdown.js";
import type { resolveWorkspaceGitBranch } from "./tui-workspace-git.js";

export type BootstrapModule = typeof import("@drora/bootstrap");

export interface RunDependencies extends PluginsCommandOverrides {
  protocolLifecycle?: RunDroraProtocolAgentOptions["lifecycle"];
  protocolInput?: NodeJS.ReadableStream;
  createManagedCdpBrowserRuntime?: (
    options?: ManagedCdpBrowserRuntimeOptions,
  ) => ReturnType<typeof createManagedCdpBrowserRuntime>;
  createModelAdapter?: (
    options?: CreateModelAdapterOptions,
  ) => ReturnType<typeof createModelAdapter>;
  createDroraApp?: (
    options?: DroraAppOptions,
  ) => Awaited<ReturnType<typeof createDroraApp>> | ReturnType<typeof createDroraApp>;
  /**
   * Session-event shaper for --output-format stream-json. Defaults to the
   * bootstrap module's, which is also what the protocol server uses; injectable
   * so a caller that supplies its own `createDroraApp` (tests, embedders) can
   * still stream, since the bootstrap module is not loaded on that path.
   */
  mapSessionEvent?: BootstrapModule["mapSessionEvent"];
  cwd?: () => string;
  env?: CliEnv;
  inspectSkill?: (options: InspectDroraSkillOptions) => ReturnType<typeof inspectDroraSkill>;
  inspectWorkspaceHookTrust?: typeof inspectWorkspaceHookTrust;
  grantWorkspaceHookTrust?: typeof grantWorkspaceHookTrust;
  revokeWorkspaceHookTrustCli?: typeof revokeWorkspaceHookTrustCli;
  inspectCustomCommand?: (
    options: InspectDroraCustomCommandOptions,
  ) => ReturnType<typeof inspectDroraCustomCommand>;
  loginDroraCli?: (options?: LoginDroraCliOptions) => ReturnType<typeof loginDroraCli>;
  loginBigmodelCodingPlan?: (
    options?: LoginBigmodelCodingPlanOptions,
  ) => ReturnType<typeof loginBigmodelCodingPlan>;
  configureCodingPlanApiKey?: (
    options: ConfigureCodingPlanApiKeyOptions,
  ) => ReturnType<typeof configureCodingPlanApiKey>;
  loadDotenv?: (options?: LoadCliDotenvOptions) => DotenvLoadResult;
  prepareDroraTelemetryEnv?: typeof prepareDroraTelemetryEnv;
  projectConfigPath?: string;
  listSessions?: (options: ListDroraSessionsOptions) => ReturnType<typeof listDroraSessions>;
  listCustomCommands?: (
    options: ListDroraCustomCommandsOptions,
  ) => ReturnType<typeof listDroraCustomCommands>;
  loadCustomCommand?: (
    options: InspectDroraCustomCommandOptions,
  ) => ReturnType<typeof loadDroraCustomCommand>;
  // headless slash 路由要和 app facade 的保留名 gate 用同一个判据；默认取 bootstrap 的，
  // 注入点只为让单测不必拉起整个 bootstrap 模块。见 prompt-command.ts。
  isReservedSlashCommandName?: BootstrapModule["isReservedDroraSlashCommandName"];
  listSkills?: (options: ListDroraSkillsOptions) => ReturnType<typeof listDroraSkills>;
  logger?: Logger;
  readClipboardImage?: TuiReadClipboardImage;
  writeClipboardText?: TuiWriteClipboardText;
  resolveLatestSession?: (
    options: ResolveLatestSessionOptions,
  ) => ReturnType<typeof resolveLatestSession>;
  resolveWorkspaceGitBranch?: typeof resolveWorkspaceGitBranch;
  logoutDroraCli?: (options?: LogoutDroraCliOptions) => ReturnType<typeof logoutDroraCli>;
  runDroraProtocolAgent?: (options?: RunDroraProtocolAgentOptions) => Promise<void>;
  runTui?: typeof import("@drora/tui").runTui;
  skipUserConfig?: boolean;
  userConfigPath?: string;
  exitProcess?: (code: number) => void;
  shutdownCleanupTimeoutMs?: number;
  shutdownProcess?: CliShutdownProcess;
  startProcessProviderRegistryRuntime?: typeof startProcessProviderRegistryRuntime;
  shutdownDroraTelemetry?: typeof shutdownDroraTelemetry;
}

export type CliPermissionMode = "build" | "plan" | "edit" | "yolo";
export type CliRuntimeMode = CliPermissionMode | "auto";

export interface CliModeState {
  current?: CliRuntimeMode;
  override?: CliPermissionMode;
}

export interface CliTargetRequest {
  objective: string;
  replaceExisting: boolean;
}

export type ModeCapableApp = Awaited<ReturnType<typeof createDroraApp>> & {
  getMode?: () => CliRuntimeMode;
  setLocale?: (locale: UiLocale) => Promise<{ locale: "en-US" | "zh-CN" }>;
  setMode?: (mode: CliRuntimeMode) => Promise<{ mode: CliRuntimeMode }>;
};

export interface CliResumeRequest {
  continueSession: boolean;
  resumeSessionId?: string;
}
