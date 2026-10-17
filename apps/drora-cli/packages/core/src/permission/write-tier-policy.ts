/**
 * 工具写入分级与持久化消毒（S03 / specs/agent-write-safety.md）。
 *
 * 策略逻辑集中在本模块（core 属上游对齐代码，既有文件只做 sanctioned 挂点接线）。
 * 分级语义：
 * - P0 任意路径写向量（Bash / js / 所有非 Host 验证 MCP）：整工具 allow 规则不生效、
 *   不提供「总是允许」——逐次确认是唯一放行路径（safe Bash 命令除外，见洞 3）；
 *   MCP 自报 readOnlyHint 不是安全证明，不能降低权限等级；
 * - P1 授权根内写（Write/Edit/ApplyPatch）：维持既有骨架；
 * - P2 免确认区（memory md 等）：由 memory-file-permission 既有覆盖逻辑承担。
 *
 * 宿主验证能力组（OfficialCua）是信任锚在 broker 验证，不受本门控约束。
 */
import { PermissionCapabilityGroup, type PermissionUpdate } from "@drora/contracts";

/** P0 任意路径写向量的固定工具名（非 MCP 面）。`js` 是 node_repl 的模型可见名。 */
export const P0_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set(["Bash", "js"]);

/** MCP 模型可见工具名的统一前缀（mcp__<server>__<tool>，见 core/src/mcp/index.ts）。 */
const MCP_TOOL_NAME_PREFIX = "mcp__";

export interface WriteTierInput {
  toolName: string;
  /** 解析后的能力面：mcp 工具为 "mcp"；MCP 的 readOnlyHint 只用于展示，不能降级权限。 */
  permissionName?: string;
  readOnly?: boolean;
  destructive?: boolean;
  /** 只能由 Host 注入的可信能力组；普通 MCP 描述不能设置此字段。 */
  permissionCapabilityGroup?: PermissionCapabilityGroup;
}

export type WriteToolTier = "p0" | "p1" | "p2";

/** 单一出处：按工具名 + 解析能力判写入分级（specs/agent-write-safety.md §1）。 */
export function resolveWriteToolTier(input: WriteTierInput): WriteToolTier {
  if (isP0WriteTarget(input)) return "p0";
  if (input.toolName === "Write" || input.toolName === "Edit" || input.toolName === "ApplyPatch") {
    return "p1";
  }
  return "p2";
}

/**
 * P0 判定：Bash/js 恒 P0；所有普通 MCP 都是 P0，不采信服务端自报 readOnlyHint。
 * 只有 Host 注入的 OfficialCua capability group 是可信例外。
 */
export function isP0WriteTarget(input: WriteTierInput): boolean {
  if (P0_WRITE_TOOL_NAMES.has(input.toolName)) return true;
  if (input.permissionCapabilityGroup === PermissionCapabilityGroup.OfficialCua) return false;
  return input.permissionName === "mcp" || input.toolName.startsWith(MCP_TOOL_NAME_PREFIX);
}

/**
 * Read-only fast paths require host-trusted capability metadata. MCP annotations
 * are server-authored hints and cannot independently authorize plan/build execution.
 */
export function isTrustedReadOnlyTool(input: WriteTierInput): boolean {
  if (input.readOnly !== true || input.destructive === true) return false;
  const isMcp = input.permissionName === "mcp" || input.toolName.startsWith(MCP_TOOL_NAME_PREFIX);
  if (!isMcp) return true;
  return input.permissionCapabilityGroup === PermissionCapabilityGroup.OfficialCua;
}

/**
 * 规则名侧的 P0 识别（持久化边界没有能力上下文，只能按模型可见名判）。
 * `drora:permission-capability:official_cua` 这类宿主验证规则名不带 `mcp__` 前缀，
 * 天然不在 P0 集合。
 */
export function isP0WriteRuleToolName(ruleToolName: string): boolean {
  return P0_WRITE_TOOL_NAMES.has(ruleToolName) || ruleToolName.startsWith(MCP_TOOL_NAME_PREFIX);
}

/**
 * 持久化边界消毒（洞 2 纵深）：丢弃 P0 工具的无内容 allow 规则（整工具「总是允许」），
 * 返回净化后的数组与被丢弃数。deny/ask 不受限（安全方向）；有内容 allow 不受限；
 * 规则被清空的 update 整条移除（空 addRules 无意义）。
 */
export function sanitizePermissionUpdatesForPersistence(
  updates: PermissionUpdate[],
): { updates: PermissionUpdate[]; droppedWholeToolAllowRules: number } {
  let dropped = 0;
  const sanitized: PermissionUpdate[] = [];
  for (const update of updates) {
    if (update.behavior !== "allow" || !Array.isArray(update.rules)) {
      sanitized.push(update);
      continue;
    }
    const rules = update.rules.filter((rule) => {
      if (rule.ruleContent) return true;
      if (isP0WriteRuleToolName(rule.toolName)) {
        dropped += 1;
        return false;
      }
      return true;
    });
    if (rules.length > 0) sanitized.push({ ...update, rules });
  }
  return { updates: sanitized, droppedWholeToolAllowRules: dropped };
}
