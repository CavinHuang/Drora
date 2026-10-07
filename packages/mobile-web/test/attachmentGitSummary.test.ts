import assert from "node:assert/strict";
import test from "node:test";
import type { GitFileChange, GitRepositorySummary } from "@drora/shared";
import { AttachmentGitSummaryGate } from "../src/app/attachmentGitSummary.js";

const SUMMARY: GitRepositorySummary = {
  workspacePath: "C:/repo",
  repoRoot: "C:/repo",
  workspaceInRepoPath: ".",
  autoRefreshWatchPaths: [],
  branchName: "main",
  trackingBranchName: null,
  headRefType: "branch",
  ahead: 0,
  behind: 0,
  isDirty: true,
  isGitAvailable: true,
  isRepository: true,
};

const CHANGE: GitFileChange = {
  path: "C:/repo/a.ts",
  repoRelativePath: "a.ts",
  workspaceRelativePath: "a.ts",
  kind: "modified",
  section: "unstaged",
  added: 12,
  removed: 3,
  isStaged: false,
  isUntracked: false,
  isConflicted: false,
};

const REFRESH = {
  summary: SUMMARY,
  identity: null,
  unstagedChanges: [CHANGE],
  stagedChanges: [{ ...CHANGE, section: "staged" as const, isStaged: true }],
  branchComparison: null,
};

test("Git 同帧快照经当前 attachment 读取，并按唯一文件计数", async () => {
  const paths: string[] = [];
  const gate = new AttachmentGitSummaryGate();
  const result = await gate.read({
    workspacePath: "C:/repo",
    workspaceIdentity: " remote-device:C:/repo ",
    gitService: {
      refresh: async ({ workspacePath }) => {
        paths.push(workspacePath);
        return REFRESH;
      },
    },
  });
  assert.deepEqual(paths, ["C:/repo"]);
  assert.equal(result?.key, "remote-device:C:/repo");
  assert.equal(result?.summary?.isDirty, true);
  assert.equal(result?.dirtyFileCount, 1);
  assert.deepEqual(result?.changeSummary, { added: 24, removed: 6 });
});

test("桥换代或目标切换后，旧 Git 摘要与旧失败都不能覆盖新目标", async () => {
  let releaseOld!: (result: typeof REFRESH) => void;
  const gate = new AttachmentGitSummaryGate();
  const old = gate.read({
    workspacePath: "C:/repo",
    workspaceIdentity: "host-A:C:/repo",
    gitService: {
      refresh: () =>
        new Promise<typeof REFRESH>((resolve) => {
          releaseOld = resolve;
        }),
    },
  });
  const current = gate.read({
    workspacePath: "C:/repo",
    workspaceIdentity: "host-B:C:/repo",
    gitService: { refresh: async () => REFRESH },
  });
  assert.equal((await current)?.key, "host-B:C:/repo");
  releaseOld(REFRESH);
  assert.equal(await old, null);

  const disconnected = gate.read({
    workspacePath: "C:/repo",
    gitService: {
      refresh: async () => {
        throw new Error("bridge closed");
      },
    },
  });
  assert.deepEqual(await disconnected, {
    key: "C:/repo",
    summary: null,
    dirtyFileCount: 0,
    changeSummary: null,
  });
  gate.invalidate();
});
