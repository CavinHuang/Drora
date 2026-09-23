import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { DroraProvider } from "./drora-task-types-core.js";

export const DRORA_AGENT_PROVIDER = "glm" satisfies DroraProvider;
export const DRORA_AGENT_PROVIDER_LABEL = "Drora Agent";
export const DRORA_COMMAND_AGENT_SOURCE = "droraAgent" satisfies CommandAgentSource;

export const droraAgentProviderSchema = z.literal(DRORA_AGENT_PROVIDER);

export const DRORA_COMMAND_AGENT_SOURCES = [
  DRORA_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToDroraAgent(
  _provider?: DroraProvider | null,
): DroraProvider {
  return DRORA_AGENT_PROVIDER;
}

export function isDroraAgentProvider(
  provider: DroraProvider | null | undefined,
): provider is typeof DRORA_AGENT_PROVIDER {
  return provider === DRORA_AGENT_PROVIDER;
}
