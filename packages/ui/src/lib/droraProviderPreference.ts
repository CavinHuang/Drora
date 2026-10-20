import {
  normalizeAgentProviderToDroraAgent,
  DRORA_AGENT_PROVIDER,
  type DroraProvider,
} from "@drora/shared";
import { DRORA_AGENT_PROVIDERS } from "./droraProviders.js";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY = "drora-last-agent-provider";

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isAgentProvider(value: unknown): value is DroraProvider {
  return typeof value === "string" && DRORA_AGENT_PROVIDERS.includes(value as DroraProvider);
}

export function readLastSelectedAgentProvider(
  storage: StorageLike | null = getBrowserStorage(),
): DroraProvider | null {
  const rawValue = storage?.getItem(LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY);
  if (!isAgentProvider(rawValue)) {
    return DRORA_AGENT_PROVIDER;
  }

  // Bugfix: 单 Drora Agent 迁移后，旧本地存储里已移除的第三方 provider 值不能再参与首屏预热。
  // 否则 UI 会短暂以旧 provider 作为事实源发起 prepare/create，和 agent server 的 glm 状态产生竞态。
  return normalizeAgentProviderToDroraAgent(rawValue);
}

export function persistLastSelectedAgentProvider(
  provider: DroraProvider,
  storage: StorageLike | null = getBrowserStorage(),
) {
  // Bugfix: 迁移到单 Drora Agent 后，旧本地存储里可能还保存已移除的第三方 provider。
  // 如果继续照读，草稿预热和首发 createTask 会在 UI 层短暂走错 provider。这里统一收敛到 glm。
  storage?.setItem(
    LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY,
    normalizeAgentProviderToDroraAgent(provider),
  );
}
