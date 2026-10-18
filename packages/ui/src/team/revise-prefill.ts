/**
 * staged「回对话修改」的会话输入框预填文案构造（纯函数；设计
 * docs/agent-team-implementation-2026-10-16/01-command-and-ui-design.md §3.1
 * 「会话输入框预填『要调整什么？』」）。
 *
 * 为什么预填要携带面板 note（v1 边界，本卡裁决）：bootstrap 的 reviseTeamPlan
 * handler v1 只把草案重 stage 一遍（drora-protocol-v4/commands/handlers/team.ts
 * reviseTeamPlan：不消费 wire note，追问面在对话侧），面板「修改方向」输入若只随
 * 命令上 wire 会丢。因此 note 非空时随追问文案一起进入预填——用户可直接发送或
 * 续写后发送，方向经对话到达 lead 模型（spec §10「原子更新同一草案」的触发面）。
 *
 * 注入通道（v1 宿主接线点）：既有 composer 注入面调研结论——
 * - store 插入请求（requestComposerTextInsert）消费端只有 focused 的 draft 态
 *   composer（SessionPane externalTextInsertRequest 仅 sessionId === null 时下发），
 *   团队场景的 lead 会话 composer 不可达；
 * - 既有会话 composer 只有两个领域专用 window 事件（workspace 文件加入对话 /
 *   knowledge handoff），非通用公开面。
 * 因此预填经 TeamSidePane 的 onPrefillComposer 回调 prop 由挂载点提供实现，
 * 本模块只负责文案构造（Composition root 在 app-shell 之外，接线缺口登记在
 * 实现报告 concerns）。
 */

/** 预填追问文案的 locales 键（zh-CN/en-US 双语；i18n 键单一出处）。 */
export const TEAM_REVISE_PREFILL_PROMPT_KEY = "team.revise.prefillPrompt";

export interface TeamReviseComposerPrefillInput {
  /** 已本地化的追问文案（locales `team.revise.prefillPrompt`，zh「要调整什么？」）。 */
  question: string;
  /** 面板「修改方向」输入（可缺席）；空白视同缺席（与 TeamStagedEditor 的 trim 语义一致）。 */
  note?: string;
}

/**
 * 构造预填进会话输入框的文案：无 note = 追问文案本身；有 note = 追问文案 + 换行 +
 * note（用户可续写/直接发送）。输入两端 trim，避免词典或输入框带出的空白进 composer。
 */
export function buildTeamReviseComposerPrefill(input: TeamReviseComposerPrefillInput): string {
  const question = input.question.trim();
  const note = input.note?.trim();
  if (note === undefined || note === "") {
    return question;
  }
  return `${question}\n${note}`;
}
