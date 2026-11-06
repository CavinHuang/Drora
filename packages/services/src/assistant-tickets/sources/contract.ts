/**
 * Drora Mate Source 注册表契约（specs/drora-personal-assistant.md §5 Trigger 来源；
 * docs/mate-implementation-plan-2026-11-04/03-p3-detailed-design.md §1-§5）。
 *
 * 事件面定型（P3 host 侧批次）：Source 产出 MateSourceEvent → 注册表统一送
 * IAssistantTicketService（channel_ref 命中活动工单→直通 Tier1；否则进 admissionGate，
 * 强度=真实规则 mention && allowlist → explicit）。本文件 browser-safe：只放类型与
 * 常量，无 IO（工厂在 sourceRegistry.ts / 各 Source 文件，经 services/node.ts 装配）。
 *
 * 分层纪律（照 assistantPorts.ts 先例）：本目录不 import bots / fetch 实测——bots 入站
 * 回调（assistantForwarder）、GitHub HTTP、凭证加载全部由装配层注入；单测以 fake 驱动。
 */

import type { AssistantSourceKind } from "@drora/shared";

export type { AssistantSourceKind };

/** Source 通道绑定（03 详设 §5：feishu thread / GitHub issue / 手机会话）。 */
export interface MateChannelRef {
  /** 飞书：群聊=线程粒度（chatId+threadId）；私聊=会话粒度（chatId）。 */
  readonly kind: "feishu";
  readonly chatId: string;
  /** 群聊线程 id；私聊/无线程缺席。 */
  readonly threadId?: string;
}

export interface MateGithubChannelRef {
  readonly kind: "github";
  readonly owner: string;
  readonly repo: string;
  readonly issueNumber: number;
}

export interface MatePhoneChannelRef {
  readonly kind: "phone";
  /** 手机远控会话 id（attachment remoteSessionId；贯穿标识，不参与身份判定）。 */
  readonly remoteSessionId: string;
}

export type MateSourceChannelRef = MateChannelRef | MateGithubChannelRef | MatePhoneChannelRef;

/** Source 产出的事件（03 详设 §1 形状；emit 后统一进 admissionGate）。 */
export interface MateSourceEvent {
  /** kind 取值=ASSISTANT_SOURCE_KINDS 封闭枚举（contracts 单出处）。 */
  readonly kind: AssistantSourceKind;
  /** 触发者身份（飞书 open_id 经映射 / GitHub login 经映射 / 手机=host 本机用户）。 */
  readonly identity: string;
  /** 目标 workspace（飞书/GitHub 缺席=决策卡问人；手机=attachment 作用域 workspace）。 */
  readonly workspaceIdentity?: string;
  /** 手机远控会话贯穿（其余 Source 缺席）。 */
  readonly remoteSessionId?: string;
  /** 用户原文 verbatim（永不改写——spec §2.4）。 */
  readonly text: string;
  /** Provider 核验/整词匹配的点名事实；强度判定=mention && allowlist。 */
  readonly mention: boolean;
  readonly atMs: number;
  readonly channelRef?: MateSourceChannelRef;
}

/** MateSource 最小接口（03 详设 §1 原形：start(emit, config)）：注册表按 config.enabled 惰性启停。 */
export interface MateSource {
  readonly kind: AssistantSourceKind;
  /**
   * start 后 Source 才可 emit（emit 句柄由注册表接线 → 服务 ingestSourceEvent）；
   * config=当前 kv 配置全量（各 Source 取自己的切片，坏/缺值按各自诚实缺省）。
   */
  start(emit: (event: MateSourceEvent) => void, config: MateSourcesConfig): void;
  stop(): void;
  readonly isRunning: () => boolean;
}

/**
 * 工单终态 Source 回复端口（03 详设 §2/§4 回复路径；注册表终态通知器消费）。
 * 实现方（装配层）：GitHub=POST issue comment（fetch 注入）；飞书=真机验收批接线
 * （bots replyToChannel 需 bots 任务绑定，Mate 工单无归属，不可直接复用——03 §2 落地注记）。
 * 端口缺席 → 注册表诚实降级（warn 一次，不重试、不用超时兜底）。
 */
export interface AssistantSourceReplyPort {
  reply(input: {
    channelRef: string;
    /** 工单 id；P7 查询答复无工单，此值为触发 id（decision 关联的 trigger id——仅作
     * 实现侧日志/幂等键，实现不应据此反查工单）。 */
    ticketId: string;
    /** "query"=P7 查询直答（08 号详设 §3.5；无工单事实，summary 即答案文本）。 */
    status: "done" | "failed" | "query";
    /** 一句话摘要（output_summary/fail_reason/答复文本截断；GitHub 实现附 Co-authored-by 署名行）。 */
    summary: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** bots 入站回调出口的结构形状（assistantForwarder；bots 侧内联声明，结构化兼容）。 */
export interface MateChannelMessageEvent {
  readonly provider: string;
  readonly botId: string;
  readonly text: string;
  /** Provider 核验的点名事实（不是正文解析结果）。 */
  readonly mentionedBot?: boolean;
  readonly commandText?: string;
  readonly groupCardAction?: boolean;
  readonly elicitationResponse?: unknown;
  readonly actor: {
    readonly providerUserId: string;
    readonly chatType: "private" | "group";
    readonly chatId?: string;
    readonly threadId?: string;
    readonly providerMessageId?: string;
  };
  readonly receivedAt?: number;
}

/** Source 开关配置（kv JSON；写路径=装配层 kvSet，UI 配置面随 P3 下一棒）。 */
export interface MateSourceFeishuConfig {
  readonly enabled?: boolean;
}

export interface MateSourcePhoneConfig {
  readonly enabled?: boolean;
}

export interface MateSourceGithubConfig {
  readonly enabled?: boolean;
  /** 单仓库起步：owner/repo。 */
  readonly repo?: string;
  /** 点名词（缺省「大副」；整词 @匹配）。 */
  readonly mentionName?: string;
}

export interface MateSourcesConfig {
  readonly feishu?: MateSourceFeishuConfig;
  readonly phone?: MateSourcePhoneConfig;
  readonly github?: MateSourceGithubConfig;
}

/** 外部 id → 本地 identity 映射（03 详设 §2/§4 名单；kv JSON；未映射→原样外部 id，gate 拒绝）。 */
export type MateSourceIdentityMap = {
  readonly feishu?: Readonly<Record<string, string>>;
  readonly github?: Readonly<Record<string, string>>;
};
