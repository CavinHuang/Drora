/**
 * 语音厂商档 baseUrl 校验（修复轮 S1：实现审查 S1「baseUrl 无 https 强制」）。
 *
 * 三层分工（评审 S1 整改口径）：
 * - 持久化层（validationAppSettings）不加 refine：settings.json 可被用户手工编辑，
 *   schema 拒解析会隔离整份设置（历史值容错优先），强制收敛放在谓词层 + UI 层；
 * - 谓词层（本模块 isVoiceVendorConfigComplete / isVoiceVendorBaseUrlUsable）：
 *   明文非本机地址直接判档不完整 → 运行时回退 webSpeech/speechSynthesis（§9.6.6）；
 * - UI 层（VoiceSection）：对将保存的明文非本机地址**阻止写入**并渲染行内警告
 *   （择「阻止」理由：明文外发是静默风险，警告易被忽略；用户仍可输入 https 或本机地址）。
 */

export interface VoiceVendorBaseUrlValidation {
  ok: boolean;
  /** ok=false 时的拒绝原因（UI 警告 i18n 键选择用）。 */
  reason?: "insecure-remote" | "unparseable";
}

function isLoopishHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

/**
 * 厂商档 baseUrl 校验：https 强制；localhost/127.0.0.1/[::1]/ *.localhost 明文例外
 * （自托管 OpenAI 兼容网关场景，§9.6.1 备选②）。空串返回 ok（档「未配置」语义由
 * isVoiceVendorConfigComplete 三元非空判定负责，此处只校验形态）。
 */
export function validateVoiceVendorBaseUrl(baseUrl: string | null | undefined): VoiceVendorBaseUrlValidation {
  const trimmed = baseUrl?.trim() ?? "";
  if (trimmed.length === 0) {
    return { ok: true };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (parsed.protocol === "https:") {
    return { ok: true };
  }
  if (parsed.protocol === "http:" && isLoopishHost(parsed.hostname)) {
    return { ok: true };
  }
  return { ok: false, reason: "insecure-remote" };
}
