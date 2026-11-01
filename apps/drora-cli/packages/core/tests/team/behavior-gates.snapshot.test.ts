import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

/**
 * PR-0.3：subagent_child 行为门零改动回归的冻结清单（specs/agents-team.md §9）。
 *
 * 口径：非测试源码中 `(=== | !==) "subagent_child"` 严格相等判定，共 17 处（2026-11-01 S3 再清点）
 * （2026-10-16 实测 22 处：core/bootstrap 19 + services sessionKind 3；
 * 2026-10-20 S2 v3.16.1 上游合并 +1：server-operations.ts 会话归属守卫；
 * 2026-10-31 S2 v3.17.1：server-operations/v4-bridge 字面量门收敛进 shared
 * isReadonlyAgentSessionKind，24→21；2026-11-01 S3 v3.17.1（821b68f5）：services 侧
 * 4 处（droraTaskIndexSyncer/droraTaskServiceAdapter/droraAgentService/
 * repairSubagentTaskIndex）收敛进 shared isAuxiliarySessionKind（subagent_child 在其
 * 集合内，任务索引排除/归属守卫的继承语义不变），21→17（13→10 文件），依据见 §9 注）。
 *
 * 继承原则（spec §9）：teammate 复用 taskType="subagent_child"，本清单全部门按现状
 * 命中——上游新增任何 subagent_child 门时本测试会失败，强制人工复核该门对 teammate
 * 的继承效果并更新冻结清单；这是有意的失败模式（spec §11 v2：可见失败优于静默漂移）。
 */

/** repo 根（本文件位于 <root>/apps/drora-cli/packages/core/tests/team/）。 */
const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));

const GREP_ROOTS = [
  "apps/drora-cli/packages/core/src",
  "apps/drora-cli/packages/bootstrap/src",
  "packages/services/src",
];

/** 文件 → 冻结门数；行号不冻结（上游无关改动会平移），文件集与每文件计数冻结。 */
const FROZEN_GATES: Readonly<Record<string, number>> = {
  "apps/drora-cli/packages/core/src/runtime/helpers/runtime-tools.ts": 6,
  "apps/drora-cli/packages/core/src/runtime/methods/background-notifications.ts": 2,
  "apps/drora-cli/packages/core/src/runtime/methods/model-request-session-type.ts": 1,
  "apps/drora-cli/packages/core/src/runtime/methods/turn-model-step-usage.ts": 1,
  "apps/drora-cli/packages/core/src/runtime/methods/background.ts": 1,
  "apps/drora-cli/packages/core/src/runtime/helpers/tool-allowlist.ts": 1,
  "apps/drora-cli/packages/core/src/telemetry/runtime-telemetry.ts": 1,
  // 2026-10-31 S2 v3.17.1 再冻结：上游把 server-operations/v4-bridge 的字面量门
  // 收敛进 shared 的 isReadonlyAgentSessionKind（packages/shared/src/drora-protocol-
  // legacy-types.ts，subagent_child 在其 readonly 集合内，继承语义不变；shared 不在
  // GREP_ROOTS 内）。server-operations 3→1、v4-bridge 1→0，census 24→21（15→13 文件）。
  "apps/drora-cli/packages/bootstrap/src/drora-protocol/server-operations.ts": 1,
  "apps/drora-cli/packages/bootstrap/src/drora-protocol/subagent-session-query.ts": 1,
  "apps/drora-cli/packages/bootstrap/src/app/subagent-observation.ts": 2,
  // 2026-11-01 S3 v3.17.1（821b68f5）再冻结：services 侧 4 处字面量门（droraTaskIndexSyncer
  // 任务索引排除、droraTaskServiceAdapter meta 直返、droraAgentService 会话归属守卫、
  // repairSubagentTaskIndex 索引修复）收敛进 shared isAuxiliarySessionKind——subagent_child
  // 在其集合内（isReadonlyAgentSessionKind ∪ selection_side_chat），teammate 继承语义
  // 不变；shared 不在 GREP_ROOTS 内，属形状迁移而非门移除。census 21→17（13→10 文件）。
};

const TOTAL_FROZEN_GATES = Object.values(FROZEN_GATES).reduce(
  (sum, count) => sum + count,
  0,
);

/** 各文件门的继承效果速查（specs/agents-team.md §9 表；teammate 自动获得）。 */
export const GATE_INHERITANCE_NOTES: Readonly<Record<string, string>> = {
  "apps/drora-cli/packages/core/src/runtime/helpers/runtime-tools.ts":
    "RespondToCoordinator 注册门 / automation、offPeak 不注册 / 后台 bash 上限 / runtimeScope=subagent / isSubagentChildRuntime 标记",
  "apps/drora-cli/packages/core/src/runtime/helpers/tool-allowlist.ts":
    "RespondToCoordinator 经 allowlist 补回",
  "apps/drora-cli/packages/bootstrap/src/drora-protocol/v4-bridge.ts":
    "subagent 只读守卫（guard.subagentReadOnly）覆盖 teammate",
  "apps/drora-cli/packages/bootstrap/src/drora-protocol/subagent-session-query.ts":
    "子会话下钻/查询包含 teammate",
  "apps/drora-cli/packages/bootstrap/src/drora-protocol/server-operations.ts":
    "子会话下钻/查询包含 teammate；S2 v3.16.1 新增会话归属守卫（仅精确 ID 查询凭持久化父链证明归属，teammate 同样适用）",
  "packages/services/src/drora-agent/droraTaskIndexSyncer.ts":
    "任务索引排除 teammate（不出现在任务列表）",
};

interface GateLine {
  path: string;
  line: number;
}

async function collectCurrentGates(): Promise<GateLine[]> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "grep",
      "-n",
      "-E",
      `(===|!==) *"subagent_child"`,
      "--",
      ...GREP_ROOTS,
    ],
    { cwd: REPO_ROOT, maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout
    .split(/\r?\n/)
    .filter((row) => row.trim() !== "")
    .filter((row) => !/\/dist\/|node_modules|__tests__|\.test\.|\.spec\./.test(row))
    .map((row) => {
      const [path, line] = row.split(":");
      return { path: path ?? "", line: Number(line ?? 0) };
    })
    .filter((gate): gate is GateLine => gate.path !== "" && Number.isFinite(gate.line));
}

function groupByPath(gates: readonly GateLine[]): Map<string, number> {
  const grouped = new Map<string, number>();
  for (const gate of gates) {
    grouped.set(gate.path, (grouped.get(gate.path) ?? 0) + 1);
  }
  return grouped;
}

describe("subagent_child behavior gates frozen census", () => {
  it("keeps the 17-gate census exactly as frozen in specs/agents-team.md §9", async () => {
    const current = groupByPath(await collectCurrentGates());

    const missing = Object.keys(FROZEN_GATES).filter((path) => !current.has(path));
    const added = [...current.keys()].filter((path) => FROZEN_GATES[path] === undefined);
    const drifted = [...current.keys()]
      .filter((path) => FROZEN_GATES[path] !== undefined && FROZEN_GATES[path] !== current.get(path))
      .map((path) => `${path}: frozen=${String(FROZEN_GATES[path])} current=${String(current.get(path))}`);

    expect(
      { missing, added, drifted, total: TOTAL_FROZEN_GATES },
      `subagent_child 行为门清点漂移：上游可能新增/修改了 subagent_child 门。
缺失文件（门被移除？）: ${JSON.stringify(missing)}
新增文件（新门——按 spec §9 继承原则确认 teammate 自动继承后，把文件与计数加入 FROZEN_GATES）: ${JSON.stringify(added)}
计数漂移: ${JSON.stringify(drifted)}`,
    ).toEqual({ missing: [], added: [], drifted: [], total: 17 });
  });

  it("notes cover the load-bearing gates referenced by the design", () => {
    for (const path of [
      "apps/drora-cli/packages/core/src/runtime/helpers/runtime-tools.ts",
      "apps/drora-cli/packages/bootstrap/src/drora-protocol/v4-bridge.ts",
      "packages/services/src/drora-agent/droraTaskIndexSyncer.ts",
    ]) {
      expect(GATE_INHERITANCE_NOTES[path]).toBeTruthy();
    }
  });
});
