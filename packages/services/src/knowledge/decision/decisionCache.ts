/**
 * 决策缓存（W05 / spec §5d.7）。
 *
 * 进程内 LRU 有界缓存，键 = sha256(providerId|model|policyVersion|vaultId|sourceEpoch|
 * queryHash|chunkSha)——model/policy/content 任一版本变化自动失效；换源（epoch/vault
 * 变化）与撤权（显式清除）同样失效。仅本机、不持久化，绝不落查询/片段全文。
 */
import { createHash } from "node:crypto";
import type { KnowledgeDecisionOutcome } from "./decisionTypes.js";

export interface DecisionCacheEntry {
  outcomes: KnowledgeDecisionOutcome[];
  modelVersion: string | null;
  createdAtMs: number;
  /** 撤权失效清理用：条目绑定的源与查询（键分量的冗余存档）。 */
  vaultId: string;
  sourceEpoch: number;
  queryHash: string;
}

export function decisionCacheKeyOf(parts: {
  providerId: string;
  modelId: string;
  policyVersion: string;
  vaultId: string;
  sourceEpoch: number;
  queryHash: string;
  chunkSha256: string;
}): string {
  const material = `${parts.providerId}|${parts.modelId}|${parts.policyVersion}|${parts.vaultId}|${parts.sourceEpoch}|${parts.queryHash}|${parts.chunkSha256}`;
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export class DecisionCache {
  private readonly entries = new Map<string, DecisionCacheEntry>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): DecisionCacheEntry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    // LRU：命中后移到末尾（Map 迭代序 = 插入序）。
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, entry: DecisionCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** 撤权/换源时按谓词清除（返回清除条数，供诊断）。Map 迭代容忍删除当前条目。 */
  invalidate(predicate: (key: string, entry: DecisionCacheEntry) => boolean): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (predicate(key, entry)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
