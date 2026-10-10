/**
 * 智能问库视图状态机（W04 / specs/obsidian-knowledge.md §5c）。
 *
 * 纯函数模型：React 组件只负责把服务 RPC 结果折算成这里的 Action，渲染所需的
 * 全部判定（run 代数守卫、意图分类、候选展开、证据态、状态条）都可脱离 DOM 单测。
 *
 * 状态所有者边界（spec §5c.2）：run 事实归服务端 Query 服务；本模型只维护
 * 「当前 runId + runGeneration + seq」投影，迟到/旧代事件一律丢弃（A22）。
 */
import type {
  KnowledgeArticleCandidate,
  KnowledgeIndexStatus,
  KnowledgeRunUpdatedEvent,
  KnowledgeRunView,
} from "@drora/services";

// ── 意图 ─────────────────────────────────────────────────────

export type KnowledgeAskIntent = "find" | "answer" | "compare";
export type KnowledgeAskIntentChoice = "auto" | KnowledgeAskIntent;

const COMPARE_PATTERN = /(比较|对比|区别|差异|不同点|差别|对比一下|\bcompare\b|\bversus\b|\bvs\.?\b)/i;
const ANSWER_PATTERN =
  /(为什么|如何|怎么|怎样|是什么|指的是|总结|解释|说明一下|请问|问一下|意味着|\bwhat\b|\bhow\b|\bwhy\b|\bexplain\b|\bsummar)/i;
const FIND_PATTERN = /(找到|找出|哪篇|哪个文件|哪一条|那篇|文章|笔记|标题|记得|写过|收藏|摘录|\bfind\b|\bwhich\b|\bremember\b)/i;

/**
 * auto 意图的启发式分类。顺序即优先级：比较 > 问内容 > 找文章；
 * 都不命中时默认 find——FIND 是默认形态，候选优先，不生成抢占首屏的答案（ADR #3）。
 */
export function detectAskIntentHint(query: string): KnowledgeAskIntent {
  if (COMPARE_PATTERN.test(query)) return "compare";
  if (ANSWER_PATTERN.test(query)) return "answer";
  if (FIND_PATTERN.test(query)) return "find";
  return "find";
}

/** 用户手选优先（PRD J1：IntentPolicy + 用户手选优先）；auto 才走启发式。 */
export function resolveAskIntent(choice: KnowledgeAskIntentChoice, query: string): KnowledgeAskIntent {
  return choice === "auto" ? detectAskIntentHint(query) : choice;
}

// ── 证据 Inspector 态（按 articleId 键） ─────────────────────

export interface KnowledgeEvidenceQuote {
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

export type KnowledgeEvidenceInspectState =
  | { phase: "checking" }
  /** current = prepareEvidence 签发 + resolveCitation 复验都通过（唯一可回跳态）。 */
  | {
      phase: "verified";
      receiptId: string;
      excerpt: string;
      relativePath: string;
      title: string;
      heading: string | null;
      quote: KnowledgeEvidenceQuote;
    }
  | {
      phase: "unavailable";
      status: "stale" | "missing" | "forbidden" | "no_source" | "source_stale";
      reason: string | null;
    }
  | { phase: "failed"; message: string };

// ── run 投影 ────────────────────────────────────────────────

export interface KnowledgeAskRound {
  /** 最近一次被接受的 run 快照（search/getRun 返回）。 */
  run: KnowledgeRunView;
  submittedQuery: string;
  clientRequestId: string;
  intent: KnowledgeAskIntent;
  /** onRunUpdated 的最大已接受 seq；事件 seq 必须严格递增（spec §5b.6）。 */
  lastSeq: number;
  cancelledByUser: boolean;
}

export type KnowledgeAskPhase = "idle" | "submitting" | "retrieving" | "settled" | "failed";

export interface KnowledgeAskState {
  phase: KnowledgeAskPhase;
  current: KnowledgeAskRound | null;
  /** 追问时保留的上一轮；取消/失败不清空上一轮可用结果（PRD §8 禁止行为）。 */
  previous: KnowledgeAskRound | null;
  /** submitting 阶段（createRun 尚未返回）携带的提交描述；runCreated 落位后清除。 */
  pendingSubmit: { query: string; clientRequestId: string; intent: KnowledgeAskIntent } | null;
  /** 当前展开的候选数上限（默认露出前 5 篇，可展开全部）。 */
  visibleCandidateLimit: number;
  /** 用户显式选中的候选；模型从不自动选中（A09 多候选不强选）。 */
  selectedArticleId: string | null;
  evidence: Readonly<Record<string, KnowledgeEvidenceInspectState>>;
  /** host 层失败（RPC reject / 断连代理），区别于 run 的结构化 status。 */
  error: string | null;
}

export const ASK_DEFAULT_VISIBLE_CANDIDATES = 5;

export function createInitialKnowledgeAskState(): KnowledgeAskState {
  return {
    phase: "idle",
    current: null,
    previous: null,
    pendingSubmit: null,
    visibleCandidateLimit: ASK_DEFAULT_VISIBLE_CANDIDATES,
    selectedArticleId: null,
    evidence: {},
    error: null,
  };
}

export type KnowledgeAskAction =
  /** createRun 已发出（等待返回）；组件在此刻生成并持有 clientRequestId。 */
  | { type: "submitStarted"; query: string; clientRequestId: string; intent: KnowledgeAskIntent }
  | { type: "runCreated"; run: KnowledgeRunView }
  | { type: "runSettled"; run: KnowledgeRunView }
  | { type: "runEvent"; event: KnowledgeRunUpdatedEvent }
  | { type: "submitFailed"; message: string }
  | { type: "cancelSucceeded" }
  | { type: "expandCandidates"; limit: number }
  | { type: "candidateSelected"; articleId: string | null }
  | { type: "evidenceChecking"; articleId: string }
  | { type: "evidenceResolved"; articleId: string; state: KnowledgeEvidenceInspectState };

function runIsSettled(run: KnowledgeRunView): boolean {
  return run.status !== "retrieving";
}

export function reduceKnowledgeAsk(state: KnowledgeAskState, action: KnowledgeAskAction): KnowledgeAskState {
  switch (action.type) {
    case "submitStarted": {
      // 新提交使旧 run 投影立即失效：current → previous（折叠保留），证据态全部作废
      // （receipt 绑定旧 run，跨 run 的 Inspector 判定不可复用）。
      return {
        ...state,
        phase: "submitting",
        current: null,
        previous: state.current ?? state.previous,
        pendingSubmit: {
          query: action.query,
          clientRequestId: action.clientRequestId,
          intent: action.intent,
        },
        visibleCandidateLimit: ASK_DEFAULT_VISIBLE_CANDIDATES,
        selectedArticleId: null,
        evidence: {},
        error: null,
      };
    }
    case "runCreated": {
      if (state.phase !== "submitting" || !state.pendingSubmit) return state;
      const pending = state.pendingSubmit;
      return {
        ...state,
        phase: runIsSettled(action.run) ? "settled" : "retrieving",
        current: {
          run: action.run,
          submittedQuery: pending.query,
          clientRequestId: pending.clientRequestId,
          intent: pending.intent,
          lastSeq: 0,
          cancelledByUser: false,
        },
        pendingSubmit: null,
      };
    }
    case "runSettled": {
      const current = state.current;
      // runId 不匹配 = 旧 run 的迟到结果，直接丢弃（A22）。
      if (!current || action.run.runId !== current.run.runId) return state;
      if (action.run.runGeneration < current.run.runGeneration) return state;
      return {
        ...state,
        phase: runIsSettled(action.run) ? "settled" : state.phase,
        current: { ...current, run: action.run },
      };
    }
    case "runEvent": {
      const current = state.current;
      if (!current) return state;
      // 状态事件守卫：runId + 代数 + seq 三重匹配，迟到事件不覆盖新 run。
      if (action.event.runId !== current.run.runId) return state;
      if (action.event.runGeneration !== current.run.runGeneration) return state;
      if (action.event.seq <= current.lastSeq) return state;
      return {
        ...state,
        current: { ...current, lastSeq: action.event.seq },
      };
    }
    case "submitFailed": {
      if (state.phase !== "submitting" && state.phase !== "retrieving") return state;
      return { ...state, phase: "failed", error: action.message, pendingSubmit: null };
    }
    case "cancelSucceeded": {
      if (!state.current) return state;
      // 取消只停止 in-flight；保留本轮已有的候选展示（PRD：取消不清空上次可用结果）。
      return {
        ...state,
        phase: "settled",
        current: { ...state.current, cancelledByUser: true },
      };
    }
    case "expandCandidates":
      return { ...state, visibleCandidateLimit: Math.max(1, action.limit) };
    case "candidateSelected":
      return { ...state, selectedArticleId: action.articleId };
    case "evidenceChecking":
      return { ...state, evidence: { ...state.evidence, [action.articleId]: { phase: "checking" } } };
    case "evidenceResolved":
      return { ...state, evidence: { ...state.evidence, [action.articleId]: action.state } };
    default:
      return state;
  }
}

// ── 派生视图 ────────────────────────────────────────────────

export interface KnowledgeAskCandidateSlice {
  visible: KnowledgeArticleCandidate[];
  hiddenCount: number;
  canExpand: boolean;
}

export function sliceCandidates(
  candidates: KnowledgeArticleCandidate[],
  limit: number,
): KnowledgeAskCandidateSlice {
  if (candidates.length <= limit) {
    return { visible: candidates, hiddenCount: 0, canExpand: false };
  }
  return {
    visible: candidates.slice(0, limit),
    hiddenCount: candidates.length - limit,
    canExpand: true,
  };
}

/** run 落定后的结果形态（决定结果区呈现，见 spec §5c.4 状态映射）。 */
export type KnowledgeAskOutcome =
  | "idle"
  | "submitting"
  | "retrieving"
  | "ready"
  | "empty"
  | "partial"
  | "noVault"
  | "sourceStale"
  | "failed"
  | "cancelled";

export function getAskOutcome(state: KnowledgeAskState): KnowledgeAskOutcome {
  if (state.phase === "idle" || state.phase === "failed") return state.phase === "failed" ? "failed" : "idle";
  const round = state.current;
  if (!round) return state.phase === "submitting" ? "submitting" : "idle";
  if (state.phase === "submitting") return "submitting";
  if (state.phase === "retrieving") return "retrieving";
  switch (round.run.status) {
    case "no_source":
      return "noVault";
    case "source_stale":
      return "sourceStale";
    case "empty":
      return "empty";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "partial":
      return "partial";
    case "ready":
      return "ready";
    default:
      return "retrieving";
  }
}

/** 状态条条目（有序、低噪音；组件按 code 查 i18n 文案）。 */
export type KnowledgeAskBannerCode =
  | "noVault"
  | "indexing"
  | "indexMissing"
  | "indexPartial"
  | "semanticUnavailable"
  | "sourceStale"
  | "noAnswer"
  | "expandedSearch"
  | "jevOff"
  | "cancelled"
  | "modelUnavailable";

export function deriveAskBanners(params: {
  state: KnowledgeAskState;
  indexStatus: KnowledgeIndexStatus | null;
  /** 当前是否具备把引用送入既有 Agent 会话的条件（有会话 + selection 通道可用）。 */
  hasSession: boolean;
}): KnowledgeAskBannerCode[] {
  const { state, indexStatus, hasSession } = params;
  const banners: KnowledgeAskBannerCode[] = [];
  const outcome = getAskOutcome(state);
  if (outcome === "noVault" || indexStatus?.configured === false) {
    banners.push("noVault");
    return banners;
  }
  const job = indexStatus?.job ?? null;
  if (job && (job.status === "running")) banners.push("indexing");
  if (
    indexStatus?.configured &&
    (indexStatus.coverage.indexedFiles === 0) &&
    !(job && job.status === "running")
  ) {
    banners.push("indexMissing");
  }
  if (indexStatus?.coverage.partial) banners.push("indexPartial");
  if (indexStatus?.semantic === "unavailable") banners.push("semanticUnavailable");
  if (outcome === "sourceStale") banners.push("sourceStale");
  if (outcome === "empty") banners.push("noAnswer");
  if (outcome === "cancelled") banners.push("cancelled");
  const diagnostics = state.current?.run.diagnostics ?? null;
  if (diagnostics?.matchRelaxedToOr) banners.push("expandedSearch");
  // Jev 默认关闭（W05 前不存在请求）：有候选展示时提示一次本地排序语义，低噪音。
  if ((outcome === "ready" || outcome === "partial") && (state.current?.run.candidates.length ?? 0) > 0) {
    banners.push("jevOff");
  }
  // 无会话时问内容/比较的答案入口不可用（A18：检索仍可用）。
  if (!hasSession && state.current) {
    const intent = state.current.intent;
    if (intent === "answer" || intent === "compare") banners.push("modelUnavailable");
  }
  return banners;
}
