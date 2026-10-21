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
 * 注入通道（缺口9 已接线，含消费门）：既有 composer 注入面调研结论——
 * - store 插入请求（requestComposerTextInsert）是唯一的通用插入通道；挂载点
 *   WorkspaceShellLayout 经 AnimatedSidePanePanel → TeamSidePane 注入 onPrefillComposer，
 *   实现走该通道（与插件 mention 同一通道，不新造第二条 composer 写路径）；
 * - 消费门（2026-10-21 修复）：TeamSidePane 随行 lead 会话（tab.parentSessionId）作
 *   targetSessionId 定向，SessionPane 按 `(targetSessionId ?? null) === (sessionId ?? null)`
 *   匹配下发——此前只对聚焦草稿 composer 下发，lead 会话聚焦（主场景）时请求被丢弃；
 *   缺席 targetSessionId 仍 = 草稿（建议 prompt / 插件 mention 等既有生产方语义不变）。
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
