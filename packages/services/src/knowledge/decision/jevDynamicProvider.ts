/**
 * Jev 配置动态 provider 控制器（spec §5d.10 配置热生效；从 knowledgeServices 拆出
 * 收口 max-lines 门禁）。
 *
 * 每决策 stage 解析当前装配（开关/提供商/Key/端点/模型），配置签名变更清决策缓存
 * （缓存键不含端点/凭据，旧配置评分不可复用）；refresh() 置空签名强制下一轮重解析
 * （UI 写配置后的确定性即时生效路径）。装配 null = 本轮按功能关闭处理。
 */
import type { DecisionConsentRegistry } from "./decisionConsent.js";
import type { DecisionCache } from "./decisionCache.js";
import type { KnowledgeDecisionPolicyConfig, KnowledgeDecisionProvider } from "./decisionTypes.js";
import type { KnowledgeJevAssembly } from "./jevAssembly.js";
import { createKnowledgeJevProviderFactory } from "./jevAssembly.js";

export interface JevDynamicProvider {
  /** 管线 providerSource：每 stage 解析当前装配（null = 本轮功能关闭）。 */
  providerSource(): Promise<KnowledgeDecisionProvider | null>;
  /** UI 写配置后的确定性即时生效：置空签名，下一轮强制重解析。 */
  refresh(): void;
}

export function createJevDynamicProvider(deps: {
  source: () => Promise<KnowledgeJevAssembly | null>;
  consentRegistry: DecisionConsentRegistry;
  config: KnowledgeDecisionPolicyConfig;
  cache: DecisionCache;
}): JevDynamicProvider {
  let lastSignature: string | null = null;

  return {
    async providerSource(): Promise<KnowledgeDecisionProvider | null> {
      const assembly = (await deps.source()) ?? null;
      // 签名脱敏：Key 不进签名/日志（安全不变式）。
      const signature =
        assembly === null ? null : JSON.stringify({ ...assembly, apiKey: "***" });
      if (signature !== lastSignature) {
        deps.cache.clear();
        lastSignature = signature;
      }
      if (assembly === null) return null;
      return createKnowledgeJevProviderFactory(assembly)({
        consentRegistry: deps.consentRegistry,
        config: deps.config,
      });
    },
    refresh(): void {
      lastSignature = null;
    },
  };
}
