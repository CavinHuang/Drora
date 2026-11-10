// R1.3 回归（specs/cua-gap-remediation-2026-11-09.md，审查 H1）：
// launchStandaloneCuaHelperForStatus 改用 buildStandaloneCuaHelperLaunchArgs 后，
// 设置页 standalone 状态发射链在产品态（ZCODE_RUNTIME_ENV=production）的行为基准：
//   ① 严格产品态（无放行 env）：argv 带 --token-file/--launcher-pid（token 门可过），
//      但无成对 escape → Helper 签名门对非官方 launcher pid 一律 exit(2) fail-loud
//      （审查中两次 exit 2 实测在此转为断言基准；2026-11-09 取证：错误/非官方 pid 同拒）。
//   ② 路线 A adhoc 分发态（DRORA_CUA_HELPER_ADHOC_DISTRIBUTION=1，打包链 Helper 构建
//      已折叠 allow-unsigned 放行）：发射成功——socket ping 通 + token authenticate
//      通过 + 错 token 拒（「可成功发射并返回权限真值」的最小充分证据链）。
// 发射方式与主函数一致（/usr/bin/open -n -g，LaunchServices 不透传 env）。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { randomBytes } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

import {
  buildStandaloneCuaHelperLaunchArgs,
} from "../src/node.ts";

const repoRoot = join(import.meta.dirname, "../..");
const devStagedHelperApp = join(
  repoRoot,
  "zcode-cua-helper/dist-cua-helper/Drora Computer Use.app",
);
// 路线 A 分发形态的已安装 Helper（打包链构建：CUA_HELPER_ALLOW_UNSIGNED_LAUNCHER=1
// 折叠放行；本机安装份，CI 干净环境缺席时跳过——同 cuaHostInstallerBuildIdentity
// 的 runIfStaged 先例）。
const adhocInstalledHelperApp = join(
  homedir(),
  ".drora/computer-use/Drora Computer Use.app",
);
const openAsync = promisify(execFile);

const PRODUCTION_ENV = {
  NODE_ENV: "production",
  ZCODE_RUNTIME_ENV: "production",
};

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

function createConnectionSafe(socketPath) {
  try {
    return connect(socketPath);
  } catch {
    return null;
  }
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
  // Helper 对 SIGTERM 有 drained-input 安全关停保护（launcher 已退出时可能拒绝 clean
  // stop 而滞留，2026-11-09 本机取证复现），测试清理直接 SIGKILL。
  await new Promise((resolve) => {
    const child = execFile("/usr/bin/pkill", ["-9", "-f", socketPath], () => resolve());
    child.on("error", () => resolve());
  });
}

async function makeFixture() {
  const home = mkdtempSync(join(tmpdir(), "r1-status-launch-"));
  const { writeOneShotHelperTokenFile } = await import("@drora/drora-cua/broker/server");
  const socketPath = join(home, "status.sock");
  const token = randomBytes(32).toString("hex");
  const tokenFile = await writeOneShotHelperTokenFile({ socketPath, token });
  return {
    socketPath,
    token,
    tokenFile,
    exitLogPath: `${socketPath}.settings.exit.log`,
    home,
    writeTokenFile: () => writeOneShotHelperTokenFile({ socketPath, token }),
  };
}

const runIfDevStaged = existsSync(join(devStagedHelperApp, "Contents/Info.plist"))
  ? test
  : test.skip;
const runIfAdhocInstalled = existsSync(join(adhocInstalledHelperApp, "Contents/Info.plist"))
  ? test
  : test.skip;

runIfDevStaged("R1.3 严格产品态：argv 形态 + Helper fail-loud exit(2)（审查基准）", async () => {
  const fixture = await makeFixture();
  try {
    const args = buildStandaloneCuaHelperLaunchArgs({
      appPath: devStagedHelperApp,
      socketPath: fixture.socketPath,
      tokenFile: fixture.tokenFile,
      env: PRODUCTION_ENV,
      launcherPid: process.pid,
      ghostCursorOverlay: true,
    });
    // 形态：token 门与 launcher pid 已补齐（修复前主函数手写参数缺 --token-file），
    // 严格态无成对 escape。
    assert.ok(args.includes("--token-file"), "argv 必须含 --token-file");
    assert.ok(args.includes("--launcher-pid"), "argv 必须含 --launcher-pid");
    assert.ok(
      !args.includes("--allow-unsigned-launcher-local-dev"),
      "严格产品态不得带放行 argv",
    );
    // 发射（与主函数同款 /usr/bin/open）→ Helper 签名门拒非官方 launcher → exit(2)。
    await openAsync("/usr/bin/open", args, { timeout: 5000 });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !existsSync(fixture.exitLogPath)) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const exitLog = existsSync(fixture.exitLogPath)
      ? readFileSync(fixture.exitLogPath, "utf8")
      : "";
    assert.ok(
      exitLog.includes("did not verify as a code-signed"),
      `严格态必须 fail-loud 落签名门文案（exit.log 尾部：${exitLog.slice(-160)}）`,
    );
    assert.equal(await pingSocket(fixture.socketPath), false, "签名门拒启后无 broker 监听");
  } finally {
    await killHelperOnSocket(fixture.socketPath);
    rmSync(fixture.home, { recursive: true, force: true });
  }
});

runIfAdhocInstalled("R1.3 路线 A adhoc 产品态：发射成功 + token 鉴权真值", async () => {
  const fixture = await makeFixture();
  try {
    const args = buildStandaloneCuaHelperLaunchArgs({
      appPath: adhocInstalledHelperApp,
      socketPath: fixture.socketPath,
      tokenFile: fixture.tokenFile,
      env: { ...PRODUCTION_ENV, DRORA_CUA_HELPER_ADHOC_DISTRIBUTION: "1" },
      launcherPid: process.pid,
      ghostCursorOverlay: true,
    });
    assert.ok(
      args.includes("--allow-unsigned-launcher-local-dev"),
      "adhoc 分发态必须带 launcher 放行（此前主函数漏传 → 审查两次 exit 2）",
    );
    await openAsync("/usr/bin/open", args, { timeout: 5000 });
    const ready = await waitForPing(fixture.socketPath, 20000);
    assert.ok(ready, "adhoc 产品态发射后 broker 必须可 ping（可成功发射基准）");
    const replies = await exchange(fixture.socketPath, [
      { id: 1, method: "authenticate", params: { token: fixture.token } },
      { id: 2, method: "authenticate", params: { token: "wrong-token" } },
    ]);
    assert.equal(replies[0]?.ok, true, "铸造 token authenticate 必须通过（权限真值链）");
    assert.equal(replies[1]?.ok, false, "错 token 必须被拒（not_authorized）");
    assert.equal(replies[1]?.error?.code, "not_authorized");
  } finally {
    await killHelperOnSocket(fixture.socketPath);
    rmSync(fixture.home, { recursive: true, force: true });
  }
});
