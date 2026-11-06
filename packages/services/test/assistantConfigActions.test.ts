/**
 * P5 设置中心单测（06 号详设 §6）：configActions 六 setter 的 bounds/结构
 * fail-closed 矩阵、publish 触发（onDidChange 即时回显）、kv 落值与快照投影回落。
 */
// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { openAssistantDatabase } from "../src/assistant-tickets/assistantDatabase.js";
import { createAssistantTicketsService } from "../src/assistant-tickets/assistantTicketsService.js";
import { ASSISTANT_KV_KEYS } from "../src/assistant-tickets/assistantConfig.js";
import { ASSISTANT_SOURCE_KV_KEYS } from "../src/assistant-tickets/sources/sourceConfig.js";
import {
  setAssistantDispatchPort,
  setAssistantFrameSource,
  setAssistantGitWorktreePort,
  setAssistantRouterPort,
  setAssistantSessionsIndexPort,
  setAssistantWorkspaceProbePort,
} from "../src/assistant-tickets/assistantPorts.js";

const LOCAL_IDENTITY = "local-user";

function createService() {
  const db = openAssistantDatabase(":memory:");
  const service = createAssistantTicketsService({
    databasePath: ":memory:",
    localIdentity: LOCAL_IDENTITY,
    database: db,
  });
  return { service, db };
}

function kvGet(
  db: ReturnType<typeof openAssistantDatabase>,
  key: string,
): string | undefined {
  const row = db.raw.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function clearPorts(): void {
  setAssistantDispatchPort(null);
  setAssistantFrameSource(null);
  setAssistantGitWorktreePort(null);
  setAssistantRouterPort(null);
  setAssistantSessionsIndexPort(null);
  setAssistantWorkspaceProbePort(null);
}

afterEach(() => {
  clearPorts();
});

describe("P5 设置中心：bounds fail-closed（06 §2）", () => {
  it("setBudget：界内落 kv+publish；非整数/越界拒绝且不落库", async () => {
    const { service, db } = createService();
    const ok = await service.setBudget({ maxActivePerWorkspace: 5 });
    expect(ok.ok).toBe(true);
    expect(kvGet(db, ASSISTANT_KV_KEYS.budgetMaxActivePerWorkspace)).toBe("5");
    for (const bad of [0, 11, 3.5, Number.NaN]) {
      const rejected = await service.setBudget({ maxActivePerWorkspace: bad });
      expect(rejected.ok).toBe(false);
    }
    expect(kvGet(db, ASSISTANT_KV_KEYS.budgetMaxActivePerWorkspace)).toBe("5");
  });

  it("setTrustGateThresholds：部分更新只写传入键；越界拒绝", async () => {
    const { service, db } = createService();
    const partial = await service.setTrustGateThresholds({ minSamples: 20 });
    expect(partial.ok).toBe(true);
    expect(kvGet(db, ASSISTANT_KV_KEYS.trustGateMinSamples)).toBe("20");
    expect(kvGet(db, ASSISTANT_KV_KEYS.trustGateMinRate)).toBeUndefined();
    const rejected = await service.setTrustGateThresholds({ minRate: 0.3 });
    expect(rejected.ok).toBe(false);
    const empty = await service.setTrustGateThresholds({});
    expect(empty.ok).toBe(false);
  });

  it("setWatchdogIntervalMinutes：分钟换算 ms 落 kv（读侧 watchdog 语义不变）", async () => {
    const { service, db } = createService();
    const ok = await service.setWatchdogIntervalMinutes({ minutes: 30 });
    expect(ok.ok).toBe(true);
    expect(kvGet(db, ASSISTANT_KV_KEYS.watchdogIntervalMs)).toBe(String(30 * 60 * 1000));
    const rejected = await service.setWatchdogIntervalMinutes({ minutes: 4 });
    expect(rejected.ok).toBe(false);
  });

  it("setSourcesConfig：github 启用须合法 repo+点名词；结构坏值逐项拒绝", async () => {
    const { service, db } = createService();
    const ok = await service.setSourcesConfig({
      feishu: { enabled: true },
      github: { enabled: true, repo: "owner/repo", mentionName: "大副" },
    });
    expect(ok.ok).toBe(true);
    const stored = JSON.parse(
      kvGet(db, ASSISTANT_SOURCE_KV_KEYS.sourcesConfig) ?? "{}",
    ) as Record<string, unknown>;
    expect(stored.github).toEqual({ enabled: true, repo: "owner/repo", mentionName: "大副" });
    // 缺 repo / 坏 repo 形态 / 缺点名词：enabled=true 一律拒绝且不覆盖已存值。
    for (const bad of [
      { github: { enabled: true, mentionName: "大副" } },
      { github: { enabled: true, repo: "not-a-repo", mentionName: "大副" } },
      { github: { enabled: true, repo: "owner/repo" } },
      { feishu: { enabled: "yes" as unknown as boolean } },
    ]) {
      const rejected = await service.setSourcesConfig(bad);
      expect(rejected.ok).toBe(false);
    }
    const unchanged = JSON.parse(
      kvGet(db, ASSISTANT_SOURCE_KV_KEYS.sourcesConfig) ?? "{}",
    ) as Record<string, unknown>;
    expect(unchanged.github).toEqual({ enabled: true, repo: "owner/repo", mentionName: "大副" });
  });

  it("setSourceIdentityMap：嵌套两子表；空键值拒绝；合并计数超 50 拒绝", async () => {
    const { service, db } = createService();
    const ok = await service.setSourceIdentityMap({
      feishu: { "fe-user-1": LOCAL_IDENTITY },
      github: { "gh-user-1": LOCAL_IDENTITY },
    });
    expect(ok.ok).toBe(true);
    const stored = JSON.parse(kvGet(db, ASSISTANT_SOURCE_KV_KEYS.identityMap) ?? "{}") as {
      feishu?: Record<string, string>;
      github?: Record<string, string>;
    };
    expect(stored.feishu?.["fe-user-1"]).toBe(LOCAL_IDENTITY);
    expect(stored.github?.["gh-user-1"]).toBe(LOCAL_IDENTITY);

    const emptyKey = await service.setSourceIdentityMap({ feishu: { "  ": LOCAL_IDENTITY } });
    expect(emptyKey.ok).toBe(false);
    const emptyValue = await service.setSourceIdentityMap({ github: { "gh-user-2": "  " } });
    expect(emptyValue.ok).toBe(false);

    const tooMany: Record<string, string> = {};
    for (let i = 0; i < 51; i += 1) tooMany[`u${i}`] = LOCAL_IDENTITY;
    const overflow = await service.setSourceIdentityMap({ feishu: tooMany });
    expect(overflow.ok).toBe(false);
  });

  it("setModelPreference：合法落嵌套 modelSelection；坏结构拒绝；null=清除（空串）", async () => {
    const { service, db } = createService();
    const ok = await service.setModelPreference({
      providerId: "zai",
      modelId: "glm-5.3",
      reasoningLevel: "high",
    });
    expect(ok.ok).toBe(true);
    expect(JSON.parse(kvGet(db, ASSISTANT_KV_KEYS.modelPreference) ?? "{}")).toEqual({
      providerId: "zai",
      modelId: "glm-5.3",
      options: { reasoningLevel: "high" },
    });
    const bad = await service.setModelPreference({ providerId: "", modelId: "glm-5.3" });
    expect(bad.ok).toBe(false);
    const cleared = await service.setModelPreference(null);
    expect(cleared.ok).toBe(true);
    expect(kvGet(db, ASSISTANT_KV_KEYS.modelPreference)).toBe("");
  });
});

describe("P5 设置中心：publish 即时回显与投影回落", () => {
  it("setter → publish → onDidChange 快照携带新值（Source 配置即时 reconcile 语义）", async () => {
    const { service } = createService();
    const snapshots: unknown[] = [];
    const sub = service.onDidChange((snapshot) => snapshots.push(snapshot));
    try {
      await service.setModelPreference({ providerId: "zai", modelId: "glm-5.3" });
      await service.setBudget({ maxActivePerWorkspace: 7 });
      await service.setSourcesConfig({ github: { enabled: true, repo: "o/r", mentionName: "m" } });
      expect(snapshots.length).toBeGreaterThanOrEqual(3);
      const latest = snapshots[snapshots.length - 1] as {
        modelPreference: { providerId: string; modelId: string } | null;
        budget: { maxActivePerWorkspace: number };
        sourcesConfig: { github?: { repo?: string } };
      };
      expect(latest.modelPreference).toEqual({ providerId: "zai", modelId: "glm-5.3" });
      expect(latest.budget.maxActivePerWorkspace).toBe(7);
      expect(latest.sourcesConfig.github?.repo).toBe("o/r");
    } finally {
      sub.dispose();
    }
  });

  it("kv 坏值逐键回落缺省（读侧纪律不变；直写 kv=测试驱动先例）", async () => {
    const { service, db } = createService();
    db.raw
      .prepare(
        "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(ASSISTANT_KV_KEYS.trustGateMinRate, "not-a-number", Date.now());
    db.raw
      .prepare(
        "INSERT INTO kv(key, value, updated_ms) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(ASSISTANT_KV_KEYS.modelPreference, "{broken json", Date.now());
    const config = await service.getConfig();
    expect(config.ok).toBe(true);
    if (!config.ok) return;
    // 坏 minRate 回落缺省 0.8；坏 model_preference 回落 null（CLI 缺省）。
    expect(config.value.trustGateThresholds.minRate).toBe(0.8);
    expect(config.value.modelPreference).toBeNull();
  });
});
