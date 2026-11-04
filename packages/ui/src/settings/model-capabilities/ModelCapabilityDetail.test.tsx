// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TID_MODEL_CAPABILITY_TOGGLE, testId } from "@drora/shared/test-ids";

/**
 * 模型能力条目表单守护（specs/model-capabilities.md §5.1 字段表；MC-5/MC-10 可测部分）：
 * - 五条目 detail 分派渲染（purpose → 表单）；
 * - 开关/字段写路径唯一经 useModelCapabilities.update（capabilities 面）；
 * - ApiKeyRow 语义：留空保存即删除（credentials 面 value=null）；存在性态渲染；
 * - baseUrl 连接区模式：明文非本机地址阻止写入 + 行内警告分型（unparseable/insecure）；
 * - 服务缺席 fail-closed：档案是本机桌面 Host 事实，远端上下文呈现不可用态零写入；
 * - asr/tts 引擎 Select 写档案条目（引擎选择迁入；MC-10 数据源切档案的写侧）。
 */

// radix Select 内容挂载需要（jsdom 缺失）。
window.HTMLElement.prototype.scrollIntoView = () => undefined;
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => undefined;
window.HTMLElement.prototype.releasePointerCapture = () => undefined;

const { capabilityState, updateMock, stableServices, controllerState } = vi.hoisted(() => {
  const updateMock = vi.fn(async (params: Record<string, unknown>) => {
    return {
      schemaVersion: 1,
      capabilities: capabilityState.current,
      migratedFromLegacySettings: true,
    };
  });
  const capabilityState = {
    current: {
      "decision-jev": { enabled: false, providerKind: "typesafe", baseUrl: "", modelId: "" },
      embedding: { enabled: false, mode: "local", localModelId: "local-bge-small-zh-v1.5-int8" },
      asr: { engine: "webSpeech", providerRef: "", modelId: "", baseUrlOverride: "" },
      tts: { engine: "system", providerRef: "", modelId: "", voice: "", baseUrlOverride: "" },
      "image-generation": { enabled: false, baseUrl: "", modelId: "" },
    },
  };
  // useModelCapabilities mock 的 controller 形状开关（unavailable 用例切 service=null）。
  const controllerState = { serviceAvailable: true };
  const stableServices = {
    // §13：供应商下拉数据源（useCapabilityProviderOptions 经
    // useProviderSettingsServiceView；空列表即可——表单测试聚焦档案写路径）。
    providerSettingsService: {
      getView: async () => ({ providers: [] }),
      onDidChange: () => ({ dispose: () => undefined }),
    },
    credentialService: {
      load: vi.fn(async (key: string) => (key.endsWith("typesafe:api-key") ? "stored-key" : null)),
      save: async () => undefined,
      delete: async () => undefined,
    },
    knowledgeIndexService: {
      refreshDecisionConfig: vi.fn(async () => ({ refreshed: true })),
      getSemanticStatus: vi.fn(async () => ({ state: "model_missing" })),
      downloadSemanticModel: vi.fn(async () => ({ error: null })),
      testJevConnection: vi.fn(async () => ({ ok: true, latencyMs: 12, error: null })),
    },
  };
  return { capabilityState, updateMock, stableServices, controllerState };
});

vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => stableServices,
  useOptionalServices: () => stableServices,
}));

vi.mock("@/hooks/useModelCapabilities.js", () => ({
  useModelCapabilities: () =>
    controllerState.serviceAvailable
      ? {
          capabilities: capabilityState.current,
          loading: false,
          error: null,
          service: {},
          update: updateMock,
        }
      : { capabilities: null, loading: false, error: null, service: null, update: updateMock },
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useDroraIntl: () => ({
    intl: { formatMessage: ({ id }: { id: string }) => id },
    locale: "zh-CN",
  }),
}));

const { ModelCapabilityDetail } = await import("./ModelCapabilityDetail.js");

// MC-5「双语 i18n 无缺 key」：模型能力命名空间（settings.modelCapab*）双语键集一致。
import enUS from "@/i18n/locales/en-US.js";
import zhCN from "@/i18n/locales/zh-CN.js";

describe("模型能力 i18n 双语配齐（MC-5）", () => {
  it("settings.modelCapab* 键集 zh-CN/en-US 一致且非空", () => {
    const pick = (dict: Record<string, string>) =>
      Object.keys(dict)
        .filter((key) => key.startsWith("settings.modelCapab"))
        .sort();
    const zhKeys = pick(zhCN);
    const enKeys = pick(enUS);
    expect(zhKeys.length).toBeGreaterThan(0);
    expect(enKeys).toEqual(zhKeys);
    for (const key of zhKeys) {
      expect(zhCN[key], `zh-CN ${key}`).toBeTruthy();
      expect(enUS[key], `en-US ${key}`).toBeTruthy();
    }
  });
});

function resetCapabilities(): void {
  capabilityState.current = {
    "decision-jev": { enabled: false, providerKind: "typesafe", baseUrl: "", modelId: "" },
    embedding: { enabled: false, mode: "local", localModelId: "local-bge-small-zh-v1.5-int8" },
    asr: { engine: "webSpeech", providerRef: "", modelId: "", baseUrlOverride: "" },
    tts: { engine: "system", providerRef: "", modelId: "", voice: "", baseUrlOverride: "" },
    "image-generation": { enabled: false, baseUrl: "", modelId: "" },
  };
  updateMock.mockClear();
  controllerState.serviceAvailable = true;
}

beforeEach(() => {
  resetCapabilities();
});

afterEach(() => {
  cleanup();
});

describe("ModelCapabilityDetail 分派与不可用态（MC-5）", () => {
  it("五条目按 purpose 分派渲染（detail 标题 + 各自表单面）", () => {
    const cases: Array<[string, string]> = [
      ["decision-jev", "settings.modelCapability.detail.decisionJev.title"],
      ["embedding", "settings.modelCapability.detail.embedding.title"],
      ["asr", "settings.modelCapability.detail.asr.title"],
      ["tts", "settings.modelCapability.detail.tts.title"],
      ["image-generation", "settings.modelCapability.detail.imageGeneration.title"],
    ];
    for (const [purpose, titleId] of cases) {
      const { unmount } = render(<ModelCapabilityDetail purpose={purpose as never} />);
      expect(screen.getByText(titleId)).toBeTruthy();
      unmount();
    }
  });

  it("服务缺席（远端 workspace 等）→ 不可用态 + 零表单写入（fail-closed，spec §4）", () => {
    controllerState.serviceAvailable = false;
    render(<ModelCapabilityDetail purpose="asr" />);
    expect(screen.getByText("settings.modelCapability.unavailable")).toBeTruthy();
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("知识评分条目（decision-jev）", () => {
  it("开关 → update capabilities 面 + refreshDecisionConfig 热路径", async () => {
    render(<ModelCapabilityDetail purpose="decision-jev" />);
    fireEvent.click(screen.getByTestId(testId(TID_MODEL_CAPABILITY_TOGGLE, "decision-jev")));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({
        capabilities: { "decision-jev": { enabled: true } },
      });
    });
    expect(stableServices.knowledgeIndexService.refreshDecisionConfig).toHaveBeenCalled();
  });

  it("typesafe 档：baseUrl 行有、模型行无；API Key 存在性按分键读取", async () => {
    render(<ModelCapabilityDetail purpose="decision-jev" />);
    expect(screen.getByTestId("model-capability-base-url-input-decision-jev")).toBeTruthy();
    expect(screen.queryByTestId("model-capability-model-input-decision-jev")).toBeNull();
    // credentialService.load(typesafe 分键) 有值 → 已配置态（存在性读取异步，waitFor）。
    await waitFor(() => {
      expect(screen.getByText("settings.modelCapability.apiKey.configured")).toBeTruthy();
    });
  });

  it("API Key 留空保存即删除（credentials 面 value=null，ApiKeyRow 语义）", async () => {
    render(<ModelCapabilityDetail purpose="decision-jev" />);
    const input = screen.getByTestId("model-capability-api-key-input");
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.click(screen.getByText("settings.modelCapability.apiKey.save"));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({
        credentials: { decisionJev: { providerKind: "typesafe", value: null } },
      });
    });
  });

  it("API Key 非空保存 → credentials 面按 providerKind 分键写值", async () => {
    render(<ModelCapabilityDetail purpose="decision-jev" />);
    const input = screen.getByTestId("model-capability-api-key-input");
    fireEvent.change(input, { target: { value: "sk-jev" } });
    fireEvent.click(screen.getByText("settings.modelCapability.apiKey.save"));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({
        credentials: { decisionJev: { providerKind: "typesafe", value: "sk-jev" } },
      });
    });
  });

  it("连接测试沿用 testJevConnection RPC（结果文案渲染）", async () => {
    capabilityState.current["decision-jev"] = {
      ...capabilityState.current["decision-jev"],
      enabled: true,
    };
    render(<ModelCapabilityDetail purpose="decision-jev" />);
    fireEvent.click(screen.getByTestId("model-capability-test-connection-button"));
    await waitFor(() => {
      expect(stableServices.knowledgeIndexService.testJevConnection).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        screen.getByText(/settings\.modelCapability\.decisionJev\.testConnection\.ok/u),
      ).toBeTruthy();
    });
  });
});

describe("语义嵌入条目（embedding；状态面自 knowledge 分区迁入）", () => {
  it("开关关闭：状态面不渲染（零状态轮询）；开关 → update embedding.enabled + 端口热切换", async () => {
    render(<ModelCapabilityDetail purpose="embedding" />);
    // 状态面只在开启后渲染（照 knowledge 分区原语义：开启时取一次 + 下载中轮询）。
    expect(screen.queryByText("settings.modelCapability.embedding.status.modelMissing")).toBeNull();
    expect(stableServices.knowledgeIndexService.getSemanticStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(testId(TID_MODEL_CAPABILITY_TOGGLE, "embedding")));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({ capabilities: { embedding: { enabled: true } } });
    });
    expect(stableServices.knowledgeIndexService.refreshDecisionConfig).toHaveBeenCalled();
  });

  it("四态状态面：开启后读 getSemanticStatus 渲染 ready（既有 RPC，轮询节奏不变）", async () => {
    capabilityState.current.embedding = { ...capabilityState.current.embedding, enabled: true };
    stableServices.knowledgeIndexService.getSemanticStatus.mockResolvedValueOnce({
      state: "ready",
    });
    render(<ModelCapabilityDetail purpose="embedding" />);
    await waitFor(() => {
      expect(screen.getByText("settings.modelCapability.embedding.status.ready")).toBeTruthy();
    });
  });
});

describe("语音识别/语音合成条目（asr/tts；引擎选择迁入档案，MC-10 写侧）", () => {
  it("asr 引擎 Select → update asr.engine；webSpeech 档不显 baseUrl/model/apiKey", async () => {
    render(<ModelCapabilityDetail purpose="asr" />);
    expect(screen.queryByTestId("model-capability-base-url-input-asr")).toBeNull();
    // 切 remote：radix Select 经 pointerDown + item 点选。
    const trigger = screen.getByTestId("model-capability-engine-select-asr");
    fireEvent.pointerDown(trigger, {
      button: 0,
      ctrlKey: false,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByText("settings.modelCapability.asr.engine.remote"));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({ capabilities: { asr: { engine: "remote" } } });
    });
  });

  it("engine=remote 时显供应商下拉 + 覆盖 + 模型 id；无独立 ApiKeyInput（§13 字段表）", () => {
    capabilityState.current.asr = {
      engine: "remote",
      providerRef: "",
      modelId: "",
      baseUrlOverride: "",
    };
    render(<ModelCapabilityDetail purpose="asr" />);
    expect(screen.getByTestId("model-capability-provider-select-asr")).toBeTruthy();
    expect(screen.getByTestId("model-capability-model-input-asr")).toBeTruthy();
    expect(screen.getByTestId("model-capability-base-url-input-asr")).toBeTruthy();
    expect(screen.queryByTestId("model-capability-api-key-input")).toBeNull();
  });

  it("tts engine=cloud 时显 baseUrl + 模型 + 音色 + ApiKeyInput；音色写档案 tts.voice", async () => {
    capabilityState.current.tts = {
      engine: "cloud",
      providerRef: "custom:sf",
      baseUrlOverride: "",
      modelId: "m",
      voice: "",
    };
    render(<ModelCapabilityDetail purpose="tts" />);
    const voiceInput = screen.getByTestId("model-capability-model-input-tts-voice");
    // 文本行已草稿化（§12 修复：onChange 直写会吞输入尾随空格 + 逐键遥测/写盘），
    // 保存只随 blur 提交。
    fireEvent.change(voiceInput, { target: { value: "alex" } });
    expect(updateMock).not.toHaveBeenCalled();
    fireEvent.blur(voiceInput);
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({ capabilities: { tts: { voice: "alex" } } });
    });
  });
});

describe("图像生成条目（image-generation；仅档案配置面，工具链路属批次三）", () => {
  it("开关 + baseUrl（datalist 预设）+ 模型 id + ApiKeyInput 写档案面", async () => {
    render(<ModelCapabilityDetail purpose="image-generation" />);
    fireEvent.click(screen.getByTestId(testId(TID_MODEL_CAPABILITY_TOGGLE, "image-generation")));
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({
        capabilities: { "image-generation": { enabled: true } },
      });
    });
    expect(screen.getByTestId("model-capability-base-url-input-image-generation")).toBeTruthy();
    const list = document.querySelector(
      "datalist#model-capability-image-base-url-presets",
    ) as HTMLDataListElement | null;
    expect(list).not.toBeNull();
    expect(list?.options.length).toBe(2);
  });
});

describe("baseUrl 连接区校验（自 VoiceSection S1 迁入的语义）", () => {
  it("合法 https：onBlur 写入 capabilities 面", async () => {
    capabilityState.current.asr = {
      engine: "remote",
      providerRef: "",
      modelId: "",
      baseUrlOverride: "",
    };
    render(<ModelCapabilityDetail purpose="asr" />);
    const input = screen.getByTestId("model-capability-base-url-input-asr");
    fireEvent.change(input, { target: { value: "https://api.siliconflow.cn/v1" } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith({
        capabilities: { asr: { baseUrlOverride: "https://api.siliconflow.cn/v1" } },
      });
    });
  });

  it("明文非本机地址：阻止写入 + 行内警告", () => {
    capabilityState.current.asr = {
      engine: "remote",
      providerRef: "",
      modelId: "",
      baseUrlOverride: "",
    };
    render(<ModelCapabilityDetail purpose="asr" />);
    const input = screen.getByTestId("model-capability-base-url-input-asr");
    fireEvent.change(input, { target: { value: "http://api.example.com/v1" } });
    fireEvent.blur(input);
    expect(updateMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        capabilities: { asr: { baseUrlOverride: "http://api.example.com/v1" } },
      }),
    );
    expect(screen.getByTestId("model-capability-base-url-warning").textContent).toContain(
      "insecureWarning",
    );
  });

  it("无法解析的地址：unparseable 警告分型", () => {
    capabilityState.current.asr = {
      engine: "remote",
      providerRef: "",
      modelId: "",
      baseUrlOverride: "",
    };
    render(<ModelCapabilityDetail purpose="asr" />);
    const input = screen.getByTestId("model-capability-base-url-input-asr");
    fireEvent.change(input, { target: { value: "not-a-url" } });
    fireEvent.blur(input);
    expect(screen.getByTestId("model-capability-base-url-warning").textContent).toContain(
      "unparseableWarning",
    );
  });
});
