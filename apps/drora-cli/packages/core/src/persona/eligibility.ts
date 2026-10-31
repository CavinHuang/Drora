/**
 * 用途与入口矩阵（spec §6）的入口侧资格判定；纯函数，零 IO。
 * 封闭世界表：只有确认的直接真实用户主对话轮合格；任何合成来源（含 workflow_launch 这类
 * 真实动作语义）、model-only 内部续跑、automation 与闲时派发身份都不合格（PM34：未知拒绝）。
 * 判定在 admission 同步冻结，不在旧模型冻结前引入新的 await；busy 队列以真正执行时判定为准。
 */
export interface PersonaMainRequestAdmission {
  /** SYNTHETIC_USER_MESSAGE_SOURCES 成员；undefined 表示直接真实用户输入。 */
  readonly inputSource?: string;
  /** "model-only" 是运行时内部续跑，不是新的真实用户轮。 */
  readonly inputVisibility?: string;
  /** 本轮 automation 身份；自动化轮不接收贡献。 */
  readonly automationId?: string;
  /** 本轮闲时任务身份；与 automation 同样不合格。 */
  readonly offPeakTaskId?: string;
}

export function isPersonaEligibleMainRequest(admission: PersonaMainRequestAdmission): boolean {
  return (
    admission.inputSource === undefined &&
    (admission.inputVisibility === undefined || admission.inputVisibility === "user-visible") &&
    !(admission.automationId ?? "").trim() &&
    !(admission.offPeakTaskId ?? "").trim()
  );
}
