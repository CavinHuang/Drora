// 还原自发行 bundle：ZCode 3.14.3 /remote/v4；仅格式化，原始字节见 upstream/。
import { r as e } from "./src-BBFd38IP.js";
function t(e, t) {
  (e.accDescr && t.setAccDescription?.(e.accDescr),
    e.accTitle && t.setAccTitle?.(e.accTitle),
    e.title && t.setDiagramTitle?.(e.title));
}
e(t, `populateCommonDb`);
export { t };
