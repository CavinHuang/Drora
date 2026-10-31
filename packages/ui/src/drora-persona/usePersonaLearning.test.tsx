// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enUSMessages from "@/i18n/locales/en-US.js";
import zhCNMessages from "@/i18n/locales/zh-CN.js";

/**
 * Persona P1b「有限学习管理」交互守护（specs/drora-persona-system.md §5/§8/§10、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §3/§4.2/§6/§8；
 * PersonaPreferencesSection + usePersonaPreferences 的学习面）：
 * - L 开关：当前值来自 getPersonaLearningOverview；开启＝usePreferences:true + autoLearn:true
 *   一次提交（学习前置＝U&&L）；关闭保持当前 U 值不变；级联文案不把「关 U」说成只关 L；
 * - 关闭 U 的级联确认：文案写明同事务关 L、撤租约、清未提交候选/负载，重开 U 不恢复 L；
 * - 来源状态列表（类别/状态/争议/抑制是三件事，分行如实展示）：
 *   extraction/inferred 槽显示「自动提取/推断」，disputed 显示暂停注入徽标与保存/忘记
 *   解决提示（不提供「解除争议」按钮），autoSuppressed 显示抑制徽标与「解除抑制」入口
 *   （allowLearningForKey，CAS expectedGeneration）；pendingCandidate 显示待确认建议；
 * - 概览读取失败：U/L 当前值诚实降级为「未知」，关闭 L 按钮禁用（不猜测 U 值发请求）；
 * - 预算/计数行：服务冻结上界（shared 常量）如实展示。
 */

const mocks = vi.hoisted(() => {
  interface LearningRow {
    value: string;
    revision: number;
    keyGeneration: number;
    status: "active" | "forgotten";
    provenanceKind: "settings" | "extraction";
    epistemicStatus: "explicit" | "inferred";
    disputed: boolean;
    autoSuppressed: boolean;
    pendingCandidate?: {
      proposedValue: string;
      evidenceId: string;
      expectedGeneration: number;
      createdAt: number;
    };
  }
  const state = {
    policy: { usePreferences: true, autoLearn: false, policyRevision: 2, policyEpoch: 2 },
    rows: {
      replyLanguage: {
        value: "zh-CN",
        revision: 2,
        keyGeneration: 2,
        status: "active" as const,
        provenanceKind: "extraction" as const,
        epistemicStatus: "inferred" as const,
        disputed: true,
        autoSuppressed: false,
        pendingCandidate: {
          proposedValue: "en-US",
          evidenceId: "ev-9",
          expectedGeneration: 2,
          createdAt: 1_700_000_000_000,
        },
      },
      preferredAddress: {
        value: "",
        revision: 3,
        keyGeneration: 3,
        status: "forgotten" as const,
        provenanceKind: "settings" as const,
        epistemicStatus: "explicit" as const,
        disputed: false,
        autoSuppressed: true,
      },
    } as Record<string, LearningRow>,
    overviewOk: true,
  };
  const personaService = {
    getPersonaOverview: vi.fn(),
    listPreferences: vi.fn(),
    setPersonalPolicy: vi.fn(),
    savePreference: vi.fn(),
    forgetPreference: vi.fn(),
    allowLearningForKey: vi.fn(),
    getPersonaLearningOverview: vi.fn(),
    preparePersonaExport: vi.fn(),
  };
  return { state, personaService };
});

function defaultResponses(): void {
  mocks.state.policy = {
    usePreferences: true,
    autoLearn: false,
    policyRevision: 2,
    policyEpoch: 2,
  };
  mocks.state.overviewOk = true;
  mocks.personaService.getPersonaOverview.mockResolvedValue({
    ok: true,
    value: {
      state: "initialized",
      personaId: "persona-1",
      schemaVersion: 1,
      coreRevision: 1,
      templateVersion: 1,
      compilerVersion: 1,
    },
  });
  mocks.personaService.listPreferences.mockImplementation(async () => ({
    ok: true,
    value: {
      preferences: Object.entries(mocks.state.rows).map(([key, row]) => ({
        key,
        value: row.value,
        revision: row.revision,
        keyGeneration: row.keyGeneration,
        provenanceKind: row.provenanceKind,
        epistemicStatus: row.epistemicStatus,
        pinned: row.status === "active" && row.provenanceKind === "settings",
        disputed: row.disputed,
        autoSuppressed: row.autoSuppressed,
        ...(row.pendingCandidate ? { pendingCandidate: row.pendingCandidate } : {}),
        updatedAt: 0,
        status: row.status,
      })),
    },
  }));
  mocks.personaService.getPersonaLearningOverview.mockImplementation(async () => {
    if (!mocks.state.overviewOk) throw new Error("transport closed");
    return {
      ok: true,
      value: {
        state: "initialized",
        policy: {
          usePreferences: mocks.state.policy.usePreferences,
          autoLearn: mocks.state.policy.autoLearn,
          policyRevision: mocks.state.policy.policyRevision,
          policyEpoch: mocks.state.policy.policyEpoch,
          learningGeneration: 1,
        },
        budget: { day: "2026-10-31", attemptsUsed: 2, inputTokensUsed: 512, outputTokensUsed: 64 },
        sources: [
          { key: "replyLanguage", evidenceId: "ev-1", workspaceKey: "/ws", sessionId: "s1" },
          { key: "replyLanguage", evidenceId: "ev-2", workspaceKey: "/ws", sessionId: "s2" },
        ],
        counters: {
          received: 5,
          droppedQueueFull: 1,
          acceptAccepted: 4,
          acceptAlreadyAccepted: 0,
          acceptSkipped: { policy_disabled: 2 },
          workApplied: 2,
          workNoChange: 1,
          workRejected: 1,
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
  mocks.personaService.allowLearningForKey.mockImplementation(
    async (input: { key: string; expectedGeneration: number }) => {
      const row = mocks.state.rows[input.key];
      if (!row || (row.keyGeneration ?? 0) !== input.expectedGeneration) {
        return { ok: false, code: "revision_conflict" };
      }
      if (!row.autoSuppressed) return { ok: true, value: { status: "unchanged" } };
      row.autoSuppressed = false;
      row.revision += 1;
      row.keyGeneration += 1;
      return {
        ok: true,
        value: { status: "saved", revision: row.revision, keyGeneration: row.keyGeneration },
      };
    },
  );
}

vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({
    intl: {
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

const { PersonaPreferencesSection } = await import("./PersonaPreferencesSection.js");

function buttonById(testId: string): HTMLButtonElement {
  return screen.getByTestId(testId) as HTMLButtonElement;
}

async function openReadySection(): Promise<void> {
  render(<PersonaPreferencesSection personaService={mocks.personaService} />);
  await waitFor(() => {
    expect(buttonById("settings-persona-learning-enable")).toBeTruthy();
  });
}

beforeEach(() => {
  defaultResponses();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PersonaPreferencesSection P1b 学习管理（L 开关/来源状态/解除抑制）", () => {
  it("来源状态列表：类别/认识状态/合并来源数/争议/抑制分行如实展示", async () => {
    await openReadySection();
    // replyLanguage：自动提取＋推断，disputed，2 条合并来源，待确认建议。
    const reply = screen.getByTestId("settings-persona-pref-replyLanguage-source-status");
    expect(reply.textContent).toContain("来源：自动提取");
    expect(reply.textContent).toContain("推断");
    expect(reply.textContent).toContain("合并来源：2 条");
    expect(
      screen.getByTestId("settings-persona-pref-replyLanguage-disputed").textContent,
    ).toContain("已暂停注入");
    expect(
      screen.getByTestId("settings-persona-pref-replyLanguage-disputed-hint").textContent,
    ).toContain("保存");
    expect(
      screen.getByTestId("settings-persona-pref-replyLanguage-disputed-hint").textContent,
    ).toContain("忘记");
    expect(screen.queryByTestId("settings-persona-pref-replyLanguage-disputed-allow")).toBeNull();
    const candidate = screen.getByTestId("settings-persona-pref-replyLanguage-pending-candidate");
    // 建议值经受控词汇本地化展示（replyLanguage 的 en-US → English）。
    expect(candidate.textContent).toContain("English");
    expect(candidate.textContent).toContain("保存或忘记可解决");
    // preferredAddress：forgotten＋抑制槽：设置保存/显式来源徽标与「解除抑制」入口。
    const address = screen.getByTestId("settings-persona-pref-preferredAddress-source-status");
    expect(address.textContent).toContain("来源：设置保存");
    expect(address.textContent).toContain("显式");
    expect(
      screen.getByTestId("settings-persona-pref-preferredAddress-suppressed").textContent,
    ).toContain("已抑制");
    expect(buttonById("settings-persona-pref-preferredAddress-allow-learning").disabled).toBe(
      false,
    );
    // 未抑制键没有解除抑制入口（replyLanguage 无抑制）。
    expect(screen.queryByTestId("settings-persona-pref-replyLanguage-allow-learning")).toBeNull();
  });

  it("解除抑制：allowLearningForKey 以该键当前 generation 做 CAS，成功后徽标消失", async () => {
    await openReadySection();
    fireEvent.click(buttonById("settings-persona-pref-preferredAddress-allow-learning"));
    await waitFor(() => {
      expect(mocks.personaService.allowLearningForKey).toHaveBeenCalledTimes(1);
    });
    expect(mocks.personaService.allowLearningForKey.mock.calls[0]?.[0]).toMatchObject({
      key: "preferredAddress",
      expectedGeneration: 3,
    });
    // 成功后重读：抑制徽标与解除入口消失，结果文案为已保存。
    await waitFor(() => {
      expect(screen.queryByTestId("settings-persona-pref-preferredAddress-suppressed")).toBeNull();
    });
    expect(
      screen.queryByTestId("settings-persona-pref-preferredAddress-allow-learning"),
    ).toBeNull();
    expect(
      screen.getByTestId("settings-persona-pref-preferredAddress-notice").textContent ?? "",
    ).toContain("已保存");
  });

  it("L 开关：开启＝U&&L 一次提交；关闭保持当前 U 值；当前值随概览刷新", async () => {
    await openReadySection();
    expect(screen.getByTestId("settings-persona-learning-state").textContent).toContain(
      "当前：关闭",
    );
    expect(screen.getByTestId("settings-persona-learning-budget").textContent).toContain("2/10");
    expect(screen.getByTestId("settings-persona-learning-counters").textContent).toContain(
      "接收 5",
    );
    // 开启：usePreferences:true + autoLearn:true 一次提交（学习前置＝U&&L）。
    fireEvent.click(buttonById("settings-persona-learning-enable"));
    await waitFor(() => {
      expect(mocks.personaService.setPersonalPolicy).toHaveBeenCalledTimes(1);
    });
    expect(mocks.personaService.setPersonalPolicy.mock.calls[0]?.[0]).toEqual({
      expectedPolicyRevision: 2,
      usePreferences: true,
      autoLearn: true,
      mutationId: expect.any(String),
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-learning-state").textContent).toContain(
        "当前：开启",
      );
    });
    // U 行不受影响（当前值仍为开启，一次提交内一致）。
    expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain("当前：开启");

    // 关闭 L：保持当前 U 值（usePreferences:true 不变），autoLearn:false。
    fireEvent.click(buttonById("settings-persona-learning-disable"));
    await waitFor(() => {
      expect(mocks.personaService.setPersonalPolicy).toHaveBeenCalledTimes(2);
    });
    expect(mocks.personaService.setPersonalPolicy.mock.calls[1]?.[0]).toEqual({
      expectedPolicyRevision: 3,
      usePreferences: true,
      autoLearn: false,
      mutationId: expect.any(String),
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-learning-state").textContent).toContain(
        "当前：关闭",
      );
    });
    expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain("当前：开启");
  });

  it("关闭 U 的级联确认：文案写明同事务关 L/撤租约/清候选；确认后才提交 usePreferences:false", async () => {
    await openReadySection();
    fireEvent.click(buttonById("settings-persona-policy-disable"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-cascade-confirm")).toBeTruthy();
    });
    const dialog = screen.getByTestId("settings-persona-cascade-confirm").textContent ?? "";
    expect(dialog).toContain("同时关闭自动学习");
    expect(dialog).toContain("撤回全部学习租约");
    expect(dialog).toContain("清除未提交的学习候选");
    expect(dialog).toContain("不会恢复自动学习");
    // 未确认前不提交。
    expect(mocks.personaService.setPersonalPolicy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("settings-persona-cascade-confirm-action"));
    await waitFor(() => {
      expect(mocks.personaService.setPersonalPolicy).toHaveBeenCalledTimes(1);
    });
    expect(mocks.personaService.setPersonalPolicy.mock.calls[0]?.[0]).toEqual({
      expectedPolicyRevision: 2,
      usePreferences: false,
      mutationId: expect.any(String),
    });
    // 提交后级联由服务执行：L 当前值随概览刷新为关闭。
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-learning-state").textContent).toContain(
        "当前：关闭",
      );
    });
    expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain("当前：关闭");
  });

  it("概览读取失败：U/L 当前值诚实降级为未知；关闭 L 与关闭 U 不发猜测请求", async () => {
    mocks.state.overviewOk = false;
    await openReadySection();
    expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain("未知");
    expect(screen.getByTestId("settings-persona-learning-state").textContent).toContain("未知");
    // 关闭 L 需要保持当前 U 值（wire 必填 usePreferences）：概览缺席时按钮禁用，不猜测。
    expect(buttonById("settings-persona-learning-disable").disabled).toBe(true);
    // 开启 L 与 U 仍是显式提交（目标值明确）；关闭 U 经级联确认提交 false。
    expect(buttonById("settings-persona-learning-enable").disabled).toBe(false);
    fireEvent.click(buttonById("settings-persona-policy-disable"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-cascade-confirm")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("settings-persona-cascade-confirm-action"));
    await waitFor(() => {
      expect(mocks.personaService.setPersonalPolicy).toHaveBeenCalledTimes(1);
    });
    expect(mocks.personaService.setPersonalPolicy.mock.calls[0]?.[0]).toMatchObject({
      usePreferences: false,
    });
  });
});

describe("P1b i18n 诚实边界（zh-CN / en-US）", () => {
  const zh = zhCNMessages as Record<string, string>;
  const en = enUSMessages as Record<string, string>;

  it("学习分区文案满足诚实边界：无经历/记忆页承诺、级联范围准确、不出现「彻底忘记」", () => {
    expect(zh["settings.drora.learning.description"]).toContain("只推测");
    expect(zh["settings.drora.learning.description"]).toContain("不创建经历或记忆页");
    expect((en["settings.drora.learning.description"] ?? "").toLowerCase()).toContain(
      "no experiences or memory pages",
    );
    expect(zh["settings.drora.policy.cascade.description"]).toContain("同时关闭自动学习");
    expect(zh["settings.drora.policy.cascade.description"]).toContain("不会恢复自动学习");
    expect(en["settings.drora.policy.cascade.description"]).toContain("same transaction");
    expect(zh["settings.drora.preferences.disputedHint"]).toContain("保存");
    expect(zh["settings.drora.preferences.disputedHint"]).toContain("忘记");
    expect(zh["settings.drora.preferences.suppressedBadge"]).toContain("已抑制");
  });
});
