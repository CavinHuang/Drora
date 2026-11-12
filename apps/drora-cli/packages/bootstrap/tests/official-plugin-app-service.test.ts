import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  DRORA_PLUGIN_APP_SERVICE_ENV_KEY,
  DRORA_PLUGIN_APP_SERVICE_ENV_VALUE,
  DRORA_PLUGIN_HOST_COMMAND,
  type Logger,
  type PluginMetadata,
} from "@drora/contracts";
import { DRORA_PLUGIN_ID_ENV_KEY } from "@drora/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createOfficialPluginAppServiceManager } from "../src/app/official-plugin-app-service.js";
import {
  OFFICIAL_OBSIDIAN_PLUGIN_ID,
  OFFICIAL_PLUGIN_DEFINITIONS,
  resolveOfficialPluginAppService,
} from "../src/app/official-plugin-definitions.js";
import {
  resolveOfficialPluginAppServiceSpawnConfig,
  type OfficialPluginAppServiceSpawnConfig,
} from "../src/app/official-plugin-runtime.js";

// P1 生命周期语义用例（specs/obsidian-vault-phase2-true-extraction.md §10-P1 gate）：
// singleton / 崩溃重启 / 退出收割，全部以真实子进程验证，不做假 ChildProcess。

const OBSIDIAN_PLUGIN_ID = OFFICIAL_OBSIDIAN_PLUGIN_ID;

/** 常驻不退出的占位 server（真实进程；setInterval 维持事件循环）。 */
const SLEEPER_SCRIPT = "setInterval(() => {}, 1000);";
/** 立即以非零码退出的占位 server（真实进程；模拟崩溃）。 */
const CRASHER_SCRIPT = "process.exit(1);";

const cleanups: Array<() => Promise<void> | void> = [];

describe("official plugin app service (g1)", () => {
  const originalEntrypoint = process.argv[1];

  afterEach(async () => {
    process.argv[1] = originalEntrypoint;
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it("spawn 计划复用 __drora-plugin-host 机制并权威写入常驻标记 env", async () => {
    const root = await writePluginRoot({
      mcpServers: {
        knowledge: {
          command: "node",
          env: {
            // 故意携带与宿主权威键同名的值 + 非字符串值：验证权威覆写与非法值丢弃。
            DRORA_PLUGIN_APP_SERVICE: "0",
            FOO: "bar",
            BAD: 42,
          },
          args: ["${DRORA_PLUGIN_ROOT}/dist/mcp/server.js"],
        },
      },
      name: "obsidian",
    });
    process.argv[1] = join(root, "drora.cjs");

    const config = resolveOfficialPluginAppServiceSpawnConfig({
      cwd: "/tmp/workdir",
      dataPath: join(root, "data"),
      pluginId: OFFICIAL_OBSIDIAN_PLUGIN_ID,
      rootPath: root,
      serverKey: "knowledge",
    });

    expect(config).toBeDefined();
    const plan = config as OfficialPluginAppServiceSpawnConfig;
    // command 固定宿主 execPath（打包态是 Helper，靠 ELECTRON_RUN_AS_NODE 进 Node 模式）。
    expect(plan.command).toBe(process.execPath);
    // args 以既有 `__drora-plugin-host` 前缀机制开头（开发态 = execArgv + 入口 + 隐藏子命令）。
    expect(plan.args.at(-2)).toBe(DRORA_PLUGIN_HOST_COMMAND);
    // `${DRORA_PLUGIN_ROOT}` 占位符解析成宿主原生形态（POSIX 下 normalize 无变化）。
    expect(plan.args.at(-1)).toBe(join(root, "dist/mcp/server.js"));
    expect(plan.cwd).toBe("/tmp/workdir");
    expect(plan.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(plan.env[DRORA_PLUGIN_ID_ENV_KEY]).toBe(OFFICIAL_OBSIDIAN_PLUGIN_ID);
    // 常驻标记是宿主权威键：manifest env 自带同名值 "0" 也被覆写为常量值（契约键单一出处）。
    expect(plan.env[DRORA_PLUGIN_APP_SERVICE_ENV_KEY]).toBe(DRORA_PLUGIN_APP_SERVICE_ENV_VALUE);
    expect(plan.env.DRORA_PLUGIN_DATA).toBe(join(root, "data"));
    expect(plan.env.DRORA_PLUGIN_ROOT).toBe(root);
    // manifest env 透传合法字符串；非字符串值丢弃（spawn env 只接受 string）。
    expect(plan.env.FOO).toBe("bar");
    expect(plan.env.BAD).toBeUndefined();
  });

  it("声明缺 server 条目 / 非 stdio / 清单缺失时惰性跳过（P3 前的 obsidian 语义）", async () => {
    process.argv[1] = join(await mkdtemp(join(tmpdir(), "drora-app-service-skip-")), "drora.cjs");

    // 清单无 mcpServers（obsidian 现状，P3 落地前）。
    const withoutServers = await writePluginRoot({ name: "obsidian", version: "0.3.0" });
    expect(
      resolveOfficialPluginAppServiceSpawnConfig({
        cwd: ".",
        dataPath: withoutServers,
        pluginId: OFFICIAL_OBSIDIAN_PLUGIN_ID,
        rootPath: withoutServers,
        serverKey: "knowledge",
      }),
    ).toBeUndefined();

    // server 键不存在。
    const wrongKey = await writePluginRoot({
      mcpServers: { other: { command: "node", args: ["x.js"] } },
      name: "obsidian",
    });
    expect(
      resolveOfficialPluginAppServiceSpawnConfig({
        cwd: ".",
        dataPath: wrongKey,
        pluginId: OFFICIAL_OBSIDIAN_PLUGIN_ID,
        rootPath: wrongKey,
        serverKey: "knowledge",
      }),
    ).toBeUndefined();

    // HTTP/SSE 无本地入口，宿主无法常驻拉起。
    const httpServer = await writePluginRoot({
      mcpServers: { knowledge: { type: "http", url: "https://example.com/mcp" } },
      name: "obsidian",
    });
    expect(
      resolveOfficialPluginAppServiceSpawnConfig({
        cwd: ".",
        dataPath: httpServer,
        pluginId: OFFICIAL_OBSIDIAN_PLUGIN_ID,
        rootPath: httpServer,
        serverKey: "knowledge",
      }),
    ).toBeUndefined();

    // 插件根目录不存在（清单缺失）。
    expect(
      resolveOfficialPluginAppServiceSpawnConfig({
        cwd: ".",
        dataPath: ".",
        pluginId: OFFICIAL_OBSIDIAN_PLUGIN_ID,
        rootPath: join(tmpdir(), "drora-app-service-not-exist"),
        serverKey: "knowledge",
      }),
    ).toBeUndefined();
  });

  it("singleton：宿主进程级每 pluginId 至多一实例，重复 start 复用既有实例", async () => {
    const fixtureRoot = await writePluginRoot({
      mcpServers: { knowledge: { command: "node", args: ["server.js"] } },
      name: "obsidian",
    });
    const spawnCalls: OfficialPluginAppServiceSpawnConfig[] = [];
    const children: ChildProcess[] = [];
    const manager = createOfficialPluginAppServiceManager({
      cwd: ".",
      harvestGraceMs: 200,
      logger: noopLogger(),
      plugins: [pluginMetadata(OBSIDIAN_PLUGIN_ID, true, fixtureRoot)],
      spawnProcess: (config) => {
        spawnCalls.push(config);
        const child = spawn(process.execPath, ["-e", SLEEPER_SCRIPT], { stdio: "pipe" });
        children.push(child);
        return child;
      },
    });
    cleanups.push(() => manager.harvest());

    manager.start();
    manager.start();
    // 插件禁用即停服务（在场门 = 插件启用态）：单独一个禁用条目不拉起。
    const disabledManager = createOfficialPluginAppServiceManager({
      cwd: ".",
      harvestGraceMs: 200,
      logger: noopLogger(),
      plugins: [pluginMetadata(OBSIDIAN_PLUGIN_ID, false, fixtureRoot)],
      spawnProcess: (config) => {
        spawnCalls.push(config);
        const child = spawn(process.execPath, ["-e", SLEEPER_SCRIPT], { stdio: "pipe" });
        children.push(child);
        return child;
      },
    });
    disabledManager.start();
    cleanups.push(() => disabledManager.harvest());

    await waitFor(() => spawnCalls.length === 1 && children[0]?.pid !== undefined);
    await delay(50);
    // 两次 start + 一个禁用条目：仍然只有一个常驻实例。
    expect(spawnCalls.length).toBe(1);
    const snapshot = manager.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.pluginId).toBe(OFFICIAL_OBSIDIAN_PLUGIN_ID);
    expect(snapshot[0]?.serverKey).toBe("knowledge");
    expect(snapshot[0]?.state).toBe("running");
    expect(children[0]?.kill(0)).toBe(true);
  });

  it("崩溃重启：意外退出按退避自动重启并累计计数", async () => {
    const fixtureRoot = await writePluginRoot({
      mcpServers: { knowledge: { command: "node", args: ["server.js"] } },
      name: "obsidian",
    });
    const children: ChildProcess[] = [];
    let launchCount = 0;
    const manager = createOfficialPluginAppServiceManager({
      cwd: ".",
      harvestGraceMs: 200,
      logger: noopLogger(),
      plugins: [pluginMetadata(OBSIDIAN_PLUGIN_ID, true, fixtureRoot)],
      restartInitialDelayMs: 10,
      restartMaxDelayMs: 40,
      restartStableResetMs: Number.POSITIVE_INFINITY,
      spawnProcess: () => {
        // 首个实例立即崩溃（真实非零退出）；重启出的实例常驻，验证重启语义完整。
        const script = launchCount === 0 ? CRASHER_SCRIPT : SLEEPER_SCRIPT;
        launchCount += 1;
        const child = spawn(process.execPath, ["-e", script], { stdio: "pipe" });
        children.push(child);
        return child;
      },
    });
    cleanups.push(() => manager.harvest());

    manager.start();
    await waitFor(() => launchCount >= 2 && children[1]?.pid !== undefined);
    await delay(30);
    expect(children[1]?.kill(0)).toBe(true);
    const snapshot = manager.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.restarts).toBe(1);
    expect(snapshot[0]?.state).toBe("running");
  });

  it("同步 spawn 失败同样进入指数退避（attempts 递增），恢复后转 running", async () => {
    const fixtureRoot = await writePluginRoot({
      mcpServers: { knowledge: { command: "node", args: ["server.js"] } },
      name: "obsidian",
    });
    const children: ChildProcess[] = [];
    let launchCount = 0;
    const manager = createOfficialPluginAppServiceManager({
      cwd: ".",
      harvestGraceMs: 200,
      logger: noopLogger(),
      plugins: [pluginMetadata(OBSIDIAN_PLUGIN_ID, true, fixtureRoot)],
      restartInitialDelayMs: 10,
      restartMaxDelayMs: 100,
      restartStableResetMs: Number.POSITIVE_INFINITY,
      spawnProcess: () => {
        launchCount += 1;
        // 前两次同步抛错（spawn 系统调用层失败面：平台限制/参数非法等）；
        // 第三次返回真实常驻子进程，验证退避后恢复。
        if (launchCount <= 2) throw new Error("boom");
        const child = spawn(process.execPath, ["-e", SLEEPER_SCRIPT], { stdio: "pipe" });
        children.push(child);
        return child;
      },
    });
    cleanups.push(() => manager.harvest());

    manager.start();
    // 第二次失败后的挂起重启窗内 attempts 必须已递增到 2：同步失败路径若不 +1
    // （本用例锁定的修复点），attempts 恒为 1，指数退避 2**attempts 失效。
    await waitFor(() => {
      const pending = manager.snapshot().find((entry) => entry.state === "restarting");
      return pending?.restarts === 2;
    });
    await waitFor(() => launchCount >= 3 && children[0]?.pid !== undefined);
    const snapshot = manager.snapshot();
    expect(snapshot[0]?.state).toBe("running");
    expect(snapshot[0]?.restarts).toBe(2);
  });

  it("退出收割：SIGTERM 终止常驻实例、幂等且取消挂起的重启", async () => {
    const fixtureRoot = await writePluginRoot({
      mcpServers: { knowledge: { command: "node", args: ["server.js"] } },
      name: "obsidian",
    });
    const children: ChildProcess[] = [];
    let launchCount = 0;
    const manager = createOfficialPluginAppServiceManager({
      cwd: ".",
      harvestGraceMs: 200,
      logger: noopLogger(),
      plugins: [pluginMetadata(OBSIDIAN_PLUGIN_ID, true, fixtureRoot)],
      restartInitialDelayMs: 250,
      restartMaxDelayMs: 250,
      restartStableResetMs: Number.POSITIVE_INFINITY,
      spawnProcess: () => {
        const script = launchCount === 0 ? SLEEPER_SCRIPT : CRASHER_SCRIPT;
        launchCount += 1;
        const child = spawn(process.execPath, ["-e", script], { stdio: "pipe" });
        children.push(child);
        return child;
      },
    });

    manager.start();
    await waitFor(() => children[0]?.pid !== undefined);
    await manager.harvest();
    expect(children[0]?.signalCode ?? children[0]?.exitCode).not.toBeNull();
    // 幂等：二次收割立即完成、无副作用。
    await manager.harvest();

    // 收割取消挂起的重启：崩溃发生在收割之后，250ms 重启窗内不得再拉起。
    const restartManager = createOfficialPluginAppServiceManager({
      cwd: ".",
      harvestGraceMs: 200,
      logger: noopLogger(),
      plugins: [pluginMetadata(OBSIDIAN_PLUGIN_ID, true, fixtureRoot)],
      restartInitialDelayMs: 250,
      restartMaxDelayMs: 250,
      restartStableResetMs: Number.POSITIVE_INFINITY,
      spawnProcess: () => {
        const child = spawn(process.execPath, ["-e", CRASHER_SCRIPT], { stdio: "pipe" });
        children.push(child);
        return child;
      },
    });
    restartManager.start();
    await waitFor(() => children.some((child) => child.exitCode === 1));
    // 首个实例崩溃时收割尚未开始：此时会计划一次重启；随后的收割必须清掉它。
    await delay(50);
    await restartManager.harvest();
    const spawnsBefore = children.length;
    await delay(400);
    expect(children.length).toBe(spawnsBefore);
    cleanups.push(() => restartManager.harvest());
    cleanups.push(() => manager.harvest());
  });

  it("P1 声明面：仅 obsidian 声明 appService 且指向 knowledge（P3 清单条目名）", () => {
    const declaring = OFFICIAL_PLUGIN_DEFINITIONS.filter((definition) => definition.appService);
    expect(declaring.map((definition) => definition.name)).toEqual(["obsidian"]);
    expect(resolveOfficialPluginAppService(OFFICIAL_OBSIDIAN_PLUGIN_ID)).toEqual({
      server: "knowledge",
    });
    // 非官方 id / 未声明 id 反查安全返回 undefined。
    expect(resolveOfficialPluginAppService("browser-use@drora-plugins-official")).toBeUndefined();
    expect(resolveOfficialPluginAppService("unknown@other")).toBeUndefined();
  });
});

function pluginMetadata(id: string, enabled: boolean, rootPath?: string): PluginMetadata {
  const [name = id, marketplace = "test"] = id.split("@");
  // rootPath 缺省时给独立 tmpdir（不存在的清单路径 = 惰性跳过语义本身）；
  // 生命周期用例传入 fixture root，使启动链能读到 fixture manifest。
  const resolvedRoot = rootPath ?? join(tmpdir(), `drora-app-service-root-${name}`);
  return {
    commandRootCount: 0,
    components: [],
    dataPath: join(resolvedRoot, "data"),
    declaredMcpServerNames: [],
    enabled,
    hookDetails: [],
    id,
    manifestPath: join(resolvedRoot, ".zcode-plugin/plugin.json"),
    marketplace,
    mcpServerNames: [],
    name,
    rootPath: resolvedRoot,
    skillCount: 0,
    skillRootCount: 0,
    source: "official",
  };
}

async function writePluginRoot(manifest: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "drora-app-service-"));
  cleanups.push(async () => {
    await rm(root, { force: true, recursive: true });
  });
  await mkdir(dirname(join(root, ".zcode-plugin", "plugin.json")), { recursive: true });
  await writeFile(join(root, ".zcode-plugin", "plugin.json"), `${JSON.stringify(manifest)}\n`);
  return root;
}

function noopLogger(): Logger {
  const noop = () => {};
  const logger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  return logger;
}

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("app service condition not met in time");
    }
    await delay(10);
  }
}
