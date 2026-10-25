import { describe, expect, it } from "vitest";
import { createWebZaiOAuthConfig } from "../src/auth/webZaiOAuthConfig.js";

// Web 侧 bigmodel OAuth 契约回归：appId 是 bigmodel 服务端注册值
// （specs/drora-rename.md 规则 0），默认值必须与桌面端一致取 "zcode"。
// 误改成 drora 时 zaiWebOAuthProvider 会把错误的 appId 拼进授权 URL 查询参数，
// 授权服务按未注册 appId 拒绝（审计 docs/upstream-sync/2026-10-21-v3.16.1-merge-audit.md
// 「appId 契约漂移」，specs/drora-divergence-ledger.md 台账 6）。

describe("webZaiOAuthConfig", () => {
  it("bigmodel appId 默认值保持服务端注册值 zcode（规则 0 豁免，不随品牌改名）", () => {
    expect(createWebZaiOAuthConfig({}).bigmodelAppId).toBe("zcode");
  });

  it("VITE_BIGMODEL_OAUTH_APP_ID 注入优先于默认值", () => {
    const config = createWebZaiOAuthConfig({ VITE_BIGMODEL_OAUTH_APP_ID: "  custom  " });
    expect(config.bigmodelAppId).toBe("custom");
  });
});
