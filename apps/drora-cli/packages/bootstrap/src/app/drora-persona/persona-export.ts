/**
 * 导出的组合（合同 §7 冻结快照 + 「仅复验 inferred 来源」时序）。从 persona-app-service
 * 拆出满足 max-file-lines（同批 6「persona-rows 拆分」、批 7「学习运行时拆出」先例）；
 * 编排（runManaged 错误通道）与存储/owner 访问仍属服务类——全部经注入端口，本文件零
 * 直接 IO。
 */
import type { Logger } from "@drora/contracts";
import {
  PERSONA_ERROR_CODES,
  PERSONA_EXPORT_FORMAT,
  PERSONA_EXPORT_FORMAT_VERSION,
  PERSONA_EXPORT_LIMITATIONS,
  PERSONA_EXPORT_MAX_BYTES,
  type PersonaExportPayload,
  type PersonaManagementResult,
  type PersonaPreferenceFacts,
} from "@drora/shared";
import { getProductPersonaTemplate } from "./product-template.js";
import type { PersonaStorePort } from "@drora/adapters/storage/persona";
import {
  decodePersonaLearningMessageBoundary,
  type PersonaLearningSourceOwnerPort,
} from "./learning-contract.js";

/**
 * 从 store 导出快照组合只读 JSON payload（合同 §7）：单事务冻结事实，不含 authorityId、
 * 来源定位、聊天原文、历史值、候选、抑制内部记录、令牌与授权；总 UTF-8 bytes 超限报
 * validation_failed，不交付截断 JSON。
 *
 * inferred（extraction）槽在快照外复验来源（合同 §7「inferred 源不可验证则省略，显式值
 * 不因聊天删除消失」）：任一合并来源验证成功即导出；全部失败、owner 缺席或来源联读失败
 * ＝不可验证，整键省略并计入 omittedCounts.inferredOmittedUnverifiable——计数反映复验
 * 结果，不把「未尝试验证」计为「不可验证」。判定与 capture 读取侧一致（spec §8）。
 */
export async function prepareExportPayload(deps: {
  readonly store: PersonaStorePort;
  readonly now: () => number;
  readonly sourceOwner?: PersonaLearningSourceOwnerPort;
  readonly logger?: Logger;
}): Promise<PersonaManagementResult<PersonaExportPayload>> {
  const snapshotResult = await deps.store.readExportSnapshot();
  if (!snapshotResult.ok) return snapshotResult;
  const snapshot = snapshotResult.value;
  const explicit = snapshot.preferences.filter(
    (preference) => preference.provenanceKind === "settings",
  );
  const inferred = snapshot.preferences.filter(
    (preference) => preference.provenanceKind !== "settings",
  );
  const verifiedInferred = await verifyExportInferredSlots(inferred, deps);
  const omittedUnverifiable = inferred.length - verifiedInferred.length;
  if (omittedUnverifiable > 0) {
    deps.logger?.info("persona export omitted unverifiable inferred preferences", {
      count: omittedUnverifiable,
      event: "persona.export.inferred_unverified",
      module: "drora-persona",
    });
  }
  const template = getProductPersonaTemplate();
  const payload: PersonaExportPayload = {
    format: PERSONA_EXPORT_FORMAT,
    formatVersion: PERSONA_EXPORT_FORMAT_VERSION,
    capturedAt: new Date(deps.now()).toISOString(),
    coreRevision: snapshot.core.coreRevision,
    policyRevision: snapshot.policy.policyRevision,
    core: snapshot.core.core,
    templateVersion: template.templateVersion,
    compilerVersion: template.compilerVersion,
    preferences: [...explicit, ...verifiedInferred].map((preference) => ({
      key: preference.key,
      value: preference.value,
      revision: preference.revision,
      provenanceKind: preference.provenanceKind,
      epistemicStatus: preference.epistemicStatus,
    })),
    omittedCounts: { inferredOmittedUnverifiable: omittedUnverifiable },
    limitations: PERSONA_EXPORT_LIMITATIONS,
  };
  const bytes = Buffer.byteLength(JSON.stringify(payload, null, 2), "utf8");
  if (bytes > PERSONA_EXPORT_MAX_BYTES) {
    // 超限报 validation_failed，不交付截断 JSON（合同 §7）。
    return { ok: false, code: PERSONA_ERROR_CODES.validationFailed };
  }
  return { ok: true, value: payload };
}

/**
 * 导出侧 inferred 来源复验：owner 端口逐一验证合并来源（存在/有效分支/域/revision）；
 * 任一来源验证成功即保留该键，全部失败或 owner 缺席＝不可验证，整键省略（由调用方
 * 计数）。owner 查询失败按不可验证降级（扩展省略），不抛出、不影响显式域。
 */
async function verifyExportInferredSlots(
  inferred: readonly PersonaPreferenceFacts[],
  deps: {
    readonly store: PersonaStorePort;
    readonly sourceOwner?: PersonaLearningSourceOwnerPort;
  },
): Promise<readonly PersonaPreferenceFacts[]> {
  if (inferred.length === 0) return [];
  const owner = deps.sourceOwner;
  if (!owner) return [];
  const bindings = await deps.store.learning.readInferredSlotSources();
  if (!bindings.ok) return [];
  const sourcesByKey = new Map<string, typeof bindings.value>();
  for (const binding of bindings.value) {
    const existing = sourcesByKey.get(binding.key) ?? [];
    sourcesByKey.set(binding.key, [...existing, binding]);
  }
  const kept: PersonaPreferenceFacts[] = [];
  for (const slot of inferred) {
    let verified = false;
    for (const source of sourcesByKey.get(slot.key) ?? []) {
      const boundary = decodePersonaLearningMessageBoundary(source.messageBoundary);
      if (!boundary) continue;
      const outcome = await owner
        .verifyLearningSource({
          boundary,
          expectedSourceRevision: source.sourceRevision,
          sessionId: source.sessionId,
          workspaceKey: source.workspaceKey,
        })
        .catch(() => undefined);
      if (outcome?.status === "verified") {
        verified = true;
        break;
      }
    }
    if (verified) kept.push(slot);
  }
  return kept;
}
