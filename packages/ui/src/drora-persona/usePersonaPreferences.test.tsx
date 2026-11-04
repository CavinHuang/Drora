// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "@drora/shared";
import zhCNMessages from "@/i18n/locales/zh-CN.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";

/**
 * Persona P1a「交流默认与导出」交互守护（specs/drora-persona-system.md §9/§10 第十六批、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §1.2/§2/§4.2/§7；
 * PersonaSettingsSection 内挂表达区 + usePersonaPreferences）：
 * - 进区只读：listPreferences + getPersonaOverview，不写任何键、不为导出初始化；
 * - 即时保存：下拉键变更即提交、称呼失焦提交；CAS 携带 expectedRevision（槽缺席=0）+
 *   mutationId，成功后重读；分歧未解决时自动提交暂停；
 * - CAS 冲突：保留草稿并给出「已保存 vs 草稿」比较；分歧中的后续编辑保持面板可见；
 * - 忘记：确认文案必须写明「逻辑撤销」范围（清除应用内该键的值与候选，不删除聊天记录、
 *   项目记忆或诊断），禁止「彻底忘记/所有地方删除」类表述；
 * - outcome_unknown：结果未知文案 + 重试复用同一 mutationId（PM53），成功后换新 ID；
 * - U/L 使用策略：当前值经 getPersonaLearningOverview 读侧展示（读取失败按「未知」降级）；
 *   U/L 以开关呈现并各自显式提交；关闭 U 走级联确认（同事务关 L——合同 §4.2）；冲突后
 *   重新预读 policyRevision（概览读路径）并由用户显式重试；P1b L 开关/解除抑制/来源状态守护见
 *   usePersonaLearning.test.tsx；
 * - 导出：成功经 IPlatformService.saveFile 保存 2 空格缩进 JSON；取消不显示已保存；
 * - i18n：zh-CN 与 en-US 的 settings.drora.* 键集一致且关键文案符合诚实边界。
 */

// radix Select 内容挂载需要（jsdom 缺失）。
window.HTMLElement.prototype.scrollIntoView = () => undefined;
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => undefined;
window.HTMLElement.prototype.releasePointerCapture = () => undefined;

const mocks = vi.hoisted(() => {
  const state = {
    initialized: true,
    policy: { usePreferences: false, autoLearn: false, policyRevision: 0, policyEpoch: 0 },
    // 服务权威偏好行（含 forgotten 行保持 revision 连续性，与 SQLite 仓储语义一致）。
    rows: {} as Record<
      string,
      {
        value: string | null;
        revision: number;
        keyGeneration: number;
        status: "active" | "forgotten";
        provenanceKind?: "settings" | "extraction";
        epistemicStatus?: "explicit" | "inferred";
        disputed?: boolean;
        autoSuppressed?: boolean;
        pendingCandidate?: {
          proposedValue: string;
          evidenceId: string;
          expectedGeneration: number;
          createdAt: number;
        };
      }
    >,
  };
  const personaService = {
    // core 编辑器方法：PersonaSettingsSection 编排身份区（本文件守护 P1a 面，
    // core 走最小只读桩，保证分区可渲染）。
    getPersonaCore: vi.fn(),
    initializePersona: vi.fn(),
    updatePersonaCore: vi.fn(),
    resetPersonaCore: vi.fn(),
    previewPersona: vi.fn(),
    getPersonaApplication: vi.fn(),
    getPersonaOverview: vi.fn(),
    listPreferences: vi.fn(),
    setPersonalPolicy: vi.fn(),
    savePreference: vi.fn(),
    forgetPreference: vi.fn(),
    allowLearningForKey: vi.fn(),
    getPersonaLearningOverview: vi.fn(),
    preparePersonaExport: vi.fn(),
  };
  // 桌面 IPlatformService.saveFile：导出测试用（PersonaPreferencesSection 经
  // useOptionalPlatform 读取；PlatformProvider 注入 mock 平台）。
  const saveFile = vi.fn();
  return { state, personaService, saveFile };
});

function defaultResponses(): void {
  mocks.state.initialized = true;
  mocks.state.policy = {
    usePreferences: false,
    autoLearn: false,
    policyRevision: 0,
    policyEpoch: 0,
  };
  mocks.state.rows = {
    replyLanguage: { value: "follow_user", revision: 1, keyGeneration: 1, status: "active" },
    preferredAddress: { value: "阿明", revision: 1, keyGeneration: 1, status: "active" },
  };
  // core 只读桩：本文件不驱动身份写入路径，只让分区完成进区读取。
  mocks.personaService.getPersonaCore.mockResolvedValue({
    ok: true,
    value: {
      state: "current",
      coreRevision: 1,
      core: {
        displayName: "Drora",
        selfDescription: "",
        warmth: "balanced",
        directness: "direct",
        humor: "light",
      },
      template: {
        templateVersion: 1,
        compilerVersion: 1,
        identityStatement: "identity-statement",
        principles: ["principle-1"],
        capabilityHonesty: "honesty",
        relationshipBoundary: "boundary",
      },
    },
  });
  mocks.personaService.previewPersona.mockResolvedValue({
    ok: true,
    value: { text: "PREVIEW-TEXT", templateVersion: 1, compilerVersion: 1 },
  });
  mocks.personaService.initializePersona.mockReset();
  mocks.personaService.updatePersonaCore.mockReset();
  mocks.personaService.resetPersonaCore.mockReset();
  mocks.personaService.getPersonaOverview.mockImplementation(async () => ({
    ok: true,
    value: mocks.state.initialized
      ? {
          state: "initialized",
          personaId: "persona-1",
          schemaVersion: 1,
          coreRevision: 1,
          templateVersion: 1,
          compilerVersion: 1,
        }
      : { state: "uninitialized" },
  }));
  mocks.personaService.listPreferences.mockImplementation(async () => ({
    ok: true,
    value: {
      // 未初始化时服务返回空答案（与 PersonaAppService 一致），不是错误；
      // 已初始化时返回全部槽（含 forgotten 屏障槽）——与 SQLite 仓储 listPreferences 一致。
      preferences: Object.entries(mocks.state.rows)
        .filter(() => mocks.state.initialized)
        .map(([key, row]) => ({
          key,
          value: row.value ?? "",
          revision: row.revision,
          keyGeneration: row.keyGeneration,
          provenanceKind: row.provenanceKind ?? "settings",
          epistemicStatus: row.epistemicStatus ?? "explicit",
          pinned: row.status === "active",
          disputed: row.disputed ?? false,
          autoSuppressed: row.autoSuppressed ?? false,
          ...(row.pendingCandidate ? { pendingCandidate: row.pendingCandidate } : {}),
          updatedAt: 0,
          status: row.status,
        })),
    },
  }));
  // mock 与 PersonaAppService/仓储的 CAS 语义对齐：expectedRevision 不匹配 → revision_conflict；
  // 同值重存 → unchanged；否则落库并推进 revision/generation。
  mocks.personaService.savePreference.mockImplementation(
    async (input: { key: string; value: string; expectedRevision: number }) => {
      const row = mocks.state.rows[input.key];
      if ((row?.revision ?? 0) !== input.expectedRevision) {
        return { ok: false, code: "revision_conflict" };
      }
      if (row?.status === "active" && row.value === input.value) {
        return { ok: true, value: { status: "unchanged" } };
      }
      const next = {
        value: input.value,
        revision: (row?.revision ?? 0) + 1,
        keyGeneration: (row?.keyGeneration ?? 0) + 1,
        status: "active" as const,
      };
      mocks.state.rows[input.key] = next;
      return {
        ok: true,
        value: { status: "saved", revision: next.revision, keyGeneration: next.keyGeneration },
      };
    },
  );
  mocks.personaService.forgetPreference.mockImplementation(
    async (input: { key: string; expectedRevision: number }) => {
      const row = mocks.state.rows[input.key];
      if ((row?.revision ?? 0) !== input.expectedRevision) {
        return { ok: false, code: "revision_conflict" };
      }
      const next = {
        value: null,
        revision: (row?.revision ?? 0) + 1,
        keyGeneration: (row?.keyGeneration ?? 0) + 1,
        status: "forgotten" as const,
        autoSuppressed: true,
      };
      mocks.state.rows[input.key] = next;
      return {
        ok: true,
        value: { status: "forgotten", revision: next.revision, keyGeneration: next.keyGeneration },
      };
    },
  );
  mocks.personaService.allowLearningForKey.mockImplementation(
    async (input: { key: string; expectedGeneration: number }) => {
      const row = mocks.state.rows[input.key];
      if ((row?.keyGeneration ?? 0) !== input.expectedGeneration) {
        return { ok: false, code: "revision_conflict" };
      }
      if (!row || !row.autoSuppressed) {
        return { ok: true, value: { status: "unchanged" } };
      }
      const next = {
        ...row,
        revision: row.revision + 1,
        keyGeneration: row.keyGeneration + 1,
        autoSuppressed: false,
      };
      mocks.state.rows[input.key] = next;
      return {
        ok: true,
        value: { status: "saved", revision: next.revision, keyGeneration: next.keyGeneration },
      };
    },
  );
  // P1b 读侧概览（getPersonaLearningOverview）：policy 当前值与状态机同源；预算/来源/计数零值。
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
        budget: { day: "2026-10-31", attemptsUsed: 0, inputTokensUsed: 0, outputTokensUsed: 0 },
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
  mocks.personaService.setPersonalPolicy.mockImplementation(
    async (input: {
      expectedPolicyRevision: number;
      usePreferences: boolean;
      autoLearn?: boolean;
    }) => {
      if (mocks.state.policy.policyRevision !== input.expectedPolicyRevision) {
        return { ok: false, code: "revision_conflict" };
      }
      // 关 U 的级联在存储侧执行：usePreferences=false 同事务强制 autoLearn=false。
      const nextAutoLearn = input.usePreferences
        ? (input.autoLearn ?? mocks.state.policy.autoLearn)
        : false;
      if (
        mocks.state.policy.usePreferences === input.usePreferences &&
        mocks.state.policy.autoLearn === nextAutoLearn
      ) {
        return { ok: true, value: { status: "unchanged" } };
      }
      mocks.state.policy = {
        usePreferences: input.usePreferences,
        autoLearn: nextAutoLearn,
        policyRevision: mocks.state.policy.policyRevision + 1,
        policyEpoch: mocks.state.policy.policyEpoch + 1,
      };
      return {
        ok: true,
        value: {
          status: "saved",
          policyRevision: mocks.state.policy.policyRevision,
          policyEpoch: mocks.state.policy.policyEpoch,
        },
      };
    },
  );
  // 导出交互守护在 personaPreferencesExportI18n.test.tsx；这里只备一个不会被动用的桩。
  mocks.personaService.preparePersonaExport.mockResolvedValue({ ok: false, code: "uninitialized" });
  mocks.saveFile.mockReset();
}

vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({
    intl: {
      // 用真实 zh-CN 文案 + 与 IntlProvider 相同的插值规则，
      // 使忘记确认文案等硬边界断言落在真实产品文案上。
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

const platformMock = { saveFile: mocks.saveFile } as unknown as IPlatformService;

function renderPrefsSection(): void {
  render(
    <PlatformProvider platform={platformMock}>
      <PersonaSettingsSection
        personaService={mocks.personaService}
        personaEnabled={false}
        onPersonaEnabledChange={vi.fn(async () => {})}
        applicationWorkspace={{ workspacePath: "/repo" }}
      />
    </PlatformProvider>,
  );
}

function inputById(testId: string): HTMLInputElement {
  return screen.getByTestId(testId) as HTMLInputElement;
}

function buttonById(testId: string): HTMLButtonElement {
  return screen.getByTestId(testId) as HTMLButtonElement;
}

function openPrefsSelect(testId: string): void {
  fireEvent.pointerDown(screen.getByTestId(testId), {
    button: 0,
    ctrlKey: false,
    pointerId: 1,
    pointerType: "mouse",
  });
}

async function openReadyPrefsSection(): Promise<void> {
  renderPrefsSection();
  await waitFor(() => {
    expect(inputById("settings-persona-pref-preferredAddress").value).toBe("阿明");
  });
}

/** 展开「高级」折叠区（导出默认收起，spec §10 第十六批）。 */
async function openAdvancedArea(): Promise<void> {
  fireEvent.click(screen.getByTestId("settings-persona-advanced-trigger"));
  await waitFor(() => {
    expect(buttonById("settings-persona-export")).toBeTruthy();
  });
}

beforeEach(() => {
  defaultResponses();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PersonaPreferencesSection（P1a 交流默认与导出）", () => {
  it("进区只读：渲染服务当前值与 U 未知态，不写任何键", async () => {
    renderPrefsSection();
    await waitFor(() => {
      expect(inputById("settings-persona-pref-preferredAddress").value).toBe("阿明");
    });
    expect(screen.getByTestId("settings-persona-pref-preferredAddress-value").textContent).toBe(
      "当前值：阿明",
    );
    expect(screen.getByTestId("settings-persona-pref-replyLanguage-value").textContent).toBe(
      "当前值：跟随用户消息",
    );
    // 槽缺席的键显示未设置、不提供忘记入口；U/L 当前值经读侧概览如实显示服务值。
    expect(screen.getByTestId("settings-persona-pref-explanationDetail-value").textContent).toBe(
      "当前值：未设置",
    );
    expect(screen.queryByTestId("settings-persona-pref-explanationDetail-forget")).toBeNull();
    expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain("当前：关闭");
    expect(screen.getByTestId("settings-persona-learning-state").textContent).toContain(
      "当前：关闭",
    );
    expect(mocks.personaService.savePreference).not.toHaveBeenCalled();
    expect(mocks.personaService.forgetPreference).not.toHaveBeenCalled();
    expect(mocks.personaService.setPersonalPolicy).not.toHaveBeenCalled();
    // 即时保存（spec §10 第十六批）：无逐键保存按钮；U/L 开关如实显示概览读到的关闭值。
    expect(screen.queryByTestId("settings-persona-pref-preferredAddress-save")).toBeNull();
    expect(screen.getByTestId("settings-persona-policy-switch").getAttribute("data-state")).toBe(
      "unchecked",
    );
    expect(screen.getByTestId("settings-persona-learning-switch").getAttribute("data-state")).toBe(
      "unchecked",
    );
  });

  it("preferredAddress 保存：CAS 携带 expectedRevision+mutationId，成功后重读且保存回到禁用", async () => {
    await openReadyPrefsSection();
    const listCallsBefore = mocks.personaService.listPreferences.mock.calls.length;
    fireEvent.change(inputById("settings-persona-pref-preferredAddress"), {
      target: { value: "阿明二" },
    });
    // 停顿未到去抖阈值时不写（提交时机由失焦驱动）。
    expect(mocks.personaService.savePreference).not.toHaveBeenCalled();
    fireEvent.blur(inputById("settings-persona-pref-preferredAddress"));
    await waitFor(() => {
      expect(mocks.personaService.savePreference).toHaveBeenCalledTimes(1);
    });
    const saveInput = mocks.personaService.savePreference.mock.calls[0]?.[0] as {
      key: string;
      value: string;
      expectedRevision: number;
      mutationId: string;
    };
    expect(saveInput.key).toBe("preferredAddress");
    expect(saveInput.value).toBe("阿明二");
    expect(saveInput.expectedRevision).toBe(1);
    expect(typeof saveInput.mutationId).toBe("string");
    expect(saveInput.mutationId.length).toBeGreaterThan(0);
    // 保存成功后重读（spec §10）：当前值徽章与控件回到服务值。
    await waitFor(() => {
      expect(mocks.personaService.listPreferences.mock.calls.length).toBeGreaterThan(
        listCallsBefore,
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-pref-preferredAddress-value").textContent).toBe(
        "当前值：阿明二",
      );
    });
    expect(
      screen.getByTestId("settings-persona-pref-preferredAddress-notice").textContent,
    ).toContain("已保存");
  });

  it("Select 键保存：选项受控词汇写值，CAS 使用该键自身 revision", async () => {
    await openReadyPrefsSection();
    openPrefsSelect("settings-persona-pref-replyLanguage");
    fireEvent.click(screen.getByText("中文"));
    // 离散选择即存（spec §10 第十六批）：选项变更立即提交，无保存按钮。
    await waitFor(() => {
      expect(mocks.personaService.savePreference).toHaveBeenCalledTimes(1);
    });
    const saveInput = mocks.personaService.savePreference.mock.calls[0]?.[0] as {
      key: string;
      value: string;
      expectedRevision: number;
    };
    expect(saveInput.key).toBe("replyLanguage");
    expect(saveInput.value).toBe("zh-CN");
    expect(saveInput.expectedRevision).toBe(1);
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-pref-replyLanguage-value").textContent).toBe(
        "当前值：中文",
      );
    });
  });

  it("CAS 冲突：保留草稿并给出「已保存 vs 草稿」比较；保留后 revision 再前进才重现；放弃草稿加载最新", async () => {
    await openReadyPrefsSection();
    fireEvent.change(inputById("settings-persona-pref-preferredAddress"), {
      target: { value: "大王" },
    });
    // 另一窗口已把该键推进到 revision 4（老王）；CAS mock 按真实语义拒绝旧基线。
    mocks.state.rows.preferredAddress = {
      value: "老王",
      revision: 4,
      keyGeneration: 4,
      status: "active",
    };
    fireEvent.blur(inputById("settings-persona-pref-preferredAddress"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-pref-preferredAddress-divergence")).toBeTruthy();
    });
    // 草稿保留：输入未被替换成服务值。
    expect(inputById("settings-persona-pref-preferredAddress").value).toBe("大王");
    const divergenceText =
      screen.getByTestId("settings-persona-pref-preferredAddress-divergence").textContent ?? "";
    expect(divergenceText).toContain("老王");
    expect(divergenceText).toContain("大王");
    expect(divergenceText).toContain("已保存");
    expect(divergenceText).toContain("草稿");

    // 保留草稿：分歧面板收起，草稿原样。
    fireEvent.click(screen.getByTestId("settings-persona-pref-preferredAddress-keep-draft"));
    expect(screen.queryByTestId("settings-persona-pref-preferredAddress-divergence")).toBeNull();
    expect(inputById("settings-persona-pref-preferredAddress").value).toBe("大王");

    // 分歧未解决：再次失焦不产生第二次 CAS 写（自动提交暂停，面板是唯一解决面）。
    fireEvent.blur(inputById("settings-persona-pref-preferredAddress"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.personaService.savePreference).toHaveBeenCalledTimes(1);

    // 分歧中的后续编辑：面板重现（spec §10 第十六批），解决面保持可见。
    fireEvent.change(inputById("settings-persona-pref-preferredAddress"), {
      target: { value: "大王二" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-pref-preferredAddress-divergence")).toBeTruthy();
    });

    // 服务再前进（revision 6）后放弃草稿并加载最新。
    mocks.state.rows.preferredAddress = {
      value: "老王",
      revision: 6,
      keyGeneration: 5,
      status: "active",
    };
    fireEvent.click(screen.getByTestId("settings-persona-pref-preferredAddress-discard-draft"));
    await waitFor(() => {
      expect(inputById("settings-persona-pref-preferredAddress").value).toBe("老王");
    });
    expect(screen.queryByTestId("settings-persona-pref-preferredAddress-divergence")).toBeNull();
  });

  it("忘记：确认文案写明逻辑撤销范围；确认后携带 expectedRevision+mutationId 并重读", async () => {
    await openReadyPrefsSection();
    fireEvent.click(buttonById("settings-persona-pref-preferredAddress-forget"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-forget-confirm")).toBeTruthy();
    });
    const dialogText = screen.getByTestId("settings-persona-forget-confirm").textContent ?? "";
    expect(dialogText).toContain("逻辑撤销");
    expect(dialogText).toContain("不会删除聊天记录、项目记忆或诊断");
    expect(dialogText).not.toContain("彻底忘记");
    expect(dialogText).not.toContain("所有地方");

    fireEvent.click(screen.getByTestId("settings-persona-forget-confirm-action"));
    await waitFor(() => {
      expect(mocks.personaService.forgetPreference).toHaveBeenCalledTimes(1);
    });
    const forgetInput = mocks.personaService.forgetPreference.mock.calls[0]?.[0] as {
      key: string;
      expectedRevision: number;
      mutationId: string;
    };
    expect(forgetInput.key).toBe("preferredAddress");
    expect(forgetInput.expectedRevision).toBe(1);
    expect(typeof forgetInput.mutationId).toBe("string");
    // 成功后重读：forgotten 屏障槽如实显示「已忘记（可重新设置）」，抑制徽标同步出现。
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-pref-preferredAddress-value").textContent).toBe(
        "当前值：已忘记（可重新设置）",
      );
    });
    expect(
      screen.getByTestId("settings-persona-pref-preferredAddress-notice").textContent,
    ).toContain("已忘记");
  });

  it("outcome_unknown：结果未知文案 + 重试复用同一 mutationId，成功后换新 ID", async () => {
    await openReadyPrefsSection();
    fireEvent.change(inputById("settings-persona-pref-preferredAddress"), {
      target: { value: "阿明二" },
    });
    const mutationIds: string[] = [];
    let attempts = 0;
    mocks.personaService.savePreference.mockImplementation(
      async (input: {
        key: string;
        value: string;
        expectedRevision: number;
        mutationId: string;
      }) => {
        if (input.key !== "preferredAddress") {
          return { ok: false, code: "validation_failed" };
        }
        mutationIds.push(input.mutationId);
        attempts += 1;
        if (attempts === 1) return { ok: false, code: "outcome_unknown" };
        // 同 ID 重试：真实服务按 receipt 幂等回放；mock 落库对齐 CAS 语义。
        const row = mocks.state.rows.preferredAddress;
        if ((row?.revision ?? 0) !== input.expectedRevision) {
          return { ok: false, code: "revision_conflict" };
        }
        const next = {
          value: input.value,
          revision: (row?.revision ?? 0) + 1,
          keyGeneration: (row?.keyGeneration ?? 0) + 1,
          status: "active" as const,
        };
        mocks.state.rows.preferredAddress = next;
        return {
          ok: true,
          value: { status: "saved", revision: next.revision, keyGeneration: next.keyGeneration },
        };
      },
    );
    fireEvent.blur(inputById("settings-persona-pref-preferredAddress"));
    await waitFor(() => {
      expect(
        screen.getByTestId("settings-persona-pref-preferredAddress-notice").textContent ?? "",
      ).toContain("结果未知");
    });
    expect(
      screen.getByTestId("settings-persona-pref-preferredAddress-notice").textContent ?? "",
    ).toContain("幂等回放");

    // 重试（再次失焦结算）：必须复用同一 mutationId（合同 §2/PM53）。
    fireEvent.blur(inputById("settings-persona-pref-preferredAddress"));
    await waitFor(() => {
      expect(mutationIds).toHaveLength(2);
    });
    expect(mutationIds[1]).toBe(mutationIds[0]);
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-pref-preferredAddress-value").textContent).toBe(
        "当前值：阿明二",
      );
    });

    // 确定性成功后在途 ID 已清除：下一次用户提交换新 ID。
    fireEvent.change(inputById("settings-persona-pref-preferredAddress"), {
      target: { value: "阿明三" },
    });
    fireEvent.blur(inputById("settings-persona-pref-preferredAddress"));
    await waitFor(() => {
      expect(mutationIds).toHaveLength(3);
    });
    expect(mutationIds[2]).not.toBe(mutationIds[0]);
  });

  it("U 偏好注入开关：当前值来自读侧概览；开启显式提交；关闭走级联确认；冲突后重新预读并重试", async () => {
    await openReadyPrefsSection();
    expect(screen.getByTestId("settings-persona-policy-switch").getAttribute("data-state")).toBe(
      "unchecked",
    );
    // 开启：以概览读取的 policyRevision（0）做 CAS（calls[0]）；不发明 autoLearn 键。
    fireEvent.click(screen.getByTestId("settings-persona-policy-switch"));
    await waitFor(() => {
      expect(mocks.personaService.setPersonalPolicy).toHaveBeenCalledTimes(1);
    });
    expect(mocks.personaService.setPersonalPolicy.mock.calls[0]?.[0]).toEqual({
      expectedPolicyRevision: 0,
      usePreferences: true,
      mutationId: expect.any(String),
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain(
        "当前：开启",
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-policy-switch").getAttribute("data-state")).toBe(
        "checked",
      );
    });

    // 关闭（calls[1]）：另一窗口已把策略推进到 revision 2 → 冲突；重新预读后请用户显式重试。
    mocks.state.policy = {
      usePreferences: true,
      autoLearn: true,
      policyRevision: 2,
      policyEpoch: 2,
    };
    mocks.personaService.setPersonalPolicy.mockImplementationOnce(async () => ({
      ok: false,
      code: "revision_conflict",
    }));
    const overviewCallsBefore = mocks.personaService.getPersonaLearningOverview.mock.calls.length;
    fireEvent.click(screen.getByTestId("settings-persona-policy-switch"));
    // 关闭 U 需经级联确认对话框（同事务关 L 的提示）。
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-cascade-confirm")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("settings-persona-cascade-confirm-action"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-policy-notice").textContent ?? "").toContain(
        "其他窗口",
      );
    });
    await waitFor(() => {
      expect(mocks.personaService.getPersonaLearningOverview.mock.calls.length).toBeGreaterThan(
        overviewCallsBefore,
      );
    });
    expect(mocks.personaService.setPersonalPolicy.mock.calls[1]?.[0]).toMatchObject({
      expectedPolicyRevision: 1,
      usePreferences: false,
    });
    // 冲突后开关回到概览权威值（仍开启）。
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-policy-switch").getAttribute("data-state")).toBe(
        "checked",
      );
    });

    // 用户显式重试（calls[2]）：以重新预读的 revision 2 提交关闭（级联确认再次出现）。
    fireEvent.click(screen.getByTestId("settings-persona-policy-switch"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-cascade-confirm")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("settings-persona-cascade-confirm-action"));
    await waitFor(() => {
      expect(mocks.personaService.setPersonalPolicy).toHaveBeenCalledTimes(3);
    });
    expect(mocks.personaService.setPersonalPolicy.mock.calls[2]?.[0]).toMatchObject({
      expectedPolicyRevision: 2,
      usePreferences: false,
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain(
        "当前：关闭",
      );
    });
  });

  it("未初始化：导出显示尚无资料且不调 saveFile；U/L 开关禁用、忘记无入口、失焦不提交", async () => {
    mocks.state.initialized = false;
    renderPrefsSection();
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-section")).toBeTruthy();
    });
    await openAdvancedArea();
    expect(buttonById("settings-persona-policy-switch").disabled).toBe(true);
    expect(buttonById("settings-persona-learning-switch").disabled).toBe(true);
    // 未初始化时 listPreferences 返回空答案：槽缺席 → 无忘记入口。
    expect(screen.queryByTestId("settings-persona-pref-preferredAddress-forget")).toBeNull();
    // 未初始化不自动提交（spec §10 第十六批）：编辑＋失焦也不产生写调用。
    fireEvent.change(inputById("settings-persona-pref-preferredAddress"), {
      target: { value: "临时" },
    });
    fireEvent.blur(inputById("settings-persona-pref-preferredAddress"));
    expect(mocks.personaService.savePreference).not.toHaveBeenCalled();

    fireEvent.click(buttonById("settings-persona-export"));
    await waitFor(() => {
      expect(mocks.personaService.preparePersonaExport).toHaveBeenCalledTimes(1);
    });
    // 无资料不为导出初始化：uninitialized 直接显示尚无资料，不调用 saveFile。
    const notice = screen.getByTestId("settings-persona-export-notice").textContent ?? "";
    expect(notice).toContain("尚无资料");
    expect(mocks.saveFile).not.toHaveBeenCalled();
  });

  it("服务不可用（RPC 失败）：偏好区诚实降级并保留重试", async () => {
    mocks.personaService.listPreferences.mockRejectedValue(new Error("transport closed"));
    renderPrefsSection();
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-prefs-retry")).toBeTruthy();
    });
    expect(document.body.textContent ?? "").toContain("transport closed");
    defaultResponses();
    fireEvent.click(screen.getByTestId("settings-persona-prefs-retry"));
    await waitFor(() => {
      expect(inputById("settings-persona-pref-preferredAddress").value).toBe("阿明");
    });
  });
});
