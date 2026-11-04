/**
 * PM48 归因评测语料 v1（specs/drora-persona-system.md §13 第十四批冻结）。
 *
 * 合同来源：docs/design/drora-persona-data-contracts-2026-10-29.md §8——
 * 「P1b 增加 12 条固定序列，每条 4–8 回合，两个配置各重复 3 次（72 次序列，基线另跑）；
 * 覆盖全局/项目/临时、第三人、假设/否定、裸确认、重述确认、冲突、pinned、纠正、
 * 忘记旧源、跨项目/模型」。
 *
 * 覆盖对照（合同清单项 → 序列）：
 * - 全局显式重述（正例）        → pm48-01（称呼）、pm48-07（讲解风格）
 * - 全局 + 跨项目               → pm48-02（语言，跨模型＝两模型各跑全部序列）
 * - 项目限定（负例）            → pm48-03
 * - 第三人引用（负例）          → pm48-04、pm48-12 回合 3
 * - 假设/不明否定（负例）       → pm48-05
 * - 裸确认（负例）              → pm48-06
 * - 重述确认（正例）            → pm48-07
 * - 冲突（同键两次不同值）      → pm48-08
 * - pinned 不被 inferred 覆盖  → pm48-09
 * - 纠正（新值取代旧值）        → pm48-10
 * - 忘记旧源                    → pm48-11
 * - 临时要求 + 正负混合         → pm48-12
 *
 * 回合＝用户（人类）消息原文；学习窗口只含人类消息（端口合同 §6「模型不得自报来源」，
 * 且需助手上下文才能消歧的省略表达必须拒学）。语料冻结后跑批期间不得修改；
 * 修改须按合同「下一实验前说明版本与原因」升版本。
 */
import type { PersonaPreferenceKey } from "@drora/shared";

export const PM48_CORPUS_VERSION = "pm48-corpus-v1.1";

export type Pm48ExpectationKind =
  /** 本回合应产出指定键值的候选（合同 §6「合格新轮的原话必须直接重述值与全局范围」）。 */
  | "learn"
  /** 本回合必须零候选提交（语义负例：引用他人/假设/否定/裸确认/项目限定/临时/省略表达）。 */
  | "forbid"
  /** 本回合的新候选应与既有同键 inferred 冲突 → 键进入 disputed（PM41）。 */
  | "conflict"
  /** pinned/explicit 值必须保持不变，inferred 候选不得覆盖（PM41「pinned 不变」）。 */
  | "pinned_guard"
  /** 撤销指令：抽取面零候选 + harness 在本回合后走管理面逻辑忘记并验证清理。 */
  | "forget"
  /** 无偏好语义的普通工作消息，期望零候选。 */
  | "no_op";

export interface Pm48Expectation {
  /** 1-based 回合号（用户消息序）。 */
  readonly round: number;
  readonly kind: Pm48ExpectationKind;
  readonly key?: PersonaPreferenceKey;
  readonly value?: string;
  /** 判定依据（引用合同条款），进报告。 */
  readonly note: string;
}

export interface Pm48Sequence {
  readonly id: string;
  /** 合同覆盖清单项（报告对照用）。 */
  readonly covers: string;
  readonly rounds: readonly string[];
  readonly expectations: readonly Pm48Expectation[];
  /** 需要的前置状态（harness 在跑该序列前布置）。 */
  readonly precondition:
    | { readonly kind: "clean" }
    | { readonly kind: "pinned_preference"; readonly key: PersonaPreferenceKey; readonly value: string }
    | { readonly kind: "inferred_preference"; readonly key: PersonaPreferenceKey; readonly value: string };
}

export const PM48_SEQUENCES: readonly Pm48Sequence[] = [
  {
    id: "pm48-01",
    covers: "全局显式重述（preferredAddress 正例）",
    precondition: { kind: "clean" },
    rounds: [
      "帮我把这个工具函数改成纯函数，别改它的对外签名。",
      "顺便定一下：以后请叫我「老黄」，不是只在这个项目，是全局所有会话都这么叫。",
      "改得不错，再帮我补一个单测，覆盖空数组的边界。",
    ],
    expectations: [
      { round: 1, kind: "no_op", note: "普通工作消息，零候选" },
      { round: 2, kind: "learn", key: "preferredAddress", value: "老黄", note: "原话直接重述值与全局范围（合同 §6 合格新轮）" },
      { round: 3, kind: "no_op", note: "普通工作消息，零候选" },
    ],
  },
  {
    id: "pm48-02",
    covers: "全局偏好 + 跨项目（replyLanguage 正例）",
    precondition: { kind: "clean" },
    rounds: [
      "以后所有回复都用中文，这是全局默认——包括我在其他项目里开的会话，不是只这一处。",
      "明白了的话，帮我看看这个模块的循环依赖怎么解开。",
    ],
    expectations: [
      { round: 1, kind: "learn", key: "replyLanguage", value: "zh-CN", note: "明确全局范围 + 跨项目声明；跨模型由两模型各跑覆盖" },
      { round: 2, kind: "no_op", note: "普通工作消息，零候选" },
    ],
  },
  {
    id: "pm48-03",
    covers: "项目限定要求（scope 负例）",
    precondition: { kind: "clean" },
    rounds: [
      "这个项目里讲解可以简短点——只是这个项目，我在别的地方还是想要原来的详细程度。",
      "帮我看看构建为什么失败，日志在这里。",
    ],
    expectations: [
      { round: 1, kind: "forbid", key: "explanationDetail", note: "范围=项目非全局（合同 §6「项目限定/临时要求的负例在机械层拒绝」；模型层应零候选）" },
      { round: 2, kind: "no_op", note: "普通工作消息，零候选" },
    ],
  },
  {
    id: "pm48-04",
    covers: "第三人引用（负例）",
    precondition: { kind: "clean" },
    rounds: [
      "我们组的小王喜欢 concise 风格的回答，你说他这个习惯好不好？",
      "先不聊他了，帮我 review 一下这个 diff。",
    ],
    expectations: [
      { round: 1, kind: "forbid", key: "explanationDetail", note: "引用他人偏好非当前用户（PM38「用户引用他人不写入」）" },
      { round: 2, kind: "no_op", note: "普通工作消息，零候选" },
    ],
  },
  {
    id: "pm48-05",
    covers: "假设 + 明确否定（负例）",
    precondition: { kind: "clean" },
    rounds: [
      "假如我以后想让你一步一步讲解，那会是什么效果？先别真改，我只是在问。",
      "这个报错有点烦，帮我修一下。",
    ],
    expectations: [
      { round: 1, kind: "forbid", key: "collaborationStyle", note: "假设性提问且明确「先别真改」（PM38「假设/不明否定不写入」）" },
      { round: 2, kind: "no_op", note: "普通工作消息，零候选" },
    ],
  },
  {
    id: "pm48-06",
    covers: "裸确认 / 省略表达（负例）",
    precondition: { kind: "clean" },
    rounds: ["好", "嗯，就这样", "帮我写一个防抖函数，要 leading 和 trailing 都支持"],
    expectations: [
      { round: 1, kind: "forbid", note: "裸「好」：窗口内无助手上下文可消歧（PM40「裸确认不持久化」+合同 §6「需助手上下文消歧的省略表达拒绝学习」）" },
      { round: 2, kind: "forbid", note: "省略表达，同上" },
      { round: 3, kind: "no_op", note: "普通工作消息，零候选" },
    ],
  },
  {
    id: "pm48-07",
    covers: "重述确认（正例，assistant 建议后的合格重述）",
    precondition: { kind: "clean" },
    rounds: [
      "行，就按刚才你建议的来：以后讲解都用简洁风格，全局默认，不是只这一次。",
      "那我们继续修这个 bug，先把复现步骤跑一遍。",
    ],
    expectations: [
      { round: 1, kind: "learn", key: "explanationDetail", value: "concise", note: "自包含重述值+全局范围→仅 inferred（PM40「合格重述仅 inferred」）" },
      { round: 2, kind: "no_op", note: "普通工作消息，零候选" },
    ],
  },
  {
    id: "pm48-08",
    covers: "同键冲突（两次不同 inferred）",
    precondition: { kind: "clean" },
    rounds: [
      "以后讲解简洁点，全局默认简洁。",
      "帮我看看这个类型报错。",
      "对了，改主意了：以后讲解还是详细一点，也是全局默认。",
    ],
    expectations: [
      { round: 1, kind: "learn", key: "explanationDetail", value: "concise", note: "合格全局重述" },
      { round: 2, kind: "no_op", note: "普通工作消息，零候选" },
      { round: 3, kind: "conflict", key: "explanationDetail", value: "detailed", note: "与既有 inferred 不同值→键暂停/disputed（PM41「inferred 冲突暂停该键」）" },
    ],
  },
  {
    id: "pm48-09",
    covers: "pinned 不被 inferred 覆盖",
    precondition: { kind: "pinned_preference", key: "explanationDetail", value: "balanced" },
    rounds: [
      "以后讲解都简洁点吧，全局默认简洁。",
      "帮我看看这段 SQL 为什么慢。",
    ],
    expectations: [
      { round: 1, kind: "pinned_guard", key: "explanationDetail", note: "explicit/pinned=balanced 必须保持；inferred 候选不得自动生效（PM41「pinned 不变」）" },
      { round: 2, kind: "no_op", note: "普通工作消息，零候选" },
    ],
  },
  {
    id: "pm48-10",
    covers: "纠正（新值取代旧值）",
    precondition: { kind: "clean" },
    rounds: [
      "以后叫我「黄工」，全局所有会话。",
      "更正一下：还是叫我「老黄」吧，也是全局默认，刚才那个「黄工」作废。",
    ],
    expectations: [
      { round: 1, kind: "learn", key: "preferredAddress", value: "黄工", note: "合格全局重述（首轮）" },
      // v1.1 修正：经抽取管线的「纠正」＝同键第二个不同 inferred，按 PM41 语义进入冲突
      // 暂停（disputed/待确认），而非直接替换当前值——v1 误标为 learn，试点实测后修正。
      { round: 2, kind: "conflict", key: "preferredAddress", value: "老黄", note: "纠正新值经抽取＝第二个不同 inferred → 键 disputed/待确认（PM41）；显式替换只经设置事务" },
    ],
  },
  {
    id: "pm48-11",
    covers: "忘记旧源",
    precondition: { kind: "inferred_preference", key: "preferredAddress", value: "老王" },
    rounds: [
      "把我之前让你叫我「老王」的那条忘掉吧，以后别那么叫我了。",
      "帮我看看这个测试为什么不稳定。",
    ],
    expectations: [
      { round: 1, kind: "forget", key: "preferredAddress", note: "撤销指令：抽取面零候选 + harness 随回合走管理面逻辑忘记并验证清理（§9 纠正/忘记）" },
      { round: 2, kind: "no_op", note: "普通工作消息，零候选" },
    ],
  },
  {
    id: "pm48-12",
    covers: "临时要求 + 正负例混合",
    precondition: { kind: "clean" },
    rounds: [
      "今天这个项目赶工，回答尽量短一点——就今天，别当成永久设置。",
      "另外正式定一下：以后默认叫我 Cavin，全局所有会话。",
      "我朋友说你们回答都应该用 step_by_step 教学，我觉得他说得可能对。",
      "帮我看看这个内存泄漏的线索。",
    ],
    expectations: [
      { round: 1, kind: "forbid", key: "explanationDetail", note: "临时要求（「就今天」），非全局" },
      { round: 2, kind: "learn", key: "preferredAddress", value: "Cavin", note: "合格全局重述" },
      { round: 3, kind: "forbid", key: "collaborationStyle", note: "第三人（朋友）意见且用户未采纳（「可能对」≠本人声明）" },
      { round: 4, kind: "no_op", note: "普通工作消息，零候选" },
    ],
  },
];
