// LAN HTTP 缺 Clipboard API；只在出站 HTML 注入纯文本 writeText 回退（spec §12.11）。
// 官方 3.14.3 原始资产与缓存均不改写，安全上下文及原生 clipboard 零改动。
import { injectInlineHeadScript } from "./inlineHeadScript.js";

export const INSECURE_CONTEXT_CLIPBOARD_SHIM_MARKER = "__zcodeInsecureClipboardShim";

export const INSECURE_CONTEXT_CLIPBOARD_SHIM_JS = `(function () {
  "use strict";
  var g = globalThis;
  if (g.isSecureContext !== false || typeof g.navigator === "undefined" ||
      g.navigator.clipboard || typeof g.document === "undefined" ||
      typeof g.document.execCommand !== "function") return;
  var ${INSECURE_CONTEXT_CLIPBOARD_SHIM_MARKER} = 1;
  Object.defineProperty(g.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: function (text) {
        // Promise executor 同步执行，保留浏览器点击事件的用户激活状态。
        return new Promise(function (resolve, reject) {
          if (!g.document.body) {
            reject(new Error("clipboard copy unavailable"));
            return;
          }
          var active = g.document.activeElement;
          var selection = g.document.getSelection && g.document.getSelection();
          var ranges = [];
          if (selection && typeof selection.getRangeAt === "function") {
            for (var i = 0; i < selection.rangeCount; i += 1) {
              ranges.push(selection.getRangeAt(i).cloneRange());
            }
          }
          var textarea = g.document.createElement("textarea");
          textarea.value = String(text);
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.top = "0";
          textarea.style.left = "0";
          textarea.style.opacity = "0";
          textarea.style.pointerEvents = "none";
          try {
            g.document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            if (!g.document.execCommand("copy")) throw new Error("clipboard copy unavailable");
            resolve();
          } catch (error) {
            reject(error);
          } finally {
            textarea.remove();
            if (selection && typeof selection.removeAllRanges === "function") {
              selection.removeAllRanges();
              for (var j = 0; j < ranges.length; j += 1) selection.addRange(ranges[j]);
            }
            if (active && typeof active.focus === "function") {
              try { active.focus({ preventScroll: true }); } catch (_) { active.focus(); }
            }
          }
        });
      },
    },
  });
})();
`;

/** 仅入口 HTML 出站注入；脚本自门控且标记防二次注入。 */
export function injectOfficialPageClipboardShim(html: string): string {
  return injectInlineHeadScript(
    html,
    INSECURE_CONTEXT_CLIPBOARD_SHIM_MARKER,
    INSECURE_CONTEXT_CLIPBOARD_SHIM_JS,
  );
}
