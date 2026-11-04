import type { IDroraAgentService } from "@drora/services";
import type { SaveFileRequest, SaveFileResult } from "@drora/shared";
import {
  PERSONA_PREFERENCE_KEYS,
  type PersonaExportPayload,
  type PersonaPreferenceFacts,
  type PersonaPreferenceKey,
} from "@drora/shared";

/**
 * 交流默认（P1a）的类型与纯函数模型（specs/drora-persona-system.md §5/§8/§9/§10、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §1.2/§2/§7）。
 * 从 usePersonaPreferences 拆出满足 max-file-lines；状态机见 usePersonaPreferences.ts。
 * 事实（服务权威）与草稿（UI 局部）分立：CAS 分歧由 isPreferenceSlotDiverged 判定，
 * 自动提交暂停由 isSlotAutosavePaused（hook 内）按原始 revision 判定，不互相冒充。
 */

export type PersonaPreferencesService = Pick<
  IDroraAgentService,
  | "getPersonaOverview"
  | "listPreferences"
  | "setPersonalPolicy"
  | "savePreference"
  | "forgetPreference"
  | "allowLearningForKey"
  | "getPersonaLearningOverview"
  | "preparePersonaExport"
>;

/** 平台另存为端口（IPlatformService.saveFile，仅桌面实现；Web 缺席时导出如实降级）。 */
export type PersonaSaveFilePort = (payload: SaveFileRequest) => Promise<SaveFileResult>;

/** 导出文件名（spec §9：既有 IPlatformService.saveFile 负责保存；固定名便于识别）。 */
export const PERSONA_EXPORT_FILE_NAME = "drora-persona-export.json";

export const PREFERENCE_KEY_LIST = [
  PERSONA_PREFERENCE_KEYS.replyLanguage,
  PERSONA_PREFERENCE_KEYS.explanationDetail,
  PERSONA_PREFERENCE_KEYS.preferredAddress,
  PERSONA_PREFERENCE_KEYS.collaborationStyle,
] as const satisfies readonly PersonaPreferenceKey[];

export type PersonaPreferenceNotice =
  | { tone: "success"; kind: "saved" }
  | { tone: "success"; kind: "unchanged" }
  | { tone: "info"; kind: "forgotten" }
  | { tone: "info"; kind: "outcomeUnknown" }
  | { tone: "error"; kind: "conflict" }
  | { tone: "error"; kind: "uninitialized" }
  | { tone: "error"; kind: "code"; code: string }
  | { tone: "error"; kind: "rpc"; message: string };

/** 单键草稿：value 为编辑值；seed 值/revision 是草稿开始编辑时的基线（保存 CAS 预期）。 */
export interface PersonaPreferenceDraft {
  value: string;
  seedValue: string;
  seedRevision: number;
}

export interface PersonaPreferenceSlot {
  /** 服务权威值（listPreferences）；null = 该键槽缺席（未设置或已忘记）。 */
  saved: PersonaPreferenceFacts | null;
  draft: PersonaPreferenceDraft | null;
  notice: PersonaPreferenceNotice | null;
  pending: boolean;
  forgetPending: boolean;
  /** 解除抑制（allowLearningForKey）在途；与保存/忘记互斥（同一槽的串行编辑）。 */
  allowPending: boolean;
  /** 「保留草稿」后已承认的服务 revision；revision 再前进才重新提示分歧。 */
  acknowledgedRevision: number | null;
}

/** U/L 两个策略开关共享同一 policy 行（同一 CAS/mutation 域），switch 区分展示归属。 */
export type PersonaPolicySwitch = "usePreferences" | "autoLearn";

export interface PersonaPolicyState {
  /**
   * 本会话最近一次确定性策略操作结果（含开关归属）。当前值以 learningOverview.policy 为准
   * （getPersonaLearningOverview 读路径）；本字段只陈述「本会话提交过什么」。
   */
  lastOperation: {
    switch: PersonaPolicySwitch;
    value: boolean;
    kind: "saved" | "unchanged";
  } | null;
  notice: PersonaPreferenceNotice | null;
  pending: boolean;
  /** 在途操作的目标：哪个开关正在提交什么值；null=空闲。 */
  pendingTarget: { switch: PersonaPolicySwitch; value: boolean } | null;
}

export type PersonaExportNotice =
  | { tone: "success"; kind: "saved"; path: string | null }
  | { tone: "info"; kind: "canceled" }
  | { tone: "info"; kind: "noData" }
  | { tone: "error"; kind: "unsupported" }
  | { tone: "error"; kind: "failed"; message: string }
  | { tone: "error"; kind: "code"; code: string }
  | { tone: "error"; kind: "rpc"; message: string };

export function createEmptySlots(): Record<PersonaPreferenceKey, PersonaPreferenceSlot> {
  const slots = {} as Record<PersonaPreferenceKey, PersonaPreferenceSlot>;
  for (const key of PREFERENCE_KEY_LIST) {
    slots[key] = {
      saved: null,
      draft: null,
      notice: null,
      pending: false,
      forgetPending: false,
      allowPending: false,
      acknowledgedRevision: null,
    };
  }
  return slots;
}

/** 草稿是否有待保存的实际改动（改回基线值视为未改动）。 */
export function isPreferenceSlotDirty(slot: PersonaPreferenceSlot): boolean {
  return slot.draft !== null && slot.draft.value !== slot.draft.seedValue;
}

/**
 * CAS 分歧：草稿基线 revision 与服务当前 revision 不一致（含基线值已被忘记/其他窗口
 * 修改），且未对当前 revision 做过「保留草稿」承认。展示层据此给出「已保存 vs 草稿」比较。
 */
export function isPreferenceSlotDiverged(slot: PersonaPreferenceSlot): boolean {
  if (!slot.draft) return false;
  const savedRevision = slot.saved?.revision ?? 0;
  return savedRevision !== slot.draft.seedRevision && savedRevision !== slot.acknowledgedRevision;
}

/** 2 空格缩进 JSON 的 UTF-8 字节（合同 §7 冻结快照；不经此函数之外的地方序列化）。 */
export function encodeExportPayload(payload: PersonaExportPayload): ArrayBuffer {
  const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
