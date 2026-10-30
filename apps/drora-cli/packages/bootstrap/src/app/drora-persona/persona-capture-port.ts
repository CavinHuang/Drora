/**
 * Persona 内部捕获面（合同 §3 captureContribution 标注「内部」）：与外部管理 API
 * （cli-persona-service 的 PersonaAppService）分离——管理面经 PersonaControlPort 暴露给
 * 协议 server；捕获面只被进程组合层（persona-system 的 capturePortForPermission）绑定进
 * Runtime 的 PersonaCapturePort。独立文件是架构计数与语义边界双重要求：这不是管理 API。
 */
import type { PersonaTurnCaptureRequest } from "@drora/core/persona";
import type { PersonaCaptureOutcome } from "@drora/core/persona";

export interface PersonaInternalCapture {
  captureContribution(request: PersonaTurnCaptureRequest): Promise<PersonaCaptureOutcome>;
}
