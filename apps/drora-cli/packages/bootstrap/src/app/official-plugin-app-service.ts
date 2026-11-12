import { spawn, type ChildProcess } from "node:child_process";
import type { Logger, PluginMetadata } from "@drora/contracts";
import {
  resolveOfficialPluginAppService,
  type OfficialPluginAppServiceDeclaration,
} from "./official-plugin-definitions.js";
import {
  resolveOfficialPluginAppServiceSpawnConfig,
  type OfficialPluginAppServiceSpawnConfig,
} from "./official-plugin-runtime.js";

/**
 * g1 app 级常驻服务管理器（specs/obsidian-vault-phase2-true-extraction.md §3/§6/§10-P1）。
 *
 * 生命周期语义（官方定义 `appService` 键声明，四条一起成立）：
 * 1. **宿主启动即拉起**：`start()` 在 bootstrap create-app 装配期调用，不等首个会话或
 *    工具调用；spawn 非阻塞，不拖慢启动链。
 * 2. **独立于 session lease**：实例生命周期 = 宿主进程，不随会话建立/销毁增减。
 * 3. **崩溃重启**：非停止期的意外退出按指数退避自动重启（初值 500ms、×2、封顶 30s；
 *    子进程稳定运行 ≥ restartStableResetMs 后退避计数清零）。宿主存活期间持续重试、
 *    不放弃——singleton 本就是优化声明（spec §3/g8），正确性由 DB 级 fence 兜底，
 *    重启只损失优化而不损失数据安全。
 * 4. **宿主退出收割**：`harvest()` 幂等；SIGTERM → 宽限超时（默认 3s）→ SIGKILL，
 *    并取消挂起的重启定时器。宿主被 SIGKILL 等异常终止时的兜底是 stdio 管道 EOF：
 *    MCP server 读 stdin 断开即自行退出，天然回收。
 *
 * singleton 作用域裁定（P1，建议值先行待终裁，见 spec §6）：**宿主进程级**——同一
 * host 进程内每 pluginId 至多一实例（本管理器 Map 强制；create-app 每进程唯一装配点，
 * 重复 start 复用既有实例）。机器级去重不做：跨窗口/跨 Host 多实例是仓库受支持场景
 * （knowledge.md A05），写竞争防护由 DB 级 index_lease/fencing 承担（§3/g8），不得
 * 进程内化。
 */
export type OfficialPluginAppServiceState =
  | "starting"
  | "running"
  | "restarting"
  | "stopped"
  | "failed";

export interface OfficialPluginAppServiceSnapshot {
  pluginId: string;
  /** 累计重启次数（运行态实例的当前计数；仅观测用）。 */
  restarts: number;
  serverKey: string;
  state: OfficialPluginAppServiceState;
}

export interface OfficialPluginAppServiceManager {
  /** 宿主启动拉起；幂等（已拉起/已计划重启的 pluginId 不重复拉起，singleton 强制点）。 */
  start(): void;
  /** 退出收割；幂等且不抛错（kill 失败吞错、宽限超时兜底），等待全部子进程终止。 */
  harvest(): Promise<void>;
  snapshot(): OfficialPluginAppServiceSnapshot[];
}

const DEFAULT_RESTART_INITIAL_DELAY_MS = 500;
const DEFAULT_RESTART_MAX_DELAY_MS = 30_000;
const DEFAULT_RESTART_STABLE_RESET_MS = 60_000;
const DEFAULT_HARVEST_GRACE_MS = 3_000;

interface AppServiceHandle {
  child: ChildProcess;
  pluginId: string;
  restarts: number;
  serverKey: string;
  spawnedAt: number;
  state: OfficialPluginAppServiceState;
}

interface PendingRestart {
  attempts: number;
  declaration: OfficialPluginAppServiceDeclaration;
  timer: NodeJS.Timeout;
}

export function createOfficialPluginAppServiceManager(input: {
  cwd: string;
  /** 收割时 SIGTERM→SIGKILL 的宽限时长；测试可调小。 */
  harvestGraceMs?: number;
  logger: Logger;
  plugins: readonly PluginMetadata[];
  /** 崩溃重启退避参数；测试可调小以加速用例。 */
  restartInitialDelayMs?: number;
  restartMaxDelayMs?: number;
  restartStableResetMs?: number;
  /**
   * spawn 注入点（测试用真实子进程替换 server 入口）；缺省用 node:child_process spawn，
   * stdio 走管道并排空两端流，避免常驻 server 写满缓冲后被反压阻塞。
   */
  spawnProcess?: (config: OfficialPluginAppServiceSpawnConfig) => ChildProcess;
}): OfficialPluginAppServiceManager {
  const restartInitialDelayMs = input.restartInitialDelayMs ?? DEFAULT_RESTART_INITIAL_DELAY_MS;
  const restartMaxDelayMs = input.restartMaxDelayMs ?? DEFAULT_RESTART_MAX_DELAY_MS;
  const restartStableResetMs = input.restartStableResetMs ?? DEFAULT_RESTART_STABLE_RESET_MS;
  const harvestGraceMs = input.harvestGraceMs ?? DEFAULT_HARVEST_GRACE_MS;
  const logger = input.logger;

  // singleton 强制点：宿主进程级，key = pluginId。
  const handles = new Map<string, AppServiceHandle>();
  const pendingRestarts = new Map<string, PendingRestart>();
  let stopping = false;

  function start(): void {
    if (stopping) return;
    for (const plugin of input.plugins) {
      // 在场门 = 插件启用态（禁用插件即停服务；hostComponents 三态开关仍只作用于
      // 本体注册门——P1 裁定见 spec §6）。
      if (!plugin.enabled) continue;
      // singleton：已拉起或已计划重启的 pluginId 直接复用，不重复拉起。
      if (handles.has(plugin.id) || pendingRestarts.has(plugin.id)) continue;
      const declaration = resolveOfficialPluginAppService(plugin.id);
      if (!declaration) continue;
      const config = resolveOfficialPluginAppServiceSpawnConfig({
        cwd: input.cwd,
        dataPath: plugin.dataPath,
        pluginId: plugin.id,
        rootPath: plugin.rootPath,
        serverKey: declaration.server,
      });
      if (!config) {
        // P3 落地 knowledge 清单前的 obsidian 声明走这里：声明先行、惰性跳过。
        logger.debug("Plugin app service declaration has no spawn target; skipped", {
          event: "bootstrap.plugin_app_service.skipped",
          pluginId: plugin.id,
          serverKey: declaration.server,
        });
        continue;
      }
      launch(plugin.id, declaration, config, 0);
    }
  }

  function launch(
    pluginId: string,
    declaration: OfficialPluginAppServiceDeclaration,
    config: OfficialPluginAppServiceSpawnConfig,
    restarts: number,
  ): void {
    if (stopping) return;
    let child: ChildProcess;
    try {
      child =
        input.spawnProcess?.(config) ??
        spawn(config.command, config.args, {
          cwd: config.cwd,
          // 常驻级与会话级 env 面不漂移：SDK stdio transport 会把默认继承 env
          // （PATH/HOME 等）与配置 env 合并，这里同样继承宿主全量 env 后再叠加
          // spawn 计划的权威键（plugin id / 常驻标记 / ELECTRON_RUN_AS_NODE 等）。
          env: { ...process.env, ...config.env },
          stdio: "pipe",
        });
    } catch (error) {
      // 同步 spawn 失败（极少见，如平台限制）：按崩溃语义进退避重启。
      logger.warn("Plugin app service spawn failed", {
        error: error instanceof Error ? error.message : String(error),
        event: "bootstrap.plugin_app_service.spawn_failed",
        pluginId,
      });
      // 修复依据：与 onExit 路径同口径 +1 递增——否则连续同步失败时 attempts 恒为
      // 当前值，指数退避（2**attempts）不再增长，违背文件头声明的退避语义。
      scheduleRestart(pluginId, declaration, restarts + 1);
      return;
    }
    const handle: AppServiceHandle = {
      child,
      pluginId,
      restarts,
      serverKey: declaration.server,
      spawnedAt: Date.now(),
      state: "starting",
    };
    handles.set(pluginId, handle);
    // 排空常驻子进程的 stdout/stderr：P1 阶段宿主不消费 MCP 传输（常驻实例与
    // per-session MCP client 的关系由 P3 映射清单设计裁定），不排空会让 server
    // 写满管道缓冲后被反压阻塞。
    child.stdout?.resume();
    child.stderr?.resume();
    child.on("spawn", () => {
      const current = handles.get(pluginId);
      if (current === handle) current.state = "running";
      logger.info("Plugin app service launched", {
        event: "bootstrap.plugin_app_service.launched",
        pid: child.pid,
        pluginId,
        restarts,
        serverKey: declaration.server,
      });
    });
    child.on("exit", (code, signal) => onExit(handle, code, signal));
    child.on("error", (error) => {
      // 只记日志：spawn 失败（如 ENOENT）不发 exit 只发 close，重启判定统一收敛
      // 在 exit/close 两条事件上（见 onClose）。
      logger.warn("Plugin app service process error", {
        error: error.message,
        event: "bootstrap.plugin_app_service.process_error",
        pluginId,
      });
    });
    // spawn 失败路径没有 exit 事件，由 close 补位重启判定；正常退出时 close 紧随
    // exit 到达，用 handles 归属判断去重（此时 handle 已被 onExit 删除或已换新实例）。
    child.on("close", () => onClose(handle));
  }

  function onExit(handle: AppServiceHandle, code: number | null, signal: string | null): void {
    if (handles.get(handle.pluginId) === handle) handles.delete(handle.pluginId);
    handle.state = stopping ? "stopped" : "failed";
    if (stopping) return;
    logger.warn("Plugin app service exited unexpectedly", {
      event: "bootstrap.plugin_app_service.unexpected_exit",
      exitCode: code,
      pluginId: handle.pluginId,
      signal,
    });
    const aliveMs = Date.now() - handle.spawnedAt;
    // 稳定运行过的实例把退避计数清零：长期偶发崩溃不应累积到封顶退避拖慢恢复。
    const attempts = aliveMs >= restartStableResetMs ? 0 : handle.restarts + 1;
    scheduleRestart(handle.pluginId, { server: handle.serverKey }, attempts);
  }

  /** spawn 失败路径的重启判定（无 exit 事件时由 close 补位）；正常退出后 close 空转。 */
  function onClose(handle: AppServiceHandle): void {
    // exit 已处理（handle 已被删除或已换新实例）时这里不再判定。
    if (handles.get(handle.pluginId) !== handle) return;
    onExit(handle, null, null);
  }

  function scheduleRestart(
    pluginId: string,
    declaration: OfficialPluginAppServiceDeclaration,
    attempts: number,
  ): void {
    if (stopping) return;
    const plugin = input.plugins.find((candidate) => candidate.id === pluginId);
    const config = plugin
      ? resolveOfficialPluginAppServiceSpawnConfig({
          cwd: input.cwd,
          dataPath: plugin.dataPath,
          pluginId: plugin.id,
          rootPath: plugin.rootPath,
          serverKey: declaration.server,
        })
      : undefined;
    if (!config) {
      // 插件清单不在场或 spawn 目标已不可解析：不再重启，如实记录。
      logger.warn("Plugin app service restart target unresolvable; giving up", {
        event: "bootstrap.plugin_app_service.restart_giveup",
        pluginId,
        serverKey: declaration.server,
      });
      return;
    }
    const delayMs = Math.min(restartInitialDelayMs * 2 ** attempts, restartMaxDelayMs);
    logger.info("Plugin app service restart scheduled", {
      delayMs,
      event: "bootstrap.plugin_app_service.restart_scheduled",
      pluginId,
      restarts: attempts,
      serverKey: declaration.server,
    });
    const timer = setTimeout(() => {
      pendingRestarts.delete(pluginId);
      if (stopping) return;
      launch(pluginId, declaration, config, attempts);
    }, delayMs);
    // unref：挂起的重启定时器不阻止宿主进程自然退出（退出收割会显式清掉它）。
    timer.unref?.();
    pendingRestarts.set(pluginId, { attempts, declaration, timer });
  }

  async function harvest(): Promise<void> {
    stopping = true;
    for (const pending of pendingRestarts.values()) clearTimeout(pending.timer);
    pendingRestarts.clear();
    const children = [...handles.values()];
    if (children.length === 0) return;
    await new Promise<void>((resolve) => {
      let pending = children.length;
      const done = () => {
        pending -= 1;
        if (pending <= 0) resolve();
      };
      for (const handle of children) {
        handle.state = "stopped";
        const child = handle.child;
        // 已自行退出的子进程不会再发 exit：按退出码/信号先行判定，避免收割悬挂。
        if (child.exitCode !== null || child.signalCode !== null) {
          done();
          continue;
        }
        child.once("exit", () => done());
        try {
          child.kill("SIGTERM");
        } catch (error) {
          // kill 失败（进程已死/权限）：不中断收割，宽限兜底后照常 resolve。
          logger.warn("Plugin app service kill failed during harvest", {
            error: error instanceof Error ? error.message : String(error),
            event: "bootstrap.plugin_app_service.harvest_kill_failed",
            pluginId: handle.pluginId,
          });
        }
      }
      const grace = setTimeout(() => {
        for (const handle of children) {
          try {
            handle.child.kill("SIGKILL");
          } catch {
            // 同上：SIGKILL 兜底失败不阻塞收割完成。
          }
        }
      }, harvestGraceMs);
      grace.unref?.();
    });
    handles.clear();
  }

  function snapshot(): OfficialPluginAppServiceSnapshot[] {
    const running = [...handles.values()].map(
      (handle): OfficialPluginAppServiceSnapshot => ({
        pluginId: handle.pluginId,
        restarts: handle.restarts,
        serverKey: handle.serverKey,
        state: handle.state,
      }),
    );
    const restarting = [...pendingRestarts.entries()].map(
      ([pluginId, pending]): OfficialPluginAppServiceSnapshot => ({
        pluginId,
        restarts: pending.attempts,
        serverKey: pending.declaration.server,
        state: "restarting",
      }),
    );
    return [...running, ...restarting];
  }

  return { harvest, snapshot, start };
}
