import type { RemoteWorkspaceSessionEntry } from "@drora/shared";

interface ServerConnectionHistorySuggestions {
  urls: string[];
  workspacePaths: string[];
}

function dedupeSuggestions(values: readonly string[]): string[] {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const normalizedValue = value.trim();
    if (!normalizedValue || seen.has(normalizedValue)) {
      return [];
    }

    seen.add(normalizedValue);
    return [normalizedValue];
  });
}

/** server 连接的 URL / 默认目录历史候选；与 SSH 建议同规则：最近优先、去重、跳过空值。 */
export function buildServerConnectionHistorySuggestions(
  remoteWorkspaceSessions: readonly RemoteWorkspaceSessionEntry[],
): ServerConnectionHistorySuggestions {
  // server 快照只持久化 url 与凭据键名；默认目录候选取历史 session 已打开过的
  // workspacePath（RemoteWorkspaceSessionSnapshot.workspacePath），不从快照推导。
  const serverEntries = remoteWorkspaceSessions.flatMap((entry) =>
    entry.target.kind === "server"
      ? [{ url: entry.target.url, workspacePath: entry.workspacePath }]
      : [],
  );

  return {
    urls: dedupeSuggestions(serverEntries.map((entry) => entry.url)),
    workspacePaths: dedupeSuggestions(serverEntries.map((entry) => entry.workspacePath)),
  };
}
