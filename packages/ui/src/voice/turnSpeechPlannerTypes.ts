/**
 * 播报规划器端口类型（specs/voice-agent-integration.md §2.3）。
 *
 * 从 turnSpeechPlanner.ts 拆出（max-file-lines 架构门禁）；接口与实现分离，
 * planner 文件 re-export 保持外部导入路径不变。
 */
import type { VoiceAnnouncementClaimPort } from "./voiceAnnouncementClaim.js";
import type { AnnouncementLegControl } from "./voiceAnnouncementControl.js";
import type { VoiceTtsPort } from "./voiceTtsPort.js";

export interface TurnSpeechPlannerDeps {
  getFocusedTurnTail(sessionId: string | null): { turnId: string; text: string } | null;
  tts: VoiceTtsPort;
  claim: VoiceAnnouncementClaimPort;
  /** 照 taskNotificationPreferences.ts:33 reader 收口先例：设置关闭后运行时行为一致。 */
  isAnnouncementEnabled(): boolean;
  announcementControl: AnnouncementLegControl;
  /**
   * §6.1 音色/语速 + 播报语言（§9.7.5 lang 键 / §9.7.3 vendorVoice 双轨）；
   * 缺省跟随 navigator.language（系统默认音色/厂商默认音色/语速 1）。
   */
  getAnnouncementVoiceConfig?(): { lang: string; voice?: string; vendorVoice?: string; rate?: number };
  /** 层③「停掉任务」→ 既有 v4 stop（带 expectedForegroundExecutionId）；Phase 1b 接线。 */
  cancelTask?(): void;
  /**
   * 权限开始播放前重验，已处理的 pending 请求不能再读出（§9.9.2-M3 并行兼容）。
   * 与并行批次（§9.8/F5）additive deps 同名同签名：splice/排空/续播/起播链四处
   * 复核均按其过滤，F5 合入后同构叠加。
   */
  isPermissionPending?(permissionId: string): boolean;
  /**
   * §9.8（融合保真）：录音是 episode 事实，不能把逐句 injecting 微态当作结束——
   * wiring 传入「store inputLeg ∈ {recording, injecting}」的 episode 真值；缺省回落
   * planner 本地标志（单测形态）。§9.9-H2 的 resume/续播互斥守卫以此为判定输入。
   */
  isRecording?(): boolean;
  /**
   * §9.9.3-L8：已播权限账本——升 voiceSessionStore 跨 pane 共享（播过什么 = 播报腿
   * 状态族，§3.1 单一所有者的回归）。缺省回落 planner 实例级 Set（单 pane 语义不变）；
   * wiring 传 store 适配，防切 focused pane 后新 planner 账本清零、同一 pending 权限
   * 整段重播。
   */
  announcedPermissionLedger?: {
    has(permissionId: string): boolean;
    mark(permissionId: string): void;
  };
  /** claim 续约间隔（§3.5-1：间隔 < TTL/2）；缺省 voiceTuning，测试可缩短。 */
  claimRenewIntervalMs?: number;
  /** Cancelling 兜底（§3.3：5s）；缺省 voiceTuning，测试可缩短。 */
  cancellingFallbackTimeoutMs?: number;
}

export interface TurnSpeechPlanner {
  /** §9.8.2：本实例是否持窗口内播报 owner 凭证（命令总线停播报路由用）。 */
  isAnnouncementOwner(): boolean;
  /** focused 会话轮尾终态就绪（TurnComplete）时调用；内部判定 claim/互斥/顺延规则。 */
  consumeTurnTail(turnTail: { turnId: string; text: string }): void;
  /** 输入腿进入 Recording：当前句播完即停（句粒度，§4.7 裁决）。 */
  notifyUserRecordingStarted(): void;
  /** 输入腿退出 Recording：轮尾仍最新 → 句边界续播；已更新 → 作废只播最新。 */
  notifyUserRecordingEnded(): void;
  /** 点按播报指示停止按钮（层①载体，非 TID_V4_STOP——§3.3 FD-1）：任何播报态立即 cancel 回 AnnIdle，不取消任务。 */
  notifyStopPressed(): void;
  /** ASR final 命中打断词表：层①停播报不续播（uninterruptible 段外）。 */
  notifyInterruptWordHit(): void;
  /** 「停掉任务」命中：层③，发既有 v4 stop（带 expectedForegroundExecutionId）。 */
  requestCancelTask(): void;
  /**
   * 任务被任何停止面取消（TID_V4_STOP / Esc 停止生成——§3.3 FD-1）：播报同步静音经
   * Cancelling 回 AnnIdle；不重复发 v4 stop（停止面已经发过）。additive 于 §2.3。
   */
  notifyExternalTaskStop(): void;
  /**
   * 权限请求内容段（§4.1 播级 / FD-3 优先级 权限>正文）：正在播正文时当前句播完即
   * 插队（句粒度让位），整段标记 uninterruptible（§3.3），连续段背靠背连播；
   * AnnIdle 时立即起播。text 由调用方按 §4.1 截断（200 字符 + 尾缀）。
   */
  consumePermissionSegment(segment: { permissionId: string; text: string }): void;
  /**
   * 工具简报句（§4.2 / FD-3 优先级最低）：仅 AnnIdle 或正文句间且无待播权限段时插播；
   * 录音中（annPaused/未暂停的 recording）/权限段播报中/段间句隙/权限待插队列非空/
   * Cancelling → 丢弃。uninterruptible 不置位（简报可被打断词通道打断）。
   */
  consumeBriefSegment(briefId: string, text: string): void;
  /** Composer 卸载/窗口关闭（§3.5-4 release 时机）：停播、清定时器、release claim。 */
  dispose(): void;
}
