import {
  DRORA_AGENT_PROVIDER,
  DRORA_COMMAND_AGENT_SOURCES,
  type DroraProvider,
  type CommandAgentSource,
} from "@drora/shared";

export const COMMAND_AGENT_SOURCES = [
  ...DRORA_COMMAND_AGENT_SOURCES,
] as const satisfies readonly CommandAgentSource[];

export const COMMAND_AGENT_SOURCE_META: Record<
  CommandAgentSource,
  {
    labelId: string;
    provider: DroraProvider;
    pathHint: string;
  }
> = {
  droraAgent: {
    labelId: "settings.commands.source.droraAgent",
    pathHint: "~/.drora/commands",
    provider: DRORA_AGENT_PROVIDER,
  },
};
