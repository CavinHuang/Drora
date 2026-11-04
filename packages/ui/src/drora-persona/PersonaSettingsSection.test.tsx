// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zhCNMessages from "@/i18n/locales/zh-CN.js";

/**
 * PersonaSettingsSection 交互守护（specs/drora-persona-system.md §10 第十六批、
 * docs/design/drora-persona-data-tract-2026-10-29.md §2/§3）：
 * - 即时保存：无整块保存按钮；离散选择变更即提交；文本字段失焦提交；未初始化不自动提交；
 * - 五字段受控编辑：局部草稿、CAS（expectedRevision+mutationId）、成功后重读版本；
 * - CAS revision 冲突：保留草稿并提供「已保存 vs 草稿」比较；分歧中继续编辑面板重现；
 *   分歧未解决时自动提交暂停，不反复撞 CAS；
 * - 单字段回退（↺）替代整块「放弃修改」；
 * - 未初始化：built_in_preview + 显式初始化；只打开页面不初始化；
 * - 预览/应用情况/导出/恢复默认收进「高级」折叠区，默认收起；
 * - E 开关文案：必须说「用于新建或真正重新加载的会话」，不得出现「当前会话已关闭」；
 *   附隐私说明（个性化内容发送给当前选择的模型并可能随原诊断保留）；
 * - focus 重读：脏草稿不被覆盖；服务 revision 前进时出现分歧面板；
 * - 服务不可用（旧 CLI/断线）：诚实降级为不可用，不吞错误。
 */

// radix Select 内容挂载需要（jsdom 缺失）。
window.HTMLElement.prototype.scrollIntoView = () => undefined;
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => undefined;
window.HTMLElement.prototype.releasePointerCapture = () => undefined;

const mocks = vi.hoisted(() => {
  const savedCore = {
    displayName: "Drora",
    selfDescription: "",
    warmth: "balanced",
    directness: "direct",
    humor: "light",
  };
  const template = {
    templateVersion: 1,
    compilerVersion: 1,
    identityStatement: "identity-statement",
    principles: ["principle-1"],
    capabilityHonesty: "honesty",
    relationshipBoundary: "boundary",
  };
  const state = {
    coreRevision: 1,
    initialized: true,
    // 服务权威核心：可变，updatePersonaCore/resetPersonaCore 真实落库，
    // 重读（getPersonaCore）返回它——与 PersonaAppService 的 CAS 语义对齐。
    core: { ...savedCore } as Record<string, string>,
    // P1a 偏好行与策略（PersonaSettingsSection 内挂表达区，进区会真实读取；
    // P1a 交互守护在 usePersonaPreferences.test.tsx 独立驱动）。
    policy: { usePreferences: false, autoLearn: false, policyRevision: 0, policyEpoch: 0 },
    preferenceRows: {} as Record<
      string,
      {
        value: string | null;
        revision: number;
        keyGeneration: number;
        status: "active" | "forgotten";
      }
    >,
  };
  const personaService = {
    getPersonaOverview: vi.fn(),
    initializePersona: vi.fn(),
    getPersonaCore: vi.fn(),
    updatePersonaCore: vi.fn(),
    resetPersonaCore: vi.fn(),
    previewPersona: vi.fn(),
    getPersonaApplication: vi.fn(),
    // P1a 交流默认/策略/导出（PersonaControlService Pick 扩展）：P0 用例不驱动写入路径，
    // 但内挂表达区进区会调用 listPreferences/getPersonaOverview/getPersonaLearningOverview
    // （只读实现见 defaultResponses）。
    setPersonalPolicy: vi.fn(),
    savePreference: vi.fn(),
    forgetPreference: vi.fn(),
    listPreferences: vi.fn(),
    preparePersonaExport: vi.fn(),
    // P1b 有限学习管理（PersonaControlService Pick 扩展）：P0 用例只覆盖只读进区路径。
    allowLearningForKey: vi.fn(),
    getPersonaLearningOverview: vi.fn(),
  };
  return { savedCore, template, state, personaService };
});

/** P1a 只读导出的冻结快照样例（合同 §7 最小形状）。 */
function personaExportPayload(): Record<string, unknown> {
  return {
    format: "drora-persona-export",
    formatVersion: 1,
    capturedAt: "2026-10-30T00:00:00.000Z",
    coreRevision: mocks.state.coreRevision,
    policyRevision: mocks.state.policy.policyRevision,
    core: { ...mocks.savedCore },
    templateVersion: 1,
    compilerVersion: 1,
    preferences: [],
    omittedCounts: { inferredOmittedUnverifiable: 0 },
    limitations: ["limitation-1"],
  };
}

function defaultResponses(): void {
  mocks.state.coreRevision = 1;
  mocks.state.initialized = true;
  mocks.state.core = { ...mocks.savedCore };
  mocks.state.policy = {
    usePreferences: false,
    autoLearn: false,
    policyRevision: 0,
    policyEpoch: 0,
  };
  mocks.state.preferenceRows = {};
  mocks.personaService.getPersonaOverview.mockImplementation(async () => ({
    ok: true,
    value: mocks.state.initialized
      ? {
          state: "initialized",
          personaId: "persona-1",
          schemaVersion: 1,
          coreRevision: mocks.state.coreRevision,
          templateVersion: 1,
          compilerVersion: 1,
        }
      : { state: "uninitialized" },
  }));
  mocks.personaService.getPersonaCore.mockImplementation(async () => ({
    ok: true,
    value: mocks.state.initialized
      ? {
          state: "current",
          coreRevision: mocks.state.coreRevision,
          core: { ...mocks.state.core },
          template: mocks.template,
        }
      : { state: "built_in_preview", core: { ...mocks.state.core }, template: mocks.template },
  }));
  mocks.personaService.previewPersona.mockResolvedValue({
    ok: true,
    value: { text: "PREVIEW-TEXT", templateVersion: 1, compilerVersion: 1 },
  });
  mocks.personaService.initializePersona.mockReset();
  mocks.personaService.updatePersonaCore.mockReset();
  mocks.personaService.resetPersonaCore.mockReset();
  mocks.personaService.getPersonaApplication.mockReset();
  // ---- P1a 只读路径（内挂表达区进区即读；写路径由 usePersonaPreferences.test.tsx 驱动）----
  mocks.personaService.listPreferences.mockImplementation(async () => ({
    ok: true,
    value: {
      // 未初始化时服务返回空答案（与 PersonaAppService 一致），不是错误。
      preferences: Object.entries(mocks.state.preferenceRows)
        .filter(([, row]) => row.status === "active" && mocks.state.initialized)
        .map(([key, row]) => ({
          key,
          value: row.value ?? "",
          revision: row.revision,
          keyGeneration: row.keyGeneration,
          provenanceKind: "settings",
          epistemicStatus: "explicit",
          pinned: true,
          updatedAt: 0,
        })),
    },
  }));
  mocks.personaService.getPersonaLearningOverview.mockImplementation(async () => {
    if (!mocks.state.initialized) return { ok: true, value: { state: "uninitialized" } };
    return {
      ok: true,
      value: {
        state: "initialized",
        policy: {
          usePreferences: mocks.state.policy.usePreferences,
          autoLearn: mocks.state.policy.autoLearn,
          policyRevision: mocks.state.policy.policyRevision,
          policyEpoch: mocks.state.policy.policyEpoch,
          learningGeneration: 0,
        },
        budget: { day: "2026-11-02", attemptsUsed: 0, inputTokensUsed: 0, outputTokensUsed: 0 },
        sources: [],
        counters: {
          received: 0,
          droppedQueueFull: 0,
          acceptAccepted: 0,
          acceptAlreadyAccepted: 0,
          acceptSkipped: {},
          workApplied: 0,
          workNoChange: 0,
          workRejected: 0,
          workRetryWait: 0,
          workConflicts: 0,
          orchestrationErrors: 0,
        },
      },
    };
  });
  mocks.personaService.preparePersonaExport.mockImplementation(async () => {
    if (!mocks.state.initialized) return { ok: false, code: "uninitialized" };
    return { ok: true, value: personaExportPayload() };
  });
}

vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({
    intl: {
      // 用真实 zh-CN 文案 + 与 IntlProvider 相同的插值规则，
      // 使 E 开关文案的硬边界断言落在真实产品文案上。
      formatMessage: ({ id }: { id: string }, values?: Record<string, string | number>) => {
        let message: string = (zhCNMessages as Record<string, string>)[id] ?? id;
        if (values) {
          for (const [key, value] of Object.entries(values)) {
            message = message.replaceAll(`{${key}}`, String(value));
          }
        }
        return message;
      },
    },
    locale: "zh-CN",
  }),
}));

const { PersonaSettingsSection } = await import("./PersonaSettingsSection.js");

function renderSection(props: Partial<Parameters<typeof PersonaSettingsSection>[0]> = {}) {
  return render(
    <PersonaSettingsSection
      personaService={mocks.personaService}
      personaEnabled={false}
      onPersonaEnabledChange={vi.fn(async () => {})}
      applicationWorkspace={{ workspacePath: "/repo" }}
      {...props}
    />,
  );
}

function inputById(testId: string): HTMLInputElement {
  return screen.getByTestId(testId) as HTMLInputElement;
}

function buttonById(testId: string): HTMLButtonElement {
  return screen.getByTestId(testId) as HTMLButtonElement;
}

/** 展开「高级」折叠区（预览/应用情况/导出/恢复默认默认收起，spec §10 第十六批）。 */
async function openAdvancedArea(): Promise<void> {
  fireEvent.click(screen.getByTestId("settings-persona-advanced-trigger"));
  await waitFor(() => {
    expect(screen.getByTestId("settings-persona-preview")).toBeTruthy();
  });
}

async function openInitialisedSection(): Promise<void> {
  renderSection();
  await waitFor(() => {
    expect(screen.getByTestId("settings-persona-saved-revision").textContent).toContain(
      "revision 1",
    );
  });
}

beforeEach(() => {
  defaultResponses();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PersonaSettingsSection", () => {
  it("打开页面只读取：无保存按钮，渲染五字段与开关区，不初始化、不保存、E 不被打开", async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-saved-revision").textContent).toContain(
        "revision 1",
      );
    });
    expect(inputById("settings-persona-display-name").value).toBe("Drora");
    expect(mocks.personaService.initializePersona).not.toHaveBeenCalled();
    expect(mocks.personaService.updatePersonaCore).not.toHaveBeenCalled();
    expect(screen.getByTestId("settings-persona-enabled-switch").getAttribute("data-state")).toBe(
      "unchecked",
    );
    // 即时保存（spec §10 第十六批）：整块保存/放弃修改按钮不再存在。
    expect(screen.queryByTestId("settings-persona-save")).toBeNull();
    expect(screen.queryByTestId("settings-persona-cancel")).toBeNull();
    // U/L 开关如实显示概览读到的服务值（默认关闭）。
    expect(screen.getByTestId("settings-persona-policy-switch").getAttribute("data-state")).toBe(
      "unchecked",
    );
    expect(screen.getByTestId("settings-persona-learning-switch").getAttribute("data-state")).toBe(
      "unchecked",
    );
  });

  it("未初始化：显式初始化入口存在；文本失焦不产生写调用；恢复默认不可用", async () => {
    mocks.state.initialized = false;
    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-initialize")).toBeTruthy();
    });
    expect(screen.getByTestId("settings-persona-section").textContent).toContain("尚未初始化");
    // 只打开页面不初始化：未点击前零写调用。
    expect(mocks.personaService.initializePersona).not.toHaveBeenCalled();
    // 未初始化不自动提交（spec §10 第十六批）：编辑＋失焦也不产生写调用。
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    fireEvent.blur(inputById("settings-persona-display-name"));
    expect(mocks.personaService.updatePersonaCore).not.toHaveBeenCalled();

    await openAdvancedArea();
    expect(buttonById("settings-persona-reset-defaults").disabled).toBe(true);

    mocks.personaService.initializePersona.mockImplementation(async () => {
      mocks.state.initialized = true;
      return {
        ok: true,
        value: {
          state: "initialized",
          status: "created",
          personaId: "persona-1",
          schemaVersion: 1,
          coreRevision: 1,
          templateVersion: 1,
          compilerVersion: 1,
        },
      };
    });
    fireEvent.click(screen.getByTestId("settings-persona-initialize"));
    await waitFor(() => {
      expect(mocks.personaService.initializePersona).toHaveBeenCalledTimes(1);
    });
    const initInput = mocks.personaService.initializePersona.mock.calls[0]?.[0] as {
      mutationId: string;
    };
    expect(typeof initInput.mutationId).toBe("string");
    expect(initInput.mutationId.length).toBeGreaterThan(0);
    // 初始化成功后重读：已保存版本徽章出现。
    await waitFor(() => {
      expect(screen.queryByTestId("settings-persona-saved-revision")).toBeTruthy();
    });
    expect(screen.getByTestId("settings-persona-notice").textContent).toContain("已初始化");
  });

  it("文本字段失焦提交：CAS 携带 expectedRevision+mutationId，成功后重读且文案不冒充已应用", async () => {
    await openInitialisedSection();
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    // 停顿未到去抖阈值时不写（提交时机由失焦驱动）。
    expect(mocks.personaService.updatePersonaCore).not.toHaveBeenCalled();

    mocks.personaService.updatePersonaCore.mockImplementation(
      async (input: { expectedRevision: number; patch: Record<string, unknown> }) => {
        // mock 服务真实落库：重读（getPersonaCore）返回提交后的字段。
        mocks.state.core = { ...input.patch } as Record<string, string>;
        mocks.state.coreRevision = input.expectedRevision + 1;
        return { ok: true, value: { status: "saved", coreRevision: mocks.state.coreRevision } };
      },
    );
    fireEvent.blur(inputById("settings-persona-display-name"));
    await waitFor(() => {
      expect(mocks.personaService.updatePersonaCore).toHaveBeenCalledTimes(1);
    });
    const updateInput = mocks.personaService.updatePersonaCore.mock.calls[0]?.[0] as {
      expectedRevision: number;
      patch: Record<string, unknown>;
      mutationId: string;
    };
    expect(updateInput.expectedRevision).toBe(1);
    expect(updateInput.patch.displayName).toBe("朵拉");
    // 全五字段显式提交，不发生其余字段的静默缺省。
    expect(updateInput.patch.warmth).toBe(mocks.savedCore.warmth);
    expect(updateInput.patch.directness).toBe(mocks.savedCore.directness);
    expect(updateInput.patch.humor).toBe(mocks.savedCore.humor);
    expect(updateInput.patch.selfDescription).toBe(mocks.savedCore.selfDescription);
    expect(typeof updateInput.mutationId).toBe("string");
    expect(updateInput.mutationId.length).toBeGreaterThan(0);

    // 保存成功后重读版本（spec §10）：徽章显示新 revision；成功文案不声称当前轮已应用。
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-saved-revision").textContent).toContain(
        "revision 2",
      );
    });
    const noticeText = screen.getByTestId("settings-persona-notice").textContent ?? "";
    expect(noticeText).toContain("下一次新轮生效");
    expect(noticeText).not.toContain("已应用");
    // 保存后草稿基线对齐新版本：输入仍是新值，回退按钮消失。
    expect(inputById("settings-persona-display-name").value).toBe("朵拉");
    expect(screen.queryByTestId("settings-persona-revert-displayName")).toBeNull();
  });

  it("离散选择即存：warmth 变更立即携带全五字段提交，trigger 走 select 路径", async () => {
    await openInitialisedSection();
    mocks.personaService.updatePersonaCore.mockImplementation(
      async (input: { expectedRevision: number; patch: Record<string, unknown> }) => {
        mocks.state.core = { ...input.patch } as Record<string, string>;
        mocks.state.coreRevision = input.expectedRevision + 1;
        return { ok: true, value: { status: "saved", coreRevision: mocks.state.coreRevision } };
      },
    );
    fireEvent.pointerDown(screen.getByTestId("settings-persona-warmth"), {
      button: 0,
      ctrlKey: false,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByText("克制"));
    await waitFor(() => {
      expect(mocks.personaService.updatePersonaCore).toHaveBeenCalledTimes(1);
    });
    const updateInput = mocks.personaService.updatePersonaCore.mock.calls[0]?.[0] as {
      expectedRevision: number;
      patch: Record<string, unknown>;
    };
    expect(updateInput.expectedRevision).toBe(1);
    expect(updateInput.patch.warmth).toBe("restrained");
    // 其余字段显式随行，不做静默缺省。
    expect(updateInput.patch.displayName).toBe(mocks.savedCore.displayName);
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-saved-revision").textContent).toContain(
        "revision 2",
      );
    });
  });

  it("CAS revision 冲突：保留草稿并给出比较；分歧未解决时自动提交暂停；分歧中编辑面板重现", async () => {
    await openInitialisedSection();
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    mocks.personaService.updatePersonaCore.mockResolvedValue({
      ok: false,
      code: "revision_conflict",
    });
    // 冲突后重读发现服务已前进到 revision 4（另一窗口已保存）。
    mocks.state.coreRevision = 4;
    fireEvent.blur(inputById("settings-persona-display-name"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-divergence")).toBeTruthy();
    });
    // 草稿保留：输入未被替换成服务值。
    expect(inputById("settings-persona-display-name").value).toBe("朵拉");
    // 比较面板同时展示服务最新版本（Drora）与草稿（朵拉）及两个出口。
    const divergenceText = screen.getByTestId("settings-persona-divergence").textContent ?? "";
    expect(divergenceText).toContain("revision 4");
    expect(divergenceText).toContain("revision 1");
    expect(divergenceText).toContain("Drora");
    expect(divergenceText).toContain("朵拉");
    expect(screen.getByTestId("settings-persona-keep-draft")).toBeTruthy();
    expect(screen.getByTestId("settings-persona-discard-draft")).toBeTruthy();

    // 分歧未解决：再次失焦不产生第二次 CAS 写（自动提交暂停，面板是唯一解决面）。
    fireEvent.blur(inputById("settings-persona-display-name"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.personaService.updatePersonaCore).toHaveBeenCalledTimes(1);

    // 保留草稿：分歧面板收起，草稿原样。
    fireEvent.click(screen.getByTestId("settings-persona-keep-draft"));
    expect(screen.queryByTestId("settings-persona-divergence")).toBeNull();
    expect(inputById("settings-persona-display-name").value).toBe("朵拉");

    // 分歧中的后续编辑：面板重现（spec §10 第十六批），解决面保持可见。
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉二" } });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-divergence")).toBeTruthy();
    });

    // 放弃草稿并加载最新（服务 revision 6）。
    mocks.state.coreRevision = 6;
    fireEvent.click(screen.getByTestId("settings-persona-discard-draft"));
    await waitFor(() => {
      expect(inputById("settings-persona-display-name").value).toBe("Drora");
    });
    expect(screen.queryByTestId("settings-persona-divergence")).toBeNull();
  });

  it("单字段回退：↺ 只对脏字段可见，点击回到已保存值", async () => {
    await openInitialisedSection();
    expect(screen.queryByTestId("settings-persona-revert-displayName")).toBeNull();
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    expect(screen.getByTestId("settings-persona-revert-displayName")).toBeTruthy();
    fireEvent.click(screen.getByTestId("settings-persona-revert-displayName"));
    expect(inputById("settings-persona-display-name").value).toBe("Drora");
    expect(screen.queryByTestId("settings-persona-revert-displayName")).toBeNull();
    // 回退到基线后无未落盘改动：失焦不产生写调用。
    fireEvent.blur(inputById("settings-persona-display-name"));
    expect(mocks.personaService.updatePersonaCore).not.toHaveBeenCalled();
  });

  it("outcome_unknown：结果未知文案 + 重试复用同一 mutationId（同 ID 幂等回放），成功后换新 ID", async () => {
    await openInitialisedSection();
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    const mutationIds: string[] = [];
    let attempts = 0;
    mocks.personaService.updatePersonaCore.mockImplementation(
      async (input: {
        expectedRevision: number;
        patch: Record<string, unknown>;
        mutationId: string;
      }) => {
        mutationIds.push(input.mutationId);
        attempts += 1;
        if (attempts === 1) return { ok: false, code: "outcome_unknown" };
        // 同 ID 重试：真实服务按 receipt 幂等回放；mock 落库对齐 CAS 语义。
        mocks.state.core = { ...input.patch } as Record<string, string>;
        mocks.state.coreRevision = input.expectedRevision + 1;
        return { ok: true, value: { status: "saved", coreRevision: mocks.state.coreRevision } };
      },
    );
    fireEvent.blur(inputById("settings-persona-display-name"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-notice").textContent ?? "").toContain("结果未知");
    });
    // 失败提示不得声称确定性失败（文案说明未确认与幂等回放）。
    expect(screen.getByTestId("settings-persona-notice").textContent ?? "").toContain("幂等回放");

    // 重试（再次失焦结算）：必须复用同一 mutationId（合同 §2/PM53：不换新 ID 重写）。
    fireEvent.blur(inputById("settings-persona-display-name"));
    await waitFor(() => {
      expect(mutationIds).toHaveLength(2);
    });
    expect(mutationIds[1]).toBe(mutationIds[0]);
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-saved-revision").textContent).toContain(
        "revision 2",
      );
    });

    // 成功（确定性结果）后在途 ID 已清除：下一次提交换新 ID。
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉二" } });
    fireEvent.blur(inputById("settings-persona-display-name"));
    await waitFor(() => {
      expect(mutationIds).toHaveLength(3);
    });
    expect(mutationIds[2]).not.toBe(mutationIds[0]);
  });

  it("RPC 失败（断线/超时）：结果未知，重试同样复用同一 mutationId", async () => {
    await openInitialisedSection();
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    const mutationIds: string[] = [];
    let attempts = 0;
    mocks.personaService.updatePersonaCore.mockImplementation(
      async (input: {
        expectedRevision: number;
        patch: Record<string, unknown>;
        mutationId: string;
      }) => {
        mutationIds.push(input.mutationId);
        attempts += 1;
        if (attempts === 1) throw new Error("transport closed");
        mocks.state.core = { ...input.patch } as Record<string, string>;
        mocks.state.coreRevision = input.expectedRevision + 1;
        return { ok: true, value: { status: "saved", coreRevision: mocks.state.coreRevision } };
      },
    );
    fireEvent.blur(inputById("settings-persona-display-name"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-notice").textContent ?? "").toContain(
        "transport closed",
      );
    });
    fireEvent.blur(inputById("settings-persona-display-name"));
    await waitFor(() => {
      expect(mutationIds).toHaveLength(2);
    });
    // RPC 层失败同样保留在途 ID：重试同 ID 回放，不换新 ID。
    expect(mutationIds[1]).toBe(mutationIds[0]);
  });

  it("恢复产品默认（高级折叠区）：确认后以草稿基线 revision 调用 resetPersonaCore 并重读", async () => {
    await openInitialisedSection();
    await openAdvancedArea();
    fireEvent.click(screen.getByTestId("settings-persona-reset-defaults"));
    await waitFor(() => {
      expect(document.body.textContent).toContain("恢复产品默认？");
    });
    mocks.personaService.resetPersonaCore.mockImplementation(
      async (input: { expectedRevision: number }) => {
        // 恢复产品默认：服务落回产品默认字段并生成新版本。
        mocks.state.core = { ...mocks.savedCore };
        mocks.state.coreRevision = input.expectedRevision + 1;
        return { ok: true, value: { status: "saved", coreRevision: mocks.state.coreRevision } };
      },
    );
    fireEvent.click(screen.getByText("恢复默认"));
    await waitFor(() => {
      expect(mocks.personaService.resetPersonaCore).toHaveBeenCalledTimes(1);
    });
    expect(mocks.personaService.resetPersonaCore.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 1,
    });
    const resetInput = mocks.personaService.resetPersonaCore.mock.calls[0]?.[0] as
      | { expectedRevision: number; mutationId: string }
      | undefined;
    expect(typeof resetInput?.mutationId).toBe("string");
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-saved-revision").textContent).toContain(
        "revision 2",
      );
    });
  });

  it("高级折叠区默认收起：展开后预览/应用查询/导出/恢复默认齐备，预览免责声明可见", async () => {
    await openInitialisedSection();
    // 默认收起：预览与应用查询不在 DOM。
    expect(screen.queryByTestId("settings-persona-preview")).toBeNull();
    expect(screen.queryByTestId("settings-persona-application-query")).toBeNull();
    await openAdvancedArea();
    expect(screen.getByTestId("settings-persona-application-query")).toBeTruthy();
    expect(buttonById("settings-persona-export")).toBeTruthy();
    expect(buttonById("settings-persona-reset-defaults")).toBeTruthy();
    expect(screen.getByTestId("settings-persona-section").textContent ?? "").toContain(
      "预览不是实际输出保证",
    );
    await waitFor(
      () => {
        expect(screen.getByTestId("settings-persona-preview").textContent ?? "").toContain(
          "PREVIEW-TEXT",
        );
      },
      { timeout: 2000 },
    );
    const previewInput = mocks.personaService.previewPersona.mock.calls[0]?.[0] as {
      draft: Record<string, unknown>;
    };
    expect(previewInput.draft).toMatchObject(mocks.savedCore);
    // 预览不写库。
    expect(mocks.personaService.updatePersonaCore).not.toHaveBeenCalled();
    expect(mocks.personaService.initializePersona).not.toHaveBeenCalled();
  });

  it("E 开关：文案说明用于新建或真正重新加载的会话并附隐私说明；不得显示当前会话已关闭", async () => {
    const onPersonaEnabledChange = vi.fn(async () => {});
    renderSection({ personaEnabled: true, onPersonaEnabledChange });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-section")).toBeTruthy();
    });
    const sectionText = screen.getByTestId("settings-persona-section").textContent ?? "";
    // 硬边界：必须说「用于新建或真正重新加载的会话」。
    expect(sectionText).toContain("用于新建或真正重新加载的会话");
    // 硬边界：不得显示「当前会话已关闭」。
    expect(sectionText).not.toContain("当前会话已关闭");
    // 隐私说明：个性化内容发送给当前选择的模型，并可能随原诊断保留。
    expect(sectionText).toContain("发送给当前选择的模型");
    expect(sectionText).toContain("随原诊断记录保留");
    // 开关反映 AppSettings.personaEnabled（true 传入），切换经既有设置保存通道回调。
    expect(screen.getByTestId("settings-persona-enabled-switch").getAttribute("data-state")).toBe(
      "checked",
    );
    fireEvent.click(screen.getByTestId("settings-persona-enabled-switch"));
    await waitFor(() => {
      expect(onPersonaEnabledChange).toHaveBeenCalledWith(false);
    });
  });

  it("应用情况（高级折叠区）：已保存版本与应用事实分开显示；查询三态如实渲染", async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-saved-revision").textContent).toContain(
        "revision 1",
      );
    });
    await openAdvancedArea();
    // 未查询时如实显示未应用（无执行记录），不预造状态。
    expect(screen.getByTestId("settings-persona-application-result").textContent ?? "").toContain(
      "未应用",
    );
    // 已保存版本行独立存在，且不与运行时应用状态混同。
    const sectionText = screen.getByTestId("settings-persona-section").textContent ?? "";
    expect(sectionText).toContain("模板 v1");
    expect(sectionText).toContain("已冻结的轮不变");

    mocks.personaService.getPersonaApplication.mockResolvedValue({
      status: "applied",
      turnId: "turn-1",
    });
    fireEvent.change(inputById("settings-persona-application-session"), {
      target: { value: "session-1" },
    });
    fireEvent.change(inputById("settings-persona-application-turn"), {
      target: { value: "turn-1" },
    });
    fireEvent.click(screen.getByTestId("settings-persona-application-query"));
    await waitFor(() => {
      expect(mocks.personaService.getPersonaApplication).toHaveBeenCalledTimes(1);
    });
    expect(mocks.personaService.getPersonaApplication).toHaveBeenCalledWith({
      workspacePath: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-application-result").textContent ?? "").toContain(
        "已应用",
      );
    });

    mocks.personaService.getPersonaApplication.mockResolvedValue({
      status: "omitted",
      turnId: "turn-1",
      reason: "permission_not_granted",
    });
    fireEvent.click(screen.getByTestId("settings-persona-application-query"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-application-result").textContent ?? "").toContain(
        "已省略",
      );
    });
    expect(screen.getByTestId("settings-persona-application-result").textContent ?? "").toContain(
      "执行许可未开启",
    );

    // compile_failed（已存核心编译失败，spec §6）：有文案映射，不把生硬英文码直接甩给用户。
    mocks.personaService.getPersonaApplication.mockResolvedValue({
      status: "omitted",
      turnId: "turn-1",
      reason: "compile_failed",
    });
    fireEvent.click(screen.getByTestId("settings-persona-application-query"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-application-result").textContent ?? "").toContain(
        "已保存资料编译失败",
      );
    });

    // 重启后 CLI 如实 not_available：显示未应用（不伪造冷历史）。
    mocks.personaService.getPersonaApplication.mockResolvedValue({ status: "not_available" });
    fireEvent.click(screen.getByTestId("settings-persona-application-query"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-application-result").textContent ?? "").toContain(
        "未应用",
      );
    });
  });

  it("无本地 workspace 时不提供应用查询，并说明原因", async () => {
    renderSection({ applicationWorkspace: null });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-section")).toBeTruthy();
    });
    await openAdvancedArea();
    expect(screen.queryByTestId("settings-persona-application-query")).toBeNull();
    expect(screen.getByTestId("settings-persona-section").textContent).toContain(
      "打开本地工作区后才能查询",
    );
    expect(mocks.personaService.getPersonaApplication).not.toHaveBeenCalled();
  });

  it("focus 重读：脏草稿不被覆盖；服务 revision 前进时出现分歧面板", async () => {
    await openInitialisedSection();
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    const callsBefore = mocks.personaService.getPersonaCore.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(mocks.personaService.getPersonaCore.mock.calls.length).toBeGreaterThan(callsBefore);
    });
    // revision 未变：脏草稿原样保留，无分歧提示。
    expect(inputById("settings-persona-display-name").value).toBe("朵拉");
    expect(screen.queryByTestId("settings-persona-divergence")).toBeNull();

    // 服务前进（另一窗口保存）：focus 重读后出现分歧提示，草稿仍不被覆盖；
    // 分歧未解决时自动提交暂停（失焦不产生第二次写）。
    mocks.state.coreRevision = 5;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-divergence")).toBeTruthy();
    });
    expect(inputById("settings-persona-display-name").value).toBe("朵拉");
    mocks.personaService.updatePersonaCore.mockClear();
    fireEvent.blur(inputById("settings-persona-display-name"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.personaService.updatePersonaCore).not.toHaveBeenCalled();
  });

  it("服务不可用（旧 CLI/断线）：诚实降级为不可用并提供重试，不吞错误", async () => {
    mocks.personaService.getPersonaOverview.mockRejectedValue(new Error("-32601 method not found"));
    renderSection();
    await waitFor(() => {
      expect(document.body.textContent).toContain("当前连接不支持 Drora 资料管理。");
    });
    expect(document.body.textContent).toContain("-32601 method not found");
    // 管理错误码信封同样按不可用降级展示。
    mocks.personaService.getPersonaOverview.mockResolvedValue({
      ok: false,
      code: "storage_unavailable",
    });
    fireEvent.click(screen.getByText("重试"));
    await waitFor(() => {
      expect(document.body.textContent).toContain("storage_unavailable");
    });
  });
});
