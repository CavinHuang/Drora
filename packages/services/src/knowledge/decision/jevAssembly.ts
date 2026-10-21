/**
 * Jev 装配配置解析（specs/obsidian-knowledge.md §5d.10）。
 *
 * createLocalServices 是同步函数，而开关/凭据读取是异步——预解析必须发生在
 * host 侧已有的异步初始化段，经快照 option 传回装配函数。本模块只提供：
 * 1. resolveKnowledgeJevAssembly：开关关 / 凭据缺失 / 该提供商必填项缺失一律返回
 *    null（fail-closed，装配层据此不注入 decisionProviderFactory，grant 走 disabled，
 *    零出站）；
 * 2. createKnowledgeJevProviderFactory：把快照闭包成 W05 约定的 provider 工厂
 *    （必须走工厂而非静态 provider——逐调用授权重查要求与管线共享同一账本实例）。
 *
 * 提供商维度（2026-10-11 收敛）：systemOne 是 Jev 全生态唯一线协议，三类提供商
 * 共用同一 transport，差异只在端点部署/凭据/模型别名——typesafe 用官方缺省端点
 * （可覆盖），openrouter / ai-gateway 的 baseURL 由发行方文档/部署方提供、必填
 * （不硬编码未证实公开规范 URL 的端点）。
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
  AI_GATEWAY_OFFICIAL_BASE_URL,
  OPENROUTER_OFFICIAL_BASE_URL,
  TYPESAFE_OFFICIAL_BASE_URL,
  createSystemOneHttpTransport,
} from "./jevTransport.js";

/** 装配期快照（按提供商判别）：开关开且该提供商必填项齐备时才产生。 */
export type KnowledgeJevAssembly =
  | { provider: "typesafe"; apiKey: string; baseUrl: string }
  | { provider: "openrouter"; apiKey: string; baseUrl: string; model: string }
  | { provider: "ai-gateway"; apiKey: string; baseUrl: string; model: string };

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
  // 远程具名提供商（OpenRouter / AI Gateway）：端点 baseURL 由发行方文档/部署方提供，
  // 与 Key、模型别名同为必填（fail-closed，缺任一即禁用）——不硬编码猜测端点。
  if (settings.knowledgeJevProvider === "openrouter") {
    const apiKey = (await credentialService.load(KNOWLEDGE_JEV_OPENROUTER_CREDENTIAL_KEY))?.trim();
    const model = normalizeBaseURL(settings.knowledgeJevOpenrouterModel);
    if (!apiKey || !model) return null;
    return {
      provider: "openrouter",
      apiKey,
      model,
      // 端点缺省回落内置（openrouter.ai 官方）；自有网关经设置覆盖。
      baseUrl:
        normalizeBaseURL(settings.knowledgeJevOpenrouterBaseUrl) ?? OPENROUTER_OFFICIAL_BASE_URL,
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
      // 端点缺省回落内置（Vercel AI Gateway，初值依据见 spec §5d.10 决策记录）；
      // 自有网关部署（Kong/TrueFoundry 等）经设置覆盖。
      baseUrl:
        normalizeBaseURL(settings.knowledgeJevAiGatewayBaseUrl) ?? AI_GATEWAY_OFFICIAL_BASE_URL,
    };
  }
  const apiKey = (await credentialService.load(KNOWLEDGE_JEV_CREDENTIAL_KEY))?.trim();
  if (!apiKey) {
    // fail-closed：开关开了但凭据缺失，与关闭同语义（K-JEV-8）。
    return null;
  }
  return {
    provider: "typesafe",
    apiKey,
    baseUrl: normalizeBaseURL(settings.knowledgeJevBaseUrl) ?? TYPESAFE_OFFICIAL_BASE_URL,
  };
}

/** 把装配快照闭包成 W05 decisionProviderFactory 契约（policy 预算全部来自管线同一 config）。 */
export function createKnowledgeJevProviderFactory(
  assembly: KnowledgeJevAssembly,
): (deps: {
  consentRegistry: DecisionConsentRegistry;
  config: KnowledgeDecisionPolicyConfig;
}) => KnowledgeDecisionProvider {
  return ({ consentRegistry, config }) => {
    const transport = createSystemOneHttpTransport({
      apiKey: assembly.apiKey,
      baseUrl: assembly.baseUrl,
      // typesafe 走 adapter 请求携带的官方别名（jev-latest）；远程提供商用其模型标识覆盖。
      ...(assembly.provider === "typesafe" ? {} : { model: assembly.model }),
      // openrouter 决策走独立路径（alpha/decisions）；其余提供商标准 systemOne 路径。
      ...(assembly.provider === "openrouter" ? { endpointPath: "/decisions" } : {}),
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
