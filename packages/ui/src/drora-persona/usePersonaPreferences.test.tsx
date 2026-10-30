// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "@drora/shared";
import enUSMessages from "@/i18n/locales/en-US.js";
import zhCNMessages from "@/i18n/locales/zh-CN.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";

/**
 * Persona P1a「交流默认与导出」交互守护（specs/drora-persona-system.md §9/§10、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §1.2/§2/§4.2/§7；
 * PersonaPreferencesSection + usePersonaPreferences）：
 * - 进区只读：listPreferences + getPersonaOverview，不写任何键、不为导出初始化；
 * - 单键保存：CAS 携带 expectedRevision（槽缺席=0）+ mutationId，成功后重读；
 * - CAS 冲突：保留草稿并给出「已保存 vs 草稿」比较，不静默 last-write-wins；
 * - 忘记：确认文案必须写明「逻辑撤销」范围（清除应用内该键的值与候选，不删除聊天记录、
 *   项目记忆或诊断），禁止「彻底忘记/所有地方删除」类表述；
 * - outcome_unknown：结果未知文案 + 重试复用同一 mutationId（PM53），成功后换新 ID；
 * - U 使用许可：无全局查询方法——初始如实显示「当前生效值未知」，两态按钮各自显式提交
 *   setPersonalPolicy；冲突后重新预读 policyRevision（wire 上唯一策略读路径是导出快照的
 *   policyRevision）并由用户显式重试；
 * - 导出：成功经 IPlatformService.saveFile 保存 2 空格缩进 JSON；取消不显示已保存；
 *   uninitialized 显示「尚无资料」且不调用 saveFile；
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
    policy: { usePreferences: false, policyRevision: 0, policyEpoch: 0 },
    // 服务权威偏好行（含 forgotten 行保持 revision 连续性，与 SQLite 仓储语义一致）。
    rows: {} as Record<
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
    listPreferences: vi.fn(),
    setPersonalPolicy: vi.fn(),
    savePreference: vi.fn(),
    forgetPreference: vi.fn(),
    preparePersonaExport: vi.fn(),
  };
  // 桌面 IPlatformService.saveFile：导出测试用（PersonaPreferencesSection 经
  // useOptionalPlatform 读取；PlatformProvider 注入 mock 平台）。
  const saveFile = vi.fn();
  return { state, personaService, saveFile };
});

/** P1a 只读导出的冻结快照样例（合同 §7 最小形状）。 */
function personaExportPayload(): Record<string, unknown> {
  return {
    format: "drora-persona-export",
    formatVersion: 1,
    capturedAt: "2026-10-30T00:00:00.000Z",
    coreRevision: 1,
    policyRevision: mocks.state.policy.policyRevision,
    core: {
      displayName: "Drora",
      selfDescription: "",
      warmth: "balanced",
      directness: "direct",
      humor: "light",
    },
    templateVersion: 1,
    compilerVersion: 1,
    preferences: [],
    omittedCounts: { inferredOmittedUnverifiable: 0 },
    limitations: ["limitation-1"],
  };
}

function defaultResponses(): void {
  mocks.state.initialized = true;
  mocks.state.policy = { usePreferences: false, policyRevision: 0, policyEpoch: 0 };
  mocks.state.rows = {
    replyLanguage: { value: "follow_user", revision: 1, keyGeneration: 1, status: "active" },
    preferredAddress: { value: "阿明", revision: 1, keyGeneration: 1, status: "active" },
  };
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
      // 未初始化时服务返回空答案（与 PersonaAppService 一致），不是错误。
      preferences: Object.entries(mocks.state.rows)
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
      };
      mocks.state.rows[input.key] = next;
      return { ok: true, value: { status: "forgotten", keyGeneration: next.keyGeneration } };
    },
  );
  mocks.personaService.setPersonalPolicy.mockImplementation(
    async (input: { expectedPolicyRevision: number; usePreferences: boolean }) => {
      if (mocks.state.policy.policyRevision !== input.expectedPolicyRevision) {
        return { ok: false, code: "revision_conflict" };
      }
      if (mocks.state.policy.usePreferences === input.usePreferences) {
        return { ok: true, value: { status: "unchanged" } };
      }
      mocks.state.policy = {
        usePreferences: input.usePreferences,
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
  mocks.personaService.preparePersonaExport.mockImplementation(async () => {
    if (!mocks.state.initialized) return { ok: false, code: "uninitialized" };
    return { ok: true, value: personaExportPayload() };
  });
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

const { PersonaPreferencesSection } = await import("./PersonaPreferencesSection.js");

const platformMock = { saveFile: mocks.saveFile } as unknown as IPlatformService;

function renderPrefsSection(): void {
  render(
    <PlatformProvider platform={platformMock}>
      <PersonaPreferencesSection personaService={mocks.personaService} />
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

function decodeSaveFileData(callIndex = 0): { suggestedName: string; json: string } {
  const payload = mocks.saveFile.mock.calls[callIndex]?.[0] as {
    data: ArrayBuffer;
    suggestedName: string;
  };
  return {
    suggestedName: payload.suggestedName,
    json: new TextDecoder().decode(new Uint8Array(payload.data)),
  };
}

async function openReadyPrefsSection(): Promise<void> {
  renderPrefsSection();
  await waitFor(() => {
    expect(inputById("settings-persona-pref-preferredAddress").value).toBe("阿明");
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
    // 槽缺席的键显示未设置、不提供忘记入口。
    expect(screen.getByTestId("settings-persona-pref-explanationDetail-value").textContent).toBe(
      "当前值：未设置",
    );
    expect(screen.queryByTestId("settings-persona-pref-explanationDetail-forget")).toBeNull();
    // U 无全局查询方法：初始如实显示未知，不做当前值断言。
    expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain(
      "当前生效值未知",
    );
    expect(mocks.personaService.savePreference).not.toHaveBeenCalled();
    expect(mocks.personaService.forgetPreference).not.toHaveBeenCalled();
    expect(mocks.personaService.setPersonalPolicy).not.toHaveBeenCalled();
    // 保存/取消在无改动时禁用。
    expect(buttonById("settings-persona-pref-preferredAddress-save").disabled).toBe(true);
    expect(buttonById("settings-persona-pref-preferredAddress-cancel").disabled).toBe(true);
  });

  it("preferredAddress 保存：CAS 携带 expectedRevision+mutationId，成功后重读且保存回到禁用", async () => {
    await openReadyPrefsSection();
    const listCallsBefore = mocks.personaService.listPreferences.mock.calls.length;
    fireEvent.change(inputById("settings-persona-pref-preferredAddress"), {
      target: { value: "阿明二" },
    });
    expect(buttonById("settings-persona-pref-preferredAddress-save").disabled).toBe(false);
    fireEvent.click(buttonById("settings-persona-pref-preferredAddress-save"));
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
    // 保存成功后重读（spec §10）：当前值徽章与控件回到服务值，保存/取消回到禁用。
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
    expect(buttonById("settings-persona-pref-preferredAddress-save").disabled).toBe(true);
    expect(
      screen.getByTestId("settings-persona-pref-preferredAddress-notice").textContent,
    ).toContain("已保存");
  });

  it("Select 键保存：选项受控词汇写值，CAS 使用该键自身 revision", async () => {
    await openReadyPrefsSection();
    openPrefsSelect("settings-persona-pref-replyLanguage");
    fireEvent.click(screen.getByText("中文"));
    expect(buttonById("settings-persona-pref-replyLanguage-save").disabled).toBe(false);
    fireEvent.click(buttonById("settings-persona-pref-replyLanguage-save"));
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
    fireEvent.click(buttonById("settings-persona-pref-preferredAddress-save"));
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

    // 服务再前进（revision 6）后再次保存冲突：面板重现；这次放弃草稿并加载最新。
    mocks.state.rows.preferredAddress = {
      value: "老王",
      revision: 6,
      keyGeneration: 5,
      status: "active",
    };
    fireEvent.click(buttonById("settings-persona-pref-preferredAddress-save"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-pref-preferredAddress-divergence")).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId("settings-persona-pref-preferredAddress-discard-draft"));
    await waitFor(() => {
      expect(inputById("settings-persona-pref-preferredAddress").value).toBe("老王");
    });
    expect(buttonById("settings-persona-pref-preferredAddress-save").disabled).toBe(true);
  });

  it("忘记：确认文案写明逻辑撤销范围；确认后携带 expectedRevision+mutationId 并重读", async () => {
    await openReadyPrefsSection();
    fireEvent.click(buttonById("settings-persona-pref-preferredAddress-forget"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-forget-confirm")).toBeTruthy();
    });
    const dialogText = screen.getByTestId("settings-persona-forget-confirm").textContent ?? "";
    // 硬边界：必须写明逻辑撤销与清除范围；禁止「彻底忘记/所有地方删除」类表述。
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
    // 成功后重读：当前值显示未设置，成功文案如实说明影响范围。
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-pref-preferredAddress-value").textContent).toBe(
        "当前值：未设置",
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
    fireEvent.click(buttonById("settings-persona-pref-preferredAddress-save"));
    await waitFor(() => {
      expect(
        screen.getByTestId("settings-persona-pref-preferredAddress-notice").textContent ?? "",
      ).toContain("结果未知");
    });
    expect(
      screen.getByTestId("settings-persona-pref-preferredAddress-notice").textContent ?? "",
    ).toContain("幂等回放");

    // 重试：必须复用同一 mutationId（合同 §2/PM53）。
    fireEvent.click(buttonById("settings-persona-pref-preferredAddress-save"));
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
    fireEvent.click(buttonById("settings-persona-pref-preferredAddress-save"));
    await waitFor(() => {
      expect(mutationIds).toHaveLength(3);
    });
    expect(mutationIds[2]).not.toBe(mutationIds[0]);
  });

  it("U 使用许可：初始未知态；两态按钮各自显式提交；冲突后重新预读并由用户重试", async () => {
    await openReadyPrefsSection();
    // 开启：以预读的 policyRevision（0）做 CAS（calls[0]）。
    fireEvent.click(buttonById("settings-persona-policy-enable"));
    await waitFor(() => {
      expect(mocks.personaService.setPersonalPolicy).toHaveBeenCalledTimes(1);
    });
    expect(mocks.personaService.setPersonalPolicy.mock.calls[0]?.[0]).toMatchObject({
      expectedPolicyRevision: 0,
      usePreferences: true,
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain(
        "本会话已提交：开启",
      );
    });

    // 同值再点开启（calls[1]）：unchanged 可如实断言服务当前值。
    fireEvent.click(buttonById("settings-persona-policy-enable"));
    await waitFor(() => {
      expect(mocks.personaService.setPersonalPolicy).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain(
        "服务端当前即为「开启」",
      );
    });

    // 关闭（calls[2]）：另一窗口已把策略推进到 revision 2 → 冲突；重新预读后请用户显式重试。
    mocks.state.policy = { usePreferences: true, policyRevision: 2, policyEpoch: 2 };
    mocks.personaService.setPersonalPolicy.mockImplementationOnce(async () => ({
      ok: false,
      code: "revision_conflict",
    }));
    const exportCallsBefore = mocks.personaService.preparePersonaExport.mock.calls.length;
    fireEvent.click(buttonById("settings-persona-policy-disable"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-policy-notice").textContent ?? "").toContain(
        "其他窗口",
      );
    });
    // 冲突路径重新预读了策略版本号（导出快照的 policyRevision 是 wire 上唯一策略读路径）。
    await waitFor(() => {
      expect(mocks.personaService.preparePersonaExport.mock.calls.length).toBeGreaterThan(
        exportCallsBefore,
      );
    });
    expect(mocks.personaService.setPersonalPolicy.mock.calls[2]?.[0]).toMatchObject({
      expectedPolicyRevision: 1,
      usePreferences: false,
    });

    // 用户显式重试（calls[3]）：以重新预读的 revision 2 提交，成功后状态行如实陈述。
    fireEvent.click(buttonById("settings-persona-policy-disable"));
    await waitFor(() => {
      expect(mocks.personaService.setPersonalPolicy).toHaveBeenCalledTimes(4);
    });
    expect(mocks.personaService.setPersonalPolicy.mock.calls[3]?.[0]).toMatchObject({
      expectedPolicyRevision: 2,
      usePreferences: false,
    });
    await waitFor(() => {
      expect(screen.getByTestId("settings-persona-policy-state").textContent).toContain(
        "本会话已提交：关闭",
      );
    });
  });

  it("导出成功：2 空格缩进 JSON 经 saveFile 保存，文件名 drora-persona-export.json，显示已保存", async () => {
    await openReadyPrefsSection();
    mocks.saveFile.mockResolvedValue({ success: true, path: "/tmp/drora-persona-export.json" });
    fireEvent.click(buttonById("settings-persona-export"));
    await waitFor(() => {
      expect(mocks.saveFile).toHaveBeenCalledTimes(1);
    });
    const saved = decodeSaveFileData();
    expect(saved.suggestedName).toBe("drora-persona-export.json");
    // 2 空格缩进 + 可回读为同一 payload。
    expect(saved.json.startsWith('{\n  "format":')).toBe(true);
    expect(JSON.parse(saved.json)).toMatchObject(personaExportPayload());
    const notice = screen.getByTestId("settings-persona-export-notice").textContent ?? "";
    expect(notice).toContain("已保存");
  });

  it("导出取消：如实显示未保存，不显示已保存，不自动重试", async () => {
    await openReadyPrefsSection();
    mocks.saveFile.mockResolvedValue({ success: false, canceled: true });
    fireEvent.click(buttonById("settings-persona-export"));
    await waitFor(() => {
      expect(mocks.saveFile).toHaveBeenCalledTimes(1);
    });
    const notice = screen.getByTestId("settings-persona-export-notice").textContent ?? "";
    expect(notice).toContain("已取消");
    expect(notice).not.toContain("已保存");
    // 不自动重试：取消后不再发起第二次保存。
    expect(mocks.saveFile).toHaveBeenCalledTimes(1);
  });

  it("未初始化：导出显示尚无资料且不调 saveFile；保存/U 按钮禁用、忘记无入口", async () => {
    mocks.state.initialized = false;
    renderPrefsSection();
    await waitFor(() => {
      expect(buttonById("settings-persona-export")).toBeTruthy();
    });
    expect(buttonById("settings-persona-policy-enable").disabled).toBe(true);
    expect(buttonById("settings-persona-policy-disable").disabled).toBe(true);
    expect(buttonById("settings-persona-pref-preferredAddress-save").disabled).toBe(true);
    // 未初始化时 listPreferences 返回空答案：槽缺席 → 无忘记入口。
    expect(screen.queryByTestId("settings-persona-pref-preferredAddress-forget")).toBeNull();

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

describe("P1a i18n 完整性与诚实边界（zh-CN / en-US）", () => {
  const zh = zhCNMessages as Record<string, string>;
  const en = enUSMessages as Record<string, string>;
  const zhDroraKeys = Object.keys(zh)
    .filter((key) => key.startsWith("settings.drora."))
    .sort();
  const enDroraKeys = Object.keys(en)
    .filter((key) => key.startsWith("settings.drora."))
    .sort();

  it("settings.drora.* 键集中英一致且非空", () => {
    expect(zhDroraKeys.length).toBeGreaterThan(60);
    expect(enDroraKeys).toEqual(zhDroraKeys);
    for (const key of zhDroraKeys) {
      expect(zh[key]?.length ?? 0).toBeGreaterThan(0);
      expect(en[key]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("忘记确认与 U/导出文案满足诚实边界（两种语言）", () => {
    expect(zh["settings.drora.forget.confirmDescription"]).toContain("逻辑撤销");
    expect(zh["settings.drora.forget.confirmDescription"]).toContain(
      "不会删除聊天记录、项目记忆或诊断",
    );
    expect((en["settings.drora.forget.confirmDescription"] ?? "").toLowerCase()).toContain(
      "logical undo",
    );
    expect((en["settings.drora.forget.confirmDescription"] ?? "").toLowerCase()).toContain(
      "does not delete chat history",
    );
    expect(zh["settings.drora.export.noData"]).toContain("尚无资料");
    expect(en["settings.drora.export.noData"]).toContain("No data yet");
    expect(zh["settings.drora.policy.state.unknown"]).toContain("未知");
    expect(en["settings.drora.policy.state.unknown"]).toContain("unknown");
    for (const messages of [zh, en]) {
      for (const key of zhDroraKeys) {
        const value = messages[key] ?? "";
        expect(value).not.toContain("彻底忘记");
        expect(value).not.toContain("所有地方删除");
        expect(value).not.toContain("当前会话已关闭");
      }
    }
  });
});
