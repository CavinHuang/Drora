import type { DroraProviderAccountAccess } from "@drora/shared";

/**
 * Start Plan 模型请求的人机验证头（阿里云 ESA WAF 3007 "captcha verify failed" 的解法）。
 *
 * 官方桌面端（3.14.x out/renderer 反汇编取证，见 specs/start-plan-captcha-verification.md）：
 * 仅 `zhipu-account` + `start-plan` 的模型请求需要附带一次性验证凭证，付费 Coding Plan
 * 与 API Key provider 不需要。host 在 runtime-headers 应答里把凭证白名单合并进
 * requestAuth.headers，CLI 原样透传，本身不认识这些头。
 */

export const CAPTCHA_VERIFY_PARAM_HEADER = "X-Aliyun-Captcha-Verify-Param";
export const CAPTCHA_VERIFY_REGION_HEADER = "X-Aliyun-Captcha-Verify-Region";

/** runtime-headers 应答允许携带的验证头白名单（与官方一致，其余头一律不透传）。 */
export const START_PLAN_CAPTCHA_HEADER_ALLOWLIST: readonly string[] = [
  CAPTCHA_VERIFY_PARAM_HEADER,
  CAPTCHA_VERIFY_REGION_HEADER,
];

/** host 侧验证凭证采集 port。桌面本地装配经 parentPort 桥调 main 隐藏窗口；远端 authority 不注入。 */
export interface StartPlanCaptchaResolver {
  resolve(input: {
    providerId: string;
    requestId: string;
    accountAccess: DroraProviderAccountAccess;
  }): Promise<{ captchaVerifyParam: string; captchaRegion?: string } | null>;
}

export function isStartPlanAccountAccess(
  access: DroraProviderAccountAccess | undefined | null,
): access is DroraProviderAccountAccess & { mode: "start-plan" } {
  return access?.type === "zhipu-account" && access.mode === "start-plan";
}

/** 按官方 lnn 语义构造验证头；region 缺省时只带 param 头。 */
export function buildStartPlanCaptchaHeaders(input: {
  captchaVerifyParam: string;
  captchaRegion?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    [CAPTCHA_VERIFY_PARAM_HEADER]: input.captchaVerifyParam,
  };
  const region = input.captchaRegion?.trim();
  if (region) {
    headers[CAPTCHA_VERIFY_REGION_HEADER] = region;
  }
  return headers;
}

/**
 * 官方只把白名单内的验证头并入 requestAuth；这里做同样的收敛，
 * 防止采集端未来扩展字段时把非验证头漏进模型请求。
 * 对象 spread 大小写敏感，先剔除既有的同名变体再写规范拼写，避免同一头发两次。
 */
export function mergeStartPlanCaptchaHeaders(
  headers: Record<string, string> | undefined,
  captcha: { captchaVerifyParam: string; captchaRegion?: string } | null | undefined,
): Record<string, string> | undefined {
  if (!captcha) return headers;
  const captchaHeaders = buildStartPlanCaptchaHeaders(captcha);
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const isCaptchaHeader = START_PLAN_CAPTCHA_HEADER_ALLOWLIST.some(
      (name) => name.toLowerCase() === key.toLowerCase(),
    );
    if (!isCaptchaHeader) merged[key] = value;
  }
  return { ...merged, ...captchaHeaders };
}
