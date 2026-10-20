import { describe, expect, it } from "vitest";
import {
  DRORA_TOOL_ENV_PASSTHROUGH_ENV_KEY,
  DRORA_REMOTE_HTTP_PROXY_ENV_KEY,
  DRORA_REMOTE_NO_PROXY_ENV_KEY,
  DRORA_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY,
  buildDroraToolEnvPassthroughEnv,
  getCapturedDroraCuaBrokerCredentials,
  isCuaDevModeRequested,
  isDroraCuaInternalFeatureEnabled,
  readDroraAgentTelemetryEnv,
  readDroraToolEnvPassthroughEnv,
  resetCapturedDroraCuaBrokerCredentialsForTest,
  sanitizeDroraRuntimeEnv,
  getCapturedDroraAgentTelemetryEnv,
  resetCapturedDroraAgentTelemetryEnvForTest,
} from "../src/runtimeEnv.js";

describe("runtimeEnv", () => {
  it("enables internal CUA by default while honoring explicit false values", () => {
    expect(isDroraCuaInternalFeatureEnabled({})).toBe(true);
    expect(isDroraCuaInternalFeatureEnabled({ DRORA_CUA_PRODUCT_HELPER: "0" })).toBe(false);
    expect(isDroraCuaInternalFeatureEnabled({ DRORA_CUA_PRODUCT_HELPER: "false" })).toBe(false);
    expect(isDroraCuaInternalFeatureEnabled({ DRORA_CUA_PRODUCT_HELPER: "1" })).toBe(true);
    expect(isDroraCuaInternalFeatureEnabled({ DRORA_CUA_PRODUCT_HELPER: " TRUE " })).toBe(true);
    expect(isDroraCuaInternalFeatureEnabled({ DRORA_CUA_PRODUCT_HELPER: "on" })).toBe(true);
  });

  it("parses explicit truthy values for DRORA_CUA_DEV_MODE", () => {
    // isCuaDevModeRequested: only explicit truthy values (case-insensitive, trimmed).
    expect(isCuaDevModeRequested({})).toBe(false);
    expect(isCuaDevModeRequested({ DRORA_CUA_DEV_MODE: "0" })).toBe(false);
    expect(isCuaDevModeRequested({ DRORA_CUA_DEV_MODE: "false" })).toBe(false);
    expect(isCuaDevModeRequested({ DRORA_CUA_DEV_MODE: "1" })).toBe(true);
    expect(isCuaDevModeRequested({ DRORA_CUA_DEV_MODE: " ON " })).toBe(true);
    expect(isCuaDevModeRequested({ DRORA_CUA_DEV_MODE: "true" })).toBe(true);
  });

  it("sanitizes runtime env while sealing user network env for tools", () => {
    const sourceEnv = {
      HTTP_PROXY: "http://proxy.example:8080",
      NODE_ENV: "development",
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      PATH: "/usr/bin:/bin",
      npm_config_proxy: "http://npm-proxy.example:8080",
    };

    const sanitized = sanitizeDroraRuntimeEnv(sourceEnv);
    const passthroughEnv = buildDroraToolEnvPassthroughEnv(sourceEnv);
    const captured = readDroraToolEnvPassthroughEnv(passthroughEnv);

    expect(sanitized).toEqual({ PATH: "/usr/bin:/bin" });
    expect(captured).toEqual({
      HTTP_PROXY: "http://proxy.example:8080",
      NODE_EXTRA_CA_CERTS: "/tmp/root-ca.pem",
      npm_config_proxy: "http://npm-proxy.example:8080",
    });
  });

  it("ignores invalid passthrough JSON and non-network keys", () => {
    const captured = readDroraToolEnvPassthroughEnv({
      [DRORA_TOOL_ENV_PASSTHROUGH_ENV_KEY]: JSON.stringify({
        HTTP_PROXY: "http://proxy.example:8080",
        NODE_ENV: "production",
        PATH: "/tmp/bin",
      }),
    });

    expect(captured).toEqual({
      HTTP_PROXY: "http://proxy.example:8080",
    });
    expect(
      readDroraToolEnvPassthroughEnv({
        [DRORA_TOOL_ENV_PASSTHROUGH_ENV_KEY]: "not-json",
      }),
    ).toEqual({});
  });

  it("strips the CUA broker socket/authority/refresh marker from child env and tool passthrough", () => {
    // Confused-deputy 防护：broker bearer 凭据只该定向注入目标 drora-cua server，绝不能随全局 env
    // 泄漏给其它 MCP / Bash / tool 子进程，也不能经 tool-env-passthrough 恢复。
    const sourceEnv = {
      PATH: "/usr/bin:/bin",
      DRORA_CUA_PERMISSION_BROKER_SOCKET: "/tmp/drora-cua-me/broker-abc.sock",
      DRORA_CUA_PERMISSION_BROKER_REFRESH_MARKER:
        "/tmp/drora-cua-me/broker-abc.sock.permission-refresh.json",
    };
    const sanitized = sanitizeDroraRuntimeEnv(sourceEnv);
    expect(sanitized).toEqual({ PATH: "/usr/bin:/bin" });

    const captured = readDroraToolEnvPassthroughEnv(buildDroraToolEnvPassthroughEnv(sourceEnv));
    expect(captured).not.toHaveProperty("DRORA_CUA_PERMISSION_BROKER_SOCKET");
    expect(captured).not.toHaveProperty("DRORA_CUA_PERMISSION_BROKER_REFRESH_MARKER");
  });

  it("strips desktop-to-remote network handoff values after stdio bootstrap", () => {
    const sourceEnv = {
      PATH: "/usr/bin:/bin",
      [DRORA_REMOTE_RUNTIME_NETWORK_AUTHORITY_ENV_KEY]: "1",
      [DRORA_REMOTE_HTTP_PROXY_ENV_KEY]: "http://172.21.240.1:7890",
      [DRORA_REMOTE_NO_PROXY_ENV_KEY]: "localhost,127.0.0.1",
    };

    expect(sanitizeDroraRuntimeEnv(sourceEnv)).toEqual({ PATH: "/usr/bin:/bin" });
    expect(readDroraToolEnvPassthroughEnv(buildDroraToolEnvPassthroughEnv(sourceEnv))).toEqual({});
  });

  it("captures broker credentials as one atomic pair and clears stale state on partial rotation", () => {
    resetCapturedDroraCuaBrokerCredentialsForTest();
    try {
      sanitizeDroraRuntimeEnv({
        DRORA_CUA_PERMISSION_BROKER_SOCKET: "/tmp/broker-a.sock",
        DRORA_CUA_PLUGIN_AUTHORITY: "authority-a",
      });
      expect(getCapturedDroraCuaBrokerCredentials()).toEqual({
        socket: "/tmp/broker-a.sock",
        pluginAuthority: "authority-a",
      });

      sanitizeDroraRuntimeEnv({
        DRORA_CUA_PERMISSION_BROKER_SOCKET: "/tmp/broker-b.sock",
      });
      expect(getCapturedDroraCuaBrokerCredentials()).toEqual({
        socket: undefined,
        pluginAuthority: undefined,
      });

      sanitizeDroraRuntimeEnv({
        DRORA_CUA_PERMISSION_BROKER_SOCKET: "/tmp/broker-b.sock",
        DRORA_CUA_PLUGIN_AUTHORITY: "authority-b",
      });
      expect(getCapturedDroraCuaBrokerCredentials()).toEqual({
        socket: "/tmp/broker-b.sock",
        pluginAuthority: "authority-b",
      });
    } finally {
      resetCapturedDroraCuaBrokerCredentialsForTest();
    }
  });

  it("captures Agent OTLP config privately and never passes auth or identity through to tools", () => {
    resetCapturedDroraAgentTelemetryEnvForTest();
    const sourceEnv = {
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example.com/v1/traces",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "Authorization=secret",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://arms.example.com/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "Authorization=metric-secret",
      PATH: "/usr/bin:/bin",
      DRORA_TELEMETRY_USER_SUBJECT_ID: "opaque-user",
    };
    expect(sanitizeDroraRuntimeEnv(sourceEnv)).toEqual({ PATH: "/usr/bin:/bin" });
    expect(getCapturedDroraAgentTelemetryEnv()).toMatchObject({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example.com/v1/traces",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "Authorization=secret",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://arms.example.com/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "Authorization=metric-secret",
      DRORA_TELEMETRY_USER_SUBJECT_ID: "opaque-user",
    });
    const toolEnv = readDroraToolEnvPassthroughEnv(buildDroraToolEnvPassthroughEnv(sourceEnv));
    expect(toolEnv).not.toHaveProperty("OTEL_EXPORTER_OTLP_TRACES_HEADERS");
    expect(toolEnv).not.toHaveProperty("OTEL_EXPORTER_OTLP_METRICS_HEADERS");
    expect(toolEnv).not.toHaveProperty("DRORA_TELEMETRY_USER_SUBJECT_ID");
  });

  it("extracts only the allowlisted Agent telemetry env", () => {
    expect(
      readDroraAgentTelemetryEnv({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: " https://arms.example.com/v1/traces ",
        OTEL_UNKNOWN_SECRET: "must-not-pass",
        PATH: "/bin",
        DRORA_MODEL_TELEMETRY_ENABLED: "1",
        DRORA_TELEMETRY_RUNTIME_DISTRIBUTION: " packaged ",
      }),
    ).toEqual({
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://arms.example.com/v1/traces",
      DRORA_MODEL_TELEMETRY_ENABLED: "1",
      DRORA_TELEMETRY_RUNTIME_DISTRIBUTION: "packaged",
    });
  });
});
