// host↔main Start Plan captcha 采集桥回归测试：requestId 关联、失败/超时降级为 null。
// 桥语义见 specs/start-plan-captcha-verification.md：采集失败绝不能让模型请求失败，
// resolver 返回 null 时 droraAgentService 按修复前行为（无验证头）应答。
import assert from "node:assert/strict";
import test from "node:test";

import {
  createStartPlanCaptchaMainBridge,
  buildCaptchaSolveRequest,
} from "../src/host/startPlanCaptchaMainBridge.js";

const captchaConfig = {
  enabled: true,
  region: "cn-shanghai",
  prefix: "pfx",
  sceneId: "scene-1",
};

test("resolveCaptcha 成功路径：请求携带配置，结果按 requestId 关联", async () => {
  const posted: Array<{ requestId: string }> = [];
  const bridge = createStartPlanCaptchaMainBridge({
    postToMain: (message) => {
      posted.push(message);
    },
  });
  const pending = bridge.resolveCaptcha({
    requestId: "req-1",
    captcha: captchaConfig,
    language: "cn",
  });
  assert.equal(posted.length, 1);
  assert.match(posted[0]!.requestId, /^captcha:/);
  assert.deepEqual(posted[0]!.captcha, captchaConfig);

  bridge.handleResult({
    requestId: posted[0]!.requestId,
    ok: true,
    captchaVerifyParam: "param-1",
    captchaRegion: "cn-shanghai",
  });
  assert.deepEqual(await pending, {
    captchaVerifyParam: "param-1",
    captchaRegion: "cn-shanghai",
  });
});

test("resolveCaptcha 失败结果降级为 null，不抛错", async () => {
  const posted: Array<{ requestId: string }> = [];
  const bridge = createStartPlanCaptchaMainBridge({
    postToMain: (message) => {
      posted.push(message);
    },
  });
  const pending = bridge.resolveCaptcha({
    requestId: "req-2",
    captcha: captchaConfig,
    language: "en",
  });
  bridge.handleResult({
    requestId: posted[0]!.requestId,
    ok: false,
    errorCode: "traceless_timeout",
  });
  assert.equal(await pending, null);
});

test("resolveCaptcha 超时降级为 null，迟到的结果安全忽略", async () => {
  const posted: Array<{ requestId: string }> = [];
  const bridge = createStartPlanCaptchaMainBridge({
    postToMain: (message) => {
      posted.push(message);
    },
    timeoutMs: 20,
  });
  const pending = bridge.resolveCaptcha({
    requestId: "req-3",
    captcha: captchaConfig,
    language: "cn",
  });
  assert.equal(await pending, null);
  // 迟到结果：pending 已清理，handleResult 必须安全忽略（不抛错）。
  bridge.handleResult({
    requestId: posted[0]!.requestId,
    ok: true,
    captchaVerifyParam: "late",
  });
});

test("buildCaptchaSolveRequest 生成带消息类型的载荷", () => {
  const message = buildCaptchaSolveRequest({
    requestId: "captcha:id",
    captcha: captchaConfig,
    language: "cn",
  });
  assert.equal(message.type, "captcha-solve-request");
  assert.equal(message.requestId, "captcha:id");
  assert.equal(message.language, "cn");
});
