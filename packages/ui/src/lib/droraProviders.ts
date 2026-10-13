import {
  DRORA_AGENT_PROVIDER,
  DRORA_AGENT_PROVIDER_LABEL,
  type DroraProvider,
} from "@drora/shared";

export const DRORA_AGENT_PROVIDERS: DroraProvider[] = [DRORA_AGENT_PROVIDER];

export const DRORA_AGENT_PROVIDER_LABELS: Record<DroraProvider, string> = {
  glm: DRORA_AGENT_PROVIDER_LABEL,
};

export function supportsDroraSessionFork(provider: DroraProvider): boolean {
  void provider;
  // 功能开关：fork 入口恢复对所有 Drora provider 开放；实际可操作性仍由 task 状态、
  // assistant 目标和运行中保护 guard 控制，避免把 active/failed 分支暴露为可 fork。
  return true;
}

export function shouldHideDroraSessionForkAction(provider: DroraProvider): boolean {
  return !supportsDroraSessionFork(provider);
}
