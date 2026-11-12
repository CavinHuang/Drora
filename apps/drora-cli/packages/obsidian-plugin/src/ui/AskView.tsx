/**
 * ask 视图（N1 Smart Lookup，specs/obsidian-vault-plugin-extraction.md §8、
 * obsidian-knowledge.md §5c）：检索即终点——不发起 QA run、不出现 answer/compare 的
 * agent 发起入口；候选带「定位」（跳 notes 原文）与「交给 Agent」（g9
 * openConversationHandoff 投递 composer，与旧面板 find 意图「加入 Agent」对应）。
 */
import type { Translate } from "./i18n.js";
import {
  deriveLookupBanners,
  formatHandoffText,
  type KnowledgeIndexStatus,
  type KnowledgeRunView,
} from "./model.js";
import { Banner, EmptyState } from "./parts.js";

export interface AskState {
  draft: string;
  phase: "idle" | "searching" | "done" | "failed";
  run: KnowledgeRunView | null;
  error: string | null;
  /** handoff 结果反馈（成功/失败一次性呈现）。 */
  handoffNote: { ok: boolean; message: string } | null;
}

export interface AskViewProps {
  t: Translate;
  state: AskState;
  indexStatus: KnowledgeIndexStatus | null;
  handoffSupported: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  onJump: (relativePath: string, startLine: number) => void;
  onHandoff: (run: KnowledgeRunView) => void;
}

export function AskView(props: AskViewProps) {
  const { t, state } = props;
  const banners = deriveLookupBanners({ run: state.run, indexStatus: props.indexStatus });
  return (
    <div className="vault-ask">
      <form
        className="vault-ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <input
          data-vault="ask-input"
          className="vault-ask-input"
          type="search"
          value={state.draft}
          placeholder={t("vault.ask.placeholder")}
          onChange={(event) => props.onDraftChange(event.target.value)}
        />
        <button type="submit" data-vault="ask-submit" className="vault-btn vault-btn-primary" disabled={state.phase === "searching"}>
          {state.phase === "searching" ? t("vault.ask.searching") : t("vault.ask.submit")}
        </button>
        {state.draft ? (
          <button type="button" className="vault-btn vault-btn-ghost" onClick={props.onClear}>
            {t("vault.ask.clear")}
          </button>
        ) : null}
      </form>

      {banners.length > 0 ? (
        <div className="vault-ask-banners">
          {banners.map((banner) => (
            <Banner
              key={banner}
              kind={banner === "failed" || banner === "sourceStale" ? "warn" : "info"}
            >
              {t(`vault.banner.${banner}`, {
                message: state.run?.reason ?? state.error ?? "",
              })}
            </Banner>
          ))}
        </div>
      ) : null}

      {state.handoffNote ? (
        <Banner kind={state.handoffNote.ok ? "info" : "danger"}>{state.handoffNote.message}</Banner>
      ) : null}

      {state.phase === "searching" ? (
        <div className="vault-state">{t("vault.ask.searching")}</div>
      ) : state.run === null ? (
        <EmptyState title={t("vault.ask.placeholder")} />
      ) : state.run.candidates.length === 0 ? (
        <EmptyState title={t("vault.banner.noAnswer")} />
      ) : (
        <div className="vault-ask-results">
          <div className="vault-ask-count">{t("vault.ask.results", { count: state.run.candidates.length })}</div>
          <ul className="vault-candidates">
            {state.run.candidates.map((candidate) => (
              <li key={candidate.articleId} className="vault-candidate">
                <div className="vault-candidate-head">
                  <span className="vault-candidate-rank">{t("vault.ask.rank", { rank: candidate.rank })}</span>
                  <span className="vault-candidate-title">{candidate.title}</span>
                  <span className="vault-candidate-chunks">
                    {t("vault.ask.matchedChunks", { count: candidate.matchedChunkCount })}
                  </span>
                </div>
                <button
                  type="button"
                  className="vault-candidate-path"
                  onClick={() =>
                    props.onJump(candidate.relativePath, candidate.quote.startLine)
                  }
                >
                  {candidate.relativePath}
                  {candidate.matchedHeading ? ` › ${candidate.matchedHeading}` : ""}
                  {` · L${candidate.quote.startLine}-L${candidate.quote.endLine}`}
                </button>
                <p className="vault-candidate-excerpt">{candidate.excerpt}</p>
                <div className="vault-candidate-actions">
                  <button
                    type="button"
                    className="vault-btn vault-btn-sm vault-btn-outline"
                    onClick={() =>
                      props.onJump(candidate.relativePath, candidate.quote.startLine)
                    }
                  >
                    {t("vault.ask.jump")}
                  </button>
                  {props.handoffSupported ? (
                    <button
                      type="button"
                      data-vault="ask-handoff"
                      className="vault-btn vault-btn-sm vault-btn-outline"
                      onClick={() => props.onHandoff(state.run!)}
                    >
                      {t("vault.ask.handoff")}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** handoff 载荷构造（main.tsx 调用）：全部候选一次投递（≤ MAX_KNOWLEDGE_HANDOFF_SOURCES 语义
 *  在面板侧取检索结果全集——N1 lookup 是只读检索，多选交互属旧 answer/compare 面，不重建）。 */
export function handoffSourcesOf(run: KnowledgeRunView): Array<{
  title: string;
  relativePath: string;
  heading: string | null;
  startLine: number;
  endLine: number;
  excerpt: string;
}> {
  return run.candidates.map((candidate) => ({
    title: candidate.title,
    relativePath: candidate.relativePath,
    heading: candidate.matchedHeading,
    startLine: candidate.quote.startLine,
    endLine: candidate.quote.endLine,
    excerpt: candidate.excerpt,
  }));
}

export { formatHandoffText };
