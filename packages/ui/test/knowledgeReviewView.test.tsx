// @vitest-environment jsdom
import { createElement } from "react";
/**
 * 审核视图组件级测试（D-12 补齐，2026-10-17）：spec §5e.5 WSG-UI-5 以「审核视图测试」
 * 为验证来源，此前该视图仅有 S03 阻断 E2E，组件级行为零覆盖。覆盖本轮修复的行为面：
 * reconcile 人工动作入口（D-1）、undo 按账本 applied 目标禁用（D-6）、过期重批的
 * previewRequired 原因提示（ui-review-5）、操作状态行 i18n（ui-review-6）。
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  IKnowledgeReviewService,
  IObsidianVaultService,
  KnowledgeReviewOperationView,
  KnowledgeReviewProposalView,
  ObsidianVaultSummary,
} from "@drora/services";
import { DroraIntlProvider } from "@/i18n/IntlProvider.js";
import { KnowledgeReviewView } from "@/v4/vault/knowledge/KnowledgeReviewView.js";

const summary: ObsidianVaultSummary = {
  vaultId: "vault-1", displayName: "Vault", inboxPath: "Inbox",
  allowAgentWrites: true, configuredAt: 1,
};

function proposal(overrides: Partial<KnowledgeReviewProposalView> = {}): KnowledgeReviewProposalView {
  return {
    proposalId: "p1", title: "提案", reason: "理由", revision: 1,
    changesHash: "h".repeat(12), rejected: false, approval: null,
    changes: [{ kind: "write", relativePath: "notes/a.md", sizeBytes: 8 }],
    createdAtMs: 1,
    ...overrides,
  } as KnowledgeReviewProposalView;
}

function operation(overrides: Partial<KnowledgeReviewOperationView> = {}): KnowledgeReviewOperationView {
  return {
    operationId: "op-1", proposalId: "p1", revision: 1, vaultId: "vault-1",
    sourceEpoch: 1, status: "applied",
    files: [{ relativePath: "notes/a.md", kind: "write", baseSha256: null, nextSha256: null, snapshotSha256: null, status: "applied", error: null }],
    createdAtMs: 1, finishedAtMs: 2, reconciledAtMs: null, error: null,
    ...overrides,
  } as KnowledgeReviewOperationView;
}

function services(proposals: KnowledgeReviewProposalView[], operations: KnowledgeReviewOperationView[]) {
  const reconcileOperation = vi.fn(async () => ({ outcome: "reconciled", reason: null, operation: null }));
  const reviewService = {
    listProposals: vi.fn(async () => proposals),
    listRecentOperations: vi.fn(async () => operations),
    isWritePathEnabled: vi.fn(() => true),
    isWritePathActivationAllowed: vi.fn(() => true),
    approveProposal: vi.fn(async () => { throw new Error("unused"); }),
    applyProposal: vi.fn(async () => { throw new Error("unused"); }),
    undoOperation: vi.fn(async () => { throw new Error("unused"); }),
    reconcileOperation,
  } as unknown as IKnowledgeReviewService;
  const vaultService = { getSummary: vi.fn(async () => summary) } as unknown as IObsidianVaultService;
  return { reviewService, vaultService, reconcileOperation };
}

function mount(reviewService: IKnowledgeReviewService, vaultService: IObsidianVaultService | null) {
  return render(createElement(DroraIntlProvider, { locale: "zh-CN" },
    createElement(KnowledgeReviewView, { vaultService, reviewService })));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("KnowledgeReviewView 组件行为（D-12）", () => {
  it("D-1：账本卡点（applying/undoing）时渲染 reconcile 人工动作并真实调用服务", async () => {
    const s = services([proposal()], [operation({ status: "applying", files: [file("applying")] })]);
    const view = mount(s.reviewService, s.vaultService);
    const reconcile = await waitForButton(view, "review-proposal-reconcile");
    expect(reconcile).toBeTruthy();
    fireEvent.click(reconcile!);
    await waitFor(() => expect(s.reconcileOperation).toHaveBeenCalledWith({ operationId: "op-1" }));
  });

  it("D-1：非卡点态不渲染 reconcile 入口", async () => {
    const s = services([proposal()], [operation()]);
    const view = mount(s.reviewService, s.vaultService);
    await waitFor(() => expect(view.queryByTestId("review-proposal-card")).toBeTruthy());
    expect(view.queryByTestId("review-proposal-reconcile")).toBeNull();
  });

  it("D-6：无 applied 目标时 undo 禁用；有 applied 目标且门禁开启时可用", async () => {
    const noTarget = services([proposal()], [operation({ status: "conflict", files: [file("conflict")] })]);
    const view1 = mount(noTarget.reviewService, noTarget.vaultService);
    const undo1 = await waitForButton(view1, "review-proposal-undo");
    expect(undo1?.hasAttribute("disabled")).toBe(true);

    const withTarget = services([proposal()], [operation()]);
    const view2 = mount(withTarget.reviewService, withTarget.vaultService);
    const undo2 = await waitForButton(view2, "review-proposal-undo");
    await waitFor(() => expect(undo2?.hasAttribute("disabled")).toBe(false));
  });

  it("ui-review-5：过期批准的重新批准被预览门禁禁用并显示原因提示", async () => {
    const expired = proposal({
      approval: { revision: 0, changesHash: "old", sourceEpoch: 1, approvedAtMs: 1, expiresAtMs: 1 },
    });
    const s = services([expired], []);
    const view = mount(s.reviewService, s.vaultService);
    await waitFor(() => expect(view.queryByTestId("review-approval-preview-required")).toBeTruthy());
    const approve = view.container.querySelector<HTMLButtonElement>('[data-testid="review-proposal-card"] button');
    expect(approve?.hasAttribute("disabled")).toBe(true);
  });

  it("ui-review-6：操作状态行渲染本地化文案而非英文枚举", async () => {
    const s = services([proposal()], [operation()]);
    const view = mount(s.reviewService, s.vaultService);
    await waitFor(() => expect(view.queryByTestId("review-operation-state")).toBeTruthy());
    const text = view.getByTestId("review-operation-state").textContent ?? "";
    // 语言随 Provider 环境而定；断言核心是「本地化文案」而非裸 snake_case 枚举。
    expect(text).toMatch(/已应用|Applied/);
    expect(text).not.toMatch(/undo_applied|not_landed/);
  });
});

function file(status: KnowledgeReviewOperationView["files"][number]["status"]) {
  return { relativePath: "notes/a.md", kind: "write" as const, baseSha256: null, nextSha256: null, snapshotSha256: null, status, error: null };
}

async function waitForButton(view: { container: HTMLElement }, testId: string): Promise<HTMLButtonElement | null> {
  let button: HTMLButtonElement | null = null;
  await waitFor(() => {
    button = view.container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
    expect(button).toBeTruthy();
  });
  return button;
}
