import { describe, expect, it } from "vitest";
import { droraProtocolMethods, droraRuntimeCapabilitiesSchema } from "@drora/shared";
import {
  attachPersonaEnabledForCapability,
  supportsPersonaControlV1,
} from "../src/drora-agent/independentPlanSupport.js";

// Persona 切片 C 的 Host 侧能力门验收（合同 §4.1、PM15/33）：
// - 能力缓存按 CLI 连接实例保存（WeakMap），重连产生新实例即重查；不按 workspacePath 全局缓存；
// - 缺失/method-not-found/断线一律视为不可用（false），且失败后清除缓存允许重试；
// - 新 Host 只在确认能力后才保留 personaEnabled；对旧 CLI 原地剥掉该键（其 strict
//   schema 收到未知键会解析失败），缺失值在新 CLI 侧按 false。

type FakeClient = {
  request: (method: string, params?: unknown, schema?: unknown, options?: unknown) => Promise<unknown>;
};

function fakeClient(
  respond: (method: string) => Promise<unknown>,
): { client: FakeClient; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    client: {
      request: async (method: string) => {
        calls.push(method);
        return respond(method);
      },
    },
  };
}

describe("supportsPersonaControlV1（能力缓存按连接实例）", () => {
  it("personaControlV1=true → true；缺失 → false；两次命中同一实例只发一次请求", async () => {
    const { client, calls } = fakeClient(async (method) => {
      expect(method).toBe(droraProtocolMethods.runtimeCapabilities);
      return droraRuntimeCapabilitiesSchema.parse({ personaControlV1: true });
    });
    await expect(supportsPersonaControlV1(client)).resolves.toBe(true);
    await expect(supportsPersonaControlV1(client)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("旧 CLI 响应缺 personaControlV1 → false（原会话继续，不试发 persona 方法）", async () => {
    const { client } = fakeClient(async () =>
      droraRuntimeCapabilitiesSchema.parse({ independentPlanState: true }),
    );
    await expect(supportsPersonaControlV1(client)).resolves.toBe(false);
  });

  it("method-not-found（-32601）→ false，且失败后清除缓存：能力恢复后重查为 true", async () => {
    let methodFound = false;
    const { client, calls } = fakeClient(async () => {
      if (!methodFound) {
        const error = new Error("Method not found") as Error & { code?: number };
        error.code = -32601;
        throw error;
      }
      return droraRuntimeCapabilitiesSchema.parse({ personaControlV1: true });
    });
    await expect(supportsPersonaControlV1(client)).resolves.toBe(false);
    methodFound = true;
    // 失败结果不缓存：同一实例能力恢复后重查。
    await expect(supportsPersonaControlV1(client)).resolves.toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("不同 CLI 连接实例各自查询（不共享缓存，模拟重连后的新实例）", async () => {
    const first = fakeClient(async () => droraRuntimeCapabilitiesSchema.parse({ personaControlV1: true }));
    const second = fakeClient(async () => droraRuntimeCapabilitiesSchema.parse({}));
    await expect(supportsPersonaControlV1(first.client)).resolves.toBe(true);
    await expect(supportsPersonaControlV1(second.client)).resolves.toBe(false);
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
  });
});

describe("attachPersonaEnabledForCapability（执行许可 E 的附加门）", () => {
  it("新 CLI（能力确认）：响应保留 resolver 给出的 personaEnabled 值", async () => {
    const { client } = fakeClient(async () =>
      droraRuntimeCapabilitiesSchema.parse({ personaControlV1: true }),
    );
    const preferences = { nativeSearchEnhancementsEnabled: true, personaEnabled: true };
    await expect(attachPersonaEnabledForCapability(client, preferences)).resolves.toEqual({
      nativeSearchEnhancementsEnabled: true,
      personaEnabled: true,
    });
  });

  it("旧 CLI（能力缺失）：personaEnabled 键被原地剥掉，其余字段原样（不发未知字段）", async () => {
    const { client } = fakeClient(async () => droraRuntimeCapabilitiesSchema.parse({}));
    const preferences = { nativeSearchEnhancementsEnabled: true, personaEnabled: true };
    const result = await attachPersonaEnabledForCapability(client, preferences);
    expect(result).toEqual({ nativeSearchEnhancementsEnabled: true });
    expect("personaEnabled" in result).toBe(false);
  });

  it("能力检查失败（断线/旧 CLI 不认识 runtimeCapabilities）：同样剥掉 personaEnabled", async () => {
    const { client } = fakeClient(async () => {
      throw new Error("transport closed");
    });
    const preferences = { personaEnabled: false, memoryEnabled: true };
    const result = await attachPersonaEnabledForCapability(client, preferences);
    expect(result).toEqual({ memoryEnabled: true });
    expect("personaEnabled" in result).toBe(false);
  });

  it("响应本就未携带 personaEnabled（旧 Host 装配）：门是幂等 no-op", async () => {
    const { client, calls } = fakeClient(async () => droraRuntimeCapabilitiesSchema.parse({}));
    const preferences = { nativeSearchEnhancementsEnabled: true };
    await expect(attachPersonaEnabledForCapability(client, preferences)).resolves.toEqual({
      nativeSearchEnhancementsEnabled: true,
    });
    expect(calls).toHaveLength(1);
  });
});
