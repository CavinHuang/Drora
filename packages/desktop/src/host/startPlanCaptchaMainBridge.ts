import { randomUUID } from "node:crypto";
import { HostResponseTypes, type CaptchaClientConfig } from "@drora/shared";

/**
 * host↔main Start Plan captcha 采集桥。host 侧把采集请求经 parentPort 发给 main
 * （隐藏 BrowserWindow 里跑阿里云 captcha SDK），按 requestId 关联回传凭证。
 * 消息模式与 browserControlMainBridge 一致：可注入 postMessage，便于单测。
 *
 * 官方在 renderer 采集（见 specs/start-plan-captcha-verification.md 的有意分歧记录）；
 * Drora renderer 没有 host→renderer 反向 channel，因此落在 main。
 */

interface CaptchaSolveRequestMessage {
  type: typeof HostResponseTypes.CaptchaSolveRequest;
  requestId: string;
  captcha: CaptchaClientConfig;
  language: "cn" | "en";
}

export interface CaptchaSolveResultMessage {
  requestId: string;
  ok: boolean;
  /** ok=true 时为一次性验证凭证（官方 success 回调的 captchaVerifyParam）。 */
  captchaVerifyParam?: string;
  captchaRegion?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * 采集预算：官方无感验证 8s 无响应即超时，脚本加载/SDK init 另有耗时；
 * 30s 覆盖加载+init+无感全链路。不做交互挑战（窗口不可见，见 spec 分歧 2），
 * 超时按降级处理而不是让模型请求失败。
 */
const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingEntry {
  resolve: (result: CaptchaSolveResultMessage) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface StartPlanCaptchaMainBridge {
  resolveCaptcha(input: {
    requestId: string;
    captcha: CaptchaClientConfig;
    language: "cn" | "en";
  }): Promise<{ captchaVerifyParam: string; captchaRegion?: string } | null>;
  /** main 回传结果时由 host 消息分派调用。 */
  handleResult(message: CaptchaSolveResultMessage): void;
  dispose(): void;
}

export function createStartPlanCaptchaMainBridge(deps: {
  postToMain: (message: CaptchaSolveRequestMessage) => void;
  timeoutMs?: number;
}): StartPlanCaptchaMainBridge {
  const pending = new Map<string, PendingEntry>();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async resolveCaptcha({ requestId, captcha, language }) {
      const bridgeRequestId = `captcha:${randomUUID()}`;
      const attemptId = requestId;
      const result = await new Promise<CaptchaSolveResultMessage>((resolve) => {
        const timer = setTimeout(() => {
          if (pending.delete(bridgeRequestId)) {
            resolve({
              requestId: bridgeRequestId,
              ok: false,
              errorCode: "timeout",
              errorMessage: `captcha solve timed out after ${timeoutMs}ms (attempt ${attemptId})`,
            });
          }
        }, timeoutMs);
        pending.set(bridgeRequestId, { resolve, timer });
        deps.postToMain({
          type: HostResponseTypes.CaptchaSolveRequest,
          requestId: bridgeRequestId,
          captcha,
          language,
        });
      });
      if (!result.ok || !result.captchaVerifyParam?.trim()) {
        return null;
      }
      return {
        captchaVerifyParam: result.captchaVerifyParam,
        ...(result.captchaRegion?.trim() ? { captchaRegion: result.captchaRegion.trim() } : {}),
      };
    },

    handleResult(message: CaptchaSolveResultMessage): void {
      const entry = pending.get(message.requestId);
      if (!entry) return;
      pending.delete(message.requestId);
      clearTimeout(entry.timer);
      entry.resolve(message);
    },

    dispose(): void {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ requestId: "", ok: false, errorCode: "disposed" });
      }
      pending.clear();
    },
  };
}

/** 采集请求的载荷构造（语言按官方 knn 规则由调用方决定，这里只做消息封装）。 */
export function buildCaptchaSolveRequest(input: {
  requestId: string;
  captcha: CaptchaClientConfig;
  language: "cn" | "en";
}): CaptchaSolveRequestMessage {
  return {
    type: HostResponseTypes.CaptchaSolveRequest,
    requestId: input.requestId,
    captcha: input.captcha,
    language: input.language,
  };
}
