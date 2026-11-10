// R2 占位 e2e（specs/cua-gap-remediation-2026-11-09.md 决策点 D1=选项 A + R1.2 验证
// ①② 绑定；R10 认证模型换代后 token 语义全面退役）：pre-launch 占位后，agent 进程内
// 的 0.6.5 冻结切段找到**我方** Helper、同机官方 ZCode 不被命中。
//
// 场景（模拟无托管 host 的懒启动分支）：
//   1. 我方 services 侧免 token 直发 Helper 占住桥接 socket（buildStandalone
//      CuaHelperLaunchArgs + /usr/bin/open；adhoc 分发态 env——打包链 LSEnvironment
//      同款 DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1，构建器自动附带双逃生旗）。Helper 用
//      随包 staging 构建份（dist-cua-helper，drora-adhoc-profile：CUA_HELPER_ALLOW_
//      UNSIGNED_LAUNCHER 折叠 + broker IPC v3）。
//   2. 占位 socket 上的鉴权真值（R10 peer 身份模型）：authenticate=身份声明即过；
//      token 参数被官方语义忽略。
//   3. 驱动冻结切段（只读引用，esbuild 现场转 ESM，同 lazy-discovery-bridge.mjs 手法）
//      打同一 socket：取证结论的行为锚——socket 已存活时切段直连复用、绝不自己拉起
//      （:38652-38687/:44897），authenticate（{clientApiVersion:3}+身份）在 R10 peer
//      模型下直连成功（旧「token 校验 fail-closed」文案必须绝迹）。切段工具层把
//      broker 错误包成软错误结果（isError:true + content 文案，:40517/:40528），
//      execute 仍 resolve——断言落在结果形态上，不落在 rejection 上。
//   4. 负测：假官方根（~/.zcode/computer-use/"ZCode Computer Use.app" 替身）不被
//      open——切段懒启动链全程未触发（当日 exit.log 缺席），且占位 Helper 不受切段
//      握手扰动（仍存活、无第二实例，flock 单实例语义）。
// 运行：node --import tsx --test packages/services/test/cuaLazyPreLaunchOccupation.node-test.mjs
// （仅 macOS；CI 缺 dist-cua-helper staging 时自动跳过，同 lazy-discovery-bridge 先例）。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { connect } from "node:net";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

import { buildStandaloneCuaHelperLaunchArgs } from "../src/node.ts";

const repoRoot = join(import.meta.dirname, "../..");
// 随包 staging 构建份（本机 dev 构建产物；CI 干净环境缺席时整文件跳过）。
const stagedHelperApp = join(
  repoRoot,
  "zcode-cua-helper/dist-cua-helper/Drora Computer Use.app",
);
const openAsync = promisify(execFile);

const PRODUCTION_ENV = {
  NODE_ENV: "production",
  ZCODE_RUNTIME_ENV: "production",
};

const runIfDarwinStaged =
  process.platform === "darwin" && existsSync(join(stagedHelperApp, "Contents/Info.plist"))
    ? test
    : test.skip;

function createConnectionSafe(socketPath) {
  try {
    return connect(socketPath);
  } catch {
    return null;
  }
}

async function pingSocket(socketPath, timeoutMs = 800) {
  return await new Promise((resolve) => {
    const socket = createConnectionSafe(socketPath);
    if (!socket) return resolve(false);
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on("connect", () => {
      socket.write(`{"id":0,"method":"ping","params":{}}\n`);
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        if (buffer.includes("\n")) {
          clearTimeout(timer);
          try {
            const reply = JSON.parse(buffer.slice(0, buffer.indexOf("\n")));
            finish(reply.ok === true);
          } catch {
            finish(false);
          }
        }
      });
    });
    socket.on("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

async function exchange(socketPath, requests, timeoutMs = 5000) {
  return await new Promise((resolve, reject) => {
    const socket = createConnectionSafe(socketPath);
    if (!socket) return reject(new Error("socket unavailable"));
    const out = [];
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("exchange timeout"));
    }, timeoutMs);
    socket.on("error", (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
    socket.on("connect", () => {
      for (const request of requests) socket.write(JSON.stringify(request) + "\n");
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        out.push(JSON.parse(line));
        if (out.length >= requests.length) {
          clearTimeout(timer);
          socket.destroy();
          resolve(out);
        }
      }
    });
  });
}

async function waitForPing(socketPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingSocket(socketPath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function killHelperOnSocket(socketPath) {
  await new Promise((resolve) => {
    const child = execFile("/usr/bin/pkill", ["-9", "-f", socketPath], () => resolve());
    child.on("error", () => resolve());
  });
}

function helperProcessCount(socketPath) {
  return new Promise((resolve) => {
    const child = execFile("/usr/bin/pgrep", ["-fl", socketPath], (error, stdout) => {
      if (error) return resolve(0);
      resolve(stdout.split("\n").filter((line) => line.trim().length > 0).length);
    });
    child.on("error", () => resolve(0));
  });
}

// 切段 import：冻结资产只读引用（0.6.5 CJS bundle 与包 "type":"module" 冲突）。
// 与运行链（node-repl-host build.mjs drora-cua-upstream-alias）同款手法现场转 ESM；
// 产物落 zcode-cua/node_modules/.cache（external 依赖沿该位置 node_modules 解析，
// 与 R1 lazy-discovery-bridge.mjs 完全同语义），不触碰源码树与冻结资产。
const segmentUrl = await (async () => {
  const { build } = await import("esbuild");
  const outdir = join(
    repoRoot,
    "zcode-cua/node_modules/.cache/lazy-prelaunch-occupation",
  );
  const outfile = join(outdir, "segment.mjs");
  await build({
    entryPoints: [join(repoRoot, "zcode-cua/upstream/zcode-cua-0.6.5.index.js")],
    outfile,
    format: "esm",
    platform: "node",
    bundle: true,
    external: ["express", "zod"],
    banner: {
      js: `import { createRequire as __r2OccCreateRequire } from "node:module"; const require = __r2OccCreateRequire(import.meta.url);`,
    },
    logLevel: "silent",
  });
  return new URL(`file://${outfile}`);
})();
const { createComputerUseRuntime } = await import(segmentUrl.href);

// 驱动一次切段工具调用：socket 已存活时切段逐调用直连（取证①）。工具层把 broker
// 错误包成 isError 软错误结果（execute resolve），返回序列化结果供文案断言。
async function driveSegment(env, socketPath, budgetMs) {
  const runtime = createComputerUseRuntime({ env, brokerSocketPath: socketPath });
  const attempt = runtime
    .execute({
      toolName: "get_app_state",
      arguments: { app_ref: { bundle_id: "com.apple.dock" } },
      context: { sessionId: "r2-prelaunch-e2e" },
    })
    .then(
      (value) => `settled: ${JSON.stringify(value)}`,
      (error) => `rejected: ${error instanceof Error ? error.message : String(error)}`,
    );
  const timer = new Promise((resolve) => setTimeout(() => resolve("budget"), budgetMs));
  const outcome = await Promise.race([attempt, timer]);
  await runtime.dispose().catch(() => {});
  return outcome;
}

runIfDarwinStaged("R2 占位 e2e：token 链占住 socket → 切段直连我方 Helper，官方根不被命中", async () => {
  // —— 布局：假 HOME + 官方名替身（同机官方 ZCode 在场负测 decoy）——
  const home = mkdtempSync(join(tmpdir(), "r2-prelaunch-"));
  const officialInstallRoot = join(home, ".zcode", "computer-use");
  mkdirSync(officialInstallRoot, { recursive: true });
  symlinkSync(stagedHelperApp, join(officialInstallRoot, "ZCode Computer Use.app"));
  // 切段 launchHelperApp 的 exit-log 落点 helperExitLogPathFor 读宿主 process.env
  // （不是传入 env）——观察期把测试进程 HOME 指向假根（R1 对照组同款手法）。
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const lazyExitLog = join(
    officialInstallRoot,
    "logs",
    `zcode-cua-helper-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.jsonl`,
  );

  const socketPath = join(home, "bridge.sock");
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    // ① 我方 pre-launch（R10 后免 token 直发）占住桥接 socket。adhoc 分发 env 使
    //    构建器自动附带双逃生旗（allow-unsigned/allow-external）——同 uid 未签名
    //    对端（切段/node 测试进程）按官方 dev 语义经 verifyPeer 的 same-uid 逃生接入。
    const args = buildStandaloneCuaHelperLaunchArgs({
      appPath: stagedHelperApp,
      socketPath,
      env: { ...PRODUCTION_ENV, DRORA_CUA_HELPER_ADHOC_DISTRIBUTION: "1" },
      launcherPid: process.pid,
      ghostCursorOverlay: true,
    });
    await openAsync("/usr/bin/open", args, { timeout: 5000 });
    const occupied = await waitForPing(socketPath, 20000);
    assert.ok(occupied, "pre-launch 后 Helper 必须占住桥接 socket（ping 可达）");

    // ② 占位 socket 上的鉴权真值（R10 认证模型）：authenticate=身份声明即可通过；
    //    token 参数被官方语义忽略（带伪 token 仍 ok——官方 0.6.5 无 token 比对）。
    const replies = await exchange(socketPath, [
      { id: 1, method: "authenticate", params: { client_type: "zcode_cua_mcp" } },
    ]);
    assert.equal(replies[0]?.ok, true, "身份声明 authenticate 必须通过");
    const bogusReplies = await exchange(socketPath, [
      { id: 1, method: "authenticate", params: { client_type: "zcode_cua_mcp", token: "bogus-ignored" } },
    ]);
    assert.equal(bogusReplies[0]?.ok, true, "token 参数按官方语义被忽略（仍 ok）");

    // ③ 驱动冻结切段打同一 socket（R1.2 桥接键齐备）：R10 语义翻转——切段
    //    authenticate（{clientApiVersion:3}+身份）在 peer 身份模型下**直连成功**，
    //    不再有旧 token 校验的 fail-closed。断言落在「无 token 拒绝文案 + 软结果
    //    形态」上（get_app_state 真值取决于本机 TCC 授权，settled/isError 皆合法）。
    const outcome = await driveSegment(
      {
        HOME: home,
        ...PRODUCTION_ENV,
        // R1.2 桥接键（若切段仍触发自身懒启动，bundled 分支会优先命中我方 Helper）。
        ZCODE_CUA_BUNDLED_HELPER_APP_PATH: stagedHelperApp,
        ZCODE_CUA_HELPER_INSTALL_VARIANT: "stable",
      },
      socketPath,
      15000,
    );
    assert.doesNotMatch(
      String(outcome),
      /invalid or missing broker auth token/,
      `R10 后不得再出现 token 校验拒绝文案（got: ${String(outcome).slice(0, 300)}）`,
    );
    assert.match(
      String(outcome),
      /"isError"\s*:\s*true|settled:/,
      "切段直连结果必须落成软结果形态（isError 或 settled，切段 :40517/:40528）",
    );

    // ④ 负测：切段懒启动链全程未触发——假官方根无当日 exit.log；占位 Helper 仍存活
    //    且无第二实例（flock 单实例语义下 open 只会 activate 既有实例）。
    assert.equal(
      existsSync(lazyExitLog),
      false,
      "切段懒启动不得触发（官方根当日 exit.log 缺席 = 无 open 拉起）",
    );
    assert.ok(await pingSocket(socketPath), "占位 Helper 在切段尝试后必须仍存活");
    assert.equal(
      await helperProcessCount(socketPath),
      1,
      "桥接 socket 上必须只有占位 Helper 一个实例（切段未拉起第二个）",
    );
  } finally {
    process.env.HOME = previousHome;
    await killHelperOnSocket(socketPath);
    rmSync(home, { recursive: true, force: true });
  }
});
