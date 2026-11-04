/**
 * ui-model-capabilities 对外契约：调用方要想正确调用就必须知道的一切都写在这里；
 * 其余对外不可见（五个条目表单的内部状态与行级部件不经此契约外泄）。
 *
 * 设计依据：specs/model-capabilities.md §4（状态所有者）/§5（UI 信息架构）。
 * 数据一律经 useModelCapabilities（hooks/，档案服务唯一读路径）；本模块不直读
 * settingService/credentialService 之外的持久层，凭据明文永不回流渲染状态。
 */
import type { ModelCapabilityPurpose } from "@drora/shared";

/** 「模型能力」导航分组 id（ModelProviderNavGroupId 第三分组；固定顺序不参与 dnd）。 */
export const MODEL_CAPABILITY_NAV_GROUP_ID = "capabilities";

/** 能力条目详情组件入参（Detail 分支按 purpose 分派到五个条目表单）。 */
export interface ModelCapabilityDetailProps {
  purpose: ModelCapabilityPurpose;
}
