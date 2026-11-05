/**
 * GitHub Source（03 详设 §4）：单仓库 comments 轮询——点名=评论正文整词 @mentionName
 * 且评论者经 login ↔ identity 映射；ETag If-None-Match 304 省额 + comments id 单调
 * 游标双防重（kv 记游标，Router 轮转簿记同口径）；每 60s 一轮（schedule 注入可测）。
 *
 * **裁剪（03 §4 落地注记）**：`/issues` 增量窗与 CI 结论暂缓——详设未定义其触发规则
 * （点名单指评论正文），CI 结论消费方是 P4 watchdog；不预设产品规则、不实现无消费方的
 * 轮询面。
 *
 * 凭证纪律：PAT 经注入的 loadCredential 读取（contracts ASSISTANT_CREDENTIAL_KEYS 单
 * 出处）；不落 kv、不进日志；缺失→本轮跳过并 warn 一次（诚实不连通，不伪造）。
 *
 * 回复（03 §4）：工单终态→issue 评论，正文附 Co-authored-by 大副署名行；POST 失败
 * 如实返回 ok:false（注册表 warn，不重试）。
 *
 * 分层纪律：fetch/timer/凭证/kv 全部注入；网络 IO 走注入的 fetch（测试 fake）。
 */

import { ASSISTANT_CREDENTIAL_KEYS, ASSISTANT_SOURCE_KINDS } from "@drora/shared";
import { createServiceLogger } from "../../logger/serviceLogger.js";
import { matchesWholeWordMention } from "./channelRef.js";
import type {
  AssistantSourceReplyPort,
  MateSource,
  MateSourceEvent,
  MateSourceGithubConfig,
} from "./contract.js";
import type { SourceKvGet } from "./sourceConfig.js";

const logger = createServiceLogger("assistant-tickets");

/** kv 游标键（本 Source 簿记；键名单出处）。 */
export const GITHUB_KV_KEYS = {
  /** 已处理 comments 的最大 id（单调递增；重放防线）。 */
  commentsCursorId: "source_github_comments_cursor_id",
  /** comments 列表 ETag（If-None-Match 省额）。 */
  commentsEtag: "source_github_comments_etag",
} as const;

/** 轮询节奏（03 详设：每 60s 一轮；可注入收紧）。 */
export const GITHUB_POLL_INTERVAL_MS = 60_000;
/** 单轮拉取上界（有界消费；游标推进后自然收敛）。 */
const COMMENTS_PER_PAGE = 50;
/** 回复摘要截断（与注册表终态回复同口径）。 */
const REPLY_SUMMARY_MAX = 300;

export interface GitHubSourceDeps {
  /** kv 单键读（游标/ETag）。 */
  readonly kvGet: SourceKvGet;
  /** kv 写（游标推进；装配层 kvSet——照 Router 簿记口径，非事务簿记）。 */
  readonly kvSet: (key: string, value: string) => void;
  /** login → 本地 identity 映射解析（装配层注入）。 */
  readonly resolveIdentity: (login: string) => string;
  /** PAT 加载（credential service；不落 kv 不进日志）。 */
  readonly loadCredential: (key: string) => Promise<string | undefined>;
  /** HTTP 实现（node 全局 fetch 由装配层传入；测试 fake）。 */
  readonly fetchImpl: typeof fetch;
  /** 定时器（默认 setTimeout 链；测试注入手动驱动）。 */
  readonly schedule?: (ms: number, fn: () => void) => () => void;
  /** 轮询间隔（缺省 60s；测试可收紧）。 */
  readonly pollIntervalMs?: number;
  /** 时钟（缺省 Date.now；测试驱动）。 */
  readonly nowMs?: () => number;
}

export interface GitHubComment {
  readonly id: number;
  readonly body?: string;
  readonly created_at?: string;
  readonly issue_url?: string;
  readonly user?: { readonly login?: string } | null;
}

function defaultSchedule(ms: number, fn: () => void): () => void {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
}

/** issue_url → issue number（…/repos/{o}/{r}/issues/{n}；解析失败丢弃该评论）。 */
function issueNumberFromUrl(url: string): number | null {
  const match = /\/issues\/(\d+)$/u.exec(url);
  return match?.[1] ? Number(match[1]) : null;
}

/** owner/repo（"o/r"）→ API 路径段（非法配置返回 null，本轮跳过）。 */
function parseRepo(repo: string): { owner: string; name: string } | null {
  const split = repo.split("/");
  if (split.length !== 2 || !split[0] || !split[1]) return null;
  return { owner: split[0], name: split[1] };
}

export function createGitHubSource(deps: GitHubSourceDeps): MateSource & {
  /** 手动驱动一轮（测试/装配层诊断；运行态且配置合法才执行）。 */
  pollNow(): Promise<void>;
} {
  let emit: ((event: MateSourceEvent) => void) | null = null;
  let config: MateSourceGithubConfig | null = null;
  let cancelTimer: (() => void) | null = null;
  let polling = false;
  /** PAT 缺失 warn 幂等（每轮都 warn 会刷屏）。 */
  let credentialWarned = false;

  function scheduleNext(): void {
    if (!emit) return;
    cancelTimer = (deps.schedule ?? defaultSchedule)(
      deps.pollIntervalMs ?? GITHUB_POLL_INTERVAL_MS,
      () => {
        void pollNow().finally(() => scheduleNext());
      },
    );
  }

  /** comments 列表单端点请求（304 省额；ETag 写回 kv）。 */
  async function fetchComments(
    path: string,
    token: string,
  ): Promise<{ status: number; items: unknown[] }> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      // GitHub 要求 UA；固定产品标识，不带任何用户数据。
      "User-Agent": "drora-mate-source",
      Authorization: `Bearer ${token}`,
    };
    const cachedEtag = deps.kvGet(GITHUB_KV_KEYS.commentsEtag);
    if (cachedEtag) headers["If-None-Match"] = cachedEtag;
    const response = await deps.fetchImpl(`https://api.github.com${path}`, { headers });
    if (response.status === 304) return { status: 304, items: [] };
    const newEtag = response.headers.get("ETag");
    if (newEtag) deps.kvSet(GITHUB_KV_KEYS.commentsEtag, newEtag);
    if (!response.ok) {
      throw new Error(`GitHub API ${path} HTTP ${response.status}`);
    }
    const payload: unknown = await response.json();
    return { status: response.status, items: Array.isArray(payload) ? payload : [] };
  }

  async function pollNow(): Promise<void> {
    if (!emit || polling) return;
    const repo = config?.repo ? parseRepo(config.repo) : null;
    if (!repo) return;
    polling = true;
    try {
      const token = await deps.loadCredential(ASSISTANT_CREDENTIAL_KEYS.githubPat);
      if (!token) {
        if (!credentialWarned) {
          credentialWarned = true;
          logger.warn("GitHub Source PAT 缺失（credential service），轮询跳过——不伪造连通");
        }
        return;
      }
      credentialWarned = false;
      const mentionName = config?.mentionName?.trim() || "大副";
      const { items } = await fetchComments(
        `/repos/${repo.owner}/${repo.name}/issues/comments?sort=created&direction=desc&per_page=${COMMENTS_PER_PAGE}`,
        token,
      );
      if (items.length === 0) return;
      const cursorRaw = deps.kvGet(GITHUB_KV_KEYS.commentsCursorId);
      const cursor = cursorRaw ? Number(cursorRaw) : 0;
      let maxId = cursor;
      for (const item of items) {
        const comment = item as GitHubComment;
        const commentId = typeof comment.id === "number" ? comment.id : 0;
        if (commentId <= cursor) continue; // 游标内重放：跳过（ETag 失效/翻页重叠防线）
        if (commentId > maxId) maxId = commentId;
        const body = typeof comment.body === "string" ? comment.body : "";
        const issueNumber = comment.issue_url ? issueNumberFromUrl(comment.issue_url) : null;
        const login = comment.user?.login;
        const createdAt = comment.created_at ? Date.parse(comment.created_at) : NaN;
        if (!body.trim() || issueNumber === null || !login || !Number.isFinite(createdAt)) continue;
        // 点名（03 §4）：整词 @mentionName；identity=映射（未映射原样，gate 拒绝并记录）。
        if (!matchesWholeWordMention(body, mentionName)) continue;
        emit({
          kind: ASSISTANT_SOURCE_KINDS.github,
          identity: deps.resolveIdentity(login),
          text: body,
          mention: true,
          atMs: createdAt,
          channelRef: {
            kind: "github",
            owner: repo.owner,
            repo: repo.name,
            issueNumber,
          },
        });
      }
      if (maxId > cursor) deps.kvSet(GITHUB_KV_KEYS.commentsCursorId, String(maxId));
    } catch (error) {
      // 网络失败不中断轮询循环（下一轮自然重试——轮询是 Source 自身节奏，不是超时兜底）。
      logger.warn("GitHub Source 轮询失败（下一轮重试）", error);
    } finally {
      polling = false;
    }
  }

  return {
    kind: ASSISTANT_SOURCE_KINDS.github,
    isRunning: () => emit !== null,
    start(emitHandle, sourceConfig) {
      emit = emitHandle;
      config = sourceConfig.github ?? null;
      scheduleNext();
    },
    stop() {
      emit = null;
      config = null;
      cancelTimer?.();
      cancelTimer = null;
    },

    pollNow,
  };
}

/** GitHub 回复端口（03 §4：终态→issue 评论，Co-authored-by 大副署名；fetch 注入）。 */
export function createGitHubReplySender(deps: {
  loadCredential: (key: string) => Promise<string | undefined>;
  fetchImpl: typeof fetch;
  /** 注册表同源的 GitHub 配置读取（repo 缺失/不一致=诚实失败，不跨仓发送）。 */
  readConfig: () => MateSourceGithubConfig | null;
}): AssistantSourceReplyPort {
  return {
    async reply({ channelRef, summary }) {
      // channelRef 反解出 issue 定位（非 github 绑定不归本端口）。
      const match = /^github:([^/]+)\/([^#]+)#(\d+)$/u.exec(channelRef);
      const ownerRaw = match?.[1];
      const repoRaw = match?.[2];
      const numberRaw = match?.[3];
      if (!ownerRaw || !repoRaw || !numberRaw) {
        return { ok: false, reason: `非 GitHub 通道绑定：${channelRef.slice(0, 60)}` };
      }
      const owner = decodeURIComponent(ownerRaw);
      const repo = decodeURIComponent(repoRaw);
      const issueNumber = Number(numberRaw);
      const token = await deps.loadCredential(ASSISTANT_CREDENTIAL_KEYS.githubPat);
      if (!token) {
        return { ok: false, reason: "GitHub PAT 缺失（credential service），回复未发送" };
      }
      const configured = deps.readConfig();
      const parsed = configured?.repo ? parseRepo(configured.repo) : null;
      // 绑定仓库与当前配置仓库不一致（轮换/改配后残留终态）→ 不跨仓发送。
      if (!parsed || parsed.owner !== owner || parsed.name !== repo) {
        return { ok: false, reason: `GitHub 配置仓库与绑定不一致（${owner}/${repo}）` };
      }
      const body = `${summary.slice(0, REPLY_SUMMARY_MAX)}\n\nCo-authored-by: 大副 (Drora Mate) <mate@drora.local>`;
      try {
        const response = await deps.fetchImpl(
          `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
          {
            method: "POST",
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "drora-mate-source",
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ body }),
          },
        );
        if (!response.ok) {
          return { ok: false, reason: `GitHub 回复 HTTP ${response.status}` };
        }
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
