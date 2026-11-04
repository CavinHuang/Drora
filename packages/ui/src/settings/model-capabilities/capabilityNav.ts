/**
 * 「模型能力」导航分组的静态目录（specs/model-capabilities.md §5.1）。
 *
 * 五条目固定、顺序即呈现顺序（MODEL_CAPABILITY_PURPOSES 单一出处，shared 契约）；
 * 固定顺序、不参与 dnd 排序（spec §5.1）。本文件零 React 依赖，供
 * useModelProviderNavigation 构造第三分组（capabilities）消费。
 */
import { MODEL_CAPABILITY_PURPOSES, type ModelCapabilityPurpose } from "@drora/shared";

/** 能力条目导航节点 key 前缀（唯一；与 preset:/custom:/coding-plan: 命名空间互斥）。 */
export function createCapabilityNodeKey(purpose: ModelCapabilityPurpose): string {
  return `capability:${purpose}`;
}

/** 侧栏条目文案 i18n 键（静态清单模式，不做动态键拼接）。 */
export const MODEL_CAPABILITY_NAV_LABEL_IDS: Record<ModelCapabilityPurpose, string> = {
  "decision-jev": "settings.modelCapability.nav.decisionJev",
  embedding: "settings.modelCapability.nav.embedding",
  asr: "settings.modelCapability.nav.asr",
  tts: "settings.modelCapability.nav.tts",
  "image-generation": "settings.modelCapability.nav.imageGeneration",
};

/** 分组标题 i18n 键。 */
export const MODEL_CAPABILITY_GROUP_TITLE_ID = "settings.modelCapabilities.groupTitle";

/** 五条目固定顺序（引用 shared 契约枚举，UI 不另立顺序）。 */
export const MODEL_CAPABILITY_NAV_PURPOSES: readonly ModelCapabilityPurpose[] =
  MODEL_CAPABILITY_PURPOSES;
