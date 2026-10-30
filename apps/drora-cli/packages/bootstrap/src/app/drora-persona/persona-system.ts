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
  PersonaTurnCaptureRequest,
} from "@drora/core/persona";
import {
  asPersonaCapturePort,
  PersonaAppServiceImpl,
} from "./persona-app-service.js";
import {
  PERSONA_CAPTURE_OMITTED_PERMISSION_NOT_GRANTED,
  type DroraPersonaSystem,
  type PersonaAppService,
  type PersonaControlPort,
  type PersonaSystemBinding,
} from "./contract.js";
import { resolvePersonaDatabasePath } from "./contract.js";
import type { PersonaInternalCapture } from "./persona-capture-port.js";

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
  const service: PersonaAppService & PersonaInternalCapture = new PersonaAppServiceImpl({
    dbPath,
    logger,
  });
  boundSystem = {
    appService: () => service,
    // E 值由每个新建 Runtime 在装配时冻结进各自端口；warm Runtime 不重读（spec §5）。
    capturePortForPermission: (personaEnabled: boolean): PersonaCapturePort =>
      personaEnabled ? asPersonaCapturePort(service) : permissionDeniedCapturePort,
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
