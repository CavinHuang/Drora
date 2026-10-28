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
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { IServiceAccessor } from "@drora/services";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useDroraIntl } from "@/i18n/IntlProvider.js";
import {
  isVoiceAnnouncementEnabled,
  resolveVoiceAnnouncementLangFromSettings,
  resolveVoiceAnnouncementOutputConfig,
} from "@/lib/voiceAnnouncementPreferences.js";
import { useVoiceSessionStore, type VoiceAnnouncementPhase } from "@/store/voiceSessionStore.js";
import type { ConversationTurnRenderUnit } from "@/v4/conversationTurnRenderUnitTypes.js";
import {
  createVoiceSessionAnnouncementControl,
  buildTurnSpeechText,
  createTurnSpeechPlanner,
  type TurnSpeechPlanner,
} from "./turnSpeechPlanner.js";
import { createBroadcastAnnouncementClaimAdapter } from "./voiceAnnouncementClaim.js";
import { dispatchVoiceCommand, registerVoiceCommandHandler } from "./voiceCommandBus.js";
import { createSpeechSynthesisTtsAdapter } from "./speechSynthesisTtsAdapter.js";
import { createCloudTtsAdapter, resolveTtsEngineChoice } from "./cloudTtsAdapter.js";
import { isVoiceVendorConfigComplete } from "./resolveAsrAdapter.js";
import { createToolBriefPlanner } from "./toolBriefPlanner.js";
import { VOICE_TTS_CLOUD_CONSECUTIVE_FAILURES } from "./voiceTuning.js";
import { VOICE_VENDOR_CREDENTIAL_KEY } from "@drora/shared";
import type { VoiceTtsPort, VoiceTtsUtterance } from "./voiceTtsPort.js";
import { logger } from "@/logger.js";

/** 结构化最小权限 pending 源（与 drora-protocol-v4 pendingInteractionSchema 形状兼容；wiring 参数形状导出）。@lintignore */
export interface VoiceAnnouncementPermissionSource {
  interactionId: string;
  payload: { kind: string };
}

/** §4.1：权限内容摘要超长截断阈值（字符）。 */
export const VOICE_ANNOUNCEMENT_PERMISSION_MAX_CHARS = 200;

/** hook 参数形状（SessionPane 接线用）。@lintignore */
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
  /**
   * §9.9.3-M11：手机 Web 远控壳（compactForRemoteControl）门控——对齐 mic 入口的
   * §8.2/§8.3 冻结（远控 replayable 播报 = 手动触发的本地 TTS；自动播报腿属
   * desktop-continuous 语义，§9.8.3「远控壳仍隐藏入口」）。hook 保持整挂载
   * （hook 顺序稳定），planner/claim/TTS 实例照常创建但全部消费 effect 以
   * focused && !isWebRemoteControl 为门：零消费零出声。
   */
  isWebRemoteControl?: boolean;
}

/** hook 返回控制器形状（SessionPane 消费）。@lintignore */
export interface VoiceAnnouncementController {
  planner: TurnSpeechPlanner;
  /** 播报腿相位（指示器渲染用；单一事实源 voiceSessionStore）。 */
  indicatorPhase: VoiceAnnouncementPhase;
  /** 既有停止面（TID_V4_STOP/Esc）回调：播报同步静音，不重复发 stop。 */
  notifyExternalTaskStop: () => void;
}

/** 最新终态轮尾（§4.1：TurnComplete 终态后整段分句播；terminal = complete）。 */
export function resolveFocusedAnnouncementTail(
  units: readonly ConversationTurnRenderUnit[],
): { turnId: string; text: string } | null {
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const unit = units[i];
    const latest = unit?.latestAssistantTextRow;
    if (!latest) {
      continue;
    }
    // §9.9.2-H6：interrupted 移出可播终态——§4.1 白名单「轮尾正文……TurnComplete 终态后
    // 整段分句播」与 §3.2「轮尾终态就绪（TurnComplete）」从未包含 interrupted（停止
    // 生成打断的半截正文，rows state 四值之一）；原判定把它当可播终态是实现对冻结的
    // 偏离，整段播报半截正文。收窄为 complete 单值对齐冻结；「按半截正文截断策略播报」
    // 备选属 §4.1 白名单闭集新增，已按闭集原则否决（重开条件 = 产品明确要求播报被打断
    // 轮次），本批不做。
    if (latest.state !== "complete") {
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
  const composed =
    title.length > 0 && summary.length > 0 ? `${title}: ${summary}` : summary || title;
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
  isWebRemoteControl = false,
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
  const synthTts = useMemo(() => createSpeechSynthesisTtsAdapter(), []);
  // §9.6.2：厂商档三元组的 apiKey 经凭据服务读取（不上 appSettings/wire）。
  const getVendorApiKey = useCallback(
    () =>
      services.credentialService?.load(VOICE_VENDOR_CREDENTIAL_KEY).catch(() => null) ??
      Promise.resolve(null),
    [services.credentialService],
  );
  const cloudTts = useMemo(
    () =>
      createCloudTtsAdapter({
        getVendorConfig: async () => {
          const current = settingsRef.current;
          const baseUrl = current?.voiceVendorBaseUrl?.trim() ?? "";
          const model = current?.voiceTtsVendorModel?.trim() ?? "";
          if (baseUrl.length === 0 || model.length === 0) {
            return null;
          }
          const apiKey = (await getVendorApiKey().catch(() => null))?.trim() ?? "";
          if (apiKey.length === 0) {
            return null;
          }
          return { baseUrl, model, apiKey };
        },
        consecutiveFailuresThreshold: VOICE_TTS_CLOUD_CONSECUTIVE_FAILURES,
      }),
    [getVendorApiKey],
  );

  // 设置读取经 reader 收口（§9.3）；ref 保证 planner deps 闭包拿最新值而不重建 planner。
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // §9.6.5-2 引擎解析（routing TTS）：解析点 = renderer 装配（本 useMemo）/设置变更
  //（下方 effect）/AnnIdle→Speaking 进入（speak 路由以最新解析结果执行）。回落：
  // §9.6.5-3 连续失败 → cloudTts.onConsecutiveFailures（下方订阅）置 cloudFallbackRef →
  // 后续 speak 回落 speechSynthesis + warn；planner.notifyStopPressed 中止本轮
  //（层①语义复用：cancel+release+清队列、零协议）。播报腿/claim/打断语义零变化
  //（只换合成源）。cancel() 双停双引擎：防止设置切换/回落瞬间在途 cloud 音频与
  // 新引擎句叠音（幽灵声，评审 #2）。
  const cloudFallbackRef = useRef(false);
  const lastTtsEngineLoggedRef = useRef<string | null>(null);
  const resolveTtsEngineNow = useCallback((): VoiceTtsPort => {
    if (cloudFallbackRef.current) {
      return synthTts;
    }
    const current = settingsRef.current;
    // §9.9.3-M10 凭据三态：null=未加载（含已加载确认缺失）、非空=已加载且有效。
    // 消除旧实现的 `apiKey: cloudApiKeyRef.current ?? "unknown"` 占位——占位串让
    // isVoiceVendorConfigComplete 把「未加载」伪装成「已加载非空」→ cloud 被乐观
    // 选择 → cloudTtsAdapter.getVendorConfig 真读凭据返回 null → 单句失败 → 连续
    // 3 句触发会话内静默回落 system（启动期凭据竞态可造成整会话降级，UI 零反馈）。
    // 现统一以凭据真实状态判定：未加载/空串均判档不完整 → 本次解析 system，
    // 凭据加载完成后（credentialBump 解析点）下一句起按最新状态重析。
    const apiKey = cloudApiKeyRef.current;
    const credentialReady = apiKey != null && apiKey.trim().length > 0;
    const choice = resolveTtsEngineChoice({
      engine: current?.voiceTtsEngine ?? "system",
      vendorConfigComplete: isVoiceVendorConfigComplete({
        baseUrl: current?.voiceVendorBaseUrl,
        model: current?.voiceTtsVendorModel,
        apiKey: credentialReady ? apiKey : "",
      }),
    });
    // §7.1：引擎解析结果落 voice.tts info 槽位（引擎变化时记录一次）。
    if (lastTtsEngineLoggedRef.current !== choice) {
      lastTtsEngineLoggedRef.current = choice;
      // §9.9.3-M10：cloud 被选但因凭据未加载回落 system 时标注 credential pending
      //（一次性日志形态；空串=确认缺失不标 pending——非等待态）。
      const credentialPending =
        choice === "system" &&
        (current?.voiceTtsEngine ?? "system") === "cloud" &&
        apiKey == null;
      logger.info("voice.tts", `tts engine resolved: ${choice}${credentialPending ? " (credential pending)" : ""}`);
    }
    return choice === "cloud" ? cloudTts : synthTts;
  }, [cloudTts, synthTts]);
  const tts = useMemo<VoiceTtsPort>(
    () => ({
      speak: (u: VoiceTtsUtterance) => resolveTtsEngineNow().speak(u),
      cancel: () => {
        // 双停双引擎：引擎切换/回落瞬间在途音频一并静音（幽灵声防护）。
        cloudTts.cancel();
        synthTts.cancel();
      },
      onDone: (cb) => {
        const unsubCloud = cloudTts.onDone(cb);
        const unsubSynth = synthTts.onDone(cb);
        return () => {
          unsubCloud();
          unsubSynth();
        };
      },
    }),
    [cloudTts, synthTts, resolveTtsEngineNow],
  );

  // 设置读取经 reader 收口（§9.3）；ref 保证 planner deps 闭包拿最新值而不重建 planner。
  // §9.6.2：apiKey 经凭据服务异步读取后缓存（routing 选型的同步判定输入；
  // cloud 合成管线内仍会以最新凭据再读一次）。挂载与设置变更时刷新。
  // §9.9.3-M10：加载完成 = 新解析点（§9.6.5-2 清单 additive 增补，§9.9.5-6）——
  // credentialBump 计数驱动重渲染，下一句 speak 按最新凭据状态解析（逐句路由本就
  // 以最新解析结果执行，非新增时序面）。
  const cloudApiKeyRef = useRef<string | null>(null);
  const [, bumpCredentialVersion] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    let cancelled = false;
    void getVendorApiKey()
      .then((key) => {
        if (!cancelled) {
          cloudApiKeyRef.current = key ?? null;
          bumpCredentialVersion();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [getVendorApiKey]);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const requestTaskStopRef = useRef(requestTaskStop);
  requestTaskStopRef.current = requestTaskStop;
  const truncatedSuffixRef = useRef(truncatedSuffix);
  truncatedSuffixRef.current = truncatedSuffix;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  // 融合：targetRef/pendingPermissionsRef 为 §9.8 接线（命令总线路由 + 权限 pending
  // 复核），announceActive 为 §9.9.3-M11 远控壳消费门——两侧并存。
  const targetRef = useRef({ sessionId, workspacePath, workspaceIdentity });
  targetRef.current = { sessionId, workspacePath, workspaceIdentity };
  const pendingPermissionsRef = useRef(pendingInteractions);
  pendingPermissionsRef.current = pendingInteractions;
  // §9.9.3-M11：远控壳消费门 = focused && !isWebRemoteControl——全部消费 effect
  // （轮尾/权限/简报/腿互斥/focus 切换停止）统一以此为准；hook 保持整挂载
  //（hook 顺序稳定），远控 pane 零消费零出声。
  const announceActive = focused && !isWebRemoteControl;

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
          // §9.7.5：播报语言经 reader 收口——voiceAnnouncementLang=""（缺省）时
          // 回落 UI locale（现状语义零变化），显式值优先；§9.7.3 vendorVoice 双轨透传。
          const output = resolveVoiceAnnouncementOutputConfig(settingsRef.current);
          return {
            lang: resolveVoiceAnnouncementLangFromSettings(settingsRef.current, localeRef.current),
            ...output,
          };
        },
        cancelTask: () => requestTaskStopRef.current(),
        // §9.8/F5：权限段出声前的 pending 复核数据源（wiring ref 供 planner 闭包取最新投影）。
        isPermissionPending: (id) =>
          pendingPermissionsRef.current?.some(
            (item) => item.interactionId === id && item.payload.kind === "permission",
          ) === true,
        // §9.8/融合 §9.9-H2：录音是 episode 事实——recording 与逐句 injecting 微态都算
        // 在录，isRecording 是 planner 起播/续播互斥守卫的判定输入。
        isRecording: () => {
          const state = useVoiceSessionStore.getState();
          return state.inputLeg === "recording" || state.inputLeg === "injecting";
        },
        // §9.9.3-L8：已播权限账本升 store 跨 pane 共享——切 focused pane 后新 planner
        // 不再因实例级账本清零而重播同一 pending 权限（写经 action，单一写路径）。
        announcedPermissionLedger: {
          has: (permissionId) =>
            useVoiceSessionStore.getState().hasAnnouncedPermission(permissionId),
          mark: (permissionId) =>
            useVoiceSessionStore.getState().markPermissionAnnounced(permissionId),
        },
      }),
    [claim, tts],
  );

  // §9.6.7-1 工具简报：ToolCall 行「从无到有」→ 六规则限流（toolBriefPlanner）→
  // consumeBriefSegment（FD-3 插播时机判定在 planner）。文本组装 §4.2-7：
  // voice.brief.prefix 模板（tool + 目标截 40 字符）。
  // 声明先于 conversationKey effect：会话切换接线（§9.7.7）在其 deps 引用本实例
  //（const 声明晚于使用点会在渲染期 deps 求值时 TDZ 报错）。
  const extractToolBriefTarget = useCallback((inputText: string | undefined): string => {
    const firstLine = (inputText ?? "").split("\n")[0]?.trim() ?? "";
    return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
  }, []);
  const toolBriefPlanner = useMemo(
    () =>
      createToolBriefPlanner({
        isBriefEnabled: () => settingsRef.current?.voiceToolBriefEnabled === true,
        consumeBrief: (briefId: string, toolName: string, target: string) => {
          planner.consumeBriefSegment(
            briefId,
            // 简报目标截断的「…」由 extractToolBriefTarget 负责；权限段的截断尾缀文案不用于简报（§4.2-7 未定义简报尾缀）。
            intl.formatMessage({ id: "voice.brief.prefix" }, { tool: toolName, target }),
          );
        },
      }),
    [intl, planner],
  );
  // §9.7.7-3：下一帧快照以 prime 消化（首挂载置 true——「从无到有」以本 planner
  // 会话视图为界，挂载时存量终态行不播）。
  const briefPrimePendingRef = useRef(true);

  useEffect(() => {
    if (lastConversationKeyRef.current !== conversationKey) {
      planner.notifyStopPressed();
      // 会话/workspace 切换：轮尾去重键失效（新会话的最新轮尾允许重新消费）。
      lastConversationKeyRef.current = conversationKey;
      lastConsumedTurnRef.current = null;
      // §9.7.7：conversationKey 变化 = toolBriefPlanner 会话边界——单点接线（同批
      // lastConsumedTurnRef 重置）：清四结构会话态 + 下一帧快照以 prime 消化
      //（切回旧会话构造性防「切回即重播历史简报」）。
      toolBriefPlanner.resetSessionState();
      briefPrimePendingRef.current = true;
    }
    const tail = announceActive ? resolveFocusedAnnouncementTail(units) : null;
    tailRef.current = tail;
    if (!announceActive || !tail || tail.turnId === lastConsumedTurnRef.current) {
      return;
    }
    lastConsumedTurnRef.current = tail.turnId;
    planner.consumeTurnTail(tail);
  }, [announceActive, conversationKey, planner, toolBriefPlanner, units]);

  // §3.4：切换 focused 离开本 pane → 停旧播报（立即 cancel 回 AnnIdle 并释放 claim）；
  // 新 focused pane 的就绪轮尾由上面的消费 effect 从 AnnIdle 起播。
  // §9.9.3-M11：远控 pane 不消费也从不停播（停播责任在真正在播的桌面 pane）。
  const wasActiveRef = useRef(announceActive);
  useEffect(() => {
    if (wasActiveRef.current && !announceActive) {
      planner.notifyStopPressed();
    }
    wasActiveRef.current = announceActive;
  }, [announceActive, planner]);

  // §3.3 腿互斥接线：输入腿迁移 → planner（Recording 优先 / §4.7 句粒度暂停续播）。
  // 融合：§9.8 的 episode 真值判定（recording 与逐句 injecting 微态都算在录——多句
  // 连说时 injecting→recording 往返不触发 Ended，否则每句间都会恢复播报与用户语音
  // 叠音，§9.9-H2 互斥的接线面）+ §9.9.3-M11 远控 pane 不转发腿互斥（零消费门）。
  const recordingRef = useRef(false);
  useEffect(() => {
    if (!announceActive) {
      return () => undefined;
    }
    const syncRecording = (state: ReturnType<typeof useVoiceSessionStore.getState>) => {
      const recording = state.inputLeg === "recording" || state.inputLeg === "injecting";
      if (recording === recordingRef.current) return;
      recordingRef.current = recording;
      if (recording) planner.notifyUserRecordingStarted();
      else planner.notifyUserRecordingEnded();
    };
    syncRecording(useVoiceSessionStore.getState());
    return useVoiceSessionStore.subscribe(syncRecording);
  }, [announceActive, planner]);

  // §4.3 三层打断接线：语音命令总线（听写侧打断词命中 dispatch）→ 本 planner。
  // §9.8：任务取消按绑定目标单播；停播报按 owner 单播，不再依赖 canStop 充当路由。
  useEffect(() => {
    return registerVoiceCommandHandler(
      (kind) => {
        if (kind === "stopAnnouncementPressed") {
          planner.notifyStopPressed();
          return;
        }
        if (kind === "stopAnnouncement") {
          planner.notifyInterruptWordHit();
          return;
        }
        planner.requestCancelTask();
      },
      { getTarget: () => targetRef.current, isAnnouncementOwner: planner.isAnnouncementOwner },
    );
  }, [planner]);

  // §9.6.5-3 回落信号接线：连续失败 → 置回落标记（后续 speak 走 speechSynthesis）+
  // planner.notifyStopPressed 中止本轮回 AnnIdle（cancel+release+清队列、零协议）+ warn。
  useEffect(() => {
    return cloudTts.onConsecutiveFailures(() => {
      cloudFallbackRef.current = true;
      logger.warn("voice.tts", "cloud tts consecutive failures; falling back to speechSynthesis");
      planner.notifyStopPressed();
    });
  }, [cloudTts, planner]);

  // §9.6.5-3 恢复条款：设置变更（引擎/厂商档任一字段）= 下一引擎解析点——清会话内
  // 回落标记，cloud 引擎按最新设置重析（用户修复 baseUrl/凭据/网络后恢复，而非
  // 「坏一次就整个会话不再响」）。签名含引擎+baseUrl+模型；首渲染不误清。
  // §9.9.4-L13：签名拼入**凭据指纹二值**（非空= present / 空或未加载= absent）——
  // §9.6.5-3 自述恢复条件含「用户修复凭据」，但凭据走 ICredentialService 不经三字段，
  // 只补凭据时签名不变 → cloudFallbackRef 会话内不解除；凭据加载/清除经
  // credentialBump（§9.9.3-M10 解析点）驱动重渲染后本签名变化 → 清回落标记，下一句
  // 按最新凭据重试 cloud。指纹不落任何日志（§7.1 延伸边界：凭据原文/指纹值均不出日志）。
  const credentialFingerprint =
    cloudApiKeyRef.current != null && cloudApiKeyRef.current.trim().length > 0
      ? "present"
      : "absent";
  const ttsEngineSignature = `${settings?.voiceTtsEngine ?? "system"}\0${settings?.voiceVendorBaseUrl ?? ""}\0${settings?.voiceTtsVendorModel ?? ""}\0${credentialFingerprint}`;
  const wasTtsEngineSignatureRef = useRef(ttsEngineSignature);
  useEffect(() => {
    if (wasTtsEngineSignatureRef.current !== ttsEngineSignature) {
      wasTtsEngineSignatureRef.current = ttsEngineSignature;
      cloudFallbackRef.current = false;
    }
  }, [ttsEngineSignature]);

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
    if (!announceActive || !pendingInteractions) {
      return;
    }
    for (const interaction of pendingInteractions) {
      const payload = interaction.payload;
      if (payload.kind !== "permission") {
        continue;
      }
      const permissionPayload = payload as {
        kind: "permission";
        toolName?: string;
        summary?: string;
      };
      planner.consumePermissionSegment({
        permissionId: interaction.interactionId,
        text: buildPermissionAnnouncementText(permissionPayload, truncatedSuffixRef.current),
      });
    }
  }, [announceActive, pendingInteractions, planner]);

  // §9.9.3-L8：pendingInteractions 变化时把已播账本修剪到当前 pending 权限集——
  // 账本有界；权限离开 pending 后 wiring 不再消费该 id，剪除安全（同一 id 再次
  // pending 会重新播）。prune 是幂等账本维护而非播报消费，远控 pane 不门控。
  useEffect(() => {
    if (!pendingInteractions) {
      return;
    }
    const pendingIds = new Set(
      pendingInteractions
        .filter((interaction) => interaction.payload.kind === "permission")
        .map((interaction) => interaction.interactionId),
    );
    useVoiceSessionStore.getState().pruneAnnouncedPermissionIds(pendingIds);
  }, [pendingInteractions]);

  // §9.6.7-1 工具简报快照消费：每 tick 投影展开喂 planner；conversationKey 变化后
  // 的首帧以 {prime: true} 消化（§9.7.7-3——终态行只进 seen 不生成候选）。
  useEffect(() => {
    if (!announceActive) {
      return;
    }
    const rows: {
      toolCallId: string;
      toolName: string;
      turnId: string;
      status: string;
      target: string;
    }[] = [];
    for (const unit of units) {
      // assistantWorkRows 可选（类型上必有，测试夹具可缺省）——缺省即无工具行。
      for (const row of unit.assistantWorkRows ?? []) {
        if (row.kind !== "toolCall") {
          continue;
        }
        rows.push({
          toolCallId: row.toolCallId,
          toolName: row.toolName,
          turnId: unit.turnId,
          status: row.status,
          target: extractToolBriefTarget(row.inputText),
        });
      }
    }
    const prime = briefPrimePendingRef.current;
    briefPrimePendingRef.current = false;
    toolBriefPlanner.consumeToolCallSnapshot(rows, { prime });
  }, [announceActive, extractToolBriefTarget, toolBriefPlanner, units]);

  useEffect(() => {
    return () => {
      planner.dispose();
    };
  }, [planner]);

  const notifyExternalTaskStop = useCallback(() => {
    planner.notifyExternalTaskStop();
  }, [planner]);

  return {
    // 指示器可能显示在另一个可见 pane；停止动作仍须送真正的播报持有者。
    planner: useMemo(
      () => ({
        ...planner,
        notifyStopPressed: () => dispatchVoiceCommand("stopAnnouncementPressed"),
      }),
      [planner],
    ),
    indicatorPhase: useVoiceSessionStore((state) => state.announcement.phase),
    notifyExternalTaskStop,
  };
}
