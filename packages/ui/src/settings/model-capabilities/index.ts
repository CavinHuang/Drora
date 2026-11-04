/**
 * ui-model-capabilities 公共入口（architecture-governance managed 模块）。
 *
 * 对外面仅两处：Detail 分支渲染入口与导航静态目录；五个条目表单与行级部件
 * 是模块内部实现。跨模块消费必须经本入口（含 contract.ts 声明的类型）。
 */
export { ModelCapabilityDetail } from "./ModelCapabilityDetail.js";
export {
  MODEL_CAPABILITY_GROUP_TITLE_ID,
  MODEL_CAPABILITY_NAV_LABEL_IDS,
  MODEL_CAPABILITY_NAV_PURPOSES,
  createCapabilityNodeKey,
} from "./capabilityNav.js";
export { MODEL_CAPABILITY_NAV_GROUP_ID } from "./contract.js";
export type { ModelCapabilityDetailProps } from "./contract.js";
