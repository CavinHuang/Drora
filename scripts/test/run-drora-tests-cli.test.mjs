// 回归：test:drora 入口分流（第 2 轮门禁修复）。drora 保留回归横跨两个执行域
// （vitest 显式清单 + node:test 保留集），入口脚本必须把精确命中 node 保留集的
// 文件改道 node --test、其余 filter 原样透传 vitest（含未知 filter 的诚实报错）。
// 锁定：分流规则（partitionDroraTestTargets）与端到端路由（真实执行一个
// node 保留集文件 + 一个 vitest 清单文件，断言两边都真跑且通过）。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { partitionDroraTestTargets, loadDroraVitestManifest } from "../run-drora-tests.mjs";

const exec = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const entry = fileURLToPath(new URL("../run-drora-tests.mjs", import.meta.url));

const manifest = loadDroraVitestManifest();
const nodeRetained = new Set([
  "packages/services/test/windowsCuaRuntime.node-test.mjs",
  "packages/services/test/server-remote.node-test.mjs",
  "packages/desktop/test/server-remote-host.node-test.mjs",
]);

test("分流：node 保留集精确路径改道 node --test，清单路径归一化，未知路径透传", () => {
  const partitioned = partitionDroraTestTargets(
    [
      "--update",
      "packages/services/test/windowsCuaRuntime.node-test.mjs",
      // 绝对路径形式的 node 保留集文件也要命中（门禁/IDE 可能传绝对路径）。
      resolve(repoRoot, "packages/services/test/server-remote.node-test.mjs"),
      "packages/shared/test/teamHistory.test.ts",
      "packages/services", // 目录 filter：vitest 语义，原样透传
      "packages/services/test/no-such-file.test.ts", // 未知文件：交给 vitest 诚实报错
    ],
    { manifest, nodeRetained, root: repoRoot },
  );
  assert.deepEqual(partitioned, {
    flags: ["--update"],
    vitestFilters: [
      "packages/shared/test/teamHistory.test.ts",
      "packages/services",
      "packages/services/test/no-such-file.test.ts",
    ],
    nodeFiles: [
      "packages/services/test/windowsCuaRuntime.node-test.mjs",
      "packages/services/test/server-remote.node-test.mjs",
    ],
  });
});

test("分流：全部为 node 保留集文件时不产生 vitest filter（避免必然的 No test files found）", () => {
  const partitioned = partitionDroraTestTargets(
    ["packages/desktop/test/server-remote-host.node-test.mjs"],
    { manifest, nodeRetained, root: repoRoot },
  );
  assert.deepEqual(partitioned.vitestFilters, []);
  assert.deepEqual(partitioned.nodeFiles, [
    "packages/desktop/test/server-remote-host.node-test.mjs",
  ]);
});

test("端到端：vitest 清单文件与 node 保留集文件混合入参两边都真实执行且通过", async () => {
  // teamHistory.test.ts 在 drora 显式清单内（vitest 面）；startPlanCaptchaHeaders
  // 属 node:test 保留集（node 面）。任一侧路由失败或测试失败都会非零退出。
  const { stdout, stderr } = await exec(
    process.execPath,
    [
      entry,
      "packages/shared/test/teamHistory.test.ts",
      "packages/services/test/startPlanCaptchaHeaders.node-test.mjs",
    ],
    { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
  );
  const output = stdout + stderr;
  assert.match(output, /teamHistory/, "vitest 面应执行清单文件");
  assert.match(output, /ℹ tests/, "node --test 面应执行 node 保留集文件");
});
