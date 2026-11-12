// 迁自 packages/services/src/knowledge/decision/jevDynamicProvider.ts @ bf872a6c0（specs/obsidian-vault-phase2-true-extraction.md
// §1-C1/§1-C2、§10-P3：知识栈与 obsidian-vault 门面物理迁入插件包，本文件为迁入副本。
// 与 HEAD 的差异仅限：①本文件头注释；②services 内部件导入重指（descriptors/
// serviceLogger/paths → server/platform/ 同义副本，值等价；obsidian-vault 相对路径 →
// server/vault/；两者均为同深度镜像替换，模块内容零改动）；③若下方标注「P3/D8 改点」
// 则另含凭据缺省 fail-closed 收窄。双轨期（P3-P7）本体原件仍在 packages/services 原位
// 由旧 host 装配（P7 拆除），两实现共用数据库时写竞争由 DB 级 index_lease/fencing 仲裁
// （§3/§6-g8，原样随迁不进程内化）。
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
      const signature = assembly === null ? null : JSON.stringify({ ...assembly, apiKey: "***" });
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
