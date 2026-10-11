/**
 * Jev 装配配置解析（specs/obsidian-knowledge.md §5d.10）。
 *
 * createLocalServices 是同步函数，而开关/凭据读取是异步——预解析必须发生在
 * host 侧已有的异步初始化段，经快照 option 传回装配函数。本模块只提供：
 * 1. resolveKnowledgeJevAssembly：开关关 / 凭据缺失 / 该提供商必填项缺失一律返回
 *    null（fail-closed，装配层据此不注入 decisionProviderFactory，grant 走 disabled，
 *    零出站）；
 * 2. createKnowledgeJevProviderFactory：把快照闭包成 W05 约定的 provider 工厂
 *    （必须走工厂而非静态 provider——逐调用授权重查要求与管线共享同一账本实例），
 *    按 provider 选择传输实现（TypeSafe 原生 / OpenAI 兼容 chat/completions）。
 *
 * 安全不变式（ADR #5/#11）：API Key 只从 credentialService 读出、只在 Host 侧
 * 闭包内使用；不进 RPC 面、日志与诊断。
 */
import {
  KNOWLEDGE_JEV_AI_GATEWAY_CREDENTIAL_KEY,
  KNOWLEDGE_JEV_CREDENTIAL_KEY,
  KNOWLEDGE_JEV_OPENROUTER_CREDENTIAL_KEY,
} from "@drora/shared";

import { createCredentialService } from "../../credential/credentialService.js";
import type { ICredentialService } from "../../credential/credential.js";
import type { ISettingService } from "../../setting/setting.js";
import type { KnowledgeDecisionPolicyConfig, KnowledgeDecisionProvider } from "./decisionTypes.js";
import type { DecisionConsentRegistry } from "./decisionConsent.js";
import { createJevAdapter } from "./jevAdapter.js";
import {
  createChatCompletionsScoringTransport,
  createTypeSafeHttpTransport,
} from "./jevTransport.js";

/** 装配期快照（按提供商判别）：开关开且该提供商必填项齐备时才产生。 */
export type KnowledgeJevAssembly =
  | { provider: "typesafe"; apiKey: string; baseUrl?: string }
  | { provider: "openrouter"; apiKey: string; model: string; baseUrl?: string }
  | { provider: "ai-gateway"; apiKey: string; model: string; baseUrl?: string };

export interface ResolveKnowledgeJevAssemblyOptions {
  settingService: Pick<ISettingService, "get">;
  /** 缺省时自建无状态读取实例（同一加密文件；生产注入与装配共享实例更优，测试注入假实现）。 */
  credentialService?: Pick<ICredentialService, "load">;
}

/** 规范化 baseURL：空白回落 undefined（由调用方决定回落官方默认或禁用）。 */
function normalizeBaseURL(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export async function resolveKnowledgeJevAssembly(
  options: ResolveKnowledgeJevAssemblyOptions,
): Promise<KnowledgeJevAssembly | null> {
  const settings = await options.settingService.get();
  if (settings.knowledgeJevEnabled !== true) {
    return null;
  }
  const credentialService = options.credentialService ?? createCredentialService();
  // chat-completions 协议族具名提供商（OpenRouter / Vercel AI Gateway）：各自规范端点，
  // Key + 模型名必填（fail-closed），端点覆盖可选（空 = 官方端点）。
  if (settings.knowledgeJevProvider === "openrouter") {
    const apiKey = (await credentialService.load(KNOWLEDGE_JEV_OPENROUTER_CREDENTIAL_KEY))?.trim();
    const model = normalizeBaseURL(settings.knowledgeJevOpenrouterModel);
    if (!apiKey || !model) return null;
    return {
      provider: "openrouter",
      apiKey,
      model,
      baseUrl: normalizeBaseURL(settings.knowledgeJevOpenrouterBaseUrl),
    };
  }
  if (settings.knowledgeJevProvider === "ai-gateway") {
    const apiKey = (await credentialService.load(KNOWLEDGE_JEV_AI_GATEWAY_CREDENTIAL_KEY))?.trim();
    const model = normalizeBaseURL(settings.knowledgeJevAiGatewayModel);
    if (!apiKey || !model) return null;
    return {
      provider: "ai-gateway",
      apiKey,
      model,
      baseUrl: normalizeBaseURL(settings.knowledgeJevAiGatewayBaseUrl),
    };
  }
  const apiKey = (await credentialService.load(KNOWLEDGE_JEV_CREDENTIAL_KEY))?.trim();
  if (!apiKey) {
    // fail-closed：开关开了但凭据缺失，与关闭同语义（K-JEV-8）。
    return null;
  }
  return { provider: "typesafe", apiKey, baseUrl: normalizeBaseURL(settings.knowledgeJevBaseUrl) };
}

/** 把装配快照闭包成 W05 decisionProviderFactory 契约（policy 预算全部来自管线同一 config）。 */
export function createKnowledgeJevProviderFactory(
  assembly: KnowledgeJevAssembly,
): (deps: {
  consentRegistry: DecisionConsentRegistry;
  config: KnowledgeDecisionPolicyConfig;
}) => KnowledgeDecisionProvider {
  return ({ consentRegistry, config }) => {
    const transport =
      assembly.provider === "typesafe"
        ? createTypeSafeHttpTransport({
            apiKey: assembly.apiKey,
            baseUrl: assembly.baseUrl,
          })
        : createChatCompletionsScoringTransport({
            provider: assembly.provider,
            apiKey: assembly.apiKey,
            model: assembly.model,
            baseUrl: assembly.baseUrl,
          });
    return createJevAdapter({
      transport,
      consentRegistry,
      perCallTimeoutMs: config.perCallTimeoutMs,
      stageBudgetMs: config.stageBudgetMs,
      concurrency: config.concurrency,
      rateLimitRetries: config.rateLimitRetries,
      rateLimitBackoffMs: config.rateLimitBackoffMs,
    });
  };
}
