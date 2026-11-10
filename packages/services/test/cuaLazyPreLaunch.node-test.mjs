// R2 pre-launch 占位回归（specs/cua-gap-remediation-2026-11-09.md 决策点 D1=选项 A）：
// ensureStandaloneHelperPreLaunchedForLazySpawn 的决策序、并发串行与等待预算。
// 取证锚（2026-11-09，切段只读引用）：socket 存活时切段逐调用直连、绝不自己拉起
// （upstream/zcode-cua-0.6.5.index.js:38652-38687/:44897）；authenticate 载荷恒无
// token（:37522/:37551-37556）→ 占位的意义是「先占住 socket + 经 env 下发 token」，
// 见 cuaLazyPreLaunch.ts 头注释。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ensureStandaloneHelperPreLaunchedForLazySpawn,
} from "../src/cua-permission-broker/cuaLazyPreLaunch.ts";

const repoRoot = join(import.meta.dirname, "../../..");

const neverProbe = async () => {
  throw new Error("probe must not be called");
};
const neverLaunch = async () => {
  throw new Error("launch must not be called");
};

test("R2 非 darwin 平台不占位（win32 fork recipe 链 / linux 无 CUA 维持原行为）", async () => {
  for (const platform of ["win32", "linux"]) {
    assert.equal(
      await ensureStandaloneHelperPreLaunchedForLazySpawn({
        platform,
        socketPath: "/tmp/x.sock",
        probeSocketAlive: neverProbe,
        launchStandaloneHelper: neverLaunch,
      }),
      "platform-out-of-scope",
      `${platform} 必须短路，不探活不发射`,
    );
  }
});

test("R10 token 缓存门退役：无 cachedToken 入参，占位跳过只认 socket 探活", async () => {
  // R10 认证模型换代后 cachedToken 选项/缓存表整体移除——占位与否的唯一前置判据
  // 是 socket 探活（对已存活 Helper 重复 open 只是 activate，纯浪费）。
  let launchCalled = false;
  const outcome = await ensureStandaloneHelperPreLaunchedForLazySpawn({
    platform: "darwin",
    socketPath: "/tmp/x.sock",
    probeSocketAlive: async () => false,
    launchStandaloneHelper: async () => {
      launchCalled = true;
      return true;
    },
  });
  assert.equal(outcome, "pre-launched");
  assert.ok(launchCalled, "socket 空闲时必须走发射路径（无 token 缓存短路）");
});

test("R2 socket 已被外部 Helper 占住时不重发（防无效 token 毒化缓存）", async () => {
  // 对已存活 Helper 重复 open 只会 activate 既有实例，新铸造 token 从未被读取——
  // 缓存无效 token 会让 token 感知客户端全部 fail-closed（见 cuaLazyPreLaunch.ts 注释）。
  let launchCalled = false;
  assert.equal(
    await ensureStandaloneHelperPreLaunchedForLazySpawn({
      platform: "darwin",
      socketPath: "/tmp/x.sock",
      probeSocketAlive: async () => true,
      launchStandaloneHelper: async () => {
        launchCalled = true;
        return "must-not-happen";
      },
    }),
    "socket-already-occupied",
  );
  assert.equal(launchCalled, false);
});

test("R2 socket 空闲 → 现有 token 链发射；失败返回 pre-launch-failed", async () => {
  assert.equal(
    await ensureStandaloneHelperPreLaunchedForLazySpawn({
      platform: "darwin",
      socketPath: "/tmp/x.sock",
      probeSocketAlive: async () => false,
      launchStandaloneHelper: async () => "minted-token",
    }),
    "pre-launched",
  );
  assert.equal(
    await ensureStandaloneHelperPreLaunchedForLazySpawn({
      platform: "darwin",
      socketPath: "/tmp/x.sock",
      probeSocketAlive: async () => false,
      launchStandaloneHelper: async () => null,
    }),
    "pre-launch-failed",
  );
});

test("R2 发射异常折叠为 pre-launch-failed（共享 promise 不得以 rejection 泄漏）", async () => {
  assert.equal(
    await ensureStandaloneHelperPreLaunchedForLazySpawn({
      platform: "darwin",
      socketPath: "/tmp/x.sock",
      probeSocketAlive: async () => false,
      launchStandaloneHelper: async () => {
        throw new Error("open exploded");
      },
    }),
    "pre-launch-failed",
  );
});

test("R2 并发 spawn 共享同一次发射（单实例 flock 语义下第二次发射纯浪费且必铸无效 token）", async () => {
  let launches = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const launch = async () => {
    launches += 1;
    await gate;
    return "shared-token";
  };
  const inFlight = new Map();
  const options = {
    platform: "darwin",
    socketPath: "/tmp/concurrent.sock",
    probeSocketAlive: async () => false,
    launchStandaloneHelper: launch,
    inFlight,
  };
  const first = ensureStandaloneHelperPreLaunchedForLazySpawn(options);
  const second = ensureStandaloneHelperPreLaunchedForLazySpawn(options);
  release("go");
  assert.deepEqual(await Promise.all([first, second]), ["pre-launched", "pre-launched"]);
  assert.equal(launches, 1, "两个并发 spawn 必须共享同一次发射");
  assert.equal(inFlight.size, 0, "发射收敛后串行表必须清空（后续 spawn 重新走决策序）");
});

test("R2 等待预算超时返回 pre-launch-timeout（spawn 不卡冷启动；发射后台继续收敛）", async () => {
  let resolveLaunch;
  const launch = new Promise((resolve) => {
    resolveLaunch = resolve;
  });
  const outcome = ensureStandaloneHelperPreLaunchedForLazySpawn({
    platform: "darwin",
    socketPath: "/tmp/slow.sock",
    probeSocketAlive: async () => false,
    launchStandaloneHelper: () => launch,
    awaitBudgetMs: 30,
  });
  assert.equal(await outcome, "pre-launch-timeout");
  // 超时后发射仍在途：晚到的 resolve 不得把已返回的 outcome 变成未处理 rejection。
  resolveLaunch("late-token");
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test("R10 resolveSpawnEnv 懒启动分支接线锁定（源文本，R1.1 desktopHostProcess 同款先例）", () => {
  // R10 认证模型换代：token 缓存表/DRORA_CUA_PERMISSION_BROKER_TOKEN 注入整体退役。
  // 接线锁定改为：① pre-launch 占位调用在场；② token 缓存表与 token env 注入
  // 绝迹（负契约）；③ 占位发射仍复用设置页单一发射核心。
  const source = readFileSync(join(repoRoot, "packages/services/src/node.ts"), "utf8");
  assert.ok(
    source.includes("ensureStandaloneHelperPreLaunchedForLazySpawn({"),
    "resolveSpawnEnv 懒启动分支必须调用 pre-launch 占位编排",
  );
  assert.ok(
    !source.includes("standaloneTokenBySocket"),
    "R10 后不得残留 standalone token 缓存表",
  );
  assert.ok(
    !source.includes("DRORA_CUA_BROKER_TOKEN_ENV_KEY]:"),
    "R10 后懒启动分支不得注入 broker token env",
  );
  assert.ok(
    source.includes("launchStandaloneHelper: launchStandaloneCuaHelperOnSocket"),
    "占位发射必须复用设置页 standalone 发射核心（launchStandaloneCuaHelperOnSocket）",
  );
});
