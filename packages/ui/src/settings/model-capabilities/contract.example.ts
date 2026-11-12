/**
 * ui-model-capabilities 标准调用示例：agent 靠模仿写代码，这里放的就是该模仿的那份。
 */
import type { ModelCapabilityPurpose } from "@drora/shared";
import { MODEL_CAPABILITY_NAV_GROUP_ID, type ModelCapabilityDetailProps } from "./contract.js";

/** Detail 分支渲染示例：模型设置页选中 capability:* 节点时按 purpose 分派。 */
export function exampleRenderCapabilityDetail(props: ModelCapabilityDetailProps): void {
  void props;
}

/** 导航分组接入示例：第三分组 id（固定顺序、不参与 dnd，spec §5.1）。 */
export const exampleNavGroupId: string = MODEL_CAPABILITY_NAV_GROUP_ID;

/** 条目 purpose 词汇（顺序即呈现顺序；引用 shared 契约单一出处；P7 后三条目）。 */
export const examplePurposes: readonly ModelCapabilityPurpose[] = [
  "asr",
  "tts",
  "image-generation",
];
