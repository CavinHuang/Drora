#!/usr/bin/env node
// 修复原因（第 2 轮门禁）：drora 保留回归有两个执行域——vitest 显式清单
// （scripts/drora-test-files.json；node:test 套件按 vitest.config.ts 头注释与
// generate-drora-test-files.mjs:70 的契约排除在清单外）与 node:test 保留集
// （.node-test.mjs 及导入 node:test 的 .test.ts，由 discoverNodeUnitTestFiles 发现，
// runner 是 node --import tsx --test）。此前 `pnpm test:drora <文件>` 把文件
// filter 无条件交给 `vitest run --project drora`：node:test 文件不在清单内，
// vitest 必然 "No test files found" 退出 1（第 1/2 轮门禁均此形态）。
// 本入口按文件归属分流：
// - 无 filter / 清单内文件 / 无法识别的 filter：行为与旧命令一致
//   （vitest run --project drora；未知 filter 仍由 vitest 如实报找不到文件）；
// - node:test 保留集文件（精确路径匹配）：改由 node --import tsx --test 执行
//   （与 test:unit:node 同一 runner 与并发参数），失败如实非零退出——测试真实
//   执行、真实判定，不是吞错或假绿。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { discoverNodeUnitTestFiles } from "./node-unit-test-files.mjs";

export function loadDroraVitestManifest() {
  return new Set(
    JSON.parse(readFileSync(new URL("drora-test-files.json", import.meta.url), "utf8")),
  );
}

/**
 * 按归属切分 CLI 参数。只有「精确路径命中 node 保留集」才改道 node --test；
 * 目录/子串 filter 与未知路径一律保持原 vitest 路由（含诚实报错），不吞任何 filter。
 * vitest 面与 node 面都为空（参数只有旗标）时按「无 filter 全量」处理。
 */
export function partitionDroraTestTargets(argv, { manifest, nodeRetained, root = process.cwd() }) {
  const flags = [];
  const vitestFilters = [];
  const nodeFiles = [];
  for (const arg of argv) {
    if (arg.startsWith("-")) {
      flags.push(arg);
      continue;
    }
    const absolute = resolve(root, arg);
    const normalized = relative(root, absolute).replaceAll("\\", "/");
    if (nodeRetained.has(normalized)) {
      nodeFiles.push(normalized);
      continue;
    }
    // 显式清单内的精确路径归一化为仓库相对路径；其余（目录/子串/未知）原样透传。
    vitestFilters.push(manifest.has(normalized) ? normalized : arg);
  }
  return { flags, vitestFilters, nodeFiles };
}

async function run(command, args) {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  return await new Promise((resolveExit, rejectSpawn) => {
    child.on("error", rejectSpawn);
    child.on("exit", (code, signal) => resolveExit(signal ? 1 : (code ?? 1)));
  });
}

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const { flags, vitestFilters, nodeFiles } = partitionDroraTestTargets(argv, {
    manifest: loadDroraVitestManifest(),
    nodeRetained: new Set(discoverNodeUnitTestFiles(root)),
    root,
  });
  // 仅当存在 vitest 面（显式 filter，或完全无 filter 的全量语义）才启动 vitest；
  // 参数只含 node 保留集文件时跳过 vitest，避免一次必然失败的 "No test files found"。
  const runVitest = vitestFilters.length > 0 || nodeFiles.length === 0;
  let exitCode = 0;
  if (runVitest) {
    exitCode = await run(process.execPath, [
      resolve(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "--project",
      "drora",
      ...flags,
      ...vitestFilters,
    ]);
  }
  if (nodeFiles.length > 0) {
    // 与 scripts/run-node-unit-tests.mjs 保持同一 runner 参数。
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--test", "--test-concurrency=2", ...nodeFiles],
      { stdio: "inherit", env: stripNodeTestContext(process.env) },
    );
    const nodeExit = await new Promise((resolveExit, rejectSpawn) => {
      child.on("error", rejectSpawn);
      child.on("exit", (code, signal) => resolveExit(signal ? 1 : (code ?? 1)));
    });
    exitCode ||= nodeExit;
  }
  return exitCode;
}

/**
 * node --test 进程内再 spawn `node --test` 时，父进程的 NODE_TEST_CONTEXT 标记会
 * 让子测试运行器误判「递归调用」而跳过执行（skipping running files）。剥离该标记
 * 只解除抑制，不改变任何测试判定；从普通进程（CI/门禁/手工）调用时无此变量、行为不变。
 */
function stripNodeTestContext(env) {
  const childEnv = { ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  return childEnv;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
