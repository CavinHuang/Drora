import type { Locale } from "@drora/shared";
import { desktopPetArtworkDataUrl } from "./desktopPetArtwork.js";
import { desktopPetBackgroundSize, desktopPetMotionCss } from "./desktopPetMotionCss.js";

/** Static local document. The artwork is bundled; task facts never enter HTML. */
export function desktopPetContent(locale: Locale): string {
  const openLabel = locale.startsWith("zh") ? "打开 Drora 任务" : "Open Drora task";
  const dragLabel = locale.startsWith("zh") ? "拖动桌面宠物" : "Move desktop pet";
  return `<!doctype html><html lang="${locale.startsWith("zh") ? "zh" : "en"}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:system-ui,sans-serif;user-select:none}
#grab{height:18px;width:70px;margin:0 auto;app-region:drag;cursor:grab;display:flex;justify-content:center;align-items:center}
#grab:before{content:"";width:26px;height:4px;border-radius:9px;background:rgba(80,86,107,.36)}
#pet{position:relative;display:block;width:96px;height:96px;margin:1px auto 0;border:0;padding:0;background:transparent;cursor:pointer;app-region:no-drag;outline-offset:2px}
#pet:focus-visible{outline:2px solid #6754d7;border-radius:30px}
#pet-art{display:block;width:96px;height:96px;pointer-events:none;background-image:url("${desktopPetArtworkDataUrl}");background-size:${desktopPetBackgroundSize};background-repeat:no-repeat;background-position:0 0;filter:drop-shadow(0 3px 3px #231c3f38)}
#badge{position:absolute;right:0;top:9px;min-width:22px;height:22px;padding:2px 5px;border-radius:20px;background:#f5b347;color:#30221a;border:2px solid #fff;font-size:12px;font-weight:700;line-height:14px;display:none}
#signal{position:absolute;right:8px;bottom:6px;width:15px;height:15px;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 3px #241d3b55;display:none}
#pet[data-mode=attention] #badge{display:block}#pet[data-mode=attention] #signal{display:block;background:#f5b347}
#pet[data-mode=working] #signal{display:block;background:#668cdf}
#pet[data-mode=completed] #signal{display:block;background:#52b980}
#pet[data-mode=error] #signal{display:block;background:#dd6873}
${desktopPetMotionCss()}
@media(prefers-reduced-motion:reduce){#pet[data-mode] #pet-art{animation:none}}
</style></head><body><div id="grab" aria-label="${dragLabel}"></div><button id="pet" type="button" data-mode="idle" aria-label="${openLabel}"><span id="pet-art" aria-hidden="true"></span><span id="badge"></span><span id="signal"></span></button></body></html>`;
}
