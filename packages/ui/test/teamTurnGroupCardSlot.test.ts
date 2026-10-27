import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "@drora/shared";
import type {
  AssistantTextRow,
  ToolCallRow,
  TurnHeaderRow,
  UserInputRow,
} from "@drora/shared/drora-protocol-v4";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { ConversationTurnGroup } from "@/v4/ConversationTurnGroup.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import type { ConversationTurnRenderUnit } from "@/v4/conversationTurnRenderUnits.js";

/**
 * H3 回归（specs/agents-team.md §10 增补五）：ConversationTimeline 两条路径都把
 * teamCardSlot 条件 spread 给 ConversationTurnGroup，但 TurnGroup 曾未声明该 prop——
 * spread 绕过 TS 检查、prop 被静默丢弃，团队卡在有 TeamSpawn 行的会话完全不渲染。
 * 本文件渲染真实 TurnGroup（renderToStaticMarkup），断言 slot 内容出现在输出 DOM、
 * 且落在轮尾 ConversationWorkflowDigests（digest 区）之前。
 */

vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServices: () => ({}),
}));

vi.mock("@/hooks/useServices.js", () => ({
  useOptionalServices: () => ({
    highspeedCardService: { share: vi.fn() },
  }),
}));

const topicInterrupted = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/v4/botGroupDeliveryContext.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/v4/botGroupDeliveryContext.js")>()),
  useBotTopicInterruption: topicInterrupted,
}));

const rowContext: ConversationRowRenderContext = {
  workspacePath: "/workspace",
  theme: "system",
  codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
};

const noopPlatform = {} as IPlatformService;

function turnHeaderRow(): TurnHeaderRow {
  return {
    rowId: 1,
    turnId: "turn-team",
    createdAt: 1_700_000_000_000,
    createdAtSeq: 1,
    kind: "turnHeader",
    origin: "userInput",
    state: "completedSuccess",
    startedAt: 1_700_000_000_000,
  };
}

function userInputRow(): UserInputRow {
  return {
    rowId: 2,
    turnId: "turn-team",
    createdAt: 1_700_000_000_002,
    createdAtSeq: 2,
    kind: "userInput",
    text: "组一支团队",
    origin: "realUser",
  };
}

function teamSpawnRow(): ToolCallRow {
  return {
    rowId: 3,
    turnId: "turn-team",
    createdAt: 1_700_000_000_003,
    createdAtSeq: 3,
    kind: "toolCall",
    toolCallId: "tool-team-spawn",
    toolName: "TeamSpawn",
    status: "success",
    input: {},
    inputText: "{}",
  };
}

function assistantTextRow(): AssistantTextRow {
  return {
    rowId: 4,
    entityId: "message-assistant-4",
    turnId: "turn-team",
    createdAt: 1_700_000_000_004,
    createdAtSeq: 4,
    kind: "assistantText",
    state: "complete",
    text: "团队已组建完成。",
  };
}

/** 锚定轮最小 unit：renderRows 含 TeamSpawn 工具行 + 轮尾带 workflow digest 来源。 */
function anchoredUnit(): ConversationTurnRenderUnit {
  const teamSpawn = teamSpawnRow();
  const finalText = assistantTextRow();
  return {
    key: "turn-team:1",
    turnId: "turn-team",
    visibleUserInputs: [userInputRow()],
    assistantWorkRows: [teamSpawn, finalText],
    assistantHistoryRows: [],
    assistantFollowingRows: [],
    assistantTailRows: [],
    browserTurnEndRows: [],
    hookInvocations: [],
    assistantTextRows: [finalText],
    leadingBoundaryRows: [],
    flowItems: [
      { kind: "userInput", row: userInputRow() },
      { kind: "assistantText", row: finalText, latest: true },
    ],
    // digest 区来源：workflowLaunch 让 ConversationWorkflowDigests 渲染中性单行卡
    // （run 不在活投影 → status=absent，无需宿主联表）。
    workflowLaunch: { runId: "run-team", toolCallId: "launch-team" },
    renderRows: [teamSpawn, finalText],
    isLastTurn: true,
    isRunning: false,
    assistantHistoryDefaultOpen: false,
    timelineOnly: false,
    workStatus: { state: "completed", durationMs: 5_000 },
  };
}

function renderTurnGroup(unit: ConversationTurnRenderUnit, teamCardSlot?: ReactNode): string {
  return renderToStaticMarkup(
    createElement(
      DroraIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        PlatformProvider,
        { platform: noopPlatform },
        createElement(
          TooltipProvider,
          null,
          createElement(ConversationTurnGroup, {
            unit,
            context: rowContext,
            ...(teamCardSlot === undefined ? {} : { teamCardSlot }),
          }),
        ),
      ),
    ),
  );
}

const SLOT_MARKER = 'data-testid="team-card-slot-anchor"';

describe("ConversationTurnGroup teamCardSlot（§10 增补五 / H3）", () => {
  it("锚定轮传入 teamCardSlot → 卡内容渲染进输出 DOM（修复前 prop 被静默丢弃、完全不渲染）", () => {
    const html = renderTurnGroup(
      anchoredUnit(),
      createElement("div", { "data-testid": "team-card-slot-anchor" }, "团队卡内容"),
    );

    expect(html).toContain(SLOT_MARKER);
    expect(html).toContain("团队卡内容");
  });

  it("卡落在轮尾、ConversationWorkflowDigests（digest 区）之前——照 workflow 轮尾摘要挂载位", () => {
    const html = renderTurnGroup(
      anchoredUnit(),
      createElement("div", { "data-testid": "team-card-slot-anchor" }, "团队卡内容"),
    );

    const bodyIndex = html.indexOf("团队已组建完成。");
    const slotIndex = html.indexOf(SLOT_MARKER);
    // digest 容器标记（digests 非空时必渲染）与中性单行卡（run 不在活投影）双定位。
    const digestContainerIndex = html.indexOf('data-testid="workflow-run-digests-turn-team:1"');
    const digestIndex = html.indexOf('data-workflow-run-digest="true"');

    expect(bodyIndex).toBeGreaterThanOrEqual(0);
    expect(slotIndex).toBeGreaterThan(bodyIndex);
    expect(digestContainerIndex).toBeGreaterThan(slotIndex);
    expect(digestIndex).toBeGreaterThan(slotIndex);
  });

  it("未注入 slot（非锚定轮）→ 不渲染占位（门：Timeline 只给锚定轮注入）", () => {
    const html = renderTurnGroup(anchoredUnit());
    expect(html).not.toContain(SLOT_MARKER);
  });
});
