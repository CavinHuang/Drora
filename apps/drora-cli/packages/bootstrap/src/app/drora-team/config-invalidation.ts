import { getInstalledTeamHub } from "./install.js";
import type { DroraProtocolAgentServerContext } from "../../drora-protocol/server-types.js";

/**
 * Agents Team 初始目录失效（specs/agents-team.md §11 PR-2.5b 接缝的消费端补拉）。
 *
 * 竞态事实（2026-10-19 埋点实证）：install 的初始 TeamStateChanged 广播发生在
 * createDroraApp 内部，而协议层的 `runtime.subscribeEvents`（→ onSessionEvent →
 * v4 网关 team_state_changed 重拉拦截）在 createDroraApp 返回、record 创建之后才挂——
 * live 链路必然错过该广播，启动窗口期首拉的「无 team」目录滞留网关缓存，/team 不进面板。
 *
 * 修复：record 创建、订阅挂好后由调用点补一发——hub 已装配（getInstalledTeamHub 命中）
 * 即直呼网关 `refreshWorkspaceConfig` 重拉 workspace 配置目录，publish 后新订阅者与
 * 在订者都拿到含 /team 的目录。事件本体仍由 install 广播入档（渲染层投影边沿消费），
 * 本 helper 只补协议层这一跳，不产生第二份状态。
 */
export function notifyAgentsTeamConfigInvalidated(
  context: DroraProtocolAgentServerContext,
  workspaceKey: string,
  appSessionId: string,
): void {
  if (getInstalledTeamHub(appSessionId) === undefined) return;
  void context.v4Gateway?.refreshWorkspaceConfig(workspaceKey).catch(() => undefined);
}
