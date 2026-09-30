import { useCallback, useEffect, useRef, useState } from "react";
import type { GitRepositorySummary } from "@drora/shared";
import type { IGitService } from "@drora/services";

type GitSummaryService = Pick<IGitService, "refresh">;

interface GitChangeSummary {
  added: number;
  removed: number;
}

export interface AttachmentGitSummaryResult {
  key: string;
  summary: GitRepositorySummary | null;
  dirtyFileCount: number;
  changeSummary: GitChangeSummary | null;
}

/**
 * 手机桥已经绑定到唯一 Local Host；Git RPC 用真实路径读，身份键只用于隔离迟到结果。
 * 每次读取取代前一次，桥断开/目标切换时由调用方 invalidate。
 */
export class AttachmentGitSummaryGate {
  private generation = 0;

  invalidate(): void {
    this.generation += 1;
  }

  async read(input: {
    gitService: GitSummaryService;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<AttachmentGitSummaryResult | null> {
    const generation = ++this.generation;
    const key = input.workspaceIdentity?.trim() || input.workspacePath;
    try {
      // 官方 useGitRepository 使用一次 refresh 保证摘要与文件统计同帧；手机桥复用该契约。
      const snapshot = await input.gitService.refresh({
        workspacePath: input.workspacePath,
        includeIdentity: false,
        includeBranchComparison: false,
      });
      if (generation !== this.generation) return null;
      const changes = [...snapshot.unstagedChanges, ...snapshot.stagedChanges];
      return {
        key,
        summary: snapshot.summary,
        dirtyFileCount: new Set(changes.map((change) => change.repoRelativePath)).size,
        changeSummary: changes.reduce<GitChangeSummary>(
          (total, change) => ({
            added: total.added + change.added,
            removed: total.removed + change.removed,
          }),
          { added: 0, removed: 0 },
        ),
      };
    } catch {
      return generation === this.generation
        ? { key, summary: null, dirtyFileCount: 0, changeSummary: null }
        : null;
    }
  }
}

interface RenderedSummary extends AttachmentGitSummaryResult {
  gitService: GitSummaryService;
  activeTaskId: string | null;
}

/** Host 摘要的页面镜像；service/任务/identity 任一换代时旧值不参与渲染。 */
export function useAttachmentGitSummary(input: {
  gitService: GitSummaryService | null;
  workspacePath: string | null;
  workspaceIdentity?: string;
  activeTaskId: string | null;
}): {
  summary: GitRepositorySummary | null;
  dirtyFileCount: number;
  changeSummary: GitChangeSummary | null;
  refresh: () => void;
} {
  const gateRef = useRef<AttachmentGitSummaryGate | null>(null);
  if (!gateRef.current) gateRef.current = new AttachmentGitSummaryGate();
  const [rendered, setRendered] = useState<RenderedSummary | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { gitService, workspacePath, workspaceIdentity, activeTaskId } = input;
  const key = workspaceIdentity?.trim() || workspacePath;

  useEffect(() => {
    const gate = gateRef.current!;
    if (gitService && workspacePath && activeTaskId) {
      void gate.read({ gitService, workspacePath, workspaceIdentity }).then((result) => {
        if (result) setRendered({ ...result, gitService, activeTaskId });
      });
    }
    return () => gate.invalidate();
  }, [gitService, workspacePath, workspaceIdentity, activeTaskId, refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((nonce) => nonce + 1), []);
  const current =
    gitService !== null &&
    workspacePath !== null &&
    activeTaskId !== null &&
    rendered?.key === key &&
    rendered.gitService === gitService &&
    rendered.activeTaskId === activeTaskId
      ? rendered
      : null;
  return {
    summary: current?.summary ?? null,
    dirtyFileCount: current?.dirtyFileCount ?? 0,
    changeSummary: current?.changeSummary ?? null,
    refresh,
  };
}
