/**
 * 进程级 Persona 组合（spec §4「惰性服务组合」；合同 §4 模块表「新控制处理器在进程组合层
 * 惰性取得 Persona 服务」「session 关闭不能销毁进程级资料服务」）。
 *
 * 事件顺序（显式时间）：
 * 1. 装配层（create-app / 协议 entrypoint）在算出可信存储根后调用 getOrCreateDroraPersonaSystem
 *    ——纯内存绑定，不读库、不起 worker、不阻塞 runtime ready；同一进程重复绑定同一根返回同一实例。
 * 2. 每个新建 Runtime 经 AgentRuntimeDeps.personaCapturePort 拿到用自身冻结 E 值绑定的
 *    capturePortForPermission 端口（切片 C 执行许可：off → 零 IO 快速省略；on → 真实存储捕获）。
 * 3. 无会话控制处理器（协议 server）经 createPersonaControlPort 在进程组合层惰性取得管理 API，
 *    不经 AgentRuntime 取仓储；显式管理调用才经 appService() 惰性打开库。
 * 多进程一致性不依赖本单例：同根多进程共享靠库事务/CAS（合同 §2），内存只持有连接句柄。
 */
import type { Logger } from "@drora/contracts";
import type {
  PersonaCaptureOutcome,
  PersonaCapturePort,
  PersonaLearningNotificationPort,
  PersonaTurnCaptureRequest,
} from "@drora/core/persona";
// 生产存储走正式异步 worker（合同 §2「SQLite 位于异步 worker」、切片 B 剩余交付）：
// worker 线程持有 DatabaseSync，本进程只持有消息传递端口；测试注入的 openStore 不受影响。
import { openWorkerPersonaStore } from "@drora/adapters/storage/persona";
import {
  asPersonaCapturePort,
  PersonaAppServiceImpl,
} from "./persona-app-service.js";
import { createPersonaLearningCoordinator } from "./learning-coordinator.js";
import {
  PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
  type DroraPersonaSystem,
  type PersonaAppService,
  type PersonaControlPort,
  type PersonaSystemBinding,
} from "./contract.js";
import { resolvePersonaDatabasePath } from "./contract.js";
import type { PersonaInternalCapture } from "./persona-capture-port.js";
import type { PersonaInternalLearning, PersonaLearningManagement } from "./learning-contract.js";

let boundSystem: DroraPersonaSystem | undefined;
let boundRoot: string | undefined;

/**
 * E off 的捕获端口：权限未授予即整轮省略（spec §5），零 IO、不起 worker；
 * signal 已取消的轮仍如实返回 cancelled，不把 cancelled 伪装成 omitted。
 * 无状态单例：同值重复绑定返回同一端口对象。
 */
const permissionDeniedCapturePort: PersonaCapturePort = {
  captureContribution: async (request: PersonaTurnCaptureRequest): Promise<PersonaCaptureOutcome> => {
    if (request.signal.aborted) {
      return { status: "cancelled" };
    }
    return {
      status: "omitted",
      reason: PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
    };
  },
};

/**
 * 取得或创建进程级 Persona 系统。首个绑定固定本进程的可信根；后续绑定不同根只告警并保留
 * 首个（同一进程只应有一个可信存储根；重复出现属于装配缺陷，不能让它静默切换资料域）。
 */
export function getOrCreateDroraPersonaSystem(binding: PersonaSystemBinding): DroraPersonaSystem {
  if (boundSystem) {
    if (binding.trustedCliStorageRoot !== boundRoot) {
      binding.logger?.warn("persona system rebinding with a different trusted root was ignored", {
        module: "drora-persona",
      });
    }
    return boundSystem;
  }
  const dbPath = resolvePersonaDatabasePath(binding.trustedCliStorageRoot);
  const logger: Logger | undefined = binding.logger?.child({ module: "drora-persona" });
  // 服务实现同时是内部捕获面、内部学习面与学习管理面（capture/acceptLearningSource 均
  // 「内部」不进管理端口；allowLearningForKey/getPersonaLearningOverview 是管理端口方法）。
  const service: PersonaAppService &
    PersonaInternalCapture &
    PersonaInternalLearning &
    PersonaLearningManagement = new PersonaAppServiceImpl({
    dbPath,
    // 生产默认＝异步 worker（合同 §2）：SQLite 连接在 worker 线程内，主线程经消息传递
    // 调同一 PersonaStorePort；worker 退出/崩溃按 storage_unavailable 停扩展不崩进程。
    // 未显式传 openStore 的测试（直接构造 PersonaAppServiceImpl）仍用在程 engine。
    openStore: (path) => openWorkerPersonaStore({ dbPath: path }),
    learning: binding.learning,
    logger,
  });
  // P1b 学习协调器（进程级单例，与服务同生命周期）：持有 64 待接收队列与计数；
  // 通知端口工厂按 Runtime 的 E/workspaceKey 绑定闭包，全部委托同一协调器。
  const learningCoordinator = createPersonaLearningCoordinator({
    learning: service,
    logger,
  });
  boundSystem = {
    appService: () => service,
    // E 值由每个新建 Runtime 在装配时冻结进各自端口；warm Runtime 不重读（spec §5）。
    capturePortForPermission: (personaEnabled: boolean): PersonaCapturePort =>
      personaEnabled ? asPersonaCapturePort(service) : permissionDeniedCapturePort,
    learningNotificationPort: (input: {
      personaEnabled: boolean;
      workspaceKey?: string;
    }): PersonaLearningNotificationPort | undefined => {
      // E off / workspaceKey 缺席＝端口缺席：Runtime 零开销，普通轮不产生学习机会。
      if (!input.personaEnabled) return undefined;
      const workspaceKey = input.workspaceKey?.trim();
      if (!workspaceKey) return undefined;
      return learningCoordinator.createNotificationPort({
        personaPermission: input.personaEnabled,
        workspaceKey,
      });
    },
    learningCountersSnapshot: () => learningCoordinator.snapshotCounters(),
  };
  boundRoot = binding.trustedCliStorageRoot;
  return boundSystem;
}

/**
 * 无会话管理的独立组合端口工厂（spec §4）：协议 server 在进程组合层经此惰性取得管理 API，
 * 不经构造 AgentRuntime 取仓储。惰性语义：首个管理调用才执行进程级绑定——entrypoint 与
 * create-app 共享同一 holder（同可信根 → 同一实例），未使用 persona 的进程/测试不做绑定。
 */
export function createPersonaControlPort(binding: PersonaSystemBinding): PersonaControlPort {
  let resolved: PersonaControlPort | undefined;
  const resolve = (): PersonaControlPort => {
    resolved ??= getOrCreateDroraPersonaSystem(binding).appService();
    return resolved;
  };
  return {
    getPersonaOverview: () => resolve().getPersonaOverview(),
    initializePersona: (input) => resolve().initializePersona(input),
    getPersonaCore: () => resolve().getPersonaCore(),
    updatePersonaCore: (input) => resolve().updatePersonaCore(input),
    resetPersonaCore: (input) => resolve().resetPersonaCore(input),
    previewPersona: (input) => resolve().previewPersona(input),
    // P1a（合同 §3）：策略/偏好/导出与核心管理同走进程级服务单例。
    setPersonalPolicy: (input) => resolve().setPersonalPolicy(input),
    savePreference: (input) => resolve().savePreference(input),
    forgetPreference: (input) => resolve().forgetPreference(input),
    listPreferences: () => resolve().listPreferences(),
    preparePersonaExport: () => resolve().preparePersonaExport(),
    // P1b（合同 §3 allowLearningForKey＋读侧概览；spec §5/§8）：同一进程级服务单例；
    // 内部学习面（acceptLearningSource/processLearningWork）不经本端口暴露。
    allowLearningForKey: (input) => resolve().allowLearningForKey(input),
    getPersonaLearningOverview: () => resolve().getPersonaLearningOverview(),
  };
}

/** 仅供测试与诊断：绑定前返回 undefined；不做任何 IO。 */
export function peekDroraPersonaSystem(): DroraPersonaSystem | undefined {
  return boundSystem;
}

/** 仅供测试：释放进程级绑定并关闭已打开的库连接。生产代码不得调用。 */
export async function resetDroraPersonaSystemForTests(): Promise<void> {
  const system = boundSystem;
  boundSystem = undefined;
  boundRoot = undefined;
  if (system) await system.appService().close();
}
