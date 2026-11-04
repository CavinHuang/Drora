import { describe, expect, it } from "vitest";
import { DRORA_KNOWN_TOOL_NAMES } from "@drora/shared";
import { builtInTools } from "../src/tool/handlers/index.js";

/**
 * 内置工具 × UI 工具身份表 parity（specs/model-capabilities.md §12 修复 F-1 的拦截测试）。
 *
 * 回归背景：generate_image 落地时未登记 DRORA_KNOWN_TOOL_NAMES，v4 消息流的
 * node_repl_images 展示载荷（CLI 已产出、wire 上存活）没有任何渲染器消费——
 * 用户只看到「Image saved to: <path>」文本。两侧都有测试、中间断链无测试，
 * 本测试把「内置工具必须可被 UI 识别」钉成硬约束。
 */

/**
 * 已确认由其他渲染路径认领、无需进 known 表的历史工具名（登记于 2026-11-12 之前，
 * 逐个注明理由；**新增工具默认不得进此表**——新工具落 raw fallback 卡属回归）。
 */
const KNOWN_TABLE_EXEMPTIONS = new Set<string>([
  // resolveRenderer.ts 按工具名先分流（登记前后两种世界都成立，见该文件注释）：
  "ToolSearch",
  "LocalToolSearch",
  "escalate",
  "ResolveWorkflowQuestion",
  "SaveWorkflow",
  "EvalWorkflowSnippet",
  "ListWorkflowRuns",
  "GetWorkflowRun",
  "ResumeWorkflowRun",
  "ListSavedWorkflows",
  "ListModels",
  // resolveToolCallIdentity 的 legacy plan 路径按 kind/title 归一化（enter/exit plan mode）：
  "EnterPlanMode",
  "ExitPlanMode",
  // 历史兼容别名（AgentOutput/BashOutput 系与 KillShell/KillBash），只出现在旧投影：
  "AgentOutputTool",
  "BashOutputTool",
  "AgentOutput",
  "BashOutput",
  "KillShell",
  "KillBash",
  // 既有产品现状：fallback 卡渲染（无内联媒体载荷，fallback 展示可接受）：
  "CronCreate",
  "CronList",
  "CronUpdate",
  "CronDelete",
  "CronPauseSelf",
  "OffPeakCreate",
  "OffPeakList",
  "DeferredToolCall",
  // 已知渲染缺口，独立工单跟踪（core 侧 vaultSearchPort 传递链断裂一并处理）：
  "VaultSearch",
]);

describe("内置工具必须登记进 UI 已知工具表", () => {
  it("builtInTools 的每个工具名都在 DRORA_KNOWN_TOOL_NAMES（或具名豁免表）", () => {
    const known = new Set<string>(DRORA_KNOWN_TOOL_NAMES);
    const missing: string[] = [];
    for (const entry of builtInTools) {
      for (const name of [entry.metadata?.name, ...(entry.aliases ?? [])]) {
        if (typeof name !== "string" || name.length === 0) continue;
        if (!known.has(name) && !KNOWN_TABLE_EXEMPTIONS.has(name)) {
          missing.push(name);
        }
      }
    }
    expect(
      missing,
      `以下内置工具未被 UI 已知工具表识别（identity 回 unknown，将落 raw fallback 卡）：${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("generate_image 已登记且归属 image-generation family", async () => {
    const { getDroraToolFamilyForName } = await import("@drora/shared");
    expect(getDroraToolFamilyForName("generate_image")).toBe("image-generation");
  });
});
