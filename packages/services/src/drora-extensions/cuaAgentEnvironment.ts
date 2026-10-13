// Drora 还原 CUA 的 spawn 适配；独立持有每个 Helper 的启动/撤销状态。
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import {
  BROKER_SOCKET_ENV,
  BROKER_UNAVAILABLE_ENV,
  clearCuaProductHelperAgentEnvUnavailable,
  hasCuaProductHelperAgentEnvUnavailable,
  isCuaHelperError,
  markCuaProductHelperAgentEnvUnavailable,
  waitForCuaHelperStartup,
  type CuaHelperHost,
  type CuaHelperTransportHandle,
} from "#src/cua-permission-broker/index.js";
import { DRORA_CUA_PLUGIN_AUTHORITY_ENV_KEY, DRORA_CUA_BROKER_TOKEN_ENV_KEY } from "@drora/shared";

const CUA_PRODUCT_HELPER_AGENT_ENV_RETRY_MS = 30_000;

const CUA_HELPER_HEALTH_TIMEOUT_MS = 30_000;

const CUA_PRODUCT_HELPER_SPAWN_READY_DEADLINE_MS = 1_000;

const cuaProductHelperAgentEnvRetryAt = new WeakMap<Pick<CuaHelperHost, "start">, number>();

const cuaProductHelperTrackedStart = new WeakMap<Pick<CuaHelperHost, "start">, Promise<unknown>>();

const cuaProductHelperReservedSpawns = new WeakSet<Pick<CuaHelperHost, "start">>();

const cuaProductHelperTransportSpawns = new WeakSet<Pick<CuaHelperHost, "start">>();

function trackCuaProductHelperStartup(
  host: Pick<CuaHelperHost, "start">,
  startup: Promise<unknown>,
): void {
  if (cuaProductHelperTrackedStart.get(host) === startup) return;
  cuaProductHelperTrackedStart.set(host, startup);
  void startup.then(
    () => {
      cuaProductHelperAgentEnvRetryAt.delete(host);
      cuaProductHelperReservedSpawns.delete(host);
      cuaProductHelperTransportSpawns.delete(host);
      if (cuaProductHelperTrackedStart.get(host) === startup) {
        cuaProductHelperTrackedStart.delete(host);
      }
    },
    () => {
      // The caller may already have timed out while the shared 30s startup continued. Its eventual
      // failure must still establish backoff; otherwise every new task immediately repeats install/
      // launch/health work during a persistent failure.
      cuaProductHelperAgentEnvRetryAt.set(host, Date.now() + CUA_PRODUCT_HELPER_AGENT_ENV_RETRY_MS);
      if (cuaProductHelperReservedSpawns.delete(host)) {
        // 有 Agent 拿着预留 tuple 而 Helper 最终没起来 → 仅标记后续 spawn fail-closed，
        // 不反向销毁已有 Agent。
        markCuaProductHelperAgentEnvUnavailable(host);
      }
      if (cuaProductHelperTransportSpawns.delete(host)) {
        markCuaProductHelperAgentEnvUnavailable(host);
      }
      if (cuaProductHelperTrackedStart.get(host) === startup) {
        cuaProductHelperTrackedStart.delete(host);
      }
    },
  );
}

export async function buildCuaProductHelperAgentEnv(
  host:
    | (Pick<CuaHelperHost, "start"> &
        Partial<
          Pick<
            CuaHelperHost,
            "running" | "checkHealth" | "reservedTransport" | "token" | "presentationToken"
          > & {
            waitForTransport(timeoutMs?: number): Promise<CuaHelperTransportHandle>;
          }
        >)
    | undefined,
  logger = createServiceLogger("cua-product-helper"),
): Promise<Record<string, string>> {
  if (!host) return {};
  if (hasCuaProductHelperAgentEnvUnavailable(host)) {
    // marker 可能已过时：权限授予或后台冷启动完成后，Helper 已恢复，但内置插件尚未加载，
    // 没有新的 resolver 调用来清理 marker。历史上这会让第二次打开应用仍显示 0 tools。
    // 只做一次有界短探针：健康时清 marker 并下发当前 live tuple，否则立即 fail-closed。
    // 此处和 reconcileRecoveredHelper 都只收敛后续 spawn 的 admission，不回收已有 Agent。
    if (host.running && host.checkHealth) {
      try {
        await host.checkHealth(CUA_PRODUCT_HELPER_SPAWN_READY_DEADLINE_MS);
        clearCuaProductHelperAgentEnvUnavailable(host);
      } catch {
        // helper 仍在恢复（冷启动 / 轮换在途）——不阻塞，交给下一次 demand boundary。
      }
    }
    if (hasCuaProductHelperAgentEnvUnavailable(host)) {
      return {
        [BROKER_UNAVAILABLE_ENV]:
          "broker_unavailable: recovered Helper credentials are waiting for a future spawn",
      };
    }
  }
  const retryAt = cuaProductHelperAgentEnvRetryAt.get(host);
  // 非阻塞设计（用户硬约束）：spawn 绝不卡在冷启动上。warm helper（host.running）走快速
  // checkHealth（1s 上限，健康 helper 毫秒级返回；只有病态 helper 才吃满，可接受）；cold helper
  // 已有安全预留时立即返回，否则走有界 1s deadline race，超时且无预留才 fail-closed 到
  // BROKER_UNAVAILABLE，后台共享 startup 继续收敛。resolver 会在后续 request boundary
  // 只收敛后续 spawn admission，再开放 broker tuple；
  // 绝不从后台 completion 异步打断首个 session，也绝不让 spawn 等 10s。
  //
  // fail-closed 理由：CLI 全局配置里存在 drora-cua 时，返回空 env 会让 agent 按原始
  // 无 broker 凭据启动 MCP 子进程会绕过已获授权的 Helper broker，让 Python
  // MCP 成为实际 TCC 执行主体。broker 未就绪时必须返回 BROKER_UNAVAILABLE，绝不返回空 env。
  try {
    if (host.running && host.checkHealth) {
      // start() intentionally returns an existing handle without probing. Never spawn a new agent
      // with a dead Helper's stale tuple; the session resolver owns on-demand Helper restart,
      // while this lower-level spawn path fails closed until that recovery completes.
      await host.checkHealth(1000);
      // A successful resolver rotation may have recovered the same host while an earlier spawn
      // failure left a retry marker. Healthy live credentials always supersede stale backoff.
      cuaProductHelperAgentEnvRetryAt.delete(host);
      if (hasCuaProductHelperAgentEnvUnavailable(host)) {
        return {
          [BROKER_UNAVAILABLE_ENV]:
            "broker_unavailable: recovered Helper credentials are waiting for a future spawn",
        };
      }
    } else if (retryAt && Date.now() < retryAt) {
      return {
        [BROKER_UNAVAILABLE_ENV]: "broker_unavailable: helper startup retry is deferred",
      };
    }
    const startup = host.start();
    trackCuaProductHelperStartup(host, startup);
    if (host.waitForTransport) {
      // Windows named pipes cannot reserve/rename a final socket. The Helper sends
      // transport_ready once the pipe is bound; use that tuple while full health
      // (native/UIA initialization) continues in the shared startup promise.
      const transport = await waitForCuaHelperStartup(
        host.waitForTransport(CUA_PRODUCT_HELPER_SPAWN_READY_DEADLINE_MS),
        CUA_PRODUCT_HELPER_SPAWN_READY_DEADLINE_MS,
      );
      if (hasCuaProductHelperAgentEnvUnavailable(host)) {
        return {
          [BROKER_UNAVAILABLE_ENV]:
            "broker_unavailable: recovered Helper credentials are waiting for a future spawn",
        };
      }
      cuaProductHelperTransportSpawns.add(host);
      cuaProductHelperAgentEnvRetryAt.delete(host);
      return {
        [BROKER_SOCKET_ENV]: transport.socketPath,
        [DRORA_CUA_PLUGIN_AUTHORITY_ENV_KEY]: transport.pluginAuthority,
        // 第十五轮 token 模式：host 发射时铸造、handle 携带；无 token（旧 Helper）省键。
        ...(host.token ? { [DRORA_CUA_BROKER_TOKEN_ENV_KEY]: host.token } : {}),
      };
    }
    // 原来只在 1s 超时后读取预留 tuple，Host 已安全占住 socket 时也会白等。
    // 复用原准入条件提前返回；完整 startup 的失败仍由上面的 tracker 收敛。
    const reserved = host.reservedTransport;
    if (reserved && !hasCuaProductHelperAgentEnvUnavailable(host)) {
      cuaProductHelperReservedSpawns.add(host);
      cuaProductHelperAgentEnvRetryAt.delete(host);
      // 第十五轮恢复 token 模式（原版 mac 发射链）：helper 以 --token-file 启动，
      // 客户端必须 authenticate。host 无 token（旧 Helper/非 darwin）时省键、语义不变。
      return {
        [BROKER_SOCKET_ENV]: reserved.socketPath,
        [DRORA_CUA_PLUGIN_AUTHORITY_ENV_KEY]: reserved.pluginAuthority,
        ...(host.token ? { [DRORA_CUA_BROKER_TOKEN_ENV_KEY]: host.token } : {}),
      };
    }
    // 有界 deadline race：cold launch 没在 1s 内 ready 且无预留才 fail-closed。waitForCuaHelperStartup
    // 超时抛 caller_timeout（被下面 catch 当作"后台仍在跑"，不额外设 retryAt）。
    const handle = await waitForCuaHelperStartup(
      startup,
      CUA_PRODUCT_HELPER_SPAWN_READY_DEADLINE_MS,
    );
    // Another concurrent spawn may have timed out while this caller was waiting on the shared
    // startup. Never expose the recovered tuple while the resolver still has a pending admission marker.
    if (hasCuaProductHelperAgentEnvUnavailable(host)) {
      return {
        [BROKER_UNAVAILABLE_ENV]:
          "broker_unavailable: recovered Helper credentials are waiting for a future spawn",
      };
    }
    cuaProductHelperAgentEnvRetryAt.delete(host);
    return {
      [BROKER_SOCKET_ENV]: handle.socketPath,
      [DRORA_CUA_PLUGIN_AUTHORITY_ENV_KEY]: handle.pluginAuthority,
      ...(host.token ? { [DRORA_CUA_BROKER_TOKEN_ENV_KEY]: host.token } : {}),
    };
  } catch (error) {
    // caller_timeout 仅表示共享的 30s startup 仍在后台运行；trackCuaProductHelperStartup 会在其
    // 真正失败时建立 backoff。这里提前退避会让已经 ready 的 Helper 仍被后续 Agent 错误禁用。
    const isCallerTimeout = isCuaHelperError(error) && error.code === "caller_timeout";
    if (isCallerTimeout) {
      // 冷启动 rendezvous：Helper 还在起，但 host 已经占住 final socket 并预留了 tuple。
      // 此时下发的凭据是**可用**的——final 上是 host 占位，未验签的 Helper 绑在 .pending
      // 上够不到它；client 连上占位会被立刻 destroy 并按 broker_unavailable 退避重试，
      // Helper 验证通过后 host 原子 rename 让渡，重试自然落到真 Helper 上。
      //
      // 这条分支存在的意义：Helper 未 ready 时只拒绝本次 Agent 的 CUA MCP admission；
      // Helper ready 后仍只影响后续 Agent spawn，不能通过 lifecycle 操作连带冲掉已有会话。
      const reserved = host.reservedTransport;
      if (reserved && !hasCuaProductHelperAgentEnvUnavailable(host)) {
        // 上面的 unavailable marker 检查优先：未完成 admission 收敛时不放出 tuple。
        cuaProductHelperReservedSpawns.add(host);
        cuaProductHelperAgentEnvRetryAt.delete(host);
        return {
          [BROKER_SOCKET_ENV]: reserved.socketPath,
          [DRORA_CUA_PLUGIN_AUTHORITY_ENV_KEY]: reserved.pluginAuthority,
          ...(host.token ? { [DRORA_CUA_BROKER_TOKEN_ENV_KEY]: host.token } : {}),
        };
      }
    }
    markCuaProductHelperAgentEnvUnavailable(host);
    if (!isCallerTimeout) {
      cuaProductHelperAgentEnvRetryAt.set(host, Date.now() + CUA_PRODUCT_HELPER_AGENT_ENV_RETRY_MS);
    }
    logger.warn(
      undefined,
      `Computer Use Helper broker_unavailable; disabling workspace drora-cua MCP server for this agent spawn (${cuaHelperStartErrorDetail(error)})`,
    );
    return {
      [BROKER_UNAVAILABLE_ENV]: isCallerTimeout
        ? // 冷启动仍在后台跑——"warming up"，reconcileRecoveredHelper 会在 helper ready 后
          // 只清理后续 spawn marker。
          "broker_unavailable: helper broker warming up"
        : `broker_unavailable: ${cuaHelperStartErrorDetail(error)}`,
    };
  }
}

function cuaHelperStartErrorDetail(error: unknown): string {
  return isCuaHelperError(error)
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
}
