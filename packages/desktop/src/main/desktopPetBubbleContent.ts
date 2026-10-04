import type { Locale } from "@zcode/shared";

/** Isolated, pointer-transparent companion document; previews arrive through validated IPC. */
export function desktopPetBubbleContent(locale: Locale): string {
  const language = locale.startsWith("zh") ? "zh" : "en";
  return `<!doctype html><html lang="${language}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;font-family:system-ui,sans-serif;pointer-events:none}
/* 气泡底边贴住宠物头顶（窗口下方留 BUBBLE_GAP 间隙），水平居中；宽度随内容收缩、不超过窗口最大宽度 */
body{display:flex;justify-content:center;align-items:flex-end}
#bubble{width:fit-content;max-width:100%;min-width:64px;padding:9px 12px;border:1px solid rgba(127,110,183,.34);border-radius:12px;background:rgba(35,30,54,.94);box-shadow:0 8px 22px rgba(23,18,40,.25);color:#fff;overflow:hidden}
#status{font-size:11px;font-weight:700;line-height:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#preview{margin:4px 0 0;font-size:11px;line-height:15px;color:#f0eaf9;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:4}
#preview:empty{display:none}
</style></head><body><div id="bubble" role="status" aria-live="polite"><div id="status"></div><p id="preview"></p></div></body></html>`;
}
