// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
import { r as e, t } from "./src-BBFd38IP.js";
var n = e((e, n) => {
  let r;
  return (
    n === `sandbox` && (r = t(`#i` + e)),
    t(n === `sandbox` ? r.nodes()[0].contentDocument.body : `body`).select(`[id="${e}"]`)
  );
}, `getDiagramElement`);
export { n as t };
