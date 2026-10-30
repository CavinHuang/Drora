// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zhCNMessages from "@/i18n/locales/zh-CN.js";

/**
 * PersonaSettingsSection 交互守护（specs/drora-persona-system.md §10、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §2/§3）：
 * - 五字段受控编辑：局部草稿、保存 CAS（expectedRevision+mutationId）、保存成功后重读版本；
 * - CAS revision 冲突：保留草稿并提供「已保存 vs 草稿」比较，不静默 last-write-wins；
 * - 未初始化：built_in_preview + 显式初始化，保存被阻止；只打开页面不初始化；
 * - 预览：previewPersona 本地确定性编译，不请求模型；文案明确「预览不是实际输出保证」；
 * - E 开关文案：必须说「用于新建或真正重新加载的会话」，不得出现「当前会话已关闭」；
 *   附隐私说明（个性化内容发送给当前选择的模型并可能随原诊断保留）；
 * - 应用情况：已保存版本与指定会话/轮的 applied/omitted 分开显示；无记录显示未应用；
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
  };
  const personaService = {
    getPersonaOverview: vi.fn(),
    initializePersona: vi.fn(),
    getPersonaCore: vi.fn(),
    updatePersonaCore: vi.fn(),
    resetPersonaCore: vi.fn(),
    previewPersona: vi.fn(),
    getPersonaApplication: vi.fn(),
  };
  return { savedCore, template, state, personaService };
});

function defaultResponses(): void {
  mocks.state.coreRevision = 1;
  mocks.state.initialized = true;
  mocks.state.core = { ...mocks.savedCore };
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
const { createSettingsPageConfig, SETTINGS_SECTIONS } =
  await import("@/settings/settingsPageConfig.js");

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
  it("打开页面只读取：渲染已保存版本与五字段草稿，不初始化、不保存、E 不被打开", async () => {
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
    // 保存/取消在无改动时禁用。
    expect(buttonById("settings-persona-save").disabled).toBe(true);
    expect(buttonById("settings-persona-cancel").disabled).toBe(true);
  });

  it("未初始化时显示 built_in_preview 与显式初始化入口；保存被阻止；初始化后重读", async () => {
    mocks.state.initialized = false;
    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-initialize")).toBeTruthy();
    });
    expect(buttonById("settings-persona-save").disabled).toBe(true);
    expect(buttonById("settings-persona-reset-defaults").disabled).toBe(true);
    expect(screen.getByTestId("settings-persona-section").textContent).toContain("尚未初始化");
    // 只打开页面不初始化：未点击前零写调用。
    expect(mocks.personaService.initializePersona).not.toHaveBeenCalled();

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
    const input = mocks.personaService.initializePersona.mock.calls[0]?.[0] as {
      mutationId: string;
    };
    expect(typeof input.mutationId).toBe("string");
    expect(input.mutationId.length).toBeGreaterThan(0);
    // 初始化成功后重读：已保存版本徽章出现；无改动时保存仍禁用。
    await waitFor(() => {
      expect(screen.queryByTestId("settings-persona-saved-revision")).toBeTruthy();
    });
    expect(buttonById("settings-persona-save").disabled).toBe(true);
    expect(screen.getByTestId("settings-persona-notice").textContent).toContain("已初始化");
  });

  it("五字段草稿保存：CAS 携带 expectedRevision+mutationId，成功后重读版本且文案不冒充已应用", async () => {
    await openInitialisedSection();
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    expect(buttonById("settings-persona-save").disabled).toBe(false);
    expect(buttonById("settings-persona-cancel").disabled).toBe(false);

    mocks.personaService.updatePersonaCore.mockImplementation(
      async (input: { expectedRevision: number; patch: Record<string, unknown> }) => {
        // mock 服务真实落库：重读（getPersonaCore）返回提交后的字段。
        mocks.state.core = { ...input.patch } as Record<string, string>;
        mocks.state.coreRevision = input.expectedRevision + 1;
        return { ok: true, value: { status: "saved", coreRevision: mocks.state.coreRevision } };
      },
    );
    fireEvent.click(screen.getByTestId("settings-persona-save"));
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
    // 保存后草稿基线对齐新版本：保存/取消回到禁用，输入仍是新值。
    expect(buttonById("settings-persona-save").disabled).toBe(true);
    expect(inputById("settings-persona-display-name").value).toBe("朵拉");
  });

  it("CAS revision 冲突：保留草稿并给出「已保存 vs 草稿」比较，不静默覆盖", async () => {
    await openInitialisedSection();
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    mocks.personaService.updatePersonaCore.mockResolvedValue({
      ok: false,
      code: "revision_conflict",
    });
    // 冲突后重读发现服务已前进到 revision 4（另一窗口已保存）。
    mocks.state.coreRevision = 4;
    fireEvent.click(screen.getByTestId("settings-persona-save"));
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

    // 保留草稿：分歧面板收起，草稿原样。
    fireEvent.click(screen.getByTestId("settings-persona-keep-draft"));
    expect(screen.queryByTestId("settings-persona-divergence")).toBeNull();
    expect(inputById("settings-persona-display-name").value).toBe("朵拉");

    // 服务再前进（revision 6）后再次保存冲突：面板重现；这次选择放弃草稿并加载最新。
    mocks.state.coreRevision = 6;
    fireEvent.click(screen.getByTestId("settings-persona-save"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-divergence")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("settings-persona-discard-draft"));
    await waitFor(() => {
      expect(inputById("settings-persona-display-name").value).toBe("Drora");
    });
    // 放弃后草稿基线对齐服务最新版本：保存/取消回到禁用。
    expect(buttonById("settings-persona-save").disabled).toBe(true);
  });

  it("取消草稿：回到基线值，保存/取消回到禁用", async () => {
    await openInitialisedSection();
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    fireEvent.click(screen.getByTestId("settings-persona-cancel"));
    expect(inputById("settings-persona-display-name").value).toBe("Drora");
    expect(buttonById("settings-persona-save").disabled).toBe(true);
    expect(buttonById("settings-persona-cancel").disabled).toBe(true);
  });

  it("outcome_unknown：结果未知文案 + 重试复用同一 mutationId（同 ID 幂等回放），成功后换新 ID", async () => {
    await openInitialisedSection();
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉" } });
    const mutationIds: string[] = [];
    let attempts = 0;
    mocks.personaService.updatePersonaCore.mockImplementation(
      async (input: { expectedRevision: number; patch: Record<string, unknown>; mutationId: string }) => {
        mutationIds.push(input.mutationId);
        attempts += 1;
        if (attempts === 1) return { ok: false, code: "outcome_unknown" };
        // 同 ID 重试：真实服务按 receipt 幂等回放；mock 落库对齐 CAS 语义。
        mocks.state.core = { ...input.patch } as Record<string, string>;
        mocks.state.coreRevision = input.expectedRevision + 1;
        return { ok: true, value: { status: "saved", coreRevision: mocks.state.coreRevision } };
      },
    );
    fireEvent.click(screen.getByTestId("settings-persona-save"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-notice").textContent ?? "").toContain("结果未知");
    });
    // 失败提示不得声称确定性失败（tone=info，文案说明未确认与幂等回放）。
    expect(screen.getByTestId("settings-persona-notice").textContent ?? "").toContain(
      "幂等回放",
    );

    // 重试：必须复用同一 mutationId（合同 §2/PM53：不换新 ID 重写）。
    fireEvent.click(screen.getByTestId("settings-persona-save"));
    await waitFor(() => {
      expect(mutationIds).toHaveLength(2);
    });
    expect(mutationIds[1]).toBe(mutationIds[0]);
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-saved-revision").textContent).toContain(
        "revision 2",
      );
    });

    // 成功（确定性结果）后在途 ID 已清除：下一次用户提交换新 ID。
    fireEvent.change(inputById("settings-persona-display-name"), { target: { value: "朵拉二" } });
    fireEvent.click(screen.getByTestId("settings-persona-save"));
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
      async (input: { expectedRevision: number; patch: Record<string, unknown>; mutationId: string }) => {
        mutationIds.push(input.mutationId);
        attempts += 1;
        if (attempts === 1) throw new Error("transport closed");
        mocks.state.core = { ...input.patch } as Record<string, string>;
        mocks.state.coreRevision = input.expectedRevision + 1;
        return { ok: true, value: { status: "saved", coreRevision: mocks.state.coreRevision } };
      },
    );
    fireEvent.click(screen.getByTestId("settings-persona-save"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-notice").textContent ?? "").toContain(
        "transport closed",
      );
    });
    fireEvent.click(screen.getByTestId("settings-persona-save"));
    await waitFor(() => {
      expect(mutationIds).toHaveLength(2);
    });
    // RPC 层失败同样保留在途 ID：重试同 ID 回放，不换新 ID。
    expect(mutationIds[1]).toBe(mutationIds[0]);
  });

  it("恢复产品默认：确认后以草稿基线 revision 调用 resetPersonaCore 并重读", async () => {
    await openInitialisedSection();
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

  it("确定性预览：草稿变化后调用 previewPersona，且明确不是实际输出保证", async () => {
    await openInitialisedSection();
    // 免责声明在行描述中；预览块初始为空态文案。
    expect(screen.getByTestId("settings-persona-section").textContent ?? "").toContain(
      "预览不是实际输出保证",
    );
    expect(screen.getByTestId("settings-persona-preview").textContent ?? "").toContain(
      "正在生成预览",
    );
    await waitFor(
      () => {
        expect(mocks.personaService.previewPersona).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-preview").textContent ?? "").toContain(
        "PREVIEW-TEXT",
      );
    });
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

  it("应用情况：已保存版本与应用事实分开显示；查询三态如实渲染，无记录显示未应用", async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-application-query")).toBeTruthy();
    });
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

    // 服务前进（另一窗口保存）：focus 重读后出现分歧提示，草稿仍不被覆盖。
    mocks.state.coreRevision = 5;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-divergence")).toBeTruthy();
    });
    expect(inputById("settings-persona-display-name").value).toBe("朵拉");
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

describe("Drora 设置入口能力门控（settingsPageConfig）", () => {
  it("静态只读导出不含 drora；createSettingsPageConfig 仅在能力确认后加入，其余分区不受影响", () => {
    expect(SETTINGS_SECTIONS.some((section) => section.id === "drora")).toBe(false);
    expect(
      createSettingsPageConfig({ isDesktop: true }).settingsSections.some(
        (section) => section.id === "drora",
      ),
    ).toBe(false);
    const enabledConfig = createSettingsPageConfig({ isDesktop: true, showDroraPersona: true });
    expect(enabledConfig.settingsSections.some((section) => section.id === "drora")).toBe(true);
    expect(enabledConfig.settingsSections.some((section) => section.id === "memory")).toBe(true);
    // 分组导航同步出现，落到 agentCapabilities 组。
    expect(
      enabledConfig.settingsSectionGroups
        .find((group) => group.id === "agentCapabilities")
        ?.sections.some((section) => section.id === "drora"),
    ).toBe(true);
  });
});
