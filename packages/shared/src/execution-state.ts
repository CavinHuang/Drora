import { z } from "zod";

/** auto 保留为内部权限；plan 仅在旧格式读取边界接受。 */
export const executionPermissionModeSchema = z.enum(["build", "edit", "yolo", "auto"]);
export const executionStateSchema = z.object({
  mode: executionPermissionModeSchema,
  planEnabled: z.boolean(),
  /**
   * 只读会话闸门（探索分支等场景）：权限服务只放行 readOnly 且非 destructive 的工具，
   * EnterPlanMode/ExitPlanMode 一律拒绝。与 plan 模式互斥使用——readOnly 由创建边界
   * （fork）一次性写入并随执行态条目持久化，任何 mode/planEnabled 补丁不得清除。
   */
  readOnly: z.boolean().optional(),
});
export type ExecutionState = z.infer<typeof executionStateSchema>;

/** 在接纳边界固定旧请求语义，不能在队列消费时按当前配置重新解释。 */
export function resolveExecutionState(
  input: { mode?: string; planEnabled?: boolean; readOnly?: boolean },
  current: ExecutionState = { mode: "build", planEnabled: false },
): ExecutionState {
  const mode = executionPermissionModeSchema.safeParse(input.mode);
  return {
    mode: mode.success ? mode.data : current.mode,
    planEnabled:
      input.planEnabled ??
      (input.mode === "plan" ? true : mode.success ? false : current.planEnabled),
    // readOnly 只能被创建边界显式传入；补丁缺省时保持现状，保证既有调用方零语义漂移。
    readOnly: input.readOnly ?? current.readOnly,
  };
}
