import { BrowserWindow } from "electron";
import type { CaptchaClientConfig } from "@drora/shared";

/**
 * Start Plan 人机验证采集器（main 进程隐藏窗口）。
 *
 * 阿里云 captcha JS SDK 需要 DOM；官方在 renderer 采集，Drora 的 renderer 没有
 * host→renderer 反向 channel，因此落在 main 的隐藏 BrowserWindow（同为 Chromium，
 * SDK 指纹一致；有意分歧与验收见 specs/start-plan-captcha-verification.md）。
 *
 * 官方调用序列（out/renderer/assets/styles-DEELZGp2.js 反汇编取证）：
 *   1. 加载 https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js
 *   2. window.AliyunCaptchaConfig = { region, prefix }
 *   3. initAliyunCaptcha({ SceneId, mode:"popup", language, showErrorTip:false,
 *        element, button, getInstance, success, fail, onError })
 *   4. getInstance(instance) → instance.startTracelessVerification()（无感优先）
 *   5. success(captchaVerifyParam) → 一次性凭证，用后即弃
 *
 * 第一版只支持无感验证：隐藏窗口用户不可见，交互挑战（滑块）无法完成，
 * 超时按失败返回由 host 降级（不带头请求，WAF 3007 照常透出）。
 */

/** 官方 enn() 的脚本地址，逐字对齐。 */
const CAPTCHA_SCRIPT_URL = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";

/** 单次采集预算：脚本加载 + SDK init + 无感验证（官方无感无响应超时 8s）。bridge 层 30s。 */
const SOLVE_TIMEOUT_MS = 25_000;

/** 无感验证发出后允许的等待时间（对齐官方 Vtn=8e3）。 */
const TRACELESS_TIMEOUT_MS = 8_000;

export interface CaptchaSolveOutcome {
  ok: boolean;
  captchaVerifyParam?: string;
  captchaRegion?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface CaptchaSolver {
  solve(input: {
    captcha: CaptchaClientConfig;
    language: "cn" | "en";
  }): Promise<CaptchaSolveOutcome>;
  dispose(): void;
}

interface SerializedSolveResult {
  ok: boolean;
  captchaVerifyParam?: string;
  errorMessage?: string;
  errorCode?: string;
}

export function createCaptchaSolver(): CaptchaSolver {
  let window: BrowserWindow | null = null;
  let disposed = false;
  let inflight: Promise<CaptchaSolveOutcome> | null = null;

  async function ensureWindow(): Promise<BrowserWindow> {
    if (window && !window.isDestroyed()) {
      return window;
    }
    // 每次采集前重置页面：SDK 会往 DOM 插 popup 节点且有内部状态，about:blank 重载
    // 是最干净的换代方式（官方用 configKey 换代 + Qtn 清理，语义等价）。
    const created = new BrowserWindow({
      show: false,
      width: 420,
      height: 420,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    created.on("closed", () => {
      if (window === created) {
        window = null;
      }
    });
    await created.loadURL("about:blank");
    window = created;
    return created;
  }

  function solveOnce(input: {
    captcha: CaptchaClientConfig;
    language: "cn" | "en";
  }): Promise<CaptchaSolveOutcome> {
    const script = buildSolveScript(input.captcha, input.language);
    return ensureWindow().then(async (solverWindow) => {
      const serialized = (await solverWindow.webContents.executeJavaScript(
        script,
        true,
      )) as SerializedSolveResult;
      if (serialized?.ok && serialized.captchaVerifyParam) {
        return {
          ok: true,
          captchaVerifyParam: serialized.captchaVerifyParam,
          captchaRegion: input.captcha.region,
        };
      }
      return {
        ok: false,
        errorCode: serialized?.errorCode ?? "solve_failed",
        errorMessage: serialized?.errorMessage ?? "captcha solve returned no param",
      };
    });
  }

  return {
    solve(input) {
      if (disposed) {
        return Promise.resolve({ ok: false, errorCode: "disposed" });
      }
      // 同一窗口串行采集：SDK 全局状态不可并发，后续请求等当前这次结束（桥层 30s 兜底）。
      const previous = inflight ?? Promise.resolve();
      const current = previous.then(
        () => solveOnce(input),
        () => solveOnce(input),
      );
      inflight = current;
      void current.catch(() => {});
      void current.finally(() => {
        if (inflight === current) {
          inflight = null;
        }
      });
      return current;
    },

    dispose() {
      disposed = true;
      const current = window;
      window = null;
      if (current && !current.isDestroyed()) {
        current.destroy();
      }
    },
  };
}

/**
 * 生成注入隐藏窗口的自包含采集脚本。返回 Promise<SerializedSolveResult>：
 * 超时/SDK 失败都以 {ok:false} 结算，绝不 reject（executeJavaScript 的 reject 只留给
 * 页面崩溃等传输层异常，由 solveOnce 的调用链兜底）。
 */
function buildSolveScript(
  captcha: CaptchaClientConfig,
  language: "cn" | "en",
): string {
  const configJson = JSON.stringify({
    region: captcha.region,
    prefix: captcha.prefix,
    sceneId: captcha.sceneId,
    language,
    scriptUrl: CAPTCHA_SCRIPT_URL,
    tracelessTimeoutMs: TRACELESS_TIMEOUT_MS,
    solveTimeoutMs: SOLVE_TIMEOUT_MS,
  });
  return `(async () => {
  const cfg = ${configJson};
  const ELEMENT_ID = "__drora-captcha-element";
  const BUTTON_ID = "__drora-captcha-button";
  let settled = false;
  let resolve;
  const settle = (result) => {
    if (!settled) {
      settled = true;
      clearTimeout(solveTimer);
      resolve(result);
    }
  };
  const timeout = (ms, code, message) => setTimeout(() => {
    settle({ ok: false, errorCode: code, errorMessage: message });
  }, ms);
  const solveTimer = timeout(cfg.solveTimeoutMs, "timeout", "captcha solve timed out");
  const p = new Promise((r) => { resolve = r; });
  try {
    if (typeof window.initAliyunCaptcha !== "function") {
      await new Promise((resolveLoad, rejectLoad) => {
        const existing = document.querySelector('script[src="' + cfg.scriptUrl + '"]');
        if (existing) {
          if (typeof window.initAliyunCaptcha === "function") { resolveLoad(); return; }
          existing.addEventListener("load", () => resolveLoad(), { once: true });
          existing.addEventListener("error", () => rejectLoad(new Error("captcha script load error")), { once: true });
          return;
        }
        const script = document.createElement("script");
        script.src = cfg.scriptUrl;
        script.async = true;
        script.onload = () => resolveLoad();
        script.onerror = () => rejectLoad(new Error("captcha script load error"));
        document.head.appendChild(script);
      });
    }
    if (typeof window.initAliyunCaptcha !== "function") {
      settle({ ok: false, errorCode: "sdk_unavailable", errorMessage: "captcha SDK is unavailable" });
      return p;
    }
    // SDK 通过该全局读取 region/prefix 决定接入域名（官方 nnn 同款）。
    window.AliyunCaptchaConfig = { region: cfg.region, prefix: cfg.prefix };
    document.body.innerHTML =
      '<div id="' + ELEMENT_ID + '"></div><button id="' + BUTTON_ID + '" style="display:none"></button>';
    window.initAliyunCaptcha({
      SceneId: cfg.sceneId,
      mode: "popup",
      language: cfg.language,
      showErrorTip: false,
      element: "#" + ELEMENT_ID,
      button: "#" + BUTTON_ID,
      getInstance: (instance) => {
        // 官方：非交互路径优先无感验证；隐藏窗口无法完成交互挑战，
        // 无感 8s 无响应按官方 Vtn 超时结算为失败。
        timeout(cfg.tracelessTimeoutMs, "traceless_timeout", "traceless verification did not respond");
        if (instance && typeof instance.startTracelessVerification === "function") {
          instance.startTracelessVerification();
          return;
        }
        settle({ ok: false, errorCode: "traceless_unavailable", errorMessage: "traceless verification is unavailable" });
      },
      success: (param) => {
        settle({ ok: true, captchaVerifyParam: String(param || "") });
      },
      fail: (reason) => {
        settle({ ok: false, errorCode: "sdk_fail", errorMessage: "captcha fail: " + JSON.stringify(reason ?? null).slice(0, 200) });
      },
      onError: (reason) => {
        settle({ ok: false, errorCode: "sdk_error", errorMessage: "captcha error: " + JSON.stringify(reason ?? null).slice(0, 200) });
      },
    });
  } catch (error) {
    settle({ ok: false, errorCode: "exception", errorMessage: String(error && error.message || error) });
  }
  return p;
})()`;
}
