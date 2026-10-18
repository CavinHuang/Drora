import type { TeamUiStatus } from "./contract.js";

/**
 * staged 草案 → 面板自动打开的边沿判定（PR-2.4c；设计
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §2 入口 3 / §3.1
 * 「TeamPanel 自动打开，进入 staged 审批态」）。
 *
 * 纯函数、脱离 React 可测。宿主（TeamStagedAutoOpenBridge）按会话持有 prevStatus 的
 * 上一帧观测值：
 * - 边沿 =「上一帧观测不是 staged、这一帧是 staged」。草案出现前的常态就是**没有** team 键
 *   （prev=undefined），所以 undefined → staged 正是主路径，必须触发；
 * - staged → staged 不触发（面板开着/草案原地刷新都不重复打扰）；
 * - 归档/放弃后再来新草案：status 经 staged → … → archived → staged，边沿重新成立——
 *   新草案需要新审批，这是期望行为；
 * - `panelOpen` 为 true 时永不触发（任务卡口径「仅当面板未开」；重复打开虽幂等聚焦，
 *   但自动抢聚焦用户主动打开着的东西不属于本语义）。
 *
 * **订阅晚到的诚实边界**：桥挂载晚于草案落地时（切进一份已 staged 的会话、或冷恢复），
 * 首帧观测 undefined → staged 同样成立、会开一次。staged 草案是会话里最需要用户裁决的
 * 事，自动聚焦符合设计 §3.1 意图；面板已开（panelOpen）时永远安静。
 *
 * next 为 undefined（无 team 投影：灰度关 / 旧 CLI / 归档出投影）恒不触发——灰度不靠
 * 显式开关，靠数据缺席自然关闭。
 */
export function shouldAutoOpenTeamPanel(
  prevStatus: TeamUiStatus | undefined,
  nextStatus: TeamUiStatus | undefined,
  panelOpen: boolean,
): boolean {
  if (panelOpen) return false;
  if (nextStatus === undefined) return false;
  return prevStatus !== "staged" && nextStatus === "staged";
}
