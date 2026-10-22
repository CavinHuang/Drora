/**
 * 播报腿接线（specs/voice-agent-integration.md §9.3 / §3.4 / §3.5 / §4.1 / §4.6）。
 *
 * 职责：把 SessionPane 的既有事实源（会话行投影、pendingInteractions、focused、
 * handleStop 命令面）接到 TurnSpeechPlanner 上，不建第二事件流、不建第二状态源：
 * - 轮尾正文：focused pane 的 buildConversationTurnRenderUnits 投影 → 最新终态 turn 的
 *   assistantTextRows 聚合（buildTurnSpeechText，与复制文本同链 §4.1）→ consumeTurnTail；
 *   非 focused pane 全部门外（§4.1 永不播非 focused 内容，不播不排队）。
 * - 权限内容段：pendingInteractions 中 kind=permission 的标题+问题文本（§4.1 播级），
 *   200 字符截断 + 尾缀；只读 interaction 投影，播报前后零 interaction-registry 写入
 *   （§4.6 冻结：不引入 snooze 联动）。
 * - 腿互斥：订阅 voiceSessionStore 输入腿迁移 → planner.notifyUserRecordingStarted/Ended
 *   （§3.3 Recording 优先 / §4.7 句粒度暂停续播）。
 * - 单播报者 claim：BroadcastHub 通道适配（§3.5），TTL 5s + 每 2s release+acquire 续约；
 *   focused 切换离开 = notifyStopPressed（§3.4 停旧播报）。
 *
 * 挂载点：SessionPane（每 pane 一个实例；仅 focused pane 消费，双 pane 同时 focused 由
 * claim 仲裁，输者静默）。状态所有者仍是 voiceSessionStore（§3.1），本 hook 不持有
 * 播报腿状态。
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { IServiceAccessor } from "@drora/services";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import { isVoiceAnnouncementEnabled, resolveVoiceAnnouncementOutputConfig } from "@/lib/voiceAnnouncementPreferences.js";
import { useVoiceSessionStore, type VoiceAnnouncementPhase } from "@/store/voiceSessionStore.js";
import type { ConversationTurnRenderUnit } from "@/v4/conversationTurnRenderUnitTypes.js";
import {
  createVoiceSessionAnnouncementControl,
  buildTurnSpeechText,
  createTurnSpeechPlanner,
  type TurnSpeechPlanner,
} from "./turnSpeechPlanner.js";
import { createBroadcastAnnouncementClaimAdapter } from "./voiceAnnouncementClaim.js";
import { registerVoiceCommandHandler } from "./voiceCommandBus.js";
import { createSpeechSynthesisTtsAdapter } from "./speechSynthesisTtsAdapter.js";

/** 结构化最小权限 pending 源（与 drora-protocol-v4 pendingInteractionSchema 形状兼容；payload 为可辨识联合，读取前按 kind 判别）。 */
export interface VoiceAnnouncementPermissionSource {
  interactionId: string;
  payload: { kind: string };
}

/** §4.1：权限内容摘要超长截断阈值（字符）。 */
export const VOICE_ANNOUNCEMENT_PERMISSION_MAX_CHARS = 200;

export interface UseVoiceAnnouncementParams {
  /** 播报跟随 focused（§3.4）；非 focused pane 不消费任何播报源。 */
  focused: boolean;
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  /** 本 pane 的会话行投影（buildConversationTurnRenderUnits 产物）。 */
  units: readonly ConversationTurnRenderUnit[];
  /** pendingInteractions（只读；播报前后零 interaction-registry 写入，§4.6）。 */
  pendingInteractions?: readonly VoiceAnnouncementPermissionSource[];
  /**
   * 层③「停掉任务」/语音取消的分发入口：发既有 v4 stop（带 expectedForegroundExecutionId）。
   * SessionPane 传 handleStop 的懒引用，避免 hook/handler 循环依赖。
   */
  requestTaskStop: () => void;
}

export interface VoiceAnnouncementController {
  planner: TurnSpeechPlanner;
  /** 播报腿相位（指示器渲染用；单一事实源 voiceSessionStore）。 */
  indicatorPhase: VoiceAnnouncementPhase;
  /** 既有停止面（TID_V4_STOP/Esc）回调：播报同步静音，不重复发 stop。 */
  notifyExternalTaskStop: () => void;
}

/** 最新终态轮尾（§4.1：TurnComplete 终态后整段分句播；terminal = complete|interrupted）。 */
export function resolveFocusedAnnouncementTail(
  units: readonly ConversationTurnRenderUnit[],
): { turnId: string; text: string } | null {
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const unit = units[i];
    const latest = unit?.latestAssistantTextRow;
    if (!latest) {
      continue;
    }
    if (latest.state !== "complete" && latest.state !== "interrupted") {
      continue;
    }
    const text = buildTurnSpeechText(unit.assistantTextRows);
    if (text.trim().length === 0) {
      continue;
    }
    return { turnId: unit.turnId, text };
  }
  return null;
}

/** §4.1：权限播报文本 = 标题（toolName）+ 问题文本（summary），超长截断 + 尾缀。 */
export function buildPermissionAnnouncementText(
  payload: { kind: string; toolName?: string; summary?: string },
  truncatedSuffix: string,
): string {
  const summary = payload.summary?.trim() ?? "";
  const title = payload.toolName?.trim() ?? "";
  const composed = title.length > 0 && summary.length > 0 ? `${title}: ${summary}` : summary || title;
  if (composed.length <= VOICE_ANNOUNCEMENT_PERMISSION_MAX_CHARS) {
    return composed;
  }
  return `${composed.slice(0, VOICE_ANNOUNCEMENT_PERMISSION_MAX_CHARS)}${truncatedSuffix}`;
}

export function useVoiceAnnouncement({
  focused,
  sessionId,
  workspacePath,
  workspaceIdentity,
  units,
  pendingInteractions,
  requestTaskStop,
}: UseVoiceAnnouncementParams): VoiceAnnouncementController {
  const { intl, locale } = useDroraIntl();
  const services: IServiceAccessor = useServices();
  const { settings } = useSettings();
  const truncatedSuffix = intl.formatMessage({ id: "voice.ann.permission.truncated" });

  // focused pane 的最新终态轮尾投影（getFocusedTurnTail 的真值源；consumeTurnTail 输入）。
  const tailRef = useRef<{ turnId: string; text: string } | null>(null);
  const lastConsumedTurnRef = useRef<string | null>(null);
  const conversationKey = `${workspacePath}\0${workspaceIdentity ?? ""}\0${sessionId ?? ""}`;
  const lastConversationKeyRef = useRef(conversationKey);

  const claim = useMemo(
    () => createBroadcastAnnouncementClaimAdapter(services.broadcastService),
    [services.broadcastService],
  );
  const tts = useMemo(() => createSpeechSynthesisTtsAdapter(), []);

  // 设置读取经 reader 收口（§9.3）；ref 保证 planner deps 闭包拿最新值而不重建 planner。
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const requestTaskStopRef = useRef(requestTaskStop);
  requestTaskStopRef.current = requestTaskStop;
  const truncatedSuffixRef = useRef(truncatedSuffix);
  truncatedSuffixRef.current = truncatedSuffix;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const planner = useMemo(
    () =>
      createTurnSpeechPlanner({
        getFocusedTurnTail: () => {
          if (!focusedRef.current) {
            return null;
          }
          return tailRef.current;
        },
        tts,
        claim,
        isAnnouncementEnabled: () => isVoiceAnnouncementEnabled(settingsRef.current),
        announcementControl: createVoiceSessionAnnouncementControl(useVoiceSessionStore),
        getAnnouncementVoiceConfig: () => {
          const output = resolveVoiceAnnouncementOutputConfig(settingsRef.current);
          return { lang: localeRef.current, ...output };
        },
        cancelTask: () => requestTaskStopRef.current(),
      }),
    [claim, tts],
  );

  useEffect(() => {
    if (lastConversationKeyRef.current !== conversationKey) {
      // 会话/workspace 切换：轮尾去重键失效（新会话的最新轮尾允许重新消费）。
      lastConversationKeyRef.current = conversationKey;
      lastConsumedTurnRef.current = null;
    }
    const tail = focused ? resolveFocusedAnnouncementTail(units) : null;
    tailRef.current = tail;
    if (!focused || !tail || tail.turnId === lastConsumedTurnRef.current) {
      return;
    }
    lastConsumedTurnRef.current = tail.turnId;
    planner.consumeTurnTail(tail);
  }, [conversationKey, focused, planner, units]);

  // §3.4：切换 focused 离开本 pane → 停旧播报（立即 cancel 回 AnnIdle 并释放 claim）；
  // 新 focused pane 的就绪轮尾由上面的消费 effect 从 AnnIdle 起播。
  const wasFocusedRef = useRef(focused);
  useEffect(() => {
    if (wasFocusedRef.current && !focused) {
      planner.notifyStopPressed();
    }
    wasFocusedRef.current = focused;
  }, [focused, planner]);

  // §3.3 腿互斥接线：输入腿迁移 → planner（Recording 优先 / §4.7 句粒度暂停续播）。
  const inputLegRef = useRef(useVoiceSessionStore.getState().inputLeg);
  useEffect(() => {
    return useVoiceSessionStore.subscribe((state) => {
      const previous = inputLegRef.current;
      inputLegRef.current = state.inputLeg;
      if (state.inputLeg === previous) {
        return;
      }
      if (state.inputLeg === "recording") {
        planner.notifyUserRecordingStarted();
        return;
      }
      if (previous === "recording") {
        planner.notifyUserRecordingEnded();
      }
    });
  }, [planner]);

  // §4.3 三层打断接线：语音命令总线（听写侧打断词命中 dispatch）→ 本 planner。
  // 广播安全：stopAnnouncement 在 AnnIdle planner 上 no-op；cancelTask 由 planner 按
  // 播报腿活动态 gate（非活动实例不分发 v4 stop）。
  useEffect(() => {
    return registerVoiceCommandHandler((kind) => {
      if (kind === "stopAnnouncement") {
        planner.notifyInterruptWordHit();
        return;
      }
      planner.requestCancelTask();
    });
  }, [planner]);

  // §3.5-4 release 时机之「播报开关关闭」：播报进行中关闭总开关 → 停播回 AnnIdle
  //（立即 cancel + 释放 claim + 清队列），运行时行为与设置一致（§6.1 reader 收口意图）。
  const announcementEnabled = isVoiceAnnouncementEnabled(settings);
  const wasAnnouncementEnabledRef = useRef(announcementEnabled);
  useEffect(() => {
    if (wasAnnouncementEnabledRef.current && !announcementEnabled) {
      planner.notifyStopPressed();
    }
    wasAnnouncementEnabledRef.current = announcementEnabled;
  }, [announcementEnabled, planner]);

  // §4.1 权限内容段消费：只读 pending 投影，去重由 planner（permissionId）兜底；
  // payload 按可辨识联合的 kind 收窄后取权限摘要。
  useEffect(() => {
    if (!focused || !pendingInteractions) {
      return;
    }
    for (const interaction of pendingInteractions) {
      const payload = interaction.payload;
      if (payload.kind !== "permission") {
        continue;
      }
      const permissionPayload = payload as { kind: "permission"; toolName?: string; summary?: string };
      planner.consumePermissionSegment({
        permissionId: interaction.interactionId,
        text: buildPermissionAnnouncementText(permissionPayload, truncatedSuffixRef.current),
      });
    }
  }, [focused, pendingInteractions, planner]);

  useEffect(() => {
    return () => {
      planner.dispose();
    };
  }, [planner]);

  const notifyExternalTaskStop = useCallback(() => {
    planner.notifyExternalTaskStop();
  }, [planner]);

  return {
    planner,
    indicatorPhase: useVoiceSessionStore((state) => state.announcement.phase),
    notifyExternalTaskStop,
  };
}
