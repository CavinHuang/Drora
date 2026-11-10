// R2 pre-launch 占位（specs/cua-gap-remediation-2026-11-09.md 决策点 D1=选项 A；
// R10 认证模型换代后 token 语义退役——占位机制本身保留）：在 agent 进程内的 0.6.5
// 冻结切段触发自身懒启动**之前**，服务侧先（免 token 直发）把 Helper 拉起并占住桥接
// socket，切段发现 socket 已存活即逐调用直连复用（身份 authenticate + peer 资格门）。
//
// 取证依据（2026-11-09，本批实施第一步，切段只读引用）：
// ① socket 已存活时切段不会自己拉起——ensureBrokerAvailable 仅在 callWithWarmupRetry
//    判定 broker_unavailable + not_sent 的重试前经 ensureBrokerForRetry（5s 冷却）触发
//    （upstream/zcode-cua-0.6.5.index.js:38652-38687、:44897）；socket 存活且握手通过时
//    切段逐调用新建 PermissionBrokerClient 直连（:38647）。
// ② （R10 已解决）切段 client 的 authenticate 载荷恒为 {clientApiVersion:3}，无 token
//    ——R10 认证模型换代后 Helper 侧 token 校验已整体退役（peer 身份模型），切段直连
//    即可认证；旧「token 感知客户端 env 下发」与「切段 fail-closed 终态」随之消失。
// ③ 占位必须先于 agent spawn 完成（socket 真正监听）——否则切段首调 ENOENT → 重试环
//    触发自身懒启动（open 不透传 env、argv 无 token → Helper token 门 exit(2)，
//    helperMain.ts:747-752），且与在途占位发射抢 LaunchServices 单实例 flock。

export type LazySpawnStandaloneHelperPreLaunchOutcome =
  /** 非 darwin（win32 走 fork recipe 链、linux 无 CUA）——不在本占位范围，调用方维持原行为。 */
  | "platform-out-of-scope"
  /** socket 已有 Helper 监听但无本进程 token（外部/他进程发射）——不得重发（见 launchStandaloneHelper 注释）。 */
  | "socket-already-occupied"
  /** 占位发射成功（Helper 已监听桥接 socket）。 */
  | "pre-launched"
  /** 占位发射失败（资产缺失/open 失败/探活超时）——调用方按原行为降级（无注入）。 */
  | "pre-launch-failed"
  /** 占位在等待预算内未完成（发射仍在后台收敛）——本次 spawn 降级，后续 spawn 复用结果。 */
  | "pre-launch-timeout";

export interface LazySpawnStandaloneHelperPreLaunchOptions {
  /** 平台分支（占位仅 darwin）；缺省 process.platform，测试注入用。 */
  platform?: NodeJS.Platform;
  /** 懒启动分支注入给 agent 的桥接 socket（resolveBrokerSocketPath 稳定路径）。 */
  socketPath: string;
  /**
   * socket 探活（ping，不拉起）。占位前必须先探活：对已存活的 Helper 重复 open 不带 -n
   * 时只会 activate 既有实例（纯浪费；R10 后无 token 缓存，探活即可安全跳过）。
   */
  probeSocketAlive: (socketPath: string) => Promise<boolean>;
  /**
   * 免 token 直发（设置页 standalone 发射同款，R10 后无 token 铸造）：
   * buildStandaloneCuaHelperLaunchArgs → open → 探活轮询。成功返回 true；失败 false。
   * 异常一律被本编排层折叠为失败（共享 promise 不得以 rejection 泄漏给并发 follower）。
   */
  launchStandaloneHelper: (socketPath: string) => Promise<boolean>;
  /** 等待占位完成的预算（ms）；超时后发射继续在后台收敛，本次 spawn 降级。缺省 8s
   * （覆盖 open 5s 超时 + 3s 探活余量；spawn 不得长时间卡在冷启动——托管链同款纪律，
   * cuaAgentEnvironment.ts CUA_PRODUCT_HELPER_SPAWN_READY_DEADLINE_MS 注释）。 */
  awaitBudgetMs?: number;
  /** 并发串行表（socketPath → 在途发射）；缺省模块级共享。测试注入隔离用。 */
  inFlight?: Map<string, Promise<boolean>>;
}

const defaultInFlight = new Map<string, Promise<boolean>>();

export async function ensureStandaloneHelperPreLaunchedForLazySpawn(
  options: LazySpawnStandaloneHelperPreLaunchOptions,
): Promise<LazySpawnStandaloneHelperPreLaunchOutcome> {
  if ((options.platform ?? process.platform) !== "darwin") {
    return "platform-out-of-scope";
  }
  if (await options.probeSocketAlive(options.socketPath)) {
    return "socket-already-occupied";
  }
  const inFlight = options.inFlight ?? defaultInFlight;
  const pending =
    inFlight.get(options.socketPath) ??
    Promise.resolve(options.launchStandaloneHelper(options.socketPath))
      .catch(() => false)
      .finally(() => {
        inFlight.delete(options.socketPath);
      });
  if (!inFlight.has(options.socketPath)) {
    inFlight.set(options.socketPath, pending);
  }
  // 并发 resolveSpawnEnv 共享同一次发射（flock 单实例下第二次 open 是纯浪费）。
  // 预算超时不取消发射：发射仍在后台收敛，后续 spawn 经探活复用。
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"pre-launch-timeout">((resolve) => {
    timer = setTimeout(() => resolve("pre-launch-timeout"), options.awaitBudgetMs ?? 8_000);
  });
  try {
    return await Promise.race([
      pending.then((launched) => (launched ? "pre-launched" : "pre-launch-failed")),
      budget,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
