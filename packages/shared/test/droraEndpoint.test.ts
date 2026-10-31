import { describe, expect, it } from "vitest";
import {
  DEFAULT_BIGMODEL_API_ORIGIN,
  DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL,
  DEFAULT_ZAI_BUSINESS_BASE_URL,
  DEFAULT_ZAI_OAUTH_CLIENT_ID,
  DEFAULT_ZAI_OAUTH_ORIGIN,
  DEFAULT_DRORA_ENDPOINT_ORIGIN,
  TEST_BIGMODEL_API_ORIGIN,
  TEST_ZAI_BUSINESS_BASE_URL,
  TEST_ZAI_OAUTH_CLIENT_ID,
  TEST_ZAI_OAUTH_ORIGIN,
  TEST_DRORA_ENDPOINT_ORIGIN,
  buildBigModelCodingPlanPersonalManageUrl,
  buildBigModelCodingPlanTeamManageUrl,
  buildBigModelApiUrl,
  buildRuntimeDroraApiUrl,
  buildRuntimeZaiBusinessUrl,
  buildRuntimeZaiOAuthUrl,
  buildRuntimeDroraEndpointUrls,
  buildDroraEndpointUrls,
  normalizeDroraEndpointOrigin,
  resolveBigModelApiOrigin,
  resolveRuntimeProductEndpointConfig,
  resolveWebRemoteControlEndpointOrigin,
  resolveWebRemoteControlRelayWsUrl,
  resolveZaiBusinessBaseUrl,
  resolveZaiOAuthClientId,
  resolveZaiOAuthOrigin,
  resolveDroraEndpointOrigin,
} from "../src/droraEndpoint.js";
import { appSettingsPatchSchema, appSettingsSchema } from "../src/validationAppSettings.js";

describe("droraEndpoint", () => {
  it("defaults to the scoped origin in every env without env base url", () => {
    expect(resolveDroraEndpointOrigin({ env: "test" })).toBe(TEST_DRORA_ENDPOINT_ORIGIN);
    expect(resolveDroraEndpointOrigin({ env: "production" })).toBe(DEFAULT_DRORA_ENDPOINT_ORIGIN);
  });

  it("keeps the non-production settings override above env base url", () => {
    expect(
      resolveDroraEndpointOrigin({
        env: "test",
        envBaseOrigin: "https://zcode.z.ai",
        overrideOrigin: "http://localhost:3030/api/v1",
      }),
    ).toBe("http://localhost:3030");
  });

  it("uses a non-production override after normalizing to origin", () => {
    expect(
      resolveDroraEndpointOrigin({
        env: "test",
        overrideOrigin: "https://zcode.z.ai/api/v1/ignored?x=1",
      }),
    ).toBe(TEST_DRORA_ENDPOINT_ORIGIN);
  });

  it("ignores overrides in production", () => {
    expect(
      resolveDroraEndpointOrigin({
        env: "production",
        envBaseOrigin: "https://zcode.z.ai",
        overrideOrigin: "https://zcode.z.ai",
      }),
    ).toBe(DEFAULT_DRORA_ENDPOINT_ORIGIN);
  });

  it("derives http and websocket urls from the same origin", () => {
    expect(buildDroraEndpointUrls("http://localhost:3030")).toEqual({
      origin: "http://localhost:3030",
      apiBaseUrl: "http://localhost:3030/api/v1",
      remoteUrl: "http://localhost:3030/remote/v3",
      webRemoteCallbackUrl: "http://localhost:3030/remote/v4",
      webShareCallbackUrl: "http://localhost:3030/cn/share/callback",
      relayWsUrl: "ws://localhost:3030/api/v1/remote/ws2",
      droraPlanOpenAiBaseUrl: "http://localhost:3030/api/v1/zcode-plan",
      droraPlanAnthropicBaseUrl: "http://localhost:3030/api/v1/zcode-plan/anthropic",
      droraPlanBillingCurrentUrl: "http://localhost:3030/api/v1/zcode-plan/billing/current",
      droraPlanBillingBalanceUrl: "http://localhost:3030/api/v1/zcode-plan/billing/balance",
    });
  });

  it("uses remote v3 for app versions below 3.4.0", () => {
    expect(buildDroraEndpointUrls("https://zcode.z.ai", { appVersion: "3.3.9" }).remoteUrl).toBe(
      "https://zcode.z.ai/remote/v3",
    );
  });

  it("uses remote v4 for app versions at or above 3.4.0", () => {
    expect(buildDroraEndpointUrls("https://zcode.z.ai", { appVersion: "3.4.0" }).remoteUrl).toBe(
      "https://zcode.z.ai/remote/v4",
    );
    expect(buildDroraEndpointUrls("https://zcode.z.ai", { appVersion: "3.4.1" }).remoteUrl).toBe(
      "https://zcode.z.ai/remote/v4",
    );
    expect(
      buildDroraEndpointUrls("https://zcode.z.ai", { appVersion: "3.5.0-beta.1" }).remoteUrl,
    ).toBe("https://zcode.z.ai/remote/v4");
  });

  it("keeps prerelease and invalid app versions on remote v3", () => {
    expect(
      buildDroraEndpointUrls("https://zcode.z.ai", { appVersion: "3.4.0-beta.1" }).remoteUrl,
    ).toBe("https://zcode.z.ai/remote/v3");
    expect(buildDroraEndpointUrls("https://zcode.z.ai", { appVersion: "dev" }).remoteUrl).toBe(
      "https://zcode.z.ai/remote/v3",
    );
    expect(buildDroraEndpointUrls("https://zcode.z.ai", { appVersion: "03.4.0" }).remoteUrl).toBe(
      "https://zcode.z.ai/remote/v3",
    );
    expect(
      buildDroraEndpointUrls("https://zcode.z.ai", { appVersion: "3.4.1-alpha..1" }).remoteUrl,
    ).toBe("https://zcode.z.ai/remote/v3");
    expect(buildDroraEndpointUrls("https://zcode.z.ai", { appVersion: "3.4.1-01" }).remoteUrl).toBe(
      "https://zcode.z.ai/remote/v3",
    );
  });

  it("derives runtime drora-plan urls from DRORA_ENV", () => {
    expect(buildRuntimeDroraEndpointUrls({ DRORA_ENV: "test" }).droraPlanOpenAiBaseUrl).toBe(
      "https://zcode.z.ai/api/v1/zcode-plan",
    );
    expect(buildRuntimeDroraEndpointUrls({ DRORA_ENV: "production" }).droraPlanOpenAiBaseUrl).toBe(
      "https://zcode.z.ai/api/v1/zcode-plan",
    );
    expect(buildRuntimeDroraEndpointUrls({}).droraPlanOpenAiBaseUrl).toBe(
      "https://zcode.z.ai/api/v1/zcode-plan",
    );
    expect(
      buildRuntimeDroraEndpointUrls({
        DRORA_ENV: "test",
        DRORA_BASE_URL: "https://zcode.z.ai/ignored/path",
      }).droraPlanAnthropicBaseUrl,
    ).toBe("https://zcode.z.ai/api/v1/zcode-plan/anthropic");
  });

  it("derives V2 relay from each endpoint origin", () => {
    expect(
      resolveWebRemoteControlRelayWsUrl({
        endpointOrigin: TEST_DRORA_ENDPOINT_ORIGIN,
      }),
    ).toBe("wss://zcode.z.ai/api/v1/remote/ws2");
    expect(
      resolveWebRemoteControlRelayWsUrl({
        endpointOrigin: DEFAULT_DRORA_ENDPOINT_ORIGIN,
      }),
    ).toBe(DEFAULT_WEB_REMOTE_CONTROL_RELAY_WS_URL);
    expect(
      resolveWebRemoteControlRelayWsUrl({
        endpointOrigin: "http://localhost:3030",
      }),
    ).toBe("ws://localhost:3030/api/v1/remote/ws2");
  });

  it("allows an explicit web remote control relay url override", () => {
    expect(
      resolveWebRemoteControlRelayWsUrl({
        endpointOrigin: TEST_DRORA_ENDPOINT_ORIGIN,
        overrideUrl: " ws://localhost:8787/api/v1/remote/ws2 ",
      }),
    ).toBe("ws://localhost:8787/api/v1/remote/ws2");
  });

  // 远控「官方/自建 Relay」切换（specs/relay-v2-server.md §8.7）：
  // 设置键只覆盖远控面，缺失/空白回落全局 endpoint 链，origin 归一走统一入口。
  describe("resolveWebRemoteControlEndpointOrigin", () => {
    it("falls back to the endpoint origin chain when the relay origin setting is absent", () => {
      expect(resolveWebRemoteControlEndpointOrigin({})).toBe(DEFAULT_DRORA_ENDPOINT_ORIGIN);
      expect(
        resolveWebRemoteControlEndpointOrigin({
          endpointOrigin: TEST_DRORA_ENDPOINT_ORIGIN,
        }),
      ).toBe(TEST_DRORA_ENDPOINT_ORIGIN);
      expect(
        resolveWebRemoteControlEndpointOrigin({
          relayOrigin: undefined,
          endpointOrigin: TEST_DRORA_ENDPOINT_ORIGIN,
        }),
      ).toBe(TEST_DRORA_ENDPOINT_ORIGIN);
      expect(
        resolveWebRemoteControlEndpointOrigin({
          relayOrigin: "   ",
          endpointOrigin: TEST_DRORA_ENDPOINT_ORIGIN,
        }),
      ).toBe(TEST_DRORA_ENDPOINT_ORIGIN);
    });

    it("prefers the relay origin setting and normalizes it", () => {
      expect(
        resolveWebRemoteControlEndpointOrigin({
          relayOrigin: "https://relay.example.com",
          endpointOrigin: TEST_DRORA_ENDPOINT_ORIGIN,
        }),
      ).toBe("https://relay.example.com");
      expect(
        resolveWebRemoteControlEndpointOrigin({
          relayOrigin: " https://relay.example.com/ ",
        }),
      ).toBe("https://relay.example.com");
      expect(
        resolveWebRemoteControlEndpointOrigin({
          relayOrigin: "http://127.0.0.1:8080",
          endpointOrigin: DEFAULT_DRORA_ENDPOINT_ORIGIN,
        }),
      ).toBe("http://127.0.0.1:8080");
    });
  });

  it("derives BigModel API origin from DRORA_ENV", () => {
    expect(resolveBigModelApiOrigin({ DRORA_ENV: "production" })).toBe("https://bigmodel.cn");
    expect(resolveBigModelApiOrigin({ DRORA_ENV: "test" })).toBe("https://bigmodel.cn");
    expect(buildBigModelApiUrl({ DRORA_ENV: "test" }, "/api/biz/subscription/list")).toBe(
      "https://bigmodel.cn/api/biz/subscription/list",
    );
  });

  it("derives BigModel Coding Plan manage urls from DRORA_ENV", () => {
    expect(buildBigModelCodingPlanPersonalManageUrl({ DRORA_ENV: "test" })).toBe(
      "https://bigmodel.cn/coding-plan/personal/overview",
    );
    expect(buildBigModelCodingPlanPersonalManageUrl({ DRORA_ENV: "production" })).toBe(
      "https://bigmodel.cn/coding-plan/personal/overview",
    );
    expect(buildBigModelCodingPlanTeamManageUrl({ DRORA_ENV: "test" })).toBe(
      "https://bigmodel.cn/coding-plan/team/plans",
    );
    expect(buildBigModelCodingPlanTeamManageUrl({ DRORA_ENV: "production" })).toBe(
      "https://bigmodel.cn/coding-plan/team/plans",
    );
  });

  it("resolves all product endpoints for the test product environment", () => {
    expect(resolveRuntimeProductEndpointConfig({ DRORA_ENV: "test" })).toMatchObject({
      droraEnv: "test",
      droraEndpointOrigin: TEST_DRORA_ENDPOINT_ORIGIN,
      zaiOAuthOrigin: TEST_ZAI_OAUTH_ORIGIN,
      zaiBusinessBaseUrl: TEST_ZAI_BUSINESS_BASE_URL,
      zaiOAuthClientId: TEST_ZAI_OAUTH_CLIENT_ID,
      bigModelApiOrigin: TEST_BIGMODEL_API_ORIGIN,
    });
  });

  it("resolves all product endpoints for the production product environment", () => {
    expect(resolveRuntimeProductEndpointConfig({ DRORA_ENV: "production" })).toMatchObject({
      droraEnv: "production",
      droraEndpointOrigin: DEFAULT_DRORA_ENDPOINT_ORIGIN,
      zaiOAuthOrigin: DEFAULT_ZAI_OAUTH_ORIGIN,
      zaiBusinessBaseUrl: DEFAULT_ZAI_BUSINESS_BASE_URL,
      zaiOAuthClientId: DEFAULT_ZAI_OAUTH_CLIENT_ID,
      bigModelApiOrigin: DEFAULT_BIGMODEL_API_ORIGIN,
    });
  });

  it("builds product endpoint URLs from the selected environment", () => {
    expect(buildRuntimeDroraApiUrl({ DRORA_ENV: "test" }, "/api/v1/oauth/token")).toBe(
      "https://zcode.z.ai/api/v1/oauth/token",
    );
    expect(buildRuntimeZaiOAuthUrl({ DRORA_ENV: "test" }, "/api/oauth/authorize")).toBe(
      "https://chat.z.ai/api/oauth/authorize",
    );
    expect(buildRuntimeZaiBusinessUrl({ DRORA_ENV: "test" }, "/api/auth/z/login")).toBe(
      "https://api.z.ai/api/auth/z/login",
    );
    expect(buildBigModelApiUrl({ DRORA_ENV: "test" }, "/login")).toBe("https://bigmodel.cn/login");
  });

  it("keeps environment-scoped endpoint overrides centralized", () => {
    const env = {
      DRORA_ENV: "test",
      DRORA_TEST_BASE_URL: "https://test-drora.example.com/path",
      ZAI_TEST_OAUTH_ORIGIN: "https://test-oauth.example.com/oauth",
      ZAI_TEST_BUSINESS_BASE_URL: "https://test-business.example.com/api",
      ZAI_TEST_OAUTH_CLIENT_ID: "client_test_override",
      BIGMODEL_TEST_API_BASE_URL: "https://test-bigmodel.example.com/base",
    };

    expect(resolveRuntimeProductEndpointConfig(env)).toMatchObject({
      droraEndpointOrigin: "https://test-drora.example.com",
      zaiOAuthOrigin: "https://test-oauth.example.com",
      zaiBusinessBaseUrl: "https://test-business.example.com",
      zaiOAuthClientId: "client_test_override",
      bigModelApiOrigin: "https://test-bigmodel.example.com",
    });
  });

  it("keeps unscoped endpoint overrides above scoped endpoint overrides", () => {
    const env = {
      DRORA_ENV: "test",
      ZAI_OAUTH_ORIGIN: "https://oauth-global.example.com",
      ZAI_TEST_OAUTH_ORIGIN: "https://oauth-test.example.com",
      ZAI_BUSINESS_BASE_URL: "https://business-global.example.com",
      ZAI_TEST_BUSINESS_BASE_URL: "https://business-test.example.com",
      ZAI_OAUTH_CLIENT_ID: "client_global",
      ZAI_TEST_OAUTH_CLIENT_ID: "client_test",
      BIGMODEL_API_BASE_URL: "https://bigmodel-global.example.com",
      BIGMODEL_TEST_API_BASE_URL: "https://bigmodel-test.example.com",
    };

    expect(resolveZaiOAuthOrigin(env)).toBe("https://oauth-global.example.com");
    expect(resolveZaiBusinessBaseUrl(env)).toBe("https://business-global.example.com");
    expect(resolveZaiOAuthClientId(env)).toBe("client_global");
    expect(resolveBigModelApiOrigin(env)).toBe("https://bigmodel-global.example.com");
  });

  it("ignores blank runtime endpoint overrides", () => {
    const env = {
      DRORA_ENV: "test",
      DRORA_BASE_URL: " ",
      DRORA_TEST_BASE_URL: "\t",
      ZAI_OAUTH_ORIGIN: "",
      ZAI_TEST_OAUTH_ORIGIN: " ",
      ZAI_BUSINESS_BASE_URL: " ",
      ZAI_TEST_BUSINESS_BASE_URL: "",
      ZAI_OAUTH_CLIENT_ID: "",
      ZAI_TEST_OAUTH_CLIENT_ID: " ",
      BIGMODEL_API_BASE_URL: " ",
      BIGMODEL_TEST_API_BASE_URL: "",
    };

    expect(resolveRuntimeProductEndpointConfig(env)).toMatchObject({
      droraEndpointOrigin: TEST_DRORA_ENDPOINT_ORIGIN,
      zaiOAuthOrigin: TEST_ZAI_OAUTH_ORIGIN,
      zaiBusinessBaseUrl: TEST_ZAI_BUSINESS_BASE_URL,
      zaiOAuthClientId: TEST_ZAI_OAUTH_CLIENT_ID,
      bigModelApiOrigin: TEST_BIGMODEL_API_ORIGIN,
    });
  });

  it("rejects non-http endpoint origins", () => {
    expect(() => normalizeDroraEndpointOrigin("file:///tmp/drora")).toThrow(/http or https/);
  });

  it("persists optional endpoint override in app settings", () => {
    expect(
      appSettingsSchema.parse({ droraEndpointOrigin: "https://zcode.z.ai/path" })
        .droraEndpointOrigin,
    ).toBe(TEST_DRORA_ENDPOINT_ORIGIN);
    expect(
      appSettingsPatchSchema.parse({ droraEndpointOrigin: "http://localhost:3030/foo" })
        .droraEndpointOrigin,
    ).toBe("http://localhost:3030");
  });

  it("persists the web remote control relay origin setting with bad values dropped", () => {
    // 合法 origin 归一（剥 path），坏值/空白归 undefined——坏值只丢该字段不拖垮整份 settings。
    expect(
      appSettingsSchema.parse({ webRemoteControlRelayOrigin: "https://relay.example.com/base" })
        .webRemoteControlRelayOrigin,
    ).toBe("https://relay.example.com");
    expect(
      appSettingsPatchSchema.parse({ webRemoteControlRelayOrigin: " http://127.0.0.1:8080 " })
        .webRemoteControlRelayOrigin,
    ).toBe("http://127.0.0.1:8080");
    expect(
      appSettingsSchema.parse({ webRemoteControlRelayOrigin: "not a url" })
        .webRemoteControlRelayOrigin,
    ).toBeUndefined();
    expect(
      appSettingsPatchSchema.parse({ webRemoteControlRelayOrigin: "   " })
        .webRemoteControlRelayOrigin,
    ).toBeUndefined();
    expect(appSettingsSchema.parse({}).webRemoteControlRelayOrigin).toBeUndefined();
  });
});
