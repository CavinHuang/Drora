import assert from "node:assert/strict";
import test from "node:test";
import { BIGMODEL_PROVIDER_ID, ZAI_PROVIDER_ID } from "@drora/shared";
import { createOAuthRuntimeConfig } from "../src/oauth/runtimeConfig.js";

// 服务端 OAuth 契约回归：appId 与 redirect 中转参数都是官网/授权服务白名单里的固定值，
// 重命名时误改成 drora 会导致中转页返回 "sign-in callback URL is invalid"，
// 浏览器授权完成后无法回跳桌面端（详见 specs/drora-rename.md 的受保护 URL 清单）。

test("bigmodel provider 保留服务端 OAuth 契约", () => {
  const config = createOAuthRuntimeConfig({});
  const bigmodel = config.providers.find((provider) => provider.id === BIGMODEL_PROVIDER_ID);
  assert.ok(bigmodel, "bigmodel provider 必须存在");

  assert.equal(bigmodel.appId, "zcode");
  assert.equal(bigmodel.tokenUrl, "https://zcode.z.ai/api/v1/oauth/token");

  const redirectUri = new URL(bigmodel.redirectUri);
  assert.equal(redirectUri.searchParams.get("redirect"), "zcode://oauth/callback");
  assert.ok(
    redirectUri.pathname.endsWith("/app/oauth/login"),
    `redirect 必须走官网中转页，实际 ${redirectUri.pathname}`,
  );
  assert.ok(redirectUri.searchParams.get("app_version"), "必须携带 app_version");
});

test("zai provider 保留服务端 OAuth 契约", () => {
  const config = createOAuthRuntimeConfig({});
  const zai = config.providers.find((provider) => provider.id === ZAI_PROVIDER_ID);
  assert.ok(zai, "zai provider 必须存在");

  assert.match(zai.appId, /^client_/u);
  assert.equal(zai.tokenUrl, "https://zcode.z.ai/api/v1/oauth/token");

  const redirectUri = new URL(zai.redirectUri);
  assert.equal(redirectUri.searchParams.get("redirect"), "zcode://oauth/callback");
});
