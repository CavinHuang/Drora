// R1 批回归测试（specs/cua-gap-remediation-2026-11-09.md）：
// R1.1 注入键名锁定（ZCODE_CUA_LAUNCHER_PID，切段消费面键名——原 DRORA_ 名全仓零消费者，
//   2026-11-09 取证：错误/非官方 launcher pid 产品态一律 exit(2) fail-loud，键名撕裂导致
//   切段回退 host 自身 pid 或顶替为同机官方 ZCode 泄漏 pid）。
// R1.2 懒启动发现链桥接值的单一出处（bundled 直注实际 .app 路径 / install variant 对齐
//   安装根 / win32 recipe 桥接）。
// R1.2.3 ZCODE_HOME 透传链锁定（desktopHostProcess 注入 host env → agent spawn 继承，
//   切段 :45052 注释声明的透传前提是不在 SANITIZED_RUNTIME_ENV_KEYS——本测试钉住这一点，
//   防后续有人把 ZCODE_ 键加进清洗表后懒启动链静默断线）。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  buildZcodeCuaLazyLaunchBridgeEnv,
  resolveDroraCuaHelperLazyLaunchAppPath,
  resolveZcodeCuaHelperInstallVariantForBridge,
  ZCODE_CUA_BUNDLED_HELPER_APP_PATH_ENV,
  ZCODE_CUA_LAUNCHER_PID_ENV,
  ZCODE_CUA_WIN_HELPER_RECIPE_ENV,
  ZCODE_CUA_HELPER_INSTALL_VARIANT_ENV,
} from "../src/node.ts";
import { sanitizeDroraRuntimeEnv } from "@drora/shared";

const repoRoot = resolve(import.meta.dirname, "../../..");

test("R1.1 桥接常量值锁定（切段消费面键名）", () => {
  // 消费方锚：0.6.5 切段 upstream/zcode-cua-0.6.5.index.js:6912（LAUNCHER_PID_ENV 常量）
  // 与 :7152（resolveLauncherPid 读取）；node-repl-host dist mcp/server.js:78448 同源内联。
  assert.equal(ZCODE_CUA_LAUNCHER_PID_ENV, "ZCODE_CUA_LAUNCHER_PID");
  assert.equal(ZCODE_CUA_BUNDLED_HELPER_APP_PATH_ENV, "ZCODE_CUA_BUNDLED_HELPER_APP_PATH");
  assert.equal(ZCODE_CUA_HELPER_INSTALL_VARIANT_ENV, "ZCODE_CUA_HELPER_INSTALL_VARIANT");
  assert.equal(ZCODE_CUA_WIN_HELPER_RECIPE_ENV, "ZCODE_CUA_WIN_HELPER_RECIPE");
});

test("R1.1 desktopHostProcess 注入键名切换（源文本锁定）", () => {
  // desktopHostProcess.ts 属 Electron main（import electron），node:test 无法装配，
  // 以源文本锁定注入键名；desktop/out 产物由打包链重建后自然带新键。
  const source = readFileSync(
    join(repoRoot, "packages/desktop/src/main/desktopHostProcess.ts"),
    "utf8",
  );
  assert.ok(
    source.includes("[ZCODE_CUA_LAUNCHER_PID_ENV]: String(process.pid)"),
    "darwin 注入块必须以 services 常量键写入 main pid",
  );
  assert.ok(
    !source.includes("DRORA_CUA_LAUNCHER_PID:"),
    "原 DRORA_ 名零消费者（方案 R1.1：直接切换，不保留双写；修复说明注释中的旧键名除外）",
  );
});

test("R1.2.1 lazy launch 路径解析序：随包/显式注入优先，回落已安装候选", () => {
  const bundledPath = "/opt/bundled/Drora Computer Use.app";
  const installedPath = "/home/u/.drora/computer-use/Drora Computer Use.app";
  const exists = (path) => path === bundledPath || path === installedPath;
  // ① 随包在场（desktop 场景）：DRORA_CUA_BUNDLED_HELPER_APP_PATH 注入值优先。
  assert.equal(
    resolveDroraCuaHelperLazyLaunchAppPath(
      { DRORA_CUA_BUNDLED_HELPER_APP_PATH: bundledPath },
      exists,
    ),
    bundledPath,
  );
  // ② 随包缺失（CLI standalone 场景）：回落 drora-helper-locations 的已安装候选
  //    （ZCODE_HOME/computer-use 布局，Drora app 名）。
  const env = {
    ZCODE_HOME: "/home/u/.drora",
    ZCODE_RUNTIME_ENV: "production",
    NODE_ENV: "production",
  };
  assert.equal(resolveDroraCuaHelperLazyLaunchAppPath(env, exists), installedPath);
  // ③ 两处都缺失：不注入（切段回落自身缺省行为，桥接层不引入新失败面）。
  assert.equal(resolveDroraCuaHelperLazyLaunchAppPath(env, () => false), undefined);
});

test("R1.2.2 install variant 桥接值对齐我方安装根语义", () => {
  // preview 打包态：main 注入 DRORA_CUA_HELPER_INSTALL_VARIANT=preview → 透传（preview 子根）。
  assert.equal(
    resolveZcodeCuaHelperInstallVariantForBridge({
      DRORA_CUA_HELPER_INSTALL_VARIANT: "preview",
    }),
    "preview",
  );
  // dev runtime → dev-desktop（dev/ 子根），与切段缺省序一致。
  assert.equal(resolveZcodeCuaHelperInstallVariantForBridge({}), "dev-desktop");
  // 产品态（切段同款判定输入）→ stable（computer-use 根，与现有安装同位）。
  assert.equal(
    resolveZcodeCuaHelperInstallVariantForBridge({
      NODE_ENV: "production",
      ZCODE_RUNTIME_ENV: "production",
    }),
    "stable",
  );
});

test("R1.2 mac 桥接 env 构造（darwin）", async () => {
  const appPath = "/opt/bundled/Drora Computer Use.app";
  const bridge = await buildZcodeCuaLazyLaunchBridgeEnv({
    env: { DRORA_CUA_BUNDLED_HELPER_APP_PATH: appPath },
    exists: (path) => path === appPath,
  });
  // 第二轮 R7.6：CLI standalone 无 host 注入层，桥接兜底补 ZCODE_HOME=Drora 数据根
  //（切段 candidates 兜底臂不再落到 ~/.zcode 找官方名 Helper——同机官方 ZCode 负测前提）。
  assert.deepEqual(bridge, {
    [ZCODE_CUA_BUNDLED_HELPER_APP_PATH_ENV]: appPath,
    [ZCODE_CUA_HELPER_INSTALL_VARIANT_ENV]: "dev-desktop",
    ZCODE_HOME: join(homedir(), ".drora"),
  });
  // 已有 ZCODE_HOME（desktop 态 host env 注入）→ 不覆盖。
  assert.equal(
    (
      await buildZcodeCuaLazyLaunchBridgeEnv({
        env: { DRORA_CUA_BUNDLED_HELPER_APP_PATH: appPath, ZCODE_HOME: "/custom/root" },
        exists: (path) => path === appPath,
      })
    ).ZCODE_HOME,
    undefined,
  );
  // DRORA_HOME 优先于数据根默认（与 drora-helper-locations 取值式同源）。
  assert.equal(
    (
      await buildZcodeCuaLazyLaunchBridgeEnv({
        env: { DRORA_CUA_BUNDLED_HELPER_APP_PATH: appPath, DRORA_HOME: "/drora-home" },
        exists: (path) => path === appPath,
      })
    ).ZCODE_HOME,
    "/drora-home",
  );
  // 路径不可解析 → 空桥接（bundled/variant 不注入；ZCODE_HOME 兜底仍在，切段
  // candidates 兜底臂同样需要数据根路由）。
  assert.deepEqual(
    await buildZcodeCuaLazyLaunchBridgeEnv({ env: {}, exists: () => false }),
    { ZCODE_HOME: join(homedir(), ".drora") },
  );
});

test("R1.2.2 win32 recipe 桥接（字段形状对齐切段 ensureWindowsHelperForked 消费面）", async () => {
  const recipe = {
    command: "C:\\Drora\\Drora.exe",
    entryPath: "resources\\app\\entry.cjs",
    root: "C:\\Drora",
    addonPath: "resources\\ax_native.node",
    commandEnv: { ELECTRON_RUN_AS_NODE: "1" },
  };
  // 平台分支用注入 platform 锁定（切段消费面要求字段 command/entryPath/root/addonPath/
  // commandEnv/hostPid，缺一即静默 return——形状必须逐字段对齐）。
  const bridge = await buildZcodeCuaLazyLaunchBridgeEnv({
    env: {},
    exists: () => false,
    resolveWinRecipe: async () => recipe,
    hostPid: 4242,
    platform: "win32",
  });
  const parsed = JSON.parse(bridge[ZCODE_CUA_WIN_HELPER_RECIPE_ENV] ?? "{}");
  assert.deepEqual(parsed, { ...recipe, hostPid: 4242 });
  // recipe 不可解析（resolveWindowsCuaRuntime 失败）→ 省略键。
  const noRecipe = await buildZcodeCuaLazyLaunchBridgeEnv({
    env: {},
    exists: () => false,
    resolveWinRecipe: async () => null,
    platform: "win32",
  });
  assert.equal(ZCODE_CUA_WIN_HELPER_RECIPE_ENV in noRecipe, false);
});

test("R1.2.3 ZCODE_HOME 与桥接键随 agent spawn env 透传（不在清洗表）", () => {
  // 透传链：desktopHostProcess 注入 host env（第二十八轮先例）→ host process.env →
  // agent spawn env 继承（buildAgentRuntimeEnv 是增量补丁、sanitize 只剔除下列键）。
  // 若这些键被加进 SANITIZED_RUNTIME_ENV_KEYS，切段懒启动将静默回落 ~/.zcode——锁死。
  const env = sanitizeDroraRuntimeEnv({
    HOME: "/home/u",
    ZCODE_HOME: "/home/u/.drora",
    [ZCODE_CUA_LAUNCHER_PID_ENV]: "1234",
    [ZCODE_CUA_BUNDLED_HELPER_APP_PATH_ENV]: "/opt/bundled/Drora Computer Use.app",
    [ZCODE_CUA_HELPER_INSTALL_VARIANT_ENV]: "stable",
    [ZCODE_CUA_WIN_HELPER_RECIPE_ENV]: "{}",
  });
  assert.equal(env["ZCODE_HOME"], "/home/u/.drora");
  assert.equal(env[ZCODE_CUA_LAUNCHER_PID_ENV], "1234");
  assert.equal(env[ZCODE_CUA_BUNDLED_HELPER_APP_PATH_ENV], "/opt/bundled/Drora Computer Use.app");
  assert.equal(env[ZCODE_CUA_HELPER_INSTALL_VARIANT_ENV], "stable");
  assert.equal(env[ZCODE_CUA_WIN_HELPER_RECIPE_ENV], "{}");
});
