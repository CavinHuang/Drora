// Start Plan 人机验证头（阿里云 WAF 3007 修复）回归测试。
// 官方语义取证见 specs/start-plan-captcha-verification.md：
// 仅 zhipu-account + start-plan 需要验证头；host 只把白名单内两个头并入 requestAuth。
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseClientConfigSnapshot } from "@drora/shared";

import {
  CAPTCHA_VERIFY_PARAM_HEADER,
  CAPTCHA_VERIFY_REGION_HEADER,
  buildStartPlanCaptchaHeaders,
  isStartPlanAccountAccess,
  mergeStartPlanCaptchaHeaders,
} from "../src/model-provider/startPlanCaptchaHeaders.js";

const startPlanAccess = {
  type: "zhipu-account",
  accountType: "bigmodel",
  mode: "start-plan",
  entitled: true,
};

test("isStartPlanAccountAccess 仅对 start-plan 模式成立", () => {
  assert.equal(isStartPlanAccountAccess(startPlanAccess), true);
  assert.equal(
    isStartPlanAccountAccess({ ...startPlanAccess, mode: "individual-coding-plan" }),
    false,
  );
  assert.equal(isStartPlanAccountAccess(undefined), false);
  assert.equal(isStartPlanAccountAccess({ type: "api-key", accountType: "bigmodel", mode: "start-plan", entitled: true }), false);
});

test("buildStartPlanCaptchaHeaders 带 region 时输出两个头，缺 region 只输出 param 头", () => {
  assert.deepEqual(
    buildStartPlanCaptchaHeaders({ captchaVerifyParam: "p1", captchaRegion: "cn-shanghai" }),
    {
      [CAPTCHA_VERIFY_PARAM_HEADER]: "p1",
      [CAPTCHA_VERIFY_REGION_HEADER]: "cn-shanghai",
    },
  );
  assert.deepEqual(buildStartPlanCaptchaHeaders({ captchaVerifyParam: "p2" }), {
    [CAPTCHA_VERIFY_PARAM_HEADER]: "p2",
  });
});

test("mergeStartPlanCaptchaHeaders 合并验证头并剔除同名变体，避免同一头发两次", () => {
  const merged = mergeStartPlanCaptchaHeaders(
    { "x-aliyun-captcha-verify-param": "stale", "x-custom": "keep" },
    { captchaVerifyParam: "fresh" },
  );
  assert.equal(merged[CAPTCHA_VERIFY_PARAM_HEADER], "fresh");
  assert.equal(merged["x-custom"], "keep");
  assert.equal(merged["x-aliyun-captcha-verify-param"], undefined, "小写旧值必须被剔除");
  assert.equal(Object.keys(merged).length, 2);
});

test("mergeStartPlanCaptchaHeaders 无凭证时原样返回既有 headers", () => {
  const headers = { authorization: "Bearer x" };
  assert.equal(mergeStartPlanCaptchaHeaders(headers, null), headers);
  assert.equal(mergeStartPlanCaptchaHeaders(headers, undefined), headers);
});

test("client-configs 的 captcha 配置解析：完整保留、不完整/关闭归一为 null", () => {
  const full = parseClientConfigSnapshot({
    code: 0,
    data: {
      configs: {
        captcha: { enabled: true, region: "cn-shanghai", prefix: "pfx", sceneId: "scene-1" },
      },
    },
  });
  assert.deepEqual(full.captcha, {
    enabled: true,
    region: "cn-shanghai",
    prefix: "pfx",
    sceneId: "scene-1",
  });

  for (const captcha of [
    { enabled: false, region: "r", prefix: "p", sceneId: "s" },
    { enabled: true, region: "", prefix: "p", sceneId: "s" },
    { enabled: true, region: "r", prefix: "p" },
    "garbage",
  ]) {
    const snapshot = parseClientConfigSnapshot({ code: 0, data: { configs: { captcha } } });
    assert.equal(snapshot.captcha, null, `应归一为 null: ${JSON.stringify(captcha)}`);
  }

  assert.equal(parseClientConfigSnapshot({ code: 0, data: { configs: {} } }).captcha, null);
});
