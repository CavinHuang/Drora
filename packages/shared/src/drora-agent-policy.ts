import { z } from "zod";
import type { CommandAgentSource } from "./command-types.js";
import type { DroraProvider } from "./drora-task-types-core.js";

export const DRORA_AGENT_PROVIDER = "glm" satisfies DroraProvider;
export const DRORA_AGENT_PROVIDER_LABEL = "Drora Agent";
export const DRORA_COMMAND_AGENT_SOURCE = "droraAgent" satisfies CommandAgentSource;

/**
 * 解析持久化/relay 数据时的 provider 归一 schema：
 * 已移除的第三方 provider 历史值仅作为归一化输入保留，统一收敛为 glm；
 * 其它非法值保持拒绝，与收窄前的校验边界一致。
 */
export const legacyDroraProviderSchema = z
  .enum(["claude", "opencode", "gemini", "codex", "glm"])
  .transform((): typeof DRORA_AGENT_PROVIDER => DRORA_AGENT_PROVIDER);

export const DRORA_ENABLED_AGENT_PROVIDERS = [
  DRORA_AGENT_PROVIDER,
] as const satisfies readonly DroraProvider[];

export const DRORA_COMMAND_AGENT_SOURCES = [
  DRORA_COMMAND_AGENT_SOURCE,
] as const satisfies readonly CommandAgentSource[];

export function normalizeAgentProviderToDroraAgent(
  _provider?: DroraProvider | null,
): DroraProvider {
  return DRORA_AGENT_PROVIDER;
}

export function normalizeAgentProvidersToDroraAgent(
  _providers?: ReadonlyArray<DroraProvider> | null,
): DroraProvider[] {
  return [...DRORA_ENABLED_AGENT_PROVIDERS];
}

export function normalizeCommandAgentSourceToDroraAgent(
  _agentSource?: CommandAgentSource | null,
): CommandAgentSource {
  return DRORA_COMMAND_AGENT_SOURCE;
}

export function isDroraAgentProvider(
  provider: DroraProvider | null | undefined,
): provider is typeof DRORA_AGENT_PROVIDER {
  return provider === DRORA_AGENT_PROVIDER;
}
