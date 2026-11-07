/**
 * ui-mate 对外契约（specs/drora-personal-assistant.md；
 * docs/mate-implementation-plan-2026-11-04/01-p1-detailed-design.md §5、00-master-plan.md §2 PR-1B）。
 *
 * 边界三句话（照 assistant-tickets CONTRACT.md 的填法，针对 UI 的等价表述）：
 * - 只消费 IAssistantTicketService 的快照投影：类型经 services index type-only 引用
 *   （01 §1.2，UI 信任推送不做二次运行时校验）；快照本体不复制进 zustand，杜绝第二业务状态。
 * - 动作全走 service 方法：store 动作以 service 为参数注入（ MateSidePane 不直写台账、
 *   不触碰 repo/sqlite，也不派生第二条写入路径）。
 * - 服务缺席（远程 workspace / 旧 Host 未注册 assistantTicketService）→ 判空降级，
 *   面板渲染不可用态，不伪造数据、不建本地缓存顶替。
 */
import type { MateFilter } from "./view-model.js";

/**
 * 面板次级视图页签（2026-11-07 布局重构）：对话=主视图（常驻，唯一事实呈现面），
 * 收件箱/台账/设置三视图经页签互斥切换（各占剩余空间、各自滚动——修复旧版九层
 * 纵向堆叠+三根滚动条的不可用布局）。缺省 "inbox"（待决策是最常查看的次级面）。
 */
export type MateSecondaryView = "conversation" | "inbox" | "inventory" | "settings";

/**
 * mateStore 持有的全部状态——快照不是其中之一（唯一事实在 service 的 onDidChange 推送）。
 * 除这五件 UI 局部态外，store 不保存任何 Mate 业务字段（无 error/operationId/快照副本，
 * 动作结果经 Promise 返回给调用方消费）。
 * 五件态按 workspace 分域存放（store.byWorkspace，键=tab.workspaceKey，即
 * workspaceIdentity?.trim() || workspacePath 的 AGENTS 身份键规则）——mate tab 每
 * workspace 一个且 side pane 对全部 tab 常挂载，单例会跨区串扰（PR-1B 二审发现 6）。
 */
export interface MateLocalUiState {
  filter: MateFilter;
  selectedTicketId: string | null;
  expandedDecisionId: number | null;
  /** P8b（09 详设 §1.7）：全域工作总览卡展开的 workspace 组键集（MateWorkOverview）。 */
  expandedWorkKeys: readonly string[];
  /** 布局重构（2026-11-07）：次级视图页签（收件箱/台账/设置互斥切换）。 */
  secondaryView: MateSecondaryView;
}
