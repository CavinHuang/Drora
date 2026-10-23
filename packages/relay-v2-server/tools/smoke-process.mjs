// 进程级冒烟（specs/relay-v2-server.md §9/§13）：spawn 本包构建产物 dist/relay-v2-server.js，
// 临时 DB 与 stub 鉴权全部经**进程级环境变量**注入（DB_PATH + JWT_MODE=stub + JWT_STUB_USERS，
// spec §9/§12 M1——stub 进程级配置即由此工具需求新增并登记进 §9），然后打真实 HTTP/WS 全流程：
//   /healthz → 注册设备 → 签发一次性 token → WS 升级 → auth_init（auth_ack）
//   → pair_status_query（pair_status_ack）→ /healthz 复查（connections/owners/counters）
//   → SIGTERM 优雅停机。
// 任何一步失败：向 stderr 输出原因与子进程输出尾部、杀掉子进程、非零退出。
//
// 运行（先构建）：
//   pnpm --filter @drora/relay-v2-server run build
//   node tools/smoke-process.mjs
//
// 实现约束：
// - 子进程经临时引导脚本装配 dist（与 deploy/docker-compose.yml 的 run-relay.mjs 同款形状：
//   loadConfigFromEnv → createJwtAuth → createRelayServer），smoke 自身不 import src/（dist 是
//   被测对象；同 tools/probe-token.ts 先例）。
// - 输出统一走 process.stdout/stderr.write（禁 console.log，仓库日志纪律）；子进程日志仅失败时
//   回显尾部，避免双份噪声。
// - 退出码：0 全流程通过；1 任一步失败。

import { spawn } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

const out = (line) => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);

/** 契约路径常量的字面值（单一出处 packages/shared/src/web-remote-relay；工具不 import src，见头注） */
const WS_PATH = "/api/v1/remote/ws2";
/** 契约要求 client_ts 为 Unix 秒（毫秒值会被入站解析器拒绝，spec §5.2） */
const CLIENT_TS = 1_700_000_000;
/** stub 映射的测试凭据（仅进程内 env 与内存，不落盘、不进成功输出） */
const STUB_JWT = "smoke-jwt-alice";
const STUB_USER = "smoke-user-alice";

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`超时（${ms}ms）：${label}`)), ms).unref(),
    ),
  ]);

function probeFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** 轮询异步谓词直到成立（带超时），healthz/WS 收包共用 */
async function waitFor(predicate, ms, label) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`超时（${ms}ms）：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function assert(condition, label) {
  if (!condition) throw new Error(`冒烟断言失败：${label}`);
}

async function main() {
  const packageRoot = join(new URL("..", import.meta.url).pathname);
  const distEntry = join(packageRoot, "dist", "relay-v2-server.js");
  const distUrl = pathToFileURL(distEntry).href;

  const workDir = await mkdtemp(join(tmpdir(), "relay-v2-smoke-"));
  const dbPath = join(workDir, "devices.sqlite");
  const bootstrapPath = join(workDir, "smoke-bootstrap.mjs");
  // catch 块也要能回显子进程输出：缓冲区声明在 try 之外（负例路径在 spawn 前就可能失败）
  let child;
  let childStdout = [];
  let childStderr = [];

  try {
    // 产物存在性前置检查：缺 dist 时给出可执行的原因，而不是让子进程 import 失败后再排查
    await access(distEntry).catch(() => {
      throw new Error(
        `构建产物不存在：${distEntry}（先运行 pnpm --filter @drora/relay-v2-server run build）`,
      );
    });
    await writeFile(
      bootstrapPath,
      [
        `import * as relay from ${JSON.stringify(distUrl)};`,
        `const config = relay.loadConfigFromEnv(process.env);`,
        `const handle = await relay.createRelayServer({ config, auth: relay.createJwtAuth({ config }) });`,
        `process.stdout.write("SMOKE_RELAY_PORT=" + handle.port + "\\n");`,
        `for (const signal of ["SIGTERM", "SIGINT"]) {`,
        `  process.on(signal, () => {`,
        `    void handle.stop().then(() => process.exit(0), () => process.exit(1));`,
        `  });`,
        `}`,
        "",
      ].join("\n"),
      "utf8",
    );

    const listenPort = await probeFreePort();
    // 进程级配置注入（spec §9）：DB_PATH 临时库；JWT_MODE=stub + JWT_STUB_USERS 让 dist 产物
    // 不经代码注入即可完成 stub 鉴权装配。LOG_LEVEL=warn 使子进程 stdout 只剩引导的端口行。
    const childEnv = {
      ...process.env,
      BIND_HOST: "127.0.0.1",
      LISTEN_PORT: String(listenPort),
      DB_PATH: dbPath,
      JWT_MODE: "stub",
      JWT_STUB_USERS: JSON.stringify({ [STUB_JWT]: STUB_USER }),
      LOG_LEVEL: "warn",
    };
    child = spawn(process.execPath, [bootstrapPath], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => childStdout.push(chunk));
    child.stderr.on("data", (chunk) => childStderr.push(chunk));
    const exitedEarly = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );

    out(`[1/6] 已 spawn dist 产物（LISTEN_PORT=${listenPort}，JWT_MODE=stub）`);
    // 端口行与「提前退出」竞速：谁先到都立刻失败/继续，不空等超时
    const port = await Promise.race([
      waitFor(
        () => {
          const text = Buffer.concat(childStdout).toString("utf8");
          const match = text.match(/^SMOKE_RELAY_PORT=(\d+)$/m);
          return match ? Number(match[1]) : undefined;
        },
        15_000,
        "子进程未在时限内报告监听端口",
      ),
      exitedEarly.then(({ code, signal }) => {
        throw new Error(`子进程提前退出（code=${code} signal=${signal}）`);
      }),
    ]);
    const origin = `http://127.0.0.1:${port}`;
    out(`[2/6] 子进程监听 127.0.0.1:${port}`);

    // /healthz：spec §9 五字段（uptime/connections/owners/devices/counters）
    const health = await withTimeout(
      (async () => {
        const response = await fetch(`${origin}/healthz`);
        assert(response.status === 200, `/healthz 应 200，实得 ${response.status}`);
        return response.json();
      })(),
      5_000,
      "GET /healthz",
    );
    assert(
      typeof health.uptime === "number" &&
        health.connections === 0 &&
        health.owners === 0 &&
        health.devices === 0 &&
        health.counters?.device?.framesIn === 0,
      `/healthz 初始视图不符合 spec §9：${JSON.stringify(health)}`,
    );
    out("[3/6] GET /healthz 通过（connections=0，counters 归零）");

    // 注册设备（Bearer stub JWT → userId 映射进隔离 owner 域）
    const register = await withTimeout(
      (async () => {
        const response = await fetch(`${origin}/api/v1/remote/device`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${STUB_JWT}` },
          body: JSON.stringify({ device_mid: "smoke-machine" }),
        });
        assert(response.status === 200, `注册应 200，实得 ${response.status}`);
        return response.json();
      })(),
      5_000,
      "POST /api/v1/remote/device",
    );
    assert(register.code === 0, `注册业务码应 0：${JSON.stringify(register)}`);
    const deviceSid = register.data?.device_sid;
    assert(
      typeof deviceSid === "string" && deviceSid.startsWith("d_"),
      `device_sid 形状异常：${deviceSid}`,
    );
    out(`[4/6] 设备注册通过（sid 前缀 ${deviceSid.slice(0, 8)}…）`);

    // 一次性 token + WS 升级 + auth_init + pair_status_query 全流程
    const tokenResponse = await fetch(`${origin}/api/v1/remote/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${STUB_JWT}` },
      body: JSON.stringify({ role: "device" }),
    });
    assert(
      tokenResponse.status === 200 && tokenResponse.headers.get("cache-control") === "no-store",
      `token 签发应 200 + no-store，实得 ${tokenResponse.status}`,
    );
    const { token } = (await tokenResponse.json()).data;
    assert(typeof token === "string" && token.length === 22, "一次性 token 应为 22 字符 base64url");

    const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}?token=${encodeURIComponent(token)}`);
    const received = [];
    ws.on("message", (data) => received.push(JSON.parse(data.toString())));
    ws.on("error", () => {});
    await withTimeout(
      new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      }),
      5_000,
      "WS 升级",
    );
    ws.send(
      JSON.stringify({
        type: "auth_init",
        device_sid: deviceSid,
        meta: { name: "smoke" },
        client_ts: CLIENT_TS,
      }),
    );
    await withTimeout(
      waitFor(() => received.find((m) => m.type === "auth_ack"), 5_000, "未收到 auth_ack"),
      5_001,
    );
    const authAck = received.find((m) => m.type === "auth_ack");
    assert(authAck.device_sid === deviceSid, "auth_ack 应回显 device_sid");
    assert(authAck.pair_status === "waiting", "首个 auth_ack 应为 waiting");
    assert(Number.isInteger(authAck.server_ts), "服务端消息应带秒级 server_ts");
    ws.send(JSON.stringify({ type: "pair_status_query", client_ts: CLIENT_TS }));
    const ack = await withTimeout(
      waitFor(
        () => received.find((m) => m.type === "pair_status_ack"),
        5_000,
        "未收到 pair_status_ack",
      ),
      5_001,
    );
    assert(ack.pair_status === "waiting", "pair_status_ack 应为 waiting");
    assert(ack.terminal_sid === "", "无对端时 pair_status_ack.terminal_sid 应为空串");
    out("[5/6] WS auth_init → auth_ack、pair_status_query → pair_status_ack 全流程通过");

    // 停机前复查：连接与 owner 计数、收发计数都已派生（spec §9）
    const after = await (await fetch(`${origin}/healthz`)).json();
    assert(
      after.connections === 1 && after.owners === 1 && after.devices === 1,
      `/healthz 连接后视图异常：${JSON.stringify(after)}`,
    );
    assert(
      after.counters.device.framesIn >= 2 && after.counters.device.framesOut >= 1,
      `counters 未随收发派生：${JSON.stringify(after.counters)}`,
    );

    // 干净杀掉：SIGTERM → 优雅停机（INTERNAL→关闭→flush）→ 退出码 0
    child.kill("SIGTERM");
    const exit = await withTimeout(
      new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
      10_000,
      "子进程未在时限内优雅退出",
    );
    assert(exit.code === 0, `SIGTERM 后退出码应 0，实得 ${exit.code}/${exit.signal}`);
    ws.close();
    out("[6/6] SIGTERM 优雅停机通过（退出码 0）");
    out("冒烟通过：dist 产物进程级装配 + 全流程 OK");
  } catch (failure) {
    err(`冒烟失败：${failure instanceof Error ? failure.message : String(failure)}`);
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    const stderrTail =
      childStderr.length === 0
        ? ""
        : Buffer.concat(childStderr).toString("utf8").split("\n").slice(-10).join("\n");
    const stdoutTail =
      childStdout.length === 0
        ? ""
        : Buffer.concat(childStdout).toString("utf8").split("\n").slice(-10).join("\n");
    if (stderrTail.trim().length > 0) err(`子进程 stderr 尾部：\n${stderrTail}`);
    if (stdoutTail.trim().length > 0) err(`子进程 stdout 尾部：\n${stdoutTail}`);
    process.exitCode = 1;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
