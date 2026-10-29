/**
 * 进程级 Persona 组合（spec §4「惰性服务组合」；合同 §4 模块表「新控制处理器在进程组合层
 * 惰性取得 Persona 服务」「session 关闭不能销毁进程级资料服务」）。
 *
 * 事件顺序（显式时间）：
 * 1. 装配层（create-app）在算出可信存储根后调用 getOrCreateDroraPersonaSystem——纯内存绑定，
 *    不读库、不起 worker、不阻塞 runtime ready；同一进程重复绑定同一根返回同一实例。
 * 2. 每个新建 Runtime 经 AgentRuntimeDeps.personaCapturePort 拿到同一 capturePort。
 * 3. P0b 捕获在权限门（尚未存在，切片 C 注册）前快速省略，因此不触发服务侧任何存储访问；
 *    显式管理 API（切片 C 的控制处理器）经 appService() 惰性打开库。
 * 多进程一致性不依赖本单例：同根多进程共享靠库事务/CAS（合同 §2），内存只持有连接句柄。
 */
import type { Logger } from "@drora/contracts";
import {
  asPersonaCapturePort,
  PersonaAppServiceImpl,
} from "./persona-app-service.js";
import type {
  DroraPersonaSystem,
  PersonaAppService,
  PersonaSystemBinding,
} from "./contract.js";
import { resolvePersonaDatabasePath } from "./contract.js";

let boundSystem: DroraPersonaSystem | undefined;
let boundRoot: string | undefined;

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
  const service: PersonaAppService = new PersonaAppServiceImpl({ dbPath, logger });
  boundSystem = {
    appService: () => service,
    capturePort: asPersonaCapturePort(service),
  };
  boundRoot = binding.trustedCliStorageRoot;
  return boundSystem;
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
