import type { Locale } from "@drora/shared";

/** Isolated, pointer-transparent companion document; previews arrive through validated IPC. */
export function desktopPetBubbleContent(locale: Locale): string {
  const language = locale.startsWith("zh") ? "zh" : "en";
  return `<!doctype html><html lang="${language}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;font-family:system-ui,sans-serif;pointer-events:none}
#bubble{width:100%;height:auto;min-height:50px;max-height:100%;padding:11px 14px;border:1px solid rgba(127,110,183,.34);border-radius:16px;background:rgba(35,30,54,.94);box-shadow:0 8px 22px rgba(23,18,40,.25);color:#fff;overflow:hidden}
#status{font-size:13px;font-weight:700;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#preview{margin:6px 0 0;font-size:12px;line-height:16px;color:#f0eaf9;overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4}
#preview:empty{display:none}
</style></head><body><div id="bubble" role="status" aria-live="polite"><div id="status"></div><p id="preview"></p></div></body></html>`;
}
