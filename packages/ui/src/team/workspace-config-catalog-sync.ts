import { useEffect } from "react";
import type { IDroraAgentService } from "@drora/services";
import {
  TopicWireFrameAssembler,
  workspaceConfigTopic,
  workspaceConfigTopicFrameSchema,
  type WorkspaceConfigState,
  type WorkspaceConfigTopicFrame,
  type WorkspaceConfigTopicWireCandidate,
} from "@drora/shared/drora-protocol-v4";
import { logger } from "@/logger.js";
import { useServices } from "@/hooks/useServices.js";
import { useDroraSessionStore } from "@/store/droraSessionStore.js";
import { ensureAgentV4ConnectionHandshake } from "@/v4/agentV4ConnectionHandshake.js";

type ConfigCatalogAgentService = Pick<
  IDroraAgentService,
  | "subscribeWorkspaceConfigV4"
  | "unsubscribeWorkspaceConfigV4"
  | "onDynamicWorkspaceConfigFrame"
  | "onAgentRuntimeRestarted"
> &
  Partial<
    Pick<
      IDroraAgentService,
      "helloConversationV4" | "initializeConversationV4" | "onAgentRuntimeLifecycle"
    >
  >;

/**
 * workspace-config v4 主题的渲染层订阅（specs/agents-team.md 实现登记 2026-10-19）。
 *
 * 为什么需要订阅而不是一次性拉取（两轮实例埋点实证的时序环）：渲染进程启动窗口期的
 * 首拉目录发生在会话装配完成之前（hub 未装，目录无 /team），且 store 目录水合守卫
 * 「非空即跳」永不自愈；服务端装配完成后的补拉只进 v4 workspace-config publisher——
 * **无人订阅就没人收到**。本 hook 是该 publisher 的渲染层消费者：订阅
 * `workspace-config/<workspaceKey>`，把每帧（snapshot 与 config.updated delta 均为
 * 全量替换态）的 configOptions/slashCommands 回写 droraSessionStore。此后 Agents
 * Team 装配、灰度变更等任何目录失效都经服务端推帧自然收敛，渲染层零轮询零定时器。
 *
 * 挂载点纪律：挂在工作区常驻的会话面板（SessionPane）——draft 态也订阅，装配完成
 * 的推帧在无会话界面同样可达。
 *
 * 简化边界（v1）：不做 same-sub resync/恢复升级（task-index syncer 的全套机制）——
 * 物理组装故障时退化为「退订→重订」（新订阅的服务端种子即权威全量）；CLI 进程换代
 * （onAgentRuntimeRestarted）按代际重建订阅。
 */
export function useWorkspaceConfigCatalogSync(input: {
  workspacePath: string;
  workspaceIdentity?: string;
}): void {
  const { workspacePath, workspaceIdentity } = input;
  const { droraAgentService } = useServices() as {
    droraAgentService: ConfigCatalogAgentService;
  };
  useEffect(() => {
    // 服务面渐进容错：旧宿主/单测的 services 可不含 droraAgentService 的
    // workspace-config 转发面——缺席即不订阅（目录退回一次性首拉语义，行为同前）。
    if (
      typeof droraAgentService?.subscribeWorkspaceConfigV4 !== "function" ||
      typeof droraAgentService?.unsubscribeWorkspaceConfigV4 !== "function" ||
      typeof droraAgentService?.onDynamicWorkspaceConfigFrame !== "function" ||
      typeof droraAgentService?.onAgentRuntimeRestarted !== "function"
    ) {
      return;
    }
    let disposed = false;
    let generation = 0;
    let frameUpstream: { dispose(): void } | null = null;
    let restartUpstream: { dispose(): void } | null = null;
    const workspaceKey = workspaceIdentity?.trim() || workspacePath;
    const topic = workspaceConfigTopic(workspaceKey);
    const workspace = {
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
    };
    const applyConfig = (config: WorkspaceConfigState): void => {
      const latest = useDroraSessionStore.getState();
      latest.setConfigOptions(workspacePath, config.configOptions, workspaceIdentity);
      latest.setSlashCommands(workspacePath, config.slashCommands, workspaceIdentity);
    };
    // ACK 前到达的 initial frame 先缓冲，bind 后按序回放（与 sessions-index transport 同规）。
    let boundSubscriptionId: string | null = null;
    const preAckBuffer: WorkspaceConfigTopicWireCandidate[] = [];
    const assembler = new TopicWireFrameAssembler(workspaceConfigTopicFrameSchema);
    const deliver = (frame: WorkspaceConfigTopicFrame): void => {
      if (frame.payload.kind === "snapshot") {
        applyConfig(frame.payload.snapshot.config);
        return;
      }
      for (const delta of frame.payload.deltas) {
        applyConfig(delta.config);
      }
    };
    const acceptWire = (wire: WorkspaceConfigTopicWireCandidate): void => {
      if (wire.topic !== topic || wire.subscriptionId !== boundSubscriptionId) return;
      for (const event of assembler.accept(wire)) {
        if (event.kind === "complete") deliver(event.frame);
        if (event.kind === "fault") {
          // 物理组装故障：退订重订——新订阅的服务端种子即权威全量（v1 简化边界）。
          logger.warn("[team-catalog] workspace-config assembly fault; resubscribing", {
            event: "team.catalog.assembly_fault",
            reasonCode: event.fault.reasonCode,
            workspaceKey,
          });
          void restartSubscription();
        }
      }
    };
    const unsubscribe = async (subscriptionId: string): Promise<void> => {
      try {
        await droraAgentService.unsubscribeWorkspaceConfigV4({
          ...workspace,
          subscriptionId,
          runtimePolicy: "existing-only",
        });
      } catch {
        // 退订失败不阻断重建；旧订阅随 CLI 连接生命周期回收。
      }
    };
    const restartSubscription = async (): Promise<void> => {
      const staleSubscriptionId = boundSubscriptionId;
      boundSubscriptionId = null;
      if (staleSubscriptionId !== null) void unsubscribe(staleSubscriptionId);
      await start(generation);
    };
    // v4 连接握手先于订阅（fault.connection.handshakeRequired；与 sessions-index
    // transport 的 ensureHandshake 同规）。旧 service proxy 缺握手面时按原错误上抛。
    const ensureHandshake = (): Promise<void> => {
      if (!droraAgentService.helloConversationV4 || !droraAgentService.initializeConversationV4) {
        return Promise.reject(new Error("fault.connection.handshakeUnavailable"));
      }
      return ensureAgentV4ConnectionHandshake(
        droraAgentService as Pick<
          IDroraAgentService,
          "helloConversationV4" | "initializeConversationV4"
        >,
      ).then(() => undefined);
    };
    const start = async (myGeneration: number): Promise<void> => {
      try {
        await ensureHandshake();
        const result = await droraAgentService.subscribeWorkspaceConfigV4({
          ...workspace,
          runtimePolicy: "existing-only",
        });
        if (disposed || myGeneration !== generation) {
          void unsubscribe(result.ack.subscriptionId);
          return;
        }
        boundSubscriptionId = result.ack.subscriptionId;
        for (const wire of preAckBuffer.splice(0)) acceptWire(wire);
      } catch (error) {
        if (!disposed && myGeneration === generation) {
          logger.warn("[team-catalog] workspace-config subscribe failed", {
            event: "team.catalog.subscribe_failed",
            workspaceKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };
    frameUpstream = droraAgentService.onDynamicWorkspaceConfigFrame(workspace)((wire) => {
      if (boundSubscriptionId === null) {
        preAckBuffer.push(wire);
        if (preAckBuffer.length > 16) preAckBuffer.shift();
        return;
      }
      acceptWire(wire);
    });
    restartUpstream = droraAgentService.onAgentRuntimeRestarted((event) => {
      if (event.workspaceKey !== workspaceKey) return;
      generation += 1;
      boundSubscriptionId = null;
      void start(generation);
    });
    void start(generation);
    return () => {
      disposed = true;
      generation += 1;
      const subscriptionId = boundSubscriptionId;
      boundSubscriptionId = null;
      frameUpstream?.dispose();
      frameUpstream = null;
      restartUpstream?.dispose();
      restartUpstream = null;
      if (subscriptionId !== null) void unsubscribe(subscriptionId);
    };
  }, [droraAgentService, workspacePath, workspaceIdentity]);
}
