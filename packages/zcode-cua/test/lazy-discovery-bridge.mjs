#!/usr/bin/env node
// R1.2 发现链桥接 e2e（specs/cua-gap-remediation-2026-11-09.md 验证小节）。
// 用 0.6.5 冻结切段（upstream/zcode-cua-0.6.5.index.js，只引用不修改）经
// createComputerUseRuntime 的 ensureBrokerAvailable 钩子触发真实懒启动，做两组对照：
//   对照组（审查 H2 现状复现）：无桥接 env + 假 HOME 下 .zcode/computer-use/
//     "ZCode Computer Use.app"（symlink → 我方 Helper，替身模拟同机官方 ZCode 在场的
//     官方 Helper 根）→ 切段名字匹配候选命中 → open 拉起 → Helper token 门 exit(2)，
//     exit.log 落盘（错配路径的活证据）。
//   桥接组（R1.2 后）：同布局 + 注入 ZCODE_CUA_BUNDLED_HELPER_APP_PATH（伪 bundled app，
//     bundleId 对齐切段期望、buildId 故意失配）+ ZCODE_CUA_HELPER_INSTALL_VARIANT=stable
//     → 切段走 bundled 分支（安装校验 fail-loud 抛错，被 ensureBrokerForRetry 吞掉）
//     → 官方根候选不再被 open（无 exit.log）——负测②：同机官方 ZCode 在场不得被命中。
// 运行：node packages/zcode-cua/test/lazy-discovery-bridge.mjs（仅 macOS；CI 缺
// dist-cua-helper 时自动跳过，同 cuaHostInstallerBuildIdentity.node-test.mjs 先例）。
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const assert = (await import("node:assert")).strict;
const packageRoot = new URL("..", import.meta.url).pathname;
const stagedHelperApp = join(
  packageRoot,
  "../zcode-cua-helper/dist-cua-helper/Drora Computer Use.app",
);
const stagedAvailable = existsSync(join(stagedHelperApp, "Contents/Info.plist"));

if (process.platform !== "darwin") {
  console.log("SKIP lazy-discovery-bridge: non-darwin platform");
  process.exit(0);
}
if (!stagedAvailable) {
  console.log("SKIP lazy-discovery-bridge: dist-cua-helper staging absent (CI)");
  process.exit(0);
}

// 切段 import：冻结资产只读引用。切段本体是 CJS bundle，与包 "type":"module" 冲突，
// 运行链（node-repl-host build.mjs 的 drora-cua-upstream-alias 插件）用 esbuild 把
// @drora/drora-cua 整体替换为该切段后内联——本测试用同款手法现场转 ESM（产物落
// node_modules/.cache，不触碰源码树与冻结资产），external 依赖沿 node_modules 解析。
const segmentUrl = await (async () => {
  const { build } = await import("esbuild");
  const outdir = join(packageRoot, "node_modules/.cache/lazy-discovery-bridge");
  const outfile = join(outdir, "segment.mjs");
  await build({
    entryPoints: [join(packageRoot, "upstream/zcode-cua-0.6.5.index.js")],
    outfile,
    format: "esm",
    platform: "node",
    bundle: true,
    external: ["express", "zod"],
    // ESM 产物内切段保留 require("express") 形态，注入 createRequire shim（解析链沿
    // 产物位置的 node_modules 向上，与切段在运行链内联时的解析语义一致）。
    banner: {
      js: `import { createRequire as __lazyBridgeCreateRequire } from "node:module"; const require = __lazyBridgeCreateRequire(import.meta.url);`,
    },
    logLevel: "silent",
  });
  return new URL(`file://${outfile}`);
})();
const { createComputerUseRuntime } = await import(segmentUrl.href);

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};

// —— 布局工厂：假 HOME + 官方名 Helper（symlink 替身）——
function makeFakeHome(tag) {
  const home = mkdtempSync(join(tmpdir(), `r1-lazy-${tag}-`));
  const installRoot = join(home, ".zcode", "computer-use");
  mkdirSync(installRoot, { recursive: true });
  // 同机官方 ZCode 在场的替身：官方安装根 + 官方 app 名，目标实体是我方 Helper
  // （e2e 只断言“是否被 open”，替身指向谁不影响该断言语义）。
  symlinkSync(stagedHelperApp, join(installRoot, "ZCode Computer Use.app"));
  return { home, installRoot };
}

function exitLogPathFor(installRoot) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return join(
    installRoot,
    "logs",
    `zcode-cua-helper-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.jsonl`,
  );
}

// 伪 bundled app：bundleId 对齐切段期望（进入 buildId 校验层），buildId 故意失配
// （切段 embedded 期望 pipeline-*，伪 app 为 drora-* → verification_failed 抛错，
// 模拟我方 Helper 在切段安装校验下的真实结局；无需 124MB 实体，也不 promote 安装）。
function makeFakeBundledApp(parent) {
  const app = join(parent, "FakeBundled.app");
  mkdirSync(join(app, "Contents"), { recursive: true });
  writeFileSync(
    join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>dev.zcode.cua-helper</string>
  <key>CFBundleExecutable</key><string>Drora Computer Use</string>
  <key>CFBundleShortVersionString</key><string>3.17.2</string>
  <key>ZCodeCUAHelperBuildId</key><string>drora-e2e-fake</string>
</dict></plist>`,
  );
  return app;
}

// 触发一次工具调用：broker 连不上 → 切段 ensureBrokerAvailable 懒启动被调。
// 重试环长于观察窗，race 后 dispose 即可——副作用（open / 安装尝试）首达即发生。
async function driveLazyLaunch(env, socketPath, budgetMs) {
  const runtime = createComputerUseRuntime({ env, brokerSocketPath: socketPath });
  const attempt = runtime
    .execute({
      toolName: "get_app_state",
      arguments: { app_ref: { bundle_id: "com.apple.dock" } },
      context: { sessionId: "r1-lazy-e2e" },
    })
    .then(
      () => "settled",
      (error) => `rejected: ${error instanceof Error ? error.message : String(error)}`,
    );
  const timer = new Promise((resolve) => setTimeout(() => resolve("budget"), budgetMs));
  const outcome = await Promise.race([attempt, timer]);
  await runtime.dispose().catch(() => {});
  return outcome;
}

function helperRunningWithSocket(socketPath) {
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/pgrep", ["-fl", socketPath]);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", () => resolve(out.trim().length > 0));
    child.on("error", () => resolve(false));
  });
}

// R10 认证模型换代后的可达性探针：未签名测试进程连上被错配拉起的 Helper，
// verifyPeer 的 team 签名门应销毁连接（authenticate/broker_info 无法完整往返）。
// 反例（可达）= 两行完整 JSON 回复都拿到。
function unsignedPeerBrokerClaimReachable(socketPath) {
  return new Promise((resolve) => {
    const sock = connect(socketPath);
    let buf = "";
    let replies = 0;
    const done = (value) => {
      try { sock.destroy(); } catch {}
      resolve(value);
    };
    sock.on("error", () => done(false));
    sock.on("close", () => done(replies >= 2));
    sock.on("connect", () => {
      sock.write(JSON.stringify({ id: 1, method: "authenticate", params: { client_type: "zcode_cua_mcp" } }) + "\n");
      sock.write(JSON.stringify({ id: 2, method: "broker_info", params: {} }) + "\n");
    });
    sock.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        buf = buf.slice(i + 1);
        replies += 1;
        if (replies >= 2) done(true);
      }
    });
    setTimeout(() => done(replies >= 2), 4000);
  });
}

async function waitFor(condition, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return condition();
}

// —— 对照组：无桥接（审查 H2 现状复现：官方根候选被 open）——
// 注意：切段 launchHelperApp 的 exit-log 落点 helperExitLogPathFor 读的是**宿主**
// process.env（不是传入 env），因此观察期间把测试进程 HOME 指向 fake home，使
// exit.log 落点可控（否则写到真实 ~/.zcode，污染本机且断言不可靠）。
{
  const { home, installRoot } = makeFakeHome("ctl");
  const socketPath = join(home, "ctl.sock");
  const exitLog = exitLogPathFor(installRoot);
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const outcome = await driveLazyLaunch(
      { HOME: home, ZCODE_RUNTIME_ENV: "production", NODE_ENV: "production" },
      socketPath,
      9000,
    );
    const launched = await waitFor(() => existsSync(exitLog), 6000, "ctl exit.log");
    check(
      "对照组（无桥接）：切段名字匹配候选命中假官方根 → Helper 被拉起（exit.log 落盘）",
      launched,
      `outcome=${outcome}`,
    );
    if (launched) {
      const log = readFileSync(exitLog, "utf8");
      check(
        "对照组：被拉起 Helper 走官方门序（R10 token 门退役，无 token 强制门文案）",
        !log.includes("launcher-minted --token-file"),
      );
    }
    check(
      "对照组：错配 Helper 对未签名对端不可达（R10 peer/launcher 门二择守卫，无认领）",
      !(await unsignedPeerBrokerClaimReachable(socketPath)),
    );
  } finally {
    process.env.HOME = previousHome;
    await new Promise((resolve) =>
      spawn("/usr/bin/pkill", ["-f", socketPath]).on("close", () => resolve()),
    );
    rmSync(home, { recursive: true, force: true });
  }
}

// —— 桥接组：R1.2 注入后（bundled 分支接管，官方根候选不再被 open）——
{
  const { home, installRoot } = makeFakeHome("bridge");
  const socketPath = join(home, "bridge.sock");
  const exitLog = exitLogPathFor(installRoot);
  const fakeBundled = makeFakeBundledApp(home);
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const outcome = await driveLazyLaunch(
      {
        HOME: home,
        ZCODE_RUNTIME_ENV: "production",
        NODE_ENV: "production",
        // R1.2 桥接键（注入侧由 services buildZcodeCuaLazyLaunchBridgeEnv 产出，
        // 值语义见 packages/services/test/cuaLazyLaunchBridge.node-test.mjs）。
        ZCODE_CUA_BUNDLED_HELPER_APP_PATH: fakeBundled,
        ZCODE_CUA_HELPER_INSTALL_VARIANT: "stable",
      },
      socketPath,
      12000,
    );
    // 给切段 bundled 分支（stage + 安装校验 + 抛错被吞）留出完成窗口后断言负测②。
    await new Promise((resolve) => setTimeout(resolve, 3000));
    check(
      "桥接组（R1.2）：官方根候选未被 open（当日 exit.log 缺席——bundled 分支优先级覆盖）",
      !existsSync(exitLog),
      `outcome=${outcome}`,
    );
    check(
      "桥接组：无 Helper 进程驻留（安装校验 fail-loud，无 launch）",
      !(await helperRunningWithSocket(socketPath)),
    );
    check(
      "桥接组：伪 bundled 未被 promote 成安装（官方名 symlink 仍指向原替身，安装根未被覆盖）",
      existsSync(join(installRoot, "ZCode Computer Use.app")),
    );
  } finally {
    process.env.HOME = previousHome;
    await new Promise((resolve) =>
      spawn("/usr/bin/pkill", ["-f", socketPath]).on("close", () => resolve()),
    );
    rmSync(home, { recursive: true, force: true });
  }
}

const failed = results.filter((ok) => !ok).length;
console.log(failed === 0 ? "lazy-discovery-bridge: ALL PASS" : `lazy-discovery-bridge: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
