import type { Locale } from "@drora/shared";

/** Static isolated documents. Artwork and task text arrive over their typed IPC ports. */
export function desktopPetOverlayContent(locale: Locale, tray = false): string {
  const zh = locale.startsWith("zh");
  const lang = zh ? "zh" : "en";
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
:root{color-scheme:light dark;--ui-font-size:14px;--text-ui-base:var(--ui-font-size);--text-ui-caption:calc(var(--ui-font-size) - 1px);--color-popover:#fff;--color-foreground:#171717;--color-foreground-subtle:#666;--color-border:#ddd;--color-menu-hover:#f2f2f2;--color-warning:#e07b00;--color-destructive:#e03131;--color-success:#1e8a3e}
@media(prefers-color-scheme:dark){:root{--color-popover:#2b2b2b;--color-foreground:#eee;--color-foreground-subtle:#aaa;--color-border:#444;--color-menu-hover:#383838;--color-warning:#ff8a30;--color-destructive:#ff5c5c;--color-success:#46bf72}}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;font-family:system-ui,sans-serif;color:var(--color-foreground);font-size:var(--text-ui-base);user-select:none}
button{font:inherit;color:inherit;cursor:pointer}button:focus-visible{outline:2px solid Highlight;outline-offset:-2px}
#pet{position:absolute;left:8px;top:8px;border:0;padding:0;background:transparent;cursor:grab;touch-action:none}
#pet:active{cursor:grabbing}#pet-art{display:block;pointer-events:none;background-repeat:no-repeat;width:100%;height:100%;filter:drop-shadow(0 3px 3px #0003)}
#badge{position:absolute;min-width:24px;height:24px;border-radius:999px;border:1px solid var(--color-border);background:var(--color-popover);box-shadow:0 2px 5px #0003;padding:0 5px;touch-action:none;z-index:2}
#badge[data-corner^=top]{top:0}#badge[data-corner^=bottom]{bottom:0}#badge[data-corner$=start]{left:0}#badge[data-corner$=end]{right:0}
#badge[data-mode=attention]{color:var(--color-warning);border-color:var(--color-warning)}#badge[data-mode=error]{color:var(--color-destructive);border-color:var(--color-destructive)}#badge[data-mode=working]{color:Highlight;border-color:Highlight}
#tray{margin:5px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-popover);box-shadow:0 4px 12px #0003;height:calc(100% - 10px);display:flex;flex-direction:column;overflow:hidden}
header{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--color-border)}header strong{flex:1}header button{border:0;background:transparent;border-radius:6px;padding:4px 6px}button:hover{background-color:var(--color-menu-hover)}
#activities{overflow:auto;flex:1;padding:4px;display:flex;flex-direction:column;gap:2px}.activity{display:flex;align-items:start;border-radius:6px}.open-task{flex:1;min-width:0;text-align:left;border:0;background:transparent;padding:8px;border-radius:6px}.activity-title{display:block;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.activity-preview{display:block;color:var(--color-foreground-subtle);font-size:var(--text-ui-caption);line-height:1.4;overflow-wrap:anywhere;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3}.activity-status{display:block;color:var(--color-foreground-subtle);font-size:var(--text-ui-caption)}.dismiss{border:0;background:transparent;padding:6px;border-radius:6px}.collapsed .activity-preview{display:none}#empty{margin:20px 8px;color:var(--color-foreground-subtle);text-align:center}
</style></head><body data-pet-document="${tray ? "tray" : "pet"}">${
    tray
      ? `<section id="tray" aria-label="${zh ? "任务活动" : "Task activity"}"><header><strong>${zh ? "任务活动" : "Task activity"}</strong><button id="collapse" aria-label="${zh ? "展开或收起预览" : "Expand or collapse previews"}" aria-expanded="true">↕</button><button id="close-tray" aria-label="${zh ? "关闭" : "Close"}">×</button></header><div id="activities"></div><p id="empty">${zh ? "暂无任务活动" : "No task activity"}</p></section>`
      : `<div id="pet" role="button" tabindex="0" aria-label="${zh ? "宠物与任务活动" : "Pet and task activity"}"><span id="pet-art" aria-hidden="true"></span><button id="badge" aria-label="${zh ? "任务活动" : "Task activity"}" data-corner="top-end">0</button></div>`
  }</body></html>`;
}
