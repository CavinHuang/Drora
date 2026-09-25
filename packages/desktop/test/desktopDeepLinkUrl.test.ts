import assert from "node:assert/strict";
import test from "node:test";
import {
  extractDeepLinkUrlFromArgs,
  extractShareImportCode,
  extractWorkspaceOpenPath,
  isOAuthCallbackUrl,
  isPaymentCallbackUrl,
  isShareImportUrl,
  isWorkspaceOpenUrl,
} from "../src/main/desktopDeepLinkUrl.js";

// zcode:// 是官网 OAuth 中转页白名单的回调契约（原版应用同样注册 zcode），
// drora:// 是本应用自有 deep link。两类 scheme 必须等价接受，
// 否则浏览器授权完成后的系统回跳会打不开应用。

test("OAuth 回调接受 zcode 与 drora 两种 scheme", () => {
  assert.ok(isOAuthCallbackUrl(new URL("zcode://oauth/callback?code=abc&state=s1")));
  assert.ok(isOAuthCallbackUrl(new URL("drora://oauth/callback?code=abc&state=s1")));
  // 无 hostname 的路径形态（zcode:///oauth/callback）也要接受。
  assert.ok(isOAuthCallbackUrl(new URL("zcode:///oauth/callback?state=s1")));
});

test("OAuth 回调拒绝无效 host/path 与外部 scheme", () => {
  assert.ok(!isOAuthCallbackUrl(new URL("zcode://oauth/other?state=s1")));
  assert.ok(!isOAuthCallbackUrl(new URL("zcode://other/callback?state=s1")));
  assert.ok(!isOAuthCallbackUrl(new URL("https://example.com/oauth/callback?state=s1")));
});

test("支付与工作区、分享导入回调同样接受双 scheme", () => {
  assert.ok(
    isPaymentCallbackUrl(new URL("zcode://payment/callback?provider=a&channel=b&status=ok")),
  );
  assert.ok(
    isPaymentCallbackUrl(new URL("drora://payment/callback?provider=a&channel=b&status=ok")),
  );

  const workspaceUrl = new URL("zcode://workspace/open?path=C:/demo");
  assert.ok(isWorkspaceOpenUrl(workspaceUrl));
  assert.equal(extractWorkspaceOpenPath(workspaceUrl), "C:/demo");
  assert.ok(isWorkspaceOpenUrl(new URL("drora://workspace/open?path=C:/demo")));

  const shareUrl = new URL("zcode://share/import?code=Abc_123");
  assert.ok(isShareImportUrl(shareUrl));
  assert.equal(extractShareImportCode(shareUrl), "Abc_123");
});

test("argv 提取能识别 zcode:// 回调（第二实例与冷启动链路）", () => {
  assert.equal(
    extractDeepLinkUrlFromArgs(["Drora.exe", "zcode://oauth/callback?code=abc&state=s1"]),
    "zcode://oauth/callback?code=abc&state=s1",
  );
  assert.equal(
    extractDeepLinkUrlFromArgs(["Drora.exe", "drora://oauth/callback?code=abc&state=s1"]),
    "drora://oauth/callback?code=abc&state=s1",
  );
  assert.equal(extractDeepLinkUrlFromArgs(["Drora.exe", "--regular-flag"]), null);
});
