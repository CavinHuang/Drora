// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IPlatformService } from "@drora/shared";
import enUSMessages from "@/i18n/locales/en-US.js";
import zhCNMessages from "@/i18n/locales/zh-CN.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";

/**
 * Persona P1a「只读导出与 i18n 诚实边界」守护（specs/drora-persona-system.md §9/§10 第十六批、
 * docs/design/drora-persona-data-contracts-2026-10-29.md §7；PersonaSettingsSection 高级折叠区
 * + usePersonaPreferences.handleExport）：
 * - 导出是只读快照：成功经 IPlatformService.saveFile 保存 2 空格缩进 JSON；取消不显示已保存；
 *   uninitialized 显示「尚无资料」且不为导出初始化；
 * - i18n：zh-CN 与 en-US 的 settings.drora.* 键集一致且关键文案符合诚实边界。
 * 从 usePersonaPreferences.test.tsx 拆出满足 max-file-lines。
 */

// radix Select 内容挂载需要（jsdom 缺失）。
window.HTMLElement.prototype.scrollIntoView = () => undefined;
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => undefined;
window.HTMLElement.prototype.releasePointerCapture = () => undefined;

const mocks = vi.hoisted(() => {
  const personaService = {
    // core 编辑器方法：PersonaSettingsSection 编排身份区（本文件守护导出面，
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
  // 桌面 IPlatformService.saveFile：导出测试用（PersonaSettingsSection 经
  // useOptionalPlatform 读取；PlatformProvider 注入 mock 平台）。
  const saveFile = vi.fn();
  return { personaService, saveFile };
});

/** P1a 只读导出的冻结快照样例（合同 §7 最小形状）。 */
function personaExportPayload(): Record<string, unknown> {
  return {
    format: "drora-persona-export",
    formatVersion: 1,
    capturedAt: "2026-10-30T00:00:00.000Z",
    coreRevision: 1,
    policyRevision: 0,
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
  mocks.personaService.listPreferences.mockResolvedValue({ ok: true, value: { preferences: [] } });
  mocks.personaService.getPersonaLearningOverview.mockResolvedValue({
    ok: true,
    value: {
      state: "initialized",
      policy: {
        usePreferences: false,
        autoLearn: false,
        policyRevision: 0,
        policyEpoch: 0,
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
  });
  mocks.personaService.preparePersonaExport.mockImplementation(async () => {
    return { ok: true, value: personaExportPayload() };
  });
  mocks.saveFile.mockReset();
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

const { PersonaSettingsSection } = await import("./PersonaSettingsSection.js");

const platformMock = { saveFile: mocks.saveFile } as unknown as IPlatformService;

function buttonById(testId: string): HTMLButtonElement {
  return screen.getByTestId(testId) as HTMLButtonElement;
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

async function openReadyExportSection(): Promise<void> {
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
  await waitFor(() => {
    expect(screen.getByTestId("settings-persona-section")).toBeTruthy();
  });
  // 导出收在「高级」折叠区（spec §10 第十六批），默认收起。
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

describe("PersonaSettingsSection 导出（P1a 只读快照）", () => {
  it("导出成功：2 空格缩进 JSON 经 saveFile 保存，文件名 drora-persona-export.json，显示已保存", async () => {
    await openReadyExportSection();
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
    await openReadyExportSection();
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
