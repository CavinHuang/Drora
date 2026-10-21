import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRORA_AGENT_RUNTIME,
  DRORA_RUNTIME_ENV_KEY,
  hostResponseMessageSchema,
} from "@drora/shared";
import {
  DRORA_PROCESS_DIAGNOSTIC_PREFIX,
  DRORA_AGENT_LIFECYCLE_LOG_MARKER,
} from "@drora/shared/process-diagnostic";
import {
  buildE2EAgentCoverageEnv,
  resolveDefaultDroraAgentCommand,
  wrapDroraAgentCommandWithStdioTapDevProxy,
  DroraAgentProcessManager,
  type DroraAgentCommand,
} from "../src/drora-agent/droraAgentProcessManager.js";
import { setDataBaseDir } from "../src/paths.js";
import type {
  RuntimeProcessLifecycleReporter,
  RuntimeProcessExceptionEvent,
} from "../src/process/runtimeProcessLifecycle.js";
import { setDroraStdioTapDevEnabled } from "../src/drora-agent/droraStdioTapDevConfig.js";
import { DroraStdioTransport } from "../src/drora-agent/droraStdioTransport.js";
import { CuaAgentAdmissionGate } from "../src/cua-permission-broker/cuaAgentAdmissionGate.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("E2E agent coverage", () => {
  it("在 CLI bundle 解析前安装 coverage signal preload", () => {
    const artifactDir = mkdtempSync(join(tmpdir(), "drora-agent-coverage-"));
    try {
      const env = buildE2EAgentCoverageEnv({
        NODE_OPTIONS: "--trace-warnings",
        DRORA_E2E_ARTIFACT_DIR: artifactDir,
        DRORA_E2E_COVERAGE: "1",
      });
      const preloadPath = join(
        artifactDir,
        "coverage",
        "raw",
        "cli",
        "drora-e2e-coverage-preload.cjs",
      );

      expect(env).toEqual({
        NODE_OPTIONS: `--trace-warnings --require=${JSON.stringify(preloadPath)}`,
        NODE_V8_COVERAGE: dirname(preloadPath),
      });
      expect(readFileSync(preloadPath, "utf8")).toContain("takeCoverage");
      expect(readFileSync(preloadPath, "utf8")).toContain("coverage-ready-");
      expect(readFileSync(preloadPath, "utf8")).toContain("coverageFlushStarted");
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });
});

describe("resolveDefaultDroraAgentCommand", () => {
  const desktopSurfaceArgsCases = [
    {
      name: "separate surface value",
      input: ["app-server", "--surface", "terminal", "--stdio"],
      expected: ["app-server", "--stdio", "--surface", "desktop"],
    },
    {
      name: "equals surface value",
      input: ["app-server", "--surface=terminal", "--stdio"],
      expected: ["app-server", "--stdio", "--surface", "desktop"],
    },
    {
      name: "orphan surface before another option",
      input: ["app-server", "--surface", "--stdio"],
      expected: ["app-server", "--stdio", "--surface", "desktop"],
    },
    {
      name: "trailing orphan surface",
      input: ["app-server", "--surface"],
      expected: ["app-server", "--surface", "desktop"],
    },
  ] as const;

  const originalCwd = process.cwd();
  const originalCommand = process.env.DRORA_AGENT_SERVER_COMMAND;
  const originalArgsJson = process.env.DRORA_AGENT_SERVER_ARGS_JSON;
  const originalCwdEnv = process.env.DRORA_AGENT_SERVER_CWD;
  const originalBinaryEnv = process.env[DRORA_AGENT_RUNTIME.binaryEnvVar];
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRuntimeEnv = process.env[DRORA_RUNTIME_ENV_KEY];
  const originalBytecodeEnv = process.env.DRORA_DESKTOP_AGENT_BYTECODE;
  const originalElectronVersion = Object.getOwnPropertyDescriptor(process.versions, "electron");
  const createdDirs: string[] = [];

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  }

  beforeEach(() => {
    delete process.env.DRORA_DESKTOP_AGENT_BYTECODE;
    // 修复原因：stdio tap 开关持久化在用户真实配置目录中。测试若直接读取该目录，
    // 本机开启抓包后会意外包装临时 Node agent，导致用例结果依赖用户环境。
    const dataBaseDir = mkdtempSync(join(tmpdir(), "drora-agent-manager-data-"));
    createdDirs.push(dataBaseDir);
    setDataBaseDir(dataBaseDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    restoreEnv("DRORA_AGENT_SERVER_COMMAND", originalCommand);
    restoreEnv("DRORA_AGENT_SERVER_ARGS_JSON", originalArgsJson);
    restoreEnv("DRORA_AGENT_SERVER_CWD", originalCwdEnv);
    restoreEnv(DRORA_AGENT_RUNTIME.binaryEnvVar, originalBinaryEnv);
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv(DRORA_RUNTIME_ENV_KEY, originalRuntimeEnv);
    restoreEnv("DRORA_DESKTOP_AGENT_BYTECODE", originalBytecodeEnv);
    if (originalElectronVersion)
      Object.defineProperty(process.versions, "electron", originalElectronVersion);
    else delete process.versions.electron;
    setDataBaseDir(null);

    // Windows: 等待子进程退出后再删除目录
    await new Promise((resolve) => setTimeout(resolve, 100));

    for (const dir of createdDirs.splice(0).reverse()) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows 有时仍会有权限问题，忽略即可
      }
    }
  });

  it("内置 dist drora-agent 通过 Electron Node 模式启动", () => {
    delete process.env.DRORA_AGENT_SERVER_COMMAND;
    delete process.env.DRORA_AGENT_SERVER_ARGS_JSON;
    delete process.env.DRORA_AGENT_SERVER_CWD;

    const sandboxRoot = mkdtempSync(join(tmpdir(), "drora-agent-default-command-"));
    createdDirs.push(sandboxRoot);

    const appRepoDir = join(sandboxRoot, "drora");
    const desktopDir = join(appRepoDir, "packages", "desktop");
    const distEntrypoint = join(
      appRepoDir,
      "apps",
      "drora-cli",
      "packages",
      "cli",
      "dist",
      "drora.cjs",
    );
    mkdirSync(desktopDir, { recursive: true });
    mkdirSync(dirname(distEntrypoint), { recursive: true });
    writeFileSync(distEntrypoint, "console.log('drora agent');\n");

    process.chdir(desktopDir);

    const command = resolveDefaultDroraAgentCommand({
      workspacePath: "/repo/workspace",
      workspaceKey: "/repo/workspace",
    });

    expect(command).toEqual({
      supportsStorageStartup: true,
      storagePreparationEntry: expect.any(String),
      command: process.execPath,
      args: [expect.any(String), "app-server", "--stdio"],
      cwd: "/repo/workspace",
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    expect(realpathSync(command!.args![0]!)).toBe(realpathSync(distEntrypoint));
    expect(realpathSync(command!.storagePreparationEntry!)).toBe(realpathSync(distEntrypoint));
  });

  it.each([
    [false, true],
    [true, true],
    [true, false],
  ])(
    "字节码开关只替换 Electron 的 stdio 入口，保留存储 Worker JS 入口：electron=%s enabled=%s",
    (electron, enabled) => {
      delete process.env.DRORA_AGENT_SERVER_COMMAND;
      process.env.DRORA_DESKTOP_AGENT_BYTECODE = enabled ? "1" : "0";
      Object.defineProperty(process.versions, "electron", {
        configurable: true,
        value: electron ? "41.0.3" : undefined,
      });
      const root = mkdtempSync(join(tmpdir(), "drora-bytecode-resolver-"));
      createdDirs.push(root);
      const source = join(root, "apps/drora-cli/packages/cli/dist/drora.cjs");
      const bytecode = join(dirname(source), "drora.bytecode.cjs");
      mkdirSync(dirname(source), { recursive: true });
      writeFileSync(source, "");
      writeFileSync(bytecode, "");
      process.chdir(root);
      const command = resolveDefaultDroraAgentCommand({
        workspacePath: root,
        workspaceKey: root,
        presentationSurface: "desktop",
      });
      expect(realpathSync(command!.args![0]!)).toBe(
        realpathSync(electron && enabled ? bytecode : source),
      );
      expect(command!.args!.slice(1)).toEqual(["app-server", "--stdio", "--surface", "desktop"]);
      expect(realpathSync(command!.storagePreparationEntry!)).toBe(realpathSync(source));
      expect(command!.supportsStorageStartup).toBe(true);
    },
  );

  it("字节码入口缺失时拒绝静默回退 JS", () => {
    delete process.env.DRORA_AGENT_SERVER_COMMAND;
    process.env.DRORA_DESKTOP_AGENT_BYTECODE = "1";
    Object.defineProperty(process.versions, "electron", { configurable: true, value: "41.0.3" });
    const root = mkdtempSync(join(tmpdir(), "drora-bytecode-missing-"));
    createdDirs.push(root);
    const source = join(root, "apps/drora-cli/packages/cli/dist/drora.cjs");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, "");
    process.chdir(root);
    expect(() =>
      resolveDefaultDroraAgentCommand({ workspacePath: root, workspaceKey: root }),
    ).toThrow(/字节码入口缺失/);
  });

  it("Desktop surface 会显式传给默认 app-server 命令", () => {
    delete process.env.DRORA_AGENT_SERVER_COMMAND;
    delete process.env.DRORA_AGENT_SERVER_ARGS_JSON;
    delete process.env.DRORA_AGENT_SERVER_CWD;

    const sandboxRoot = mkdtempSync(join(tmpdir(), "drora-agent-desktop-surface-"));
    createdDirs.push(sandboxRoot);

    const appRepoDir = join(sandboxRoot, "drora");
    const desktopDir = join(appRepoDir, "packages", "desktop");
    const distEntrypoint = join(
      appRepoDir,
      "apps",
      "drora-cli",
      "packages",
      "cli",
      "dist",
      "drora.cjs",
    );
    mkdirSync(desktopDir, { recursive: true });
    mkdirSync(dirname(distEntrypoint), { recursive: true });
    writeFileSync(distEntrypoint, "console.log('drora agent');\n");

    process.chdir(desktopDir);

    const command = resolveDefaultDroraAgentCommand({
      presentationSurface: "desktop",
      workspacePath: "/repo/workspace",
      workspaceKey: "/repo/workspace",
    });

    expect(command?.args).toEqual([
      expect.any(String),
      "app-server",
      "--stdio",
      "--surface",
      "desktop",
    ]);
  });

  it.each(desktopSurfaceArgsCases)(
    "Desktop surface 归一化 $name 时不吞掉无关参数",
    ({ input, expected }) => {
      process.env.DRORA_AGENT_SERVER_COMMAND = "drora-agent";
      process.env.DRORA_AGENT_SERVER_ARGS_JSON = JSON.stringify(input);

      const command = resolveDefaultDroraAgentCommand({
        presentationSurface: "desktop",
        workspacePath: "/repo/workspace",
        workspaceKey: "/repo/workspace",
      });

      expect(command).toMatchObject({
        command: "drora-agent",
        args: expected,
      });
    },
  );

  it("monorepo 不可达时回退到已部署原生 binary", () => {
    delete process.env.DRORA_AGENT_SERVER_COMMAND;
    delete process.env.DRORA_AGENT_SERVER_ARGS_JSON;
    delete process.env.DRORA_AGENT_SERVER_CWD;

    // Bugfix: SSH 远端把 drora-server.cjs 部署到 ~/.drora/server/，cwd 不在仓库内、
    // DRORA_AGENT_SERVER_COMMAND 也没设；旧 resolver 只识别 env 和 monorepo 源码树，
    // 即使 drora-agent 已部署到 ~/.drora/server/agents/glm/，resolver 也找不到。
    // 这里用 GLM_BINARY_PATH（=runtime.binaryEnvVar）模拟该部署场景，
    // 验证 resolver 复用 findDroraAgentRuntimeBinary 命中已部署 binary。
    const sandboxRoot = mkdtempSync(join(tmpdir(), "drora-agent-deployed-binary-"));
    createdDirs.push(sandboxRoot);

    const binaryPath = join(sandboxRoot, "drora-agent");
    writeFileSync(binaryPath, "#!/bin/sh\necho drora-agent\n");

    process.env[DRORA_AGENT_RUNTIME.binaryEnvVar] = binaryPath;
    process.chdir(sandboxRoot);

    const command = resolveDefaultDroraAgentCommand({
      workspacePath: "/repo/workspace",
      workspaceKey: "/repo/workspace",
    });

    expect(command).toEqual({
      command: binaryPath,
      args: DRORA_AGENT_RUNTIME.spawnArgs,
      cwd: "/repo/workspace",
    });
  });

  it("并发启动同一 workspace 时只创建一个 client", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-"));
    createdDirs.push(workspacePath);
    const command = createDeferred<DroraAgentCommand>();
    const commandResolver = vi.fn(() => command.promise);
    const manager = new DroraAgentProcessManager({ commandResolver });

    const first = manager.getClient({ workspacePath });
    const second = manager.getClient({ workspacePath });
    await Promise.resolve();

    expect(commandResolver).toHaveBeenCalledTimes(1);

    command.resolve({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: workspacePath,
    });

    const [firstClient, secondClient] = await Promise.all([first, second]);
    expect(firstClient).toBe(secondClient);
    expect(commandResolver).toHaveBeenCalledTimes(1);

    manager.disposeAll();
  });

  it("Helper 恢复期不会 spawn，commit 后只允许同一 pending start 继续", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-cua-admission-"));
    createdDirs.push(workspacePath);
    const gate = new CuaAgentAdmissionGate();
    const recoveryEpoch = gate.beginRecovery();
    const commandResolver = vi.fn<() => DroraAgentCommand>(() => ({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: workspacePath,
    }));
    const manager = new DroraAgentProcessManager({
      commandResolver,
      waitForSpawnAdmission: (context) => gate.waitForSpawnAdmission(context),
    });

    const first = manager.getClient({ workspacePath });
    const second = manager.getClient({ workspacePath });
    await Promise.resolve();
    expect(commandResolver).toHaveBeenCalledTimes(1);
    expect(gate.isRecovering()).toBe(true);

    gate.commitRecovery(recoveryEpoch);
    const [firstClient, secondClient] = await Promise.all([first, second]);
    expect(firstClient).toBe(secondClient);
    expect(commandResolver).toHaveBeenCalledTimes(1);

    await manager.disposeAllAndWait();
  });

  it("workspace dispose 不会遗失 pending start，旧代际不能在恢复后 spawn", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-cua-dispose-"));
    createdDirs.push(workspacePath);
    const command = createDeferred<DroraAgentCommand>();
    const gate = new CuaAgentAdmissionGate();
    const recoveryEpoch = gate.beginRecovery();
    const manager = new DroraAgentProcessManager({
      commandResolver: () => command.promise,
      waitForSpawnAdmission: (context) => gate.waitForSpawnAdmission(context),
    });

    const starting = manager.getClient({ workspacePath });
    await Promise.resolve();
    command.resolve({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: workspacePath,
    });
    await vi.waitFor(() => expect(gate.isRecovering()).toBe(true));

    const duplicate = manager.getClient({ workspacePath });
    await manager.disposeWorkspace({ workspacePath });
    gate.commitRecovery(recoveryEpoch);

    await expect(starting).rejects.toThrow("Drora agent process start was cancelled.");
    await expect(duplicate).rejects.toThrow("Drora agent process start was cancelled.");
    await expect(manager.getClient({ workspacePath })).resolves.toBeDefined();

    await manager.disposeAllAndWait();
  });

  it("把宿主声明的 presentation surface 传给 command resolver", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-surface-"));
    createdDirs.push(workspacePath);
    const commandResolver = vi.fn(() => null);
    const manager = new DroraAgentProcessManager({
      commandResolver,
      presentationSurface: "desktop",
    });

    await manager.canStart({ workspacePath });

    expect(commandResolver).toHaveBeenCalledWith({
      presentationSurface: "desktop",
      workspacePath,
      workspaceKey: workspacePath,
    });
  });

  it("workspace cleanup 抛错后重试并允许重新拉起 agent", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-restart-"));
    createdDirs.push(workspacePath);
    const commandResolver = vi.fn<() => DroraAgentCommand>(() => ({
      command: process.execPath,
      args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));"],
      cwd: workspacePath,
    }));
    const manager = new DroraAgentProcessManager({ commandResolver });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const firstClient = await manager.getClient({ workspacePath });
    const disposeAndWait = firstClient.disposeAndWait.bind(firstClient);
    let cleanupAttemptCount = 0;
    vi.spyOn(firstClient, "disposeAndWait").mockImplementation(async () => {
      cleanupAttemptCount += 1;
      if (cleanupAttemptCount === 1) {
        throw new Error("simulated process tree residual");
      }
      await disposeAndWait();
    });

    await expect(manager.disposeWorkspace({ workspacePath })).resolves.toBeUndefined();
    const secondClient = await manager.getClient({ workspacePath });

    expect(secondClient).not.toBe(firstClient);
    expect(cleanupAttemptCount).toBe(2);
    expect(commandResolver).toHaveBeenCalledTimes(2);
    expect(
      errorSpy.mock.calls.some((args) =>
        args.some((arg) => String(arg).includes("Drora agent process cleanup failed")),
      ),
    ).toBe(false);

    errorSpy.mockRestore();
    manager.disposeAll();
  });

  it("Host 在每次 Worker 启动时注入所属 Environment 的 Provider Config 路径", async ({
    signal,
  }) => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-provider-env-"));
    createdDirs.push(workspacePath);
    const droraBuiltinFilePath = join(workspacePath, "drora-builtin.json");
    const personalFilePath = join(workspacePath, "personal.json");
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: [
          "-e",
          `
require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id: request.id, result: {
    official: process.env.DRORA_BUILTIN_PROVIDER_CONFIG_FILE,
    personal: process.env.DRORA_PERSONAL_PROVIDER_CONFIG_FILE,
  } }) + "\\n");
});
`,
        ],
        cwd: workspacePath,
      }),
      resolveSpawnEnv: () => ({
        DRORA_BUILTIN_PROVIDER_CONFIG_FILE: droraBuiltinFilePath,
        DRORA_PERSONAL_PROVIDER_CONFIG_FILE: personalFilePath,
      }),
    });

    try {
      const client = await manager.getClient({ workspacePath });
      // 修复原因：getClient 仅完成进程创建，不保证 Worker 已执行；默认 1 秒文件轮询
      // 会把慢启动误判为 env 丢失。通过真实 stdio 响应读取 Worker 看到的配置。
      await expect(
        client.request("workspace/readState", {}, undefined, { signal }),
      ).resolves.toEqual({
        official: droraBuiltinFilePath,
        personal: personalFilePath,
      });
    } finally {
      await manager.disposeAllAndWait();
    }
  });

  it("查询 dormant workspace runtime identity 不会隐式启动 agent", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-dormant-runtime-"));
    createdDirs.push(workspacePath);
    const commandResolver = vi.fn<() => DroraAgentCommand>(() => ({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: workspacePath,
    }));
    const manager = new DroraAgentProcessManager({ commandResolver });
    await expect(manager.getRuntimeIdentity({ workspacePath })).rejects.toThrow(
      "Drora agent runtime identity is unavailable.",
    );
    expect(commandResolver).not.toHaveBeenCalled();

    manager.disposeAll();
  });

  it("transport 首轮进程树回收误报残留时重试并允许重新拉起 agent", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-recycle-retry-"));
    createdDirs.push(workspacePath);
    const commandResolver = vi.fn<() => DroraAgentCommand>(() => ({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: workspacePath,
    }));
    const manager = new DroraAgentProcessManager({ commandResolver });
    const originalDisposeAndWait = DroraStdioTransport.prototype.disposeAndWait;
    const disposeAndWaitSpy = vi
      .spyOn(DroraStdioTransport.prototype, "disposeAndWait")
      .mockRejectedValueOnce(
        new Error("runtime process tree cleanup incomplete; remaining pid=12345"),
      )
      .mockImplementation(function (this: DroraStdioTransport) {
        return originalDisposeAndWait.call(this);
      });

    try {
      const firstClient = await manager.getClient({ workspacePath });
      await expect(manager.disposeWorkspace({ workspacePath })).resolves.toBeUndefined();
      const secondClient = await manager.getClient({ workspacePath });

      expect(disposeAndWaitSpy).toHaveBeenCalledTimes(2);
      expect(secondClient).not.toBe(firstClient);
      expect(commandResolver).toHaveBeenCalledTimes(2);
    } finally {
      disposeAndWaitSpy.mockRestore();
      await manager.disposeAllAndWait();
    }
  });

  it("重启单个 workspace 后 runtime identity 会变化", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-runtime-"));
    createdDirs.push(workspacePath);
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000);"],
        cwd: workspacePath,
      }),
    });

    await manager.getClient({ workspacePath });
    const firstIdentity = await manager.getRuntimeIdentity({ workspacePath });
    const repeatedIdentity = await manager.getRuntimeIdentity({
      workspacePath,
    });
    await manager.disposeWorkspace({ workspacePath });
    await manager.getClient({ workspacePath });
    const secondIdentity = await manager.getRuntimeIdentity({ workspacePath });

    expect(repeatedIdentity.identity).toBe(firstIdentity.identity);
    expect(secondIdentity.identity).not.toBe(firstIdentity.identity);
    expect(secondIdentity.generation).toBeGreaterThan(firstIdentity.generation);

    manager.disposeAll();
  });

  // M5 ③-2（CLI 重连重订）：进程换代要广播 onRuntimeRestarted，v4 订阅方据此重订；
  // 首次拉起（generation=1）不广播，避免启动期误触发无意义的重订。
  it("进程换代（generation>1）广播 onRuntimeRestarted，首次拉起不广播", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-restart-evt-"));
    createdDirs.push(workspacePath);
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000);"],
        cwd: workspacePath,
      }),
    });
    const restarts: Array<{ workspaceKey: string; generation: number }> = [];
    manager.onRuntimeRestarted((event) => {
      restarts.push({
        workspaceKey: event.workspaceKey,
        generation: event.runtimeIdentity.generation,
      });
    });

    await manager.getClient({ workspacePath });
    await new Promise((resolve) => setImmediate(resolve));
    expect(restarts).toEqual([]);

    await manager.disposeWorkspace({ workspacePath });
    await manager.getClient({ workspacePath });
    await new Promise((resolve) => setImmediate(resolve));
    expect(restarts).toEqual([{ workspaceKey: workspacePath, generation: 2 }]);

    manager.disposeAll();
  });

  it("换代进程 spawn 失败时不广播 onRuntimeRestarted", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-restart-failed-"));
    createdDirs.push(workspacePath);
    let command: DroraAgentCommand = {
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      cwd: workspacePath,
    };
    const manager = new DroraAgentProcessManager({
      commandResolver: () => command,
    });
    const restarts: number[] = [];
    manager.onRuntimeRestarted((event) => restarts.push(event.runtimeIdentity.generation));

    await manager.getClient({ workspacePath });
    await manager.disposeWorkspace({ workspacePath });
    command = {
      command: join(workspacePath, "missing-drora-agent"),
      args: ["app-server", "--stdio"],
      cwd: workspacePath,
    };
    await manager.getClient({ workspacePath });
    await new Promise((resolve) => setImmediate(resolve));

    expect(restarts).toEqual([]);
    manager.disposeAll();
  });

  it("关闭发生在启动中时不会继续 spawn agent", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-dispose-"));
    createdDirs.push(workspacePath);
    const markerPath = join(workspacePath, "spawned.txt");
    const command = createDeferred<DroraAgentCommand>();
    const manager = new DroraAgentProcessManager({
      commandResolver: () => command.promise,
    });

    const starting = manager.getClient({ workspacePath });
    await Promise.resolve();
    await manager.disposeAllAndWait();

    command.resolve({
      command: process.execPath,
      args: [
        "-e",
        `
require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "spawned");
setInterval(() => {}, 1000);
`,
      ],
      cwd: workspacePath,
    });

    // Bugfix: app 关闭期间 warmup 仍可能卡在 command/env resolve。
    // disposeAllAndWait 之后不允许这个启动 promise 继续 spawn，否则会绕过关闭快照留下孤儿进程。
    await expect(starting).rejects.toThrow("Drora agent process manager is disposed.");
    expect(existsSync(markerPath)).toBe(false);
  });

  it("protocol close 后仍回收 Host 已启动的全部 agent 进程", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-owned-"));
    createdDirs.push(workspacePath);
    const spawnedPids: number[] = [];
    const reporter = {
      onSpawn: vi.fn((event) => spawnedPids.push(event.pid)),
      onExit: vi.fn(),
    } satisfies RuntimeProcessLifecycleReporter;
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: [
          "-e",
          `setTimeout(() => process.stdout.write("not-json\\n"), 50); setInterval(() => {}, 1000);`,
        ],
        cwd: workspacePath,
      }),
      processLifecycleReporter: reporter,
    });

    try {
      const firstClient = await manager.getClient({ workspacePath });
      await new Promise<void>((resolve) => {
        const disposable = firstClient.onClose(() => {
          disposable.dispose();
          resolve();
        });
      });

      const secondClient = await manager.getClient({ workspacePath });
      await new Promise<void>((resolve) => {
        const disposable = secondClient.onClose(() => {
          disposable.dispose();
          resolve();
        });
      });

      expect(spawnedPids).toHaveLength(2);
      expect(new Set(spawnedPids).size).toBe(2);

      // 修复原因：protocol close 只表示该 client 不再可复用，不表示
      // OS 进程已退出。Host dispose 必须同时等待两代已启动进程完成回收。
      await manager.disposeAllAndWait();

      // 修复原因：进程树回收按 OS 存活状态完成，Node exit 事件及 stderr
      // 收尾后的生命周期上报可能稍晚投递；断言应等待上报，不能假定同步发生。
      // POSIX 上报前还可能查到僵尸 PID，等待上报后再核对进程确已退出。
      await vi.waitFor(() => expect(reporter.onExit).toHaveBeenCalledTimes(2));
      for (const pid of spawnedPids) {
        expect(() => process.kill(pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
      }
      expect(reporter.onExit.mock.calls.map(([event]) => event.pid).sort((a, b) => a - b)).toEqual(
        [...spawnedPids].sort((a, b) => a - b),
      );
      expect(reporter.onExit.mock.calls.map(([event]) => event.terminationKind)).toEqual([
        "unexpected",
        "unexpected",
      ]);
    } finally {
      manager.disposeAll();
      for (const pid of spawnedPids) {
        try {
          process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
        } catch {
          /* 测试兜底清理，进程已退出时忽略。 */
        }
      }
    }
  });

  it("关闭等待进程退出后的 stderr 和生命周期诊断完成", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-exit-drain-"));
    createdDirs.push(workspacePath);
    const stderrReleased = createDeferred<void>();
    const processDisposed = createDeferred<void>();
    const originalDrain = DroraStdioTransport.prototype.waitForStderrDrain;
    const drainSpy = vi
      .spyOn(DroraStdioTransport.prototype, "waitForStderrDrain")
      .mockImplementation(async function (this: DroraStdioTransport) {
        await originalDrain.call(this);
        await stderrReleased.promise;
      });
    const originalDispose = DroraStdioTransport.prototype.disposeAndWait;
    const disposeSpy = vi
      .spyOn(DroraStdioTransport.prototype, "disposeAndWait")
      .mockImplementation(async function (this: DroraStdioTransport) {
        await originalDispose.call(this);
        processDisposed.resolve();
      });
    const reporter = {
      onSpawn: vi.fn(),
      onExit: vi.fn(),
    } satisfies RuntimeProcessLifecycleReporter;
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: ["-e", "process.stdin.resume();"],
        cwd: workspacePath,
      }),
      processLifecycleReporter: reporter,
    });
    let closing: Promise<void> | undefined;
    try {
      await manager.getClient({ workspacePath });
      let closed = false;
      closing = manager.disposeAllAndWait().then(() => {
        closed = true;
      });
      await processDisposed.promise;
      // 进程确已回收，但诊断仍被显式阻塞；推进一个事件循环检查关闭是否提前返回。
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(reporter.onExit).not.toHaveBeenCalled();
      expect(closed).toBe(false);
      stderrReleased.resolve();
      await closing;
      expect(reporter.onExit).toHaveBeenCalledTimes(1);
    } finally {
      stderrReleased.resolve();
      await (closing ?? manager.disposeAllAndWait());
      drainSpy.mockRestore();
      disposeSpy.mockRestore();
    }
  });

  it("app quit 会重试先前失败的进程树回收", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-manager-cleanup-retry-"));
    createdDirs.push(workspacePath);
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: ["-e", "process.stdin.resume(); setInterval(() => {}, 1000);"],
        cwd: workspacePath,
      }),
    });

    const client = await manager.getClient({ workspacePath });
    const disposeAndWait = client.disposeAndWait.bind(client);
    let cleanupAttemptCount = 0;
    vi.spyOn(client, "disposeAndWait").mockImplementation(async () => {
      cleanupAttemptCount += 1;
      if (cleanupAttemptCount === 1) {
        throw new Error("simulated process tree residual");
      }
      await disposeAndWait();
    });

    try {
      // 修复原因：旧实现永久缓存失败的 cleanup Promise，app quit 再次等待时
      // 只会取得同一个 rejection，既不会 force 重试，也会提前释放退出边界。
      await manager.disposeAllAndWait();
      expect(cleanupAttemptCount).toBe(2);
    } finally {
      manager.disposeAll();
    }
  });

  it.for([
    {
      name: "未声明 DRORA_RUNTIME_ENV 时默认以 production 启动 agent 子进程且不传 NODE_ENV",
      nodeEnv: "development",
      runtimeEnv: undefined,
      expectedRuntimeEnv: "production",
    },
    {
      name: "显式 DRORA_RUNTIME_ENV=development 时保留 agent 子进程开发态",
      nodeEnv: undefined,
      runtimeEnv: "development",
      expectedRuntimeEnv: "development",
    },
  ])("$name", async ({ nodeEnv, runtimeEnv, expectedRuntimeEnv }, { signal }) => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-node-env-"));
    createdDirs.push(workspacePath);
    restoreEnv("NODE_ENV", nodeEnv);
    restoreEnv(DRORA_RUNTIME_ENV_KEY, runtimeEnv);
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: [
          "-e",
          `
require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id: request.id, result: {
    nodeEnv: process.env.NODE_ENV || "<empty>",
    runtimeEnv: process.env.DRORA_RUNTIME_ENV || "<empty>",
  } }) + "\\n");
});
`,
        ],
        cwd: workspacePath,
      }),
    });

    try {
      const client = await manager.getClient({ workspacePath });
      // 修复原因：文件轮询即使延长到 5 秒仍会在慢启动时失败；由 Worker 响应
      // 确认真实环境已读取，测试整体截止通过 signal 取消请求，不按启动耗时断言。
      await expect(
        client.request("workspace/readState", {}, undefined, { signal }),
      ).resolves.toEqual({
        nodeEnv: "<empty>",
        runtimeEnv: expectedRuntimeEnv,
      });
    } finally {
      await manager.disposeAllAndWait();
    }
  });

  it("通过生命周期 reporter 上报本地 agent spawn/exit", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-lifecycle-"));
    createdDirs.push(workspacePath);
    const reporter = {
      onSpawn: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
    } satisfies RuntimeProcessLifecycleReporter;
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: ["-e", "setTimeout(() => process.exit(7), 20);"],
        cwd: workspacePath,
      }),
      processLifecycleReporter: reporter,
    });

    try {
      await manager.getClient({ workspacePath });
      await vi.waitFor(() => expect(reporter.onSpawn).toHaveBeenCalledTimes(1));
      const spawnEvent = reporter.onSpawn.mock.calls[0]![0];
      expect(spawnEvent).toMatchObject({
        provider: "glm",
        workspacePath,
        command: process.execPath,
        args: ["-e", "setTimeout(() => process.exit(7), 20);"],
      });
      expect(spawnEvent.pid).toEqual(expect.any(Number));
      expect(spawnEvent.startedAt).toEqual(expect.any(Number));
      expect(spawnEvent.runtimeGeneration).toBe(1);
      expect(spawnEvent.runtimeInstanceId).toMatch(
        /^agent-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      await vi.waitFor(() => expect(reporter.onExit).toHaveBeenCalledTimes(1));
      expect(reporter.onExit.mock.calls[0]![0]).toMatchObject({
        pid: spawnEvent.pid,
        provider: "glm",
        workspacePath,
        exitCode: 7,
        signal: null,
        endedAt: expect.any(Number),
        terminationKind: "unexpected",
        runtimeReady: false,
        runtimeGeneration: 1,
        runtimeInstanceId: spawnEvent.runtimeInstanceId,
        uptimeMs: expect.any(Number),
        stderrLineCount: 0,
      });
      expect(reporter.onError).not.toHaveBeenCalled();
    } finally {
      manager.disposeAll();
    }
  });

  it("协议帧损坏后即使回收重试也保留 protocol-close 根因", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-protocol-close-"));
    createdDirs.push(workspacePath);
    const reporter = {
      onSpawn: vi.fn(),
      onExit: vi.fn(),
    } satisfies RuntimeProcessLifecycleReporter;
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        // 测试只验证 protocol-close 根因；让 stdin EOF 可收尾，避免完整测试并发时
        // PowerShell/CIM 定向复核受系统负载影响，把该用例误变成 cleanup deadline 测试。
        args: [
          "-e",
          'process.stdout.write("invalid-ndjson\\n"); process.stdin.resume(); process.stdin.on("end", () => process.exit(1));',
        ],
        cwd: workspacePath,
      }),
      processLifecycleReporter: reporter,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let cleanupAttemptCount = 0;

    try {
      const client = await manager.getClient({ workspacePath });
      const disposeAndWait = client.disposeAndWait.bind(client);
      vi.spyOn(client, "disposeAndWait").mockImplementation(async () => {
        cleanupAttemptCount += 1;
        if (cleanupAttemptCount === 1) {
          throw new Error("simulated protocol-close cleanup residual");
        }
        await disposeAndWait();
      });
      // Bug 根因：进程树回收包含有界 SIGTERM 等待窗口；全量并发单测下默认 1 秒
      // waitFor 会在真实 exit 事件到达前超时，造成仅在整套测试中出现的假失败。
      await vi.waitFor(() => expect(reporter.onExit).toHaveBeenCalledTimes(1), {
        timeout: 5_000,
      });

      expect(reporter.onExit.mock.calls[0]![0]).toMatchObject({
        terminationKind: "unexpected",
        terminationReason: "protocol-close",
      });
      await vi.waitFor(() => expect(cleanupAttemptCount).toBe(2));
      expect(
        errorSpy.mock.calls.some((args) =>
          args.some((arg) => String(arg).includes("Drora agent process cleanup failed")),
        ),
      ).toBe(false);
    } finally {
      errorSpy.mockRestore();
      await manager.disposeAllAndWait();
    }
  });

  it("观测超时保留真实 Agent，持续观测也不能阻止空闲回收", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-observation-"));
    createdDirs.push(workspacePath);
    const manager = new DroraAgentProcessManager({
      idleTimeoutMs: 250,
      commandResolver: () => ({
        command: process.execPath,
        cwd: workspacePath,
        args: [
          "-e",
          `
        require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
          const request = JSON.parse(line);
          if (request.method !== "process/childProcesses") process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + "\\n");
        });
      `,
        ],
      }),
    });
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      const client = await manager.getClient({ workspacePath });
      await client.request("workspace/readState", {});
      const pid = manager.listManagedProcesses()[0]!.pid;
      await expect(
        client.request("process/childProcesses", {}, undefined, {
          lifecycle: "observation",
          timeoutMs: 40,
        }),
      ).rejects.toThrow("timed out");
      expect(client.isDisposed).toBe(false);
      expect(manager.listManagedProcesses()[0]!.pid).toBe(pid);
      await client.request("workspace/readState", {});
      timer = setInterval(() => {
        void client
          .request("process/childProcesses", {}, undefined, {
            lifecycle: "observation",
            timeoutMs: 5_000,
          })
          .catch(() => {});
      }, 20);
      await vi.waitFor(() => expect(client.isDisposed).toBe(true), { timeout: 2_000 });
    } finally {
      if (timer) clearInterval(timer);
      await manager.disposeAllAndWait();
    }
  });

  it("旧启动请求结清后，仍在迁移的 Agent 不进入空闲回收", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-migration-idle-"));
    createdDirs.push(workspacePath);
    const manager = new DroraAgentProcessManager({
      idleTimeoutMs: 30,
      commandResolver: () => ({
        command: process.execPath,
        cwd: workspacePath,
        args: [
          "-e",
          `
          const send = value => process.stdout.write(JSON.stringify(value) + "\\n");
          const state = (phase, sequence) => send({method:"startup/storageState",params:{schemaVersion:1,attemptId:"a",databaseId:"db",databaseKind:"session",phase,sequence,elapsedMs:0}});
          let buffer = "";
          process.stdin.on("data", chunk => {
            buffer += chunk;
            const end = buffer.indexOf("\\n");
            if (end < 0) return;
            const request = JSON.parse(buffer.slice(0,end)); buffer = buffer.slice(end+1);
            state("migrating",1);
            send({id:request.id,result:{}});
            setTimeout(()=>state("ready",2),150);
          });
        `,
        ],
      }),
    });
    try {
      const client = await manager.getClient({ workspacePath });
      await client.request("workspace/readState", {});
      await client.storageStartup.wait();
      expect(client.storageStartup.snapshot?.phase).toBe("ready");
      await vi.waitFor(() => expect(client.isDisposed).toBe(true));
    } finally {
      await manager.disposeAllAndWait();
    }
  });

  it("主动回收 workspace 时把 agent 退出标为 expected", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-lifecycle-expected-"));
    createdDirs.push(workspacePath);
    const reporter = {
      onSpawn: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
    } satisfies RuntimeProcessLifecycleReporter;
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000);"],
        cwd: workspacePath,
      }),
      processLifecycleReporter: reporter,
    });

    try {
      await manager.getClient({ workspacePath });
      await vi.waitFor(() => expect(reporter.onSpawn).toHaveBeenCalledTimes(1));
      await manager.disposeWorkspace({ workspacePath });
      await vi.waitFor(() => expect(reporter.onExit).toHaveBeenCalledTimes(1));

      expect(reporter.onExit.mock.calls[0]![0]).toMatchObject({
        terminationKind: "expected",
        terminationReason: "workspace-dispose",
        runtimeGeneration: 1,
      });
      expect(reporter.onExit.mock.calls[0]![0].stderrTail).toBeUndefined();
    } finally {
      manager.disposeAll();
    }
  });

  it("只把 ready 绑定到返回该 client 的当前 runtime", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-ready-identity-"));
    createdDirs.push(workspacePath);
    const reporter = {
      onSpawn: vi.fn(),
      onReady: vi.fn(),
      onExit: vi.fn(),
    } satisfies RuntimeProcessLifecycleReporter;
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000);"],
        cwd: workspacePath,
      }),
      processLifecycleReporter: reporter,
    });

    try {
      const retiredClient = await manager.getClient({ workspacePath });
      await manager.disposeWorkspace({ workspacePath });
      const currentClient = await manager.getClient({ workspacePath });
      await vi.waitFor(() => expect(reporter.onSpawn).toHaveBeenCalledTimes(2));

      manager.markReady({ workspacePath }, retiredClient);
      expect(reporter.onReady).not.toHaveBeenCalled();

      manager.markReady({ workspacePath }, currentClient);
      manager.markReady({ workspacePath }, currentClient);
      expect(reporter.onReady).toHaveBeenCalledTimes(1);
      expect(reporter.onReady.mock.calls[0]![0]).toMatchObject({
        runtimeGeneration: 2,
        runtimeInstanceId: reporter.onSpawn.mock.calls[1]![0].runtimeInstanceId,
      });
    } finally {
      await manager.disposeAllAndWait();
    }
  });

  it("agent 非零退出时生产日志保留脱敏且有界的 stderr 尾部", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-stderr-tail-"));
    createdDirs.push(workspacePath);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exited = createDeferred<void>();
    const reporter = {
      onSpawn: vi.fn(),
      onExit: vi.fn<RuntimeProcessLifecycleReporter["onExit"]>(() => exited.resolve()),
      onError: vi.fn(),
    } satisfies RuntimeProcessLifecycleReporter;
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: [
          "-e",
          `process.stderr.write("Error: simulated EPIPE token=super-secret key=sk-1234567890abcdefghijklmnopqrstuv\\n"); process.exit(1);`,
        ],
        cwd: workspacePath,
      }),
      processLifecycleReporter: reporter,
    });

    try {
      await manager.getClient({ workspacePath });
      // 修复原因：启动和 stderr 排空可能超过默认 1 秒轮询窗口；onExit 在诊断
      // 日志写完后上报，以该事件作为断言屏障，避免提前清理仍未退出的夹具。
      await exited.promise;
      expect(errorSpy).toHaveBeenCalledWith(
        expect.any(String),
        `Drora agent process exited unexpectedly ${DRORA_AGENT_LIFECYCLE_LOG_MARKER}`,
        expect.objectContaining({
          workspaceKey: workspacePath,
          code: 1,
          signal: null,
          stderr: {
            lineCount: 1,
            tail: ["Error: simulated EPIPE token=<redacted> key=sk-<redacted>"],
          },
        }),
      );
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("super-secret");
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(
        "sk-1234567890abcdefghijklmnopqrstuv",
      );
      expect(reporter.onExit).toHaveBeenCalledTimes(1);
      expect(reporter.onExit.mock.calls[0]![0]).toMatchObject({
        terminationKind: "unexpected",
        stderrLineCount: 1,
        stderrTail: ["Error: simulated EPIPE token=<redacted> key=sk-<redacted>"],
      });
    } finally {
      await manager.disposeAllAndWait();
      errorSpy.mockRestore();
    }
  });

  it.each([false, true, "expanded"])(
    "生产态存活进程即时转发异常且隔离 reporter 失败（%s）",
    async (failReporter) => {
      vi.stubEnv("NODE_ENV", "production");
      const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-exception-"));
      createdDirs.push(workspacePath);
      const diagnostic = {
        version: 1,
        errorId: "1f51b7dc-c52a-46ad-bc97-d2f984e6e3de",
        kind: "uncaughtException",
        origin: "uncaughtException",
        name: "Error",
        message:
          failReporter === "expanded"
            ? "token=a ".repeat(500)
            : "boom token=private key=sk-1234567890abcdefghijklmnopqrstuv",
        stack: "Error: boom\n    at run (C:\\repo\\cli.js:1:2)",
        occurredAt: Date.now(),
      };
      const frame = DRORA_PROCESS_DIAGNOSTIC_PREFIX + JSON.stringify(diagnostic) + "\n";
      const reporter = {
        onSpawn: vi.fn(),
        onExit: vi.fn(),
        onException: vi.fn((_event: RuntimeProcessExceptionEvent) => {
          if (failReporter === true) throw new Error("IPC unavailable");
        }),
      } satisfies RuntimeProcessLifecycleReporter;
      const manager = new DroraAgentProcessManager({
        commandResolver: () => ({
          command: process.execPath,
          cwd: workspacePath,
          args: [
            "-e",
            `process.stderr.write(${JSON.stringify(frame)}); setInterval(() => {}, 1000);`,
          ],
        }),
        processLifecycleReporter: reporter,
      });
      try {
        const client = await manager.getClient({ workspacePath });
        await vi.waitFor(() => expect(reporter.onException).toHaveBeenCalledOnce());
        expect(reporter.onExit).not.toHaveBeenCalled();
        expect(await manager.getClient({ workspacePath })).toBe(client);
        expect(reporter.onException.mock.calls[0]?.[0]).toMatchObject({
          pid: reporter.onSpawn.mock.calls[0]?.[0].pid,
          runtimeInstanceId: reporter.onSpawn.mock.calls[0]?.[0].runtimeInstanceId,
          runtimeGeneration: 1,
          workspacePath,
          diagnostic: {
            ...diagnostic,
            message:
              failReporter === "expanded"
                ? "token=<redacted> ".repeat(500).slice(0, 4000)
                : "boom token=<redacted> key=sk-<redacted>",
          },
        });
        expect(
          hostResponseMessageSchema.safeParse({
            type: "agent-process-exception",
            ...reporter.onException.mock.calls[0]?.[0],
          }).success,
        ).toBe(true);
      } finally {
        await manager.disposeAllAndWait();
        vi.unstubAllEnvs();
      }
    },
  );

  it("生命周期 reporter 失败时不影响 agent 启动", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-lifecycle-safe-"));
    createdDirs.push(workspacePath);
    const reporter = {
      onSpawn: vi.fn(() => {
        throw new Error("reporter unavailable");
      }),
      onExit: vi.fn(),
      onError: vi.fn(),
    } satisfies RuntimeProcessLifecycleReporter;
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000);"],
        cwd: workspacePath,
      }),
      processLifecycleReporter: reporter,
    });

    try {
      await expect(manager.getClient({ workspacePath })).resolves.toBeTruthy();
      await vi.waitFor(() => expect(reporter.onSpawn).toHaveBeenCalledTimes(1));
    } finally {
      manager.disposeAll();
    }
  });

  it("生产日志记录 agent spawn 前的 command 和 cwd 可用性", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-spawn-preflight-"));
    createdDirs.push(workspacePath);
    const missingCommand = join(workspacePath, "missing-drora-agent");
    const missingCwd = join(workspacePath, "missing-workspace");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: missingCommand,
        args: ["app-server", "--stdio"],
        cwd: missingCwd,
      }),
    });

    try {
      await manager.getClient({ workspacePath });

      await vi.waitFor(() =>
        expect(logSpy).toHaveBeenCalledWith(
          expect.any(String),
          "Drora agent spawn preflight",
          expect.objectContaining({
            workspaceKey: workspacePath,
            spawnPreflight: expect.objectContaining({
              command: missingCommand,
              args: ["app-server", "--stdio"],
              cwd: missingCwd,
              cwdSource: "command",
              commandPathKind: "absolute",
              commandExists: false,
              cwdExists: false,
            }),
          }),
        ),
      );
      await vi.waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          expect.any(String),
          "Drora agent process error",
          expect.objectContaining({
            workspaceKey: workspacePath,
            errorMessage: expect.stringContaining("ENOENT"),
            spawnPreflight: expect.objectContaining({
              commandExists: false,
              cwdExists: false,
            }),
          }),
        ),
      );
    } finally {
      manager.disposeAll();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("非 active 历史 workspace 目录缺失时仅将 agent spawn cwd 兜底到 backing workspace", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "drora-agent-fallback-cwd-"));
    createdDirs.push(rootDir);
    const workspacePath = join(rootDir, "missing-workspace");
    const fallbackCwd = join(rootDir, ".drora", "workspace", "default");
    const markerPath = join(rootDir, "effective-cwd.txt");
    mkdirSync(fallbackCwd, { recursive: true });
    const commandResolver = vi.fn(
      ({ workspacePath: requestedWorkspacePath }: { workspacePath: string }) => ({
        command: process.execPath,
        args: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, process.cwd()); setInterval(() => {}, 1000);`,
        ],
        cwd: requestedWorkspacePath,
      }),
    );
    const manager = new DroraAgentProcessManager({
      commandResolver,
      spawnFallbackCwd: fallbackCwd,
    });

    try {
      await manager.getClient({ workspacePath });
      const runtimeIdentity = await manager.getRuntimeIdentity({
        workspacePath,
      });
      await vi.waitFor(() => expect(existsSync(markerPath)).toBe(true));

      expect(realpathSync(readFileSync(markerPath, "utf-8"))).toBe(realpathSync(fallbackCwd));
      expect(runtimeIdentity.workspaceKey).toBe(workspacePath);
      expect(commandResolver).toHaveBeenCalledWith({
        workspacePath,
        workspaceKey: workspacePath,
      });
      expect(existsSync(workspacePath)).toBe(false);
    } finally {
      manager.disposeAll();
    }
  });

  it("显式自定义 cwd 与 workspace 不同时不使用 fallback cwd", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "drora-agent-custom-cwd-"));
    createdDirs.push(rootDir);
    const workspacePath = join(rootDir, "missing-workspace");
    const fallbackCwd = join(rootDir, "DroraProject");
    const customCwd = join(rootDir, "custom-runtime-cwd");
    const markerPath = join(rootDir, "effective-cwd.txt");
    mkdirSync(fallbackCwd);
    mkdirSync(customCwd);
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: process.execPath,
        args: [
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, process.cwd()); setInterval(() => {}, 1000);`,
        ],
        cwd: customCwd,
      }),
      spawnFallbackCwd: fallbackCwd,
    });

    try {
      await manager.getClient({ workspacePath });
      await vi.waitFor(() => expect(existsSync(markerPath)).toBe(true));
      expect(realpathSync(readFileSync(markerPath, "utf-8"))).toBe(realpathSync(customCwd));
    } finally {
      manager.disposeAll();
    }
  });

  it("通过生命周期 reporter 上报 agent spawn error", async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), "drora-agent-lifecycle-error-"));
    createdDirs.push(workspacePath);
    const missingCommand = join(workspacePath, "missing-drora-agent");
    const reporter = {
      onSpawn: vi.fn(),
      onExit: vi.fn(),
      onError: vi.fn(),
    } satisfies RuntimeProcessLifecycleReporter;
    const manager = new DroraAgentProcessManager({
      commandResolver: () => ({
        command: missingCommand,
        args: ["app-server", "--stdio"],
        cwd: workspacePath,
      }),
      processLifecycleReporter: reporter,
    });

    try {
      await manager.getClient({ workspacePath });
      await vi.waitFor(() => expect(reporter.onError).toHaveBeenCalledTimes(1));
      expect(reporter.onError.mock.calls[0]![0]).toMatchObject({
        pid: null,
        provider: "glm",
        workspacePath,
        command: missingCommand,
        args: ["app-server", "--stdio"],
        errorName: "Error",
        errorCode: "ENOENT",
        errorStack: expect.any(String),
        runtimeGeneration: 1,
        runtimeInstanceId: expect.stringMatching(/^agent-[0-9a-f-]{36}$/),
        occurredAt: expect.any(Number),
      });
      expect(reporter.onError.mock.calls[0]![0].errorMessage).toContain("ENOENT");
    } finally {
      manager.disposeAll();
    }
  });

  it("开发态 stdio tap 开启时用旁路 proxy 包装 agent 命令", () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), "drora-agent-stdio-tap-"));
    createdDirs.push(sandboxRoot);
    const tapScript = join(sandboxRoot, "scripts", "dev", "drora-stdio-tap.mjs");
    mkdirSync(dirname(tapScript), { recursive: true });
    writeFileSync(tapScript, "#!/usr/bin/env node\n");
    process.chdir(sandboxRoot);
    process.env[DRORA_RUNTIME_ENV_KEY] = "development";
    setDataBaseDir(sandboxRoot);
    setDroraStdioTapDevEnabled(true);

    const wrapped = wrapDroraAgentCommandWithStdioTapDevProxy(
      {
        command: "drora-agent",
        args: ["app-server", "--stdio"],
        cwd: "/repo/workspace",
        env: { CUSTOM_ENV: "1" },
      },
      "/repo/workspace",
    );

    expect(wrapped).toEqual({
      command: process.execPath,
      args: [
        realpathSync(tapScript),
        "--workspace-key",
        "/repo/workspace",
        "--log-dir",
        join(sandboxRoot, ".drora", "v2", "dev", "stdio-traffic"),
        "--",
        "drora-agent",
        "app-server",
        "--stdio",
      ],
      cwd: "/repo/workspace",
      env: {
        CUSTOM_ENV: "1",
        ELECTRON_RUN_AS_NODE: "1",
      },
    });
  });

  it.each(desktopSurfaceArgsCases)(
    "Desktop 自定义命令经 stdio tap proxy 后保留 $name 的参数",
    ({ input, expected }) => {
      const sandboxRoot = mkdtempSync(join(tmpdir(), "drora-agent-stdio-tap-surface-"));
      createdDirs.push(sandboxRoot);
      const tapScript = join(sandboxRoot, "scripts", "dev", "drora-stdio-tap.mjs");
      mkdirSync(dirname(tapScript), { recursive: true });
      writeFileSync(tapScript, "#!/usr/bin/env node\n");
      process.chdir(sandboxRoot);
      process.env[DRORA_RUNTIME_ENV_KEY] = "development";
      process.env.DRORA_AGENT_SERVER_COMMAND = "drora-agent";
      process.env.DRORA_AGENT_SERVER_ARGS_JSON = JSON.stringify(input);
      setDataBaseDir(sandboxRoot);
      setDroraStdioTapDevEnabled(true);

      const command = resolveDefaultDroraAgentCommand({
        presentationSurface: "desktop",
        workspacePath: "/repo/workspace",
        workspaceKey: "/repo/workspace",
      });
      const wrapped = wrapDroraAgentCommandWithStdioTapDevProxy(command!, "/repo/workspace");

      expect(wrapped.args).toEqual([
        realpathSync(tapScript),
        "--workspace-key",
        "/repo/workspace",
        "--log-dir",
        join(sandboxRoot, ".drora", "v2", "dev", "stdio-traffic"),
        "--",
        "drora-agent",
        ...expected,
      ]);
    },
  );
});
